import { describe, expect, it } from 'vitest'
import { bollingerBands, calculateMacd, movingAverage, parabolicSar, type StockBar } from './fixture'

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

  it('keeps Bollinger mid identical to SMA20 and bands symmetric', () => {
    const source = bars([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21])
    const sma = movingAverage(source, 20)
    const bands = bollingerBands(source, 20, 2)
    expect(bands[18].mid).toBeNull()
    expect(bands[19].mid).toBe(sma[19])
    expect(bands[20].upper! - bands[20].mid!).toBeCloseTo(bands[20].mid! - bands[20].lower!)
  })

  it('keeps parabolic SAR below price in a rising series', () => {
    const source = Array.from({ length: 8 }, (_, index) => {
      const close = 10 + index
      return { date: `2026-08-0${index + 1}`, open: close, high: close + 0.5, low: close - 0.5, close, volume: 100 }
    })
    const sar = parabolicSar(source, 0.02, 0.2)
    const last = sar.at(-1)
    expect(last).not.toBeNull()
    expect(last!.uptrend).toBe(true)
    expect(last!.value).toBeLessThan(source.at(-1)!.low)
  })
})
