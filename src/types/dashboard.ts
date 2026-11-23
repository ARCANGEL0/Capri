export type AgentId = 'codex' | 'claude' | 'nclaude' | 'opencode' | 'cline'

export type DeviceStatus = 'online' | 'degraded' | 'offline'

export type CapriDevice = {
  id: string
  name: string
  address: string
  platform: string
  status: DeviceStatus
  latency: number
  agents: AgentId[]
  sessions: number
  lastSeen: string
}

export type SessionState = 'active' | 'waiting' | 'attention' | 'idle'

export type CapriSession = {
  id: string
  title: string
  deviceId: string
  agent: AgentId
  harness: string
  cwd: string
  state: SessionState
  updatedAt: string
  messageCount: number
  unread: number
}

export type ChatMessage = {
  id: string
  role: 'user' | 'agent' | 'activity'
  text: string
  timestamp: string
  activity?: string
}

export type RuntimeEvent = {
  id: string
  kind: 'session' | 'device' | 'approval' | 'deploy'
  title: string
  detail: string
  timestamp: string
  tone: 'red' | 'cyan' | 'green' | 'yellow'
}

export type CapriSettings = {
  defaultDevice: string
  defaultAgent: AgentId
  autoFollow: boolean
  compactOutput: boolean
  notifications: boolean
}

export type NavItem = {
  label: string
  to: string
  icon: string
}
