import type { StockBar } from '../data/fixture'

export type ChipCostQuality = 'turnover' | 'mixed' | 'proxy'

export type ChipRow = {
  price: number
  /** Normalized share of all estimated chips; all rows sum to one. */
  weight: number
  profitable: boolean
}

export type ChipCostEstimate = {
  rows: ChipRow[]
  averageCost: number
  profitRatio: number
  range70: [number, number]
  range90: [number, number]
  concentration70: number
  concentration90: number
  poc: number
  asOfDate: string
  currentPrice: number
  turnoverCoverage: number
  quality: ChipCostQuality
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))

function weightedQuantile(rows: ChipRow[], quantile: number) {
  const target = rows.reduce((sum, row) => sum + row.weight, 0) * quantile
  let accumulated = 0
  for (const row of rows) {
    accumulated += row.weight
    if (accumulated >= target) return row.price
  }
  return rows.at(-1)?.price ?? 0
}

function concentration([low, high]: [number, number]) {
  const denominator = high + low
  return denominator > 0 ? (high - low) / denominator : 0
}

function dailyCostDistribution(bar: StockBar, minimum: number, step: number, bins: number) {
  const distribution = Array.from({ length: bins }, () => 0)
  const low = Math.min(bar.low, bar.high)
  const high = Math.max(bar.low, bar.high)
  const rawAverage = bar.amount != null && bar.amount > 0 && bar.volume > 0
    ? bar.amount / bar.volume
    : (bar.high + bar.low + bar.close) / 3
  const average = clamp(Number.isFinite(rawAverage) ? rawAverage : bar.close, low, high)
  const from = clamp(Math.floor((low - minimum) / step), 0, bins - 1)
  const to = clamp(Math.floor((high - minimum) / step), from, bins - 1)
  const radius = Math.max(average - low, high - average, step)

  let total = 0
  for (let index = from; index <= to; index += 1) {
    const price = minimum + (index + 0.5) * step
    // A small uniform component avoids pretending daily OHLC data knows the
    // exact intraday path; the triangular component centres cost near VWAP or
    // the typical price when daily amount is unavailable.
    const triangular = Math.max(0, 1 - Math.abs(price - average) / radius)
    const score = 0.18 + triangular * 0.82
    distribution[index] = score
    total += score
  }

  if (total <= 0) {
    distribution[clamp(Math.round((bar.close - minimum) / step), 0, bins - 1)] = 1
    return distribution
  }
  return distribution.map((value) => value / total)
}

function fallbackTurnover(bar: StockBar, maximumVolume: number) {
  if (bar.volume <= 0) return 0
  const relativeVolume = clamp(bar.volume / Math.max(maximumVolume, 1), 0, 1)
  return 0.01 + relativeVolume * 0.07
}

/**
 * Estimate the remaining market cost distribution as of the final supplied
 * daily bar.  The model conserves one unit of chips and recursively replaces
 * old cost with each session's new cost according to turnover:
 *
 *   chips[t] = chips[t-1] * (1 - turnover[t]) + daily[t] * turnover[t]
 *
 * Missing turnover uses an explicit, reported proxy so callers can label the
 * result as degraded rather than silently implying provider-grade precision.
 */
export function calculateChipCostEstimate(bars: StockBar[], currentPrice: number, binCount = 88): ChipCostEstimate {
  const usableBars = bars.filter((bar) => (
    Number.isFinite(bar.low)
    && Number.isFinite(bar.high)
    && Number.isFinite(bar.close)
    && bar.low > 0
    && bar.high > 0
  ))
  if (!usableBars.length) {
    return {
      rows: [], averageCost: 0, profitRatio: 0, range70: [0, 0], range90: [0, 0],
      concentration70: 0, concentration90: 0, poc: 0, asOfDate: '', currentPrice: 0,
      turnoverCoverage: 0, quality: 'proxy',
    }
  }

  const bins = clamp(Math.round(binCount), 24, 180)
  const rawLow = Math.min(...usableBars.map((bar) => bar.low))
  const rawHigh = Math.max(...usableBars.map((bar) => bar.high))
  const padding = rawHigh === rawLow ? Math.max(rawLow * 0.01, 0.01) : 0
  const minimum = Math.max(Number.EPSILON, rawLow - padding)
  const maximum = rawHigh + padding
  const step = Math.max((maximum - minimum) / bins, Number.EPSILON)
  const maximumVolume = Math.max(...usableBars.map((bar) => bar.volume), 1)
  let weights = Array.from({ length: bins }, () => 0)
  let initialized = false
  let turnoverBars = 0

  usableBars.forEach((bar) => {
    const daily = dailyCostDistribution(bar, minimum, step, bins)
    if (!initialized) {
      weights = daily
      initialized = true
      return
    }

    const hasTurnover = bar.turnoverRate != null && Number.isFinite(bar.turnoverRate) && bar.turnoverRate >= 0
    if (hasTurnover) turnoverBars += 1
    const replacement = bar.volume <= 0
      ? 0
      : clamp(hasTurnover ? bar.turnoverRate! : fallbackTurnover(bar, maximumVolume), 0, 1)
    weights = weights.map((weight, index) => weight * (1 - replacement) + daily[index] * replacement)

    const total = weights.reduce((sum, value) => sum + value, 0)
    if (total > 0) weights = weights.map((value) => value / total)
  })

  const price = currentPrice > 0 ? currentPrice : usableBars.at(-1)!.close
  const rows = weights.map((weight, index) => {
    const rowPrice = minimum + (index + 0.5) * step
    return { price: rowPrice, weight, profitable: rowPrice <= price }
  })
  const total = rows.reduce((sum, row) => sum + row.weight, 0)
  const averageCost = total ? rows.reduce((sum, row) => sum + row.price * row.weight, 0) / total : 0
  const profitRatio = total ? rows.filter((row) => row.profitable).reduce((sum, row) => sum + row.weight, 0) / total : 0
  const range70: [number, number] = [weightedQuantile(rows, 0.15), weightedQuantile(rows, 0.85)]
  const range90: [number, number] = [weightedQuantile(rows, 0.05), weightedQuantile(rows, 0.95)]
  const eligibleTurnoverBars = Math.max(0, usableBars.length - 1)
  const turnoverCoverage = eligibleTurnoverBars ? turnoverBars / eligibleTurnoverBars : 0
  const quality: ChipCostQuality = turnoverCoverage >= 0.999 ? 'turnover' : turnoverCoverage > 0 ? 'mixed' : 'proxy'
  const poc = rows.reduce((best, row) => row.weight > best.weight ? row : best, rows[0]).price

  return {
    rows,
    averageCost,
    profitRatio,
    range70,
    range90,
    concentration70: concentration(range70),
    concentration90: concentration(range90),
    poc,
    asOfDate: usableBars.at(-1)!.date.slice(0, 10),
    currentPrice: price,
    turnoverCoverage,
    quality,
  }
}
