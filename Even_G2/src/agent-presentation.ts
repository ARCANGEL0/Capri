export type AgentPresentation = {
  response: string
  action: string
}

export type InteractivePrompt = {
  prompt: string
  options: Array<{ id: string; label: string }>
}

const TOOL_NAMES = 'Bash|Read|Edit|Write|Grep|Glob|Task|WebFetch|WebSearch|Search|Shell|ApplyPatch|NotebookEdit|TodoWrite|Browser|Computer|MCP|mcp__[\\w.-]+'
const TOOL_CALL = new RegExp(`^(?:[●⏺•*·>]\\s*)?(${TOOL_NAMES})(?:\\s*\\((.*)\\)|\\s*[:—-]\\s*(.*))$`, 'i')
const GENERIC_TOOL_CALL = /^(?:[⏺•*·>]\s*)?([A-Za-z][\w.-]*(?:__[\w.-]+)?)(?:\s*\((.*)\))$/
const ACTION_LINE = new RegExp(`^(?:[⏺•*·>]\\s*)?(?:Running|Executing|Reading|Editing|Writing|Searching|Fetching)\\s+(${TOOL_NAMES})(?:\\s*[:(—-]\\s*(.*))?$`, 'i')
const NATURAL_ACTION = /^(?:[⏺•*·>]\s*)?(Running|Executing|Reading|Editing|Writing|Searching|Fetching|Calling|Using|Waiting for)\s+(.+)$/i

