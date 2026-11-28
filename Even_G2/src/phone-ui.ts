import capriShieldBadge from '../icons/custom/CapriShieldBadge.png?url'
import { EMPTY_STT, STT_PROVIDERS, type SttSettings } from './stt'
import { draftTextForSubmit, isReviewingDraft } from './phone-draft'

export type PhoneTab = 'devices' | 'sessions' | 'terminal' | 'setup' | 'settings'

export type PhoneRuntimeDevice = {
  name: string
  baseUrl: string
  token: string
}

export type PhoneDevice = {
  name: string
  ip: string
  sshHost?: string
  os?: string
  sshEligible?: boolean
  online: boolean
  baseUrl: string
  available: boolean
  checking?: boolean
  capriHost?: boolean
  configuredName?: string
  sshAvailable?: boolean
  controllerName?: string
}

export type PhoneAgent = {
  id: string
  name: string
  available: boolean
  runtimes?: string[]
}

export type PhoneSession = {
  id: string
  agent: string
  title: string
  updatedAt?: number
  runtime?: string
  cwd?: string
  needsApproval?: boolean
}

export type PhoneChatLine = {
  kind: 'out' | 'in' | 'sys'
  text: string
  timestamp?: number
}

export type PhoneApproval = {
  agent: string
  prompt: string
  options: Array<{ id: string; label: string }>
}

export type CapriSettings = {
  defaultAgent: string
  defaultDevice: string
  defaultModels: Record<string, string>
  sshTargets: Record<string, string>
  claudeRuntime: 'claude' | 'nclaude'
  hudDensity: 'spacious' | 'balanced' | 'compact'
  phoneTextSize: 'small' | 'normal' | 'large'
  verbosity: 'concise' | 'balanced' | 'verbose'
  autoScroll: boolean
  showTimestamps: boolean
}

export type PhoneSnapshot = {
  devices: PhoneDevice[]
  selectedDeviceName: string
  activeSession?: PhoneSession
  activeSessionDeviceName?: string
  activeModel: string
  sessionsByDevice: Record<string, PhoneSession[]>
  agentsByDevice: Record<string, PhoneAgent[]>
  modelsByDevice: Record<string, Record<string, string[]>>
  chatHistory: PhoneChatLine[]
  terminalText: string
  agentScreenText: string
  transcriptText: string
  agentScreenHeader: string
  draftText: string
  pendingApproval?: PhoneApproval
  status: string
  recording: boolean
  audioBusy: boolean
  settings: CapriSettings
  stt: SttSettings
  sttStatus: string
  sttTesting: boolean
  configuredDevices: PhoneRuntimeDevice[]
}

export type PhoneActions = {
  refresh: () => void
  loadModels: (device: string, agent: string) => void
  startSession: (device: string, agent: string, model: string) => void
  resumeSession: (device: string, session: PhoneSession, runtime: string) => void
  startTerminal: (device: string) => void
  sendInput: (device: string, text: string, terminal: boolean) => void
  cancelReview: () => void
  sendTerminalKey: (device: string, key: string) => void
  disconnect: () => void
  changeModel: (device: string, model: string) => void
  approval: (choice: string) => void
  talk: () => void
  saveSettings: (settings: CapriSettings) => void
  saveStt: (settings: SttSettings) => void
  testStt: (settings: SttSettings) => void
  saveRuntimeDevice: (device: PhoneRuntimeDevice) => void
  removeRuntimeDevice: (name: string) => void
  resetStorage: () => void
}

const SETTINGS_KEY = 'capri.phone.settings.v1'
const COMMANDS_KEY = 'capri.phone.commands.v1'

export const DEFAULT_SETTINGS: CapriSettings = {
  defaultAgent: 'claude',
  defaultDevice: '',
  defaultModels: {},
  sshTargets: {},
  claudeRuntime: 'claude',
  hudDensity: 'balanced',
  phoneTextSize: 'normal',
  verbosity: 'balanced',
  autoScroll: true,
  showTimestamps: true,
}

export function readSettings(): CapriSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<CapriSettings>
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      defaultModels: stored.defaultModels && typeof stored.defaultModels === 'object' ? stored.defaultModels : {},
      sshTargets: stored.sshTargets && typeof stored.sshTargets === 'object' ? stored.sshTargets : {},
    }
  } catch {
    return { ...DEFAULT_SETTINGS, defaultModels: {} }
  }
}

export function writeSettings(settings: CapriSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Keep current-session settings usable when WebView storage is unavailable.
  }
}

export class PhoneUI {
  private readonly root: HTMLElement
  private readonly actions: PhoneActions
  private snapshot?: PhoneSnapshot
  private tab: PhoneTab = import.meta.env.DEV && new URLSearchParams(window.location.search).get('shot') === 'live' ? 'sessions' : 'devices'
  private deviceName = ''
  private sessionMachine = 'all'
  private sessionAgent = 'all'
  private sessionQuery = ''
  private newAgent = ''
  private newModel = ''
  private settingsModelAgent = ''
  private sshHostName = ''
  private sshUsername = ''
  private localFeedback = ''
  private currentDraft = ''
  private commandHistory: Record<string, string[]> = this.readCommandHistory()
  private historyIndex = -1
  private pendingRender?: number
  private renderQueued = false
  private renderedTab?: PhoneTab
  private mainScrollEpoch = 0
  private mainScrollTop = 0
  private restoringMainScroll = false
  private restoreFrame?: number
  private sttDraft: SttSettings = { ...EMPTY_STT }
  private setupName = ''
  private setupEndpoint = ''
  private setupToken = ''
  private editingDeviceName = ''
  private resetConfirm = false

  constructor(root: HTMLElement, actions: PhoneActions) {
    this.root = root
    this.actions = actions
    this.root.addEventListener('click', (event) => this.onClick(event))
    this.root.addEventListener('change', (event) => this.onChange(event))
    this.root.addEventListener('input', (event) => this.onInput(event))
    this.root.addEventListener('submit', (event) => this.onSubmit(event))
    this.root.addEventListener('keydown', (event) => this.onKeyDown(event))
    this.root.addEventListener('scroll', (event) => {
      const target = event.target
      if (target instanceof HTMLElement && target.classList.contains('phone-main')) {
        if (this.restoringMainScroll) return
        this.mainScrollEpoch += 1
        this.mainScrollTop = target.scrollTop
      }
    }, true)
    this.root.addEventListener('focusout', () => {
      if (this.renderQueued) this.scheduleRender()
    })
  }

  update(snapshot: PhoneSnapshot, immediate = false): void {
    this.snapshot = snapshot
    const active = document.activeElement
    if (!(active instanceof HTMLElement && active.dataset.sttEditor === '1')) this.sttDraft = { ...snapshot.stt }
    const available = snapshot.devices.filter((device) => device.available)
    if (!snapshot.devices.some((device) => device.name === this.deviceName)) {
      this.deviceName = snapshot.settings.defaultDevice || available[0]?.name || snapshot.devices[0]?.name || ''
    }
    if (this.hasActiveEditor() || this.hasFocusedSelect()) {
      this.renderQueued = true
      return
    }
    this.scheduleRender(immediate)
  }

