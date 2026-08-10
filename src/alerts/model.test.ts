import { describe, expect, it } from 'vitest'
import { evaluateAlerts, parseAlertRules, type AlertRule } from './model'
import type { StockBar } from '../data/fixture'

const bars: StockBar[] = Array.from({ length: 40 }, (_, index) => ({
  date: `2026-07-${String(index + 1).padStart(2, '0')}`,
  open: 10 + index * 0.1,
  high: 10.3 + index * 0.1,
  low: 9.8 + index * 0.1,
  close: 10.1 + index * 0.1,
  volume: index === 39 ? 6000 : 1000,
}))

function rule(overrides: Partial<AlertRule> = {}): AlertRule {
  return {
    id: 'rule-1', symbol: '001280', name: '测试股票', type: 'price_above', threshold: 14,
    enabled: true, createdAt: '2026-08-10T00:00:00Z', lastCondition: false, lastTriggeredAt: null,
    ...overrides,
  }
}

describe('alert evaluation', () => {
  it('triggers only on the false-to-true edge', () => {
    const first = evaluateAlerts([rule()], bars, 14.5, new Date('2026-08-10T01:00:00Z'))
    expect(first.events).toHaveLength(1)
    expect(first.rules[0].lastCondition).toBe(true)
    const repeated = evaluateAlerts(first.rules, bars, 14.5, new Date('2026-08-10T01:01:00Z'))
    expect(repeated.events).toHaveLength(0)
    expect(repeated.changed).toBe(false)
  })

  it('supports downward price and volume-ratio rules', () => {
    expect(evaluateAlerts([rule({ type: 'price_below', threshold: 15 })], bars, 14).events).toHaveLength(1)
    expect(evaluateAlerts([rule({ type: 'volume_ratio', threshold: 3 })], bars, 14).events).toHaveLength(1)
  })

  it('ignores disabled rules and malformed persisted state', () => {
    expect(evaluateAlerts([rule({ enabled: false })], bars, 20).events).toHaveLength(0)
    expect(parseAlertRules('{bad json')).toEqual([])
    expect(parseAlertRules('[{"id":1}]')).toEqual([])
  })
})
