// Strict last-used ordering. Harness identity never outranks recency: an old
// OpenCode session must not sit above a session used minutes ago.

export interface SessionOrderItem {
  agent: string
  updatedAt?: number
}

/** Runtime feeds both epoch seconds and milliseconds; compare in ms. */
export function updatedAtMs(value?: number): number {
  if (!value || !Number.isFinite(value)) return 0
  return value < 1_000_000_000_000 ? value * 1000 : value
}

export function sortSessionsByLastUsed<T extends SessionOrderItem>(items: T[]): T[] {
  return [...items].sort((a, b) => updatedAtMs(b.updatedAt) - updatedAtMs(a.updatedAt))
}
