import { describe, expect, it } from 'vitest'
import { formatPrice, priceFractionDigits } from './priceFormat'

describe('priceFractionDigits', () => {
  it('uses 3 digits for HK and CN funds, 2 for A-share stocks', () => {
    expect(priceFractionDigits('00700', 'HK')).toBe(3)
    expect(priceFractionDigits('159180', 'CN')).toBe(3)
    expect(priceFractionDigits('562310', 'CN')).toBe(3)
    expect(priceFractionDigits('600519', 'CN')).toBe(2)
    expect(formatPrice(1.014, '159180', 'CN')).toBe('1.014')
    expect(formatPrice(0.875, '00533', 'HK')).toBe('0.875')
    expect(formatPrice(12.64, '300719', 'CN')).toBe('12.64')
  })
})
