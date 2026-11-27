// Text payloads for the live HUD. Keeping this pure means gesture feedback can
// be tested without booting a canvas or the Even bridge.

export interface LiveTextData {
  title: string
  lines: string[]
  active: boolean
  loading?: boolean
  loadingFrame?: number
  statusFrame?: number
  status?: string
  footer: { left: string; right?: string }
}

export type LiveTextSlots = { count: string; body: string; hint: string }

export function liveTexts(data: LiveTextData, ack = false): LiveTextSlots {
  const status = (data.status || '').replace(/\s+/g, ' ').trim()
  const loop = status.length > 34 ? `${status}   ·   ` : status
  const offset = loop.length > 34 ? (data.statusFrame ?? 0) % loop.length : 0
  const shownStatus = loop.length > 34 ? (loop + loop).slice(offset, offset + 34) : status
  const frames = ['·  ·  ·', '○  ·  ·', '·  ○  ·', '·  ·  ○']
  const body = data.loading
    ? `${frames[(data.loadingFrame ?? 0) % frames.length]}\nLOADING SESSION`
    : data.lines.join('\n')
  return {
    count: `${data.title}  ·  ${shownStatus}`,
    body,
    // Instant acknowledgement marker: a text write, not an image tile upload.
    hint: `${ack ? '› ' : ''}${data.footer.left}`,
  }
}
