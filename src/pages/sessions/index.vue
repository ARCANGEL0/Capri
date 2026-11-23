<script setup lang="ts">
import SessionTable from '../../components/SessionTable.vue'
import StatusPill from '../../components/StatusPill.vue'

const dashboard = useDashboard()
const route = useRoute()
const search = ref('')
const stateFilter = ref<'all' | 'active' | 'waiting' | 'attention' | 'idle'>('all')
const deviceFilter = ref(typeof route.query.device === 'string' ? route.query.device : 'all')
const { devices, sessions, selectedSession } = dashboard

const filteredSessions = computed(() => {
  const needle = search.value.trim().toLowerCase()
  return sessions.value.filter((session) => {
    const matchesDevice = deviceFilter.value === 'all' || session.deviceId === deviceFilter.value
    const matchesState = stateFilter.value === 'all' || session.state === stateFilter.value
    const matchesSearch = !needle || [session.title, session.id, session.cwd, session.harness].some(value => value.toLowerCase().includes(needle))
    return matchesDevice && matchesState && matchesSearch
  })
})

const attentionCount = computed(() => sessions.value.filter(session => session.state === 'attention').length)

async function openSession(session: typeof sessions.value[number]) {
  dashboard.selectSession(session.id)
  dashboard.selectDevice(session.deviceId)
  await navigateTo(`/sessions/${session.id}`)
}
</script>

<template>
  <div class="sessions-page">
    <section class="page-intro">
      <div>
        <p class="page-kicker">CAPRI / WORK QUEUE</p>
        <h1>Sessions</h1>
        <p class="page-summary">Resume a harness where you left it. Approval requests stay visible until they are handled.</p>
      </div>
      <div class="intro-actions"><StatusPill v-if="attentionCount" tone="yellow" :label="`${attentionCount} NEED ATTENTION`" /><NuxtLink class="primary-action" to="/sessions/new">New session <span>＋</span></NuxtLink></div>
    </section>

    <section class="filter-panel" aria-label="Session filters">
      <label class="search-field"><span aria-hidden="true">⌕</span><input v-model="search" type="search" placeholder="Search sessions, paths, harnesses" aria-label="Search sessions" /></label>
      <label><span>DECK</span><select v-model="deviceFilter"><option value="all">All decks</option><option v-for="device in devices" :key="device.id" :value="device.id">{{ device.name }}</option></select></label>
      <label><span>STATE</span><select v-model="stateFilter"><option value="all">All states</option><option value="active">Active</option><option value="waiting">Waiting</option><option value="attention">Needs attention</option><option value="idle">Idle</option></select></label>
      <span class="filter-count">{{ filteredSessions.length }} / {{ sessions.length }}</span>
    </section>

    <section class="section-panel sessions-panel">
      <div class="panel-heading"><div><span class="panel-label">SAVED WORK</span><h2>All sessions</h2><p>Sorted by most recent activity.</p></div><span class="live-note"><i /> runtime synced</span></div>
      <SessionTable :sessions="filteredSessions" :selected-id="selectedSession?.id" @select="openSession" />
    </section>

    <section class="sessions-footnote"><span class="status-pip is-green" /><span>Live runtime data replaces these fixtures after a deck is paired.</span><NuxtLink to="/setup">Pair a runtime <span>↗</span></NuxtLink></section>
  </div>
</template>

<style scoped>
.sessions-page { display: grid; gap: 26px; }
.page-intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
.page-kicker, .panel-label { margin: 0 0 10px; color: var(--capri-red-soft); font-family: var(--capri-mono); font-size: 9px; letter-spacing: 0.14em; }
h1 { margin: 0; color: var(--capri-text); font-size: clamp(36px, 5vw, 66px); font-weight: 600; letter-spacing: -0.06em; line-height: 0.95; }
.page-summary { max-width: 48ch; margin: 16px 0 0; color: var(--capri-text-muted); font-size: 15px; }
.intro-actions { display: flex; align-items: center; gap: 15px; padding-bottom: 3px; }
.primary-action { display: inline-flex; align-items: center; gap: 9px; padding: 11px 14px; border: 1px solid var(--capri-red); color: var(--capri-text); background: var(--capri-red); font-family: var(--capri-mono); font-size: 10px; letter-spacing: 0.04em; }
.primary-action:hover { border-color: var(--capri-yellow); color: var(--capri-ink); background: var(--capri-yellow); }
.filter-panel { display: grid; grid-template-columns: minmax(250px, 1fr) 190px 160px auto; align-items: end; gap: 12px; padding: 14px; border: 1px solid var(--capri-line); background: var(--capri-panel); }
.filter-panel label { display: grid; gap: 6px; color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 8px; letter-spacing: 0.09em; }
.filter-panel input, .filter-panel select { min-width: 0; height: 38px; padding: 0 11px; border: 1px solid var(--capri-line); border-radius: 0; outline: 0; color: var(--capri-text); background: var(--capri-panel-raised); font-family: var(--capri-mono); font-size: 11px; }
.filter-panel input:focus, .filter-panel select:focus { border-color: var(--capri-cyan); }
.search-field { position: relative; }
.search-field > span { position: absolute; bottom: 9px; left: 11px; color: var(--capri-cyan); font-size: 18px; line-height: 1; }
.search-field input { padding-left: 31px; }
.filter-count { padding: 11px 3px; color: var(--capri-cyan); font-family: var(--capri-mono); font-size: 10px; text-align: right; }
.section-panel { border: 1px solid var(--capri-line); background: var(--capri-panel); }
.sessions-panel { padding: 22px; }
.panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 18px; }
.panel-heading h2 { margin: 0; color: var(--capri-text); font-size: 20px; font-weight: 500; letter-spacing: -0.03em; }
.panel-heading p { margin: 7px 0 0; color: var(--capri-text-muted); font-size: 12px; }
.panel-label { color: var(--capri-text-dim); }
.live-note { display: inline-flex; align-items: center; gap: 7px; color: var(--capri-green); font-family: var(--capri-mono); font-size: 9px; text-transform: uppercase; }
.live-note i, .status-pip { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 10px currentColor; }
.sessions-footnote { display: flex; align-items: center; gap: 9px; color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 10px; }
.sessions-footnote a { margin-left: auto; color: var(--capri-cyan); }
.sessions-footnote a:hover { color: var(--capri-yellow); }
.is-green { color: var(--capri-green); }
@media (max-width: 780px) {
  .page-intro { display: block; }
  .intro-actions { justify-content: space-between; margin-top: 24px; }
  .filter-panel { grid-template-columns: 1fr 1fr; }
  .search-field { grid-column: 1 / -1; }
  .filter-count { text-align: left; }
  .sessions-panel { padding: 16px; }
}
@media (max-width: 450px) {
  .filter-panel { grid-template-columns: 1fr; }
  .search-field { grid-column: auto; }
}
</style>
