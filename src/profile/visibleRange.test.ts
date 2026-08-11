import { describe, expect, it } from 'vitest'
import type { UTCTimestamp } from 'lightweight-charts'
import type { StockBar } from '../data/fixture'
import { barsInVisibleTimeRange } from './visibleRange'

function bar(date: string): StockBar {
  return { date, open: 10, high: 11, low: 9, close: 10, volume: 100 }
}

describe('visible profile source', () => {
  it('selects daily bars by visible dates instead of logical indexes', () => {
    const bars = [bar('2026-06-01'), bar('2026-07-01'), bar('2026-08-01')]
    expect(barsInVisibleTimeRange(bars, {
      from: { year: 2026, month: 6, day: 15 },
      to: { year: 2026, month: 8, day: 10 },
    }).map((item) => item.date)).toEqual(['2026-07-01', '2026-08-01'])
  })

  it('selects minute bars with timestamp ranges', () => {
    const bars = [bar('2026-08-11 09:30'), bar('2026-08-11 10:00'), bar('2026-08-11 10:30')]
    const timestamp = (value: string) => Math.floor(new Date(`${value.replace(' ', 'T')}:00+08:00`).getTime() / 1000) as UTCTimestamp
    expect(barsInVisibleTimeRange(bars, {
      from: timestamp('2026-08-11 09:45'),
      to: timestamp('2026-08-11 10:15'),
    }).map((item) => item.date)).toEqual(['2026-08-11 10:00'])
  })

  it('returns no historical bars when the viewport contains only future whitespace', () => {
    expect(barsInVisibleTimeRange([bar('2026-08-11')], {
      from: { year: 2027, month: 1, day: 1 },
      to: { year: 2027, month: 2, day: 1 },
    })).toEqual([])
  })
})
