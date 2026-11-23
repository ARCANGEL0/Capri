<script setup lang="ts">
import IconGlyph from './IconGlyph.vue'
import type { RuntimeEvent } from '../types/dashboard'

defineProps<{ events: RuntimeEvent[] }>()
</script>

<template>
  <div class="activity-feed">
    <div v-for="event in events" :key="event.id" class="activity-row">
      <span class="activity-mark" :class="`tone-${event.tone}`"><IconGlyph :name="event.kind === 'approval' ? 'bell' : event.kind === 'device' ? 'link' : 'arrow-up-right'" :size="14" /></span>
      <div class="activity-copy"><strong>{{ event.title }}</strong><span>{{ event.detail }}</span></div>
      <time>{{ event.timestamp }}</time>
    </div>
  </div>
</template>

<style scoped>
.activity-feed { display: grid; border-top: 1px solid var(--capri-line); }
.activity-row { display: grid; grid-template-columns: 30px 1fr auto; align-items: center; gap: 12px; padding: 14px 0; border-bottom: 1px solid var(--capri-line); }
.activity-mark { display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid currentColor; }
.activity-copy { display: grid; gap: 4px; min-width: 0; }
.activity-copy strong { color: var(--capri-text); font-size: 12px; font-weight: 500; }
.activity-copy span, .activity-row time { color: var(--capri-text-muted); font-family: var(--capri-mono); font-size: 10px; }
.activity-row time { color: var(--capri-text-dim); }
.tone-red { color: var(--capri-red-soft); }
.tone-cyan { color: var(--capri-cyan); }
.tone-green { color: var(--capri-green); }
.tone-yellow { color: var(--capri-yellow); }
</style>
