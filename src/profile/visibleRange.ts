import type { BusinessDay, Time } from 'lightweight-charts'
import type { StockBar } from '../data/fixture'

type TimeRange = { from: Time; to: Time }

function isBusinessDay(value: Time): value is BusinessDay {
  return typeof value === 'object' && value != null && 'year' in value
}

function timeValue(value: Time): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') return Date.parse(value) / 1000
  if (isBusinessDay(value)) return Date.UTC(value.year, value.month - 1, value.day) / 1000
  return Number.NaN
}

function barTimeValue(date: string): number {
  if (date.includes(' ')) return new Date(`${date.replace(' ', 'T')}:00+08:00`).getTime() / 1000
  const [year, month, day] = date.slice(0, 10).split('-').map(Number)
  return Date.UTC(year, month - 1, day) / 1000
}

export function barsInVisibleTimeRange(bars: StockBar[], range: TimeRange | null): StockBar[] {
  if (!range) return bars
  const from = timeValue(range.from)
  const to = timeValue(range.to)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return []
  const lower = Math.min(from, to)
  const upper = Math.max(from, to)
  return bars.filter((bar) => {
    const value = barTimeValue(bar.date)
    return value >= lower && value <= upper
  })
}
