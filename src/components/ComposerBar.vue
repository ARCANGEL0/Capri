<script setup lang="ts">
const props = withDefaults(defineProps<{ disabled?: boolean; placeholder?: string }>(), { placeholder: 'Send a message to the harness' })
const emit = defineEmits<{ send: [value: string] }>()
const draft = ref('')

function submit() {
  const value = draft.value.trim()
  if (!value || props.disabled) return
  emit('send', value)
  draft.value = ''
}
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <label class="composer-input"><span class="composer-mark" aria-hidden="true">›</span><input v-model="draft" :disabled="disabled" :placeholder="placeholder" aria-label="Message harness" @keydown.enter.exact.prevent="submit" /></label>
    <button class="send-button" type="submit" :disabled="disabled || !draft.trim()">Send <span>↗</span></button>
  </form>
</template>

<style scoped>
.composer { display: flex; gap: 8px; padding: 10px; border: 1px solid var(--capri-line); background: var(--capri-panel); }
.composer-input { display: flex; min-width: 0; flex: 1; align-items: center; gap: 9px; padding: 0 11px; border: 1px solid var(--capri-line); background: var(--capri-panel-raised); }
.composer-mark { color: var(--capri-red); font-family: var(--capri-mono); font-size: 18px; }
.composer-input input { min-width: 0; width: 100%; height: 40px; border: 0; outline: 0; color: var(--capri-text); background: transparent; font-family: var(--capri-mono); font-size: 11px; }
.composer-input input::placeholder { color: var(--capri-text-dim); }
.composer-input:focus-within { border-color: var(--capri-cyan); }
.send-button { min-width: 82px; border: 1px solid var(--capri-red); color: var(--capri-text); background: var(--capri-red); font-family: var(--capri-mono); font-size: 10px; }
.send-button:hover:not(:disabled) { border-color: var(--capri-yellow); color: var(--capri-ink); background: var(--capri-yellow); }
.send-button:disabled { cursor: not-allowed; opacity: 0.38; }
@media (max-width: 460px) {
  .composer { padding: 8px; }
  .send-button { min-width: 62px; }
  .send-button span { display: none; }
}
</style>