  private hasActiveEditor(): boolean {
    const active = document.activeElement
    return active instanceof HTMLElement && this.root.contains(active) && active.matches('[data-editor="1"]')
  }

  private hasFocusedSelect(): boolean {
    const active = document.activeElement
    return active instanceof HTMLSelectElement && this.root.contains(active)
  }

  private scheduleRender(immediate = false): void {
    if (this.pendingRender !== undefined) window.clearTimeout(this.pendingRender)
    this.pendingRender = window.setTimeout(() => {
      this.pendingRender = undefined
      if ((this.hasActiveEditor() || this.hasFocusedSelect()) && !immediate) {
        this.renderQueued = true
        return
      }
      this.renderQueued = false
      this.render()
    }, immediate ? 0 : 160)
  }

  private deferControlRender(): void {
    this.renderQueued = true
    this.scheduleRender()
  }

  private onClick(event: Event): void {
    const target = event.target
    if (!(target instanceof Element)) return
    const button = target.closest<HTMLElement>('button[data-action]')
    if (!button || button.hasAttribute('disabled')) return
    const action = button.dataset.action ?? ''
    const device = button.dataset.device || this.deviceName
    const value = button.dataset.value ?? ''
    const session = this.snapshot?.sessionsByDevice[device]?.find((item) => item.id === button.dataset.session)

    switch (action) {
      case 'tab':
        if (this.snapshot?.devices.some((item) => item.name === device)) this.deviceName = device
        this.tab = value as PhoneTab
        this.render()
        break
      case 'refresh':
        this.actions.refresh()
        break
      case 'select-device':
        this.deviceName = device
        this.tab = 'devices'
        this.render()
        break
      case 'jack-in':
        this.deviceName = device
        this.tab = 'sessions'
        this.render()
        break
      case 'new-session':
        this.deviceName = device
        this.tab = 'sessions'
        this.newAgent = this.preferredAgent(device)
        this.newModel = this.defaultModel(device, this.newAgent)
        this.actions.loadModels(device, this.newAgent)
        this.render()
        break
      case 'cancel-new':
        this.newAgent = ''
        this.newModel = ''
        this.render()
        break
      case 'load-models':
        this.actions.loadModels(device, value || this.newAgent || this.preferredAgent(device))
        break
      case 'start-session':
        if (this.newAgent) this.actions.startSession(device, this.newAgent, this.newModel)
        break
      case 'resume':
        if (session) {
          const installed = this.snapshot?.agentsByDevice[device] ?? []
          const claudeRuntimes = installed.find((item) => item.id === 'claude')?.runtimes ?? []
          const preferred = this.snapshot?.settings.claudeRuntime ?? 'claude'
          const runtime = session.agent === 'claude'
            ? claudeRuntimes.includes(preferred) ? preferred : claudeRuntimes[0] ?? 'claude'
            : session.agent
          this.actions.resumeSession(device, session, runtime)
          this.tab = 'sessions'
        }
        break
      case 'terminal':
        this.deviceName = device
        this.tab = 'terminal'
        this.actions.startTerminal(device)
        break
      case 'configure-ssh':
        this.deviceName = device
        this.sshHostName = device
        this.sshUsername = this.snapshot?.settings.sshTargets[device] ?? ''
        this.tab = 'settings'
        this.render()
        break
      case 'talk':
        this.actions.talk()
        break
      case 'send':
        this.submitDraft()
        break
      case 'cancel':
        if (this.snapshot && isReviewingDraft(this.snapshot.status)) {
          this.currentDraft = this.snapshot.draftText
          this.actions.cancelReview()
          this.render()
        }
        break
      case 'terminal-key':
        this.actions.sendTerminalKey(device, value)
        break
      case 'clear-terminal':
        if (this.snapshot) this.snapshot.terminalText = ''
        this.render()
        break
      case 'disconnect':
        if (window.confirm('Jack out of this session?')) this.actions.disconnect()
        break
      case 'change-model':
        this.actions.changeModel(device, value)
        break
      case 'session-filter-chip':
        this.sessionAgent = value
        this.render()
        break
      case 'history':
        this.fillHistory(device, Number(value))
        break
      case 'reset-settings':
        this.resetConfirm = true
        this.render()
        break
      case 'reset-cancel':
        this.resetConfirm = false
        this.render()
        break
      case 'reset-confirm':
        this.resetConfirm = false
        this.actions.resetStorage()
        break
      case 'save-ssh-target':
        this.saveSshTarget()
        break
      case 'remove-ssh-target':
        this.removeSshTarget(device)
        break
      case 'stt-save':
        this.actions.saveStt({ ...this.sttDraft })
        break
      case 'stt-test':
        this.actions.testStt({ ...this.sttDraft })
        break
      case 'setup-save':
        if (this.setupName.trim() && this.setupEndpoint.trim() && this.setupToken.trim()) {
          if (this.editingDeviceName && this.editingDeviceName.toLowerCase() !== this.setupName.trim().toLowerCase()) this.actions.removeRuntimeDevice(this.editingDeviceName)
          this.actions.saveRuntimeDevice({ name: this.setupName.trim(), baseUrl: this.setupEndpoint.trim().replace(/\/$/, ''), token: this.setupToken.trim() })
          this.setupName = ''
          this.setupEndpoint = ''
          this.setupToken = ''
          this.editingDeviceName = ''
        }
        break
      case 'setup-edit': {
        const configured = this.snapshot?.configuredDevices.find((item) => item.name === value)
        if (configured) {
          this.editingDeviceName = configured.name
          this.setupName = configured.name
          this.setupEndpoint = configured.baseUrl
          this.setupToken = configured.token
          this.tab = 'setup'
          this.render()
        }
        break
      }
      case 'setup-remove':
        this.actions.removeRuntimeDevice(value)
        if (this.editingDeviceName === value) {
          this.editingDeviceName = ''
          this.setupName = ''
          this.setupEndpoint = ''
          this.setupToken = ''
        }
        break
    }
  }

