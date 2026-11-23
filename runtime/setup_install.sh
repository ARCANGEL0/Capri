#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# ╭──────────────────────────────────────────────────────────────────────────╮
# │ CAPRI RUNTIME // SETUP CHANNEL                                            │
# │ The default path is a per-user service. System scope is opt-in.           │
# ╰──────────────────────────────────────────────────────────────────────────╯

CAPRI_RAW_BASE="${CAPRI_RAW_BASE:-https://raw.githubusercontent.com/ARCANGEL0/Capri/main}"
CAPRI_SERVER_URL="${CAPRI_SERVER_URL:-$CAPRI_RAW_BASE/runtime/capri_runtime_server.py}"
CAPRI_PORT="${CAPRI_PORT:-7788}"
CAPRI_SERVE_PORT="${CAPRI_SERVE_PORT:-8447}"
CAPRI_DEVICE="${CAPRI_DEVICE:-$(hostname -s 2>/dev/null || hostname)}"
CAPRI_USER="${CAPRI_USER:-${SUDO_USER:-$(id -un)}}"
CAPRI_SCOPE="${CAPRI_SCOPE:-}"
CAPRI_SKIP_SERVE="${CAPRI_SKIP_SERVE:-0}"

if [[ -r /dev/tty && -w /dev/tty && -t 1 ]]; then CAPRI_INTERACTIVE=1; else CAPRI_INTERACTIVE=0; fi
if [[ "${CAPRI_NONINTERACTIVE:-0}" == "1" ]]; then CAPRI_INTERACTIVE=0; fi

if (( CAPRI_INTERACTIVE )); then
  RED=$'\033[1;31m'; MAGENTA=$'\033[1;35m'; CYAN=$'\033[1;36m'; GREEN=$'\033[1;32m'
  YELLOW=$'\033[1;33m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  RED=''; MAGENTA=''; CYAN=''; GREEN=''; YELLOW=''; DIM=''; RESET=''
fi

line() { printf '%s\n' "${DIM}────────────────────────────────────────────────────────────────────────────${RESET}"; }
log() { printf '%s\n' "${MAGENTA}[CAPRI]${RESET} $*"; }
step() { printf '%s\n' "${CYAN}[$1]${RESET} $2"; }
ok() { printf '%s\n' "${GREEN}  ✓${RESET} $*"; }
warn() { printf '%s\n' "${YELLOW}  !${RESET} $*" >&2; }
fail() { printf '%s\n' "${RED}  ✕${RESET} $*" >&2; exit 1; }

on_error() {
  local code=$?
  printf '%s\n' "${RED}[CAPRI // ABORT]${RESET} Setup stopped on line ${BASH_LINENO[0]:-unknown} (exit ${code})." >&2
  printf '%s\n' "${DIM}Nothing else was changed after the failed step. Re-run the installer to retry.${RESET}" >&2
  exit "$code"
}
trap on_error ERR

need() { command -v "$1" >/dev/null 2>&1 || fail "Missing dependency: $1. Install it, then run Capri setup again."; }

port_is_available() {
  "$PYTHON_BIN" - "$1" <<'PY'
import socket
import sys

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
    probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        probe.bind(("127.0.0.1", int(sys.argv[1])))
    except (OSError, ValueError):
        raise SystemExit(1)
PY
}

ensure_runtime_port() {
  local suggested='7790'
  if [[ "$CAPRI_PORT" =~ ^[0-9]+$ ]]; then suggested="$((CAPRI_PORT + 1))"; fi
  while ! port_is_available "$CAPRI_PORT"; do
    warn "Runtime port $CAPRI_PORT is already in use."
    (( CAPRI_INTERACTIVE )) || fail "Set CAPRI_PORT to a free local port and run setup again."
    CAPRI_PORT="$(prompt_value 'Free runtime port' "$suggested")"
  done
}

prompt_value() {
  local label="$1" default="$2" answer=''
  if (( CAPRI_INTERACTIVE )); then
    printf '%s' "${CYAN}?${RESET} ${label} ${DIM}[${default}]${RESET}: " > /dev/tty
    IFS= read -r answer </dev/tty || answer=''
  fi
  printf '%s' "${answer:-$default}"
}

