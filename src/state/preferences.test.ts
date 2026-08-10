import { describe, expect, it } from 'vitest'
import { defaultDrawingStyle } from '../drawings/model'
import { parseDrawingStore, parseIndicatorConfig, shanghaiDateKey } from './preferences'

const indicators = {
  maEnabled: true,
  maPeriods: [5, 10, 20, 30],
  emaEnabled: false,
  emaPeriod: 20,
  volumeEnabled: true,
  macdEnabled: true,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
}

describe('persisted preferences', () => {
  it('rejects malformed drawing stores instead of crashing the app', () => {
    expect(parseDrawingStore('{')).toEqual({ version: 1, workspaces: {} })
    expect(parseDrawingStore(JSON.stringify({ version: 1, workspaces: [] }))).toEqual({ version: 1, workspaces: {} })
  })

  it('keeps valid drawings and drops corrupt workspace entries', () => {
    const valid = {
      id: 'line-1', symbol: 'SZSE:001280', market: 'CN', type: 'horizontal',
      anchors: [{ timestampMs: 1, price: 12 }], timeframeVisibility: 'all',
      locked: false, hidden: false, style: defaultDrawingStyle('horizontal'),
    }
    const parsed = parseDrawingStore(JSON.stringify({
      version: 1,
      workspaces: { main: [valid, { id: 'broken' }], broken: 'not-an-array' },
    }))
    expect(parsed.workspaces.main).toEqual([valid])
    expect(parsed.workspaces.broken).toBeUndefined()
  })

  it('clamps persisted indicator parameters and restores invalid values', () => {
    const parsed = parseIndicatorConfig(JSON.stringify({
      maPeriods: ['bad', 8, 900], emaPeriod: -2, macdFast: 999, volumeEnabled: false,
    }), indicators)
    expect(parsed.maPeriods).toEqual([8])
    expect(parsed.emaPeriod).toBe(2)
    expect(parsed.macdFast).toBe(200)
    expect(parsed.volumeEnabled).toBe(false)
  })
})

describe('Shanghai date key', () => {
  it('uses Asia/Shanghai rather than the browser UTC date', () => {
    expect(shanghaiDateKey(new Date('2026-08-10T16:30:00Z'))).toBe('2026-08-11')
  })
})
