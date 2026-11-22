#!/usr/bin/env bash
set -euo pipefail

# ┌─ CAPRI SERVICE INSTALLER // QUICK JACK-IN ────────────────────────────────┐
# │ The public entry point stays tiny; the full Linux/macOS runtime setup     │
# │ lives in runtime/setup_install.sh so the raw GitHub URL is stable.         │
# └───────────────────────────────────────────────────────────────────────────┘

exec "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/runtime/setup_install.sh" "$@"
