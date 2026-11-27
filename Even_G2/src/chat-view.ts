// Pure helpers for paging the glasses chat. Keeping these out of main.ts lets
// the scroll behaviour be tested without booting the Even bridge.

export function wrapLine(text: string, width: number): string[] {
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

export function pageFromEnd<T>(items: T[], offset: number, visible: number): T[] {
  const size = Math.max(1, visible)
  const clampedOffset = Math.min(maxScrollOffset(items.length, size), Math.max(0, offset))
  const end = items.length - clampedOffset
  return items.slice(Math.max(0, end - size), end)
}

export function maxScrollOffset(total: number, visible: number): number {
  return Math.max(0, total - Math.max(1, visible))
}
