export type StockBar = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount?: number | null
  /** Decimal fraction: 0.023 means a 2.3% turnover rate. */
  turnoverRate?: number | null
}

export type IntradayPoint = {
  timestamp: number
  price: number
  average: number
  volume: number
}

const DAY = 86_400_000

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

function tradingDates(start: string, end: string) {
  const dates: string[] = []
  const cursor = new Date(`${start}T00:00:00+08:00`)
  const final = new Date(`${end}T00:00:00+08:00`)

  while (cursor <= final) {
    const day = cursor.getDay()
    if (day !== 0 && day !== 6) {
      dates.push([
        cursor.getFullYear(),
        String(cursor.getMonth() + 1).padStart(2, '0'),
        String(cursor.getDate()).padStart(2, '0'),
      ].join('-'))
    }
    cursor.setTime(cursor.getTime() + DAY)
  }

  return dates
}

function targetPrice(progress: number) {
  const knots = [
    [0, 63.4],
    [0.12, 65.5],
    [0.2, 96.5],
    [0.31, 89.5],
    [0.42, 76.5],
    [0.52, 84.8],
    [0.61, 73.2],
    [0.72, 66.8],
    [0.82, 58.2],
    [0.91, 61.2],
    [1, 65.38],
  ]

  for (let index = 1; index < knots.length; index += 1) {
    const left = knots[index - 1]
    const right = knots[index]
    if (progress <= right[0]) {
      const local = (progress - left[0]) / (right[0] - left[0])
      return left[1] + (right[1] - left[1]) * local
    }
  }

  return knots.at(-1)?.[1] ?? 65.38
}

export function createFixtureBars() {
  const dates = tradingDates('2025-11-03', '2026-08-07')
  const random = mulberry32(12_800)
  let previous = 63.2

  const bars = dates.map((date, index): StockBar => {
    const progress = index / Math.max(dates.length - 1, 1)
    const baseline = targetPrice(progress)
    const cycle = Math.sin(index * 0.71) * 1.4 + Math.sin(index * 0.19) * 0.8
    const noise = (random() - 0.5) * 2.6
    const close = Math.max(12, baseline + cycle + noise)
    const open = previous + (random() - 0.5) * 2.2
    const spread = 0.7 + random() * (progress > 0.15 && progress < 0.34 ? 4.5 : 2.2)
    const high = Math.max(open, close) + spread * (0.35 + random() * 0.65)
    const low = Math.min(open, close) - spread * (0.35 + random() * 0.65)
    const activity = 1 + Math.abs(close - open) * 0.32 + (progress > 0.15 && progress < 0.34 ? 1.5 : 0)
    const volume = Math.round((3_500_000 + random() * 3_800_000) * activity)
    previous = close

    return {
      date,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume,
      amount: close * volume,
      turnoverRate: Math.min(volume / 420_000_000, 1),
    }
  })

  if (bars.length >= 2) {
    bars[bars.length - 2] = {
      ...bars[bars.length - 2],
      open: 63.86,
      high: 65.08,
      low: 63.42,
      close: 64.77,
      volume: 7_960_000,
      amount: 64.77 * 7_960_000,
      turnoverRate: 7_960_000 / 420_000_000,
    }
    bars[bars.length - 1] = {
      date: '2026-08-07',
      open: 64.76,
      high: 66.7,
      low: 64.66,
      close: 65.38,
      volume: 9_080_000,
      amount: 65.38 * 9_080_000,
      turnoverRate: 9_080_000 / 420_000_000,
    }
  }

  return bars
}

export function createFutureDates() {
  return tradingDates('2026-08-10', '2027-01-08')
}

import {
  ema,
  movingAverage,
  calculateMacd,
  bollingerBands,
  parabolicSar,
  type MacdPoint,
  type BollingerPoint,
  type SarPoint,
} from '../indicators/tdx'

export {
  ema,
  movingAverage,
  calculateMacd,
  bollingerBands,
  parabolicSar,
  type MacdPoint,
  type BollingerPoint,
  type SarPoint,
}

export function createIntradayFixture(bar: StockBar): IntradayPoint[] {
  const seed = Number(bar.date.replaceAll('-', ''))
  const random = mulberry32(seed)
  const sessionMinutes = [
    ...Array.from({ length: 121 }, (_, index) => 9 * 60 + 30 + index),
    ...Array.from({ length: 121 }, (_, index) => 13 * 60 + index),
  ]
  let price = bar.open
  let cumulativeValue = 0
  let cumulativeVolume = 0

  return sessionMinutes.map((minuteOfDay, index) => {
    const progress = index / Math.max(sessionMinutes.length - 1, 1)
    const target = bar.open + (bar.close - bar.open) * progress
    const wave = Math.sin(progress * Math.PI * 3.4) * (bar.high - bar.low) * 0.12
    price += (target + wave - price) * 0.2 + (random() - 0.5) * (bar.high - bar.low) * 0.045
    if (index === 42) price = Math.min(bar.high, price + (bar.high - bar.open) * 0.72)
    if (index === 166) price = Math.max(bar.low, price - (bar.open - bar.low) * 0.74)
    price = Math.min(bar.high, Math.max(bar.low, price))
    if (index === sessionMinutes.length - 1) price = bar.close

    const hour = Math.floor(minuteOfDay / 60)
    const minute = minuteOfDay % 60
    const timestamp = Math.floor(new Date(`${bar.date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`).getTime() / 1000)
    const sessionEdge = index < 18 || index > sessionMinutes.length - 22 ? 1.8 : 1
    const volume = Math.round((bar.volume / sessionMinutes.length) * (0.45 + random() * 1.1) * sessionEdge)
    cumulativeValue += price * volume
    cumulativeVolume += volume

    return {
      timestamp,
      price: Number(price.toFixed(3)),
      average: Number((cumulativeValue / Math.max(cumulativeVolume, 1)).toFixed(3)),
      volume,
    }
  })
}

export const fixtureBars = createFixtureBars()
export const futureDates = createFutureDates()
export const fixtureMacd = calculateMacd(fixtureBars)

export const profileRows = [
  { price: 101.8, sell: 6, buy: 8 },
  { price: 98.2, sell: 12, buy: 15 },
  { price: 94.5, sell: 29, buy: 36 },
  { price: 91.8, sell: 34, buy: 39 },
  { price: 88.6, sell: 25, buy: 31 },
  { price: 85.5, sell: 42, buy: 40 },
  { price: 82.4, sell: 39, buy: 44 },
  { price: 79.6, sell: 25, buy: 27 },
  { price: 76.8, sell: 18, buy: 21 },
  { price: 73.4, sell: 32, buy: 37 },
  { price: 70.2, sell: 20, buy: 28 },
  { price: 67.6, sell: 31, buy: 34 },
  { price: 64.78, sell: 52, buy: 58, emphasis: true },
  { price: 62.5, sell: 41, buy: 48 },
  { price: 59.63, sell: 34, buy: 27 },
  { price: 56.8, sell: 5, buy: 7 },
]
