export function futureProjectionBarCount(chartWidth: number, realBarCount?: number) {
  if (!Number.isFinite(chartWidth)) return 48
  const byWidth = Math.max(48, Math.min(270, Math.round(chartWidth * 0.22)))
  if (realBarCount == null || !Number.isFinite(realBarCount) || realBarCount <= 0) return byWidth
  // Weekly/monthly histories are short; a 270-bar daily tail would crush
  // real candles into a sliver after fitContent(). Cap the empty runway
  // against the actual series length so 适应画面 still fills the pane.
  return Math.min(byWidth, Math.max(8, Math.round(realBarCount * 0.25)))
}

export function projectionPeriod(timeframe: string): 'day' | 'week' | 'month' {
  if (timeframe === '1w' || timeframe === '周K') return 'week'
  if (timeframe === '1M' || timeframe === '月K') return 'month'
  return 'day'
}

function addUtcMonths(date: Date, months: number) {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + months
  const day = date.getUTCDate()
  const next = new Date(Date.UTC(year, month, 1))
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()
  next.setUTCDate(Math.min(day, lastDay))
  return next
}

export function createFutureProjectionDates(after: string, count: number, timeframe: string) {
  const period = projectionPeriod(timeframe)
  const cursor = new Date(`${after.slice(0, 10)}T00:00:00Z`)
  const values: string[] = []
  while (values.length < count) {
    if (period === 'week') cursor.setUTCDate(cursor.getUTCDate() + 7)
    else if (period === 'month') {
      const next = addUtcMonths(cursor, 1)
      cursor.setTime(next.getTime())
    } else {
      cursor.setUTCDate(cursor.getUTCDate() + 1)
      const weekday = cursor.getUTCDay()
      if (weekday === 0 || weekday === 6) continue
    }
    values.push(cursor.toISOString().slice(0, 10))
  }
  return values
}