confirm() {
  local label="$1" default="${2:-y}" answer=''
  if (( ! CAPRI_INTERACTIVE )); then
    [[ "$default" =~ ^[Yy] ]]
    return
  fi
  printf '%s' "${CYAN}?${RESET} ${label} ${DIM}[${default}]${RESET}: " > /dev/tty
  IFS= read -r answer </dev/tty || answer=''
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]]
}

choose_scope() {
  if [[ "$(uname -s)" == "Darwin" ]]; then CAPRI_SCOPE='user'; return; fi
  if [[ -n "$CAPRI_SCOPE" ]]; then
    [[ "$CAPRI_SCOPE" == 'user' || "$CAPRI_SCOPE" == 'system' ]] || fail 'CAPRI_SCOPE must be user or system.'
    return
  fi
  if (( ! CAPRI_INTERACTIVE )); then CAPRI_SCOPE='user'; return; fi
  printf '\n%s\n' "${CYAN}SERVICE SCOPE${RESET}" > /dev/tty
  printf '%s\n' '  1  User service  · no sudo · recommended' > /dev/tty
  printf '%s\n' '  2  System service · sudo · starts for all logins' > /dev/tty
  local answer=''
  printf '%s' "${CYAN}?${RESET} Choose scope ${DIM}[1]${RESET}: " > /dev/tty
  IFS= read -r answer </dev/tty || answer=''
  case "${answer:-1}" in
    1) CAPRI_SCOPE='user' ;;
    2) CAPRI_SCOPE='system' ;;
    *) fail 'Choose 1 for user scope or 2 for system scope.' ;;
  esac
}

guard_user_scope() {
  if [[ "$CAPRI_SCOPE" == 'user' && "$(id -u)" -eq 0 && "$CAPRI_USER" != "$(id -un)" ]]; then
    fail "User scope must run as $CAPRI_USER. Re-run without sudo, or choose system scope for a root install."
  fi
}

prepare_sudo() {
  ROOT_PREFIX=()
  if [[ "$CAPRI_SCOPE" != 'system' || "$(id -u)" -eq 0 ]]; then return; fi
  need sudo
  if (( CAPRI_INTERACTIVE )); then
    printf '%s\n' "${YELLOW}System scope needs one sudo check to install under /opt and /etc.${RESET}" > /dev/tty
    sudo -v </dev/tty || fail 'sudo authentication failed. Choose user scope to install without root.'
  elif ! sudo -n true 2>/dev/null; then
    fail 'System scope needs cached sudo credentials. Run interactively or set CAPRI_SCOPE=user.'
  fi
  ROOT_PREFIX=(sudo -n)
}

