import { describe, expect, it } from 'vitest'
import { marketSessionState } from './refreshSchedule'

describe('market refresh schedule', () => {
  it('opens A-share refresh during both trading sessions', () => {
    expect(marketSessionState(new Date('2026-08-10T01:45:00Z'), 'CN')).toMatchObject({ open: true, phase: 'morning' })
    expect(marketSessionState(new Date('2026-08-10T06:45:00Z'), 'CN')).toMatchObject({ open: true, phase: 'afternoon' })
  })

  it('pauses for lunch, after close and weekends', () => {
    expect(marketSessionState(new Date('2026-08-10T04:00:00Z'), 'CN')).toMatchObject({ open: false, phase: 'lunch' })
    expect(marketSessionState(new Date('2026-08-10T08:00:00Z'), 'CN')).toMatchObject({ open: false, phase: 'closed' })
    expect(marketSessionState(new Date('2026-08-09T02:00:00Z'), 'CN')).toMatchObject({ open: false, phase: 'weekend' })
  })

  it('uses the later Hong Kong close', () => {
    expect(marketSessionState(new Date('2026-08-10T07:30:00Z'), 'HK')).toMatchObject({ open: true, phase: 'afternoon' })
    expect(marketSessionState(new Date('2026-08-10T08:00:00Z'), 'HK')).toMatchObject({ open: false, phase: 'closed' })
  })
})
