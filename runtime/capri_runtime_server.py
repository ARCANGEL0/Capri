#!/usr/bin/env python3
import collections
import concurrent.futures
import datetime
import fcntl
import hmac
import http.server
import json
import os
import pty
import sqlite3
import re
import select
import shlex
import shutil
import signal
import struct
import subprocess
import termios
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlparse


HOST = os.environ.get("CAPRI_RUNTIME_BIND", "127.0.0.1")
PORT = int(os.environ.get("CAPRI_RUNTIME_PORT", "7788"))
TOKEN = os.environ.get("CAPRI_RUNTIME_TOKEN", "")
HOME = Path(os.environ.get("HOME", str(Path.home()))).expanduser()
DEVICE = os.environ.get("CAPRI_RUNTIME_DEVICE", os.uname().nodename.split(".")[0])
STT_URL = os.environ.get("CAPRI_RUNTIME_STT_URL", "http://127.0.0.1:7790/v1/audio/transcriptions")
STT_TOKEN_FILE = Path(os.environ.get("CAPRI_RUNTIME_STT_TOKEN_FILE", "/home/ubuntu/.config/g2-stt/client-token"))
MAX_BODY = 12 * 1024 * 1024
MAX_SESSIONS = 6
SESSION_SCAN_LIMIT = max(0, int(os.environ.get("CAPRI_SESSION_SCAN_LIMIT", "0")))
SESSION_COMMAND_TIMEOUT = max(0.5, float(os.environ.get("CAPRI_SESSION_COMMAND_TIMEOUT", "3")))
MODEL_CACHE = {}
MODEL_CACHE_PATH = Path(os.environ.get("CAPRI_RUNTIME_MODEL_CACHE", str(HOME / ".cache" / "capri" / "models.json")))
MODEL_CACHE_TTL = 1800
MODEL_CACHE_LOCK = threading.Lock()
MODEL_CACHE_LOADED = False
AGENT_NAMES = {
    "claude": "Claude Code",
    "nclaude": "nClaude / NVIDIA",
    "codex": "Codex",
    "opencode": "OpenCode",
    "ghost": "Ghost",
    "codewhale": "CodeWhale / DeepSeek",
    "dsh": "DeepSeek Harness / DSH",
    "kimi": "Kimi Code",
    "gemini": "Gemini CLI",
    "cline": "Cline",
}
AGENT_COMMAND = {
    "claude": "claude",
    "nclaude": "nclaude",
    "codex": "codex",
    "opencode": "opencode",
    "ghost": "ghost",
    "codewhale": "codewhale",
    "dsh": "dsh",
    "kimi": "kimi",
    "gemini": "gemini",
    "cline": "cline",
}
FALLBACK_MODELS = {
    "claude": ["sonnet", "opus", "haiku", "claude-fable-5"],
    "nclaude": [
        "nemotron-3-ultra", "nemotron-vl", "lightning", "bolt", "nano-omni",
        "mistral-large-4", "minimax", "step-5", "laguna",
    ],
    "codex": ["gpt-5-codex", "gpt-5.1-codex", "o3"],
}
SESSION_LIST_COMMANDS = {
    "ghost": (("session", "list", "--format", "json"), ("session", "list", "--json")),
    "codewhale": (("sessions", "--json"), ("session", "list", "--json"), ("history", "--json")),
    "dsh": (("sessions", "--json"), ("session", "list", "--json"), ("--profile", "tui", "sessions", "--json")),
    "kimi": (("sessions", "--json"), ("session", "list", "--json")),
    "gemini": (("--list-sessions",),),
    "cline": (("history", "--json", "--limit", "40"), ("history", "--json")),
}
SESSION_LOCK = threading.RLock()
SESSIONS = {}


def session_slice(values):
    return values if SESSION_SCAN_LIMIT == 0 else values[:SESSION_SCAN_LIMIT]


