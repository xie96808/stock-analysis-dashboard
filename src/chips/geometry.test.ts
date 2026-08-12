import { describe, expect, it } from 'vitest'
import type { ChipCostEstimate } from './calculate'
import { resolveChipOverlayGeometry } from './geometry'

function estimate(): ChipCostEstimate {
  const rows = Array.from({ length: 88 }, (_, index) => ({
    price: 50 + index,
    weight: 1 / 88,
    profitable: index <= 24,
  }))
  return {
    rows,
    averageCost: 86,
    profitRatio: 0.4,
    range70: [65, 105],
    range90: [55, 125],
    concentration70: 0.2,
    concentration90: 0.4,
    poc: 75,
    asOfDate: '2026-08-11',
    currentPrice: 74,
    turnoverCoverage: 1,
    quality: 'turnover',
  }
}

describe('chip overlay geometry', () => {
  it('uses a labelled cost axis when a narrow minute scale exposes too few rows', () => {
    const result = resolveChipOverlayGeometry(estimate(), (price) => 300 - (price - 72) * 80, 600)
    expect(result.scaleMode).toBe('cost')
    expect(result.scaleRange).not.toBeNull()
    expect(result.rows.length).toBeGreaterThan(20)
    expect(result.rows.every((row) => row.y >= 52 && row.y <= 588)).toBe(true)
  })

  it('keeps chart-price alignment when the daily scale exposes enough rows', () => {
    const result = resolveChipOverlayGeometry(estimate(), (price) => 560 - (price - 50) * 5, 600)
    expect(result.scaleMode).toBe('chart')
    expect(result.scaleRange).toBeNull()
    expect(result.rows).toHaveLength(88)
  })
})
