<script setup lang="ts">
import type { ChatMessage } from '../types/dashboard'

const props = withDefaults(defineProps<{ messages: ChatMessage[]; showUser?: boolean }>(), { showUser: false })
const visibleMessages = computed(() => props.messages.filter(message => message.role === 'agent' || (props.showUser && message.role === 'user')))
</script>

<template>
  <div class="transcript" aria-live="polite">
    <div v-if="!visibleMessages.length" class="transcript-empty">No model replies have arrived yet.</div>
    <article v-for="message in visibleMessages" :key="message.id" class="message" :class="`is-${message.role}`">
      <p class="message-text">{{ message.text }}</p>
      <time>{{ message.timestamp }}</time>
    </article>
  </div>
</template>

<style scoped>
.transcript { display: grid; gap: 18px; max-height: min(62vh, 720px); overflow: auto; padding: 2px 4px 4px 0; }
.message { max-width: min(760px, 92%); padding: 14px 16px; border-left: 2px solid var(--capri-cyan); background: var(--capri-panel-raised); }
.message.is-user { margin-left: auto; border-left: 0; border-right: 2px solid var(--capri-red); background: rgb(255 51 85 / 0.08); }
.message-text { margin: 0; color: var(--capri-text); font-size: 14px; line-height: 1.65; white-space: pre-wrap; overflow-wrap: anywhere; }
.message time { display: block; margin-top: 9px; color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 9px; }
.transcript-empty { padding: 42px 18px; color: var(--capri-text-muted); font-family: var(--capri-mono); font-size: 11px; text-align: center; }
@media (max-width: 600px) {
  .transcript { max-height: none; }
  .message { max-width: 100%; padding: 12px 13px; }
  .message-text { font-size: 13px; }
}
</style>
