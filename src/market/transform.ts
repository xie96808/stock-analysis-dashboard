import type { MarketBarsResponse } from '../api/client'
import type { IntradayPoint, StockBar } from '../data/fixture'

export function toStockBars(response: MarketBarsResponse): StockBar[] {
  return response.bars.map((bar) => ({
    date: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
    amount: bar.amount,
    turnoverRate: bar.turnover_rate,
  }))
}

export function barTurnover(bar: { close: number; volume: number; amount?: number | null }) {
  const fromPrice = bar.close * bar.volume
  const amount = bar.amount
  if (amount == null || amount <= 0 || bar.volume <= 0) return fromPrice
  const implied = amount / bar.volume
  if (implied < bar.close * 0.2 || implied > bar.close * 5) return fromPrice
  return amount
}

export function toIntradayPoints(response: MarketBarsResponse): IntradayPoint[] {
  let cumulativeValue = 0
  let cumulativeVolume = 0
  return response.bars.map((bar) => {
    const timestamp = Math.floor(new Date(`${bar.time.replace(' ', 'T')}:00+08:00`).getTime() / 1000)
    cumulativeValue += barTurnover(bar)
    cumulativeVolume += bar.volume
    return {
      timestamp,
      price: bar.close,
      average: cumulativeVolume > 0 ? cumulativeValue / cumulativeVolume : bar.close,
      volume: bar.volume,
    }
  })
}
