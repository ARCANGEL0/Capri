<script setup lang="ts">
defineProps<{
  command: string
  prompt?: string
  options: string[]
  busy?: boolean
}>()

const emit = defineEmits<{ choose: [option: string] }>()
</script>

<template>
  <section class="approval-banner" aria-labelledby="approval-title">
    <div class="approval-heading">
      <span class="approval-mark" aria-hidden="true">!</span>
      <div><p id="approval-title">NEEDS APPROVAL</p><h2>{{ prompt || 'The harness is waiting for a decision.' }}</h2></div>
    </div>
    <pre class="approval-command"><code>$ {{ command }}</code></pre>
    <div class="approval-options" role="group" aria-label="Approval choices">
      <button v-for="option in options" :key="option" type="button" :disabled="busy" @click="emit('choose', option)">{{ option }}</button>
    </div>
  </section>
</template>

<style scoped>
.approval-banner { display: grid; gap: 15px; padding: 18px; border: 1px solid var(--capri-yellow); background: rgb(255 201 90 / 0.07); }
.approval-heading { display: flex; align-items: flex-start; gap: 12px; }
.approval-mark { display: grid; width: 22px; height: 22px; flex: 0 0 auto; place-items: center; border: 1px solid var(--capri-yellow); color: var(--capri-ink); background: var(--capri-yellow); font-family: var(--capri-mono); font-size: 13px; font-weight: 700; }
.approval-heading p { margin: 0 0 5px; color: var(--capri-yellow); font-family: var(--capri-mono); font-size: 9px; letter-spacing: 0.15em; }
.approval-heading h2 { margin: 0; color: var(--capri-text); font-size: 15px; font-weight: 500; }
.approval-command { overflow-x: auto; margin: 0; padding: 13px; border: 1px solid var(--capri-line); color: var(--capri-cyan); background: var(--capri-panel-raised); font-family: var(--capri-mono); font-size: 11px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.approval-options { display: flex; flex-wrap: wrap; gap: 8px; }
.approval-options button { padding: 9px 12px; border: 1px solid var(--capri-yellow); color: var(--capri-yellow); background: transparent; font-family: var(--capri-mono); font-size: 10px; }
.approval-options button:hover:not(:disabled) { color: var(--capri-ink); background: var(--capri-yellow); }
.approval-options button:disabled { cursor: wait; opacity: 0.5; }
</style>
