<script setup lang="ts">
import IconGlyph from './IconGlyph.vue'
import RuntimeStatusBar from './RuntimeStatusBar.vue'
import type { NavItem } from '../types/dashboard'

const route = useRoute()
const dashboard = useDashboard()
const { onlineDevices, activeSessions } = dashboard

const navItems: NavItem[] = [
  { label: 'Overview', to: '/', icon: 'grid' },
  { label: 'Sessions', to: '/sessions', icon: 'stack' },
  { label: 'Terminal', to: '/terminal', icon: 'terminal' },
  { label: 'Setup', to: '/setup', icon: 'link' },
  { label: 'Settings', to: '/settings', icon: 'sliders' },
]

function isActive(item: NavItem) {
  if (item.to === '/') return route.path === '/'
  return route.path.startsWith(item.to)
}

onMounted(() => {
  void dashboard.syncRuntime()
})
</script>

<template>
  <div class="app-frame">
    <aside class="side-rail">
      <NuxtLink to="/" class="brand-lockup" aria-label="Capri overview">
        <span class="brand-mark" aria-hidden="true"><span class="brand-mark-core" /></span>
        <span class="brand-word">CAPRI</span>
      </NuxtLink>

      <div class="rail-caption">REMOTE CONTROL / 01</div>
      <nav class="primary-nav" aria-label="Primary navigation">
        <NuxtLink v-for="item in navItems" :key="item.to" :to="item.to" class="nav-link" :class="{ 'is-active': isActive(item) }">
          <IconGlyph :name="item.icon" :size="17" />
          <span>{{ item.label }}</span>
        </NuxtLink>
      </nav>

      <div class="rail-spacer" />
      <div class="rail-status">
        <span class="status-pip is-green" />
        <div><strong>{{ onlineDevices.length }} decks online</strong><span>{{ activeSessions.length }} active sessions</span></div>
      </div>
      <div class="rail-version">CAPRI WEB / ALPHA</div>
    </aside>

    <main class="app-main">
      <header class="topbar">
        <div class="topbar-route"><span class="route-slash">/</span><span>{{ navItems.find(item => isActive(item))?.label ?? 'Overview' }}</span></div>
        <div class="topbar-right">
          <RuntimeStatusBar />
          <button class="icon-button" type="button" aria-label="Notifications"><IconGlyph name="bell" :size="17" /><span class="notification-dot" /></button>
          <button class="avatar-button" type="button" aria-label="Open account menu">HA</button>
        </div>
      </header>

      <div class="page-wrap">
        <slot />
      </div>
    </main>

    <nav class="mobile-nav" aria-label="Mobile navigation">
      <NuxtLink v-for="item in navItems.slice(0, 4)" :key="item.to" :to="item.to" class="mobile-nav-link" :class="{ 'is-active': isActive(item) }">
        <IconGlyph :name="item.icon" :size="18" /><span>{{ item.label }}</span>
      </NuxtLink>
    </nav>
  </div>
</template>