class ManagedSession:
    def __init__(self, process, master_fd, kind, agent, runtime, title, saved_id=""):
        self.id = uuid.uuid4().hex[:16]
        self.process = process
        self.master_fd = master_fd
        self.kind = kind
        self.agent = agent
        self.runtime = runtime
        self.title = title
        self.saved_id = saved_id
        self.created_at = time.time()
        self.lock = threading.RLock()
        self.changed = threading.Condition(self.lock)
        self.events = collections.deque(maxlen=3000)
        self.sequence = 0
        self.done = False
        self.approval = None
        self.text_tail = ""
        self.output_tail = ""
        self.last_output_at = time.time()
        self.startup_prompt_tail = ""
        self.startup_update_skipped = False
        self.startup_update_scheduled = False
        self.reader = threading.Thread(target=self._read_output, daemon=True)
        self.reader.start()

    def _skip_codex_update_prompt(self):
        time.sleep(0.35)
        with self.lock:
            if self.done or self.process.poll() is not None:
                return
            try:
                os.write(self.master_fd, b"2\n")
            except OSError:
                return

    def _read_output(self):
        try:
            while True:
                ready, _, _ = select.select([self.master_fd], [], [], 1.0)
                if not ready:
                    if self.process.poll() is not None:
                        break
                    continue
                try:
                    data = os.read(self.master_fd, 8192)
                except OSError:
                    break
                if not data:
                    break
                text = data.decode("utf-8", "replace")
                suppress_startup_prompt = False
                clean = terminal_text(text)
                with self.changed:
                    self.output_tail = (self.output_tail + clean)[-6000:]
                    self.last_output_at = time.time()
                if self.kind == "agent":
                    self.startup_prompt_tail = (self.startup_prompt_tail + clean)[-4000:]
                    if (
                        self.agent == "codex"
                        and not self.startup_update_skipped
                        and codex_update_prompt(self.startup_prompt_tail)
                    ):
                        self.startup_update_skipped = True
                        suppress_startup_prompt = True
                        if not self.startup_update_scheduled:
                            self.startup_update_scheduled = True
                            threading.Thread(target=self._skip_codex_update_prompt, daemon=True).start()
                with self.changed:
                    if not suppress_startup_prompt:
                        self.sequence += 1
                        self.events.append((self.sequence, {"text": text}))
                    if self.kind == "agent":
                        self.text_tail = (self.text_tail + clean)[-8000:]
                        detected = detect_approval(self.agent, self.text_tail)
                        if detected and (not self.approval or detected["prompt"] != self.approval["prompt"]):
                            self.approval = detected
                            self.sequence += 1
                            self.events.append((self.sequence, {"approval": self.approval}))
                    self.changed.notify_all()
        finally:
            try:
                os.close(self.master_fd)
            except OSError:
                pass
            with self.changed:
                self.done = True
                self.sequence += 1
                self.events.append((self.sequence, {"done": True}))
                self.changed.notify_all()

    def write(self, text):
        data = text.encode("utf-8", "replace")
        with self.lock:
            if self.done or self.process.poll() is not None:
                raise RuntimeError("Session is closed")
            os.write(self.master_fd, data)

    def recent_output(self):
        """Short tail of what the harness drew, for input diagnostics."""
        with self.changed:
            return re.sub(r"\s+", " ", self.output_tail[-800:]).strip()

    def stop(self):
        if self.process.poll() is not None:
            return
        try:
            os.killpg(self.process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(self.process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            self.process.wait(timeout=3)


def reap_finished_sessions():
    stale = []
    with SESSION_LOCK:
        for session_id, session in list(SESSIONS.items()):
            if session.done or session.process.poll() is not None:
                stale.append(session)
                SESSIONS.pop(session_id, None)
    for session in stale:
        session.stop()


def active_saved_session(saved_id):
    if not saved_id:
        return None
    reap_finished_sessions()
    with SESSION_LOCK:
        return next((
            session for session in SESSIONS.values()
            if session.saved_id == saved_id and not session.done and session.process.poll() is None
        ), None)


def api_error(message, code=400):
    return code, {"error": str(message)}


def command_path(agent):
    return shutil.which(AGENT_COMMAND.get(agent, ""))


def available_agents():
    entries = []
    claude_runtime = [name for name in ("claude", "nclaude") if shutil.which(name)]
    for agent_id, name in AGENT_NAMES.items():
        available = bool(command_path(agent_id))
        if agent_id == "claude":
            available = bool(claude_runtime)
        if agent_id == "nclaude":
            available = "nclaude" in claude_runtime
        entry = {"id": agent_id, "name": name, "available": available}
        if agent_id == "claude":
            entry["runtimes"] = claude_runtime
        entries.append(entry)
    return entries


def tailscale_devices():
    fallback = []
    try:
        result = subprocess.run(
            ["tailscale", "status", "--json"],
            capture_output=True,
            text=True,
            timeout=4,
            check=True,
        )
        status = json.loads(result.stdout)
        own = status.get("Self") or {}
        if own:
            fallback.append(device_record(own, True))
        for peer in (status.get("Peer") or {}).values():
            fallback.append(device_record(peer, False))
    except (OSError, subprocess.SubprocessError, ValueError, json.JSONDecodeError):
        return []
    for device in fallback:
        device["name"] = device["name"].lower()
    return fallback


def device_record(raw, self_device):
    addresses = raw.get("TailscaleIPs") or []
    ip = next((address for address in addresses if ":" not in address), "")
    name = raw.get("HostName") or raw.get("DNSName", "").split(".")[0]
    return {
        "name": str(name).removesuffix("."),
        "dnsName": str(raw.get("DNSName") or name).removesuffix("."),
        "ip": ip,
        "os": str(raw.get("OS") or ""),
        "online": bool(raw.get("Online", True) if not self_device else raw.get("BackendState") == "Running" or raw.get("Online", True)),
    }


def display_title(text, fallback):
    clean = re.sub(r"\s+", " ", text or "").strip()
    clean = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", clean)
    return clean[:88] if clean else fallback


def terminal_text(text):
    value = re.sub(r"\x1b\][^\x07]*(?:\x07|\x1b\\)", "", text)
    value = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", value)
    value = re.sub(r"\x1b[()][0-2A-Z]", "", value)
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", value).replace("\r", "\n")


def codex_update_prompt(text):
    normalized = re.sub(r"\s+", " ", text).strip().lower()
    return bool(re.search(
        r"updat(?:e)?\s+available.*1\.\s*update\s+now.*2\.\s*skip.*"
        r"3\.\s*skip\s*until\s*next\s*version.*enter\s+continue",
        normalized,
    ))


def codex_update_prompt_output(text):
    normalized = re.sub(r"\s+", " ", terminal_text(text)).strip().lower()
    return bool(
        re.search(r"updat(?:e)?\s+available", normalized)
        and re.search(r"1\.\s*update\s+now", normalized)
        and "skip" in normalized
        and "enter" in normalized
    )


def detect_approval(agent, text):
    excerpt = re.sub(r"\s+", " ", text[-2500:]).strip()
    lower = excerpt.lower()
    claude_prompt = (
        ("allow once" in lower and ("no, and tell" in lower or "allow always" in lower or "yes, allow" in lower))
        or ("do you want to allow" in lower and "no" in lower)
    )
    opencode_prompt = "allow once" in lower and ("allow always" in lower or "reject" in lower)
    codex_prompt = (
        ("approve" in lower or "approval" in lower or "permission" in lower or "do you want to run" in lower or "run this command" in lower)
        and ("allow once" in lower or "(y/n)" in lower or "(y/n/a)" in lower or "yes" in lower and "no" in lower or "approve" in lower and "deny" in lower)
    )
    ghost_prompt = ("approval" in lower or "permission" in lower or "approve" in lower) and (
        "[y/n" in lower or "(y/n" in lower or "allow once" in lower or "yes" in lower and "no" in lower
    )
    generic_prompt = ("approval" in lower or "permission" in lower or "approve" in lower or "allow" in lower) and (
        "[y/n" in lower or "(y/n" in lower or "allow once" in lower or "yes" in lower and "no" in lower or "approve" in lower and "deny" in lower
    )
    matched = {
        "claude": claude_prompt,
        "nclaude": claude_prompt,
        "opencode": opencode_prompt,
        "codex": codex_prompt,
        "ghost": ghost_prompt,
        "codewhale": generic_prompt,
        "dsh": generic_prompt,
        "kimi": generic_prompt,
        "gemini": generic_prompt,
        "cline": generic_prompt,
    }.get(agent, False)
    if not matched:
        return None
    if agent == "opencode":
        options = [
            {"id": "once", "label": "Allow once"},
            {"id": "always", "label": "Allow always"},
            {"id": "deny", "label": "Reject"},
        ]
    elif agent in ("claude", "nclaude"):
        options = [
            {"id": "once", "label": "Allow once"},
            {"id": "always", "label": "Allow for session"},
            {"id": "deny", "label": "Deny"},
        ]
    elif agent == "codex":
        if "allow once" in lower or "approve once" in lower:
            options = [
                {"id": "once", "label": "Allow once"},
                {"id": "always", "label": "Allow for session"},
                {"id": "deny", "label": "Deny"},
            ]
        else:
            options = [{"id": "once", "label": "Allow"}, {"id": "deny", "label": "Deny"}]
    else:
        options = [{"id": "once", "label": "Allow once"}, {"id": "deny", "label": "Deny"}]
    prompt = excerpt[-330:]
    return {"agent": agent, "prompt": prompt, "options": options}


def approval_keystrokes(session, choice):
    options = (session.approval or {}).get("options", [])
    ids = [option.get("id") for option in options]
    if choice not in ids:
        raise ValueError("Approval choice is not available")
    index = ids.index(choice)
    if session.agent in ("claude", "nclaude"):
        return f"{index + 1}\n"
    if session.agent == "codex" and "[y/n" in (session.approval or {}).get("prompt", "").lower():
        return "n\n" if choice == "deny" else "y\n"
    if session.agent in ("ghost", "codewhale", "dsh", "kimi", "gemini", "cline") and "[y/n" in (session.approval or {}).get("prompt", "").lower():
        return "n\n" if choice == "deny" else "y\n"
    return ("\x1b[B" * index) + "\r"


def message_text(value):
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for part in value:
            if isinstance(part, dict) and part.get("type") == "text":
                parts.append(str(part.get("text", "")))
        return " ".join(parts)
    if isinstance(value, dict):
        return message_text(value.get("content"))
    return ""


def read_json_lines(path, max_bytes=65536):
    records = []
    try:
        with path.open("rb") as stream:
            raw = stream.read(max_bytes)
        for line in raw.splitlines():
            if len(line) > 250000:
                continue
            try:
                item = json.loads(line)
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue
            if isinstance(item, dict):
                records.append(item)
    except OSError:
        pass
    return records


def claude_session_roots():
    roots = []
    for variable in ("CLAUDE_CONFIG_DIR", "CLAUDE_HOME"):
        configured = os.environ.get(variable, "").strip()
        if configured:
            roots.append(Path(configured).expanduser() / "projects")
    roots.extend((HOME / ".claude" / "projects", HOME / ".config" / "claude" / "projects"))
    unique = []
    seen = set()
    for root in roots:
        key = str(root)
        if key not in seen:
            seen.add(key)
            unique.append(root)
    return unique


def claude_sessions():
    found = {}
    roots = [root for root in claude_session_roots() if root.exists()]
    if not roots:
        return []
    paths = []
    for root in roots:
        try:
            paths.extend(root.rglob("*.jsonl"))
        except OSError:
            continue
    paths = session_slice(sorted(paths, key=lambda item: item.stat().st_mtime, reverse=True))
    for path in paths:
        sid = path.stem
        title = ""
        cwd = ""
        for record in read_json_lines(path):
            cwd = cwd or str(record.get("cwd") or "")
            if record.get("type") == "user":
                title = message_text((record.get("message") or {}).get("content"))
                if title:
                    break
        try:
            updated = int(path.stat().st_mtime * 1000)
        except OSError:
            updated = 0
        item = {"id": sid, "agent": "claude", "title": display_title(title, sid[:10]), "updatedAt": updated, "cwd": cwd}
        key = (item["agent"], item["id"])
        if key not in found or item["updatedAt"] > found[key]["updatedAt"]:
            found[key] = item
    return session_slice(sorted(found.values(), key=lambda item: item.get("updatedAt", 0), reverse=True))


def codex_sessions():
    root = Path(os.environ.get("CODEX_HOME", str(HOME / ".codex"))) / "sessions"
    found = []
    if not root.exists():
        return found
    try:
        paths = session_slice(sorted(root.rglob("rollout-*.jsonl"), key=lambda item: item.stat().st_mtime, reverse=True))
    except OSError:
        return found
    for path in paths:
        session_id = ""
        title = ""
        cwd = ""
        for record in read_json_lines(path, 96000):
            payload = record.get("payload") or record
            cwd = cwd or str(payload.get("cwd") or payload.get("working_directory") or "")
            if not session_id:
                session_id = str(payload.get("id") or payload.get("session_id") or "")
            event_type = str(record.get("type") or payload.get("type") or "")
            if event_type in ("session_meta", "user_message", "message") and not title:
                title = message_text(payload.get("message") or payload.get("content") or payload.get("text"))
            if session_id and title:
                break
        if not session_id:
            match = re.search(r"([0-9a-f]{8}-[0-9a-f-]{27,})", path.name, re.I)
            session_id = match.group(1) if match else path.stem
        try:
            updated = int(path.stat().st_mtime * 1000)
        except OSError:
            updated = 0
        found.append({"id": session_id, "agent": "codex", "title": display_title(title, session_id[:10]), "updatedAt": updated, "cwd": cwd})
    return session_slice(sorted(found, key=lambda item: item.get("updatedAt", 0), reverse=True))


def opencode_sessions():
    database = Path(os.environ.get("OPENCODE_DB", str(HOME / ".local" / "share" / "opencode" / "opencode.db")))
    if not database.exists():
        return []
    found = []
    try:
        connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True, timeout=2)
        rows = connection.execute(
            "select id, title, time_updated, directory from session where time_archived is null order by time_updated desc"
            + (f" limit {SESSION_SCAN_LIMIT}" if SESSION_SCAN_LIMIT else "")
        ).fetchall()
        connection.close()
    except (OSError, sqlite3.Error):
        return []
    for session_id, title, updated, cwd in rows:
        found.append({
            "id": str(session_id),
            "agent": "opencode",
            "title": display_title(str(title or ""), str(session_id)[:10]),
            "updatedAt": int(updated or 0),
            "cwd": str(cwd or ""),
        })
    return session_slice(sorted(found, key=lambda item: item.get("updatedAt", 0), reverse=True))


def clean_history_text(text):
    """Drop harness reminders/tool scaffolding so the lens shows real dialogue."""
    value = str(text or "").replace("\r\n", "\n").strip()
    if not value:
        return ""
    if value.startswith("<") or value.startswith("# AGENTS.md instructions"):
        return ""
    if value.startswith("Caveat:") and "local commands" in value[:160]:
        return ""
    return value


def history_turn(role, text):
    value = clean_history_text(text)
    if role in ("user", "assistant") and value:
        return {"role": role, "text": value[:8000]}
    return None


def opencode_history(session_id):
    database = Path(os.environ.get("OPENCODE_DB", str(HOME / ".local" / "share" / "opencode" / "opencode.db")))
    if not database.exists() or not re.fullmatch(r"[A-Za-z0-9_.-]+", session_id):
        return []
    try:
        connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True, timeout=2)
        rows = connection.execute(
            "select m.id, m.data, p.data from message m "
            "left join part p on p.message_id = m.id "
            "where m.session_id = ? order by m.time_created asc, p.time_created asc",
            (session_id,),
        ).fetchall()
        connection.close()
    except (OSError, sqlite3.Error):
        return []
    turns = []
    current_id, current_role, current_parts = None, "", []
    for message_id, message_data, part_data in rows:
        if not message_id:
            continue
        if current_id is not None and message_id != current_id:
            turn = history_turn(current_role, "\n".join(current_parts))
            if turn:
                turns.append(turn)
            current_parts = []
        if current_id != message_id:
            try:
                current_role = str(json.loads(message_data).get("role") or "")
            except (json.JSONDecodeError, TypeError, AttributeError):
                current_role = ""
            current_id = message_id
        if part_data:
            try:
                part = json.loads(part_data)
            except (json.JSONDecodeError, TypeError):
                part = {}
            # Reasoning parts are internal; only text parts belong on the lens.
            if isinstance(part, dict) and part.get("type") == "text" and isinstance(part.get("text"), str):
                current_parts.append(part["text"])
    turn = history_turn(current_role, "\n".join(current_parts))
    if turn:
        turns.append(turn)
    return turns[-400:]


