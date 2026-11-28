// Text-only review screen. The transcript stays readable, pages from the
// newest line, and always keeps the action rows visible at the bottom.

import { maxScrollOffset, pageFromEnd, wrapLine } from './chat-view'

export const REVIEW_VISIBLE_LINES = 7

export function reviewTranscriptLines(transcript: string): string[] {
  return (transcript || 'No transcript was captured.')
    .split('\n')
    .flatMap((line) => wrapLine(line))
}

export function reviewBody(
  transcript: string,
  options: Array<{ label: string }>,
  selected: number,
  offset: number,
): string[] {
  const lines = reviewTranscriptLines(transcript)
  const visible = Math.max(1, REVIEW_VISIBLE_LINES - options.length - 1)
  const page = pageFromEnd(lines, offset, visible)
  return [
    ...page,
    '──────────',
    ...options.map((option, index) => `${index === selected ? '▶' : ' '} ${option.label.trim().replace(/^[>›]+\s*/, '')}`),
  ]
}

export function maxReviewOffset(transcript: string, optionCount: number): number {
  const visible = Math.max(1, REVIEW_VISIBLE_LINES - optionCount - 1)
  return maxScrollOffset(reviewTranscriptLines(transcript).length, visible)
}
