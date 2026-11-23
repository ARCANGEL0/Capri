<script setup lang="ts">
defineProps<{ devices: number; online: number; active: number; attention: number }>()
</script>

<template>
  <div class="metric-strip" aria-label="Network summary">
    <div class="metric"><span class="metric-label">LINKED DECKS</span><strong>{{ devices }}</strong><span class="metric-note">private tailnet</span></div>
    <div class="metric"><span class="metric-label">ONLINE NOW</span><strong class="tone-green">{{ online }}</strong><span class="metric-note">stable routes</span></div>
    <div class="metric"><span class="metric-label">ACTIVE SESSIONS</span><strong>{{ active }}</strong><span class="metric-note">agent workspaces</span></div>
    <div class="metric metric-alert"><span class="metric-label">ATTENTION</span><strong class="tone-yellow">{{ attention }}</strong><span class="metric-note">needs a decision</span></div>
  </div>
</template>

<style scoped>
.metric-strip { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--capri-line); background: var(--capri-panel); }
.metric { display: grid; gap: 6px; min-height: 104px; padding: 18px; border-right: 1px solid var(--capri-line); }
.metric:last-child { border-right: 0; }
.metric-label, .metric-note { color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 9px; letter-spacing: 0.08em; }
.metric strong { color: var(--capri-text); font-family: var(--capri-mono); font-size: 26px; font-weight: 400; line-height: 1; }
.metric-note { color: var(--capri-text-muted); letter-spacing: 0; }
.tone-green { color: var(--capri-green) !important; }
.tone-yellow { color: var(--capri-yellow) !important; }
@media (max-width: 650px) {
  .metric-strip { grid-template-columns: repeat(2, 1fr); }
  .metric:nth-child(2) { border-right: 0; }
  .metric:nth-child(-n + 2) { border-bottom: 1px solid var(--capri-line); }
}
</style>
