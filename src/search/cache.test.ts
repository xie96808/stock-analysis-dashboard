import { afterEach, describe, expect, it } from 'vitest'
import type { InstrumentSuggestion } from '../api/client'
import { cacheSuggestions, clearSuggestionCache, getCachedSuggestions, normalizeSearchQuery } from './cache'

const result: InstrumentSuggestion = {
  input: 'sh600000', symbol: '600000', name: '浦发银行', market: 'CN', exchange: 'SSE', provider_symbol: 'sh600000', asset_type: 'stock',
}

describe('instrument search cache', () => {
  afterEach(clearSuggestionCache)

  it('normalizes spaces and case for immediate repeat searches', () => {
    expect(normalizeSearchQuery('  SH600000 ')).toBe('sh600000')
    cacheSuggestions('SH600000', [result], 1_000)
    expect(getCachedSuggestions(' sh600000 ', 2_000)).toEqual([result])
  })

  it('expires old suggestions', () => {
    cacheSuggestions('浦发', [result], 1_000)
    expect(getCachedSuggestions('浦发', 1_000 + 10 * 60_000 + 1)).toBeNull()
  })
})
