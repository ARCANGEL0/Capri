<script setup lang="ts">
import ApprovalBanner from '../../components/ApprovalBanner.vue'
import ChatTranscript from '../../components/ChatTranscript.vue'
import ComposerBar from '../../components/ComposerBar.vue'
import StatusPill from '../../components/StatusPill.vue'

const route = useRoute()
const dashboard = useDashboard()
const sessionId = computed(() => String(route.params.id))
const session = computed(() => dashboard.sessions.value.find(item => item.id === sessionId.value))
const messages = computed(() => dashboard.messages.value[sessionId.value] ?? [])
const status = ref('READY')
const approvalChoice = ref('')

watchEffect(() => {
  if (session.value) {
    dashboard.selectSession(session.value.id)
    dashboard.selectDevice(session.value.deviceId)
  }
})

const device = computed(() => session.value ? dashboard.deviceById(session.value.deviceId) : undefined)

function sendMessage(value: string) {
  dashboard.selectSession(sessionId.value)
  dashboard.sendMessage(value)
  status.value = 'MESSAGE QUEUED · WAITING FOR HARNESS'
}

function chooseApproval(option: string) {
  approvalChoice.value = option
  status.value = `APPROVAL SENT · ${option.toUpperCase()}`
  if (session.value) {
    dashboard.sessions.value = dashboard.sessions.value.map(item => item.id === session.value?.id ? { ...item, state: 'waiting', unread: 0, updatedAt: 'now' } : item)
  }
}
</script>

<template>
  <div v-if="session" class="session-page">
    <section class="session-topbar">
      <div class="session-heading"><NuxtLink class="back-link" to="/sessions">← Sessions</NuxtLink><p class="page-kicker">{{ session.harness }} / {{ device?.name }}</p><h1>{{ session.title }}</h1><p class="session-meta"><span>{{ session.cwd }}</span><span>·</span><span>{{ session.id }}</span></p></div>
      <div class="session-state"><StatusPill :tone="session.state === 'attention' ? 'yellow' : session.state === 'active' ? 'red' : 'green'" :label="session.state === 'attention' ? 'NEEDS APPROVAL' : session.state.toUpperCase()" /><span class="session-updated">{{ session.updatedAt }}</span></div>
    </section>

    <ApprovalBanner v-if="session.state === 'attention' && !approvalChoice" command="git status --porcelain" prompt="The harness wants to run a command on this deck." :options="['Allow once', 'Allow always', 'Deny']" @choose="chooseApproval" />
    <section v-else-if="approvalChoice" class="approval-resolved"><span>✓</span> {{ approvalChoice }} sent to the harness. Waiting for its next reply.</section>

    <section class="chat-panel section-panel">
      <div class="panel-heading"><div><span class="panel-label">MODEL REPLIES</span><h2>Conversation</h2></div><span class="reply-count">{{ messages.filter(message => message.role === 'agent').length }} replies</span></div>
      <ChatTranscript :messages="messages" />
      <div class="chat-status"><span class="status-pip" :class="session.state === 'active' ? 'is-red' : 'is-cyan'" />{{ status }}</div>
      <ComposerBar :disabled="session.state === 'attention'" @send="sendMessage" />
    </section>
  </div>
  <section v-else class="missing-session section-panel"><p class="page-kicker">CAPRI / SESSION</p><h1>Session unavailable</h1><p>This session is no longer in the selected runtime.</p><NuxtLink class="primary-action" to="/sessions">Return to sessions</NuxtLink></section>
</template>

<style scoped>
.session-page { display: grid; gap: 22px; }
.session-topbar { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding-bottom: 4px; }
.session-heading { min-width: 0; }
.back-link { display: inline-flex; margin-bottom: 26px; color: var(--capri-cyan); font-family: var(--capri-mono); font-size: 10px; }
.back-link:hover { color: var(--capri-yellow); }
.page-kicker, .panel-label { margin: 0 0 9px; color: var(--capri-red-soft); font-family: var(--capri-mono); font-size: 9px; letter-spacing: 0.14em; }
h1 { max-width: 26ch; margin: 0; color: var(--capri-text); font-size: clamp(29px, 4vw, 52px); font-weight: 600; letter-spacing: -0.06em; line-height: 0.98; }
.session-meta { display: flex; flex-wrap: wrap; gap: 7px; margin: 13px 0 0; color: var(--capri-text-muted); font-family: var(--capri-mono); font-size: 10px; }
.session-meta span:first-child { color: var(--capri-cyan); overflow-wrap: anywhere; }
.session-state { display: grid; justify-items: end; gap: 8px; padding-bottom: 4px; }
.session-updated { color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 10px; }
.approval-resolved { padding: 12px 14px; border: 1px solid var(--capri-green); color: var(--capri-green); background: rgb(39 225 125 / 0.07); font-family: var(--capri-mono); font-size: 10px; }
.approval-resolved span { margin-right: 5px; }
.section-panel { border: 1px solid var(--capri-line); background: var(--capri-panel); }
.chat-panel { display: grid; gap: 15px; padding: 22px; }
.panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }
.panel-heading h2 { margin: 0; color: var(--capri-text); font-size: 20px; font-weight: 500; letter-spacing: -0.03em; }
.panel-label { color: var(--capri-text-dim); }
.reply-count { color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 9px; }
.chat-status { display: flex; align-items: center; gap: 8px; min-height: 18px; color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 9px; letter-spacing: 0.04em; }
.status-pip { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--capri-cyan); box-shadow: 0 0 9px var(--capri-cyan); }
.is-red { background: var(--capri-red); box-shadow: 0 0 9px var(--capri-red); }
.missing-session { display: grid; gap: 12px; padding: 32px; }
.missing-session h1 { font-size: 42px; }
.missing-session p:not(.page-kicker) { margin: 0 0 10px; color: var(--capri-text-muted); }
.primary-action { justify-self: start; padding: 11px 14px; border: 1px solid var(--capri-red); color: var(--capri-text); background: var(--capri-red); font-family: var(--capri-mono); font-size: 10px; }
.primary-action:hover { border-color: var(--capri-yellow); color: var(--capri-ink); background: var(--capri-yellow); }
@media (max-width: 650px) {
  .session-topbar { display: block; }
  .session-state { display: flex; align-items: center; justify-content: space-between; margin-top: 20px; }
  .chat-panel { padding: 16px; }
}
</style>
