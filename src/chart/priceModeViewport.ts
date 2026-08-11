export type LogicalViewport = { from: number; to: number }

export function preservePriceModeViewport(range: LogicalViewport | null): LogicalViewport | null {
  if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to <= range.from) return null
  return { from: range.from, to: range.to }
}
