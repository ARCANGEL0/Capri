<script setup lang="ts">
const props = withDefaults(defineProps<{ tone?: 'green' | 'yellow' | 'red' | 'cyan'; label: string }>(), { tone: 'cyan' })
</script>

<template>
  <span class="status-pill" :class="`tone-${props.tone}`"><span class="status-pip" />{{ props.label }}</span>
</template>

<style scoped>
.status-pill { display: inline-flex; align-items: center; gap: 7px; width: fit-content; padding: 5px 8px; border: 1px solid var(--capri-line); color: var(--capri-text-muted); font-family: var(--capri-mono); font-size: 9px; letter-spacing: 0.06em; }
.status-pip { width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
.tone-green { color: var(--capri-green); }
.tone-yellow { color: var(--capri-yellow); }
.tone-red { color: var(--capri-red-soft); }
.tone-cyan { color: var(--capri-cyan); }
</style>
