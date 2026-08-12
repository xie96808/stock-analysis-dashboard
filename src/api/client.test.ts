import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearMarketMemoryCache, createPaperTrade, getMarketBars, getMarketQuote, searchInstruments } from './client'

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
  provider_chain: ['test'],
  fallback_used: false,
  stale: false,
  freshness_seconds: 0,
  quality_issues: [],
  bars: [],
}

describe('market API client', () => {
  afterEach(() => {
    clearMarketMemoryCache()
    vi.unstubAllGlobals()
  })

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

  it('surfaces the backend validation detail for a rejected paper trade', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ detail: '模拟账户可用资金不足' }),
    }))
    await expect(createPaperTrade({
      symbol: '001280', name: '样例股票', market: 'CN', side: 'buy', price: 1000, quantity: 1000,
    })).rejects.toThrow('模拟账户可用资金不足')
  })

  it('encodes Chinese instrument search and caps the requested suggestion count', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)

    await searchInstruments('赤峰黄金', 5)

    const [url] = fetchMock.mock.calls[0] as [string]
    const parsed = new URL(url, 'http://localhost')
    expect(parsed.pathname).toBe('/api/instruments/search')
    expect(parsed.searchParams.get('q')).toBe('赤峰黄金')
    expect(parsed.searchParams.get('limit')).toBe('5')
  })

  it('reuses recent bars and quotes while bypassing bars cache for a manual refresh', async () => {
    const quoteResponse = {
      instrument: response.instrument, last: 10, previous_close: 9, open: 9.5, high: 10, low: 9.4,
      volume: 100, timestamp: '2026-08-11', source: 'test', delayed: true, fallback_used: false, quality_issues: [],
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => response })
      .mockResolvedValueOnce({ ok: true, json: async () => quoteResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => response })
    vi.stubGlobal('fetch', fetchMock)

    const options = { timeframe: '1d' as const, adjustment: 'qfq' as const, limit: 640 }
    await getMarketBars('001280', options)
    await getMarketBars('001280', options)
    await getMarketQuote('001280')
    await getMarketQuote('001280')
    await getMarketBars('001280', { ...options, refresh: true })
    await getMarketBars('001280', options)

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retain a stale-while-revalidate response in browser memory', async () => {
    const stale = { ...response, stale: true, cached: true }
    const fresh = { ...response, stale: false, cached: false }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => stale })
      .mockResolvedValueOnce({ ok: true, json: async () => fresh })
    vi.stubGlobal('fetch', fetchMock)

    const options = { timeframe: '1d' as const, adjustment: 'qfq' as const, limit: 640 }
    expect((await getMarketBars('001280', options)).stale).toBe(true)
    expect((await getMarketBars('001280', options)).stale).toBe(false)
    await getMarketBars('001280', options)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('bypasses quote memory cache on manual refresh', async () => {
    const quoteResponse = {
      instrument: response.instrument, last: 10, previous_close: 9, open: 9.5, high: 10, low: 9.4,
      volume: 100, timestamp: '2026-08-11', source: 'test', delayed: true, fallback_used: false, quality_issues: [],
    }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => quoteResponse })
    vi.stubGlobal('fetch', fetchMock)

    await getMarketQuote('001280')
    await getMarketQuote('001280')
    await getMarketQuote('001280', undefined, true)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toContain('refresh=true')
  })
})
