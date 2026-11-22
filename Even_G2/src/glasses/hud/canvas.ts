// Pixel canvas for the Capri G2 lens.
//
// Every screen is drawn here at full size, 576 x 288, then cut into four
// 288 x 144 tiles for the image containers. The glass shows 16 grey levels,
// 0 is off (see-through) and 15 is brightest, so all drawing works in levels.
// Text uses a bundled monospace font and is snapped to the same levels after
// drawing, so antialiased edges stay as real grey steps on the glass.

import fontUrl from './fonts/jetbrains-mono-bold.woff2?url'
import badgeUrl from '../../../icons/custom/CapriBadge.png?url'
import hexUrl from '../../../icons/custom/CapriHex.png?url'
import shieldUrl from '../../../icons/custom/CapriShield.png?url'

export const SCREEN_W = 576
export const SCREEN_H = 288

export const BRIGHT = 15
export const MID = 9
export const DIM = 5

const FONT_FAMILY = 'HudMono'
let fontReady: Promise<void> | null = null
export let hudBadge: HTMLImageElement | null = null
export let hudHex: HTMLImageElement | null = null
export let hudShield: HTMLImageElement | null = null

function loadImage(url: string, name: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`${name} failed to load`))
    image.src = url
  })
}

export async function loadHudAssets(): Promise<void> {
  if (hudBadge && hudHex && hudShield) return
  hudBadge ??= await loadImage(badgeUrl, 'Capri badge')
  hudHex ??= await loadImage(hexUrl, 'Capri hexagon')
  hudShield ??= await loadImage(shieldUrl, 'Capri shield')
}

export function loadHudFont(): Promise<void> {
  if (!fontReady) {
    fontReady = (async () => {
      try {
        const face = new FontFace(FONT_FAMILY, `url(${fontUrl})`, { weight: '700' })
        await Promise.race([
          face.load().then(() => { document.fonts.add(face) }),
          new Promise<void>(resolve => setTimeout(resolve, 500)),
        ])
    } catch (err) {
        console.warn('capri hud: font load failed, using monospace', err)
      }
    })()
  }
  return fontReady
}

export type Align = 'left' | 'right' | 'center'

export class Pixels {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D

