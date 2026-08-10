import type { StockBar } from '../data/fixture'

export type ProfileRow = {
  price: number
  buy: number
  sell: number
  total: number
  inValueArea: boolean
  emphasis: boolean
}

export type VolumeProfileResult = {
  rows: ProfileRow[]
  poc: number
  vah: number
  val: number
  totalVolume: number
}

export function calculateVolumeProfile(
  bars: StockBar[],
  bins = 48,
  valueAreaRatio = 0.7,
  logarithmic = false,
): VolumeProfileResult {
  if (!bars.length) return { rows: [], poc: 0, vah: 0, val: 0, totalVolume: 0 }
  const rawLow = Math.min(...bars.map((bar) => bar.low))
  const rawHigh = Math.max(...bars.map((bar) => bar.high))
  const transform = logarithmic ? (value: number) => Math.log(Math.max(value, Number.EPSILON)) : (value: number) => value
  const inverse = logarithmic ? Math.exp : (value: number) => value
  const low = transform(rawLow)
  const high = transform(rawHigh)
  const step = Math.max((high - low) / Math.max(1, bins), Number.EPSILON)
  const totals = Array.from({ length: bins }, () => ({ buy: 0, sell: 0 }))

  bars.forEach((bar) => {
    const from = Math.max(0, Math.min(bins - 1, Math.floor((transform(bar.low) - low) / step)))
    const to = Math.max(from, Math.min(bins - 1, Math.floor((transform(bar.high) - low) / step)))
    const count = to - from + 1
    const rising = bar.close >= bar.open
    const buyRatio = rising ? 0.58 : 0.42
    for (let index = from; index <= to; index += 1) {
      totals[index].buy += bar.volume * buyRatio / count
      totals[index].sell += bar.volume * (1 - buyRatio) / count
    }
  })

  const volumes = totals.map((row) => row.buy + row.sell)
  const totalVolume = volumes.reduce((sum, value) => sum + value, 0)
  const pocIndex = volumes.reduce((best, value, index) => value > volumes[best] ? index : best, 0)
  let lower = pocIndex
  let upper = pocIndex
  let accumulated = volumes[pocIndex]
  while (accumulated < totalVolume * valueAreaRatio && (lower > 0 || upper < bins - 1)) {
    const below = lower > 0 ? volumes[lower - 1] : -1
    const above = upper < bins - 1 ? volumes[upper + 1] : -1
    if (above >= below) {
      upper += 1
      accumulated += volumes[upper]
    } else {
      lower -= 1
      accumulated += volumes[lower]
    }
  }

  const priceAt = (index: number) => inverse(low + (index + 0.5) * step)
  return {
    rows: totals.map((row, index) => ({
      price: priceAt(index),
      buy: row.buy,
      sell: row.sell,
      total: row.buy + row.sell,
      inValueArea: index >= lower && index <= upper,
      emphasis: index === pocIndex,
    })),
    poc: priceAt(pocIndex),
    vah: priceAt(upper),
    val: priceAt(lower),
    totalVolume,
  }
}
