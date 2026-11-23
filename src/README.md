# Capri Web

The web client is a Nuxt 4 dashboard for the Capri remote controller. It shares the runtime model with the Even G2 client: linked decks, saved harness sessions, approvals, terminal access, setup, and speech settings.

## Run locally

```sh
cd src
npm install
npm run dev
```

Open the local URL printed by Nuxt. The dashboard starts with synthetic deck data, so the interface can be explored before a runtime is paired.

## Build and preview

```sh
npm run build
npm run preview
```

`npm run typecheck` prepares the Nuxt-generated TypeScript configuration and checks Vue components with `vue-tsc`.

## Runtime pairing

The Setup screen accepts the HTTPS endpoint and token printed by `runtime/setup_install.sh`. The same values can be provided before launch with Nuxt public runtime variables:

```sh
NUXT_PUBLIC_RUNTIME_ENDPOINT=https://deck.tailnet.ts.net:8447 \
NUXT_PUBLIC_RUNTIME_TOKEN=replace-me \
npm run dev
```

The browser checks `/api/v1/health` and keeps the demo state available when no endpoint is configured or the runtime cannot be reached.

## Routes

- `/` shows the deck overview, network scene, activity, and connected machines.
- `/sessions` filters saved sessions by deck, state, harness, and search text.
- `/sessions/:id` shows model replies, approval choices, and the message composer.
- `/terminal` provides a focused remote shell surface.
- `/setup` explains installation and pairing.
- `/settings` stores runtime, harness, and speech-to-text preferences.

## Design notes

Capri uses a black surface with neon red as the primary accent. Cyan identifies network metadata, green marks healthy state, and yellow marks attention or hover. Layouts collapse to a bottom navigation bar on narrow screens. The Three.js scene is decorative and never replaces the readable device and session tables.