def claude_history(session_id):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", session_id):
        return []
    path = None
    for root in claude_session_roots():
        try:
            matches = list(root.rglob(f"{session_id}.jsonl"))
        except OSError:
            matches = []
        if matches:
            path = matches[0]
            break
    if path is None:
        return []
    turns = []
    for record in read_json_lines(path, 2_000_000):
        role = str(record.get("type") or "")
        if role not in ("user", "assistant"):
            continue
        message = record.get("message") or {}
        if not isinstance(message, dict):
            continue
        turn = history_turn(role, message_text(message.get("content")))
        if turn:
            turns.append(turn)
    return turns[-400:]


def codex_history(session_id):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", session_id):
        return []
    root = Path(os.environ.get("CODEX_HOME", str(HOME / ".codex"))) / "sessions"
    try:
        paths = list(root.rglob("rollout-*.jsonl"))
    except OSError:
        return []
    # Codex rollout filenames carry the session UUID; use that before scanning
    # every file so resuming stays fast even with a large history.
    path = next((candidate for candidate in paths if session_id in candidate.name), None)
    if path is None:
        for candidate in paths:
            for record in read_json_lines(candidate, 96_000):
                payload = record.get("payload") or record
                if str(payload.get("id") or payload.get("session_id") or "") == session_id:
                    path = candidate
                    break
            if path:
                break
    if path is None:
        return []
    turns = []
    for record in read_json_lines(path, 2_000_000):
        payload = record.get("payload") or record
        if payload.get("type") != "message":
            continue
        role = str(payload.get("role") or "")
        blocks = payload.get("content") or []
        parts = []
        if isinstance(blocks, list):
            for block in blocks:
                if isinstance(block, dict) and isinstance(block.get("text"), str):
                    parts.append(block["text"])
        turn = history_turn(role, "\n".join(parts))
        if turn:
            turns.append(turn)
    return turns[-400:]


