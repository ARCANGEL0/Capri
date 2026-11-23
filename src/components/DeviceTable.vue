<script setup lang="ts">
import IconGlyph from './IconGlyph.vue'
import StatusPill from './StatusPill.vue'
import type { CapriDevice } from '../types/dashboard'

defineProps<{ devices: CapriDevice[]; selectedId?: string }>()
const emit = defineEmits<{ select: [device: CapriDevice] }>()

const toneFor = (status: CapriDevice['status']) => status === 'online' ? 'green' : status === 'degraded' ? 'yellow' : 'red'
const labelFor = (status: CapriDevice['status']) => status === 'online' ? 'ONLINE' : status === 'degraded' ? 'DEGRADED' : 'OFFLINE'
</script>

<template>
  <div class="device-table" role="table" aria-label="Connected cyberdecks">
    <div class="device-row device-head" role="row">
      <span>DECK</span><span>TAILSCALE ADDRESS</span><span>AGENTS</span><span>STATUS</span><span aria-hidden="true" />
    </div>
    <button v-for="device in devices" :key="device.id" class="device-row" :class="{ 'is-selected': selectedId === device.id }" type="button" role="row" @click="emit('select', device)">
      <span class="device-name"><span class="row-index">{{ String(devices.indexOf(device) + 1).padStart(2, '0') }}</span><strong>{{ device.name }}</strong></span>
      <span class="device-address">{{ device.address }}<small>{{ device.platform }}</small></span>
      <span class="device-agents"><span v-for="agent in device.agents" :key="agent" class="agent-chip">{{ agent }}</span></span>
      <StatusPill :tone="toneFor(device.status)" :label="labelFor(device.status)" />
      <span class="device-arrow"><IconGlyph name="arrow-right" :size="16" /></span>
    </button>
  </div>
</template>

<style scoped>
.device-table { overflow: hidden; border: 1px solid var(--capri-line); background: var(--capri-panel); }
.device-row { display: grid; grid-template-columns: 1.1fr 1.3fr 1fr 0.85fr 28px; align-items: center; gap: 16px; width: 100%; padding: 17px 18px; border: 0; border-bottom: 1px solid var(--capri-line); background: transparent; color: var(--capri-text-muted); text-align: left; transition: background var(--capri-transition), color var(--capri-transition); }
.device-row:last-child { border-bottom: 0; }
.device-row:not(.device-head):hover, .device-row.is-selected { background: rgb(255 51 85 / 0.08); color: var(--capri-text); }
.device-head { padding-top: 11px; padding-bottom: 11px; color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 9px; letter-spacing: 0.08em; }
.device-name { display: flex; align-items: center; gap: 12px; min-width: 0; color: var(--capri-text); font-family: var(--capri-mono); font-size: 14px; }
.row-index { color: var(--capri-red); font-size: 10px; }
.device-address { color: var(--capri-cyan); font-family: var(--capri-mono); font-size: 12px; }
.device-address small { display: block; margin-top: 4px; color: var(--capri-text-dim); font-family: var(--capri-sans); font-size: 10px; }
.device-agents { display: flex; flex-wrap: wrap; gap: 5px; }
.agent-chip { padding: 4px 6px; border: 1px solid var(--capri-line); color: var(--capri-text-muted); font-family: var(--capri-mono); font-size: 9px; text-transform: uppercase; }
.device-arrow { color: var(--capri-text-dim); transition: color var(--capri-transition), transform var(--capri-transition); }
.device-row:hover .device-arrow { color: var(--capri-red-soft); transform: translateX(3px); }
@media (max-width: 850px) {
  .device-head { display: none; }
  .device-row { grid-template-columns: 1fr auto; gap: 10px; padding: 15px; }
  .device-address, .device-agents { grid-column: 1 / 2; }
  .device-address { font-size: 11px; }
  .device-row > :nth-child(3) { grid-column: 1 / 2; }
  .device-row > :nth-child(4) { grid-column: 2 / 3; grid-row: 1 / 3; align-self: start; }
  .device-arrow { grid-column: 2 / 3; grid-row: 3; justify-self: end; }
}
</style>
