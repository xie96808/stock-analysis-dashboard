import { afterEach, describe, expect, it, vi } from 'vitest'
import { getMarketBars } from './client'

const response = {
  instrument: {
    symbol: '001280',
    key: 'SZSE:001280',
    market: 'CN',
    exchange: 'SZSE',
    provider_symbol: 'sz001280',
    currency: 'CNY',
    name: '样例股票',
  },
  timeframe: '1d',
  adjustment: 'qfq',
  adjustment_applied: 'qfq',
  source: 'test',
  fetched_at: '2026-08-11T09:30:00+08:00',
  cached: false,
  delayed: true,
  requested_limit: 640,
  bars: [],
}

describe('market API client', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('forces a provider refresh and forwards the selected trading date', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => response,
    })
    vi.stubGlobal('fetch', fetchMock)

    await getMarketBars('SZSE:001280', {
      timeframe: '1d',
      adjustment: 'qfq',
      limit: 900,
      refresh: true,
      tradingDate: '2026-08-10',
    })

    const [url] = fetchMock.mock.calls[0] as [string]
    const parsed = new URL(url, 'http://localhost')
    expect(parsed.pathname).toBe('/api/market/bars/SZSE%3A001280')
    expect(parsed.searchParams.get('refresh')).toBe('true')
    expect(parsed.searchParams.get('trading_date')).toBe('2026-08-10')
    expect(parsed.searchParams.get('limit')).toBe('900')
  })
})
