<script setup lang="ts">
const runtime = useRuntimeApi()
const label = computed(() => runtime.status.value === 'online' ? 'RUNTIME ONLINE' : runtime.status.value === 'checking' ? 'CHECKING RUNTIME' : runtime.status.value === 'offline' ? 'RUNTIME OFFLINE' : 'DEMO RUNTIME')
const tone = computed(() => runtime.status.value === 'online' ? 'is-green' : runtime.status.value === 'offline' ? 'is-red' : runtime.status.value === 'checking' ? 'is-yellow' : 'is-cyan')
const title = computed(() => runtime.lastChecked.value ? `Checked ${runtime.lastChecked.value}` : 'Check runtime connection')

onMounted(() => {
  runtime.loadPairing()
  void runtime.check()
})
</script>

<template>
  <button class="runtime-status" type="button" :title="title" @click="runtime.check">
    <span class="status-pip" :class="tone" />{{ label }}
  </button>
</template>

<style scoped>
.runtime-status { display: inline-flex; align-items: center; gap: 7px; padding: 0; border: 0; color: var(--capri-cyan); background: transparent; font-family: var(--capri-mono); font-size: 10px; letter-spacing: .08em; }
.runtime-status:hover { color: var(--capri-yellow); }
.status-pip { width: 7px; height: 7px; border-radius: 999px; }
.is-green { background: var(--capri-green); box-shadow: 0 0 12px rgb(85 230 154 / .7); }
.is-yellow { background: var(--capri-yellow); box-shadow: 0 0 12px rgb(255 209 102 / .6); }
.is-red { background: var(--capri-red); box-shadow: 0 0 12px rgb(255 51 85 / .6); }
.is-cyan { background: var(--capri-cyan); box-shadow: 0 0 12px rgb(124 230 239 / .6); }
</style>