export function presentAgentScreen(raw: string): AgentPresentation {
  const source = raw.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const interactive = detectInteractivePrompt(raw)
  const action = findAction(source)
  const visible: string[] = []
  const markerMode = source.some((line) => /^(?:[•⏺›❯])(?:\s|$)/.test(line))
  let assistantBlock = !markerMode
  let inReasoning = false
  let inToolResult = false
  let inCodeFence = false

  for (const originalLine of source) {
    let rawLine = originalLine
    const blockMarker = originalLine.match(/^([•⏺›❯])\s*(.*)$/)
    if (markerMode && blockMarker) {
      const marker = blockMarker[1]
      const content = blockMarker[2].trim()
      if (marker === '›' || marker === '❯') {
        assistantBlock = false
        continue
      }
      const toolBlock = isToolCall(content)
        || ACTION_LINE.test(content)
        || NATURAL_ACTION.test(content)
        || isToolOutput(content)
        || isCodeOrToolLine(content)
      assistantBlock = !toolBlock
      if (!assistantBlock) continue
      rawLine = content
    } else if (markerMode && !assistantBlock) {
      continue
    }

    const line = stripMarker(rawLine)
    if (!line) continue

    if (/^```/.test(line)) {
      inCodeFence = !inCodeFence
      continue
    }
    if (inCodeFence) continue

    if (interactive && (/^\d+[.)]\s+/.test(line) || /enter\s+continue|esc\s+quit/i.test(line))) continue

    if (/^(?:<|\[)(?:analysis|reasoning|thinking)(?:>|\])$/i.test(line)) {
      inReasoning = true
      continue
    }
    if (/^(?:<|\[)\/(?:analysis|reasoning|thinking)(?:>|\])$/i.test(line)) {
      inReasoning = false
      continue
    }
    if (inReasoning || isToolCall(rawLine) || ACTION_LINE.test(rawLine) || NATURAL_ACTION.test(rawLine) || GENERIC_TOOL_CALL.test(rawLine)) {
      inToolResult = isToolCall(rawLine)
      continue
    }
    if (isToolOutput(line)) continue
    if (inToolResult) {
      if (!isAssistantMessage(rawLine)) continue
      inToolResult = false
    }
    const clean = line.replace(/^(?:[>›⏺•]\s*)/, '').trim()
    if (isInterfaceChrome(clean) || isUnsafeOrInternal(clean) || isCodeOrToolLine(clean)) continue
    if (clean && visible.at(-1) !== clean) visible.push(clean)
  }

  return { response: visible.slice(-2000).join('\n'), action }
}

export function detectInteractivePrompt(raw: string): InteractivePrompt | undefined {
  const lines = raw.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const options: Array<{ id: string; label: string }> = []
  for (const line of lines) {
    const match = line.match(/^(\d+)[.)]\s+(.+)$/)
    if (match) options.push({ id: match[1], label: match[2].trim() })
  }
  if (options.length < 2) return undefined
  const tail = lines.slice(-18).join(' ')
  if (!/(?:enter\s+continue|esc\s+quit|choose|select|current directory|session directory|proceed)/i.test(tail)) return undefined
  const first = lines.findIndex((line) => /^\d+[.)]\s+/.test(line))
  const prompt = first > 0 ? lines.slice(Math.max(0, first - 2), first).filter((line) => !isInterfaceChrome(line)).join(' ') : 'INPUT REQUIRED'
  return { prompt: prompt || 'INPUT REQUIRED', options: options.slice(-6) }
}

function findAction(lines: string[]): string {
  let current: { name: string; detail: string } | undefined
  let completed = false
  for (const line of lines) {
    const match = line.match(TOOL_CALL) ?? line.match(ACTION_LINE) ?? line.match(GENERIC_TOOL_CALL)
    if (match) {
      current = { name: match[1].toUpperCase(), detail: (match[2] ?? match[3] ?? '').trim() }
      completed = false
    } else {
      const natural = line.match(NATURAL_ACTION)
      if (natural) {
        current = { name: natural[1].toUpperCase(), detail: natural[2].trim() }
        completed = false
      }
    }
    if (current && !NATURAL_ACTION.test(line) && (isToolOutput(line) || isAssistantMessage(line))) {
      completed = true
    }
  }
  if (!current) return ''
  const useful = current.detail
    .replace(/[()]/g, '')
    .replace(/^['"`]|['"`]$/g, '')
    .replace(/^.*\//, (path) => path.split('/').at(-1) ?? path)
    .replace(/\s+/g, ' ')
    .slice(0, 23)
  const state = completed ? 'TOOL DONE' : 'RUNNING'
  return useful ? `${state} · ${current.name} · ${useful}` : `${state} · ${current.name}`
}

function isToolCall(line: string): boolean {
  return TOOL_CALL.test(line)
}

function isAssistantMessage(line: string): boolean {
  return /^(?:[>›⏺]\s*)\S/.test(line) && !isToolCall(line)
}

function isToolOutput(line: string): boolean {
  return /^(?:⎿|↳|tool (?:output|result|end)|exit code:|stdout:|stderr:)/i.test(line)
    || /^\s*\d+\s+[+-]\s/.test(line)
    || /^(?:allow once|allow always|approve|deny|reject|cancel)$/i.test(line)
    || /^(?:\?\s*)?(?:allow|approve|permission required|do you want to allow)\b/i.test(line)
    || /^(?:Edited|Created|Updated|Wrote|Applied|Removed)\s+.*(?:\(|\+\d+|-\d+|\/|~\/)/i.test(line)
    || /^\d+\s+[A-Za-z_$][\w$]*(?:[.(=:]|\s)/.test(line)
    || /^(?:function|const|let|var|import|export|class|interface|type)\s+/i.test(line)
    || /^(?:diff --git|index [0-9a-f]{4,}|@@|[+\-]{3}\s)/.test(line)
    || /^(?:\$\s+|(?:src|dist|lib|app|packages)\/.*\.(?:ts|tsx|js|jsx|json|css|md)(?::\d+)?(?:\s+\([^)]*\))?$)/i.test(line)
    || /^(?:return|if|else|for|while|await|try|catch|throw)\b.*[\[\]{}();]/i.test(line)
    || /^[{}\[\];]+$/.test(line)
}

function isCodeOrToolLine(line: string): boolean {
  return /^\d+(?:[+-])?\s*$/.test(line)
    || /^\d+[+-]?\s*[+\-]?(?:function|const|let|var|import|export|class|interface|type|return|if|else|for|while|await)\b/i.test(line)
    || /^[+\-]?\s*(?:function|const|let|var|import|export|class|interface|type)\b.*[{}();=]/i.test(line)
    || /^\s*\/\*\*?|^\s*\*\/?$/.test(line)
    || /\b(?:string|number|boolean|Promise<[^>]+>|Json)\b.*[{}():,]/i.test(line)
    || /^(?:JSON|Math|Array|Object|Map|Set|localStorage|sessionStorage|this)\./.test(line)
    || /^(?:[●⏺•]\s*)?(?:Bash|Read|Edit|Write|Grep|Glob|Task|WebFetch|WebSearch|Search|Shell|ApplyPatch|MCP)(?:\s*\(|\s|$)/i.test(line)
    || /\[(?:\d+;){1,}\d*m/.test(line)
    || /^(?:[+\-]\s*)?\d+[-+]?\s/.test(line)
    || /^(?:return|if|else|for|while|await|try|catch|throw)\b.*[\[\]{}();]/i.test(line)
    || /^(?:Viewed|Read|Wrote|Edited|Applied|Created|Updated|Ran|Running|Command|Process|Tool)\b/i.test(line)
    || /^(?:node_modules|src|dist|lib|app|packages|tmp|home|opt|etc)\//i.test(line)
    || /\.(?:png|jpe?g|webp|gif|svg|ts|tsx|js|jsx|json|css|md)(?::|\s|$)/i.test(line)
    || /^(?:PNG|JPEG|GIF|WebP|ASCII|UTF-8)\s+(?:image|text|data)|^(?:non-interlaced|Viewed image|image dimensions)/i.test(line)
    || /^(?:…|\.\.\.)\s*\+?\d+\s+lines?/i.test(line)
    || /^\d+\s*x\s*\d+(?:,|\s|$)/i.test(line)
    || /^(?:users:|LISTEN\s+\d|pid,args|--[A-Za-z]|https?:\/\/|\/tmp\/|\/home\/|\/opt\/|\/etc\/|\/proc\/)/i.test(line)
    || /^(?:rtk|curl|ps|pgrep|pkill|sleep|node|npm|python|bash|fish)\b/i.test(line)
    || /(?:;\s*done|\$\w+\.(?:png|json|log))$/i.test(line)
}

function isInterfaceChrome(line: string): boolean {
  return /^(?:[╭╰│┌┐└┘─━═]{1,}|(?:Claude Code|OpenCode|Codex|Ghost|CodeWhale|DSH|Kimi Code|Gemini CLI|Cline)(?:\s|$)|(?:›|❯)\s*(?:for agents|for shortcuts|ask anything|type a message|send a message)|(?:ctrl|cmd|alt|esc|f\d)\s*[+· ]|~\/|\/home\/|[A-Za-z]:\\)/i.test(line)
    || /^Capri\s*\/\/|^LIVE\s*·\s*TAP TO TALK/i.test(line)
    || /\b(?:to stop response|tap & hold|tokens? used|context left|press enter to send|shift\+tab|ctrl\+c to)/i.test(line)
    || /^(?:[?.·•*]\s*)?(?:thinking|working|ready|waiting for input|waiting for agent output)[.… ]*\d*s?$/i.test(line)
    || /\b(?:sonnet|opus|haiku|gpt-[\w.-]+|nemotron[\w.-]*)\s+(?:default|context|\d+%)/i.test(line)
    || /\b\d+\s+warnings?\b/i.test(line)
    || /\bbackground terminals? running\b|\/ps\s+to\s+view|\/stop\s+to\s+close/i.test(line)
    || /^(?:ask\s+codex\s+to\s+do\s+anything|breakdown\.)$/i.test(line)
    || /^RUNNING\s*[·•]/i.test(line)
    || /^(?:Even G2 Glyph Assets)$/i.test(line)
    || /^build passes\.?$/i.test(line)
    || /^worked for\s+\d+[smhd].*$/i.test(line)
    || /\b(?:gpt-[\w.-]+|claude(?:\s+code)?|codex)\b.*(?:·|\/home\/|~\/)/i.test(line)
}

function isUnsafeOrInternal(line: string): boolean {
  return /<\/?(?:analysis|reasoning|thinking)>/i.test(line)
    || /^(?:analysis|thinking|thoughts?|reasoning|internal thought|chain of thought)(?:\s*:)?$/i.test(line)
    || /^(?:analysis|thinking|thoughts?|reasoning|internal thought|chain of thought)\s*:/i.test(line)
    || /^(?:diff --git|index [0-9a-f]{4,}|--- a\/|\+\+\+ b\/|@@)/.test(line)
}

function stripMarker(line: string): string {
  return line.replace(/^[ \t]*(?:[│┃|]\s*)+/, '').trim()
}
