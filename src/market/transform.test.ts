import { describe, expect, it } from 'vitest'
import type { MarketBarsResponse } from '../api/client'
import { toIntradayPoints } from './transform'

function response(): MarketBarsResponse {
  return {
    instrument: {
      symbol: '001280', key: 'SZSE:001280', market: 'CN', exchange: 'SZSE',
      provider_symbol: 'sz001280', currency: 'CNY', name: '测试',
    },
    timeframe: '1m', adjustment: 'none', adjustment_applied: 'none',
    source: 'test', fetched_at: '2026-08-11T00:00:00Z', cached: false, delayed: true, requested_limit: 2,
    provider_chain: ['test'], fallback_used: false, stale: false, freshness_seconds: 0, quality_issues: [],
    bars: [
      { time: '2026-08-11 09:30', open: 10, high: 11, low: 9, close: 10, volume: 100, amount: 1_050, turnover_rate: null },
      { time: '2026-08-11 09:31', open: 10, high: 12, low: 10, close: 12, volume: 100, amount: 1_150, turnover_rate: null },
    ],
  }
}

describe('market transforms', () => {
  it('uses provider amount for the intraday VWAP line when available', () => {
    const points = toIntradayPoints(response())
    expect(points[0].average).toBeCloseTo(10.5)
    expect(points[1].average).toBeCloseTo(11)
  })
})