def session_history(agent, session_id):
    if agent in ("claude", "nclaude"):
        return claude_history(session_id)
    if agent == "codex":
        return codex_history(session_id)
    if agent == "opencode":
        return opencode_history(session_id)
    return []


def opencode_model_history():
    database = Path(os.environ.get("OPENCODE_DB", str(HOME / ".local" / "share" / "opencode" / "opencode.db")))
    if not database.exists():
        return []
    try:
        connection = sqlite3.connect(f"file:{database}?mode=ro", uri=True, timeout=2)
        rows = connection.execute(
            "select distinct model from session where model is not null and model != '' order by time_updated desc limit 30"
        ).fetchall()
        connection.close()
    except (OSError, sqlite3.Error):
        return []
    models = []
    for row in rows:
        if not row or not row[0]:
            continue
        value = str(row[0])
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError:
            decoded = None
        if isinstance(decoded, dict):
            model_id = str(decoded.get("id") or "")
            provider_id = str(decoded.get("providerID") or "")
            value = f"{provider_id}/{model_id}" if provider_id and model_id else model_id
        if value and value not in models:
            models.append(value)
    return models


def opencode_config_models():
    found = []
    paths = (
        HOME / ".config" / "opencode" / "opencode.json",
        HOME / ".config" / "opencode" / "opencode.jsonc",
        HOME / ".opencode" / "opencode.json",
        HOME / ".opencode" / "opencode.jsonc",
    )
    for path in paths:
        try:
            source = path.read_text()
        except OSError:
            continue
        source = re.sub(r"(?m)^\s*//.*$", "", source)
        source = re.sub(r",\s*([}\]])", r"\1", source)
        try:
            config = json.loads(source)
        except json.JSONDecodeError:
            continue
        selected = config.get("model")
        if isinstance(selected, str) and selected not in found:
            found.append(selected)
        providers = config.get("provider") or {}
        if isinstance(providers, dict):
            for provider_id, provider in providers.items():
                if not isinstance(provider, dict) or not isinstance(provider.get("models"), dict):
                    continue
                for model_id in provider["models"]:
                    value = f"{provider_id}/{model_id}"
                    if value not in found:
                        found.append(value)
    return found[:120]


