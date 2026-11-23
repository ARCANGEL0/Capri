<script setup lang="ts">
import StatusPill from '../components/StatusPill.vue'

const dashboard = useDashboard()
const command = ref('')
const output = ref([
  { prompt: '', text: 'Capri terminal relay ready.' },
  { prompt: '', text: 'Select a deck, then run a command through its private runtime.' },
])
const running = ref(false)
const selectedDevice = computed(() => dashboard.selectedDevice.value)

async function runCommand() {
  const value = command.value.trim()
  if (!value || running.value) return
  running.value = true
  output.value.push({ prompt: '$', text: value })
  command.value = ''
  await new Promise(resolve => setTimeout(resolve, 350))
  output.value.push({ prompt: '', text: `Queued on ${selectedDevice.value?.name ?? 'selected deck'} · runtime will stream the result here.` })
  running.value = false
}
</script>

<template>
  <div class="terminal-page">
    <section class="page-intro"><div><p class="page-kicker">CAPRI / REMOTE SHELL</p><h1>Terminal</h1><p class="page-summary">Run a focused command on the selected deck without leaving the controller.</p></div><StatusPill tone="green" :label="selectedDevice?.name ?? 'NO DECK'" /></section>
    <section class="terminal-panel section-panel">
      <div class="terminal-toolbar"><div><span class="panel-label">TARGET DECK</span><strong>{{ selectedDevice?.name ?? 'No deck selected' }}</strong><small>{{ selectedDevice?.address ?? 'Pair a runtime to continue' }}</small></div><NuxtLink class="text-action" to="/setup">Change deck ↗</NuxtLink></div>
      <div class="terminal-output" role="log" aria-live="polite"><p v-for="(line, index) in output" :key="`${index}-${line.text}`"><span v-if="line.prompt" class="prompt">{{ line.prompt }}</span><span>{{ line.text }}</span></p><p v-if="running" class="terminal-cursor"><span class="prompt">›</span> runtime is processing<span class="blink">_</span></p></div>
      <form class="command-bar" @submit.prevent="runCommand"><span class="prompt">$</span><input v-model="command" :disabled="running || !selectedDevice" placeholder="type a command" aria-label="Terminal command" /><button type="submit" :disabled="running || !command.trim()">Run ↗</button></form>
    </section>
    <section class="terminal-note"><span class="status-pip" />Commands travel through the paired Capri runtime and remain on the selected private lane.</section>
  </div>
</template>

<style scoped>
.terminal-page { display: grid; gap: 26px; }
.page-intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
.page-kicker, .panel-label { margin: 0 0 10px; color: var(--capri-red-soft); font-family: var(--capri-mono); font-size: 9px; letter-spacing: 0.14em; }
h1 { margin: 0; color: var(--capri-text); font-size: clamp(36px, 5vw, 66px); font-weight: 600; letter-spacing: -0.06em; line-height: 0.95; }
.page-summary { max-width: 46ch; margin: 16px 0 0; color: var(--capri-text-muted); font-size: 15px; }
.section-panel { border: 1px solid var(--capri-line); background: var(--capri-panel); }
.terminal-panel { overflow: hidden; }
.terminal-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 18px 20px; border-bottom: 1px solid var(--capri-line); }
.terminal-toolbar strong, .terminal-toolbar small { display: block; }
.terminal-toolbar strong { color: var(--capri-text); font-family: var(--capri-mono); font-size: 13px; font-weight: 500; }
.terminal-toolbar small { margin-top: 5px; color: var(--capri-cyan); font-family: var(--capri-mono); font-size: 10px; }
.text-action { color: var(--capri-cyan); font-family: var(--capri-mono); font-size: 10px; }
.text-action:hover { color: var(--capri-yellow); }
.terminal-output { min-height: 390px; padding: 22px 20px; color: var(--capri-text-muted); background: #07080b; font-family: var(--capri-mono); font-size: 12px; line-height: 1.7; }
.terminal-output p { display: flex; gap: 10px; margin: 0; overflow-wrap: anywhere; }
.terminal-output p + p { margin-top: 5px; }
.prompt { color: var(--capri-red); }
.terminal-output p:nth-child(odd) { color: var(--capri-text); }
.terminal-cursor { color: var(--capri-cyan) !important; }
.blink { animation: blink 1s steps(2, jump-none) infinite; }
.command-bar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-top: 1px solid var(--capri-line); background: var(--capri-panel-raised); }
.command-bar input { min-width: 0; flex: 1; height: 38px; border: 0; outline: 0; color: var(--capri-text); background: transparent; font-family: var(--capri-mono); font-size: 11px; }
.command-bar input::placeholder { color: var(--capri-text-dim); }
.command-bar button { height: 36px; padding: 0 13px; border: 1px solid var(--capri-red); color: var(--capri-text); background: var(--capri-red); font-family: var(--capri-mono); font-size: 10px; }
.command-bar button:hover:not(:disabled) { border-color: var(--capri-yellow); color: var(--capri-ink); background: var(--capri-yellow); }
.command-bar button:disabled { cursor: not-allowed; opacity: .4; }
.terminal-note { display: flex; align-items: center; gap: 8px; color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 10px; }
.status-pip { width: 6px; height: 6px; border-radius: 50%; background: var(--capri-green); box-shadow: 0 0 9px var(--capri-green); }
@keyframes blink { 50% { opacity: 0; } }
@media (max-width: 600px) { .page-intro { display: block; } .page-intro > :last-child { margin-top: 20px; } .terminal-toolbar { padding: 15px; } .terminal-output { min-height: 320px; padding: 17px 15px; font-size: 11px; } }
</style>
