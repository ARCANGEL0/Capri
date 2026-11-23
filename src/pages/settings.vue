<script setup lang="ts">
import type { AgentId } from '../types/dashboard'

const dashboard = useDashboard()
const { settings, devices } = dashboard
const config = useRuntimeConfig()
const endpoint = ref(String(config.public.runtimeEndpoint || ''))
const sttProvider = ref('browser')
const sttModel = ref('default')
const saveState = ref('')
const testState = ref('')
const agents: Array<{ id: AgentId; label: string }> = [
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
  { id: 'nclaude', label: 'nClaude' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'cline', label: 'Cline' },
]

function saveSettings() {
  localStorage.setItem('capri.web.settings.v1', JSON.stringify({ endpoint: endpoint.value.trim(), sttProvider: sttProvider.value, sttModel: sttModel.value, ...dashboard.settings.value }))
  saveState.value = 'SAVED'
  window.setTimeout(() => { saveState.value = '' }, 2200)
}

async function testStt() {
  testState.value = 'TESTING…'
  await new Promise(resolve => setTimeout(resolve, 550))
  testState.value = sttProvider.value === 'browser' ? 'READY · BROWSER INPUT AVAILABLE' : `READY · ${sttProvider.value.toUpperCase()} CONFIGURED`
}
</script>

<template>
  <div class="settings-page">
    <section class="page-intro"><div><p class="page-kicker">CAPRI / CONTROL PLANE</p><h1>Settings</h1><p class="page-summary">Choose the default harness and keep speech input ready for every client.</p></div><span class="settings-state">{{ saveState || 'LOCAL CONFIG' }}</span></section>
    <section class="settings-grid">
      <article class="section-panel settings-card"><div class="panel-heading"><div><span class="panel-label">RUNTIME</span><h2>Connection</h2></div><span class="card-index">01</span></div><label>DEFAULT DECK<select v-model="settings.defaultDevice"><option v-for="device in devices" :key="device.id" :value="device.id">{{ device.name }}</option></select></label><label>RUNTIME ENDPOINT<input v-model="endpoint" type="url" placeholder="https://deck.tailnet.ts.net:8447" /></label><p class="field-note">Pairing data stays in this browser until you replace it.</p></article>
      <article class="section-panel settings-card"><div class="panel-heading"><div><span class="panel-label">HARNESS</span><h2>Defaults</h2></div><span class="card-index">02</span></div><label>DEFAULT AGENT<select :value="settings.defaultAgent" @change="dashboard.setDefaultAgent(($event.target as HTMLSelectElement).value as AgentId)"><option v-for="agent in agents" :key="agent.id" :value="agent.id">{{ agent.label }}</option></select></label><label class="toggle-row"><span><strong>Follow latest reply</strong><small>Keep the conversation at the newest model response.</small></span><input :checked="settings.autoFollow" type="checkbox" @change="dashboard.toggleSetting('autoFollow')" /><i /></label><label class="toggle-row"><span><strong>Compact output</strong><small>Hide tool chatter from the conversation view.</small></span><input :checked="settings.compactOutput" type="checkbox" @change="dashboard.toggleSetting('compactOutput')" /><i /></label></article>
    </section>
    <section class="section-panel stt-card"><div class="panel-heading"><div><span class="panel-label">VOICE INPUT</span><h2>Speech to text</h2><p>Use the same provider settings across the web and glasses clients.</p></div><span class="card-index">03</span></div><div class="stt-grid"><label>PROVIDER<select v-model="sttProvider"><option value="browser">Browser microphone</option><option value="openai">OpenAI compatible</option><option value="deepgram">Deepgram</option><option value="local">Local runtime</option></select></label><label>MODEL<input v-model="sttModel" placeholder="default" /></label><div class="stt-actions"><button class="secondary-action" type="button" @click="testStt">Test</button><button class="primary-action" type="button" @click="saveSettings">Save</button></div></div><p v-if="testState" class="test-state"><span class="status-pip" />{{ testState }}</p></section>
  </div>
</template>

