// Page layouts the Capri lens switches between.
//
// The Even host turns every image into raw pixels before sending it, so a send
// costs its area, not its PNG size. Dashboard pages draw art edge to edge and
// need all four full tiles. List and detail pages sit in a Box: small header
// art with corner brackets, firmware text everywhere else. Switching layouts
// rebuilds the page, which blanks the old art for free.

import { TILES, type Tile } from './canvas'
import { BOX, TEXT_BOXES, type TextBox, type TextSlot } from './pages'

export interface LineBox {
  id: number
  name: string
  x: number
  y: number
  width: number
  height: number
  color: number
}

export interface Layout {
  key: 'full' | 'list' | 'box' | 'splash'
  images: readonly Tile[]
  texts: Partial<Record<TextSlot, TextBox>>
  lines: readonly LineBox[]
}

export const FULL_LAYOUT: Layout = { key: 'full', images: TILES, texts: {}, lines: [] }

// Lists keep their bevels and column labels in the raster tiles, while the
// changing rows live in a firmware text container. Selection swipes then
// update one text payload instead of re-uploading four image tiles.
export const LIST_LAYOUT: Layout = {
  key: 'list',
  images: TILES,
  texts: {
    body: { id: 7, name: 'list-body', x: 38, y: 88, width: 520, height: 112, color: 4 },
  },
  lines: [],
}

const HEADER_H = 48

export const BOX_LAYOUT: Layout = {
  key: 'box',
  images: [
    { id: 2, name: 'head-l', x: 0, y: 0, width: 288, height: HEADER_H },
    { id: 3, name: 'head-r', x: 288, y: 0, width: 288, height: HEADER_H },
    { id: 4, name: 'rows-a', x: 8, y: 54, width: 56, height: 135 },
    { id: 5, name: 'rows-b', x: 8, y: 189, width: 56, height: 27 },
  ],
  texts: TEXT_BOXES,
  lines: [{ id: 10, name: 'rule', x: BOX.x0, y: BOX.y1, width: BOX.x1 - BOX.x0, height: 2, color: 9 }],
}

export const SPLASH_MARK: Tile = { id: 2, name: 'mark', x: 0, y: 0, width: 576, height: 288 }

export const SPLASH_LAYOUT: Layout = {
  key: 'splash',
  images: TILES,
  texts: {},
  lines: [],
}
