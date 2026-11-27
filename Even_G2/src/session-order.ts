// Round-robin session ordering so every harness stays discoverable. A plain
// recency sort buries OpenCode behind the busier Claude/Codex histories on
// the two-row glasses session page.

export interface SessionOrderItem {
  agent: string
  updatedAt?: number
}

function newest(item: SessionOrderItem): number {
  return item.updatedAt ?? 0
}

// OpenCode is the harness Capri is most often used to resume, so it gets the
// first slot even when its sessions are older than other harnesses'.
export const SESSION_AGENT_PRIORITY = [
  'opencode', 'claude', 'codex', 'nclaude', 'ghost',
  'codewhale', 'dsh', 'kimi', 'gemini', 'cline',
]

export function interleaveSessions<T extends SessionOrderItem>(items: T[], priorities: string[] = []): T[] {
  const groups = new Map<string, Array<{ item: T; index: number }>>()
  items.forEach((item, index) => {
    const agent = item.agent || 'unknown'
    const group = groups.get(agent) ?? []
    group.push({ item, index })
    groups.set(agent, group)
  })

  const priority = (agent: string): number => {
    const index = priorities.indexOf(agent)
    return index < 0 ? priorities.length : index
  }
  const orderedGroups = [...groups.entries()]
    .map(([agent, entries]) => {
      entries.sort((a, b) => newest(b.item) - newest(a.item) || a.index - b.index)
      return { agent, entries, latest: Math.max(...entries.map((entry) => newest(entry.item))) }
    })
    .sort((a, b) => priority(a.agent) - priority(b.agent) || b.latest - a.latest || a.agent.localeCompare(b.agent))

  const result: T[] = []
  for (let round = 0; ; round++) {
    let added = false
    for (const group of orderedGroups) {
      const entry = group.entries[round]
      if (!entry) continue
      result.push(entry.item)
      added = true
    }
    if (!added) break
  }
  return result
}
