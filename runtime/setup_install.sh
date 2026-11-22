#!/usr/bin/env bash
set -euo pipefail

# ┌──────────────────────────────────────────────────────────────────────────┐
# │ CAPRI RUNTIME // LOCAL SESSION BRIDGE                               │
# │ This installs the small local bridge that lets Capri reach agent sessions.│
# └──────────────────────────────────────────────────────────────────────────┘

CAPRI_RAW_BASE="${CAPRI_RAW_BASE:-https://raw.githubusercontent.com/ARCANGEL0/Capri/main}"
CAPRI_SERVER_URL="${CAPRI_SERVER_URL:-$CAPRI_RAW_BASE/Even_G2/server/capri_runtime_server.py}"
CAPRI_PORT="${CAPRI_PORT:-7788}"
CAPRI_SERVE_PORT="${CAPRI_SERVE_PORT:-8447}"
CAPRI_DEVICE="${CAPRI_DEVICE:-$(hostname -s 2>/dev/null || hostname)}"
CAPRI_USER="${CAPRI_USER:-${SUDO_USER:-$(id -un)}}"
CAPRI_SKIP_SERVE="${CAPRI_SKIP_SERVE:-0}"

log() { printf '\033[1;35m[CAPRI]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[CAPRI // CHECK]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[CAPRI // ABORT]\033[0m %s\n' "$*" >&2; exit 1; }

as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then "$@"; else sudo "$@"; fi
}

need() { command -v "$1" >/dev/null 2>&1 || fail "Missing runtime dependency: $1"; }

need python3
need curl
need tailscale

if ! id "$CAPRI_USER" >/dev/null 2>&1; then
  fail "User '$CAPRI_USER' does not exist. Set CAPRI_USER to the account that owns the agent sessions."
fi

USER_HOME="$(eval echo "~$CAPRI_USER")"
if [[ "$(uname -s)" == "Darwin" ]]; then
  USER_PATH="${CAPRI_PATH:-$PATH}"
else
  USER_PATH="$(su -s /bin/sh - "$CAPRI_USER" -c 'printf %s "$PATH"')"
fi
if [[ -z "$USER_PATH" ]]; then USER_PATH="/usr/local/bin:/usr/bin:/bin"; fi

if [[ -n "${CAPRI_TOKEN:-}" ]]; then
  RUNTIME_TOKEN="$CAPRI_TOKEN"
else
  RUNTIME_TOKEN="$(python3 - <<'PY'
import secrets
print(secrets.token_urlsafe(40))
PY
)"
fi

TEMP_SERVER="$(mktemp)"
trap 'rm -f "$TEMP_SERVER"' EXIT
log "Pulling the signed runtime bridge from $CAPRI_SERVER_URL"
curl --fail --silent --show-error --location "$CAPRI_SERVER_URL" --output "$TEMP_SERVER"
python3 -m py_compile "$TEMP_SERVER" || fail "The downloaded runtime bridge did not pass the Python check."

install_linux() {
  local root="/opt/capri-runtime"
  local env_dir="/etc/capri-runtime"
  local env_file="$env_dir/capri-runtime.env"
  local unit="/etc/systemd/system/capri-runtime.service"
  as_root install -d -m 0755 "$root"
  as_root install -o "$CAPRI_USER" -g "$CAPRI_USER" -m 0755 "$TEMP_SERVER" "$root/server.py"
  as_root install -d -m 0700 "$env_dir"
  as_root sh -c "cat > '$env_file' <<EOF
CAPRI_RUNTIME_TOKEN=$RUNTIME_TOKEN
CAPRI_RUNTIME_BIND=127.0.0.1
CAPRI_RUNTIME_PORT=$CAPRI_PORT
CAPRI_RUNTIME_DEVICE=$CAPRI_DEVICE
HOME=$USER_HOME
EOF"
  as_root chmod 0600 "$env_file"
  as_root sh -c "cat > '$unit' <<EOF
[Unit]
Description=Capri Runtime // authenticated coding session bridge
After=network-online.target tailscaled.service
Wants=network-online.target
Requires=tailscaled.service

[Service]
Type=simple
User=$CAPRI_USER
Group=$CAPRI_USER
WorkingDirectory=$USER_HOME
Environment=HOME=$USER_HOME
Environment=PATH=$USER_PATH
EnvironmentFile=$env_file
ExecStart=/usr/bin/python3 $root/server.py
Restart=always
RestartSec=3
UMask=0077
LimitNOFILE=8192

[Install]
WantedBy=multi-user.target
EOF"
  as_root systemctl daemon-reload
  as_root systemctl enable --now capri-runtime.service
}

