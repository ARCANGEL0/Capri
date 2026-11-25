import {
  AudioInputSource,
  waitForEvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'
import { pxTruncate } from '@evenrealities/pretext'
import { detectInteractivePrompt, presentAgentScreen, type InteractivePrompt } from './agent-presentation'
import { TerminalScreen } from './terminal-screen'
import { connectCapriRuntime, type CapriRuntime } from './even'
import { isSttReady, parseSttSettings, transcribe, type SttSettings } from './stt'
import { Hud, type HudView } from './glasses/hud/display'
import { SPLASH_LAYOUT } from './glasses/hud/layouts'
import {
  PhoneUI,
  readSettings,
  writeSettings,
  type PhoneSnapshot,
  type PhoneRuntimeDevice,
  type CapriSettings,
} from './phone-ui'
import './style.css'

type Screen = 'devices' | 'session-choice' | 'new_agent' | 'new_session' | 'resume' | 'runtimes' | 'chat' | 'review' | 'approval' | 'terminal' | 'more'
type Device = { name: string; ip: string; sshHost?: string; os?: string; sshEligible?: boolean; online: boolean; baseUrl: string; token?: string; available: boolean; checking?: boolean; capriHost?: boolean; configuredName?: string; sshAvailable?: boolean; controllerName?: string }
type Agent = { id: string; name: string; available: boolean; runtimes?: string[] }
type SessionInfo = { id: string; agent: string; title: string; updatedAt?: number; runtime?: string; cwd?: string; needsApproval?: boolean }
type Approval = { agent: string; prompt: string; options: Array<{ id: string; label: string }> }
type Row = { label: string; action: string; value?: string; detail?: string; activity?: string; approval?: boolean }
type ChatLine = { kind: 'out' | 'in' | 'sys'; text: string; timestamp?: number }
type ApiBody = BodyInit | Record<string, unknown>
type ApiInit = Omit<RequestInit, 'body'> & { body?: ApiBody; timeoutMs?: number }

const API_TOKEN = import.meta.env.VITE_CAPRI_RUNTIME_TOKEN ?? ''
const RUNTIME_DEVICES_KEY = 'capri.runtime.devices.v1'
const PHONE_STORAGE_KEYS = [
  RUNTIME_DEVICES_KEY,
  'capri.phone.settings.v1',
  'capri.phone.commands.v1',
  'capri.stt.settings.v1',
  'capri.runtime-sessions.v1',
  'capri.chat-transcripts.v1',
  'capri.approval-sessions.v1',
]
const LIST_PAGE_SIZE = 5
const MAX_HISTORY = 500
const DEFAULT_VISIBLE_CHAT_LINES = 7

const SPLASH_FRAME_MS = 90
const SPLASH_FRAMES = 5

let phoneUI: PhoneUI | undefined
let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>> | undefined
let runtime: CapriRuntime | undefined
let hud: Hud | undefined
let unsubscribeHub: (() => void) | undefined
let lensReady = false
let runtimeDevicesCache: PhoneRuntimeDevice[] | undefined
let runtimeDevicesRevision = 0
let settings: CapriSettings = readSettings()
const STT_SETTINGS_KEY = 'capri.stt.settings.v1'
let sttSettings: SttSettings = readSttSettings()
let screen: Screen = 'devices'
let rows: Row[] = []
let selectedRow = 0
let listPage = 0
let navigationToken = 0
let devices: Device[] = []
let activeDevice: Device | undefined
let agents: Agent[] = []
let activeAgent: Agent | undefined
let activeRuntime = ''
let modelChoices: string[] = []
let activeModel = ''
let sessions: SessionInfo[] = []
let activeSession: SessionInfo | undefined
let pendingResumeSession: SessionInfo | undefined
let activeSavedSessionId = ''
const APPROVAL_SESSIONS_KEY = 'capri.approval-sessions.v1'
const RUNTIME_SESSIONS_KEY = 'capri.runtime-sessions.v1'
const CHAT_TRANSCRIPTS_KEY = 'capri.chat-transcripts.v1'

function runtimeSessionKey(device: string, savedId: string): string { return `${device}:${savedId}` }

function readSttSettings(): SttSettings {
  try { return parseSttSettings(localStorage.getItem(STT_SETTINGS_KEY)) } catch { return parseSttSettings(null) }
}

function parseRuntimeDevices(raw: string | null): PhoneRuntimeDevice[] | undefined {
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter((item): item is PhoneRuntimeDevice => Boolean(item) && typeof item.name === 'string' && typeof item.baseUrl === 'string' && typeof item.token === 'string' && item.name.trim() && /^https:\/\//i.test(item.baseUrl) && item.token.trim())
  } catch {
    return undefined
  }
}

function readBrowserRuntimeDevices(): PhoneRuntimeDevice[] {
  try { return parseRuntimeDevices(localStorage.getItem(RUNTIME_DEVICES_KEY)) ?? [] } catch { return [] }
}

function readRuntimeDevices(): PhoneRuntimeDevice[] {
  return runtimeDevicesCache ?? readBrowserRuntimeDevices()
}

function writeRuntimeDevices(devicesToWrite: PhoneRuntimeDevice[]): void {
  runtimeDevicesRevision += 1
  runtimeDevicesCache = devicesToWrite
  try {
    localStorage.setItem(RUNTIME_DEVICES_KEY, JSON.stringify(devicesToWrite))
    void navigator.storage?.persist?.()
  } catch { /* setup remains available for this launch */ }
  if (bridge) void bridge.setLocalStorage(RUNTIME_DEVICES_KEY, JSON.stringify(devicesToWrite)).catch(() => undefined)
}

async function hydrateRuntimeDevices(): Promise<void> {
  const browserDevices = readBrowserRuntimeDevices()
  const revision = runtimeDevicesRevision
  if (!bridge) {
    runtimeDevicesCache = browserDevices
    return
  }
  try {
    const raw = await bridge.getLocalStorage(RUNTIME_DEVICES_KEY)
    if (revision !== runtimeDevicesRevision) return
    const persisted = parseRuntimeDevices(raw)
    if (persisted === undefined) {
      runtimeDevicesCache = browserDevices
      return
    }
    if (persisted.length) {
      runtimeDevicesCache = persisted
      try { localStorage.setItem(RUNTIME_DEVICES_KEY, JSON.stringify(persisted)) } catch {}
      return
    }
    runtimeDevicesCache = browserDevices
    void bridge.setLocalStorage(RUNTIME_DEVICES_KEY, JSON.stringify(browserDevices)).catch(() => undefined)
  } catch {
    if (revision === runtimeDevicesRevision) runtimeDevicesCache = browserDevices
  }
}

function runtimeHostDevices(): Device[] {
  return readRuntimeDevices().map((item) => ({
    name: item.name,
    ip: item.baseUrl.replace(/^https:\/\//i, '').replace(/:\d+\/?$/, ''),
    baseUrl: item.baseUrl.replace(/\/$/, ''),
    token: item.token,
    online: false,
    available: false,
    checking: true,
    capriHost: true,
  }))
}

function primeConfiguredDevices(): void {
  const hosts = runtimeHostDevices()
  devices = hosts
  rows = hosts.map((host) => ({ label: `${host.name}  /  ${host.ip}   ...`, action: 'device', value: host.name }))
  status = hosts.length ? 'CHECKING DECKS' : 'SETUP REQUIRED  ·  PAIR A RUNTIME'
  updatePhoneUI(true)
}

function readRuntimeSession(device: string, savedId: string): string {
  try {
    const value = JSON.parse(localStorage.getItem(RUNTIME_SESSIONS_KEY) ?? '{}') as Record<string, unknown>
    return typeof value[runtimeSessionKey(device, savedId)] === 'string' ? value[runtimeSessionKey(device, savedId)] as string : ''
  } catch {
    return ''
  }
}

function writeRuntimeSession(device: string, savedId: string, runtimeId?: string): void {
  if (!savedId) return
  try {
    const value = JSON.parse(localStorage.getItem(RUNTIME_SESSIONS_KEY) ?? '{}') as Record<string, unknown>
    const key = runtimeSessionKey(device, savedId)
    if (runtimeId) value[key] = runtimeId
    else delete value[key]
    localStorage.setItem(RUNTIME_SESSIONS_KEY, JSON.stringify(value))
  } catch { /* optional runtime recovery */ }
}

function rememberEphemeralRuntime(device: string, runtimeId: string): void {
  try {
    const value = JSON.parse(localStorage.getItem(RUNTIME_SESSIONS_KEY) ?? '{}') as Record<string, unknown>
    value[`${device}:active:${runtimeId}`] = runtimeId
    localStorage.setItem(RUNTIME_SESSIONS_KEY, JSON.stringify(value))
  } catch { /* optional runtime recovery */ }
}

async function closeKnownRuntimeSessions(device: Device): Promise<void> {
  let stored: Record<string, unknown> = {}
  try {
    stored = JSON.parse(localStorage.getItem(RUNTIME_SESSIONS_KEY) ?? '{}') as Record<string, unknown>
  } catch {
    return
  }
  const runtimeIds = Object.entries(stored)
    .filter(([key, value]) => key.startsWith(`${device.name}:`) && typeof value === 'string')
    .map(([, value]) => value as string)
  if (!runtimeIds.length) return
  await Promise.all(runtimeIds.map(async (runtimeId) => {
    try {
      await requestJson(device, `/api/v1/sessions/${encodeURIComponent(runtimeId)}`, { method: 'DELETE', timeoutMs: 4000 })
    } catch {
      // A stale runtime is already gone; keep trying the remaining sessions.
    }
  }))
  for (const key of Object.keys(stored)) if (key.startsWith(`${device.name}:`)) delete stored[key]
  try { localStorage.setItem(RUNTIME_SESSIONS_KEY, JSON.stringify(stored)) } catch { /* optional recovery */ }
}

function readChatTranscript(device: string, savedId: string): string {
  if (!savedId) return ''
  try {
    const value = JSON.parse(localStorage.getItem(CHAT_TRANSCRIPTS_KEY) ?? '{}') as Record<string, unknown>
    return typeof value[runtimeSessionKey(device, savedId)] === 'string' ? value[runtimeSessionKey(device, savedId)] as string : ''
  } catch {
    return ''
  }
}

function writeChatTranscript(device: string, savedId: string, transcript: string): void {
  if (!savedId) return
  try {
    const value = JSON.parse(localStorage.getItem(CHAT_TRANSCRIPTS_KEY) ?? '{}') as Record<string, unknown>
    value[runtimeSessionKey(device, savedId)] = transcript.slice(-2_000_000)
    localStorage.setItem(CHAT_TRANSCRIPTS_KEY, JSON.stringify(value))
  } catch { /* transcript recovery is optional */ }
}

function savedApprovalIds(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(APPROVAL_SESSIONS_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function setSavedApproval(id: string, pending: boolean): void {
  if (!id) return
  const ids = new Set(savedApprovalIds())
  if (pending) ids.add(id)
  else ids.delete(id)
  try { localStorage.setItem(APPROVAL_SESSIONS_KEY, JSON.stringify([...ids])) } catch { /* optional marker */ }
}

function sessionNeedsApproval(id: string, serverFlag?: boolean): boolean {
  return Boolean(serverFlag || savedApprovalIds().includes(id))
}
let activeSessionDevice: Device | undefined
let activeTargetDevice: Device | undefined
let phoneSessionsByDevice: Record<string, SessionInfo[]> = {}
let phoneAgentsByDevice: Record<string, Agent[]> = {}
let phoneModelsByDevice: Record<string, Record<string, string[]>> = {}
let status = 'Capri online'
let chatHistory: ChatLine[] = []
let promptText = ''
let terminalInput = false
let audioActive = false
let audioBusy = false
let audioBuffers: Uint8Array[] = []
let renderInFlight = false
let renderDirty = false
let renderTimer: number | undefined
let streamAbort: AbortController | undefined
let terminalText = ''
let agentTerminal = new TerminalScreen()
let agentTranscript = ''
let agentScreenHistory: string[] = []
let lastAgentScreen = ''
let screenHistoryTimer: number | undefined
let modelMode: 'new' | 'change' | 'view' = 'view'
let modelReturnScreen: Screen = 'devices'
let moreReturnScreen: Screen = 'devices'
let approvalReturnScreen: Screen = 'chat'
let pendingApproval: Approval | undefined
let pendingInput: InteractivePrompt | undefined
let lastInputPrompt = ''
let chatOffset = 0
let chatAutoFollowing = true
let terminalOffset = 0
let sessionLoading = false
let loadingFrame = 0
let loadingTimer: number | undefined
let sttStatus = ''
let sttTesting = false

mountPhoneUI()
runtimeDevicesCache = readBrowserRuntimeDevices()
primeConfiguredDevices()
void boot().catch((error: unknown) => console.error('Capri startup failed', error))

function mountPhoneUI(): void {
  const root = document.getElementById('app')
  if (!root) return
  phoneUI = new PhoneUI(root, {
    refresh: () => void refreshDevices(),
    loadModels: (deviceName, agent) => void loadPhoneModels(deviceName, agent),
    startSession: (deviceName, agent, model) => void phoneStartSession(deviceName, agent, model),
    resumeSession: (deviceName, session, runtime) => void phoneResumeSession(deviceName, session, runtime),
    startTerminal: (deviceName) => void phoneStartTerminal(deviceName),
    sendInput: (deviceName, text, terminal) => void phoneSendInput(deviceName, text, terminal),
    sendTerminalKey: (deviceName, key) => void phoneSendTerminalKey(deviceName, key),
    disconnect: () => void phoneDisconnect(),
    changeModel: (deviceName, model) => void phoneChangeModel(deviceName, model),
    approval: (choice) => void phoneApprove(choice),
    talk: toggleRecording,
    saveSettings: (next) => savePhoneSettings(next),
    saveStt: (next) => savePhoneStt(next),
    testStt: (next) => void testPhoneStt(next),
    saveRuntimeDevice: (device) => saveRuntimeDevice(device),
    removeRuntimeDevice: (name) => removeRuntimeDevice(name),
    resetStorage: () => resetLocalStorage(),
  })
  updatePhoneUI(true)
}

function setSessionLoading(next: boolean): void {
  sessionLoading = next
  if (loadingTimer !== undefined) {
    window.clearInterval(loadingTimer)
    loadingTimer = undefined
  }
  if (!next) return
  loadingFrame = 0
  loadingTimer = window.setInterval(() => {
    loadingFrame = (loadingFrame + 1) % 4
    void redraw()
  }, 260)
}

function markSessionAttached(): void {
  setSessionLoading(false)
  if (status === 'RESUMING SESSION...' || status === 'Opening saved session...') status = 'LIVE  ·  TAP TO TALK'
}

function updatePhoneUI(immediate = false): void {
  if (!phoneUI) return
  const snapshot: PhoneSnapshot = {
    devices: devices.map((device) => ({
      ...device,
      sshAvailable: Boolean(!device.available && device.online && settings.sshTargets[device.name] && device.controllerName),
    })),
    selectedDeviceName: settings.defaultDevice,
    activeSession,
    activeSessionDeviceName: activeTargetDevice?.name ?? activeSessionDevice?.name,
    activeModel,
    sessionsByDevice: phoneSessionsByDevice,
    agentsByDevice: phoneAgentsByDevice,
    modelsByDevice: phoneModelsByDevice,
    chatHistory,
    terminalText,
    agentScreenText: activeSession && activeSession.agent !== 'terminal' ? formatChat() : '',
    agentScreenHeader: activeSession && activeSession.agent !== 'terminal' ? 'LIVE' : '',
    pendingApproval,
    status,
    recording: audioActive,
    audioBusy,
    settings,
    stt: sttSettings,
    sttStatus,
    sttTesting,
    configuredDevices: readRuntimeDevices(),
  }
  phoneUI.update(snapshot, immediate)
}

function savePhoneSettings(next: CapriSettings): void {
  settings = { ...next, defaultModels: { ...next.defaultModels } }
  if (settings.autoScroll) chatAutoFollowing = true
  writeSettings(settings)
  updatePhoneUI(true)
  if (runtime) void redraw()
  if (screen === 'chat' || screen === 'terminal') void renderLive()
}

function savePhoneStt(next: SttSettings): void {
  sttSettings = { ...next, apiKey: next.apiKey.trim(), model: next.model.trim(), language: next.language.trim() }
  try { localStorage.setItem(STT_SETTINGS_KEY, JSON.stringify(sttSettings)) } catch { /* keep the setting in memory */ }
  sttStatus = isSttReady(sttSettings) ? `${sttSettings.provider} is ready` : 'Choose a provider and API key to enable voice input'
  updatePhoneUI(true)
}

async function testPhoneStt(next: SttSettings): Promise<void> {
  savePhoneStt(next)
  if (!isSttReady(sttSettings)) return
  sttTesting = true
  sttStatus = `Testing ${sttSettings.provider}…`
  updatePhoneUI(true)
  try {
    const response = await fetch('/stt-test.wav')
    if (!response.ok) throw new Error('Embedded test audio is unavailable')
    const text = await transcribe(await response.blob(), sttSettings)
    sttStatus = text ? `Test passed · “${text}”` : 'Provider responded, but no words were detected'
  } catch (error) {
    sttStatus = error instanceof Error ? error.message : 'STT test failed'
  } finally {
    sttTesting = false
    updatePhoneUI(true)
  }
}

function saveRuntimeDevice(device: PhoneRuntimeDevice): void {
  const clean = {
    name: device.name.trim().slice(0, 64),
    baseUrl: device.baseUrl.trim().replace(/\/$/, ''),
    token: device.token.trim(),
  }
  if (!clean.name || !/^https:\/\//i.test(clean.baseUrl) || !clean.token) return
  const next = readRuntimeDevices().filter((item) => item.name.toLowerCase() !== clean.name.toLowerCase())
  next.push(clean)
  writeRuntimeDevices(next)
  settings = { ...settings, defaultDevice: clean.name }
  writeSettings(settings)
  void refreshDevices()
}

function removeRuntimeDevice(name: string): void {
  const next = readRuntimeDevices().filter((item) => item.name !== name)
  writeRuntimeDevices(next)
  if (settings.defaultDevice === name) {
    settings = { ...settings, defaultDevice: next[0]?.name ?? '' }
    writeSettings(settings)
  }
  void refreshDevices()
}

function resetLocalStorage(): void {
  runtimeDevicesRevision += 1
  try { localStorage.clear() } catch {}
  runtimeDevicesCache = []
  if (bridge) void Promise.all(PHONE_STORAGE_KEYS.map((key) => bridge?.setLocalStorage(key, '')))
  settings = readSettings()
  sttSettings = readSttSettings()
  activeDevice = undefined
  activeTargetDevice = undefined
  activeSession = undefined
  pendingResumeSession = undefined
  activeSessionDevice = undefined
  activeSavedSessionId = ''
  sessions = []
  pendingApproval = undefined
  status = 'Local storage wiped'
  updatePhoneUI(true)
  void refreshDevices()
}

async function boot(): Promise<void> {
  bridge = await waitForEvenAppBridge()
  runtimeDevicesCache = readBrowserRuntimeDevices()
  primeConfiguredDevices()
  void hydrateRuntimeDevices().then(() => {
    primeConfiguredDevices()
  })
  runtime = connectCapriRuntime(bridge, { layout: SPLASH_LAYOUT, menu: MENU })
  if (!runtime) {
    status = 'Lens unavailable'
    updatePhoneUI(true)
    return
  }
  hud = new Hud(runtime)
  bridge.onEvenHubEvent(handleEvent)
  lensReady = true
  window.addEventListener('pagehide', cleanup)

  runtime.onSwipe((dir: 'up' | 'down') => {
    if (screen === 'chat' || screen === 'terminal') {
      if (dir === 'down') {
        if (screen === 'chat' && activeSession?.agent !== 'terminal') {
          chatOffset = Math.max(0, chatOffset - visibleChatLines())
          if (chatOffset === 0) chatAutoFollowing = true
        } else if (screen === 'chat') chatOffset = Math.max(0, chatOffset - 4)
        else terminalOffset = Math.max(0, terminalOffset - 4)
        void redraw(false)
      } else {
        if (screen === 'chat' && activeSession?.agent !== 'terminal') {
          const maximum = Math.max(0, agentReplyLineCount() - visibleChatLines())
          chatOffset = Math.min(maximum, chatOffset + visibleChatLines())
          chatAutoFollowing = false
        } else if (screen === 'chat') chatOffset = Math.min(chatHistory.length * 4, chatOffset + 4)
        else terminalOffset = Math.min(80, terminalOffset + 4)
        void redraw(false)
      }
      return
    }
    const rowsPage = visibleRows()
    const next = dir === 'down' ? Math.min(selectedRow + 1, rowsPage.length - 1) : Math.max(selectedRow - 1, 0)
    if (next !== selectedRow) {
      selectedRow = next
      void redraw(false)
    }
  })

  runtime.onTap(() => {})

  runtime.onDoubleTap(() => goBack())

  void bootSplash()
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('demoApproval')) {
    window.setTimeout(() => showApproval({
      agent: 'claude',
      prompt: 'Claude wants to run: npm test',
      options: [
        { id: 'allow_once', label: 'Allow once' },
        { id: 'deny', label: 'Deny' },
      ],
    }), 1800)
  }
}

async function bootSplash(): Promise<void> {
  if (!hud) return
  for (let frame = 1; frame <= SPLASH_FRAMES; frame++) {
    await hud.show({ kind: 'splash', progress: frame / SPLASH_FRAMES, text: 'CAPRI // BOOTING' })
    await new Promise(resolve => setTimeout(resolve, SPLASH_FRAME_MS))
  }
  await hud.show({ kind: 'splash', progress: 1, text: 'CAPRI ONLINE' })
  await refreshDevices()
}

const MENU: Array<{ id: number; label: string }> = [
  { id: 1, label: 'Devices' },
  { id: 2, label: 'Models' },
  { id: 3, label: 'Session' },
  { id: 4, label: 'More' },
]

function handleEvent(event: EvenHubEvent): void {
  if (!runtime) return
  handleAudio(event)
  const menuID = event.menuItemClickEvent?.itemID
  if (menuID !== undefined) {
    void handleMenu(menuID)
    return
  }

  const sys = event.sysEvent
  if (sys) {
    const type = sys.eventType ?? 0
    if (type === 7 || type === 10) { cleanup(); return }
    if (type === 3) { goBack(); return }
    if (type === 0 && !event.listEvent) {
      if (screen === 'chat' || screen === 'terminal') {
        toggleRecording()
      } else {
        const row = visibleRows()[selectedRow]
        if (row) void activateRow(row)
      }
      return
    }
  }

  const listEvent = event.listEvent
  if (!listEvent) return
  const pageRows = visibleRows()
  const namedIndex = listEvent.currentSelectItemName
    ? pageRows.findIndex((row) => row.label === listEvent.currentSelectItemName)
    : -1
  const index = typeof listEvent.currentSelectItemIndex === 'number'
    ? listEvent.currentSelectItemIndex
    : namedIndex
  if (index >= 0 && index < pageRows.length && index !== selectedRow) {
    selectedRow = index
    if (screen === 'review' || screen === 'approval') void redraw()
  }
  if ((listEvent.eventType ?? 0) === 0) {
    const row = pageRows[index]
    if (row) {
      void activateRow(row)
    }
  }
}

async function handleMenu(id: number): Promise<void> {
  if (id === 1) {
    await refreshDevices()
  } else if (id === 2) {
    if (activeAgent) await openModels(activeAgent, activeSession ? 'change' : 'view')
    else await chooseAgentForModels()
  } else if (id === 3) {
    if (activeDevice) await openSessionChoice()
    else await refreshDevices()
  } else if (id === 4) {
    moreReturnScreen = screen
    screen = 'more'
    listPage = 0
    rows = [
      { label: 'History older', action: 'history-older' },
      { label: 'Latest output', action: 'latest-output' },
      { label: pendingApproval ? 'Review approval' : 'Approvals', action: 'approvals' },
    ]
    if (activeSession) {
      rows.push({ label: `Session  ${activeSession.title}`, action: 'noop' })
      rows.push({ label: `Harness  ${agentLabel(activeSession.agent)}`, action: 'noop' })
      rows.push({ label: `Folder  ${sessions.find((item) => item.id === activeSession?.id)?.cwd ?? 'remote workspace'}`, action: 'noop' })
      rows.push({ label: `Model  ${activeModel || 'agent default'}`, action: 'noop' })
    }
    rows.push({ label: 'Back to session', action: 'more-back' })
    selectedRow = 0
    status = 'RUNNER TOOLS'
    await redraw()
  }
}

async function refreshDevices(): Promise<void> {
  const token = ++navigationToken
  const hosts = runtimeHostDevices()
  screen = 'devices'
  listPage = 0
  activeDevice = undefined
  if (!hosts.length) {
    devices = []
    rows = []
    status = 'SETUP REQUIRED  ·  PAIR A RUNTIME'
    await redraw()
    updatePhoneUI(true)
    return
  }
  status = 'Scanning the net...'
  devices = hosts
  rows = hosts.map((host) => ({ label: `${host.name}  /  ${host.ip}   ···`, action: 'device', value: host.name }))
  updatePhoneUI(true)
  await redraw()
  const probes = await Promise.all(hosts.map(async (host) => {
    try {
      const data = await requestJson(host, '/api/v1/devices', { method: 'GET', timeoutMs: 4500 }) as { devices?: Array<{ name: string; ip: string; dnsName?: string; os?: string; online: boolean }> }
      return { host, reachable: true, peers: data.devices ?? [] }
    } catch {
      return { host, reachable: false, peers: [] as Array<{ name: string; ip: string; dnsName?: string; os?: string; online: boolean }> }
    }
  }))
  if (token !== navigationToken) return
  const peerMap = new Map<string, { name: string; ip: string; dnsName?: string; os?: string; online: boolean }>()
  const runtimeHostByPeer = new Map<string, Device>()
  for (const probe of probes) {
    const runtimePeer = probe.peers[0]
    if (probe.reachable && runtimePeer) runtimeHostByPeer.set(runtimePeer.name.toLowerCase(), probe.host)
    for (const peer of probe.peers) {
      const key = peer.name.toLowerCase()
      const previous = peerMap.get(key)
      if (!previous || peer.online) peerMap.set(key, peer)
    }
  }
  for (const host of hosts) {
    const hasReachableRuntime = probes.some((probe) => probe.host.name === host.name && probe.reachable && probe.peers.length > 0)
    if (!hasReachableRuntime && !peerMap.has(host.name.toLowerCase())) peerMap.set(host.name.toLowerCase(), { name: host.name, ip: host.ip, dnsName: `${host.name}.tailnet.local`, os: 'linux', online: false })
  }
  const hostAvailability = new Map(probes.map((probe) => [probe.host.name, probe.reachable]))
  const hostOrder = new Map(hosts.map((host, index) => [host.name, index]))
  const controller = hosts.find((host) => hostAvailability.get(host.name))
  devices = [...peerMap.values()]
    .sort((a, b) => (hostOrder.get(a.name.toLowerCase()) ?? hosts.length) - (hostOrder.get(b.name.toLowerCase()) ?? hosts.length) || a.name.localeCompare(b.name))
    .map((peer) => {
      const host = hosts.find((item) => item.name.toLowerCase() === peer.name.toLowerCase()) ?? runtimeHostByPeer.get(peer.name.toLowerCase())
      return {
        name: peer.name,
        ip: peer.ip || host?.ip || 'IP unavailable',
        sshHost: peer.dnsName || (host ? `${host.name}.tailnet.local` : undefined),
        os: peer.os,
        sshEligible: !peer.os || /^(linux|darwin|macos)$/i.test(peer.os),
        online: peer.online,
        baseUrl: host?.baseUrl ?? controller?.baseUrl ?? '',
        token: host?.token ?? controller?.token,
        available: Boolean(host && peer.online && hostAvailability.get(host.name)),
        checking: false,
        capriHost: Boolean(host),
        configuredName: host?.name,
        controllerName: host ? undefined : controller?.name,
      }
    })
  const fallbackDevice = devices.find((device) => device.name === settings.defaultDevice && device.available) ?? devices.find((device) => device.available)
  if (fallbackDevice) settings = { ...settings, defaultDevice: fallbackDevice.name }
  rows = devices.map((device) => ({
    label: `${device.online ? '●' : '○'}  ${device.name.padEnd(14)} ${device.ip}${device.available ? '' : '   NO DECK'}`,
    action: 'device',
    value: device.name,
  }))
  status = devices.some((device) => device.available) ? 'Jack into a deck' : 'No deck reachable'
  selectedRow = Math.min(selectedRow, Math.max(0, rows.length - 1))
  await redraw()
  void refreshPhoneCatalog()
}

async function openSessionChoice(): Promise<void> {
  if (!activeDevice) return
  const token = ++navigationToken
  const deviceName = activeDevice.name
  screen = 'resume'
  listPage = 0
  rows = []
  selectedRow = 0
  status = 'LOADING SAVED SESSIONS'
  await redraw()
  let loadError = ''
  try {
    const result = await requestJson(activeDevice, '/api/v1/sessions') as { sessions?: SessionInfo[] }
    sessions = (result.sessions ?? []).map((session) => ({ ...session, needsApproval: sessionNeedsApproval(session.id, session.needsApproval) }))
  } catch (error) {
    sessions = []
    loadError = error instanceof Error ? error.message : 'Could not load saved sessions'
  }
  if (token !== navigationToken || activeDevice?.name !== deviceName) return
  rows = [
    { label: '[+] NEW SESSION', action: 'new_session' },
    ...sortSessions(sessions).map((session) => ({
      label: session.title,
      action: 'session',
      value: session.id,
      detail: session.cwd || activeDevice?.name || '',
      activity: relativeActivity(session.updatedAt),
      approval: Boolean(session.needsApproval || (pendingApproval && activeSavedSessionId === session.id)),
    })),
  ]
  if (sessions.length === 0 && loadError) rows.push({ label: 'RETRY SESSION LIST', action: 'retry-sessions' })
  selectedRow = 0
  status = loadError ? `COULD NOT LOAD SESSIONS` : `${sessions.length} SAVED SESSION${sessions.length === 1 ? '' : 'S'}`
  await redraw()
}

async function refreshPhoneCatalog(): Promise<void> {
  const available = devices.filter((device) => device.available)
  const results = await Promise.all(available.map(async (device) => {
    try {
      const [agentData, sessionData] = await Promise.all([
        requestJson(device, '/api/v1/agents') as Promise<{ agents?: Agent[] }>,
        requestJson(device, '/api/v1/sessions') as Promise<{ sessions?: SessionInfo[] }>,
      ])
      return {
        device,
        agents: agentData.agents ?? [],
        sessions: (sessionData.sessions ?? []).map((session) => ({ ...session, needsApproval: sessionNeedsApproval(session.id, session.needsApproval) })),
      }
    } catch {
      return { device, agents: [] as Agent[], sessions: [] as SessionInfo[] }
    }
  }))
  phoneAgentsByDevice = Object.fromEntries(results.map(({ device, agents: deviceAgents }) => [device.name, deviceAgents]))
  phoneSessionsByDevice = Object.fromEntries(results.map(({ device, sessions: deviceSessions }) => [device.name, deviceSessions]))
  for (const device of devices) {
    phoneAgentsByDevice[device.name] ??= []
    phoneSessionsByDevice[device.name] ??= []
    phoneModelsByDevice[device.name] ??= {}
  }
  updatePhoneUI(true)
}

async function loadPhoneModels(deviceName: string, agent: string): Promise<void> {
  const device = devices.find((item) => item.name === deviceName)
  if (!device?.available || !agent) return
  try {
    const data = await requestJson(device, `/api/v1/models?agent=${encodeURIComponent(agent)}`, { timeoutMs: 30000 }) as { models?: string[] }
    phoneModelsByDevice = {
      ...phoneModelsByDevice,
      [device.name]: { ...phoneModelsByDevice[device.name], [agent]: data.models ?? [] },
    }
  } catch (error) {
    status = error instanceof Error ? error.message : 'Could not load model list'
  }
  updatePhoneUI(true)
}

async function phoneStartSession(deviceName: string, agent: string, model: string): Promise<void> {
  const device = devices.find((item) => item.name === deviceName)
  if (!device?.available) {
    status = `${deviceName} is offline`
    updatePhoneUI(true)
    return
  }
  activeTargetDevice = undefined
  activeDevice = device
  agents = phoneAgentsByDevice[device.name] ?? []
  sessions = phoneSessionsByDevice[device.name] ?? []
  const preferred = model || settings.defaultModels[`${device.name}:${agent}`] || ''
  await startSession(agent, preferred)
}

async function phoneResumeSession(deviceName: string, session: SessionInfo, runtime: string): Promise<void> {
  const device = devices.find((item) => item.name === deviceName)
  if (!device?.available) {
    status = `${deviceName} is offline`
    updatePhoneUI(true)
    return
  }
  activeDevice = device
  activeTargetDevice = undefined
  agents = phoneAgentsByDevice[device.name] ?? []
  sessions = phoneSessionsByDevice[device.name] ?? []
  void loadPhoneModels(device.name, session.agent)
  await startSession(session.agent, '', session.id, runtime)
}

async function phoneStartTerminal(deviceName: string): Promise<void> {
  const device = devices.find((item) => item.name === deviceName)
  if (!device) {
    status = `${deviceName} is offline`
    updatePhoneUI(true)
    return
  }
  if (device.available) {
    activeDevice = device
    activeTargetDevice = undefined
  } else {
    const username = settings.sshTargets[device.name]
    const controller = devices.find((item) => item.name === device.controllerName && item.available)
    if (!device.online || !device.sshHost || !username || !controller) {
      status = `${deviceName} needs an online Tailscale SSH target and reachable controller`
      updatePhoneUI(true)
      return
    }
    activeDevice = controller
    activeTargetDevice = device
  }
  await startTerminal()
}

async function phoneSendInput(deviceName: string, text: string, terminal: boolean): Promise<void> {
  const selected = devices.find((item) => item.name === deviceName)
  const device = activeTargetDevice?.name === deviceName ? activeSessionDevice : selected?.available ? selected : undefined
  if (!device || !activeSession) return
  activeDevice = device
  try {
    await sendInput(text, terminal)
  } catch (error) {
    status = error instanceof Error ? error.message : 'Could not send input'
    updatePhoneUI(true)
    await redraw()
  }
}

async function phoneSendTerminalKey(deviceName: string, key: string): Promise<void> {
  const selected = devices.find((item) => item.name === deviceName)
  const device = activeTargetDevice?.name === deviceName ? activeSessionDevice : selected?.available ? selected : undefined
  if (!device || !activeSession || activeSession.agent !== 'terminal') return
  const sequences: Record<string, string> = { 'ctrl-c': '\u0003', 'ctrl-d': '\u0004', tab: '\t', escape: '\u001b' }
  const sequence = sequences[key]
  if (!sequence) return
  try {
    await postSessionInput(device, activeSession.id, sequence)
  } catch (error) {
    status = error instanceof Error ? error.message : 'Could not send command'
    updatePhoneUI(true)
  }
}

async function phoneDisconnect(): Promise<void> {
  const session = activeSession
  const device = activeSessionDevice
  if (!session || !device) return
  streamAbort?.abort()
  status = 'Jacking out...'
  updatePhoneUI(true)
  try {
    await requestJson(device, `/api/v1/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' })
    status = session.agent === 'terminal' ? 'Terminal disconnected' : 'Session ended'
  } catch (error) {
    status = error instanceof Error ? error.message : 'Could not disconnect'
  }
  activeSession = undefined
  pendingResumeSession = undefined
  writeRuntimeSession(activeDevice?.name ?? '', activeSavedSessionId)
  activeSavedSessionId = ''
  activeSessionDevice = undefined
  activeTargetDevice = undefined
  pendingApproval = undefined
  pendingInput = undefined
  lastInputPrompt = ''
  agentTranscript = ''
  setSessionLoading(false)
  stopAgentScreenHistory()
  agentScreenHistory = []
  lastAgentScreen = ''
  updatePhoneUI(true)
  await redraw()
}

async function phoneChangeModel(deviceName: string, model: string): Promise<void> {
  const device = activeSessionDevice ?? devices.find((item) => item.name === deviceName)
  if (!device || !activeSession || activeSession.agent === 'terminal') return
  activeDevice = device
  try {
    await requestJson(device, `/api/v1/sessions/${encodeURIComponent(activeSession.id)}/model`, { method: 'POST', body: { model } })
    activeModel = model
    status = `Model changed to ${model || 'deck default'}`
  } catch (error) {
    status = error instanceof Error ? error.message : 'Could not change model'
  }
  updatePhoneUI(true)
}

async function phoneApprove(choice: string): Promise<void> {
  const device = activeSessionDevice
  if (!device || !activeSession || !pendingApproval) return
  try {
    const response = await requestJson(device, `/api/v1/sessions/${encodeURIComponent(activeSession.id)}/approval`, {
      method: 'POST',
      body: { choice },
    }) as { accepted?: boolean }
    if (!response.accepted) throw new Error('Approval denied')
    pendingApproval = undefined
    pendingInput = undefined
    lastInputPrompt = ''
    agentTranscript = ''
    clearSavedApproval()
    status = `Approval sent: ${choice}`
  } catch (error) {
    status = error instanceof Error ? error.message : 'Could not send approval'
  }
  updatePhoneUI(true)
  await redraw()
}

async function selectDevice(name: string): Promise<void> {
  const device = devices.find((item) => item.name === name)
  if (!device) return
  if (!device.available) {
    status = `${device.name} is offline or the deck is cold`
    await redraw()
    return
  }
  activeDevice = device
  activeTargetDevice = undefined
  await openSessionChoice()
}

async function showAgents(): Promise<void> {
  if (!activeDevice) return
  const token = ++navigationToken
  const deviceName = activeDevice.name
  screen = 'new_agent'
  listPage = 0
  rows = []
  selectedRow = 0
  status = 'SELECT AGENT'
  let loadError = ''
  try {
    const result = await requestJson(activeDevice, '/api/v1/agents') as { agents?: Agent[] }
    agents = result.agents ?? []
  } catch (error) {
    agents = []
    loadError = error instanceof Error ? error.message : 'Could not load agent binaries'
  }
  if (token !== navigationToken || activeDevice?.name !== deviceName) return
  rows = agents.filter((agent) => agent.available).map((agent) => ({
    label: agent.name,
    action: 'agent',
    value: agent.id,
  }))
  if (rows.length === 0) rows = [{ label: loadError ? 'Retry agent list' : 'No agent binaries found', action: loadError ? 'retry-agents' : 'noop' }]
  if (loadError) status = `Could not load agents: ${loadError}`
  selectedRow = 0
  await redraw()
}

async function openModels(agent: Agent, mode: 'new' | 'change' | 'view' = 'view'): Promise<void> {
  if (!activeDevice) return
  activeAgent = agent
  modelMode = mode
  modelReturnScreen = screen
  screen = 'new_session'
  listPage = 0
  status = `${agent.name} models`
  try {
    const result = await requestJson(activeDevice, `/api/v1/models?agent=${encodeURIComponent(agent.id)}`, { timeoutMs: 30000 }) as { models?: string[] }
    modelChoices = ['Default', ...(result.models ?? [])]
    activeModel = settings.defaultModels[`${activeDevice.name}:${agent.id}`] ?? ''
  } catch {
    modelChoices = ['Default']
    status = 'Could not load model list'
  }
  rows = modelChoices.map((model) => ({ label: model, action: 'model', value: model === 'Default' ? '' : model }))
  selectedRow = 0
  await redraw()
}

async function chooseAgentForModels(): Promise<void> {
  if (!activeDevice) return
  modelMode = 'view'
  await showAgents()
  status = 'Pick an agent'
}

async function openSessions(): Promise<void> {
  if (!activeDevice) return
  const token = ++navigationToken
  const deviceName = activeDevice.name
  screen = 'resume'
  listPage = 0
  rows = []
  selectedRow = 0
  status = 'Scanning saved sessions...'
  await redraw()
  let loadError = ''
  try {
    const result = await requestJson(activeDevice, '/api/v1/sessions') as { sessions?: SessionInfo[] }
    sessions = (result.sessions ?? []).map((session) => ({ ...session, needsApproval: sessionNeedsApproval(session.id, session.needsApproval) }))
  } catch (error) {
    sessions = []
    loadError = error instanceof Error ? error.message : 'Could not load saved sessions'
  }
  if (token !== navigationToken || activeDevice?.name !== deviceName) return
  rows = [
    { label: '[+] NEW SESSION', action: 'new_session' },
    ...sortSessions(sessions).map((session) => ({
      label: session.title,
      action: 'session',
      value: session.id,
      detail: session.cwd || activeDevice?.name || '',
      activity: relativeActivity(session.updatedAt),
      approval: Boolean(session.needsApproval || (pendingApproval && activeSession?.id === session.id)),
    })),
  ]
  if (sessions.length === 0 && loadError) rows.push({ label: 'RETRY SESSION LIST', action: 'retry-sessions' })
  selectedRow = 0
  status = loadError ? `Could not load sessions: ${loadError}` : `${sessions.length} saved session${sessions.length === 1 ? '' : 's'}`
  await redraw()
}

async function showRuntimes(session: SessionInfo): Promise<void> {
  pendingResumeSession = session
  if (session.agent === 'claude') {
    const installed = agents
    const claudeAgent = installed.find((agent) => agent.id === 'claude')
    const choices = session.runtime
      ? [session.runtime]
      : (claudeAgent?.runtimes ?? ['claude']).filter((id) => installed.some((agent) => agent.id === id && agent.available))
    rows = choices.map((runtime) => ({ label: `Resume with ${runtime}`, action: 'runtime', value: runtime }))
    if (rows.length > 1) {
      screen = 'runtimes'
      status = `Resume ${session.title}`
      selectedRow = 0
      await redraw()
      return
    }
    activeRuntime = choices[0] ?? 'claude'
  } else {
    activeRuntime = session.agent
  }
  await startSession(session.agent, '', session.id, activeRuntime)
}

async function startSession(agent: string, model: string, resumeID = '', runtime = agent, forceResume = false, conflictRetried = false): Promise<void> {
  if (!activeDevice) return
  pendingResumeSession = undefined
  if (resumeID && !activeSession && !forceResume) {
    const savedRuntime = readRuntimeSession(activeDevice.name, resumeID)
    if (savedRuntime) {
      activeSession = { id: savedRuntime, agent, title: sessions.find((item) => item.id === resumeID)?.title ?? agentLabel(agent), runtime }
      activeSavedSessionId = resumeID
      agentTranscript = readChatTranscript(activeDevice.name, resumeID)
      agentTerminal.reset()
      setSessionLoading(!agentTranscript)
      activeSessionDevice = activeDevice
      activeAgent = agents.find((item) => item.id === agent) ?? { id: agent, name: agentLabel(agent), available: true }
      screen = 'chat'
      status = 'RESUMING SESSION...'
      markSessionAttached()
      await redraw()
      startOutputStream(savedRuntime, activeDevice, () => {
        writeRuntimeSession(activeDevice?.name ?? '', resumeID)
        activeSession = undefined
        activeSavedSessionId = ''
        activeSessionDevice = undefined
        void startSession(agent, model, resumeID, runtime, true)
      })
      return
    }
  }
  if (resumeID && activeSession && !forceResume) {
    if (activeSavedSessionId === resumeID) {
      activeSessionDevice = activeSessionDevice ?? activeDevice
      activeAgent = agents.find((item) => item.id === activeSession!.agent) ?? { id: activeSession.agent, name: agentLabel(activeSession.agent), available: true }
      screen = 'chat'
      status = 'RESUMING SESSION...'
      await redraw()
      startOutputStream(activeSession.id, activeSessionDevice, () => {
        void (async () => {
          try {
            await requestJson(activeSessionDevice ?? activeDevice!, `/api/v1/sessions/${encodeURIComponent(activeSession?.id ?? '')}`, { method: 'DELETE' })
          } catch {
            // The saved process may already be gone; the resume request can still recreate it.
          }
          activeSession = undefined
          activeSavedSessionId = ''
          activeSessionDevice = undefined
          await startSession(agent, model, resumeID, runtime, true)
        })()
      })
      return
    }
    try {
      await requestJson(activeSessionDevice ?? activeDevice, `/api/v1/sessions/${encodeURIComponent(activeSession.id)}`, { method: 'DELETE' })
    } catch {
      // Continue the switch; the resume request below will report a real failure.
    }
    streamAbort?.abort()
    activeSession = undefined
    writeRuntimeSession(activeSessionDevice?.name ?? activeDevice?.name ?? '', activeSavedSessionId)
    activeSavedSessionId = ''
    activeSessionDevice = undefined
  }
  if (!model) model = settings.defaultModels[`${activeDevice.name}:${agent}`] ?? ''
  streamAbort?.abort()
  status = resumeID ? 'Opening saved session...' : 'Jacking in...'
  setSessionLoading(true)
  activeAgent = agents.find((item) => item.id === agent) ?? { id: agent, name: agentLabel(agent), available: true }
  activeTargetDevice = undefined
  activeRuntime = runtime
  activeSession = {
    id: `pending:${Date.now()}`,
    agent,
    title: sessions.find((item) => item.id === resumeID)?.title ?? agentLabel(agent),
    runtime,
  }
  activeSavedSessionId = resumeID
  activeSessionDevice = activeDevice
  screen = 'chat'
  try {
    const createRequest = requestJson(activeDevice, '/api/v1/sessions', {
      method: 'POST',
      body: { agent, runtime, model, resume_id: resumeID, cwd: sessions.find((item) => item.id === resumeID)?.cwd },
    }) as Promise<{ id: string; session_id?: string; title?: string }>
    await redraw()
    const created = await createRequest
    activeSession = { id: created.id, agent, title: created.title ?? agentLabel(agent), runtime }
    activeSavedSessionId = resumeID
    if (resumeID) writeRuntimeSession(activeDevice.name, resumeID, created.id)
    else rememberEphemeralRuntime(activeDevice.name, created.id)
    activeSession.id = created.id
    activeSessionDevice = activeDevice
    activeAgent = { ...activeAgent, id: agent }
    activeModel = model
    agentTerminal.reset()
    agentTranscript = readChatTranscript(activeDevice.name, resumeID)
    markSessionAttached()
    stopAgentScreenHistory()
    agentScreenHistory = []
    lastAgentScreen = ''
    startAgentScreenHistory()
    chatHistory = [{ kind: 'sys', text: `${agentLabel(agent)}  /  ${activeDevice.name}`, timestamp: Date.now() }]
    chatOffset = 0
    chatAutoFollowing = true
    terminalOffset = 0
    terminalText = ''
    screen = 'chat'
    status = 'LIVE  ·  TAP TO TALK'
    await redraw()
    startOutputStream(created.id, activeDevice)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const capacityConflict = /close a session|session limit|maximum.*session/i.test(message)
    if ((forceResume || capacityConflict) && !conflictRetried) {
      try {
        await closeKnownRuntimeSessions(activeDevice)
        await startSession(agent, model, resumeID, runtime, true, true)
        return
      } catch {
        // Fall through to the original error if the conflict cannot be cleared.
      }
    }
    status = error instanceof Error ? error.message : 'Jack-in failed'
    setSessionLoading(false)
    activeSession = undefined
    activeSavedSessionId = ''
    activeSessionDevice = undefined
    if (resumeID) {
      writeRuntimeSession(activeDevice.name, resumeID)
      screen = 'resume'
      rows = [
        { label: '[+] NEW SESSION', action: 'new_session' },
        ...sortSessions(sessions).map((session) => ({
          label: session.title,
          action: 'session',
          value: session.id,
          detail: session.cwd || activeDevice?.name || '',
          activity: relativeActivity(session.updatedAt),
          approval: Boolean(session.needsApproval),
        })),
      ]
    } else {
      screen = 'new_agent'
    }
    await redraw()
  }
}

async function startTerminal(): Promise<void> {
  if (!activeDevice) return
  streamAbort?.abort()
  status = 'Opening secure shell...'
  await redraw()
  try {
    const target = activeTargetDevice
    const created = await requestJson(activeDevice, '/api/v1/terminal', {
      method: 'POST',
      body: target ? { target: target.sshHost ?? target.name, username: settings.sshTargets[target.name] } : {},
    }) as { id: string; title?: string }
    activeSession = { id: created.id, agent: 'terminal', title: created.title ?? `Terminal / ${target?.name ?? activeDevice.name}` }
    activeSessionDevice = activeDevice
    activeModel = ''
    agentTerminal.reset()
    agentTranscript = ''
    setSessionLoading(false)
    stopAgentScreenHistory()
    terminalText = `${target ? 'Tailscale SSH' : 'Capri shell'}  /  ${target?.name ?? activeDevice.name}\n`
    screen = 'terminal'
    status = 'LIVE  ·  TAP TO TALK'
    await redraw()
    startOutputStream(created.id, activeDevice)
  } catch (error) {
    status = error instanceof Error ? error.message : 'Could not open terminal'
    await redraw()
  }
}

function startOutputStream(sessionID: string, device: Device | undefined = activeDevice, onMissing?: () => void): void {
  if (!device) return
  streamAbort?.abort()
  streamAbort = new AbortController()
  const streamDevice = device
  void (async () => {
    try {
      const response = await request(streamDevice, `/api/v1/sessions/${encodeURIComponent(sessionID)}/events`, {
        method: 'GET',
        signal: streamAbort!.signal,
      })
      if (!response.ok) {
        if (response.status === 404 && onMissing) {
          onMissing()
          return
        }
        throw new Error(`Stream returned ${response.status}`)
      }
      if (!response.body) throw new Error('Session stream has no body')
      markSessionAttached()
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pending = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        pending += decoder.decode(value, { stream: true })
        const blocks = pending.split('\n\n')
        pending = blocks.pop() ?? ''
        for (const block of blocks) {
          const dataLine = block.split('\n').find((line) => line.startsWith('data:'))
          if (!dataLine) continue
          try {
            const decoded = JSON.parse(dataLine.slice(5).trim()) as string | { text?: string; done?: boolean; approval?: Approval | null }
            const payload = typeof decoded === 'string' ? { text: decoded } : decoded
            if (typeof payload.text === 'string') enqueueOutput(payload.text)
            if (payload.approval) showApproval(payload.approval)
            else if (payload.approval === null) pendingApproval = undefined
            if (payload.done) status = 'SESSION CLOSED'
          } catch {
            // Ignore an incomplete event frame.
          }
        }
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setSessionLoading(false)
      status = 'STREAM RECONNECTING'
      void redraw()
    }
  })()
}

function enqueueOutput(text: string): void {
  if (activeSession?.agent !== 'terminal') {
    agentTranscript = `${agentTranscript}${sanitizeOutput(text)}`.slice(-8_000_000)
    agentTerminal.feed(text)
    if (settings.autoScroll && chatAutoFollowing) chatOffset = 0
    void renderLive()
    return
  }
  const clean = sanitizeOutput(text)
  if (screen === 'terminal') {
    terminalText = appendTerminal(terminalText, clean)
    if (settings.autoScroll) terminalOffset = 0
  } else {
    appendChatText(clean)
    if (settings.autoScroll && chatAutoFollowing) chatOffset = 0
  }
  void renderLive()
}

function showApproval(approval: Approval): void {
  const rawPrompt = approval.prompt.trim()
  const numbered = rawPrompt.match(/(?:^|\s)1\.\s*(.*?)\s+2\.\s*(.*?)\s+3\.\s*(.*?)(?:\s+\(esc\)|$)/i)
  const dynamicOptions = numbered ? [
    { id: 'once', label: numbered[1].trim() },
    { id: 'always', label: numbered[2].trim() },
    { id: 'deny', label: numbered[3].trim() },
  ] : approval.options
  const optionStart = rawPrompt.search(/\s+1\.\s/i)
  const beforeOptions = optionStart >= 0 ? rawPrompt.slice(0, optionStart) : rawPrompt
  const lastPrompt = beforeOptions.lastIndexOf('$')
  const commandMatch = lastPrompt >= 0 ? beforeOptions.slice(lastPrompt + 1) : beforeOptions
  const command = commandMatch.trim()
    || rawPrompt.replace(/^.*?(?:run|execute|executing)\s*:\s*/i, '').trim()
  const prompt = command && command !== rawPrompt ? `$ ${command}` : rawPrompt.startsWith('$') ? rawPrompt : `$ ${rawPrompt}`
  pendingApproval = {
    ...approval,
    options: dynamicOptions,
    prompt,
  }
  if (activeSavedSessionId) {
    setSavedApproval(activeSavedSessionId, true)
    sessions = sessions.map((session) => session.id === activeSavedSessionId ? { ...session, needsApproval: true } : session)
    if (activeDevice) {
      phoneSessionsByDevice = {
        ...phoneSessionsByDevice,
        [activeDevice.name]: (phoneSessionsByDevice[activeDevice.name] ?? []).map((session) => session.id === activeSavedSessionId ? { ...session, needsApproval: true } : session),
      }
    }
  }
  if (activeSavedSessionId && rows.length) {
    rows = rows.map((row) => row.value === activeSavedSessionId ? { ...row, approval: true } : row)
  }
  if (screen !== 'approval') approvalReturnScreen = screen
  screen = 'approval'
  rows = approval.options.map((option) => ({ label: option.label, action: 'approval', value: option.id }))
  selectedRow = 0
  status = `APPROVAL NEEDED  /  ${agentLabel(approval.agent)}`
  void redraw()
}

function clearSavedApproval(): void {
  if (!activeSavedSessionId) return
  setSavedApproval(activeSavedSessionId, false)
  sessions = sessions.map((session) => session.id === activeSavedSessionId ? { ...session, needsApproval: false } : session)
  if (activeSessionDevice) {
    phoneSessionsByDevice = {
      ...phoneSessionsByDevice,
      [activeSessionDevice.name]: (phoneSessionsByDevice[activeSessionDevice.name] ?? []).map((session) => session.id === activeSavedSessionId ? { ...session, needsApproval: false } : session),
    }
  }
}

function appendChatText(text: string): void {
  const last = chatHistory.at(-1)
  if (last?.kind === 'out') last.text += text
  else chatHistory.push({ kind: 'out', text, timestamp: Date.now() })
  if (chatHistory.length > maxChatHistory()) chatHistory.splice(0, chatHistory.length - maxChatHistory())
}

function startAgentScreenHistory(): void {
  stopAgentScreenHistory()
  screenHistoryTimer = window.setInterval(() => {
    const current = presentAgentScreen(agentTranscript || agentTerminal.text())
    if (sessionLoading && current.response) setSessionLoading(false)
    if (current.action) status = current.action
    else if (!pendingApproval && screen === 'chat' && /^(RUNNING|TOOL DONE)\b/.test(status)) status = 'LIVE  ·  TAP TO TALK'
    const interactive = detectInteractivePrompt(agentTranscript || agentTerminal.text())
    if (interactive && interactive.prompt !== lastInputPrompt && !pendingApproval && activeSession) {
      showInteractivePrompt(interactive)
    }
    if (current.response && current.response !== lastAgentScreen) {
      const isContinuation = lastAgentScreen && (current.response.startsWith(lastAgentScreen) || lastAgentScreen.startsWith(current.response))
      if (lastAgentScreen && !isContinuation) {
        agentScreenHistory.push(lastAgentScreen)
        if (agentScreenHistory.length > 60) agentScreenHistory.splice(0, agentScreenHistory.length - 60)
      }
      lastAgentScreen = current.response
    }
    if (settings.autoScroll && chatAutoFollowing) chatOffset = 0
    writeChatTranscript(activeSessionDevice?.name ?? activeDevice?.name ?? '', activeSavedSessionId, agentTranscript)
    updatePhoneUI()
  }, 700)
}

function showInteractivePrompt(prompt: InteractivePrompt): void {
  pendingInput = prompt
  lastInputPrompt = prompt.prompt
  screen = 'approval'
  rows = prompt.options.map((option) => ({ label: option.label, action: 'input-option', value: option.id }))
  selectedRow = 0
  status = 'INPUT NEEDED  ·  SELECT AN OPTION'
  void redraw()
}

function stopAgentScreenHistory(): void {
  if (screenHistoryTimer === undefined) return
  window.clearInterval(screenHistoryTimer)
  screenHistoryTimer = undefined
}

function appendTerminal(current: string, text: string): string {
  let value = current + text
  value = value.replace(/\r(?!\n)/g, '\n')
  const lines = value.split('\n')
  const maxLines = settings.verbosity === 'concise' ? 40 : settings.verbosity === 'verbose' ? 240 : 80
  if (lines.length > maxLines) value = lines.slice(-maxLines).join('\n')
  return value
}

function renderLive(): void {
  const activeHud = hud
  if (!activeRuntime || !activeHud || (screen !== 'chat' && screen !== 'terminal')) {
    updatePhoneUI()
    return
  }
  if (renderTimer !== undefined) return
  renderTimer = window.setTimeout(() => {
    renderTimer = undefined
    void flushLiveRender(activeHud)
  }, 120)
}

async function flushLiveRender(activeHud: Hud): Promise<void> {
  updatePhoneUI()
  if (renderInFlight) {
    renderDirty = true
    return
  }
  renderInFlight = true
  try {
    const heading = screenTitle()
    const content = screen === 'chat' ? formatChat() : formatTerminal()
    const bodyText = screen === 'chat' && activeSession?.agent !== 'terminal' ? content : pxTruncate(content, 552)
    const view: HudView = {
      kind: 'live',
      data: {
      title: screen === 'chat' && activeSession?.agent !== 'terminal' ? 'CAPRI' : `CAPRI  //  ${heading}`,
        page: { index: 0, count: 1 },
        lines: bodyText.split('\n'),
        active: true,
        loading: sessionLoading,
        loadingFrame,
        footer: { left: status },
      },
    }
    await activeHud.show(view)
    if (!activeHud) {
      status = 'Lens display update failed'
      console.error('Capri could not update the live lens view')
      updatePhoneUI(true)
    }
  } finally {
    renderInFlight = false
    if (renderDirty) {
      renderDirty = false
      renderLive()
    }
  }
}

function formatAgentResponse(): string {
  return presentAgentScreen(agentTranscript || agentTerminal.text()).response
}

function agentReplyText(): string {
  if (agentTranscript) return formatAgentResponse()
  return [...agentScreenHistory, formatAgentResponse()].filter(Boolean).join('\n\n')
}

function agentReplyLineCount(): number {
  return agentReplyText().split('\n').flatMap((line) => wrapLine(line, 50)).length
}

function formatChat(): string {
  if (activeSession && activeSession.agent !== 'terminal') {
    if (audioActive) return '● LISTENING\nSpeak your instruction\nTap once to stop · review before send'
    if (audioBusy && status === 'TRANSCRIBING VOICE...') return 'TRANSCRIBING VOICE\nYour transcript will appear for review'
    const chunks = agentReplyText().split('\n').flatMap((line) => wrapLine(line, 50))
    const end = Math.max(0, chunks.length - chatOffset)
    const lines = chunks.slice(Math.max(0, end - visibleChatLines()), end)
    return lines.length ? lines.join('\n') : 'Waiting for agent response…'
  }
  const flattened = chatHistory.flatMap((line) => wrapLine(`${line.kind === 'in' ? 'YOU › ' : line.kind === 'sys' ? '· ' : ''}${line.text}`, 50))
  const end = Math.max(0, flattened.length - chatOffset)
  const lines = flattened.slice(Math.max(0, end - visibleChatLines()), end)
  const viewStatus = chatOffset ? `${status}  /  HISTORY ↑` : status
  return [`${viewStatus}`, '', ...lines].join('\n')
}

function formatTerminal(): string {
  const all = terminalText.split('\n')
  const end = Math.max(0, all.length - terminalOffset)
  const lines = all.slice(Math.max(0, end - visibleTerminalLines()), end)
  const viewStatus = terminalOffset ? `${status}  /  HISTORY ↑` : status
  return [`${viewStatus}`, '', ...lines].join('\n')
}

function visibleChatLines(): number {
  if (settings.hudDensity === 'spacious') return 5
  if (settings.hudDensity === 'compact') return 9
  return DEFAULT_VISIBLE_CHAT_LINES
}

function visibleTerminalLines(): number {
  if (settings.hudDensity === 'spacious') return 6
  if (settings.hudDensity === 'compact') return 12
  return 9
}

function maxChatHistory(): number {
  if (settings.verbosity === 'concise') return 60
  if (settings.verbosity === 'verbose') return MAX_HISTORY
  return 140
}

function wrapLine(text: string, width: number): string[] {
  const words = text.split(/\s+/)
  const output: string[] = []
  let line = ''
  for (const word of words) {
    if (word.length > width) {
      if (line) output.push(line)
      for (let offset = 0; offset < word.length; offset += width) output.push(word.slice(offset, offset + width))
      line = ''
      continue
    }
    const next = line ? `${line} ${word}` : word
    if (next.length <= width) line = next
    else {
      if (line) output.push(line)
      line = word
    }
  }
  if (line) output.push(line)
  return output
}

function toggleRecording(): void {
  if (audioBusy || (screen !== 'chat' && screen !== 'terminal')) return
  if (audioActive) void stopRecording()
  else void startRecording()
}

async function startRecording(): Promise<void> {
  if (!bridge || !lensReady || audioActive || audioBusy) return
  audioBusy = true
  audioBuffers = []
  updatePhoneUI(true)
  try {
    const ok = await bridge.audioControl(true, AudioInputSource.Glasses)
    if (!ok) {
      status = 'MIC UNAVAILABLE  ·  TAP TO RETRY'
      await redraw()
      return
    }
    audioActive = true
    status = '● LISTENING  ·  TAP TO STOP'
    await redraw()
  } catch (error) {
    status = error instanceof Error ? `MIC START FAILED  ·  ${error.message}` : 'MIC START FAILED'
    await redraw()
  } finally {
    audioBusy = false
    updatePhoneUI(true)
  }
}

async function stopRecording(): Promise<void> {
  if (!bridge || !audioActive || audioBusy) return
  audioBusy = true
  updatePhoneUI(true)
  try {
    await bridge.audioControl(false)
    audioActive = false
    const total = audioBuffers.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    if (total < 3200) {
      status = 'NO SPEECH  ·  TAP TO LISTEN AGAIN'
      await redraw()
      return
    }
    status = 'TRANSCRIBING VOICE...'
    await redraw()
    const pcm = concatBuffers(audioBuffers, total)
    const wav = pcmToWav(pcm, 16000)
    if (isSttReady(sttSettings)) {
      promptText = await transcribe(new Blob([wav], { type: 'audio/wav' }), sttSettings)
    } else {
      const sttDevice = devices.find((device) => device.available)
      if (!sttDevice) throw new Error('Set up a speech provider or pair a Capri runtime first')
      const form = new FormData()
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'capri.wav')
      form.append('model', 'g2-stt')
      const response = await requestJson(sttDevice, '/api/v1/transcribe', {
        method: 'POST',
        body: form,
        timeoutMs: 120000,
      }) as { text?: string }
      promptText = (response.text ?? '').trim()
    }
    if (!promptText) throw new Error('Speech was not recognized')
    terminalInput = screen === 'terminal'
    screen = 'review'
    rows = [
      { label: '> Send', action: 'send' },
      { label: '  Cancel', action: 'cancel' },
    ]
    selectedRow = 0
    status = 'TRANSCRIPT READY  ·  SEND OR CANCEL'
    await redraw()
  } catch (error) {
    status = error instanceof Error ? error.message : 'STT request failed'
    await redraw()
  } finally {
    audioBusy = false
    updatePhoneUI(true)
  }
}

function handleAudio(event: EvenHubEvent): void {
  if (!audioActive || !event.audioEvent?.audioPcm) return
  audioBuffers.push(event.audioEvent.audioPcm.slice())
}

async function sendInput(text: string, terminal: boolean): Promise<void> {
  const session = activeSession
  const device = activeSessionDevice ?? activeDevice
  if (!device || !session) return
  const input = `${text}\n`
  const response = await postSessionInput(device, session.id, input)
  if (!response) throw new Error('Input was not accepted')
  if (terminal) {
    terminalText += `\n$ ${text}\n`
    terminalOffset = 0
    screen = 'terminal'
  } else {
    chatHistory.push({ kind: 'in', text, timestamp: Date.now() })
    chatOffset = 0
    chatAutoFollowing = true
    screen = 'chat'
  }
  promptText = ''
  status = terminal ? 'LIVE  ·  TAP TO TALK' : 'LIVE  ·  TAP TO TALK'
  await redraw()
}

async function postSessionInput(device: Device, sessionID: string, text: string): Promise<unknown> {
  return requestJson(device, `/api/v1/sessions/${encodeURIComponent(sessionID)}/input`, {
    method: 'POST',
    body: { text },
  })
}

async function activateRow(row: Row): Promise<void> {
  if (row.action === 'page-next') {
    listPage += 1
    selectedRow = 0
    await redraw()
    return
  }
  if (row.action === 'page-prev') {
    listPage = Math.max(0, listPage - 1)
    selectedRow = 0
    await redraw()
    return
  }
  if (row.action === 'retry-agents') return showAgents()
  if (row.action === 'retry-sessions') return openSessions()
  if (row.action === 'more-back') {
    screen = moreReturnScreen
    await redraw()
    return
  }
  if (row.action === 'history-older') {
    if (screen !== 'more') return
    if (moreReturnScreen === 'chat' && activeSession?.agent !== 'terminal') {
      const maximum = Math.max(0, agentReplyLineCount() - visibleChatLines())
      chatOffset = Math.min(maximum, chatOffset + visibleChatLines())
      chatAutoFollowing = false
    }
    else if (moreReturnScreen === 'chat') chatOffset = Math.min(chatHistory.length * 4, chatOffset + 4)
    else if (moreReturnScreen === 'terminal') terminalOffset = Math.min(80, terminalOffset + 4)
    screen = moreReturnScreen
    await redraw()
    return
  }
  if (row.action === 'latest-output') {
    chatOffset = 0
    chatAutoFollowing = true
    terminalOffset = 0
    screen = moreReturnScreen
    await redraw()
    return
  }
  if (row.action === 'approvals') {
    if (pendingApproval) showApproval(pendingApproval)
    else {
      screen = moreReturnScreen
      status = 'No pending approvals'
      await redraw()
    }
    return
  }
  if (!['page-next', 'page-prev'].includes(row.action)) listPage = 0
  if (row.action === 'device') return selectDevice(row.value ?? '')
  if (row.action === 'new_session') {
    return showAgents()
  }
  if (row.action === 'resume_session') {
    return openSessions()
  }
  if (row.action === 'agent') {
    const agent = agents.find((item) => item.id === row.value)
    if (agent) await openModels(agent, modelMode)
    return
  }
  if (row.action === 'model') {
    activeModel = row.value ?? ''
    if (modelMode === 'new' && activeAgent) {
      await startSession(activeAgent.id, activeModel)
    } else if (modelMode === 'change' && activeSession && activeDevice) {
      try {
        await requestJson(activeDevice, `/api/v1/sessions/${encodeURIComponent(activeSession.id)}/model`, {
          method: 'POST',
          body: { model: activeModel },
        })
        status = `MODEL SET  /  ${activeModel || 'DEFAULT'}`
      } catch (error) {
        status = error instanceof Error ? error.message : 'Could not change model'
      }
      screen = modelReturnScreen
      await redraw()
    } else {
      screen = modelReturnScreen
      status = `AVAILABLE MODEL  /  ${activeModel || 'DEFAULT'}`
      await redraw()
    }
    return
  }
  if (row.action === 'session') {
    const session = sessions.find((item) => item.id === row.value)
    if (session) {
      try {
        await showRuntimes(session)
      } catch (error) {
        activeSession = undefined
        pendingResumeSession = undefined
        activeSavedSessionId = ''
        activeSessionDevice = undefined
        screen = 'resume'
        status = error instanceof Error ? error.message : 'Could not open session'
        await redraw()
      }
    }
    return
  }
  if (row.action === 'runtime') {
    const resume = pendingResumeSession
    if (resume) await startSession(resume.agent, '', resume.id, row.value ?? resume.agent)
    return
  }
  if (row.action === 'send') {
    try {
      await sendInput(promptText, terminalInput)
    } catch (error) {
      status = error instanceof Error ? error.message : 'Could not send input'
      await redraw()
    }
    return
  }
  if (row.action === 'approval') {
    if (!activeDevice || !activeSession || !pendingApproval) return
    try {
      const response = await requestJson(activeDevice, `/api/v1/sessions/${encodeURIComponent(activeSession.id)}/approval`, {
        method: 'POST',
        body: { choice: row.value ?? 'deny' },
      }) as { accepted?: boolean }
      if (!response.accepted) throw new Error('Approval denied')
      pendingApproval = undefined
      clearSavedApproval()
      screen = approvalReturnScreen
      status = `APPROVAL SENT  /  ${row.label.toUpperCase()}`
      await redraw()
    } catch (error) {
      status = error instanceof Error ? error.message : 'Could not send approval'
      await redraw()
    }
    return
  }
  if (row.action === 'input-option') {
    if (!activeSession || !pendingInput) return
    try {
      const choice = row.value ?? row.label
      const answeredPrompt = pendingInput.prompt
      await sendInput(choice, false)
      pendingInput = undefined
      lastInputPrompt = answeredPrompt
      status = 'LIVE  ·  TAP TO TALK'
      await redraw()
    } catch (error) {
      status = error instanceof Error ? error.message : 'Could not send selection'
      await redraw()
    }
    return
  }
  if (row.action === 'cancel') {
    screen = terminalInput ? 'terminal' : 'chat'
    promptText = ''
    status = 'LIVE  ·  TAP TO TALK'
    await redraw()
    return
  }
}

function goBack(): void {
  if (audioActive) {
    void stopRecording()
    return
  }
  if (audioBusy) return
  if (screen === 'devices') return
  if (screen === 'session-choice') {
    void refreshDevices()
  } else if (screen === 'new_agent' || screen === 'new_session' || screen === 'resume') {
    void selectDevice(activeDevice?.name ?? '')
  } else if (screen === 'runtimes') {
    pendingResumeSession = undefined
    void openSessions()
  } else if (screen === 'more') {
    screen = moreReturnScreen
    void redraw()
  } else if (screen === 'review') {
    screen = terminalInput ? 'terminal' : 'chat'
    promptText = ''
    status = 'LIVE  ·  TAP TO TALK'
    void redraw()
  } else if (screen === 'approval') {
    pendingInput = undefined
    lastInputPrompt = ''
    screen = approvalReturnScreen
    void redraw()
  } else if (screen === 'chat' || screen === 'terminal') {
    streamAbort?.abort()
    stopAgentScreenHistory()
    const session = activeSession
    const device = activeSessionDevice
    if (session && device) {
      void requestJson(device, `/api/v1/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' }).catch((error) => {
        console.warn('Capri could not close the session while going back', error)
      })
    }
    activeSession = undefined
    activeSavedSessionId = ''
    activeSessionDevice = undefined
    activeTargetDevice = undefined
    pendingApproval = undefined
    void selectDevice(activeDevice?.name ?? '')
  }
}

async function redraw(updatePhone = true): Promise<void> {
  if (updatePhone) updatePhoneUI()
  const activeHud = hud
  if (!activeHud) return

  const view = viewForScreen()
  if (!view) return
  await activeHud.show(view)
}

function viewForScreen(): HudView | undefined {
  const title = screenTitle()

  if (screen === 'devices') {
    return {
      kind: 'devices',
      data: {
        title: 'Cyberdecks',
        page: { index: 0, count: 1 },
        rows: devices.map((device) => ({
          name: device.name,
          ip: device.ip,
          online: device.online,
          available: device.available,
          ssh: device.sshHost,
        })),
        selected: selectedRow,
        footer: { left: status },
      },
    }
  }
  if (screen === 'approval' && pendingApproval) {
    return {
      kind: 'approval',
      data: {
        title,
        page: { index: 0, count: 1 },
        prompt: pendingApproval.prompt,
        options: pendingApproval.options,
        selected: selectedRow,
        footer: { left: status },
      },
    }
  }
  if (screen === 'approval' && pendingInput) {
    return {
      kind: 'approval',
      data: {
        title: 'INPUT NEEDED',
        page: { index: 0, count: 1 },
        prompt: pendingInput.prompt,
        options: pendingInput.options,
        selected: selectedRow,
        footer: { left: status },
      },
    }
  }
  if (screen === 'new_agent' || screen === 'resume' || screen === 'runtimes' || screen === 'review' || screen === 'more') {
    const listRows = visibleRows().map((row) => {
      if (row.action !== 'session') return { label: row.label }
      const session = sessions.find((item) => item.id === row.value)
      return {
        label: row.label,
        value: row.detail || session?.cwd || activeDevice?.name || '',
        meta: session ? sessionHarness(session) : '',
        activity: row.activity || relativeActivity(session?.updatedAt),
        approval: row.approval,
      }
    })
    return {
      kind: 'list',
      data: {
        title,
        page: {
          index: screen === 'resume' ? Math.floor(Math.max(0, selectedRow) / 2) : listPage,
          count: listPageCount(),
        },
        rows: listRows,
        selected: selectedRow,
        footer: { left: status },
      },
    }
  }
  if (screen === 'chat' || screen === 'terminal') {
    return {
      kind: 'live',
      data: {
        title: `CAPRI  //  ${title}`,
        page: { index: 0, count: 1 },
        lines: (screen === 'chat' ? formatChat() : formatTerminal()).split('\n'),
        active: true,
        loading: sessionLoading,
        loadingFrame,
        footer: { left: status },
      },
    }
  }
  return undefined
}

function sessionHarness(session: SessionInfo): string {
  const runtime = session.runtime || session.agent
  if (runtime === 'nclaude') return 'NCLAUDE'
  if (runtime === 'claude') return 'CLAUDE'
  return runtime.toUpperCase()
}

function sortSessions(items: SessionInfo[]): SessionInfo[] {
  return [...items].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}

function relativeActivity(value?: number): string {
  if (!value) return '—'
  const timestamp = value < 1_000_000_000_000 ? value * 1000 : value
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return `${Math.floor(days / 7)}w`
}

function screenTitle(): string {
  const context = activeTargetDevice ? `  /  ${activeTargetDevice.name}` : activeDevice ? `  /  ${activeDevice.name}` : ''
  if (screen === 'devices') return 'Cyberdecks'
  if (screen === 'session-choice') return `SESSION PROTOCOL${context}`
  if (screen === 'new_agent') return `NEW SESSION${context}`
  if (screen === 'new_session') return `MODELS / ${activeAgent?.name ?? 'AGENT'}`
  if (screen === 'resume') return `SESSIONS${context}`
  if (screen === 'runtimes') return 'CHOOSE RUNTIME'
  if (screen === 'more') return `RUNNER TOOLS${context}`
  if (screen === 'review') return terminalInput ? 'REVIEW / COMMAND' : 'REVIEW / PROMPT'
  if (screen === 'approval') return `APPROVAL NEEDED${context}`
  if (screen === 'terminal') return `TERMINAL${context}`
  if (screen === 'chat' && activeSession?.agent !== 'terminal') {
    return 'LIVE'
  }
  return `${activeAgent?.name ?? 'SESSION'}${context}`
}

function listPageCount(): number {
  const pageSize = screen === 'resume' ? 2 : LIST_PAGE_SIZE
  return Math.max(1, Math.ceil(rows.length / pageSize))
}

function visibleRows(): Row[] {
  return rows
}


async function request(device: Device, path: string, init: ApiInit = {}): Promise<Response> {
  const token = device.token || API_TOKEN
  if (!token) throw new Error('Capri runtime token is missing; open Setup to pair this machine')
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  const isForm = init.body instanceof FormData
  const isObject = init.body !== undefined && init.body !== null && typeof init.body === 'object' && !isForm && !(init.body instanceof Blob) && !(init.body instanceof ArrayBuffer) && !ArrayBuffer.isView(init.body)
  if (isObject) headers.set('Content-Type', 'application/json')
  const body: BodyInit | undefined = isObject ? JSON.stringify(init.body) : init.body as BodyInit | undefined
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), init.timeoutMs ?? 12000)
  try {
    const { timeoutMs: _timeoutMs, body: _body, ...fetchInit } = init
    return await fetch(device.baseUrl + path, { ...fetchInit, headers, body, signal: init.signal ?? controller.signal, cache: 'no-store' })
  } finally {
    window.clearTimeout(timeout)
  }
}

