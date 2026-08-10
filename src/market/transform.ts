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

export function toIntradayPoints(response: MarketBarsResponse): IntradayPoint[] {
  let cumulativeValue = 0
  let cumulativeVolume = 0
  return response.bars.map((bar) => {
    const timestamp = Math.floor(new Date(`${bar.time.replace(' ', 'T')}:00+08:00`).getTime() / 1000)
    cumulativeValue += bar.amount ?? bar.close * bar.volume
    cumulativeVolume += bar.volume
    return {
      timestamp,
      price: bar.close,
      average: cumulativeVolume > 0 ? cumulativeValue / cumulativeVolume : bar.close,
      volume: bar.volume,
    }
  })
}