def normalized_session(agent, item, fallback_id="", fallback_cwd=""):
    if not isinstance(item, dict):
        return None
    session_id = str(item.get("id") or item.get("sessionId") or item.get("session_id") or fallback_id)
    if not session_id:
        return None
    title = item.get("title") or item.get("name") or item.get("prompt") or session_id[:10]
    time_value = item.get("time") if isinstance(item.get("time"), dict) else {}
    updated = item.get("updatedAt") or item.get("updated_at") or item.get("modified") or item.get("created") or item.get("lastUpdated") or time_value.get("updated") or 0
    if isinstance(updated, str):
        try:
            updated = int(datetime.datetime.fromisoformat(updated.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            updated = 0
    elif isinstance(updated, (int, float)) and 0 < updated < 100000000000:
        updated = int(updated * 1000)
    cwd = str(item.get("cwd") or item.get("workDir") or item.get("workingDirectory") or item.get("directory") or fallback_cwd)
    return {"id": session_id, "agent": agent, "title": display_title(str(title), session_id[:10]), "updatedAt": int(updated or 0), "cwd": cwd}


def record_title(records, fallback):
    for record in records:
        if not isinstance(record, dict):
            continue
        candidate = record.get("title") or record.get("prompt") or record.get("message") or record.get("content") or record.get("text") or record.get("displayContent")
        value = message_text(candidate)
        if value:
            return display_title(value, fallback)
    return fallback


def kimi_sessions():
    roots = []
    configured = os.environ.get("KIMI_CODE_HOME", "").strip()
    if configured:
        roots.append(Path(configured).expanduser())
    roots.extend([HOME / ".kimi-code", HOME / ".kimi"])
    found = {}
    for root in roots:
        index = root / "session_index.jsonl"
        for item in read_json_lines(index, 512000):
            session_id = str(item.get("sessionId") or item.get("id") or "")
            if not session_id:
                continue
            session_dir = Path(str(item.get("sessionDir") or ""))
            if not session_dir.is_absolute():
                session_dir = root / session_dir
            state_path = session_dir / "state.json"
            state = {}
            try:
                state = json.loads(state_path.read_text())
            except (OSError, json.JSONDecodeError):
                pass
            merged = {**item, **state, "id": session_id}
            session = normalized_session("kimi", merged)
            if session:
                found[session["id"]] = session
        for sessions_root in (root / "sessions", root / "data" / "sessions"):
            if not sessions_root.exists():
                continue
            try:
                state_paths = list(sessions_root.glob("*/*/state.json"))
            except OSError:
                state_paths = []
            for state_path in state_paths[:100]:
                try:
                    state = json.loads(state_path.read_text())
                except (OSError, json.JSONDecodeError):
                    continue
                session = normalized_session("kimi", {**state, "id": state.get("sessionId") or state_path.parent.name})
                if session:
                    found[session["id"]] = session
    return sorted(found.values(), key=lambda item: item.get("updatedAt", 0), reverse=True)[:40]


def transcript_sessions(agent, roots, pattern):
    found = {}
    for root in roots:
        if not root.exists():
            continue
        try:
            paths = session_slice(sorted(root.rglob(pattern), key=lambda item: item.stat().st_mtime, reverse=True))
        except OSError:
            paths = []
        for path in paths:
            records = read_json_lines(path, 512000)
            if not records:
                continue
            first = records[0] if isinstance(records[0], dict) else {}
            session_id = str(first.get("sessionId") or first.get("session_id") or first.get("id") or path.stem)
            metadata = first.get("metadata") if isinstance(first.get("metadata"), dict) else {}
            cwd = str(first.get("cwd") or first.get("workDir") or metadata.get("cwd") or metadata.get("workDir") or "")
            updated = 0
            try:
                updated = int(path.stat().st_mtime * 1000)
            except OSError:
                pass
            session = {"id": session_id, "agent": agent, "title": record_title(records, session_id[:10]), "updatedAt": updated, "cwd": cwd}
            found[session_id] = session
    return session_slice(sorted(found.values(), key=lambda item: item.get("updatedAt", 0), reverse=True))


def codewhale_sessions():
    root = Path(os.environ.get("CODEWHALE_HOME", str(HOME / ".codewhale"))).expanduser()
    return transcript_sessions("codewhale", [root], "session*.jsonl*")


def dsh_sessions():
    roots = []
    configured = os.environ.get("DSH_HOME", "").strip()
    if configured:
        roots.append(Path(configured).expanduser())
    roots.extend([HOME / ".dsh", HOME / ".deepseek", HOME / ".deepseek-harness"])
    return transcript_sessions("dsh", roots, "session*.jsonl*")


def gemini_sessions():
    roots = []
    configured = os.environ.get("GEMINI_DATA_DIR", "").strip() or os.environ.get("GEMINI_CLI_HOME", "").strip()
    if configured:
        roots.append(Path(configured).expanduser())
    roots.extend([HOME / ".gemini", HOME / ".cache" / ".gemini"])
    return transcript_sessions("gemini", [root / "tmp" for root in roots], "session-*.json*")


def cli_sessions(agent):
    binary = command_path(agent)
    if not binary:
        return []
    args_list = SESSION_LIST_COMMANDS.get(agent, (("session", "list", "--format", "json"), ("session", "list", "--json")))
    candidates = [[binary, *args] for args in args_list]
    deadline = time.monotonic() + SESSION_COMMAND_TIMEOUT
    for command in candidates:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        process = None
        try:
            process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                cwd=HOME,
                start_new_session=True,
            )
            stdout, stderr = process.communicate(timeout=remaining)
            result = subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
        except subprocess.TimeoutExpired:
            if process is not None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except (OSError, ProcessLookupError):
                    pass
                try:
                    process.communicate(timeout=1)
                except (OSError, subprocess.SubprocessError):
                    pass
            break
        except (OSError, subprocess.SubprocessError):
            continue
        if result.returncode != 0:
            continue
        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
            continue
        values = data if isinstance(data, list) else data.get("sessions", []) if isinstance(data, dict) else []
        out = []
        for item in values:
            if not isinstance(item, dict):
                continue
            sid = str(item.get("id") or item.get("sessionID") or item.get("session_id") or "")
            if not sid:
                continue
            title = item.get("title") or item.get("name") or sid[:10]
            updated = item.get("updatedAt") or item.get("modified") or item.get("created") or item.get("time", {}).get("updated") or 0
            if isinstance(updated, str):
                try:
                    parsed = datetime.datetime.fromisoformat(updated.replace("Z", "+00:00"))
                    updated = int(parsed.timestamp() * 1000)
                except ValueError:
                    updated = 0
            elif isinstance(updated, (int, float)) and 0 < updated < 100000000000:
                updated = int(updated * 1000)
            cwd = str(item.get("cwd") or item.get("directory") or "")
            out.append({"id": sid, "agent": agent, "title": display_title(str(title), sid[:10]), "updatedAt": int(updated or 0), "cwd": cwd})
        if out:
            return session_slice(out)
    return []


def saved_sessions():
    jobs = {
        "claude": claude_sessions,
        "codex": codex_sessions,
        "opencode": opencode_sessions,
        "ghost": lambda: cli_sessions("ghost"),
        "codewhale": lambda: cli_sessions("codewhale") or codewhale_sessions(),
        "dsh": lambda: cli_sessions("dsh") or dsh_sessions(),
        "kimi": lambda: cli_sessions("kimi") or kimi_sessions(),
        "gemini": lambda: cli_sessions("gemini") or gemini_sessions(),
        "cline": lambda: cli_sessions("cline"),
    }
    found = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(jobs)) as executor:
        pending = {executor.submit(job): agent for agent, job in jobs.items()}
        for future in concurrent.futures.as_completed(pending):
            try:
                values = future.result()
            except Exception:
                values = []
            for item in values:
                if not isinstance(item, dict) or not item.get("id"):
                    continue
                key = (str(item.get("agent") or pending[future]), str(item["id"]))
                if key not in found or item.get("updatedAt", 0) > found[key].get("updatedAt", 0):
                    found[key] = item
    return session_slice(sorted(found.values(), key=lambda item: item.get("updatedAt", 0), reverse=True))


def default_workdir():
    for session in saved_sessions():
        candidate = Path(str(session.get("cwd") or "")).expanduser()
        if candidate.is_dir():
            return candidate.resolve()
    return HOME


def clean_model_lines(text):
    values = []
    for line in text.splitlines():
        line = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", line).strip()
        if not line or len(line) > 240:
            continue
        provider_ids = re.findall(r"[A-Za-z0-9_.+-]+(?:/[A-Za-z0-9_.:+\[\]-]+)+", line)
        if provider_ids:
            values.extend(provider_ids)
            continue
        line = re.sub(r"^[*+>\-\s]+", "", line)
        if len(line) > 100 or re.search(r"(available models|models available|usage:|warning:|model id|select model)", line, re.I):
            continue
        if re.fullmatch(r"[A-Za-z0-9_./:@+\[\]-]+", line):
            values.append(line)
    unique = []
    for value in values:
        if value not in unique:
            unique.append(value)
    return unique[:120]


