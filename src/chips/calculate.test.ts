import { describe, expect, it } from 'vitest'
import type { StockBar } from '../data/fixture'
import { calculateChipCostEstimate } from './calculate'

const bars: StockBar[] = [
  { date: '2026-08-05', open: 9, high: 11, low: 8, close: 10, volume: 100 },
  { date: '2026-08-06', open: 10, high: 13, low: 9, close: 12, volume: 200 },
  { date: '2026-08-07', open: 12, high: 14, low: 11, close: 13, volume: 300 },
]

describe('chip cost estimate', () => {
  it('returns ordered 70/90 percent cost intervals', () => {
    const result = calculateChipCostEstimate(bars, 13)
    expect(result.range90[0]).toBeLessThanOrEqual(result.range70[0])
    expect(result.range70[1]).toBeLessThanOrEqual(result.range90[1])
  })

  it('keeps profit ratio between zero and one', () => {
    const result = calculateChipCostEstimate(bars, 11)
    expect(result.profitRatio).toBeGreaterThanOrEqual(0)
    expect(result.profitRatio).toBeLessThanOrEqual(1)
    expect(result.averageCost).toBeGreaterThan(8)
  })
})
