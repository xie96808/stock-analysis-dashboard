import type { StockBar } from '../data/fixture'
import { calculateMacd } from '../indicators/tdx'

export type AlertType = 'price_above' | 'price_below' | 'macd_bullish' | 'macd_bearish' | 'volume_ratio'

export type AlertRule = {
  id: string
  symbol: string
  name: string
  type: AlertType
  threshold: number | null
  enabled: boolean
  createdAt: string
  lastCondition: boolean
  lastTriggeredAt: string | null
}

export type AlertEvent = {
  id: string
  ruleId: string
  symbol: string
  message: string
  triggeredAt: string
}

export const alertTypeLabels: Record<AlertType, string> = {
  price_above: '价格上穿',
  price_below: '价格下穿',
  macd_bullish: 'MACD 金叉',
  macd_bearish: 'MACD 死叉',
  volume_ratio: '量比超过',
}

export function selectAlertBars(dailyBars: StockBar[], chartBars: StockBar[]) {
  if (dailyBars.length && dailyBars.every((bar) => !bar.date.includes(' '))) return dailyBars
  if (chartBars.length && chartBars.every((bar) => !bar.date.includes(' '))) return chartBars
  return []
}

function macdState(bars: StockBar[]) {
  if (bars.length < 35) return { bullishCross: false, bearishCross: false }
  const points = calculateMacd(bars, 12, 26, 9)
  const previous = points.length - 2
  const current = points.length - 1
  return {
    bullishCross: points[previous].dif <= points[previous].dea && points[current].dif > points[current].dea,
    bearishCross: points[previous].dif >= points[previous].dea && points[current].dif < points[current].dea,
  }
}

function volumeRatio(bars: StockBar[]) {
  if (bars.length < 6) return 0
  const latest = bars.at(-1)!.volume
  const baseline = bars.slice(-6, -1).reduce((sum, bar) => sum + bar.volume, 0) / 5
  return baseline > 0 ? latest / baseline : 0
}

function condition(rule: AlertRule, bars: StockBar[], price: number) {
  const threshold = rule.threshold ?? 0
  if (rule.type === 'price_above') return price > threshold
  if (rule.type === 'price_below') return price < threshold
  if (rule.type === 'volume_ratio') return volumeRatio(bars) >= threshold
  const macd = macdState(bars)
  return rule.type === 'macd_bullish' ? macd.bullishCross : macd.bearishCross
}

function describe(rule: AlertRule, price: number) {
  if (rule.type === 'price_above') return `${rule.name} 最新价 ${price.toFixed(2)} 已达到上穿条件 ${rule.threshold?.toFixed(2)}`
  if (rule.type === 'price_below') return `${rule.name} 最新价 ${price.toFixed(2)} 已达到下穿条件 ${rule.threshold?.toFixed(2)}`
  if (rule.type === 'volume_ratio') return `${rule.name} 当日成交量达到近5日均量的 ${rule.threshold?.toFixed(1)} 倍`
  return `${rule.name} 日线出现${alertTypeLabels[rule.type]}`
}

export function evaluateAlerts(rules: AlertRule[], bars: StockBar[], price: number, now = new Date()) {
  const events: AlertEvent[] = []
  let changed = false
  const timestamp = now.toISOString()
  const nextRules = rules.map((rule) => {
    if (!rule.enabled || !bars.length) return rule
    const met = condition(rule, bars, price)
    if (met === rule.lastCondition) return rule
    changed = true
    if (met) {
      events.push({
        id: `${rule.id}-${now.getTime()}`,
        ruleId: rule.id,
        symbol: rule.symbol,
        message: describe(rule, price),
        triggeredAt: timestamp,
      })
    }
    return { ...rule, lastCondition: met, lastTriggeredAt: met ? timestamp : rule.lastTriggeredAt }
  })
  return { rules: nextRules, events, changed }
}

export function parseAlertRules(value: string | null): AlertRule[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is AlertRule => {
      if (!item || typeof item !== 'object') return false
      const rule = item as Partial<AlertRule>
      return typeof rule.id === 'string' && typeof rule.symbol === 'string' && typeof rule.name === 'string'
        && typeof rule.type === 'string' && rule.type in alertTypeLabels && typeof rule.enabled === 'boolean'
    })
  } catch {
    return []
  }
}

export function parseAlertEvents(value: string | null): AlertEvent[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is AlertEvent => Boolean(
      item && typeof item === 'object' && typeof (item as AlertEvent).id === 'string'
        && typeof (item as AlertEvent).message === 'string' && typeof (item as AlertEvent).triggeredAt === 'string',
    )).slice(0, 100) : []
  } catch {
    return []
  }
}
