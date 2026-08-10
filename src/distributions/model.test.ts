import { describe, expect, it } from 'vitest'
import { distributionVisibility, resolveChipAsOfDate, type DistributionMode } from './model'

describe('distribution visibility', () => {
  it('never exposes volume and chips at the same time', () => {
    for (const mode of ['volume', 'chips', 'hidden'] satisfies DistributionMode[]) {
      for (const clean of [false, true]) {
        const result = distributionVisibility(mode, clean, 'CN')
        expect(Number(result.volume) + Number(result.chips)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('keeps chips A-share only and makes clean mode authoritative', () => {
    expect(distributionVisibility('chips', false, 'HK')).toEqual({ volume: false, chips: false })
    expect(distributionVisibility('volume', true, 'CN')).toEqual({ volume: false, chips: false })
  })
})

describe('chip as-of date', () => {
  const dates = ['2026-08-05', '2026-08-06', '2026-08-07', '2026-08-10']

  it('defaults to latest and honors an explicit historical date', () => {
    expect(resolveChipAsOfDate(dates, null, null)).toBe('2026-08-10')
    expect(resolveChipAsOfDate(dates, '2026-08-06', null)).toBe('2026-08-06')
  })

  it('chooses the prior trading day for a non-trading cutoff', () => {
    expect(resolveChipAsOfDate(dates, '2026-08-09', null)).toBe('2026-08-07')
  })

  it('keeps a historical-view cutoff authoritative without any visible-range input', () => {
    expect(resolveChipAsOfDate(dates, '2026-08-10', '2026-08-06')).toBe('2026-08-06')
  })
})