install_macos() {
  local root="$USER_HOME/Library/Application Support/Capri Runtime"
  local env_dir="$USER_HOME/Library/Application Support/Capri Runtime"
  local env_file="$env_dir/capri-runtime.env"
  local launch_dir="$USER_HOME/Library/LaunchAgents"
  local plist="$launch_dir/com.arcxlo.capri-runtime.plist"
  mkdir -p "$root" "$launch_dir"
  install -m 0755 "$TEMP_SERVER" "$root/server.py"
  cat > "$env_file" <<EOF
CAPRI_RUNTIME_TOKEN=$RUNTIME_TOKEN
CAPRI_RUNTIME_BIND=127.0.0.1
CAPRI_RUNTIME_PORT=$CAPRI_PORT
CAPRI_RUNTIME_DEVICE=$CAPRI_DEVICE
HOME=$USER_HOME
EOF
  chmod 0600 "$env_file"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.arcxlo.capri-runtime</string>
  <key>ProgramArguments</key><array><string>/usr/bin/python3</string><string>$root/server.py</string></array>
  <key>WorkingDirectory</key><string>$USER_HOME</string>
  <key>EnvironmentVariables</key><dict>
    <key>HOME</key><string>$USER_HOME</string>
    <key>PATH</key><string>$USER_PATH</string>
    <key>CAPRI_RUNTIME_TOKEN</key><string>$RUNTIME_TOKEN</string>
    <key>CAPRI_RUNTIME_BIND</key><string>127.0.0.1</string>
    <key>CAPRI_RUNTIME_PORT</key><string>$CAPRI_PORT</string>
    <key>CAPRI_RUNTIME_DEVICE</key><string>$CAPRI_DEVICE</string>
  </dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
</dict></plist>
EOF
  launchctl bootout "gui/$(id -u)/com.arcxlo.capri-runtime" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
}

case "$(uname -s)" in
  Linux) install_linux ;;
  Darwin) install_macos ;;
  *) fail "Capri Runtime currently supports Linux and macOS." ;;
esac

if [[ "$CAPRI_SKIP_SERVE" != "1" ]]; then
  log "Routing the private Tailscale lane to localhost:$CAPRI_PORT"
  if ! tailscale serve --https="$CAPRI_SERVE_PORT" "http://127.0.0.1:$CAPRI_PORT"; then
    warn "The runtime is running, but Tailscale Serve could not be configured automatically."
    warn "Run: tailscale serve --https=$CAPRI_SERVE_PORT http://127.0.0.1:$CAPRI_PORT"
  fi
fi

TAILNET_HOST="$(tailscale status --json 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); s=d.get("Self",{}); print((s.get("DNSName") or s.get("HostName") or "").rstrip("."))' 2>/dev/null || true)"
log "CAPRI RUNTIME ONLINE // $CAPRI_DEVICE"
printf '\nPAIRING DATA\n'
printf '  Device:   %s\n' "$CAPRI_DEVICE"
printf '  Endpoint: https://%s:%s\n' "${TAILNET_HOST:-<tailscale-hostname>}" "$CAPRI_SERVE_PORT"
printf '  Token:    %s\n' "$RUNTIME_TOKEN"
printf '\nPaste this endpoint and token into Capri Setup. Keep the token private.\n'
