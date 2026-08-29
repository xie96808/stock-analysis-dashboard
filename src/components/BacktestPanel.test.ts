import { describe, expect, it } from 'vitest'
import { formatMetricPercent } from './BacktestPanel'

describe('formatMetricPercent', () => {
  it('keeps signed deltas for returns and leaves win rate unsigned', () => {
    expect(formatMetricPercent(0.4)).toBe('+40.00%')
    expect(formatMetricPercent(-0.2525)).toBe('-25.25%')
    expect(formatMetricPercent(0.4, false)).toBe('40.00%')
    expect(formatMetricPercent(0, false)).toBe('0.00%')
  })
}
