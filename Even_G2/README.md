# Capri

Capri is a private Even Realities G2 app and phone control center for coding agents and terminals on your Tailscale network.

## Phone control center

The phone UI has four areas:

- **Devices** shows online Tailscale machines, Capri service health, installed agents, and quick actions.
- **Sessions** searches and filters saved Claude, Codex, OpenCode, Ghost, CodeWhale, DSH, Kimi Code, and Gemini CLI sessions across machines. Start a new session with any detected harness; choose a model; send messages; follow live output; and respond to approval prompts.
- **Terminal** opens an interactive shell on `devbox` or `workstation`. For another tailnet device, configure its Linux or macOS username in Settings and open it through Tailscale SSH. The terminal supports command history, auto-follow, Ctrl-C, Ctrl-D, Tab, Escape, and typed responses to SSH prompts.
- **Setup** installs and pairs the machine-side `capri-runtime` bridge from a raw GitHub installer. It stores each machine endpoint and token locally on the phone.
- **Settings** remembers the default machine, agent and model, Claude resume runtime, phone text size, glasses line density, output verbosity, timestamps, and auto-follow. Preferences and terminal command history stay in the phone WebView.

Agent sessions require `capri-runtime` on their machine. Additional terminal targets do not need the runtime, but they must be online, run Tailscale SSH, and allow the selected controller in their Tailscale SSH policy. Tailscale SSH servers are supported on Linux, or macOS with the open-source Tailscale CLI.

## New machine setup

Open **Setup** in the companion app, run the displayed command on the machine that owns the agent sessions, then paste the endpoint and token printed by the installer. The installer is published at:

```text
https://raw.githubusercontent.com/ARCANGEL0/Capri/main/runtime/setup_install.sh
```

Run it as the same user who owns the agent sessions. It installs `capri-runtime`, configures Tailscale Serve, and keeps the bridge on localhost. Linux uses systemd; macOS uses a launch agent.

## Glasses controls

- Swipe through devices, agents, models, sessions, and approval choices; click to select; double tap to go back.
- Hold to open the menu. Devices, Models, Type input, Open session, Back, and Approvals are available there.
- In a session or terminal, tap once to start listening and tap again to stop. Capri sends the glasses' 16 kHz mono audio to the configured private STT service, then shows the transcript with Send and Cancel choices before it reaches the agent or shell.
- In coding sessions, the glasses header shows the current running or completed tool action instead of the agent or model name.
- Live output is paced into short readable updates. Scroll up for history and down to return to the live end.

## Build and package

For a local development build, create an optional fallback token in `.env.local`:

```sh
python3 -c 'import secrets; from pathlib import Path; p=Path(".env.local"); p.write_text("VITE_CAPRI_RUNTIME_TOKEN=" + secrets.token_urlsafe(40) + "\n"); p.chmod(0o600)'
npm run build
npm run pack
```

Paired runtime tokens are entered through Setup and stored locally. The development token is only a fallback for older fixed-host builds.

## Services

The authenticated service listens on `127.0.0.1:7788`. Tailscale Serve exposes each paired controller on port `8447` to tailnet devices only. Agent execution uses the selected machine user's installed binaries, home directory, and credentials.

The runtime proxies audio to the configured private STT service on `127.0.0.1:7790`. The STT credential stays on the runtime machine and is never sent to the phone or glasses.

## API

- `GET /api/v1/devices`, `/agents`, `/sessions`, `/models?agent=...`
- `POST /api/v1/sessions`, `/terminal`, `/sessions/{id}/input`, `/sessions/{id}/model`, `/sessions/{id}/approval`, `/transcribe`
- `DELETE /api/v1/sessions/{id}` closes an active agent or terminal process group.
- `GET /api/v1/sessions/{id}/events` streams output and approval events over Server-Sent Events.

All routes require `Authorization: Bearer <CAPRI_RUNTIME_TOKEN>`.
