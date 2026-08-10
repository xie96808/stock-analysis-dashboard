import type { StockBar } from '../data/fixture'

export type ChipRow = { price: number; weight: number; profitable: boolean }

export type ChipCostEstimate = {
  rows: ChipRow[]
  averageCost: number
  profitRatio: number
  range70: [number, number]
  range90: [number, number]
}

function weightedQuantile(rows: ChipRow[], quantile: number) {
  const target = rows.reduce((sum, row) => sum + row.weight, 0) * quantile
  let accumulated = 0
  for (const row of rows) {
    accumulated += row.weight
    if (accumulated >= target) return row.price
  }
  return rows.at(-1)?.price ?? 0
}

export function calculateChipCostEstimate(bars: StockBar[], currentPrice: number, bins = 36): ChipCostEstimate {
  if (!bars.length) return { rows: [], averageCost: 0, profitRatio: 0, range70: [0, 0], range90: [0, 0] }
  const low = Math.min(...bars.map((bar) => bar.low))
  const high = Math.max(...bars.map((bar) => bar.high))
  const step = Math.max((high - low) / bins, Number.EPSILON)
  const weights = Array.from({ length: bins }, () => 0)
  const volumeScale = Math.max(...bars.map((bar) => bar.volume), 1)
  bars.forEach((bar, index) => {
    const age = bars.length - 1 - index
    const recency = Math.exp(-age / 80)
    const turnoverProxy = Math.min(1, bar.volume / volumeScale)
    const retention = recency * (0.35 + turnoverProxy * 0.65)
    const from = Math.max(0, Math.min(bins - 1, Math.floor((bar.low - low) / step)))
    const to = Math.max(from, Math.min(bins - 1, Math.floor((bar.high - low) / step)))
    for (let bin = from; bin <= to; bin += 1) weights[bin] += retention * bar.volume / (to - from + 1)
  })
  const rows = weights.map((weight, index) => ({ price: low + (index + 0.5) * step, weight, profitable: low + (index + 0.5) * step <= currentPrice }))
  const total = rows.reduce((sum, row) => sum + row.weight, 0)
  const averageCost = total ? rows.reduce((sum, row) => sum + row.price * row.weight, 0) / total : 0
  const profitRatio = total ? rows.filter((row) => row.profitable).reduce((sum, row) => sum + row.weight, 0) / total : 0
  return {
    rows,
    averageCost,
    profitRatio,
    range70: [weightedQuantile(rows, 0.15), weightedQuantile(rows, 0.85)],
    range90: [weightedQuantile(rows, 0.05), weightedQuantile(rows, 0.95)],
  }
}