  constructor(width = SCREEN_W, height = SCREEN_H) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!
    this.ctx.imageSmoothingEnabled = false
    this.level(0)
    this.ctx.fillRect(0, 0, width, height)
  }

  level(value: number): void {
    const v = Math.round(Math.max(0, Math.min(15, value)) * 17)
    this.ctx.fillStyle = `rgb(${v},${v},${v})`
  }

  rect(x: number, y: number, w: number, h: number, value: number): void {
    this.level(value)
    this.ctx.fillRect(x, y, w, h)
  }

  image(source: CanvasImageSource, x: number, y: number, size: number): void {
    this.ctx.drawImage(source, x, y, size, size)
  }

  line(x0: number, y0: number, x1: number, y1: number, value: number, size = 1): void {
    this.level(value)
    const dx = Math.abs(x1 - x0)
    const dy = Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx - dy
    let x = x0
    let y = y0
    for (;;) {
      this.ctx.fillRect(x, y, size, size)
      if (x === x1 && y === y1) break
      const e2 = 2 * err
      if (e2 > -dy) { err -= dy; x += sx }
      if (e2 < dx) { err += dx; y += sy }
    }
  }

  path(points: Array<[number, number]>, value: number, size = 1): void {
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1]
      const [bx, by] = points[i]
      this.line(ax, ay, bx, by, value, size)
    }
  }

  circle(cx: number, cy: number, r: number, value: number, filled = false, thickness = 1): void {
    this.arc(cx, cy, r, 0, Math.PI * 2, value, thickness, filled)
  }

  arc(cx: number, cy: number, r: number, from: number, to: number, value: number, thickness = 1, filled = false): void {
    const ctx = this.ctx
    const v = Math.round(Math.max(0, Math.min(15, value)) * 17)
    ctx.beginPath()
    ctx.arc(cx + 0.5, cy + 0.5, r, from - Math.PI / 2, to - Math.PI / 2)
    if (filled) {
      ctx.fillStyle = `rgb(${v},${v},${v})`
      ctx.fill()
    } else {
      ctx.strokeStyle = `rgb(${v},${v},${v})`
      ctx.lineWidth = thickness
      ctx.stroke()
    }
  }

  bitmap(rows: readonly string[], x: number, y: number, value: number): void {
    this.level(value)
    rows.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) if (row[dx] === '#') this.ctx.fillRect(x + dx, y + dy, 1, 1)
    })
  }

  svg(d: string, viewBox: number, x: number, y: number, size: number, value: number, lineWidth = 2): void {
    const v = Math.round(value * 17)
    const ctx = this.ctx
    ctx.save()
    ctx.translate(x, y)
    ctx.scale(size / viewBox, size / viewBox)
    ctx.strokeStyle = `rgb(${v},${v},${v})`
    ctx.lineWidth = lineWidth * viewBox / size
    ctx.lineJoin = 'round'
    ctx.stroke(new Path2D(d))
    ctx.restore()
  }

  font(px: number): string {
    return `700 ${px}px ${FONT_FAMILY}, ui-monospace, Menlo, monospace`
  }

  textWidth(text: string, px: number): number {
    this.ctx.font = this.font(px)
    return this.ctx.measureText(text).width
  }

  text(text: string, x: number, y: number, px: number, value = BRIGHT, align: Align = 'left'): number {
    const ctx = this.ctx
    ctx.font = this.font(px)
    ctx.textBaseline = 'top'
    ctx.textAlign = align
    this.level(value)
    ctx.fillText(text, x, y)
    return ctx.measureText(text).width
  }

  fit(text: string, px: number, maxWidth: number): string {
    if (this.textWidth(text, px) <= maxWidth) return text
    let cut = text
    while (cut.length > 1 && this.textWidth(cut + '…', px) > maxWidth) cut = cut.slice(0, -1)
    return cut.trimEnd() + '…'
  }

  quantize(): void {
    const { width, height } = this.canvas
    const image = this.ctx.getImageData(0, 0, width, height)
    const px = image.data
    for (let i = 0; i < px.length; i += 4) {
      const lum = Math.max(px[i], px[i + 1], px[i + 2])
      const step = Math.min(15, Math.round(lum / 17))
      const v = step * 17
      px[i] = v
      px[i + 1] = v
      px[i + 2] = v
      px[i + 3] = 255
    }
    this.ctx.putImageData(image, 0, 0)
  }
}

export interface Tile {
  id: number
  name: string
  x: number
  y: number
  width: number
  height: number
}

const TILE_W = SCREEN_W / 2
const TILE_H = SCREEN_H / 2

export const TILES: readonly Tile[] = [
  { id: 2, name: 'tile-tl', x: 0, y: 0, width: TILE_W, height: TILE_H },
  { id: 3, name: 'tile-tr', x: TILE_W, y: 0, width: TILE_W, height: TILE_H },
  { id: 4, name: 'tile-bl', x: 0, y: TILE_H, width: TILE_W, height: TILE_H },
  { id: 5, name: 'tile-br', x: TILE_W, y: TILE_H, width: TILE_W, height: TILE_H },
]

export function tileKey(source: Pixels, tile: Tile): string {
  const data = source.ctx.getImageData(tile.x, tile.y, tile.width, tile.height).data
  let hash = 2166136261
  let lit = 0
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i]
    if (v) lit++
    hash = Math.imul(hash ^ v, 16777619)
  }
  return `${hash >>> 0}:${lit}`
}

export async function tilePng(source: Pixels, tile: Tile): Promise<number[]> {
  const part = new Pixels(tile.width, tile.height)
  part.ctx.drawImage(source.canvas, tile.x, tile.y, tile.width, tile.height, 0, 0, tile.width, tile.height)
  const blob = await new Promise<Blob>((resolve, reject) => {
    part.canvas.toBlob(b => (b ? resolve(b) : reject(new Error('tile encode failed'))), 'image/png')
  })
  return Array.from(new Uint8Array(await blob.arrayBuffer()))
}
