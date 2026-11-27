// Reconstruct readable lines from an agent's PTY stream.
//
// Agent UIs redraw parts of the current line with carriage returns and CSI
// cursor moves. Deleting those control bytes concatenates the redrawn pieces
// into strings such as "Itisavailabletoactivebetatesters". This tiny line
// editor applies the moves instead of dropping them, so word spacing and
// paragraph breaks survive. It intentionally does not try to reformat prose:
// once the stream is reconstructed, lines are kept exactly as the agent wrote
// them.

const ESC = '\u001b'
const MAX_LINES = 4000

export class AgentOutput {
  private lines: string[] = ['']
  private row = 0
  private col = 0
  private state: 'text' | 'escape' | 'csi' | 'osc' | 'osc-escape' = 'text'
  private params = ''

  reset(): void {
    this.lines = ['']
    this.row = 0
    this.col = 0
    this.state = 'text'
    this.params = ''
  }

  feed(chunk: string): void {
    for (const character of chunk) this.consume(character)
  }

  /** Complete, dedented lines. Only trailing blank lines are removed. */
  text(): string {
    const lines = this.lines.map((line) => line.replace(/\s+$/, ''))
    while (lines.length && !lines[lines.length - 1]) lines.pop()
    return lines.join('\n')
  }

  private ensureRow(row: number): void {
    while (this.lines.length <= row) this.lines.push('')
  }

  private write(character: string): void {
    this.ensureRow(this.row)
    const line = this.lines[this.row]
    if (this.col > line.length) {
      this.lines[this.row] = line + ' '.repeat(this.col - line.length)
    }
    const current = this.lines[this.row]
    this.lines[this.row] = current.slice(0, this.col) + character + current.slice(this.col + 1)
    this.col += 1
  }

  private eraseAfterCursor(): void {
    this.ensureRow(this.row)
    const line = this.lines[this.row]
    this.lines[this.row] = line.slice(0, Math.max(0, Math.min(this.col, line.length)))
  }

  private eraseBeforeCursor(): void {
    this.ensureRow(this.row)
    const line = this.lines[this.row]
    const cut = Math.max(0, Math.min(this.col, line.length))
    this.lines[this.row] = ' '.repeat(cut) + line.slice(cut)
  }

  private trimHistory(): void {
    const extra = this.lines.length - MAX_LINES
    if (extra <= 0) return
    this.lines.splice(0, extra)
    this.row = Math.max(0, this.row - extra)
  }

  private consume(character: string): void {
    if (this.state === 'osc') {
      if (character === '\u0007') this.state = 'text'
      else if (character === ESC) this.state = 'osc-escape'
      return
    }
    if (this.state === 'osc-escape') {
      this.state = character === '\\' ? 'text' : 'osc'
      return
    }
    if (this.state === 'csi') {
      const code = character.codePointAt(0) ?? 0
      if (code >= 0x40 && code <= 0x7e) {
        const final = character
        const parameters = this.params
        this.params = ''
        this.state = 'text'
        this.csi(final, parameters)
      } else if (this.params.length < 64) {
        this.params += character
      }
      return
    }
    if (this.state === 'escape') {
      this.state = 'text'
      if (character === '[') this.state = 'csi'
      else if (character === ']') this.state = 'osc'
      else if (character === 'P' || character === '^' || character === '_') this.state = 'osc'
      else if (character === '(' || character === ')' || character === '#') this.state = 'escape'
      return
    }

    if (character === ESC) {
      this.state = 'escape'
      return
    }
    if (character === '\r') {
      // A bare CR starts a fresh redraw of this line. Keeping the old tail
      // would glue a short replacement onto the end of the previous text.
      this.ensureRow(this.row)
      this.lines[this.row] = ''
      this.col = 0
      return
    }
    if (character === '\n' || character === '\u000b' || character === '\u000c') {
      this.row += 1
      this.col = 0
      this.ensureRow(this.row)
      this.trimHistory()
      return
    }
    if (character === '\b') {
      this.col = Math.max(0, this.col - 1)
      return
    }
    if (character === '\t') {
      this.col += 8 - (this.col % 8)
      return
    }
    const code = character.codePointAt(0) ?? 0
    if (code < 32 || code === 0x7f) return
    this.write(character)
  }

  private csi(final: string, raw: string): void {
    // SGR colours and private mode toggles carry no text.
    if (final === 'm' || final === 'h' || final === 'l') return
    const numeric = raw.replace(/^[?!><=]/, '').split(';').map((value) => Number.parseInt(value || '1', 10))
    const arg = (index: number, fallback = 1): number => {
      const value = numeric[index]
      return Number.isFinite(value) && value > 0 ? value : fallback
    }
    const lines = this.lines
    switch (final) {
      case 'A':
        this.row = Math.max(0, this.row - arg(0))
        break
      case 'B':
        this.row += arg(0)
        this.ensureRow(this.row)
        break
      case 'C':
        this.col += arg(0)
        break
      case 'D':
        this.col = Math.max(0, this.col - arg(0))
        break
      case 'E':
        this.row += arg(0)
        this.col = 0
        this.ensureRow(this.row)
        break
      case 'F':
        this.row = Math.max(0, this.row - arg(0))
        this.col = 0
        break
      case 'G':
      case '`':
        this.col = Math.max(0, arg(0) - 1)
        break
      case 'H':
      case 'f':
        this.row = Math.max(0, arg(0) - 1)
        this.col = Math.max(0, arg(1) - 1)
        this.ensureRow(this.row)
        break
      case 'J': {
        const mode = Number.parseInt(raw || '0', 10)
        if (mode === 2 || mode === 3) {
          this.lines = ['']
          this.row = 0
          this.col = 0
        } else {
          this.eraseAfterCursor()
        }
        break
      }
      case 'K': {
        const mode = Number.parseInt(raw || '0', 10)
        if (mode === 2) {
          this.ensureRow(this.row)
          this.lines[this.row] = ''
          this.col = 0
        } else if (mode === 1) this.eraseBeforeCursor()
        else this.eraseAfterCursor()
        break
      }
      case 'L':
        lines.splice(this.row, 0, ...Array.from({ length: arg(0) }, () => ''))
        break
      case 'M':
        lines.splice(this.row, arg(0))
        break
      case 'S':
        lines.unshift(...Array.from({ length: arg(0) }, () => ''))
        break
      case 'T':
        lines.splice(0, arg(0))
        break
      default:
        break
    }
    this.trimHistory()
  }
}
