import { describe, expect, it } from 'vitest'
import type { StockBar } from '../data/fixture'
import { calculateVolumeProfile } from './calculate'

const bars: StockBar[] = [
  { date: '2026-08-06', open: 10, high: 12, low: 9, close: 11, volume: 100 },
  { date: '2026-08-07', open: 11, high: 13, low: 10, close: 12, volume: 200 },
]

describe('volume profile', () => {
  it('preserves total volume while distributing bars over price bins', () => {
    const profile = calculateVolumeProfile(bars, 8)
    expect(profile.totalVolume).toBeCloseTo(300)
    expect(profile.rows.reduce((sum, row) => sum + row.total, 0)).toBeCloseTo(300)
  })

  it('returns ordered VAL/POC/VAH and marks exactly one POC row', () => {
    const profile = calculateVolumeProfile(bars, 8, 0.7)
    expect(profile.val).toBeLessThanOrEqual(profile.poc)
    expect(profile.vah).toBeGreaterThanOrEqual(profile.poc)
    expect(profile.rows.filter((row) => row.emphasis)).toHaveLength(1)
  })

  it('supports logarithmic price bins without exposing log values as labels', () => {
    const profile = calculateVolumeProfile(bars, 8, 0.7, true)
    expect(profile.rows[0].price).toBeGreaterThan(8)
    expect(profile.rows.at(-1)?.price).toBeLessThan(14)
  })
})
