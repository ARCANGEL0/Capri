<script setup lang="ts">
import StatusPill from './StatusPill.vue'
import type { CapriSession } from '../types/dashboard'

const props = defineProps<{ sessions: CapriSession[]; selectedId?: string }>()
const emit = defineEmits<{ select: [session: CapriSession] }>()

const toneFor = (state: CapriSession['state']) => state === 'attention' ? 'yellow' : state === 'active' ? 'red' : state === 'waiting' ? 'cyan' : 'green'
const labelFor = (state: CapriSession['state']) => state === 'attention' ? 'ATTENTION' : state.toUpperCase()
</script>

<template>
  <div class="session-table" role="table" aria-label="Coding sessions">
    <div class="session-row session-head" role="row">
      <span>SESSION</span><span>LOCATION</span><span>HARNESS</span><span>LAST ACTIVITY</span><span aria-hidden="true" />
    </div>
    <button
      v-for="session in props.sessions"
      :key="session.id"
      class="session-row"
      :class="{ 'is-selected': selectedId === session.id, 'is-attention': session.state === 'attention' }"
      type="button"
      role="row"
      @click="emit('select', session)"
    >
      <span class="session-main">
        <span class="session-marker" :class="`is-${session.state}`" aria-hidden="true" />
        <span class="session-copy"><strong>{{ session.title }}</strong><small>{{ session.id }}</small></span>
        <span v-if="session.state === 'attention'" class="attention-label">! NEEDS APPROVAL</span>
      </span>
      <span class="session-location">{{ session.cwd }}</span>
      <span class="session-harness">{{ session.harness }}</span>
      <span class="session-time"><StatusPill :tone="toneFor(session.state)" :label="session.updatedAt" /><small v-if="session.unread">{{ session.unread }} unread</small></span>
      <span class="session-arrow" aria-hidden="true">↗</span>
    </button>
    <div v-if="!props.sessions.length" class="session-empty">No sessions match these filters.</div>
  </div>
</template>

<style scoped>
.session-table { overflow: hidden; border: 1px solid var(--capri-line); background: var(--capri-panel); }
.session-row { display: grid; grid-template-columns: minmax(230px, 1.35fr) minmax(220px, 1.3fr) 110px 120px 24px; align-items: center; gap: 16px; width: 100%; padding: 16px 18px; border: 0; border-bottom: 1px solid var(--capri-line); background: transparent; color: var(--capri-text-muted); text-align: left; transition: background var(--capri-transition), color var(--capri-transition); }
.session-row:last-child { border-bottom: 0; }
.session-row:not(.session-head):hover, .session-row.is-selected { background: rgb(255 51 85 / 0.08); color: var(--capri-text); }
.session-row.is-attention { border-left: 3px solid var(--capri-yellow); padding-left: 15px; }
.session-head { padding-top: 11px; padding-bottom: 11px; color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 9px; letter-spacing: 0.08em; }
.session-main { display: flex; min-width: 0; align-items: center; gap: 10px; }
.session-marker { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: var(--capri-green); box-shadow: 0 0 10px rgb(39 225 125 / 0.55); }
.session-marker.is-active { background: var(--capri-red); box-shadow: 0 0 10px rgb(255 51 85 / 0.55); }
.session-marker.is-attention { background: var(--capri-yellow); box-shadow: 0 0 10px rgb(255 201 90 / 0.55); }
.session-marker.is-waiting { background: var(--capri-cyan); box-shadow: 0 0 10px rgb(124 230 239 / 0.55); }
.session-marker.is-idle { background: var(--capri-text-dim); box-shadow: none; }
.session-copy { display: grid; min-width: 0; gap: 3px; }
.session-copy strong { overflow: hidden; color: var(--capri-text); font-family: var(--capri-mono); font-size: 13px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.session-copy small, .session-location, .session-time small { color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 10px; }
.attention-label { margin-left: auto; color: var(--capri-yellow); font-family: var(--capri-mono); font-size: 8px; letter-spacing: 0.06em; white-space: nowrap; }
.session-location { overflow: hidden; color: var(--capri-cyan); text-overflow: ellipsis; white-space: nowrap; }
.session-harness { color: var(--capri-text); font-family: var(--capri-mono); font-size: 10px; letter-spacing: 0.08em; }
.session-time { display: grid; justify-items: start; gap: 4px; }
.session-time :deep(.status-pill) { padding: 3px 6px; border: 0; background: transparent; }
.session-arrow { color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 16px; transition: color var(--capri-transition), transform var(--capri-transition); }
.session-row:hover .session-arrow { color: var(--capri-red-soft); transform: translate(2px, -2px); }
.session-empty { padding: 38px 20px; color: var(--capri-text-muted); font-family: var(--capri-mono); font-size: 11px; text-align: center; }
@media (max-width: 900px) {
  .session-head { display: none; }
  .session-row { grid-template-columns: minmax(0, 1fr) auto; gap: 9px 14px; padding: 15px; }
  .session-main { grid-column: 1 / -1; }
  .session-location { grid-column: 1 / 2; }
  .session-harness { grid-column: 2 / 3; grid-row: 2; justify-self: end; }
  .session-time { grid-column: 1 / 2; }
  .session-arrow { grid-column: 2 / 3; grid-row: 3; justify-self: end; }
  .attention-label { display: none; }
}
</style>
