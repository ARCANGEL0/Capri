<script setup lang="ts">
const config = useRuntimeConfig()
const runtime = useRuntimeApi()
const endpoint = ref(String(config.public.runtimeEndpoint || ''))
const token = ref(String(config.public.runtimeToken || ''))
const pairingState = ref('NOT PAIRED')
const installerUrl = 'https://raw.githubusercontent.com/ARCANGEL0/Capri/main/runtime/setup_install.sh'

async function savePairing() {
  const value = endpoint.value.trim().replace(/\/$/, '')
  if (!value || !token.value.trim()) {
    pairingState.value = 'ENDPOINT AND TOKEN REQUIRED'
    return
  }
  runtime.savePairing(value, token.value)
  pairingState.value = 'CHECKING RUNTIME…'
  const online = await runtime.check()
  pairingState.value = online ? 'RUNTIME ONLINE' : 'PAIRING SAVED · OFFLINE'
}

async function copyInstaller() {
  await navigator.clipboard?.writeText(`curl -fsSL ${installerUrl} | bash`)
  pairingState.value = 'INSTALL COMMAND COPIED'
}
</script>

<template>
  <div class="setup-page">
    <section class="page-intro"><div><p class="page-kicker">CAPRI / PRIVATE LANE</p><h1>Setup</h1><p class="page-summary">Install the runtime on a Tailscale machine, then paste its pairing data here.</p></div><span class="setup-state">{{ pairingState }}</span></section>
    <section class="setup-grid">
      <article class="section-panel guide-card"><div class="panel-heading"><div><span class="panel-label">01 / INSTALL</span><h2>Start the Capri runtime</h2></div><span class="step-number">01</span></div><p>Run the installer on the machine that owns your coding sessions. It installs a user-scoped service by default, so root access is optional.</p><a class="code-link" :href="installerUrl" target="_blank" rel="noreferrer">Raw installer ↗</a><button class="copy-button" type="button" @click="copyInstaller">Copy curl command</button></article>
      <article class="section-panel guide-card"><div class="panel-heading"><div><span class="panel-label">02 / PAIR</span><h2>Paste the runtime data</h2></div><span class="step-number">02</span></div><p>The installer prints a private HTTPS endpoint and token. Keep the token secret and add both values below.</p><form class="pair-form" @submit.prevent="savePairing"><label>ENDPOINT<input v-model="endpoint" type="url" placeholder="https://deck.tailnet.ts.net:8447" /></label><label>TOKEN<input v-model="token" type="password" placeholder="Paste pairing token" /></label><button class="primary-action" type="submit">Save pairing <span>↗</span></button></form></article>
    </section>
    <section class="section-panel checklist"><div class="panel-heading"><div><span class="panel-label">03 / CHECK</span><h2>Connection checklist</h2></div><NuxtLink class="text-action" to="/settings">Runtime settings ↗</NuxtLink></div><ol><li><span>01</span><div><strong>Tailscale is online</strong><p>The browser and runtime host can reach each other on the same private network.</p></div></li><li><span>02</span><div><strong>Service is running</strong><p>Check <code>systemctl --user status capri-runtime</code> on Linux or the LaunchAgent on macOS.</p></div></li><li><span>03</span><div><strong>Pairing is saved</strong><p>Return to Cyberdecks to see live device state when the runtime API is connected.</p></div></li></ol></section>
  </div>
</template>

<style scoped>
.setup-page { display: grid; gap: 26px; }
.page-intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
.page-kicker, .panel-label { margin: 0 0 10px; color: var(--capri-red-soft); font-family: var(--capri-mono); font-size: 9px; letter-spacing: 0.14em; }
h1 { margin: 0; color: var(--capri-text); font-size: clamp(36px, 5vw, 66px); font-weight: 600; letter-spacing: -0.06em; line-height: .95; }
.page-summary { max-width: 48ch; margin: 16px 0 0; color: var(--capri-text-muted); font-size: 15px; }
.setup-state { padding-bottom: 5px; color: var(--capri-cyan); font-family: var(--capri-mono); font-size: 10px; }
.setup-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.section-panel { border: 1px solid var(--capri-line); background: var(--capri-panel); }
.guide-card { display: grid; align-content: start; gap: 17px; padding: 22px; }
.panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 15px; }
.panel-heading h2 { margin: 0; color: var(--capri-text); font-size: 20px; font-weight: 500; letter-spacing: -.03em; }
.step-number { color: var(--capri-red); font-family: var(--capri-mono); font-size: 11px; }
.guide-card > p { min-height: 56px; margin: 0; color: var(--capri-text-muted); font-size: 13px; line-height: 1.6; }
.code-link, .text-action { color: var(--capri-cyan); font-family: var(--capri-mono); font-size: 10px; }
.code-link:hover, .text-action:hover { color: var(--capri-yellow); }
.copy-button { justify-self: start; padding: 9px 11px; border: 1px solid var(--capri-line-bright); color: var(--capri-text); background: transparent; font-family: var(--capri-mono); font-size: 10px; }
.copy-button:hover { border-color: var(--capri-yellow); color: var(--capri-yellow); }
.pair-form { display: grid; gap: 11px; }
.pair-form label { display: grid; gap: 6px; color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 8px; letter-spacing: .08em; }
.pair-form input { height: 38px; padding: 0 11px; border: 1px solid var(--capri-line); outline: 0; color: var(--capri-text); background: var(--capri-panel-raised); font-family: var(--capri-mono); font-size: 10px; }
.pair-form input:focus { border-color: var(--capri-cyan); }
.primary-action { justify-self: start; margin-top: 3px; padding: 10px 13px; border: 1px solid var(--capri-red); color: var(--capri-text); background: var(--capri-red); font-family: var(--capri-mono); font-size: 10px; }
.primary-action:hover { border-color: var(--capri-yellow); color: var(--capri-ink); background: var(--capri-yellow); }
.checklist { padding: 22px; }
.checklist ol { display: grid; gap: 0; margin: 3px 0 0; padding: 0; list-style: none; }
.checklist li { display: grid; grid-template-columns: 38px 1fr; gap: 14px; padding: 15px 0; border-top: 1px solid var(--capri-line); }
.checklist li > span { color: var(--capri-red); font-family: var(--capri-mono); font-size: 10px; }
.checklist strong { color: var(--capri-text); font-family: var(--capri-mono); font-size: 12px; font-weight: 500; }
.checklist p { margin: 5px 0 0; color: var(--capri-text-muted); font-size: 12px; line-height: 1.5; }
.checklist code { color: var(--capri-cyan); font-family: var(--capri-mono); font-size: 10px; }
@media (max-width: 700px) { .page-intro { display: block; } .setup-state { display: block; margin-top: 20px; } .setup-grid { grid-template-columns: 1fr; } .guide-card, .checklist { padding: 17px; } }
</style>
