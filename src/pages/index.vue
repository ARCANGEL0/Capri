<script setup lang="ts">
import ActivityFeed from '../components/ActivityFeed.vue'
import DeviceTable from '../components/DeviceTable.vue'
import MetricStrip from '../components/MetricStrip.vue'
import NetworkScene from '../components/NetworkScene.vue'
import StatusPill from '../components/StatusPill.vue'

const dashboard = useDashboard()
const attentionCount = computed(() => dashboard.sessions.value.filter(session => session.state === 'attention').length)

async function selectDevice(device: typeof dashboard.devices.value[number]) {
  dashboard.selectDevice(device.id)
  await navigateTo({ path: '/sessions', query: { device: device.id } })
}
</script>

<template>
  <div class="dashboard-page">
    <section class="page-intro">
      <div>
        <p class="page-kicker">CAPRI / REMOTE CONTROL</p>
        <h1>Cyberdecks</h1>
        <p class="page-summary">A clear view of every coding harness on your private lane.</p>
      </div>
      <div class="intro-actions"><StatusPill tone="green" label="RUNTIME ONLINE" /><NuxtLink class="text-action" to="/setup">Pair a deck <span>↗</span></NuxtLink></div>
    </section>

    <MetricStrip :devices="dashboard.devices.length" :online="dashboard.onlineDevices.length" :active="dashboard.activeSessions.length" :attention="attentionCount" />

    <section class="dashboard-grid dashboard-grid-primary">
      <div class="scene-panel"><ClientOnly><NetworkScene :devices="dashboard.devices" /><template #fallback><div class="scene-loading">Loading network map…</div></template></ClientOnly></div>
      <div class="activity-panel section-panel">
        <div class="panel-heading"><div><span class="panel-label">SIGNAL LOG</span><h2>Activity</h2></div><NuxtLink class="text-action" to="/sessions">All sessions <span>↗</span></NuxtLink></div>
        <ActivityFeed :events="dashboard.events" />
      </div>
    </section>

    <section class="section-panel deck-panel">
      <div class="panel-heading"><div><span class="panel-label">TAILSCALE DEVICES</span><h2>Connected decks</h2><p>Choose a machine to resume work or inspect its sessions.</p></div><NuxtLink class="text-action" to="/setup">Manage pairing <span>↗</span></NuxtLink></div>
      <DeviceTable :devices="dashboard.devices" :selected-id="dashboard.selectedDevice?.id" @select="selectDevice" />
    </section>

    <section class="dashboard-footnote"><span class="status-pip is-cyan" /><span>Demo data is active. Pair a Capri runtime to replace it with live deck state.</span><NuxtLink to="/setup">Open setup <span>↗</span></NuxtLink></section>
  </div>
</template>

<style scoped>
.dashboard-page { display: grid; gap: 26px; }
.page-intro { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; }
.page-kicker, .panel-label { margin: 0 0 10px; color: var(--capri-red-soft); font-family: var(--capri-mono); font-size: 9px; letter-spacing: 0.14em; }
h1 { margin: 0; color: var(--capri-text); font-size: clamp(36px, 5vw, 66px); font-weight: 600; letter-spacing: -0.06em; line-height: 0.95; }
.page-summary { max-width: 42ch; margin: 16px 0 0; color: var(--capri-text-muted); font-size: 15px; }
.intro-actions { display: flex; align-items: center; gap: 18px; padding-bottom: 3px; }
.text-action { display: inline-flex; align-items: center; gap: 8px; color: var(--capri-cyan); font-family: var(--capri-mono); font-size: 10px; }
.text-action:hover { color: var(--capri-yellow); }
.dashboard-grid { display: grid; gap: 26px; }
.dashboard-grid-primary { grid-template-columns: minmax(0, 1.45fr) minmax(300px, 0.75fr); }
.section-panel { border: 1px solid var(--capri-line); background: var(--capri-panel); }
.activity-panel { padding: 22px; }
.panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; margin-bottom: 20px; }
.panel-heading h2 { margin: 0; color: var(--capri-text); font-size: 20px; font-weight: 500; letter-spacing: -0.03em; }
.panel-heading p { margin: 7px 0 0; color: var(--capri-text-muted); font-size: 12px; }
.panel-label { color: var(--capri-text-dim); }
.deck-panel { padding: 22px; }
.deck-panel .panel-heading { margin-bottom: 18px; }
.dashboard-footnote { display: flex; align-items: center; gap: 9px; color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 10px; }
.dashboard-footnote a { margin-left: auto; color: var(--capri-cyan); }
.dashboard-footnote a:hover { color: var(--capri-yellow); }
.is-cyan { background: var(--capri-cyan); box-shadow: 0 0 12px rgb(124 230 239 / 0.6); }
.scene-loading { display: grid; min-height: 310px; place-items: center; border: 1px solid var(--capri-line); color: var(--capri-text-muted); font-family: var(--capri-mono); font-size: 11px; }
@media (max-width: 980px) {
  .dashboard-grid-primary { grid-template-columns: 1fr; }
  .activity-panel { min-height: 0; }
}
@media (max-width: 620px) {
  .page-intro { display: block; }
  .intro-actions { justify-content: space-between; margin-top: 24px; }
  .activity-panel, .deck-panel { padding: 16px; }
  .dashboard-footnote { align-items: flex-start; line-height: 1.5; }
  .dashboard-footnote a { white-space: nowrap; }
}
</style>