def codex_app_server_models(binary):
    process = None
    try:
        process = subprocess.Popen(
            [binary, "app-server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            cwd=HOME,
            env=process_environment(),
            bufsize=1,
        )
        if not process.stdin or not process.stdout:
            return []

        def exchange(message, expected_id, timeout=8):
            process.stdin.write(json.dumps(message, separators=(",", ":")) + "\n")
            process.stdin.flush()
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                ready, _, _ = select.select([process.stdout], [], [], max(0, deadline - time.monotonic()))
                if not ready:
                    break
                line = process.stdout.readline()
                if not line:
                    break
                try:
                    incoming = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if incoming.get("id") == expected_id:
                    return incoming.get("result") or {}
            return {}

        initialized = exchange({
            "id": 1,
            "method": "initialize",
            "params": {
                "clientInfo": {"name": "capri", "title": "Capri", "version": "0.1.0"},
                "capabilities": {
                    "experimentalApi": True,
                    "requestAttestation": False,
                    "mcpServerOpenaiFormElicitation": True,
                },
            },
        }, 1)
        if not initialized:
            return []
        process.stdin.write(json.dumps({"method": "initialized"}, separators=(",", ":")) + "\n")
        process.stdin.flush()
        result = exchange({"id": 2, "method": "model/list", "params": {"includeHidden": False}}, 2, 14)
        models = result.get("data") or result.get("models") or []
        if isinstance(models, list):
            values = []
            for model in models:
                if not isinstance(model, dict):
                    continue
                model_id = model.get("id") or model.get("model") or model.get("slug")
                if model_id:
                    values.append(str(model_id))
            return list(dict.fromkeys(values))[:40]
        return []
    except (OSError, subprocess.SubprocessError, ValueError, TypeError):
        return []
    finally:
        if process:
            try:
                process.terminate()
                process.wait(timeout=1)
            except (OSError, subprocess.SubprocessError):
                try:
                    process.kill()
                except OSError:
                    pass


def model_list(agent):
    global MODEL_CACHE_LOADED
    cached = MODEL_CACHE.get(agent)
    if cached and time.monotonic() - cached[0] < MODEL_CACHE_TTL:
        return cached[1]
    if not MODEL_CACHE_LOADED:
        MODEL_CACHE_LOADED = True
        try:
            saved = json.loads(MODEL_CACHE_PATH.read_text())
            if isinstance(saved, dict):
                for key, values in saved.items():
                    if isinstance(values, list) and all(isinstance(value, str) for value in values):
                        MODEL_CACHE[key] = (time.monotonic(), values[:120])
        except (OSError, json.JSONDecodeError):
            pass
        cached = MODEL_CACHE.get(agent)
        if cached:
            return cached[1]
    if agent == "claude":
        MODEL_CACHE[agent] = (time.monotonic(), FALLBACK_MODELS[agent])
        return FALLBACK_MODELS[agent]
    binary = command_path(agent)
    if not binary:
        return []
    if agent == "codex":
        models = codex_app_server_models(binary)
    elif agent == "opencode":
        models = opencode_config_models()
        models.extend(model for model in opencode_model_history() if model not in models)
        if not models:
            try:
                result = subprocess.run([binary, "models"], capture_output=True, text=True, timeout=12, cwd=HOME, env=process_environment())
                models = clean_model_lines(result.stdout)
            except (OSError, subprocess.SubprocessError):
                models = []
    else:
        try:
            result = subprocess.run([binary, "models"], capture_output=True, text=True, timeout=12, cwd=HOME, env=process_environment())
            models = clean_model_lines(result.stdout)
        except (OSError, subprocess.SubprocessError):
            models = []
    if not models:
        models = FALLBACK_MODELS.get(agent, [])
    MODEL_CACHE[agent] = (time.monotonic(), models)
    if models:
        try:
            with MODEL_CACHE_LOCK:
                saved = {}
                try:
                    current = json.loads(MODEL_CACHE_PATH.read_text())
                    if isinstance(current, dict):
                        saved = {key: value for key, value in current.items() if isinstance(value, list)}
                except (OSError, json.JSONDecodeError):
                    pass
                saved[agent] = models
                MODEL_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
                temporary = MODEL_CACHE_PATH.with_suffix(".tmp")
                temporary.write_text(json.dumps(saved, ensure_ascii=False, separators=(",", ":")))
                temporary.chmod(0o600)
                temporary.replace(MODEL_CACHE_PATH)
        except OSError:
            pass
    return models


def build_agent_command(agent, runtime, model, resume_id):
    runner = runtime if agent == "claude" and runtime in ("claude", "nclaude") else agent
    if runner not in AGENT_COMMAND:
        raise ValueError("Unsupported agent runtime")
    binary = command_path(runner)
    if not binary:
        raise ValueError(f"{AGENT_NAMES.get(runner, runner)} is not installed on {DEVICE}")
    capri = shutil.which("capri")
    command = [capri, runner] if capri else [binary]
    if runner in ("claude", "nclaude"):
        if resume_id:
            command.extend(["--resume", resume_id])
        if model:
            command.extend(["--model", model])
    elif runner == "codex":
        if resume_id:
            command.extend(["resume", resume_id])
            command.append("--no-alt-screen")
        else:
            command.append("--no-alt-screen")
        if model:
            command.extend(["--model", model])
    elif runner == "opencode":
        if resume_id:
            command.extend(["--session", resume_id])
        if model:
            command.extend(["--model", model])
    elif runner == "ghost":
        if resume_id:
            command.extend(["--session", resume_id])
    elif runner in ("codewhale", "dsh"):
        if runner == "codewhale":
            command.extend(["--mode", "agent"])
        else:
            command.extend(["--profile", "tui"])
        if resume_id:
            command.extend(["--resume", resume_id])
        if model:
            command.extend(["--model", model])
    elif runner == "kimi":
        if resume_id:
            command.extend(["--session", resume_id])
        if model:
            command.extend(["--model", model])
    elif runner == "gemini":
        if resume_id:
            command.extend(["--resume", resume_id])
        if model:
            command.extend(["--model", model])
    elif runner == "cline":
        command.append("--tui")
        if resume_id:
            command.extend(["--id", resume_id])
        if model:
            command.extend(["--model", model])
    return command, runner


def build_tailscale_ssh_command(target, username):
    if not re.fullmatch(r"[a-z_][a-z0-9_-]{0,31}", username):
        raise ValueError("Enter a valid Linux or macOS account name")
    if not re.fullmatch(r"[A-Za-z0-9_. -]{1,120}", target):
        raise ValueError("Invalid Tailscale device")
    binary = shutil.which("tailscale")
    if not binary:
        raise RuntimeError("Tailscale CLI is not available on this controller")
    devices = tailscale_devices()
    match = next((
        device for device in devices
        if target.casefold() in {
            str(device.get("name") or "").casefold(),
            str(device.get("dnsName") or "").casefold(),
            str(device.get("ip") or "").casefold(),
        }
    ), None)
    if not match or not match.get("online"):
        raise ValueError("That Tailscale device is not online or visible to this controller")
    if str(match.get("name", "")).casefold() == DEVICE.casefold():
        raise ValueError("Use the local terminal for this controller")
    host = str(match.get("dnsName") or match.get("name") or "")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,253}", host):
        raise ValueError("Tailscale did not return a valid device name")
    return [binary, "ssh", f"{username}@{host}"]


