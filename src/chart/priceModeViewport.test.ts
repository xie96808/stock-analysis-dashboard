import { describe, expect, it } from 'vitest'
import { preservePriceModeViewport } from './priceModeViewport'

describe('price mode viewport', () => {
  it('keeps the exact zoomed logical range when changing price coordinates', () => {
    expect(preservePriceModeViewport({ from: 235.2098, to: 375.3632 })).toEqual({
      from: 235.2098,
      to: 375.3632,
    })
  })

  it('rejects invalid ranges instead of scrolling to the last future whitespace bar', () => {
    expect(preservePriceModeViewport(null)).toBeNull()
    expect(preservePriceModeViewport({ from: 10, to: 10 })).toBeNull()
    expect(preservePriceModeViewport({ from: Number.NaN, to: 20 })).toBeNull()
  })
})
