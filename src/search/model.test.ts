import { describe, expect, it } from 'vitest'
import { isCompleteMarketSymbol } from './model'

describe('instrument search input', () => {
  it('distinguishes complete codes from code prefixes and names', () => {
    expect(isCompleteMarketSymbol('301095')).toBe(true)
    expect(isCompleteMarketSymbol('00700')).toBe(true)
    expect(isCompleteMarketSymbol('sh516080')).toBe(true)
    expect(isCompleteMarketSymbol('600988.SH')).toBe(true)
    expect(isCompleteMarketSymbol('5160')).toBe(false)
    expect(isCompleteMarketSymbol('赤峰黄金')).toBe(false)
  })
})
