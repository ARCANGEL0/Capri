<script setup lang="ts">
const props = withDefaults(defineProps<{ name: string; size?: number }>(), { size: 18 })
</script>

<template>
  <svg class="icon-glyph" :width="props.size" :height="props.size" viewBox="0 0 24 24" aria-hidden="true">
    <path v-if="props.name === 'grid'" d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
    <path v-else-if="props.name === 'stack'" d="m12 4 8 4-8 4-8-4 8-4Zm-8 8 8 4 8-4M4 16l8 4 8-4" />
    <path v-else-if="props.name === 'terminal'" d="m5 7 5 5-5 5M13 17h6" />
    <path v-else-if="props.name === 'sliders'" d="M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4" />
    <path v-else-if="props.name === 'link'" d="M9 15 7 17a4 4 0 0 1-6-6l3-3a4 4 0 0 1 6 0M15 9l2-2a4 4 0 1 1 6 6l-3 3a4 4 0 0 1-6 0M8 16l8-8" />
    <path v-else-if="props.name === 'arrow-right'" d="M4 12h15M13 6l6 6-6 6" />
    <path v-else-if="props.name === 'arrow-up-right'" d="M5 19 19 5M9 5h10v10" />
    <path v-else-if="props.name === 'search'" d="m20 20-4.5-4.5M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
    <path v-else-if="props.name === 'bell'" d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    <path v-else-if="props.name === 'chevron-down'" d="m6 9 6 6 6-6" />
    <path v-else d="M12 3v18M3 12h18" />
  </svg>
</template>

<style scoped>
.icon-glyph {
  display: block;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.65;
}
</style>
