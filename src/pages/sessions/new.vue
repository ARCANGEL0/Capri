<script setup lang="ts">
import type { AgentId, CapriSession } from '../../types/dashboard'

const dashboard = useDashboard()
const { devices } = dashboard
const deviceId = ref(dashboard.selectedDevice.value?.id ?? dashboard.devices.value[0]?.id ?? '')
const agent = ref<AgentId>(dashboard.settings.value.defaultAgent)
const cwd = ref('')
const title = ref('')
const starting = ref(false)
const error = ref('')
const agentOptions: AgentId[] = ['codex', 'claude', 'nclaude', 'opencode', 'cline']

async function createSession() {
  error.value = ''
  if (!deviceId.value || !title.value.trim()) {
    error.value = 'Choose a deck and name the session.'
    return
  }
  starting.value = true
  const id = `local-${Date.now().toString(36)}`
  const session: CapriSession = { id, title: title.value.trim(), deviceId: deviceId.value, agent: agent.value, harness: agent.value.toUpperCase(), cwd: cwd.value.trim() || 'remote workspace', state: 'active', updatedAt: 'now', messageCount: 0, unread: 0 }
  dashboard.sessions.value = [session, ...dashboard.sessions.value]
  dashboard.messages.value[id] = []
  dashboard.selectSession(id)
  dashboard.selectDevice(deviceId.value)
  await navigateTo(`/sessions/${id}`)
  starting.value = false
}
</script>

<template>
  <div class="new-session-page">
    <NuxtLink class="back-link" to="/sessions">← Sessions</NuxtLink>
    <section class="page-intro"><div><p class="page-kicker">CAPRI / NEW WORK</p><h1>New session</h1><p class="page-summary">Start a coding harness on a paired deck and keep the conversation in one place.</p></div></section>
    <form class="section-panel new-session-form" @submit.prevent="createSession"><label>DECK<select v-model="deviceId"><option v-for="device in devices" :key="device.id" :value="device.id">{{ device.name }} · {{ device.address }}</option></select></label><label>HARNESS<select v-model="agent"><option v-for="option in agentOptions" :key="option" :value="option">{{ option.toUpperCase() }}</option></select></label><label>SESSION NAME<input v-model="title" placeholder="What should this session do?" /></label><label>WORKING DIRECTORY<input v-model="cwd" placeholder="Optional remote folder" /></label><p v-if="error" class="form-error">{{ error }}</p><div class="form-actions"><NuxtLink class="secondary-action" to="/sessions">Cancel</NuxtLink><button class="primary-action" type="submit" :disabled="starting">{{ starting ? 'Starting…' : 'Start session ↗' }}</button></div></form>
  </div>
</template>

<style scoped>
.new-session-page { display: grid; gap: 24px; max-width: 720px; }
.back-link { color: var(--capri-cyan); font-family: var(--capri-mono); font-size: 10px; }
.back-link:hover { color: var(--capri-yellow); }
.page-kicker { margin: 0 0 10px; color: var(--capri-red-soft); font-family: var(--capri-mono); font-size: 9px; letter-spacing: .14em; }
h1 { margin: 0; color: var(--capri-text); font-size: clamp(36px, 5vw, 60px); font-weight: 600; letter-spacing: -.06em; line-height: .95; }
.page-summary { max-width: 45ch; margin: 16px 0 0; color: var(--capri-text-muted); font-size: 15px; }
.section-panel { display: grid; gap: 16px; padding: 22px; border: 1px solid var(--capri-line); background: var(--capri-panel); }
label { display: grid; gap: 7px; color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 8px; letter-spacing: .08em; }
select, input { height: 40px; padding: 0 11px; border: 1px solid var(--capri-line); border-radius: 0; outline: 0; color: var(--capri-text); background: var(--capri-panel-raised); font-family: var(--capri-mono); font-size: 11px; }
select:focus, input:focus { border-color: var(--capri-cyan); }
.form-error { margin: -3px 0 0; color: var(--capri-yellow); font-family: var(--capri-mono); font-size: 10px; }
.form-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 8px; }
.primary-action, .secondary-action { display: inline-flex; align-items: center; justify-content: center; min-height: 38px; padding: 0 14px; border: 1px solid var(--capri-red); font-family: var(--capri-mono); font-size: 10px; }
.primary-action { color: var(--capri-text); background: var(--capri-red); }
.secondary-action { border-color: var(--capri-line-bright); color: var(--capri-text-muted); }
.primary-action:hover:not(:disabled), .secondary-action:hover { border-color: var(--capri-yellow); color: var(--capri-ink); background: var(--capri-yellow); }
.primary-action:disabled { cursor: wait; opacity: .5; }
</style>