run_root() {
  if ((${#ROOT_PREFIX[@]})); then "${ROOT_PREFIX[@]}" "$@"; else "$@"; fi
}

user_home() {
  local home=''
  if [[ "$(uname -s)" == 'Darwin' ]]; then
    if [[ "$CAPRI_USER" == "$(id -un)" ]]; then home="${HOME:-}"; else home="$(dscl . -read /Users/"$CAPRI_USER" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"; fi
  elif command -v getent >/dev/null 2>&1; then
    home="$(getent passwd "$CAPRI_USER" | cut -d: -f6)"
  fi
  printf '%s' "${home:-$HOME}"
}

service_path() {
  if [[ -n "${CAPRI_PATH:-}" ]]; then printf '%s' "$CAPRI_PATH"; return; fi
  if [[ "$(id -un)" != "$CAPRI_USER" ]] && command -v su >/dev/null 2>&1; then
    local user_path=''
    user_path="$(su -s /bin/sh - "$CAPRI_USER" -c 'printf %s "$PATH"' 2>/dev/null || true)"
    if [[ -n "$user_path" ]]; then printf '%s' "$user_path"; return; fi
  fi
  printf '%s' "${PATH:-/usr/local/bin:/usr/bin:/bin}"
}

install_user_linux() {
  local root="$USER_HOME/.local/share/capri-runtime"
  local unit_dir="$USER_HOME/.config/systemd/user"
  local env_file="$unit_dir/capri-runtime.env"
  local unit="$unit_dir/capri-runtime.service"
  mkdir -p "$root" "$unit_dir"
  install -m 0755 "$TEMP_SERVER" "$root/server.py"
  cat > "$env_file" <<EOF
CAPRI_RUNTIME_TOKEN=$RUNTIME_TOKEN
CAPRI_RUNTIME_BIND=127.0.0.1
CAPRI_RUNTIME_PORT=$CAPRI_PORT
CAPRI_RUNTIME_DEVICE=$CAPRI_DEVICE
CAPRI_RUNTIME_SERVE_PORT=$CAPRI_SERVE_PORT
HOME=$USER_HOME
EOF
  chmod 0600 "$env_file"
  cat > "$unit" <<EOF
[Unit]
Description=Capri Runtime // authenticated coding session bridge
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$USER_HOME
Environment=HOME=$USER_HOME
Environment=PATH=$USER_PATH
EnvironmentFile=$env_file
ExecStart=$PYTHON_BIN $root/server.py
Restart=always
RestartSec=3
UMask=0077
LimitNOFILE=8192

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now capri-runtime.service
  ok 'User service online: capri-runtime'
  if command -v loginctl >/dev/null 2>&1 && confirm 'Keep the service running after logout?' 'n'; then
    if [[ "$(id -u)" -eq 0 ]]; then loginctl enable-linger "$CAPRI_USER" || warn 'Could not enable login linger; the service will run while the user session is active.'
    else warn 'Login linger needs administrator approval; run loginctl enable-linger if you want boot persistence.'; fi
  fi
}

install_system_linux() {
  local root='/opt/capri-runtime' env_dir='/etc/capri-runtime'
  local env_file="$env_dir/capri-runtime.env" unit='/etc/systemd/system/capri-runtime.service'
  local env_tmp unit_tmp
  env_tmp="$(mktemp)"; unit_tmp="$(mktemp)"
  printf 'CAPRI_RUNTIME_TOKEN=%s\nCAPRI_RUNTIME_BIND=127.0.0.1\nCAPRI_RUNTIME_PORT=%s\nCAPRI_RUNTIME_DEVICE=%s\nCAPRI_RUNTIME_SERVE_PORT=%s\nHOME=%s\n' "$RUNTIME_TOKEN" "$CAPRI_PORT" "$CAPRI_DEVICE" "$CAPRI_SERVE_PORT" "$USER_HOME" > "$env_tmp"
  cat > "$unit_tmp" <<EOF
[Unit]
Description=Capri Runtime // authenticated coding session bridge
After=network-online.target tailscaled.service
Wants=network-online.target
Requires=tailscaled.service

[Service]
Type=simple
User=$CAPRI_USER
Group=$CAPRI_GROUP
WorkingDirectory=$USER_HOME
Environment=HOME=$USER_HOME
Environment=PATH=$USER_PATH
EnvironmentFile=$env_file
ExecStart=$PYTHON_BIN $root/server.py
Restart=always
RestartSec=3
UMask=0077
LimitNOFILE=8192

[Install]
WantedBy=multi-user.target
EOF
  run_root install -d -m 0755 "$root"
  run_root install -o "$CAPRI_USER" -g "$CAPRI_GROUP" -m 0755 "$TEMP_SERVER" "$root/server.py"
  run_root install -d -m 0700 "$env_dir"
  run_root install -o root -g root -m 0600 "$env_tmp" "$env_file"
  run_root install -o root -g root -m 0644 "$unit_tmp" "$unit"
  rm -f "$env_tmp" "$unit_tmp"
  run_root systemctl daemon-reload
  run_root systemctl enable --now capri-runtime.service
  ok 'System service online: capri-runtime'
}

install_macos() {
  local root="$USER_HOME/Library/Application Support/Capri Runtime"
  local launch_dir="$USER_HOME/Library/LaunchAgents"
  local plist="$launch_dir/com.arcxlo.capri-runtime.plist"
  mkdir -p "$root" "$launch_dir"
  install -m 0755 "$TEMP_SERVER" "$root/server.py"
  cat > "$root/capri-runtime.env" <<EOF
CAPRI_RUNTIME_TOKEN=$RUNTIME_TOKEN
CAPRI_RUNTIME_BIND=127.0.0.1
CAPRI_RUNTIME_PORT=$CAPRI_PORT
CAPRI_RUNTIME_DEVICE=$CAPRI_DEVICE
CAPRI_RUNTIME_SERVE_PORT=$CAPRI_SERVE_PORT
HOME=$USER_HOME
EOF
  chmod 0600 "$root/capri-runtime.env"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.arcxlo.capri-runtime</string>
  <key>ProgramArguments</key><array><string>$PYTHON_BIN</string><string>$root/server.py</string></array>
  <key>WorkingDirectory</key><string>$USER_HOME</string>
  <key>EnvironmentVariables</key><dict>
    <key>HOME</key><string>$USER_HOME</string>
    <key>PATH</key><string>$USER_PATH</string>
    <key>CAPRI_RUNTIME_TOKEN</key><string>$RUNTIME_TOKEN</string>
    <key>CAPRI_RUNTIME_BIND</key><string>127.0.0.1</string>
    <key>CAPRI_RUNTIME_PORT</key><string>$CAPRI_PORT</string>
    <key>CAPRI_RUNTIME_DEVICE</key><string>$CAPRI_DEVICE</string>
  <key>CAPRI_RUNTIME_SERVE_PORT</key><string>$CAPRI_SERVE_PORT</string>
  </dict>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
</dict></plist>
EOF
  launchctl bootout "gui/$(id -u)/com.arcxlo.capri-runtime" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  ok 'User service online: capri-runtime'
}

install_cli() {
  local bin_dir cli_path pairing_dir pairing_file pairing_tmp
  local q_pairing q_scope q_user q_service q_python
  pairing_dir="$USER_HOME/.config/capri-runtime"
  pairing_file="$pairing_dir/pairing.env"
  if [[ "$CAPRI_SCOPE" == 'system' && "$(uname -s)" == 'Linux' ]]; then
    bin_dir='/usr/local/bin'
  else
    bin_dir="$USER_HOME/.local/bin"
  fi
  cli_path="$bin_dir/capri-runtime"
  pairing_tmp="$(mktemp)"
  printf 'CAPRI_RUNTIME_TOKEN=%s\nCAPRI_RUNTIME_DEVICE=%s\nCAPRI_RUNTIME_PORT=%s\nCAPRI_RUNTIME_SERVE_PORT=%s\n' "$RUNTIME_TOKEN" "$CAPRI_DEVICE" "$CAPRI_PORT" "$CAPRI_SERVE_PORT" > "$pairing_tmp"
  if [[ "$CAPRI_SCOPE" == 'system' && "$(uname -s)" == 'Linux' ]]; then
    run_root install -d -o "$CAPRI_USER" -g "$CAPRI_GROUP" -m 0700 "$pairing_dir"
    run_root install -o "$CAPRI_USER" -g "$CAPRI_GROUP" -m 0600 "$pairing_tmp" "$pairing_file"
  else
    mkdir -p "$bin_dir" "$pairing_dir"
    install -m 0600 "$pairing_tmp" "$pairing_file"
  fi
  rm -f "$pairing_tmp"
  printf -v q_pairing '%q' "$pairing_file"
  printf -v q_scope '%q' "$CAPRI_SCOPE"
  printf -v q_user '%q' "$CAPRI_USER"
  printf -v q_service '%q' 'capri-runtime'
  printf -v q_python '%q' "$PYTHON_BIN"
  cat > "$TEMP_CLI" <<EOF
#!/usr/bin/env bash
set -u
PAIRING_FILE=$q_pairing
CAPRI_SCOPE=$q_scope
CAPRI_USER=$q_user
SERVICE_NAME=$q_service
PYTHON_BIN=$q_python

value() { sed -n "s/^\$1=//p" "\$PAIRING_FILE" 2>/dev/null | tail -n 1; }
token="\$(value CAPRI_RUNTIME_TOKEN)"
device="\$(value CAPRI_RUNTIME_DEVICE)"
port="\$(value CAPRI_RUNTIME_PORT)"
serve_port="\$(value CAPRI_RUNTIME_SERVE_PORT)"
serve_port="\${serve_port:-8447}"
host=''
if command -v tailscale >/dev/null 2>&1; then
  host="\$(tailscale status --json 2>/dev/null | \"\$PYTHON_BIN\" -c 'import json,sys; d=json.load(sys.stdin); s=d.get("Self",{}); print((s.get("DNSName") or s.get("HostName") or "").rstrip("."))' 2>/dev/null || true)"
fi
endpoint="https://\${host:-<tailscale-hostname>}:\$serve_port"
status='offline'
case "\$(uname -s)" in
  Linux)
    if [[ "\$CAPRI_SCOPE" == 'system' ]]; then
      status="\$(systemctl is-active "\$SERVICE_NAME" 2>/dev/null || true)"
    elif [[ "\$(id -un)" == "\$CAPRI_USER" ]]; then
      status="\$(systemctl --user is-active "\$SERVICE_NAME" 2>/dev/null || true)"
    else
      status="\$(systemctl --user --machine="\${CAPRI_USER}@.host" is-active "\$SERVICE_NAME" 2>/dev/null || true)"
    fi
    ;;
  Darwin)
    status="\$(launchctl print "gui/\$(id -u)/com.arcxlo.capri-runtime" >/dev/null 2>&1 && printf active || printf inactive)"
    ;;
esac
status="\${status:-offline}"
if [[ "\${1:-status}" == '--help' || "\${1:-status}" == 'help' ]]; then
  printf '%s\n' 'Usage: capri-runtime [status]'
  exit 0
fi

if [[ -t 1 ]]; then
  red=\$'\\033[1;31m'; magenta=\$'\\033[1;35m'; cyan=\$'\\033[1;36m'; green=\$'\\033[1;32m'; yellow=\$'\\033[1;33m'; reset=\$'\\033[0m'
else
  red=''; magenta=''; cyan=''; green=''; yellow=''; reset=''
fi
line='────────────────────────────────────────────────────────────────────────────'
if [[ "\$status" == 'active' || "\$status" == 'running' ]]; then state="\${green}RUNNING\${reset}"; else state="\${red}NOT RUNNING (\$status)\${reset}"; fi
printf '%s\n' "\${red}╭\$line╮\${reset}"
printf '│ %-72s │\n' "\${magenta}CAPRI RUNTIME // STATUS\${reset}"
printf '│ %-72s │\n' "Device:   \$device"
printf '│ %-72s │\n' "Status:   \$state"
printf '│ %-72s │\n' "Endpoint: \$endpoint"
printf '│ %-72s │\n' "Local:    127.0.0.1:\$port"
printf '│ %-72s │\n' "Token:    \$token"
printf '%s\n' "\${red}╰\$line╯\${reset}"
EOF
  if [[ "$CAPRI_SCOPE" == 'system' && "$(uname -s)" == 'Linux' ]]; then
    run_root install -m 0755 "$TEMP_CLI" "$cli_path"
  else
    install -m 0755 "$TEMP_CLI" "$cli_path"
  fi
  ok "Status command installed: $cli_path"
}

configure_serve() {
  [[ "$CAPRI_SKIP_SERVE" == '1' ]] && return
  if tailscale serve --https="$CAPRI_SERVE_PORT" "http://127.0.0.1:$CAPRI_PORT" >/dev/null 2>&1; then
    ok "Tailscale Serve listening on HTTPS $CAPRI_SERVE_PORT"
  elif [[ "$CAPRI_SCOPE" == 'system' ]] && ((${#ROOT_PREFIX[@]})); then
    if run_root tailscale serve --https="$CAPRI_SERVE_PORT" "http://127.0.0.1:$CAPRI_PORT" >/dev/null 2>&1; then
      ok "Tailscale Serve listening on HTTPS $CAPRI_SERVE_PORT"
    else
      warn 'Runtime is online, but Tailscale Serve could not be configured.'
      warn "Run: tailscale serve --https=$CAPRI_SERVE_PORT http://127.0.0.1:$CAPRI_PORT"
    fi
  else
    warn 'Runtime is online, but Tailscale Serve could not be configured.'
    warn "Run: tailscale serve --https=$CAPRI_SERVE_PORT http://127.0.0.1:$CAPRI_PORT"
  fi
}

banner() {
  printf '\n%s\n' "${RED}╭──────────────────────────────────────────────────────────────────────────╮${RESET}"
  printf '%s\n' "${RED}│${RESET} ${MAGENTA}CAPRI RUNTIME // PRIVATE LANE${RESET}                                      ${RED}│${RESET}"
  printf '%s\n' "${RED}│${RESET} ${DIM}Pair a coding-agent machine with Capri in under a minute.${RESET}              ${RED}│${RESET}"
  printf '%s\n\n' "${RED}╰──────────────────────────────────────────────────────────────────────────╯${RESET}"
}

banner
need python3
need curl
if [[ "$CAPRI_SKIP_SERVE" != '1' ]]; then need tailscale; fi
PYTHON_BIN="$(command -v python3)"
choose_scope
if ! id "$CAPRI_USER" >/dev/null 2>&1; then fail "User '$CAPRI_USER' does not exist. Set CAPRI_USER to the account that owns the agent sessions."; fi
guard_user_scope
prepare_sudo

USER_HOME="$(user_home)"
CAPRI_GROUP="$(id -gn "$CAPRI_USER")"
USER_PATH="$(service_path)"
CAPRI_DEVICE="$(prompt_value 'Machine label' "$CAPRI_DEVICE")"
CAPRI_PORT="$(prompt_value 'Runtime port' "$CAPRI_PORT")"
CAPRI_SERVE_PORT="$(prompt_value 'Tailscale HTTPS port' "$CAPRI_SERVE_PORT")"
ensure_runtime_port

TEMP_SERVER="$(mktemp)"
TEMP_CLI="$(mktemp)"
trap 'rm -f "$TEMP_SERVER" "$TEMP_CLI"' EXIT
step '01/04' 'Fetching the runtime bridge'
log "$CAPRI_SERVER_URL"
if ! curl --fail --silent --show-error --location "$CAPRI_SERVER_URL" --output "$TEMP_SERVER"; then
  fail 'Could not download the runtime bridge. Check the network or set CAPRI_SERVER_URL to a reachable copy.'
fi
"$PYTHON_BIN" -m py_compile "$TEMP_SERVER" || fail 'The downloaded runtime bridge failed the Python check.'
ok 'Runtime bridge downloaded and compiled'

RUNTIME_TOKEN="${CAPRI_TOKEN:-$("$PYTHON_BIN" - <<'PY'
import secrets
print(secrets.token_urlsafe(40))
PY
)}"
step '02/04' "Preparing $CAPRI_SCOPE service for $CAPRI_USER"
case "$(uname -s)" in
  Linux) if [[ "$CAPRI_SCOPE" == 'system' ]]; then install_system_linux; else install_user_linux; fi ;;
  Darwin) install_macos ;;
  *) fail 'Capri Runtime currently supports Linux and macOS.' ;;
esac
install_cli

step '03/04' 'Connecting the private network lane'
configure_serve

TAILNET_HOST=''
if [[ "$CAPRI_SKIP_SERVE" != '1' ]] && command -v tailscale >/dev/null 2>&1; then
  TAILNET_HOST="$(tailscale status --json 2>/dev/null | "$PYTHON_BIN" -c 'import json,sys; d=json.load(sys.stdin); s=d.get("Self",{}); print((s.get("DNSName") or s.get("HostName") or "").rstrip("."))' 2>/dev/null || true)"
fi
step '04/04' 'Pairing channel ready'
line
printf '%s\n' "${GREEN}CAPRI RUNTIME ONLINE // $CAPRI_DEVICE${RESET}"
printf '\n%s\n' "${CYAN}PAIRING DATA${RESET}"
printf '  Device:   %s\n' "$CAPRI_DEVICE"
printf '  Endpoint: https://%s:%s\n' "${TAILNET_HOST:-<tailscale-hostname>}" "$CAPRI_SERVE_PORT"
printf '  Token:    %s\n' "$RUNTIME_TOKEN"
line
printf '%s\n' "${DIM}Paste the endpoint and token into Capri Setup. Keep the token private.${RESET}"