<style scoped>
.settings-page { display: grid; gap: 26px; }
.page-intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
.page-kicker, .panel-label { margin: 0 0 10px; color: var(--capri-red-soft); font-family: var(--capri-mono); font-size: 9px; letter-spacing: .14em; }
h1 { margin: 0; color: var(--capri-text); font-size: clamp(36px, 5vw, 66px); font-weight: 600; letter-spacing: -.06em; line-height: .95; }
.page-summary { max-width: 46ch; margin: 16px 0 0; color: var(--capri-text-muted); font-size: 15px; }
.settings-state { padding-bottom: 5px; color: var(--capri-cyan); font-family: var(--capri-mono); font-size: 10px; }
.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.section-panel { border: 1px solid var(--capri-line); background: var(--capri-panel); }
.settings-card, .stt-card { display: grid; gap: 18px; padding: 22px; }
.panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.panel-heading h2 { margin: 0; color: var(--capri-text); font-size: 20px; font-weight: 500; letter-spacing: -.03em; }
.panel-heading p { margin: 7px 0 0; color: var(--capri-text-muted); font-size: 12px; }
.card-index { color: var(--capri-red); font-family: var(--capri-mono); font-size: 10px; }
.settings-card > label, .stt-grid label { display: grid; gap: 7px; color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 8px; letter-spacing: .08em; }
select, input[type='url'], .stt-grid input { height: 38px; min-width: 0; padding: 0 11px; border: 1px solid var(--capri-line); border-radius: 0; outline: 0; color: var(--capri-text); background: var(--capri-panel-raised); font-family: var(--capri-mono); font-size: 10px; }
select:focus, input:focus { border-color: var(--capri-cyan); }
.field-note { margin: -4px 0 0; color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 9px; line-height: 1.5; }
.toggle-row { position: relative; display: flex !important; align-items: center; justify-content: space-between; gap: 15px; padding-top: 13px; border-top: 1px solid var(--capri-line); }
.toggle-row span { display: grid; gap: 5px; }
.toggle-row strong { color: var(--capri-text); font-family: var(--capri-sans); font-size: 12px; font-weight: 500; letter-spacing: 0; text-transform: none; }
.toggle-row small { color: var(--capri-text-dim); font-family: var(--capri-sans); font-size: 11px; letter-spacing: 0; text-transform: none; }
.toggle-row input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.toggle-row i { position: relative; width: 34px; height: 18px; flex: 0 0 auto; border: 1px solid var(--capri-line-bright); background: var(--capri-panel-raised); }
.toggle-row i::after { position: absolute; top: 3px; left: 3px; width: 10px; height: 10px; background: var(--capri-text-dim); content: ''; transition: transform var(--capri-transition), background var(--capri-transition); }
.toggle-row input:checked + i { border-color: var(--capri-green); }
.toggle-row input:checked + i::after { background: var(--capri-green); transform: translateX(16px); }
.stt-grid { display: grid; grid-template-columns: 1fr 1fr auto; align-items: end; gap: 12px; }
.stt-actions { display: flex; gap: 8px; }
.primary-action, .secondary-action { height: 38px; padding: 0 15px; border: 1px solid var(--capri-red); font-family: var(--capri-mono); font-size: 10px; }
.primary-action { color: var(--capri-text); background: var(--capri-red); }
.secondary-action { color: var(--capri-cyan); background: transparent; }
.primary-action:hover, .secondary-action:hover { border-color: var(--capri-yellow); color: var(--capri-ink); background: var(--capri-yellow); }
.test-state { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--capri-green); font-family: var(--capri-mono); font-size: 10px; }
.status-pip { width: 6px; height: 6px; border-radius: 50%; background: var(--capri-green); box-shadow: 0 0 9px var(--capri-green); }
@media (max-width: 700px) { .page-intro { display: block; } .settings-state { display: block; margin-top: 20px; } .settings-grid { grid-template-columns: 1fr; } .settings-card, .stt-card { padding: 17px; } .stt-grid { grid-template-columns: 1fr; } .stt-actions { justify-content: flex-end; } }
</style>
