import { describe, expect, it } from 'vitest'
import {
  bollingerBands,
  calculateMacd,
  ema,
  movingAverage,
  parabolicSar,
  sma,
  volumeMovingAverage,
  type IndicatorBar,
} from './tdx'

function closeBars(values: number[]): IndicatorBar[] {
  return values.map((close, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    high: close,
    low: close,
    close,
    volume: 100 * (index + 1),
  }))
}

describe('Tongdaxin SMA / EMA / VOL', () => {
  it('leaves SMA blank until the window is full, then uses close/N', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
    expect(movingAverage(closeBars([1, 2, 3, 4]), 3)).toEqual([null, null, 2, 3])
  })

  it('seeds EMA from the first close with alpha 2/(N+1)', () => {
    // Independently: EMA(2) on [1,2,3] => 1, 5/3, 23/9
    const values = ema([1, 2, 3, 4, 5, 6, 7, 8], 2)
    expect(values[0]).toBe(1)
    expect(values[1]).toBeCloseTo(5 / 3, 12)
    expect(values[2]).toBeCloseTo(23 / 9, 12)
    expect(values[7]).toBeCloseTo(7.5002286237, 9)
  })

  it('keeps volume MA blank until the period is complete', () => {
    const bars = closeBars([1, 2, 3, 4])
    expect(volumeMovingAverage(bars, 5)).toEqual([null, null, null, null])
    expect(volumeMovingAverage(bars, 3).at(-1)).toBeCloseTo((200 + 300 + 400) / 3)
  })
})

describe('Tongdaxin MACD', () => {
  it('uses (DIF-DEA)*2 for the histogram', () => {
    const result = calculateMacd(closeBars([1, 2, 3, 4, 5, 6, 7, 8]), 3, 6, 2)
    const last = result.at(-1)!
    expect(last.dif).toBeCloseTo(1.2706512346, 9)
    expect(last.dea).toBeCloseTo(1.2190019505, 9)
    expect(last.histogram).toBeCloseTo(0.1032985682, 9)
    expect(last.histogram).toBeCloseTo((last.dif - last.dea) * 2, 12)
  })

  it('stays at zero on a constant close series', () => {
    const result = calculateMacd(closeBars(Array.from({ length: 40 }, () => 12)))
    expect(result.every((point) => point.dif === 0 && point.dea === 0 && point.histogram === 0)).toBe(true)
  })
})

describe('Tongdaxin BOLL', () => {
  it('uses SMA mid and population stdev /N', () => {
    const source = closeBars(Array.from({ length: 21 }, (_, index) => index + 1))
    const bands = bollingerBands(source, 20, 2)
    expect(bands[18].mid).toBeNull()
    expect(bands[19].mid).toBe(10.5)
    expect(bands[19].upper).toBeCloseTo(22.032562594670797, 9)
    expect(bands[19].lower).toBeCloseTo(-1.032562594670797, 9)
    expect(bands[20].mid).toBe(11.5)
    expect(bands[20].upper).toBeCloseTo(23.032562594670797, 9)
  })
})

describe('Wilder / Tongdaxin SAR', () => {
  it('projects from yesterday AF/EP and reverses onto the prior extreme', () => {
    const rising = Array.from({ length: 10 }, (_, index) => {
      const close = 10 + index
      return { date: `2026-02-${String(index + 1).padStart(2, '0')}`, high: close + 0.5, low: close - 0.5, close }
    })
    const falling = Array.from({ length: 6 }, (_, index) => {
      const close = 19 - index * 1.5
      return { date: `2026-02-${String(index + 11).padStart(2, '0')}`, high: close + 0.4, low: close - 0.9, close }
    })
    const sar = parabolicSar([...rising, ...falling], 0.02, 0.2)
    expect(sar[0]?.value).toBe(9.5)
    expect(sar[3]?.value).toBeCloseTo(9.68, 10)
    expect(sar[4]?.value).toBeCloseTo(9.9856, 10)
    expect(sar[9]?.value).toBeCloseTo(13.75959277, 7)
    expect(sar[11]?.uptrend).toBe(true)
    expect(sar[12]?.uptrend).toBe(false)
    expect(sar[12]?.value).toBeCloseTo(19.5, 10)
    expect(sar[13]?.value).toBeCloseTo(19.412, 10)
    expect(sar[15]?.value).toBeCloseTo(18.7547488, 7)
    expect(sar[15]?.uptrend).toBe(false)
  })
})
