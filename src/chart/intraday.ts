export type ChartPoint = { x: number; y: number }

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
