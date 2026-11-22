// Screen layouts for the Capri lens, drawn onto the full 576 x 288 canvas.
//
// Everything is drawn as image art: corner brackets, scanline rows, header
// notches, status glyphs, hex-grid accents. The art is cut into four 288 x 144
// tiles and sent as image containers; text stays in firmware text containers
// layered on top so cursor moves are instant.
//
// Grey levels 0-15: 0 is off (see-through), 15 is brightest green on hardware.

import { BRIGHT, hudBadge, hudShield, MID, Pixels, SCREEN_W } from './canvas'
import { CAPRI_MARK, ICONS, type IconName } from './art'

const RIGHT = SCREEN_W - 4
const TITLE_PX = 20
const LABEL_PX = 18
const FOOTER_RULE_Y = 232
const FOOTER_Y = 238

function icon(p: Pixels, name: IconName, x: number, y: number, value = BRIGHT): number {
  const rows = ICONS[name]
  p.bitmap(rows, x, y, value)
  return Math.max(...rows.map(r => r.length))
}

/** Capri prompt glyph "> " at (x, y). */
/** Header band: beveled corners, Capri mark, page dots and circuit traces. */
function header(p: Pixels, title: string, _mark: { index: number; count: number } | null): void {
  // Instrument line: title, angled break, and a compact page counter.
  if (hudBadge) p.image(hudBadge, 28, 18, 24)
  else p.svg(CAPRI_MARK, 24, 35, 4, 18, BRIGHT, 1.2)
  const titleSize = title.startsWith('CAPRI') ? 16 : TITLE_PX
  const titleWidth = title.startsWith('CAPRI') ? 450 : 360
  p.text(p.fit(title, titleSize, titleWidth), 58, 18, titleSize)
  p.line(12, 45, 356, 45, BRIGHT, 1)
  p.path([[356, 45], [368, 37], [548, 37]], BRIGHT, 1)
}

function footer(p: Pixels, left: string, right?: string): void {
  p.line(4, FOOTER_RULE_Y, RIGHT, FOOTER_RULE_Y, MID, 1)
  p.text(left, 12, FOOTER_Y, LABEL_PX, 12)
  if (right) p.text(right, RIGHT - 8 - p.textWidth(right, LABEL_PX), FOOTER_Y, LABEL_PX, 12, 'right')
}

function bevel(p: Pixels, x: number, y: number, w: number, h: number, tone = MID, cut = 10): void {
  p.path([
    [x + cut, y], [x + w - cut, y], [x + w, y + cut],
    [x + w, y + h - cut], [x + w - cut, y + h],
    [x + cut, y + h], [x, y + h - cut], [x, y + cut], [x + cut, y],
  ], tone, 2)
  p.line(x + cut + 8, y + 4, x + w - cut - 8, y + 4, 5, 1)
}

function cornerTicks(p: Pixels, x: number, y: number, w: number, h: number): void {
  p.line(x - 8, y + 12, x - 8, y + 2, BRIGHT, 1)
  p.line(x - 8, y + 2, x + 10, y + 2, BRIGHT, 1)
  p.line(x + w - 10, y + h - 2, x + w + 8, y + h - 2, BRIGHT, 1)
  p.line(x + w + 8, y + h - 12, x + w + 8, y + h - 2, BRIGHT, 1)
}

// ---------- devices: tailnet deck ----------

export interface DevicesData {
  title: string
  page: { index: number; count: number }
  rows: Array<{ name: string; ip: string; online: boolean; available: boolean; ssh?: string }>
  selected: number
  footer: { left: string; right?: string }
}