  private onChange(event: Event): void {
    const target = event.target
    if (!(target instanceof HTMLSelectElement) && !(target instanceof HTMLInputElement)) return
    const action = target.dataset.action
    if (!action || !this.snapshot) return
    const settings = { ...this.snapshot.settings, defaultModels: { ...this.snapshot.settings.defaultModels } }
    if (action === 'device') {
      this.deviceName = target.value
      this.newModel = this.defaultModel(this.deviceName, this.newAgent || this.preferredAgent(this.deviceName))
      this.deferControlRender()
      return
    }
    if (action === 'stt-provider') {
      this.sttDraft.provider = target.value as SttSettings['provider']
      const provider = STT_PROVIDERS.find((item) => item.id === target.value)
      if (provider) this.sttDraft.model = provider.defaultModel
      this.deferControlRender()
      return
    }
    if (action === 'stt-model') {
      this.sttDraft.model = target.value
      return
    }
    if (action === 'stt-language') {
      this.sttDraft.language = target.value
      return
    }
    if (action === 'ssh-host') {
      this.sshHostName = target.value
      this.sshUsername = this.snapshot.settings.sshTargets[target.value] ?? ''
      this.deferControlRender()
      return
    }
    if (action === 'session-filter') {
      this.sessionMachine = target.value
      this.deferControlRender()
      return
    }
    if (action === 'change-model') {
      this.actions.changeModel(target.dataset.device || this.deviceName, target.value)
      return
    }
    if (action === 'session-agent') {
      this.sessionAgent = target.value
      this.deferControlRender()
      return
    }
    if (action === 'new-agent') {
      this.newAgent = target.value
      this.newModel = this.defaultModel(this.deviceName, this.newAgent)
      this.actions.loadModels(this.deviceName, this.newAgent)
      this.deferControlRender()
      return
    }
    if (action === 'new-model') {
      this.newModel = target.value
      return
    }
    if (action === 'default-device') settings.defaultDevice = target.value
    else if (action === 'default-agent') {
      settings.defaultAgent = target.value
      this.settingsModelAgent = target.value
      this.actions.loadModels(this.deviceName, target.value)
    } else if (action === 'default-model-agent') {
      this.settingsModelAgent = target.value
      this.actions.loadModels(this.deviceName, target.value)
    } else if (action === 'default-model') {
      const agent = this.settingsModelAgent || settings.defaultAgent
      settings.defaultModels[this.modelKey(this.deviceName, agent)] = target.value
    } else if (action === 'claude-runtime') {
      settings.claudeRuntime = target.value as CapriSettings['claudeRuntime']
    } else if (action === 'hud-density') {
      settings.hudDensity = target.value as CapriSettings['hudDensity']
    } else if (action === 'phone-text-size') {
      settings.phoneTextSize = target.value as CapriSettings['phoneTextSize']
    } else if (action === 'verbosity') {
      settings.verbosity = target.value as CapriSettings['verbosity']
    } else if (action === 'auto-scroll') {
      settings.autoScroll = (target as HTMLInputElement).checked
    } else if (action === 'timestamps') {
      settings.showTimestamps = (target as HTMLInputElement).checked
    } else {
      return
    }
    this.actions.saveSettings(settings)
  }

