import { afterEach, describe, expect, it, vi } from 'vitest'
import { rememberRecentInstrument, resetLocalInstrumentIndexForTests, searchLocalInstruments } from './localIndex'

const instruments = [
  { input: 'sh600028', symbol: '600028', name: '中国石化', market: 'CN', exchange: 'SSE', provider_symbol: 'sh600028', asset_type: 'stock' },
  { input: 'sh601857', symbol: '601857', name: '中国石油', market: 'CN', exchange: 'SSE', provider_symbol: 'sh601857', asset_type: 'stock' },
  { input: 'sh516080', symbol: '516080', name: '创新药ETF易方达', market: 'CN', exchange: 'SSE', provider_symbol: 'sh516080', asset_type: 'etf' },
  { input: 'sh516010', symbol: '516010', name: '游戏ETF', market: 'CN', exchange: 'SSE', provider_symbol: 'sh516010', asset_type: 'etf' },
] as const

describe('local instrument index', () => {
  afterEach(() => {
    resetLocalInstrumentIndexForTests()
    vi.unstubAllGlobals()
  })

  it('loads the index once and ranks code/name prefixes locally', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => instruments })
    vi.stubGlobal('fetch', fetchMock)
    expect((await searchLocalInstruments('中国', 5)).map((item) => item.name)).toEqual(['中国石化', '中国石油'])
    expect((await searchLocalInstruments('5160', 5)).map((item) => item.symbol)).toEqual(['516010', '516080'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses recent instruments to break equal-rank ties', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => instruments }))
    rememberRecentInstrument(instruments[1])
    expect((await searchLocalInstruments('中国', 5))[0].symbol).toBe('601857')
  })
})
