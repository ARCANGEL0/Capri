#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 5 ]]; then
  echo "usage: install-service.sh USER USER_HOME DEVICE PATH ENV_FILE" >&2
  exit 2
fi

service_user="$1"
user_home="$2"
device_name="$3"
user_path="$4"
environment_file="$5"
script_dir="$(cd "$(dirname "$0")" && pwd)"

if ! id "$service_user" >/dev/null 2>&1; then
  echo "service user does not exist: $service_user" >&2
  exit 1
fi
if [[ ! -f "$script_dir/capri_runtime_server.py" || ! -f "$script_dir/capri-runtime.service.template" ]]; then
  echo "Capri Runtime service files are missing from $script_dir" >&2
  exit 1
fi
if [[ ! -f "$environment_file" ]]; then
  echo "service environment file is missing" >&2
  exit 1
fi
if ! grep -q '^CAPRI_RUNTIME_TOKEN=.' "$environment_file"; then
  echo "CAPRI_RUNTIME_TOKEN is missing from the service environment" >&2
  exit 1
fi

install -d -o root -g root -m 0755 /opt/capri-runtime
install -o "$service_user" -g "$service_user" -m 0755 "$script_dir/capri_runtime_server.py" /opt/capri-runtime/server.py
install -d -o root -g root -m 0700 /etc/capri-runtime
install -o root -g root -m 0600 "$environment_file" /etc/capri-runtime/capri-runtime.env

python3 - "$script_dir/capri-runtime.service.template" /etc/systemd/system/capri-runtime.service "$service_user" "$user_home" "$device_name" "$user_path" <<'PY'
from pathlib import Path
import sys

template, destination, user, home, device, path = sys.argv[1:]
content = Path(template).read_text()
for marker, value in {
    "@SERVICE_USER@": user,
    "@USER_HOME@": home,
    "@DEVICE_NAME@": device,
    "@USER_PATH@": path,
}.items():
    content = content.replace(marker, value)
Path(destination).write_text(content)
PY

chmod 0644 /etc/systemd/system/capri-runtime.service
systemctl daemon-reload
systemctl enable --now capri-runtime.service
systemctl --no-pager --full status capri-runtime.service