async function requestJson(device: Device, path: string, init: ApiInit = {}): Promise<unknown> {
  const response = await request(device, path, init)
  const body = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(body.error ?? `Service returned ${response.status}`)
  return body
}

function sanitizeOutput(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b[()][0-2A-Z]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\r/g, '\n')
}

function concatBuffers(parts: Uint8Array[], length: number): Uint8Array {
  const merged = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.byteLength
  }
  return merged
}

function pcmToWav(pcm: Uint8Array, sampleRate: number): ArrayBuffer {
  const wav = new ArrayBuffer(44 + pcm.byteLength)
  const view = new DataView(wav)
  const write = (offset: number, text: string) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)))
  write(0, 'RIFF')
  view.setUint32(4, 36 + pcm.byteLength, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, pcm.byteLength, true)
  new Uint8Array(wav, 44).set(pcm)
  return wav
}

function agentLabel(id: string): string {
  if (id === 'claude') return 'Claude'
  if (id === 'nclaude') return 'nClaude'
  if (id === 'codex') return 'Codex'
  if (id === 'opencode') return 'OpenCode'
  if (id === 'ghost') return 'Ghost'
  if (id === 'codewhale') return 'CodeWhale'
  if (id === 'dsh') return 'DSH'
  if (id === 'kimi') return 'Kimi Code'
  if (id === 'gemini') return 'Gemini CLI'
  if (id === 'cline') return 'Cline'
  return id.toUpperCase()
}

function cleanup(): void {
  if (renderTimer !== undefined) window.clearTimeout(renderTimer)
  renderTimer = undefined
  if (audioActive) void bridge?.audioControl(false, AudioInputSource.Glasses)
  audioActive = false
  streamAbort?.abort()
  unsubscribeHub?.()
  stopAgentScreenHistory()
}
