// Resolve an Even list/selection event to a real row. Text-only layouts have
// no native list, so the host can send a stale index or an unmatched label;
// falling back to the app's own selection keeps taps (especially Send) working.

export interface LabelledRow {
  label: string
}

function normalise(label: string): string {
  return label.trim().replace(/^[▶>›•\s]+/, '').replace(/\s+/g, ' ').toLowerCase()
}

export function resolveTapIndex<Row extends LabelledRow>(
  rows: readonly Row[],
  selectName: string | undefined,
  selectIndex: number | undefined,
  selectedRow: number,
): number {
  if (!rows.length) return -1
  const byName = selectName ? rows.findIndex((row) => normalise(row.label) === normalise(selectName)) : -1
  const candidate = typeof selectIndex === 'number' && Number.isFinite(selectIndex)
    ? Math.trunc(selectIndex)
    : byName
  if (candidate >= 0 && candidate < rows.length) return candidate
  const fallback = Math.min(Math.max(0, selectedRow), rows.length - 1)
  return fallback
}