  private onInput(event: Event): void {
    const target = event.target
    if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) return
    if (target.dataset.action === 'session-search') {
      this.sessionQuery = target.value
      const selectionStart = target.selectionStart
      const selectionEnd = target.selectionEnd
      this.render()
      const next = this.root.querySelector<HTMLInputElement>('[data-action="session-search"]')
      next?.focus({ preventScroll: true })
      if (next && selectionStart !== null && selectionEnd !== null) next.setSelectionRange(selectionStart, selectionEnd)
    } else if (target.dataset.action === 'composer') {
      this.currentDraft = target.value
    } else if (target.dataset.action === 'ssh-username') {
      this.sshUsername = target.value
    } else if (target.dataset.action === 'stt-key') {
      this.sttDraft.apiKey = target.value
    } else if (target.dataset.action === 'stt-model') {
      this.sttDraft.model = target.value
    } else if (target.dataset.action === 'stt-language') {
      this.sttDraft.language = target.value
    } else if (target.dataset.action === 'setup-name') {
      this.setupName = target.value
    } else if (target.dataset.action === 'setup-endpoint') {
      this.setupEndpoint = target.value
    } else if (target.dataset.action === 'setup-token') {
      this.setupToken = target.value
    }
  }

  private onSubmit(event: Event): void {
    const target = event.target
    if (!(target instanceof HTMLFormElement) || target.dataset.form !== 'composer') return
    event.preventDefault()
    this.submitDraft()
  }

  private onKeyDown(event: KeyboardEvent): void {
    const target = event.target
    if (!(target instanceof HTMLTextAreaElement) || target.dataset.action !== 'composer') return
    const terminal = this.snapshot?.activeSession?.agent === 'terminal'
    if (terminal && event.key === 'ArrowUp' && target.selectionStart === 0 && target.selectionEnd === 0) {
      event.preventDefault()
      this.fillHistory(this.deviceName, this.historyIndex + 1)
      return
    }
    if (terminal && event.key === 'ArrowDown' && target.selectionStart === target.value.length) {
      event.preventDefault()
      this.fillHistory(this.deviceName, this.historyIndex - 1)
      return
    }
    if (event.key === 'Enter' && (terminal || !event.shiftKey)) {
      event.preventDefault()
      this.submitDraft()
    }
  }

  private submitDraft(): void {
    if (!this.snapshot) return
    const status = this.snapshot.status ?? ''
    const text = draftTextForSubmit(status, this.snapshot.draftText ?? '', this.currentDraft)
    if (!text) return
    const active = this.snapshot.activeSession
    if (active?.agent === 'terminal') {
      const key = this.deviceName
      const list = this.commandHistory[key] ?? []
      if (list.at(-1) !== text) this.commandHistory[key] = [...list, text].slice(-60)
      this.writeCommandHistory()
      this.historyIndex = -1
    }
    this.actions.sendInput(this.snapshot.activeSessionDeviceName || this.deviceName, text, active?.agent === 'terminal')
    this.currentDraft = ''
    this.render()
  }

  private fillHistory(device: string, delta: number): void {
    const history = [...(this.commandHistory[device] ?? [])].reverse()
    this.historyIndex = Math.max(-1, Math.min(history.length - 1, delta))
    this.currentDraft = this.historyIndex < 0 ? '' : history[this.historyIndex] ?? ''
    this.render()
    const input = this.root.querySelector<HTMLTextAreaElement>('[data-action="composer"]')
    input?.focus({ preventScroll: true })
    input?.setSelectionRange(input.value.length, input.value.length)
  }

  private readCommandHistory(): Record<string, string[]> {
    try {
      const stored = JSON.parse(localStorage.getItem(COMMANDS_KEY) ?? '{}') as Record<string, unknown>
      return Object.fromEntries(Object.entries(stored).map(([key, value]) => [key, Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(-60) : []]))
    } catch {
      return {}
    }
  }

  private writeCommandHistory(): void {
    try {
      localStorage.setItem(COMMANDS_KEY, JSON.stringify(this.commandHistory))
    } catch {
      // Command history is a convenience and remains in memory for this launch.
    }
  }

  private saveSshTarget(): void {
    const state = this.snapshot
    if (!state) return
    const host = state.devices.find((device) => device.name === this.sshHostName)
    const username = this.sshUsername.trim()
    if (!host?.online || !host.sshHost) {
      this.localFeedback = 'Jack into an online deck first.'
      this.render()
      return
    }
    if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(username)) {
      this.localFeedback = 'Enter a Linux or macOS account name (letters, numbers, _ or -).'
      this.render()
      return
    }
    const settings = { ...state.settings, sshTargets: { ...state.settings.sshTargets, [host.name]: username } }
    this.localFeedback = ''
    this.actions.saveSettings(settings)
  }

  private removeSshTarget(device: string): void {
    if (!this.snapshot) return
    const sshTargets = { ...this.snapshot.settings.sshTargets }
    delete sshTargets[device]
    this.actions.saveSettings({ ...this.snapshot.settings, sshTargets })
  }

  private preferredAgent(device: string): string {
    const configured = this.snapshot?.settings.defaultAgent ?? DEFAULT_SETTINGS.defaultAgent
    const agents = this.snapshot?.agentsByDevice[device] ?? []
    return agents.some((agent) => agent.id === configured && agent.available)
      ? configured
      : agents.find((agent) => agent.available)?.id ?? configured
  }

  private modelKey(device: string, agent: string): string {
    return `${device}:${agent}`
  }

  private defaultModel(device: string, agent: string): string {
    return this.snapshot?.settings.defaultModels[this.modelKey(device, agent)] ?? ''
  }

  private render(): void {
    const state = this.snapshot
    if (!state) return
    const sameTab = this.renderedTab === this.tab
    const previousMainScroll = sameTab
      ? this.root.querySelector<HTMLElement>('.phone-main')?.scrollTop ?? this.mainScrollTop
      : 0
    if (!sameTab) {
      this.mainScrollTop = 0
    }
    const previousTerminalScroll = this.root.querySelector<HTMLElement>('.terminal-output')?.scrollTop ?? 0
    const previousFeedScroll = this.root.querySelector<HTMLElement>('.chat-feed')?.scrollTop ?? 0
    const previousGlassesScroll = this.root.querySelector<HTMLElement>('.glasses-screen-copy')?.scrollTop ?? 0
    const devices = state.devices
    const current = devices.find((device) => device.name === this.deviceName) ?? devices[0]
    if (current && !this.deviceName) this.deviceName = current.name
    this.root.dataset.textSize = state.settings.phoneTextSize
    this.root.innerHTML = `
      <div class="phone-shell">
        <header class="phone-header">
          <div class="brand-lockup">
            <div class="brand-mark" aria-hidden="true"><img class="brand-icon" src="${capriShieldBadge}" alt=""><span class="brand-cursor"></span></div>
            <div><div class="brand-name">CAPRI</div><div class="brand-caption">CYBERDECK CONTROL</div></div>
          </div>
          <div class="header-actions"><span class="header-state">${state.devices.filter((device) => device.online).length} LINKED</span><button class="icon-button" type="button" data-action="refresh" aria-label="Refresh deck status">Sync</button></div>
        </header>
        <main class="phone-main">${this.renderBanner(state)}${this.renderContent(state, current)}</main>
        <nav class="phone-tabs" aria-label="Main navigation">
          ${this.renderTab('devices', 'DECKS')}
          ${this.renderTab('sessions', 'SESSIONS')}
          ${this.renderTab('terminal', 'TERMINAL')}
          ${this.renderTab('setup', 'SETUP')}
          ${this.renderTab('settings', 'SETTINGS')}
        </nav>
      </div>`
    this.renderedTab = this.tab
    this.restoreScroll(previousMainScroll, previousTerminalScroll, previousFeedScroll, previousGlassesScroll)
  }

  private renderTab(tab: PhoneTab, label: string): string {
    const active = this.tab === tab
    return `<button class="tab-button${active ? ' is-active' : ''}" type="button" data-action="tab" data-value="${tab}" aria-current="${active ? 'page' : 'false'}"><span class="tab-indicator"></span><span>${label}</span></button>`
  }

  private renderBanner(state: PhoneSnapshot): string {
    if (!state.status || state.status === 'Capri online' || state.status === 'Jack into a deck') return ''
    const warning = /error|failed|unavailable|could not|not found|closed|reconnecting|missing/i.test(state.status)
    return `<div class="status-banner${warning ? ' is-warning' : ''}" role="status"><span class="status-dot"></span><span>${escapeHtml(state.status)}</span></div>`
  }

  private renderContent(state: PhoneSnapshot, current?: PhoneDevice): string {
    if (this.tab === 'devices') return this.renderDevices(state)
    if (this.tab === 'sessions') return this.renderSessions(state)
    if (this.tab === 'terminal') return this.renderTerminal(state, current)
    if (this.tab === 'setup') return this.renderSetup(state)
    return this.renderSettings(state)
  }

  private renderSetup(state: PhoneSnapshot): string {
    const rawInstaller = 'https://raw.githubusercontent.com/ARCANGEL0/Capri/main/runtime/setup_install.sh'
    return `<section class="page-heading setup-heading"><h1>Setup</h1><p>Bring a Tailscale machine onto your private Capri lane.</p></section>
      <section class="nr-card setup-guide-card"><div class="section-title"><h2>01 · Boot the runtime</h2><p>Run this on the machine that owns your coding-agent sessions.</p></div>
        <div class="setup-terminal"><span class="setup-prompt">$</span><code>curl -fsSL ${rawInstaller} | bash</code></div>
        <a class="setup-link" href="${rawInstaller}" target="_blank" rel="noreferrer">OPEN RAW INSTALLER</a>
        <ol class="setup-steps"><li>Keep Tailscale connected and run the command as the same user who owns Claude Code, Codex, OpenCode, or Ghost.</li><li>The installer starts <strong>capri-runtime</strong>, configures Tailscale Serve, and prints pairing data.</li><li>Paste the printed endpoint and token below.</li></ol>
      </section>
      <section class="nr-card setup-guide-card"><div class="section-title"><h2>02 · Pair the deck</h2><p>The token stays in this phone’s local storage and is sent only to the endpoint you add.</p></div>
        <label class="field-label">Machine name<input class="search-field" data-action="setup-name" data-editor="1" value="${attr(this.setupName)}" placeholder="for example, studio-mac" autocapitalize="none" spellcheck="false"></label>
        <label class="field-label">Tailscale HTTPS endpoint<input class="search-field" data-action="setup-endpoint" data-editor="1" value="${attr(this.setupEndpoint)}" placeholder="https://machine.tailnet.ts.net:8447" autocapitalize="none" spellcheck="false"></label>
        <label class="field-label">Runtime token<input class="search-field" type="password" data-action="setup-token" data-editor="1" value="${attr(this.setupToken)}" placeholder="Paste the token printed by the installer" autocomplete="off" spellcheck="false"></label>
        <button class="button button-primary button-wide" type="button" data-action="setup-save">${this.editingDeviceName ? 'Save changes' : 'Pair machine'}</button>
      </section>
      <section class="nr-card setup-guide-card"><div class="section-title"><h2>03 · Linked decks</h2><p>Capri checks these endpoints when you refresh the deck list.</p></div>
        ${state.configuredDevices.length ? `<div class="service-list setup-device-list">${state.configuredDevices.map((device) => `<div class="service-row"><div><strong>${escapeHtml(device.name)}</strong><span>${escapeHtml(device.baseUrl)}</span></div><div class="service-actions">${iconButton('setup-edit', device.name, `Edit ${device.name}`, 'edit')}${iconButton('setup-remove', device.name, `Delete ${device.name}`, 'delete')}</div></div>`).join('')}</div>` : '<p class="field-note">No machines paired yet. The deck list will stay empty until a runtime is added.</p>'}
      </section>
      <footer class="phone-footer">CAPRI // SETUP CHANNEL · TAILSCALE ONLY</footer>`
  }

  private renderDevices(state: PhoneSnapshot): string {
    const active = state.devices.filter((device) => device.available).length
    return `<section class="page-heading"><h1>Cyberdecks</h1><p>Choose a machine to resume an agent or open a shell.</p><p class="summary-copy">${active} of ${serviceNet(state)} services ready</p></section>
      <section class="device-list" aria-label="Tailnet decks">
        ${state.devices.map((device) => this.renderDeviceCard(device, state)).join('') || this.renderEmpty('No decks configured', 'Add a Capri service to a tailnet machine to use it here.')}
      </section>
      <section class="nr-card network-note"><div class="section-title"><h2>Private network</h2><p>Only your linked Tailscale machines appear here.</p></div><div class="network-note-line"><span class="status-dot"></span><span>${serviceNet(state)} service endpoints discovered</span></div></section>`
  }

  private renderDeviceCard(device: PhoneDevice, state: PhoneSnapshot): string {
    const agents = (state.agentsByDevice[device.name] ?? []).filter((agent) => agent.available)
    const canTerminal = device.available || Boolean(device.sshAvailable)
    const statusLabel = device.checking ? 'Checking link' : device.available ? 'Online' : device.sshAvailable ? `SSH via ${device.controllerName ?? 'Capri'}` : device.online ? 'Online · not configured' : 'Offline'
    const configuredName = device.configuredName ?? device.name
    return `<article class="artifact deck-card${device.online ? '' : ' is-offline'}">
      <div class="artifact-header"><span>${escapeHtml(device.name)}</span><span class="deck-state ${device.online ? 'is-online' : 'is-offline'}"><span class="status-dot"></span>${escapeHtml(statusLabel)}</span></div>
      <div class="artifact-body">
        <div class="deck-address"><span>TAILSCALE ADDRESS</span><strong>${escapeHtml(device.ip)}</strong></div>
        <div class="deck-summary"><span>${device.available ? agents.length ? `${agents.length} agents ready` : 'Scanning agents' : device.sshAvailable ? `SSH via ${state.settings.sshTargets[device.name] ?? ''}` : 'Terminal setup required'}</span><span>${device.os ? escapeHtml(device.os) : 'REMOTE DECK'}</span></div>
      </div>
      <div class="device-actions">
        <button class="button button-primary" type="button" data-action="jack-in" data-device="${attr(device.name)}" ${device.available ? '' : 'disabled'}>Open sessions</button>
        <button class="button" type="button" data-action="terminal" data-device="${attr(device.name)}" ${canTerminal ? '' : 'disabled'}>${device.sshAvailable && !device.available ? 'SSH shell' : 'Terminal'}</button>
        ${device.capriHost ? `${iconButton('setup-edit', configuredName, `Edit ${configuredName}`, 'edit')}${iconButton('setup-remove', configuredName, `Delete ${configuredName}`, 'delete')}` : ''}
      </div>
    </article>`
  }

  private renderSessions(state: PhoneSnapshot): string {
    const selectedAgent = this.newAgent || this.preferredAgent(this.deviceName)
    const agents = (state.agentsByDevice[this.deviceName] ?? []).filter((agent) => agent.available)
    const models = state.modelsByDevice[this.deviceName]?.[selectedAgent] ?? []
    const isNew = Boolean(this.newAgent)
    const filterDevices = this.sessionMachine === 'all' ? state.devices : state.devices.filter((device) => device.name === this.sessionMachine)
    const allSessions = filterDevices.flatMap((device) => (state.sessionsByDevice[device.name] ?? []).map((session) => ({ device, session })))
      .filter(({ session }) => (this.sessionAgent === 'all' || session.agent === this.sessionAgent) && (this.sessionQuery.trim() === '' || `${session.agent} ${session.title} ${session.cwd ?? ''}`.toLowerCase().includes(this.sessionQuery.trim().toLowerCase())))
    const knownAgents = [...new Set(allSessions.map(({ session }) => session.agent))]
    const shownSessions = allSessions
    const active = state.activeSession
    const activeWorkspace = active && active.agent !== 'terminal' ? this.renderActiveFeed(state, false) : ''
    return `<section class="page-heading"><h1>Sessions</h1><p>Saved work, sorted by the last signal from each deck.</p></section>
      ${activeWorkspace}
      ${isNew ? this.renderNewSessionForm(this.deviceName, agents, models, selectedAgent) : `<div class="section-toolbar"><div><h2>Saved sessions</h2><p>${shownSessions.length} signals in range</p></div><button class="button button-primary" type="button" data-action="new-session" data-device="${attr(this.deviceName)}">+ New session</button></div>`}
      ${isNew ? '' : `<div class="filter-row"><label class="select-field"><span class="sr-only">Filter sessions by machine</span><select data-action="session-filter"><option value="all" ${this.sessionMachine === 'all' ? 'selected' : ''}>All decks</option>${state.devices.map((device) => `<option value="${attr(device.name)}" ${this.sessionMachine === device.name ? 'selected' : ''}>${escapeHtml(device.name)}</option>`).join('')}</select></label><input class="search-field" data-action="session-search" data-editor="1" placeholder="Search sessions" value="${attr(this.sessionQuery)}" aria-label="Search sessions"></div>
      <div class="filter-chips"><button class="chip${this.sessionAgent === 'all' ? ' is-selected' : ''}" type="button" data-action="session-filter-chip" data-value="all">All</button>${knownAgents.map((agent) => `<button class="chip${this.sessionAgent === agent ? ' is-selected' : ''}" type="button" data-action="session-filter-chip" data-value="${attr(agent)}">${escapeHtml(agentName(agent))}</button>`).join('')}</div>
      <div class="session-list">${shownSessions.map(({ device, session }, index) => this.renderSavedSession(device, session, state, index)).join('') || this.renderEmpty('No saved sessions here', 'Start a new agent session on a linked deck.')}</div>`}`
  }

  private renderNewSessionForm(device: string, agents: PhoneAgent[], models: string[], selectedAgent: string): string {
    const disabled = !this.snapshot?.devices.find((item) => item.name === device)?.available || !agents.some((agent) => agent.id === selectedAgent && agent.available)
    const defaultModel = this.defaultModel(device, selectedAgent)
    return `<article class="nr-card new-session-card"><div class="section-toolbar"><div><h2>New session</h2><p>Choose a deck and agent runtime.</p></div><button class="text-button" type="button" data-action="cancel-new">Close</button></div>
      <label class="field-label">Deck<select data-action="device">${this.deviceOptions(device)}</select></label>
      <label class="field-label">Agent<select data-action="new-agent">${agents.map((agent) => `<option value="${attr(agent.id)}" ${agent.id === selectedAgent ? 'selected' : ''}>${escapeHtml(agent.name)}</option>`).join('') || '<option value="">No agent binaries detected</option>'}</select></label>
      <label class="field-label">Model<select data-action="new-model">${models.map((model) => `<option value="${attr(model)}" ${(this.newModel || defaultModel) === model ? 'selected' : ''}>${escapeHtml(model)}</option>`).join('')}</select></label>
      ${models.length ? '' : `<button class="text-button" type="button" data-action="load-models" data-device="${attr(device)}" data-value="${attr(selectedAgent)}">Load available models</button>`}
      <p class="field-note">New sessions use this choice. To remember a model for next time, set it in Settings.</p>
      <button class="button button-primary button-wide" type="button" data-action="start-session" data-device="${attr(device)}" ${disabled ? 'disabled' : ''}>Launch ${escapeHtml(agentName(selectedAgent))}</button>
    </article>`
  }

  private renderSavedSession(device: PhoneDevice, session: PhoneSession, state: PhoneSnapshot, index = 0): string {
    const timestamp = session.updatedAt ? new Date(session.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Saved session'
    const live = state.activeSession?.id === session.id && state.activeSessionDeviceName === device.name
    return `<article class="session-card${session.needsApproval ? ' artifact-attention' : ''}">
      <div class="session-index">${String(index + 1).padStart(2, '0')}</div>
      <div class="session-card-main"><div class="session-card-title">${escapeHtml(session.title)}</div><div class="session-card-meta">${escapeHtml(session.cwd || device.name)} · ${escapeHtml(device.name)}</div>${session.needsApproval ? '<div class="session-attention">! Attention needed</div>' : ''}</div>
      <div class="session-card-side"><span class="session-card-agent">${escapeHtml(agentName(session.agent))}</span><span class="session-card-time">${escapeHtml(timestamp)}</span><button class="button${live ? '' : ' button-primary'}" type="button" data-action="resume" data-device="${attr(device.name)}" data-session="${attr(session.id)}">${live ? 'Open' : 'Resume'}</button></div>
    </article>`
  }

  private renderTerminal(state: PhoneSnapshot, current?: PhoneDevice): string {
    const session = state.activeSession?.agent === 'terminal' ? state.activeSession : undefined
    if (!session || state.activeSessionDeviceName !== this.deviceName) {
      const canTerminal = Boolean(current?.available || current?.sshAvailable)
      return `<section class="page-heading"><h1>Terminal</h1><p>Open a live shell on a selected deck. Run commands, use SSH, and keep the output in view.</p></section>
        <article class="nr-card"><label class="field-label">Deck<select data-action="device">${this.deviceOptions(current?.name ?? this.deviceName, true)}</select></label>
        <div class="terminal-capabilities"><span>Live output</span><span>Command history</span><span>SSH prompts</span><span>Keyboard controls</span></div>
        <button class="button button-primary button-wide" type="button" data-action="terminal" data-device="${attr(current?.name ?? this.deviceName)}" ${canTerminal ? '' : 'disabled'}>Connect to ${escapeHtml((current?.name ?? this.deviceName) || 'deck')}</button>
        ${canTerminal ? '' : '<p class="field-note">Choose a Capri deck or configure a Tailscale SSH target in Settings.</p>'}</article>
        ${this.renderTerminalSafetyNote()}`
    }
    const device = state.devices.find((item) => item.name === this.deviceName)
    const history = this.commandHistory[this.deviceName] ?? []
    const text = state.terminalText || `Connected to ${device?.name ?? this.deviceName}. Enter a command below.`
    return `<section class="terminal-heading"><div><h1>${escapeHtml(device?.name ?? this.deviceName)}</h1><p>${escapeHtml(device?.ip ?? '')} · Interactive session</p></div><span class="live-pill">CONNECTED</span></section>
      <section class="terminal-frame" aria-label="Remote terminal output"><div class="terminal-bar"><span>capri shell</span><button class="terminal-tool" type="button" data-action="clear-terminal">Clear view</button></div><pre class="terminal-output" id="terminal-output">${escapeHtml(text)}</pre></section>
      <div class="terminal-controls"><button class="terminal-tool" type="button" data-action="terminal-key" data-value="ctrl-c" data-device="${attr(this.deviceName)}">Ctrl-C</button><button class="terminal-tool" type="button" data-action="terminal-key" data-value="tab" data-device="${attr(this.deviceName)}">Tab</button><button class="terminal-tool" type="button" data-action="terminal-key" data-value="ctrl-d" data-device="${attr(this.deviceName)}">Ctrl-D</button><button class="terminal-tool" type="button" data-action="terminal-key" data-value="escape" data-device="${attr(this.deviceName)}">Esc</button></div>
      <form class="composer terminal-composer" data-form="composer"><textarea data-action="composer" data-editor="1" rows="2" placeholder="Command, SSH command, or password prompt response" aria-label="Terminal command">${escapeHtml(this.currentDraft)}</textarea><div class="composer-actions"><button class="button" type="button" data-action="talk">${state.recording ? 'Stop recording' : 'Use glasses mic'}</button><button class="button button-primary send-button" type="submit">Send</button></div></form>
      <div class="history-strip"><h2>Recent commands</h2>${history.slice(-4).reverse().map((command, index) => `<button class="history-command" type="button" data-action="history" data-value="${index}" data-device="${attr(this.deviceName)}">${escapeHtml(command)}</button>`).join('') || '<span class="field-note">Commands you send here stay on this phone.</span>'}</div>
      <button class="button button-danger button-wide" type="button" data-action="disconnect">Jack out</button>
      ${this.renderTerminalSafetyNote()}`
  }

  private renderTerminalSafetyNote(): string {
    return `<p class="security-note">Terminal commands run on the selected deck under its normal user account. Select only decks you intend to control.</p>`
  }

  private renderSettings(state: PhoneSnapshot): string {
    const agents = state.agentsByDevice[this.deviceName] ?? []
    const availableAgents = agents.filter((agent) => agent.available)
    const agent = this.settingsModelAgent || state.settings.defaultAgent
    const models = state.modelsByDevice[this.deviceName]?.[agent] ?? []
    const preferredModel = this.defaultModel(this.deviceName, agent)
    return `<section class="page-heading"><h1>Settings</h1><p>Choose how Capri starts sessions and presents live output on your phone and glasses.</p></section>
      <section class="nr-card"><div class="section-title"><h2>Session defaults</h2><p>Applied to new sessions on the selected deck.</p></div>
        <label class="field-label">Configure deck<select data-action="device">${this.deviceOptions(this.deviceName)}</select></label>
        <label class="field-label">Default deck<select data-action="default-device">${this.deviceOptions(state.settings.defaultDevice)}</select></label>
        <label class="field-label">Default agent<select data-action="default-agent">${availableAgents.map((item) => `<option value="${attr(item.id)}" ${state.settings.defaultAgent === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('') || '<option value="">No agents detected</option>'}</select></label>
        <label class="field-label">Model preference<select data-action="default-model-agent">${availableAgents.map((item) => `<option value="${attr(item.id)}" ${agent === item.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select></label>
        <label class="field-label">Saved model<select data-action="default-model"><option value="" ${!preferredModel ? 'selected' : ''}>Use agent default</option>${models.map((model) => `<option value="${attr(model)}" ${preferredModel === model ? 'selected' : ''}>${escapeHtml(model)}</option>`).join('')}</select></label>
        <button class="text-button" type="button" data-action="load-models" data-device="${attr(this.deviceName)}" data-value="${attr(agent)}">Refresh model list</button>
        <label class="field-label">Resume Claude sessions with<select data-action="claude-runtime"><option value="claude" ${state.settings.claudeRuntime === 'claude' ? 'selected' : ''}>Claude Code</option><option value="nclaude" ${state.settings.claudeRuntime === 'nclaude' ? 'selected' : ''}>nClaude</option></select></label>
      </section>
      <section class="nr-card"><div class="section-title"><h2>Display</h2><p>Comfortable defaults for reading a live feed.</p></div>
        <label class="field-label">Phone text size<select data-action="phone-text-size"><option value="small" ${state.settings.phoneTextSize === 'small' ? 'selected' : ''}>Compact</option><option value="normal" ${state.settings.phoneTextSize === 'normal' ? 'selected' : ''}>Standard</option><option value="large" ${state.settings.phoneTextSize === 'large' ? 'selected' : ''}>Large</option></select></label>
        <label class="field-label">Glasses lines<select data-action="hud-density"><option value="spacious" ${state.settings.hudDensity === 'spacious' ? 'selected' : ''}>Spacious · 5 lines</option><option value="balanced" ${state.settings.hudDensity === 'balanced' ? 'selected' : ''}>Balanced · 7 lines</option><option value="compact" ${state.settings.hudDensity === 'compact' ? 'selected' : ''}>Compact · 9 lines</option></select></label>
        <label class="field-label">Output history<select data-action="verbosity"><option value="concise" ${state.settings.verbosity === 'concise' ? 'selected' : ''}>Concise · 60 messages</option><option value="balanced" ${state.settings.verbosity === 'balanced' ? 'selected' : ''}>Balanced · 140 messages</option><option value="verbose" ${state.settings.verbosity === 'verbose' ? 'selected' : ''}>Verbose · 500 messages</option></select></label>
        ${this.renderToggle('auto-scroll', 'Auto-follow live output', 'Scroll to the newest terminal or session output.', state.settings.autoScroll)}
        ${this.renderToggle('timestamps', 'Show message times', 'Add local timestamps to phone session messages.', state.settings.showTimestamps)}
      </section>
      <section class="nr-card stt-settings-card" data-stt-settings><div class="section-title"><h2>Speech to text</h2><p>Choose the provider used by the glasses microphone. Keys stay on this phone.</p></div>
        <label class="field-label">Provider<select data-action="stt-provider" data-stt-editor="1"><option value="" ${!this.sttDraft.provider ? 'selected' : ''}>Not configured</option>${STT_PROVIDERS.map((provider) => `<option value="${attr(provider.id)}" ${this.sttDraft.provider === provider.id ? 'selected' : ''}>${escapeHtml(provider.label)}</option>`).join('')}</select></label>
        <label class="field-label">API key<input class="search-field" type="password" data-action="stt-key" data-stt-editor="1" data-editor="1" value="${attr(this.sttDraft.apiKey)}" placeholder="Paste provider key" autocomplete="off" spellcheck="false"></label>
        <label class="field-label">Model<input class="search-field" data-action="stt-model" data-stt-editor="1" data-editor="1" value="${attr(this.sttDraft.model)}" placeholder="Provider default" autocapitalize="none" spellcheck="false"></label>
        <label class="field-label">Language<input class="search-field" data-action="stt-language" data-stt-editor="1" data-editor="1" value="${attr(this.sttDraft.language)}" placeholder="Auto detect · for example en" autocapitalize="none" spellcheck="false"></label>
        <div class="stt-actions"><button class="button button-primary" type="button" data-action="stt-save">Save</button><button class="button" type="button" data-action="stt-test" ${this.snapshot?.sttTesting ? 'disabled' : ''}>${this.snapshot?.sttTesting ? 'Testing…' : 'Test'}</button></div>
        ${state.sttStatus ? `<p class="stt-status" role="status">${escapeHtml(state.sttStatus)}</p>` : ''}
      </section>
      <section class="nr-card"><div class="section-title"><h2>Connected services</h2><p>Agent sessions need the Capri service on the deck.</p></div><div class="service-list">${state.devices.map((device) => `<div class="service-row"><div><strong>${escapeHtml(device.name)}</strong><span>${escapeHtml(device.ip)}</span></div><span class="device-status${device.available || device.sshAvailable ? ' is-online' : ''}"><span class="status-dot"></span>${device.available ? 'Capri ready' : device.sshAvailable ? 'SSH terminal ready' : device.online ? 'No access configured' : 'Unavailable'}</span></div>`).join('')}</div></section>
      ${this.renderSshSettings(state)}
      <section class="nr-card"><div class="section-title"><h2>Local data</h2><p>Preferences, pairing, and terminal command history are stored on this phone.</p></div><button class="button button-danger" type="button" data-action="reset-settings">Reset local data</button></section>
      <footer class="phone-footer">Capri · Private beta · Settings stay on this phone</footer>
      ${this.resetConfirm ? this.renderResetDialog() : ''}`
  }

  private renderResetDialog(): string {
    return `<div class="dialog-backdrop" role="presentation"><section class="danger-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reset-dialog-title"><div class="danger-dialog-mark">!</div><h2 id="reset-dialog-title">Warning!</h2><p>This will erase all local data and paired devices from Capri on this phone.</p><div class="dialog-actions"><button class="button button-danger" type="button" data-action="reset-confirm">Wipe storage</button><button class="button" type="button" data-action="reset-cancel">Cancel</button></div></section></div>`
  }

  private renderToggle(action: string, title: string, description: string, checked: boolean): string {
    return `<label class="toggle-row"><span class="toggle-copy"><strong>${title}</strong><span>${description}</span></span><input class="toggle-input" type="checkbox" data-action="${action}" ${checked ? 'checked' : ''} aria-label="${title}"><span class="toggle-track" aria-hidden="true"></span></label>`
  }

  private renderSshSettings(state: PhoneSnapshot): string {
    const candidates = state.devices.filter((device) => device.online && device.sshHost && device.sshEligible && !device.available)
    const selected = candidates.find((device) => device.name === this.sshHostName) ?? candidates[0]
    const targets = Object.entries(state.settings.sshTargets)
    return `<section class="nr-card"><div class="section-title"><h2>Other Tailscale machines</h2><p>Add an SSH target to open its shell through another Tailscale machine. You don’t need to install Capri on that target.</p></div>
      <label class="field-label">Tailscale device<select data-action="ssh-host"><option value="">Choose a device</option>${candidates.map((device) => `<option value="${attr(device.name)}" ${device.name === (selected?.name ?? '') ? 'selected' : ''}>${escapeHtml(device.name)} · ${escapeHtml(device.ip)}</option>`).join('')}</select></label>
      <label class="field-label">Account name<input class="search-field" data-action="ssh-username" data-editor="1" value="${attr(this.sshUsername || (selected ? state.settings.sshTargets[selected.name] ?? '' : ''))}" placeholder="for example, ubuntu" autocapitalize="none" autocomplete="username" spellcheck="false"></label>
      <button class="button button-primary button-wide" type="button" data-action="save-ssh-target" ${selected ? '' : 'disabled'}>Save SSH target</button>
      ${this.localFeedback ? `<p class="form-feedback" role="alert">${escapeHtml(this.localFeedback)}</p>` : ''}
      ${targets.length ? `<div class="service-list ssh-target-list">${targets.map(([name, username]) => `<div class="service-row"><div><strong>${escapeHtml(name)}</strong><span>${escapeHtml(username)} · Tailscale SSH</span></div><button class="text-button" type="button" data-action="remove-ssh-target" data-device="${attr(name)}">Remove</button></div>`).join('')}</div>` : ''}
      <p class="field-note">The target must be online, support Tailscale SSH, and allow the controller in its Tailscale SSH policy. Linux is supported; macOS requires the open-source Tailscale CLI.</p>
      ${candidates.length ? '' : '<p class="field-note">No extra online Tailscale devices are visible right now.</p>'}</section>`
  }

  private renderEmpty(title: string, description: string): string {
    return `<div class="empty-card"><div class="empty-mark" aria-hidden="true">▓▒░</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div>`
  }

  private renderActiveFeed(state: PhoneSnapshot, terminal: boolean): string {
    const active = state.activeSession
    if (!active) return ''
    if (terminal) return this.renderTerminal(state, state.devices.find((device) => device.name === state.activeSessionDeviceName))
    const lensCopy = state.agentScreenText.trim() || 'Waiting for agent response…'
    const micLabel = state.recording ? 'Stop & review' : state.audioBusy ? 'Please wait…' : 'Start listening'
    const output = `<section class="glasses-debug-preview" aria-label="Live glasses display preview">
        <div class="glasses-preview-caption"><span>GLASSES LIVE DISPLAY</span><span>576 × 288</span><span>${state.settings.autoScroll ? 'AUTO-FOLLOW' : 'HISTORY'}</span></div>
        <div class="glasses-screen-preview"><div class="glasses-screen-header">${escapeHtml(`CAPRI  //  ${state.agentScreenHeader || agentName(active.agent)}`)}</div><pre class="glasses-screen-copy" id="glasses-screen-copy">${escapeHtml(lensCopy)}</pre></div>
      </section>`
    const approval = state.pendingApproval
      ? `<section class="approval-card"><h3>${escapeHtml(agentName(state.pendingApproval.agent))} is waiting for approval</h3><pre>${escapeHtml(state.pendingApproval.prompt)}</pre><div class="approval-actions">${state.pendingApproval.options.map((option, index) => `<button class="button${option.id === 'deny' ? ' button-danger' : index === 0 ? ' button-primary' : ''}" type="button" data-action="approval" data-value="${attr(option.id)}">${escapeHtml(option.label)}</button>`).join('')}</div></section>`
      : ''
    const models = state.modelsByDevice[state.activeSessionDeviceName ?? '']?.[active.agent] ?? []
    const modelControl = models.length ? `<label class="field-label compact-field">Model<select data-action="change-model" data-device="${attr(state.activeSessionDeviceName ?? '')}">${this.modelOptions(models, state.activeModel)}</select></label>` : ''
    const draft = state.draftText.trim()
    const reply = state.transcriptText.trim() || state.agentScreenText.trim() || 'Waiting for model response…'
    const draftCard = draft && /TRANSCRIPT READY|REVIEW \/ PROMPT|REVIEW \/ COMMAND/i.test(state.status)
      ? `<section class="voice-draft" aria-live="polite"><div class="section-title"><h3>Transcript</h3><span>Review before sending</span></div><pre>${escapeHtml(draft)}</pre><div class="voice-draft-actions"><button class="button button-primary" type="button" data-action="send">Send transcript</button><button class="button" type="button" data-action="cancel">Rewrite</button></div></section>`
      : ''
    return `<section class="active-session-card"><div class="session-topline"><span class="agent-tag">${escapeHtml(agentName(active.agent))}</span><span class="live-pill">LIVE</span><span class="session-status">${escapeHtml(state.status)}</span></div><div class="session-reply" aria-live="polite"><pre class="chat-feed">${escapeHtml(reply)}</pre></div>${modelControl}</section>
      ${draftCard}
      ${approval}
      ${output}
      <form class="composer" data-form="composer"><textarea data-action="composer" data-editor="1" rows="3" placeholder="Message the agent…" aria-label="Message the agent">${escapeHtml(this.currentDraft)}</textarea><div class="composer-actions"><button class="button" type="button" data-action="talk" ${state.audioBusy && !state.recording ? 'disabled' : ''}>${escapeHtml(micLabel)}</button><button class="button button-primary send-button" type="submit">Send</button></div></form>
      <button class="button button-danger button-wide" type="button" data-action="disconnect">Jack out</button>`
  }

  private modelOptions(models: string[], selected: string): string {
    return `<option value="" ${!selected ? 'selected' : ''}>Agent default</option>${models.map((model) => `<option value="${attr(model)}" ${selected === model ? 'selected' : ''}>${escapeHtml(model)}</option>`).join('')}`
  }

  private deviceOptions(selected: string, includeSsh = false): string {
    return this.snapshot?.devices.map((device) => {
      const canUse = device.available || includeSsh && device.sshAvailable
      const suffix = device.available ? '' : device.sshAvailable ? ' · SSH' : ' · unavailable'
      return `<option value="${attr(device.name)}" ${selected === device.name ? 'selected' : ''} ${canUse ? '' : 'disabled'}>${escapeHtml(device.name)}${suffix}</option>`
    }).join('') ?? ''
  }

  private restoreScroll(previousMainScroll: number, previousTerminalScroll: number, previousFeedScroll: number, previousGlassesScroll: number): void {
    const main = this.root.querySelector<HTMLElement>('.phone-main')
    const terminal = this.root.querySelector<HTMLElement>('.terminal-output')
    const feed = this.root.querySelector<HTMLElement>('.chat-feed')
    const glasses = this.root.querySelector<HTMLElement>('.glasses-screen-copy')
    if (main) {
      this.restoringMainScroll = true
      main.scrollTop = Math.min(previousMainScroll, Math.max(0, main.scrollHeight - main.clientHeight))
      this.mainScrollTop = main.scrollTop
      this.restoringMainScroll = false
    }
    if (terminal) terminal.scrollTop = Math.min(previousTerminalScroll, terminal.scrollHeight)
    if (feed) {
      // The phone chat feed follows the newest turn; the glasses preview keeps
      // its own six-line window.
      feed.scrollTop = this.snapshot?.settings.autoScroll ? feed.scrollHeight : Math.min(previousFeedScroll, feed.scrollHeight)
    }
    if (glasses) glasses.scrollTop = Math.min(previousGlassesScroll, glasses.scrollHeight)
    if (this.restoreFrame !== undefined) {
      window.cancelAnimationFrame(this.restoreFrame)
      this.restoreFrame = undefined
    }
  }
}

function agentName(id: string): string {
  return ({ claude: 'Claude', nclaude: 'nClaude', codex: 'Codex', opencode: 'OpenCode', ghost: 'Ghost', codewhale: 'CodeWhale', dsh: 'DSH', kimi: 'Kimi Code', gemini: 'Gemini CLI', cline: 'Cline', terminal: 'Terminal' } as Record<string, string>)[id] ?? id
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

function attr(value: string): string {
  return escapeHtml(value)
}

function iconButton(action: string, value: string, label: string, icon: 'edit' | 'delete'): string {
  const svg = icon === 'edit'
    ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13 6 4 4"/></svg>'
    : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true"><path d="M5 7h14"/><path d="M10 11v6M14 11v6"/><path d="M9 7V4h6v3"/><path d="m7 7 1 13h8l1-13"/></svg>'
  return `<button class="action-icon action-icon-${icon}" type="button" data-action="${attr(action)}" data-value="${attr(value)}" aria-label="${attr(label)}" title="${attr(label)}">${svg}</button>`
}

function serviceNet(state: PhoneSnapshot): number {
  return state.devices.filter((device) => device.capriHost).length
}