def create_managed_session(command, kind, agent, runtime, title, saved_id="", cwd=None):
    reap_finished_sessions()
    duplicates = []
    with SESSION_LOCK:
        if saved_id:
            duplicates = [session for session in SESSIONS.values() if session.saved_id == saved_id and not session.done]
            for session in duplicates:
                SESSIONS.pop(session.id, None)
        active = [session for session in SESSIONS.values() if not session.done]
        if len(active) >= MAX_SESSIONS:
            raise RuntimeError(f"Close a session before opening another ({len(active)} active)")
    for session in duplicates:
        session.stop()
    master_fd, slave_fd = pty.openpty()
    try:
        fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
        env = os.environ.copy()
        env["HOME"] = str(HOME)
        env["PATH"] = os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin")
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"
        if kind == "terminal" and not command:
            shell = shutil.which("bash") or "/bin/sh"
            env["SHELL"] = shell
            env["PS1"] = f"{DEVICE}:\\w\\$ "
            command = [shell, "--noprofile", "--norc", "-i"] if Path(shell).name == "bash" else [shell, "-i"]
        script = shutil.which("script")
        launch = [script, "-qefc", shlex.join(command), "/dev/null"] if script else command
        process = subprocess.Popen(
            launch,
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            cwd=str(cwd or HOME),
            env=env,
            start_new_session=True,
            close_fds=True,
        )
    except Exception:
        os.close(master_fd)
        raise
    finally:
        try:
            os.close(slave_fd)
        except OSError:
            pass
    managed = ManagedSession(process, master_fd, kind, agent, runtime, title, saved_id)
    with SESSION_LOCK:
        SESSIONS[managed.id] = managed
    return managed


