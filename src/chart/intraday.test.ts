import { describe, expect, it } from 'vitest'
import { intradaySourceLabel, placeIntradayPrompt, resolveIntradaySource, supportsIntraday } from './intraday'

describe('intraday entry policy', () => {
  it('only enables entry from daily candles', () => {
    expect(supportsIntraday('日K')).toBe(true)
    for (const timeframe of ['1分', '5分', '15分', '30分', '60分', '周K', '月K']) {
      expect(supportsIntraday(timeframe)).toBe(false)
    }
    expect(supportsIntraday('日K', '趋势线')).toBe(false)
  })

  it('keeps the confirmation prompt inside the chart', () => {
    expect(placeIntradayPrompt({ x: 300, y: 200 }, { width: 900, height: 600 })).toEqual({ x: 312, y: 212 })
    expect(placeIntradayPrompt({ x: 895, y: 595 }, { width: 900, height: 600 })).toEqual({ x: 666, y: 474 })
    expect(placeIntradayPrompt({ x: -20, y: -20 }, { width: 900, height: 600 })).toEqual({ x: 10, y: 10 })
  })
})

describe('intraday source selection', () => {
  it('does not invent prices when live 5-minute bars are missing', () => {
    expect(resolveIntradaySource([], { loading: false, allowFixture: false })).toBe('unavailable')
    expect(intradaySourceLabel('unavailable')).toBe('无5分钟行情')
  })

  it('uses the labeled fixture only when the dashboard is already in sample fallback', () => {
    expect(resolveIntradaySource([], { allowFixture: true })).toBe('fixture')
    expect(intradaySourceLabel('fixture')).toBe('样例降级')
  })

  it('prefers live points over the demo fixture', () => {
    expect(resolveIntradaySource([{ length: 1 } as { length: number }], { allowFixture: true })).toBe('live')
  })
})