export function drawDevices(p: Pixels, d: DevicesData): void {
  header(p, d.title, d.page)
  // Device ports: a straight cyberframe with small cut-ins, never a large hexagon.
  p.line(34, 76, 542, 76, MID, 2)
  p.line(24, 86, 24, 208, MID, 2)
  p.line(34, 218, 542, 218, MID, 2)
  p.line(552, 86, 552, 208, MID, 2)
  p.path([[34, 76], [24, 86]], MID, 2)
  p.path([[24, 208], [34, 218]], MID, 2)
  p.path([[542, 76], [552, 86]], MID, 2)
  p.path([[552, 208], [542, 218]], MID, 2)
  p.line(42, 92, 42, 204, 6, 1)
  p.line(32, 92, 42, 82, MID, 1)
  p.line(548, 204, 560, 192, MID, 1)

  const start = Math.max(0, Math.min(d.selected - 2, d.rows.length - 3))
  d.rows.slice(start, start + 3).forEach((row, i) => {
    const index = start + i
    const active = index === d.selected
    const y = 92 + i * 38
    p.text(String(index + 1).padStart(2, '0'), 54, y, 12, active ? BRIGHT : 7)
    p.text(active ? '>' : '·', 86, y - 2, 16, active ? BRIGHT : 7)
    p.text(p.fit(row.name, 21, 172), 108, y - 4, 21, active ? BRIGHT : 11)
    p.text(p.fit(row.ip || '—', 15, 150), 304, y - 1, 15, active ? 11 : 8)
    p.circle(456, y + 6, 4, row.online ? (active ? BRIGHT : 10) : 4, true)
    p.text(row.online ? 'ONLINE' : 'OFFLINE', 470, y - 1, 13, row.online ? (active ? BRIGHT : 10) : 5)
  })
  p.line(4, FOOTER_RULE_Y, RIGHT, FOOTER_RULE_Y, 6, 1)
  p.text('↑↓ NAVIGATE', 12, FOOTER_Y, 12, 10)
  p.text('TAP SELECT', RIGHT - 8, FOOTER_Y, 12, 10, 'right')
}

// ---------- actions: deck quick choices ----------

export interface ActionsData {
  title: string
  page: { index: number; count: number }
  rows: Array<{ label: string; hint?: string }>
  selected: number
  footer: { left: string; right?: string }
}

export function drawActions(p: Pixels, d: ActionsData): void {
  header(p, d.title, d.page)

  const start = Math.max(0, Math.min(d.selected - 2, d.rows.length - 4))
  const shown = d.rows.slice(start, start + 4)
  const rowY = 70
  const rowH = 42

  shown.forEach((row, i) => {
    const active = start + i === d.selected
    const y = rowY + i * rowH
    const tone = active ? BRIGHT : 11
    if (active) p.rect(4, y - 2, SCREEN_W - 8, rowH - 2, 3)
    p.text('>', 20, y - 4, 20, tone)
    p.text(p.fit(row.label, 20, 300), 40, y - 4, 20, tone)
    if (row.hint) p.text(row.hint, 360, y - 4, 18, 6)
  })

  footer(p, d.footer.left, d.footer.right)
}

// ---------- agents / sessions: plain list ----------

export interface ListData {
  title: string
  page: { index: number; count: number }
  rows: Array<{ label: string; value?: string; meta?: string; activity?: string; approval?: boolean }>
  selected: number
  footer: { left: string; right?: string }
}

function wrapText(p: Pixels, text: string, px: number, maxWidth: number, maxLines: number): string[] {
  const lines: string[] = []
  let remaining = text || '—'
  while (remaining && lines.length < maxLines) {
    if (p.textWidth(remaining, px) <= maxWidth) {
      lines.push(remaining)
      remaining = ''
      break
    }
    let cut = remaining.length
    while (cut > 1 && p.textWidth(remaining.slice(0, cut), px) > maxWidth) cut -= 1
    const slash = remaining.lastIndexOf('/', cut - 1)
    if (slash > Math.floor(cut * 0.55)) cut = slash + 1
    lines.push(remaining.slice(0, cut))
    remaining = remaining.slice(cut)
  }
  if (remaining && lines.length) lines[lines.length - 1] += remaining
  return lines.length ? lines : ['—']
}

export function drawList(p: Pixels, d: ListData): void {
  header(p, d.title, d.page)
  const sessionList = d.rows.some((row) => row.activity !== undefined)
  const frameHeight = sessionList ? 132 : 148
  bevel(p, 16, 66, 544, frameHeight, MID, 12)
  cornerTicks(p, 16, 66, 544, frameHeight)
  const visibleCount = sessionList ? 2 : 4
  const hasColumns = sessionList
  if (hasColumns) {
    p.text('SESSION', 58, 74, 8, 7)
    p.text('HARNESS', 400, 74, 8, 7)
    p.text('LAST', 548, 74, 8, 7, 'right')
    p.line(38, 83, 538, 83, 5, 1)
  }
  // Row contents are supplied by LIST_LAYOUT's firmware text container. Keep
  // the separators in the raster frame so they never move during a swipe.
  const rowY = hasColumns ? 94 : 80
  const rowH = hasColumns ? 46 : 32
  for (let i = 1; i < visibleCount; i++) {
    p.line(38, rowY + i * rowH - (hasColumns ? 10 : 7), 538, rowY + i * rowH - (hasColumns ? 10 : 7), 5, 1)
  }

  if (sessionList) {
    p.line(4, 208, RIGHT, 208, 6, 1)
    p.text('↑↓ NAVIGATE', 12, 214, 11, 10)
    p.text('TAP SELECT', 320, 214, 11, 10, 'center')
    p.text('2× RETURN', RIGHT - 8, 214, 11, 10, 'right')
  } else {
    footer(p, d.footer.left, d.footer.right)
  }
}

