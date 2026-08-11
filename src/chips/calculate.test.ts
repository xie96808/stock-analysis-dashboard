import { describe, expect, it } from 'vitest'
import type { StockBar } from '../data/fixture'
import { calculateChipCostEstimate } from './calculate'

const bars: StockBar[] = [
  { date: '2026-08-05', open: 9, high: 11, low: 8, close: 10, volume: 100, turnoverRate: 0.1 },
  { date: '2026-08-06', open: 10, high: 13, low: 9, close: 12, volume: 200, turnoverRate: 0.2 },
  { date: '2026-08-07', open: 12, high: 14, low: 11, close: 13, volume: 300, turnoverRate: 0.3 },
]

describe('recursive chip cost estimate', () => {
  it('conserves one unit of chips and returns ordered 70/90 intervals', () => {
    const result = calculateChipCostEstimate(bars, 13)
    expect(result.rows.reduce((sum, row) => sum + row.weight, 0)).toBeCloseTo(1, 10)
    expect(result.range90[0]).toBeLessThanOrEqual(result.range70[0])
    expect(result.range70[1]).toBeLessThanOrEqual(result.range90[1])
    expect(result.asOfDate).toBe('2026-08-07')
    expect(result.quality).toBe('turnover')
  })

  it('keeps profit ratio and concentration in valid bounds', () => {
    const result = calculateChipCostEstimate(bars, 11)
    expect(result.profitRatio).toBeGreaterThanOrEqual(0)
    expect(result.profitRatio).toBeLessThanOrEqual(1)
    expect(result.concentration70).toBeGreaterThanOrEqual(0)
    expect(result.concentration90).toBeGreaterThanOrEqual(result.concentration70)
  })

  it('retains old costs at zero turnover', () => {
    const result = calculateChipCostEstimate([
      { date: '2026-08-05', open: 10, high: 11, low: 9, close: 10, volume: 100, turnoverRate: 0.1 },
      { date: '2026-08-06', open: 30, high: 31, low: 29, close: 30, volume: 100, turnoverRate: 0 },
    ], 30)
    expect(result.averageCost).toBeLessThan(12)
  })

  it('fully replaces old costs at one hundred percent turnover', () => {
    const result = calculateChipCostEstimate([
      { date: '2026-08-05', open: 10, high: 11, low: 9, close: 10, volume: 100, turnoverRate: 0.1 },
      { date: '2026-08-06', open: 30, high: 31, low: 29, close: 30, volume: 100, turnoverRate: 1 },
    ], 30)
    expect(result.averageCost).toBeGreaterThan(28)
  })

  it('reports a proxy quality when turnover is missing', () => {
    const result = calculateChipCostEstimate(bars.map(({ turnoverRate: _turnoverRate, ...bar }) => bar), 13)
    expect(result.quality).toBe('proxy')
    expect(result.turnoverCoverage).toBe(0)
  })

  it('supports ETF-style fractional prices and provider turnover data', () => {
    const etfBars: StockBar[] = Array.from({ length: 80 }, (_, index) => {
      const close = 0.58 + Math.sin(index / 8) * 0.08 + index * 0.0015
      return {
        date: `2026-${String(4 + Math.floor(index / 28)).padStart(2, '0')}-${String(index % 28 + 1).padStart(2, '0')}`,
        open: close - 0.006,
        high: close + 0.018,
        low: close - 0.015,
        close,
        volume: 300_000_000 + index * 1_000_000,
        turnoverRate: 0.04 + index % 5 * 0.01,
      }
    })
    const result = calculateChipCostEstimate(etfBars, etfBars.at(-1)!.close)
    expect(result.quality).toBe('turnover')
    expect(result.rows.filter((row) => row.weight > 0).length).toBeGreaterThan(24)
    expect(result.averageCost).toBeGreaterThan(0.4)
    expect(result.averageCost).toBeLessThan(1.2)
  })
})
