// The saved harness transcript is the source of truth for a chat. A resumed
// Claude process can be started from Capri while another TUI has the same saved
// session open; only the JSONL/SQLite history sees turns written by both.

export type HistoryTurn = { role?: string; text?: string }
export type PendingUser = { text: string; replyCount?: number }

export function historyLines(turns: HistoryTurn[]): string[] {
  const lines: string[] = []
  for (const turn of Array.isArray(turns) ? turns : []) {
    const text = typeof turn.text === 'string' ? turn.text.trim() : ''
    if (text) lines.push(`${turn.role === 'user' ? 'YOU>' : 'AGENT>'} ${text}`)
  }
  return lines
}

export function normalizeTurnText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function turnBody(line: string): string {
  const value = normalizeTurnText(line)
  return value.replace(/^(?:you>|agent>)\s*/, '').trim()
}

export function historyHasTurn(history: string[], prefix: 'YOU>' | 'AGENT>', text: string): boolean {
  const target = normalizeTurnText(text)
  if (!target) return false
  const lead = target.slice(0, Math.min(140, target.length))
  return history.some((line) => {
    const body = turnBody(line)
    if (!body) return false
    if (prefix === 'YOU>') {
      // User sends are exact; only tolerate a longer prefix if the text is
      // substantial enough that an accidental match is improbable.
      return body === target || (target.length >= 40 && body.startsWith(lead))
    }
    // A live PTY reply can be partial while the transcript has the finished
    // text, or vice versa. Treat either prefix relationship as the same turn.
    return body.includes(lead) || (body.length >= 24 && lead.includes(body))
  })
}

export function historyReplyAfterUser(history: string[], text: string): boolean {
  const target = normalizeTurnText(text)
  if (!target) return false
  let found = false
  for (const line of history) {
    const normalized = normalizeTurnText(line)
    if (!found) {
      if (normalized.startsWith('you>') && turnBody(line) === target) found = true
      continue
    }
    if (normalized.startsWith('agent>')) return true
  }
  return false
}

// Use the transcript for everything it already contains. Only local lines that
// have not appeared there yet are added, so nothing is duplicated on the lens.
export function mergeTranscript(history: string[], users: PendingUser[], replies: string[]): string[] {
  const lines = [...history]
  const pending = users.filter((user) => user.text && !historyHasTurn(history, 'YOU>', user.text))

  // A reply that had already started when a later send happened belongs above
  // that send. `replyCount` is the number of replies active at send time.
  const replyCutoff = pending.length
    ? Math.max(...pending.map((user) => user.replyCount ?? 0))
    : -1

  for (const user of pending) lines.push(`YOU> ${user.text}`)
  replies.forEach((reply, index) => {
    if (!reply || replyCutoff >= 0 && index < replyCutoff) return
    if (historyHasTurn(history, 'AGENT>', reply)) return
    lines.push(`AGENT> ${reply}`)
  })
  return lines
}
