import { describe, expect, it } from 'vitest'
import { calculateMacd, movingAverage, type StockBar } from './fixture'

function bars(values: number[]): StockBar[] {
  return values.map((close, index) => ({
    date: `2026-08-${String(index + 1).padStart(2, '0')}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 100,
  }))
}

describe('indicator calculations', () => {
  it('calculates an SMA only after the requested window is complete', () => {
    expect(movingAverage(bars([1, 2, 3, 4]), 3)).toEqual([null, null, 2, 3])
  })

  it('keeps MACD at zero for a constant close series', () => {
    const result = calculateMacd(bars(Array.from({ length: 40 }, () => 12)), 12, 26, 9)
    expect(result.every((point) => point.dif === 0 && point.dea === 0 && point.histogram === 0)).toBe(true)
  })

  it('honours edited MACD periods', () => {
    const source = bars([1, 2, 3, 4, 5, 6, 7, 8])
    const standard = calculateMacd(source)
    const edited = calculateMacd(source, 3, 6, 2)
    expect(edited.at(-1)?.dif).not.toBeCloseTo(standard.at(-1)?.dif ?? 0)
  })
})
