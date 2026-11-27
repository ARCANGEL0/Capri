// Paints Capri views onto the lens.
//
// A view is drawn to one full-screen canvas, then cut into the image
// containers of its layout. Only images whose pixels changed are sent. When a
// view needs another layout the page is rebuilt with the new text already in
// it, so the next screen never shows on top of the last one's art.
// Calls that arrive while a paint is running collapse into one more paint.

import type { CapriRuntime } from '../../even'
import type { IconName } from './art'
import { Pixels, loadHudAssets, loadHudFont, tileKey, tilePng } from './canvas'
import { BOX_LAYOUT as FRAME_LAYOUT, FULL_LAYOUT, LIVE_LAYOUT, LIST_LAYOUT, SPLASH_LAYOUT, SPLASH_MARK, type Layout } from './layouts'
import {
  drawActions,
  drawApproval,
  drawBox,
  drawDevices,
  drawList,
  drawLive,
  drawSplash,
  type TextSlot,
} from './pages'
import { liveTexts } from '../../hud-text'

export interface BoxView {
  kind: 'box'
  icon: IconName
  title: string
  count: string
  body: string
  hint: string
  rowIcons?: Array<IconName | null>
}

export type HudView = (
  | { kind: 'devices'; data: { title: string; page: { index: number; count: number }; rows: Array<{ name: string; ip: string; online: boolean; available: boolean; ssh?: string }>; selected: number; footer: { left: string; right?: string } } }
  | { kind: 'actions'; data: { title: string; page: { index: number; count: number }; rows: Array<{ label: string; hint?: string }>; selected: number; footer: { left: string; right?: string } } }
  | { kind: 'list'; data: { title: string; page: { index: number; count: number }; rows: Array<{ label: string; value?: string; meta?: string; activity?: string; approval?: boolean }>; selected: number; footer: { left: string; right?: string } } }
  | { kind: 'live'; data: { title: string; page: { index: number; count: number }; lines: string[]; active: boolean; loading?: boolean; loadingFrame?: number; statusFrame?: number; status?: string; footer: { left: string; right?: string } } }
  | { kind: 'approval'; data: { title: string; page: { index: number; count: number }; prompt: string; options: Array<{ label: string }>; selected: number; footer: { left: string; right?: string } } }
  | BoxView
  | { kind: 'splash'; progress: number; text: string }
) & { ack?: boolean }

function layoutFor(view: HudView): Layout {
  if (view.kind === 'box') return FRAME_LAYOUT
  if (view.kind === 'live') return LIVE_LAYOUT
  if (view.kind === 'list') return LIST_LAYOUT
  if (view.kind === 'splash') return SPLASH_LAYOUT
  return FULL_LAYOUT
}

function draw(view: HudView): Pixels {
  const p = new Pixels()
  switch (view.kind) {
    case 'devices': drawDevices(p, view.data); break
    case 'actions': drawActions(p, view.data); break
    case 'list': drawList(p, view.data); break
    case 'live': drawLive(p, view.data); break
    case 'approval': drawApproval(p, view.data); break
    case 'box': drawBox(p, view.icon, view.title, view.rowIcons); break
    case 'splash':
      drawSplash(p, view.progress, SPLASH_MARK.x, SPLASH_MARK.y, SPLASH_MARK.width, view.text); break
  }
  p.quantize()
  return p
}

const SLOTS: TextSlot[] = ['count', 'body', 'hint']

function textsFor(view: HudView): Record<TextSlot, string> {
  if (view.kind === 'live') return liveTexts(view.data, view.ack)
  if (view.kind === 'box') return { count: view.count || ' ', body: view.body || ' ', hint: view.hint || ' ' }
  if (view.kind === 'list') return { count: ' ', body: `${view.ack ? '› ' : ''}${listBodyText(view.data)}`, hint: ' ' }
  if (view.kind === 'splash') return { count: ' ', body: view.text || ' ', hint: ' ' }
  return { count: ' ', body: ' ', hint: ' ' }
}

function listBodyText(data: Extract<HudView, { kind: 'list' }>['data']): string {
  const sessionList = data.rows.some((row) => row.activity !== undefined)
  const visibleCount = sessionList ? 2 : 4
  const start = Math.max(0, Math.min(data.selected - (sessionList ? 0 : 1), data.rows.length - visibleCount))
  const shown = data.rows.slice(start, start + visibleCount)
  const fit = (value: string, max: number): string => value.length <= max ? value : `${value.slice(0, Math.max(1, max - 1)).trimEnd()}…`
  const lines: string[] = []
  shown.forEach((row, index) => {
    const active = start + index === data.selected
    const marker = active ? '▶' : '·'
    lines.push(`${marker} ${fit(row.label || '—', sessionList ? 30 : 48)}`)
    if (sessionList) {
      if (row.activity === undefined) {
        lines.push('')
      } else {
        const meta = [row.meta, row.activity, row.approval ? '!ATTENTION' : ''].filter(Boolean).join('  ')
        lines.push(`  ${fit(row.value || '—', row.approval ? 24 : 42)}${meta ? `  ${fit(meta, 22)}` : ''}`)
      }
    }
  })
  return lines.join('\n')
}

export class Hud {
  private sent = new Map<number, string>()
  private next: HudView | null = null
  private painting: Promise<void> | null = null

  constructor(private runtime: CapriRuntime) {}

  show(view: HudView): Promise<void> {
    this.next = view
    if (this.painting) return this.painting
    this.painting = this.drain().finally(() => { this.painting = null })
    return this.painting
  }

  invalidate(): void {
    this.sent.clear()
  }

  private async drain(): Promise<void> {
    await Promise.all([loadHudFont(), loadHudAssets()])
    let failures = 0
    while (this.next) {
      const view = this.next
      this.next = null
      try {
        await this.flush(view)
        failures = 0
      } catch (err) {
        console.error('capri hud: paint failed', err)
        this.sent.clear()
        if (++failures <= 3 && !this.next) {
          await new Promise(resolve => setTimeout(resolve, 400 * failures))
          this.next = view
        }
      }
    }
  }

  private async flush(view: HudView): Promise<void> {
    const layout = layoutFor(view)
    // Text-only layouts skip canvas drawing/quantisation entirely.
    const pixels = layout.images.length ? draw(view) : new Pixels()
    const texts = textsFor(view)
    const slots = SLOTS.filter(slot => layout.texts[slot])

    if (this.runtime.layout() !== layout) {
      await this.runtime.showLayout(layout, texts)
      this.sent.clear()
    } else {
      await Promise.all(slots.map(slot => this.runtime.setText(slot, texts[slot])))
    }

    const changed = layout.images
      .map(tile => ({ tile, key: tileKey(pixels, tile) }))
      .filter(({ tile, key }) => this.sent.get(tile.id) !== key)
    const encoded = await Promise.all(changed.map(({ tile }) => tilePng(pixels, tile)))
    for (let i = 0; i < changed.length; i++) {
      await this.runtime.sendTile(changed[i].tile, encoded[i])
      this.sent.set(changed[i].tile.id, changed[i].key)
    }

    if (changed.length) {
      await Promise.all(slots.filter(slot => texts[slot].trim()).map(slot => this.runtime.setText(slot, texts[slot], true)))
    }
  }
}
