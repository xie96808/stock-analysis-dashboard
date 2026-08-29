import { describe, expect, it } from 'vitest'
import { createFutureProjectionDates, futureProjectionBarCount } from './projection'

describe('futureProjectionBarCount', () => {
  it('keeps a useful but bounded projection tail on phones', () => {
    expect(futureProjectionBarCount(350)).toBe(77)
    expect(futureProjectionBarCount(200)).toBe(48)
  })

  it('preserves the desktop projection ceiling', () => {
    expect(futureProjectionBarCount(1200)).toBe(264)
    expect(futureProjectionBarCount(2000)).toBe(270)
  })

  it('falls back safely for an invalid measurement', () => {
    expect(futureProjectionBarCount(Number.NaN)).toBe(48)
  })

  it('does not let the empty tail dominate a short weekly series', () => {
    expect(futureProjectionBarCount(1200, 40)).toBe(10)
    expect(futureProjectionBarCount(1200, 12)).toBe(8)
    expect(futureProjectionBarCount(1200, 2000)).toBe(264)
  })
})

describe('createFutureProjectionDates', () => {
  it('steps weekly and monthly projection dates with the chart period', () => {
    expect(createFutureProjectionDates('2026-08-28', 3, '周K')).toEqual([
      '2026-09-04', '2026-09-11', '2026-09-18',
    ])
    expect(createFutureProjectionDates('2026-08-28', 2, '月K')).toEqual([
      '2026-09-28', '2026-10-28',
    ])
  })

  it('skips weekends on the daily runway', () => {
    expect(createFutureProjectionDates('2026-08-28', 3, '日K')).toEqual([
      '2026-08-31', '2026-09-01', '2026-09-02',
    ])
  })
})