// ---------- chat / terminal: live output ----------

export interface LiveData {
  title: string
  page: { index: number; count: number }
  lines: string[]
  active: boolean
  loading?: boolean
  loadingFrame?: number
  footer: { left: string; right?: string }
}

export function drawLive(p: Pixels, d: LiveData): void {
  header(p, d.title, d.page)

  if (d.loading) {
    const frames = ['·  ·  ·', '○  ·  ·', '·  ○  ·', '·  ·  ○']
    p.text(frames[d.loadingFrame ?? 0] ?? frames[0], SCREEN_W / 2, 126, 20, BRIGHT, 'center')
    p.text('LOADING SESSION', SCREEN_W / 2, 158, 13, 10, 'center')
    footer(p, d.footer.left)
    return
  }

  const start = Math.max(0, d.lines.length - (d.active ? 8 : 5))
  const y = 70
  d.lines.slice(start).forEach((line, i) => {
    const tone = d.active && i === d.lines.length - start - 1 ? BRIGHT : 11
    p.text(p.fit(line, 18, 540), 12, y + i * 24, 18, tone)
  })

  p.line(4, FOOTER_RULE_Y, RIGHT, FOOTER_RULE_Y, 6, 1)
  p.text(p.fit(d.footer.left, 12, 540), 12, FOOTER_Y, 12, 10)
}

// ---------- approval ----------

export interface ApprovalData {
  title: string
  page: { index: number; count: number }
  prompt: string
  options: Array<{ label: string }>
  selected: number
  footer: { left: string; right?: string }
}

export function drawApproval(p: Pixels, d: ApprovalData): void {
  header(p, d.title, d.page)

  const promptLines = d.prompt.split('\n').flatMap((line) => wrapText(p, line || ' ', 14, 540, 3)).slice(0, 3)
  promptLines.forEach((line, i) => p.text(line, 12, 64 + i * 16, 14, 12))
  const rowY = 64 + Math.max(1, promptLines.length) * 16 + 8
  const rowH = Math.max(26, Math.min(32, Math.floor((FOOTER_RULE_Y - rowY - 5) / Math.max(1, d.options.length))))
  const optionPx = rowH >= 30 ? 13 : 12
  d.options.forEach((option, i) => {
    const active = i === d.selected
    const y = rowY + i * rowH
    const tone = active ? BRIGHT : 11
    if (active) p.rect(4, y - 2, SCREEN_W - 8, rowH - 2, 3)
    p.text(active ? '>' : '·', 20, y - 1, optionPx, tone)
    const optionLines = wrapText(p, option.label, optionPx, 500, rowH >= 30 ? 2 : 1)
    optionLines.forEach((line, lineIndex) => p.text(line, 40, y + lineIndex * 14, optionPx, tone))
  })

  footer(p, '↑↓ NAVIGATE   TAP SELECT')
}

// ---------- keyboard ----------

export interface KeyboardData {
  title: string
  page: { index: number; count: number }
  typed: string
  pageIndex: number
  pageCount: number
  footer: { left: string; right?: string }
}

export function drawKeyboard(p: Pixels, d: KeyboardData): void {
  header(p, d.title, d.page)

  p.text(p.fit(`> ${d.typed || 'type a key'}`, 20, 540), 12, 70, 20, 12)
  p.text(`page ${d.pageIndex + 1}/${d.pageCount}`, 12, 102, LABEL_PX, 10)

  footer(p, d.footer.left, d.footer.right)
}

// ---------- Box: frame list and detail screens ----------

export const BOX = { x0: 4, y0: 3, x1: RIGHT, y1: 222 }
export const BOX_RULE_Y = 44
const STEP_X = 372
const STEP_Y = 36

export type TextSlot = 'count' | 'body' | 'hint'

export interface TextBox {
  id: number
  name: string
  x: number
  y: number
  width: number
  height: number
  color: number
}

