type Grid = string[][]

const COLUMNS = 80
const ROWS = 24

export class TerminalScreen {
  private primary: Grid = this.blankGrid()
  private alternate: Grid = this.blankGrid()
  private grid = this.primary
  private x = 0
  private y = 0
  private savedX = 0
  private savedY = 0
  private scrollTop = 0
  private scrollBottom = ROWS - 1
  private alternateMode = false
  private state: 'text' | 'escape' | 'csi' | 'osc' | 'osc-escape' | 'dcs' | 'dcs-escape' | 'charset' = 'text'
  private parameters = ''

  reset(): void {
    this.primary = this.blankGrid()
    this.alternate = this.blankGrid()
    this.grid = this.primary
    this.x = 0
    this.y = 0
    this.savedX = 0
    this.savedY = 0
    this.scrollTop = 0
    this.scrollBottom = ROWS - 1
    this.alternateMode = false
    this.state = 'text'
    this.parameters = ''
  }

  feed(value: string): void {
    for (const character of value) this.consume(character)
  }

  text(): string {
    let last = -1
    for (let row = 0; row < this.grid.length; row += 1) {
      if (this.grid[row].some((cell) => cell !== ' ')) last = row
    }
    if (last < 0) return ''
    return this.grid.slice(0, last + 1).map((line) => line.join('').replace(/\s+$/, '')).join('\n')
  }

  compactLines(limit: number, width: number): string[] {
    return this.grid
      .map((line) => line.join('').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(-limit)
      .map((line) => line.replace(/^\d+\s+/, '').replace(/^-\s*/, '− ').replace(/^\+\s*/, '+ '))
      .map((line) => line.length > width ? `${line.slice(0, Math.max(1, width - 1))}…` : line)
  }

  private blankGrid(): Grid {
    return Array.from({ length: ROWS }, () => Array.from({ length: COLUMNS }, () => ' '))
  }

  private consume(character: string): void {
    if (this.state === 'osc') {
      if (character === '\u0007') this.state = 'text'
      else if (character === '\u001b') this.state = 'osc-escape'
      return
    }
    if (this.state === 'osc-escape') {
      this.state = character === '\\' ? 'text' : 'osc'
      return
    }
    if (this.state === 'dcs') {
      if (character === '\u001b') this.state = 'dcs-escape'
      return
    }
    if (this.state === 'dcs-escape') {
      this.state = character === '\\' ? 'text' : 'dcs'
      return
    }
    if (this.state === 'csi') {
      const code = character.codePointAt(0) ?? 0
      if (code >= 0x40 && code <= 0x7e) {
        this.handleCsi(this.parameters, character)
        this.parameters = ''
        this.state = 'text'
      } else if (this.parameters.length < 96) {
        this.parameters += character
      }
      return
    }
    if (this.state === 'escape') {
      this.state = 'text'
      if (character === '[') this.state = 'csi'
      else if (character === ']') this.state = 'osc'
      else if (character === 'P' || character === '^' || character === '_') this.state = 'dcs'
      else if (character === '(' || character === ')') this.state = 'charset'
      else if (character === '7') this.saveCursor()
      else if (character === '8') this.restoreCursor()
      else if (character === 'D') this.index()
      else if (character === 'M') this.reverseIndex()
      else if (character === 'E') {
        this.x = 0
        this.index()
      } else if (character === 'c') this.reset()
      return
    }
    if (this.state === 'charset') {
      this.state = 'text'
      return
    }

    if (character === '\u001b') this.state = 'escape'
    else if (character === '\r') this.x = 0
    else if (character === '\n' || character === '\u000b' || character === '\u000c') this.index()
    else if (character === '\b') this.x = Math.max(0, this.x - 1)
    else if (character === '\t') this.x = Math.min(COLUMNS - 1, (this.x + 8) & ~7)
    else if ((character.codePointAt(0) ?? 0) >= 0x20 && character !== '\u007f') this.write(character)
  }

  private handleCsi(raw: string, final: string): void {
    const privateMode = raw.startsWith('?')
    const normalized = raw.replace(/^[?>!]/, '')
    const values = normalized.split(/[;:]/).map((value) => Number.parseInt(value, 10))
    const param = (index: number, fallback = 1): number => Number.isFinite(values[index]) && values[index] !== 0 ? values[index] : fallback
    if (privateMode && (final === 'h' || final === 'l')) {
      const enabled = final === 'h'
      if (values.includes(1049) || values.includes(1047) || values.includes(47)) this.setAlternate(enabled)
      return
    }
    switch (final) {
      case 'A': this.y = Math.max(this.scrollTop, this.y - param(0)); break
      case 'B': this.y = Math.min(this.scrollBottom, this.y + param(0)); break
      case 'C': case 'a': this.x = Math.min(COLUMNS - 1, this.x + param(0)); break
      case 'D': this.x = Math.max(0, this.x - param(0)); break
      case 'E': this.y = Math.min(this.scrollBottom, this.y + param(0)); this.x = 0; break
      case 'F': this.y = Math.max(this.scrollTop, this.y - param(0)); this.x = 0; break
      case 'G': case '`': this.x = Math.min(COLUMNS - 1, param(0) - 1); break
      case 'd': this.y = Math.min(ROWS - 1, param(0) - 1); break
      case 'H': case 'f': this.y = Math.min(ROWS - 1, param(0) - 1); this.x = Math.min(COLUMNS - 1, param(1) - 1); break
      case 'J': this.eraseDisplay(values[0] ?? 0); break
      case 'K': this.eraseLine(values[0] ?? 0); break
      case 'X': this.fill(this.y, this.x, Math.min(COLUMNS, this.x + param(0))); break
      case 'P': this.deleteCharacters(param(0)); break
      case '@': this.insertCharacters(param(0)); break
      case 'L': this.insertLines(param(0)); break
      case 'M': this.deleteLines(param(0)); break
      case 'S': this.scrollUp(param(0)); break
      case 'T': this.scrollDown(param(0)); break
      case 'r':
        this.scrollTop = Math.max(0, Math.min(ROWS - 1, param(0) - 1))
        this.scrollBottom = Math.max(this.scrollTop, Math.min(ROWS - 1, param(1, ROWS) - 1))
        this.x = 0
        this.y = 0
        break
      case 's': this.saveCursor(); break
      case 'u': this.restoreCursor(); break
    }
  }

  private write(character: string): void {
    this.grid[this.y][this.x] = character
    this.x += 1
    if (this.x >= COLUMNS) {
      this.x = 0
      this.index()
    }
  }

  private index(): void {
    if (this.y === this.scrollBottom) this.scrollUp(1)
    else this.y = Math.min(ROWS - 1, this.y + 1)
  }

  private reverseIndex(): void {
    if (this.y === this.scrollTop) this.scrollDown(1)
    else this.y = Math.max(0, this.y - 1)
  }

  private saveCursor(): void {
    this.savedX = this.x
    this.savedY = this.y
  }

  private restoreCursor(): void {
    this.x = Math.max(0, Math.min(COLUMNS - 1, this.savedX))
    this.y = Math.max(0, Math.min(ROWS - 1, this.savedY))
  }

  private eraseDisplay(mode: number): void {
    if (mode === 2 || mode === 3) {
      for (let row = 0; row < ROWS; row += 1) this.fill(row, 0, COLUMNS)
    } else if (mode === 0) {
      this.fill(this.y, this.x, COLUMNS)
      for (let row = this.y + 1; row < ROWS; row += 1) this.fill(row, 0, COLUMNS)
    } else if (mode === 1) {
      for (let row = 0; row < this.y; row += 1) this.fill(row, 0, COLUMNS)
      this.fill(this.y, 0, this.x + 1)
    }
  }

  private eraseLine(mode: number): void {
    if (mode === 2) this.fill(this.y, 0, COLUMNS)
    else if (mode === 1) this.fill(this.y, 0, this.x + 1)
    else this.fill(this.y, this.x, COLUMNS)
  }

  private fill(row: number, from: number, to: number): void {
    for (let column = Math.max(0, from); column < Math.min(COLUMNS, to); column += 1) this.grid[row][column] = ' '
  }

  private scrollUp(count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.grid.splice(this.scrollTop, 1)
      this.grid.splice(this.scrollBottom, 0, Array.from({ length: COLUMNS }, () => ' '))
    }
  }