def process_environment():
    env = os.environ.copy()
    env["HOME"] = str(HOME)
    return env


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "Capri/0.2"
    protocol_version = "HTTP/1.1"

    def log_message(self, format_string, *args):
        if self.path.startswith("/api/v1/"):
            print(f"{self.client_address[0]} {format_string % args}", flush=True)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Last-Event-ID")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def authenticate(self):
        header = self.headers.get("Authorization", "")
        offered = header[7:] if header.lower().startswith("bearer ") else ""
        return bool(TOKEN) and hmac.compare_digest(offered.encode(), TOKEN.encode())

    def do_GET(self):
        if not self.authenticate():
            self.send_json(401, {"error": "Authentication required"})
            return
        parsed = urlparse(self.path)
        if parsed.path == "/api/v1/health":
            self.send_json(200, {"status": "ok", "device": DEVICE})
        elif parsed.path == "/api/v1/devices":
            self.send_json(200, {"devices": tailscale_devices(), "controllers": [DEVICE]})
        elif parsed.path == "/api/v1/agents":
            self.send_json(200, {"device": DEVICE, "agents": available_agents()})
        elif parsed.path == "/api/v1/sessions":
            self.send_json(200, {"sessions": saved_sessions()})
        elif parsed.path == "/api/v1/models":
            agent = parse_qs(parsed.query).get("agent", [""])[0]
            if agent not in AGENT_NAMES:
                self.send_json(400, {"error": "Unknown agent"})
            else:
                self.send_json(200, {"agent": agent, "models": model_list(agent)})
        elif re.fullmatch(r"/api/v1/sessions/[A-Za-z0-9_.-]+/history", parsed.path):
            session_id = parsed.path.split("/")[4]
            agent = parse_qs(parsed.query).get("agent", [""])[0]
            if agent not in AGENT_NAMES:
                self.send_json(400, {"error": "Unknown agent"})
            else:
                self.send_json(200, {"agent": agent, "history": session_history(agent, session_id)})
        elif parsed.path.startswith("/api/v1/sessions/") and parsed.path.endswith("/events"):
            self.stream_session(parsed.path.split("/")[4])
        else:
            self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        if not self.authenticate():
            self.send_json(401, {"error": "Authentication required"})
            return
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/v1/sessions":
                data = self.read_json()
                agent = str(data.get("agent", ""))
                if agent not in AGENT_NAMES:
                    self.send_json(*api_error("Unknown agent"))
                    return
                runtime = str(data.get("runtime") or agent)
                model = str(data.get("model") or "")[:120]
                resume_id = str(data.get("resume_id") or "")[:200]
                cwd = str(data.get("cwd") or "")
                if resume_id and not re.fullmatch(r"[A-Za-z0-9_.-]+", resume_id):
                    self.send_json(*api_error("Invalid session ID"))
                    return
                existing = active_saved_session(resume_id)
                if existing:
                    self.send_json(200, {"id": existing.id, "session_id": resume_id, "title": existing.title, "reused": True})
                    return
                command, runner = build_agent_command(agent, runtime, model, resume_id)
                title = f"{AGENT_NAMES[agent]} / {DEVICE}"
                workdir = Path(cwd).expanduser().resolve() if cwd else default_workdir()
                if not workdir.is_dir():
                    workdir = HOME
                session = create_managed_session(command, "agent", agent, runner, title, resume_id, cwd=workdir)
                self.send_json(201, {"id": session.id, "session_id": resume_id, "title": title})
            elif parsed.path == "/api/v1/terminal":
                data = self.read_json()
                target = str(data.get("target") or "")[:253]
                if target:
                    username = str(data.get("username") or "")[:32]
                    command = build_tailscale_ssh_command(target, username)
                    title = f"SSH / {target}"
                else:
                    command = []
                    title = f"Terminal / {DEVICE}"
                session = create_managed_session(command, "terminal", "terminal", "shell", title)
                self.send_json(201, {"id": session.id, "title": session.title, "target": target or DEVICE})
            elif re.fullmatch(r"/api/v1/sessions/[a-f0-9]{16}/input", parsed.path):
                session_id = parsed.path.split("/")[4]
                session = self.get_session(session_id)
                if not session:
                    self.send_json(404, {"error": "Session not found"})
                    return
                data = self.read_json()
                text = str(data.get("text", ""))
                if not text or len(text) > 12000:
                    self.send_json(*api_error("Input is empty or too long"))
                    return
                print(f"Capri input -> {session.agent}/{session.saved_id or session.id}: {text.strip()[:160]!r}", flush=True)
                # A TUI reads one PTY write as a paste. If the trailing newline
                # arrives inside that paste it is inserted as text, not treated
                # as Enter, so the message sits in the composer forever. Send
                # the body and the Enter keystroke as separate writes.
                payload = text.rstrip("\r\n")
                before = session.recent_output()
                print(f"Capri prompt before input: {before!r}", flush=True)
                session.write(payload)
                time.sleep(0.12)
                session.write("\r")
                time.sleep(0.25)
                after = session.recent_output()
                print(f"Capri prompt after input: {after!r}", flush=True)
                self.send_json(200, {"accepted": True})
            elif re.fullmatch(r"/api/v1/sessions/[a-f0-9]{16}/model", parsed.path):
                session_id = parsed.path.split("/")[4]
                session = self.get_session(session_id)
                if not session or session.kind != "agent":
                    self.send_json(404, {"error": "Agent session not found"})
                    return
                data = self.read_json()
                model = str(data.get("model", ""))[:120]
                session.write(f"/model {model}\n")
                self.send_json(200, {"accepted": True})
            elif re.fullmatch(r"/api/v1/sessions/[a-f0-9]{16}/approval", parsed.path):
                session_id = parsed.path.split("/")[4]
                session = self.get_session(session_id)
                if not session or session.kind != "agent":
                    self.send_json(404, {"error": "Agent session not found"})
                    return
                data = self.read_json()
                choice = str(data.get("choice", ""))
                with session.changed:
                    if not session.approval:
                        self.send_json(409, {"error": "No pending approval"})
                        return
                    keystrokes = approval_keystrokes(session, choice)
                    session.approval = None
                    session.text_tail = ""
                    session.sequence += 1
                    session.events.append((session.sequence, {"approval": None}))
                    session.changed.notify_all()
                session.write(keystrokes)
                self.send_json(200, {"accepted": True, "choice": choice})
            elif parsed.path == "/api/v1/transcribe":
                audio, filename, content_type = self.read_multipart()
                token = STT_TOKEN_FILE.read_text().strip() if STT_TOKEN_FILE.exists() else ""
                if not token:
                    self.send_json(503, {"error": "STT token is not configured"})
                    return
                result = self.transcribe(audio, filename, content_type, token)
                self.send_json(200, result)
            else:
                self.send_json(404, {"error": "Not found"})
        except (ValueError, RuntimeError) as error:
            self.send_json(*api_error(error, 400))
        except Exception as error:
            print(f"Capri request failed: {type(error).__name__}: {error}", flush=True)
            self.send_json(500, {"error": "Capri service failed"})

    def do_DELETE(self):
        if not self.authenticate():
            self.send_json(401, {"error": "Authentication required"})
            return
        match = re.fullmatch(r"/api/v1/sessions/([a-f0-9]{16})", urlparse(self.path).path)
        if not match:
            self.send_json(404, {"error": "Not found"})
            return
        session_id = match.group(1)
        session = self.get_session(session_id)
        if not session:
            self.send_json(404, {"error": "Session not found"})
            return
        session.stop()
        with SESSION_LOCK:
            SESSIONS.pop(session_id, None)
        self.send_json(200, {"closed": True})

    def read_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("Invalid content length")
        if length < 0 or length > MAX_BODY:
            raise ValueError("Request is too large")
        return self.rfile.read(length)

    def read_json(self):
        try:
            return json.loads(self.read_body() or b"{}")
        except json.JSONDecodeError as error:
            raise ValueError("Invalid JSON") from error

    def read_multipart(self):
        import email
        import email.policy

        content_type = self.headers.get("Content-Type", "")
        if not content_type.lower().startswith("multipart/form-data"):
            raise ValueError("Expected a multipart audio upload")
        raw = self.read_body()
        message = email.message_from_bytes(
            b"Content-Type: " + content_type.encode() + b"\r\nMIME-Version: 1.0\r\n\r\n" + raw,
            policy=email.policy.default,
        )
        for part in message.iter_parts():
            disposition = part.get_content_disposition()
            if disposition == "form-data" and part.get_param("name", header="content-disposition") == "file":
                payload = part.get_payload(decode=True) or b""
                if not payload:
                    raise ValueError("Audio file is empty")
                return payload, part.get_filename() or "capri.wav", part.get_content_type()
        raise ValueError("Audio file is missing")

    def transcribe(self, audio, filename, content_type, token):
        boundary = "----capri" + uuid.uuid4().hex
        body = bytearray()
        body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\ng2-stt\r\n".encode())
        body.extend(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{Path(filename).name}\"\r\nContent-Type: {content_type}\r\n\r\n".encode()
        )
        body.extend(audio)
        body.extend(f"\r\n--{boundary}--\r\n".encode())
        request = urllib.request.Request(
            STT_URL,
            data=bytes(body),
            headers={"Authorization": f"Bearer {token}", "Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as error:
            raise RuntimeError("STT service is unavailable") from error

    def stream_session(self, session_id):
        session = self.get_session(session_id)
        if not session:
            self.send_json(404, {"error": "Session not found"})
            return
        try:
            cursor = int(self.headers.get("Last-Event-ID", "0"))
        except ValueError:
            cursor = 0
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        heartbeat = time.monotonic()
        while True:
            with session.changed:
                batch = [(number, text) for number, text in session.events if number > cursor]
                done = session.done
                if not batch and not done:
                    session.changed.wait(timeout=1.0)
                    batch = [(number, text) for number, text in session.events if number > cursor]
                    done = session.done
            for number, payload in batch:
                cursor = number
                if (
                    session.agent == "codex"
                    and isinstance(payload, dict)
                    and isinstance(payload.get("text"), str)
                    and codex_update_prompt_output(payload["text"])
                ):
                    continue
                frame = f"id: {number}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
                try:
                    self.wfile.write(frame.encode("utf-8"))
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, OSError):
                    return
            if done and not batch:
                return
            if time.monotonic() - heartbeat > 15:
                try:
                    self.wfile.write(b": heartbeat\n\n")
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError, OSError):
                    return
                heartbeat = time.monotonic()

    def send_json(self, code, value):
        payload = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    @staticmethod
    def get_session(session_id):
        with SESSION_LOCK:
            return SESSIONS.get(session_id)


def main():
    if not TOKEN:
        raise SystemExit("CAPRI_RUNTIME_TOKEN must be set in the service environment")
    os.environ["HOME"] = str(HOME)
    print(f"Capri {DEVICE} listening on {HOST}:{PORT}", flush=True)
    server = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    server.daemon_threads = True
    server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
