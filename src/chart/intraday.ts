export type ChartPoint = { x: number; y: number }

export type IntradaySource = 'live' | 'fixture' | 'unavailable' | 'loading'

export function supportsIntraday(timeframe: string, activeTool = '选择') {
  return timeframe === '日K' && activeTool === '选择'
}

export function placeIntradayPrompt(
  point: ChartPoint,
  host: { width: number; height: number },
  prompt: { width: number; height: number } = { width: 224, height: 116 },
) {
  return {
    x: Math.max(10, Math.min(point.x + 12, host.width - prompt.width - 10)),
    y: Math.max(10, Math.min(point.y + 12, host.height - prompt.height - 10)),
  }
}

export function resolveIntradaySource(
  suppliedPoints: { length: number } | undefined,
  options: { loading?: boolean; allowFixture?: boolean } = {},
): IntradaySource {
  if (options.loading) return 'loading'
  if (suppliedPoints && suppliedPoints.length > 0) return 'live'
  if (options.allowFixture) return 'fixture'
  return 'unavailable'
}

export function intradaySourceLabel(source: IntradaySource) {
  if (source === 'loading') return '正在加载5分钟行情'
  if (source === 'live') return '真实5分钟行情'
  if (source === 'fixture') return '样例降级'
  return '无5分钟行情'
}

export function intradayPriceScaleRange(prices: number[], paddingRatio = 0.12) {
  const finite = prices.filter((value) => Number.isFinite(value) && value > 0)
  if (!finite.length) return { minValue: 0, maxValue: 1 }
  const ranked = [...finite].sort((a, b) => a - b)
  const median = ranked[Math.floor(ranked.length / 2)]
  const clustered = finite.filter((value) => value >= median * 0.2 && value <= median * 5)
  const used = clustered.length ? clustered : finite
  const min = Math.min(...used)
  const max = Math.max(...used)
  const span = Math.max(max - min, Math.max(Math.abs(min), Math.abs(max), 1) * 0.002)
  const padding = span * paddingRatio
  return { minValue: min - padding, maxValue: max + padding }
}
