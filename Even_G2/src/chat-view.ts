// Pure helpers for paging the glasses chat. Keeping these out of main.ts lets
// the scroll behaviour be tested without booting the Even bridge.

import { getTextWidth } from '@evenrealities/pretext'

// LIVE_LAYOUT's body text box is 560px wide. Leave room for the firmware's
// padding so a wrapped line never paints over the divider or footer.
export const CHAT_WIDTH_PX = 536

// The body box is 174px tall and the Even font's line height is 27px, so at
// most six lines fit before the last one slips under the footer rule.
export const MAX_BODY_LINES = 6

export function wrapLine(text: string, maxPx = CHAT_WIDTH_PX): string[] {
  if (!text) return []
  const output: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (!word) continue
    const candidate = line ? `${line} ${word}` : word
    if (getTextWidth(candidate) <= maxPx) {
      line = candidate
      continue
    }
    if (line) output.push(line)
    if (getTextWidth(word) <= maxPx) {
      line = word
      continue
    }
    // A single long token still has to be broken, but by pixels rather than a
    // guessed character count so it cannot wrap twice on the lens.
    let chunk = ''
    for (const char of word) {
      if (chunk && getTextWidth(chunk + char) > maxPx) {
        output.push(chunk)
        chunk = ''
      }
      chunk += char
    }
    line = chunk
  }
  if (line) output.push(line)
  return output
}

export function pageFromEnd<T>(items: T[], offset: number, visible: number): T[] {
  const size = Math.max(1, visible)
  const clampedOffset = Math.min(maxScrollOffset(items.length, size), Math.max(0, offset))
  const end = items.length - clampedOffset
  return items.slice(Math.max(0, end - size), end)
}

export function maxScrollOffset(total: number, visible: number): number {
  return Math.max(0, total - Math.max(1, visible))
}

// Kept for callers that only have two flat arrays (and for regressions).
export function transcriptLines(users: string[], replies: string[]): string[] {
  const lines: string[] = []
  for (let i = 0; i < Math.max(users.length, replies.length); i++) {
    if (users[i]) lines.push(`YOU> ${users[i]}`)
    if (replies[i]) lines.push(`AGENT> ${replies[i]}`)
  }
  return lines
}

export type TranscriptUser = { text: string; replyCount?: number }

// Build the live transcript in real chronological order. `replyCount` is the
// number of agent responses that had already started when a user hit send, so
// a reply still streaming from an earlier question stays ABOVE the new YOU>
// line instead of appearing to answer it.
export function turnTranscript(users: TranscriptUser[], replies: string[], history: string[] = []): string[] {
  const lines = [...history]
  for (let i = 0; i < users.length; i++) {
    lines.push(`YOU> ${users[i].text}`)
    const start = users[i].replyCount ?? i
    const end = i + 1 < users.length ? (users[i + 1].replyCount ?? i + 1) : replies.length
    for (let index = start; index < Math.min(end, replies.length); index++) {
      if (replies[index]) lines.push(`AGENT> ${replies[index]}`)
    }
  }
  return lines
}
