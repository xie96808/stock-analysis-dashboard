import type { ChipCostEstimate } from './calculate'

export type ChipOverlayRow = {
  y: number
  price: number
  weight: number
  profitable: boolean
}

export type ChipOverlayGeometry = {
  rows: ChipOverlayRow[]
  currentY: number | null
  averageY: number | null
  scaleMode: 'chart' | 'cost'
  scaleRange: [number, number] | null
}

const isVisible = (value: number | null, paneHeight: number) => (
  value != null && Number.isFinite(value) && value >= 42 && value <= paneHeight - 4
)

/**
 * Keep the profile aligned to the chart price axis whenever that axis exposes
 * enough of the cost distribution. Minute charts can be extremely narrow;
 * in that case a labelled cost-only axis avoids collapsing an 88-bin profile
 * into one or two visible bars.
 */
export function resolveChipOverlayGeometry(
  estimate: ChipCostEstimate,
  priceToCoordinate: (price: number) => number | null,
  paneHeight: number,
  minimumVisibleRows = 8,
): ChipOverlayGeometry {
  if (!estimate.rows.length || paneHeight <= 64) {
    return { rows: [], currentY: null, averageY: null, scaleMode: 'chart', scaleRange: null }
  }

  const chartRows = estimate.rows.flatMap((row) => {
    const y = priceToCoordinate(row.price)
    return y == null || !Number.isFinite(y) ? [] : [{ ...row, y }]
  })
  const maxWeight = Math.max(...estimate.rows.map((row) => row.weight), Number.EPSILON)
  const meaningfulVisibleRows = chartRows.filter((row) => (
    row.weight >= maxWeight * 0.004 && isVisible(row.y, paneHeight)
  ))
  if (meaningfulVisibleRows.length >= minimumVisibleRows) {
    return {
      rows: chartRows,
      currentY: priceToCoordinate(estimate.currentPrice),
      averageY: priceToCoordinate(estimate.averageCost),
      scaleMode: 'chart',
      scaleRange: null,
    }
  }

  const rawLow = Math.min(estimate.range90[0], estimate.currentPrice, estimate.averageCost)
  const rawHigh = Math.max(estimate.range90[1], estimate.currentPrice, estimate.averageCost)
  const padding = Math.max((rawHigh - rawLow) * 0.08, estimate.currentPrice * 0.003, 0.001)
  const minimum = Math.max(Number.EPSILON, rawLow - padding)
  const maximum = rawHigh + padding
  const top = 52
  const bottom = Math.max(top + 12, paneHeight - 12)
  const coordinate = (price: number) => top + (maximum - price) / Math.max(maximum - minimum, Number.EPSILON) * (bottom - top)
  const rows = estimate.rows
    .filter((row) => row.price >= minimum && row.price <= maximum && row.weight >= maxWeight * 0.001)
    .map((row) => ({ ...row, y: coordinate(row.price) }))

  return {
    rows,
    currentY: coordinate(estimate.currentPrice),
    averageY: coordinate(estimate.averageCost),
    scaleMode: 'cost',
    scaleRange: [minimum, maximum],
  }
}
