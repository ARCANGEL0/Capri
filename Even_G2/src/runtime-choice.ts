// Resume choices for saved sessions. Claude sessions must always offer both
// runners: nClaude is the NVIDIA-provider build and uses the same transcript,
// so a stale agent list or a previously saved runtime must not hide the choice.

export interface RuntimeSession {
  agent: string
  runtime?: string
}

export interface RuntimeChoice {
  runtime: string
  label: string
  detail: string
}

export const CLAUDE_RUNTIME_CHOICES: readonly RuntimeChoice[] = [
  { runtime: 'claude', label: 'CLAUDE', detail: 'Anthropic' },
  { runtime: 'nclaude', label: 'NCLAUDE / NVIDIA', detail: 'NVIDIA provider' },
]

export function runtimeChoices(session: RuntimeSession): RuntimeChoice[] {
  if (session.agent !== 'claude') {
    const runtime = session.runtime || session.agent
    return [{ runtime, label: runtime.toUpperCase(), detail: '' }]
  }
  const preferred = session.runtime
  return CLAUDE_RUNTIME_CHOICES
    .slice()
    .sort((left, right) => {
      if (preferred === left.runtime) return -1
      if (preferred === right.runtime) return 1
      return 0
    })
    .map((choice) => ({ ...choice }))
}