<style scoped>
.app-frame { display: flex; min-height: 100vh; }
.side-rail { position: fixed; inset: 0 auto 0 0; z-index: 5; display: flex; flex-direction: column; width: 230px; padding: 28px 18px 22px; border-right: 1px solid var(--capri-line); background: rgb(8 9 11 / 0.94); }
.brand-lockup { display: inline-flex; align-items: center; gap: 10px; color: var(--capri-text); letter-spacing: 0.12em; }
.brand-word { font-family: var(--capri-mono); font-size: 15px; font-weight: 500; }
.brand-mark { position: relative; width: 22px; height: 22px; border: 1px solid var(--capri-red); transform: rotate(30deg); }
.brand-mark::before, .brand-mark::after { position: absolute; content: ''; background: var(--capri-ink); }
.brand-mark::before { inset: 4px -1px; }
.brand-mark::after { inset: -1px 4px; }
.brand-mark-core { position: absolute; z-index: 1; inset: 7px; background: var(--capri-red); }
.rail-caption { margin: 56px 8px 14px; color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 9px; letter-spacing: 0.14em; }
.primary-nav { display: grid; gap: 4px; }
.nav-link { display: flex; align-items: center; gap: 12px; padding: 11px 12px; border: 1px solid transparent; color: var(--capri-text-muted); font-size: 13px; transition: background var(--capri-transition), color var(--capri-transition), border-color var(--capri-transition); }
.nav-link:hover { color: var(--capri-text); border-color: var(--capri-line); background: var(--capri-panel); }
.nav-link.is-active { color: var(--capri-text); border-color: var(--capri-red-dim); background: rgb(255 51 85 / 0.1); }
.nav-link.is-active :deep(.icon-glyph) { color: var(--capri-red-soft); }
.rail-spacer { flex: 1; }
.rail-status { display: flex; align-items: flex-start; gap: 10px; padding: 14px 10px; border-top: 1px solid var(--capri-line); color: var(--capri-text-muted); font-family: var(--capri-mono); font-size: 10px; line-height: 1.6; }
.rail-status strong, .rail-status span { display: block; }
.rail-status strong { color: var(--capri-text); font-weight: 400; }
.rail-version { margin: 15px 10px 0; color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 9px; }
.app-main { flex: 1; min-width: 0; margin-left: 230px; }
.topbar { position: sticky; top: 0; z-index: 4; display: flex; align-items: center; justify-content: space-between; min-height: 70px; padding: 0 32px; border-bottom: 1px solid var(--capri-line); background: rgb(8 9 11 / 0.88); backdrop-filter: blur(14px); }
.topbar-route { color: var(--capri-text); font-family: var(--capri-mono); font-size: 12px; letter-spacing: 0.04em; }
.route-slash { margin-right: 10px; color: var(--capri-red); }
.topbar-right { display: flex; align-items: center; gap: 18px; }
.network-state { display: inline-flex; align-items: center; gap: 7px; color: var(--capri-cyan); font-family: var(--capri-mono); font-size: 10px; letter-spacing: 0.08em; }
.status-pip { display: inline-block; width: 7px; height: 7px; border-radius: 999px; }
.is-green { background: var(--capri-green); box-shadow: 0 0 12px rgb(85 230 154 / 0.7); }
.is-yellow { background: var(--capri-yellow); box-shadow: 0 0 12px rgb(255 209 102 / 0.6); }
.is-red { background: var(--capri-red); box-shadow: 0 0 12px rgb(255 51 85 / 0.6); }
.icon-button, .avatar-button { display: grid; place-items: center; border: 1px solid var(--capri-line); background: var(--capri-panel); color: var(--capri-text-muted); }
.icon-button { position: relative; width: 34px; height: 34px; }
.icon-button:hover { color: var(--capri-text); border-color: var(--capri-line-bright); }
.notification-dot { position: absolute; top: 7px; right: 7px; width: 5px; height: 5px; border-radius: 99px; background: var(--capri-red); }
.avatar-button { width: 34px; height: 34px; color: var(--capri-text); font-family: var(--capri-mono); font-size: 10px; }
.page-wrap { width: var(--capri-content); margin: 0 auto; padding: 52px 0 72px; }
.mobile-nav { display: none; }

@media (max-width: 800px) {
  .side-rail { display: none; }
  .app-main { margin-left: 0; padding-bottom: 70px; }
  .topbar { min-height: 58px; padding: 0 18px; }
  .topbar-right { gap: 10px; }
  .network-state { font-size: 9px; }
  .topbar-route { font-size: 11px; }
  .page-wrap { width: min(100% - 32px, 640px); padding: 32px 0 44px; }
  .mobile-nav { position: fixed; inset: auto 0 0; z-index: 10; display: grid; grid-template-columns: repeat(4, 1fr); padding: 8px 8px max(8px, env(safe-area-inset-bottom)); border-top: 1px solid var(--capri-line); background: rgb(8 9 11 / 0.96); backdrop-filter: blur(14px); }
  .mobile-nav-link { display: grid; justify-items: center; gap: 4px; padding: 7px 2px; color: var(--capri-text-dim); font-family: var(--capri-mono); font-size: 8px; }
  .mobile-nav-link.is-active { color: var(--capri-red-soft); }
}
</style>
