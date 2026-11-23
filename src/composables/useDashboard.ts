import { demoDevices, demoEvents, demoMessages, demoSessions } from '../data/demo'
import type { AgentId, CapriDevice, CapriSession, CapriSettings, ChatMessage, RuntimeEvent } from '../types/dashboard'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function useDashboard() {
  const runtime = useRuntimeApi()
  const devices = useState<CapriDevice[]>('capri-devices', () => clone(demoDevices))
  const sessions = useState<CapriSession[]>('capri-sessions', () => clone(demoSessions))
  const messages = useState<Record<string, ChatMessage[]>>('capri-messages', () => clone(demoMessages))
  const events = useState<RuntimeEvent[]>('capri-events', () => clone(demoEvents))
  const settings = useState<CapriSettings>('capri-settings', () => ({
    defaultDevice: 'workstation-a',
    defaultAgent: 'codex',
    autoFollow: true,
    compactOutput: true,
    notifications: true,
  }))
  const selectedDeviceId = useState('capri-selected-device', () => 'workstation-a')
  const selectedSessionId = useState('capri-selected-session', () => '01a1d7b2-5')

  const onlineDevices = computed(() => devices.value.filter(device => device.status !== 'offline'))
  const activeSessions = computed(() => sessions.value.filter(session => session.state === 'active' || session.state === 'waiting'))
  const selectedDevice = computed(() => devices.value.find(device => device.id === selectedDeviceId.value) ?? devices.value[0])
  const selectedSession = computed(() => sessions.value.find(session => session.id === selectedSessionId.value) ?? sessions.value[0])
  const selectedMessages = computed(() => messages.value[selectedSessionId.value] ?? [])

  function deviceById(id: string) {
    return devices.value.find(device => device.id === id)
  }

  function sessionsForDevice(deviceId: string) {
    return sessions.value.filter(session => session.deviceId === deviceId)
  }

  function selectDevice(id: string) {
    if (deviceById(id)) selectedDeviceId.value = id
  }

  function selectSession(id: string) {
    if (sessions.value.some(session => session.id === id)) selectedSessionId.value = id
  }

  function sendMessage(text: string) {
    const content = text.trim()
    if (!content || !selectedSession.value) return
    const id = `local-${Date.now()}`
    const next: ChatMessage = { id, role: 'user', text: content, timestamp: 'now' }
    messages.value[selectedSession.value.id] = [...(messages.value[selectedSession.value.id] ?? []), next]
    const session = selectedSession.value
    sessions.value = sessions.value.map(item => item.id === session.id ? { ...item, state: 'active', updatedAt: 'now', messageCount: item.messageCount + 1 } : item)
  }

  function setDefaultAgent(agent: AgentId) {
    settings.value = { ...settings.value, defaultAgent: agent }
  }

  function toggleSetting(key: 'autoFollow' | 'compactOutput' | 'notifications') {
    settings.value = { ...settings.value, [key]: !settings.value[key] }
  }

  async function syncRuntime() {
    if (!runtime.endpoint.value || !runtime.token.value || !import.meta.client) return false
    const headers = { Authorization: `Bearer ${runtime.token.value}` }
    try {
      const [deviceResponse, sessionResponse] = await Promise.all([
        fetch(`${runtime.endpoint.value}/api/v1/devices`, { headers, cache: 'no-store' }),
        fetch(`${runtime.endpoint.value}/api/v1/sessions`, { headers, cache: 'no-store' }),
      ])
      if (!deviceResponse.ok || !sessionResponse.ok) throw new Error('Runtime data request failed')
      const devicePayload = await deviceResponse.json() as { devices?: Array<{ name?: string; ip?: string; online?: boolean }> }
      const sessionPayload = await sessionResponse.json() as { sessions?: Array<{ id?: string; agent?: string; title?: string; cwd?: string; updatedAt?: number }> }
      const liveDevices: CapriDevice[] = (devicePayload.devices ?? []).map((device, index) => ({
        id: device.name || `deck-${index + 1}`,
        name: device.name || `deck-${index + 1}`,
        address: device.ip || 'unresolved',
        platform: 'Tailscale peer',
        status: device.online === false ? 'offline' : 'online',
        latency: 0,
        agents: [],
        sessions: 0,
        lastSeen: device.online === false ? 'offline' : 'now',
      }))
      if (liveDevices.length) devices.value = liveDevices
      const fallbackDevice = liveDevices[0]?.id ?? selectedDeviceId.value
      const liveSessions: CapriSession[] = (sessionPayload.sessions ?? []).map((item, index) => ({
        id: item.id || `runtime-${index + 1}`,
        title: item.title || 'Untitled session',
        deviceId: fallbackDevice,
        agent: (item.agent || 'codex') as AgentId,
        harness: (item.agent || 'codex').toUpperCase(),
        cwd: item.cwd || 'remote workspace',
        state: 'idle',
        updatedAt: item.updatedAt ? new Date(item.updatedAt * (item.updatedAt < 1_000_000_000_000 ? 1000 : 1)).toLocaleString() : 'now',
        messageCount: 0,
        unread: 0,
      }))
      if (liveSessions.length) sessions.value = liveSessions
      runtime.status.value = 'online'
      return true
    } catch {
      runtime.status.value = 'offline'
      return false
    }
  }

  return {
    devices,
    sessions,
    messages,
    events,
    settings,
    selectedDeviceId,
    selectedSessionId,
    onlineDevices,
    activeSessions,
    selectedDevice,
    selectedSession,
    selectedMessages,
    deviceById,
    sessionsForDevice,
    selectDevice,
    selectSession,
    sendMessage,
    setDefaultAgent,
    toggleSetting,
    syncRuntime,
  }
}