  private scrollDown(count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.grid.splice(this.scrollBottom, 1)
      this.grid.splice(this.scrollTop, 0, Array.from({ length: COLUMNS }, () => ' '))
    }
  }

  private insertCharacters(count: number): void {
    const row = this.grid[this.y]
    row.splice(this.x, 0, ...Array.from({ length: Math.min(count, COLUMNS) }, () => ' '))
    row.length = COLUMNS
  }

  private deleteCharacters(count: number): void {
    const row = this.grid[this.y]
    row.splice(this.x, Math.min(count, COLUMNS - this.x))
    while (row.length < COLUMNS) row.push(' ')
  }

  private insertLines(count: number): void {
    if (this.y < this.scrollTop || this.y > this.scrollBottom) return
    for (let index = 0; index < count; index += 1) {
      this.grid.splice(this.y, 0, Array.from({ length: COLUMNS }, () => ' '))
      this.grid.splice(this.scrollBottom + 1, 1)
    }
  }

  private deleteLines(count: number): void {
    if (this.y < this.scrollTop || this.y > this.scrollBottom) return
    for (let index = 0; index < count; index += 1) {
      this.grid.splice(this.y, 1)
      this.grid.splice(this.scrollBottom, 0, Array.from({ length: COLUMNS }, () => ' '))
    }
  }

  private setAlternate(enabled: boolean): void {
    if (enabled && !this.alternateMode) {
      this.savedX = this.x
      this.savedY = this.y
      this.primary = this.grid
      this.alternate = this.blankGrid()
      this.grid = this.alternate
      this.alternateMode = true
      this.x = 0
      this.y = 0
    } else if (!enabled && this.alternateMode) {
      this.grid = this.primary
      this.alternateMode = false
      this.x = this.savedX
      this.y = this.savedY
    }
  }
}
