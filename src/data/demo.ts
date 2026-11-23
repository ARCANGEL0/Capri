import type { CapriDevice, CapriSession, ChatMessage, RuntimeEvent } from '../types/dashboard'

export const demoDevices: CapriDevice[] = [
  {
    id: 'workstation-a',
    name: 'workstation-a',
    address: '100.64.12.18',
    platform: 'Linux · amd64',
    status: 'online',
    latency: 18,
    agents: ['codex', 'claude', 'nclaude'],
    sessions: 4,
    lastSeen: 'now',
  },
  {
    id: 'studio-node',
    name: 'studio-node',
    address: '100.64.12.24',
    platform: 'macOS · arm64',
    status: 'online',
    latency: 42,
    agents: ['codex', 'opencode'],
    sessions: 2,
    lastSeen: '2m ago',
  },
  {
    id: 'field-deck',
    name: 'field-deck',
    address: '100.64.12.31',
    platform: 'Android · arm64',
    status: 'degraded',
    latency: 138,
    agents: ['claude'],
    sessions: 1,
    lastSeen: '6m ago',
  },
]

export const demoSessions: CapriSession[] = [
  {
    id: '01a1d7b2-5',
    title: 'Runtime bridge cleanup',
    deviceId: 'workstation-a',
    agent: 'codex',
    harness: 'CODEX',
    cwd: '/workspace/capri',
    state: 'active',
    updatedAt: 'now',
    messageCount: 28,
    unread: 0,
  },
  {
    id: '01a1ff8e-0',
    title: 'Review the dashboard adapter',
    deviceId: 'workstation-a',
    agent: 'claude',
    harness: 'CLAUDE',
    cwd: '/workspace/apps/bridge',
    state: 'attention',
    updatedAt: '3h ago',
    messageCount: 64,
    unread: 2,
  },
  {
    id: '01a1fc74-8',
    title: 'Humanizer skill follow-up',
    deviceId: 'workstation-a',
    agent: 'codex',
    harness: 'CODEX',
    cwd: '/workspace/apps/ghost',
    state: 'waiting',
    updatedAt: '4h ago',
    messageCount: 19,
    unread: 1,
  },
  {
    id: '01a20ac5-b',
    title: 'Release checklist',
    deviceId: 'studio-node',
    agent: 'opencode',
    harness: 'OPENCODE',
    cwd: '/opt/projects/capri',
    state: 'idle',
    updatedAt: 'yesterday',
    messageCount: 11,
    unread: 0,
  },
]

export const demoMessages: Record<string, ChatMessage[]> = {
  '01a1d7b2-5': [
    { id: 'm1', role: 'user', text: 'Trace the runtime reconnect path and fix the stale session state.', timestamp: '09:18' },
    { id: 'm2', role: 'activity', text: 'Reading src/even.ts', timestamp: '09:19', activity: 'read file' },
    { id: 'm3', role: 'agent', text: 'The reconnect path was rebuilding the page before the device state settled. I moved the refresh behind the runtime handshake and kept the last session id until the new list arrives.', timestamp: '09:20' },
    { id: 'm4', role: 'activity', text: 'Running typecheck', timestamp: '09:21', activity: 'npm run build' },
    { id: 'm5', role: 'agent', text: 'The build passes. I’m checking the approval path next so a pending request survives a reconnect.', timestamp: '09:22' },
  ],
  '01a1ff8e-0': [
    { id: 'm6', role: 'user', text: 'Review the dashboard adapter and call out anything that would break remote sessions.', timestamp: '06:42' },
    { id: 'm7', role: 'agent', text: 'I found one approval prompt waiting in the runtime. The adapter can continue after it is answered.', timestamp: '06:45' },
    { id: 'm8', role: 'activity', text: 'Approval required for shell command', timestamp: '06:45', activity: 'needs approval' },
  ],
}

export const demoEvents: RuntimeEvent[] = [
  { id: 'e1', kind: 'approval', title: 'Approval needed', detail: 'workstation-a · Review the dashboard adapter', timestamp: '3m', tone: 'yellow' },
  { id: 'e2', kind: 'session', title: 'Agent replied', detail: 'workstation-a · Runtime bridge cleanup', timestamp: '8m', tone: 'cyan' },
  { id: 'e3', kind: 'device', title: 'Deck signal recovered', detail: 'studio-node · 42ms round trip', timestamp: '14m', tone: 'green' },
  { id: 'e4', kind: 'deploy', title: 'Runtime restarted', detail: 'field-deck · 100.64.12.31', timestamp: '22m', tone: 'red' },
]