export const LINE_H = 27
export const BODY_LINES = 6
export const HINT_LINES = 2

export const TEXT_BOXES: Record<TextSlot, TextBox> = {
  count: { id: 9, name: 'count', x: 420, y: 2, width: 146, height: LINE_H + 4, color: 4 },
  body: { id: 7, name: 'body', x: 26, y: BOX_RULE_Y + 10, width: 522, height: LINE_H * BODY_LINES + 4, color: 4 },
  hint: { id: 8, name: 'hint', x: 14, y: BOX.y1 + 6, width: 552, height: LINE_H * HINT_LINES + 2, color: 2 },
}

export function drawBox(p: Pixels, name: IconName, title: string, rowIcons: Array<IconName | null> = [], iconX = 40): void {
  const { x0, x1, y1 } = BOX

  icon(p, name, 14, 20 - Math.ceil(ICONS[name].length / 2), BRIGHT)
  p.text(p.fit(title, TITLE_PX, SCREEN_W / 2 - 46), 40, 9, TITLE_PX)

  p.path([[x0, BOX_RULE_Y], [STEP_X, BOX_RULE_Y], [STEP_X + 8, STEP_Y], [x1, STEP_Y]], BRIGHT, 2)
  p.circle(STEP_X + 4, STEP_Y + 4, 3, BRIGHT, true)

  const top = BOX_RULE_Y + 12
  const bottom = y1 - 10
  p.path([[18, top], [10, top], [10, bottom], [18, bottom]], BRIGHT, 2)

  rowIcons.slice(0, BODY_LINES).forEach((rowIcon, i) => {
    if (!rowIcon) return
    const rows = ICONS[rowIcon]
    if (!rows) return
    const centre = TEXT_BOXES.body.y + i * LINE_H + 15
    p.bitmap(rows, iconX, centre - Math.ceil(rows.length / 2), BRIGHT)
  })

  p.line(x0, y1, x1, y1, MID, 1)
}

/** Boot screen art: the Capri shield resolves inside an angular frame. */
export function drawSplash(p: Pixels, progress: number, left: number, _top: number, size: number, label = 'CAPRI // BOOTING'): void {
  const share = Math.max(0, Math.min(1, progress))
  const cx = left + size / 2
  const logoSize = 168
  const logoX = Math.round(cx - logoSize / 2)
  const logoY = 34
  const frameX = logoX - 18
  const frameY = logoY - 12
  const frameW = logoSize + 36
  const frameH = 178
  const cut = 16
  const frame: Array<[number, number]> = [
    [frameX + cut, frameY], [frameX + frameW - cut, frameY],
    [frameX + frameW, frameY + cut], [frameX + frameW, frameY + frameH - cut],
    [frameX + frameW - cut, frameY + frameH], [frameX + cut, frameY + frameH],
    [frameX, frameY + frameH - cut], [frameX, frameY + cut], [frameX + cut, frameY],
  ]
  const edgeProgress = share * (frame.length - 1)
  const complete = Math.floor(edgeProgress)
  for (let i = 0; i < complete; i++) p.line(frame[i][0], frame[i][1], frame[i + 1][0], frame[i + 1][1], BRIGHT, 2)
  if (complete < frame.length - 1) {
    const amount = edgeProgress - complete
    const [x0, y0] = frame[complete]
    const [x1, y1] = frame[complete + 1]
    p.line(x0, y0, x0 + (x1 - x0) * amount, y0 + (y1 - y0) * amount, BRIGHT, 2)
  }
  if (hudShield) p.image(hudShield, logoX, logoY, logoSize)

  const barX = cx - 108
  const barY = 226
  const barW = 216
  p.line(barX, barY, barX + barW, barY, MID, 1)
  p.line(barX, barY + 7, barX + barW, barY + 7, MID, 1)
  const segments = 12
  const lit = Math.round(segments * share)
  for (let i = 0; i < segments; i++) {
    const x = barX + 3 + i * 18
    p.rect(x, barY + 2, 12, 3, i < lit ? BRIGHT : 3)
  }
  const sweep = barX + 3 + (Math.floor(share * segments) % segments) * 18
  p.rect(sweep, barY + 1, 12, 5, BRIGHT)
  p.line(cx - 130, barY + 3, barX - 10, barY + 3, MID, 1)
  p.line(barX + barW + 10, barY + 3, cx + 130, barY + 3, MID, 1)
  p.text(p.fit(label, 12, 180), cx, 246, 12, 11, 'center')
}
