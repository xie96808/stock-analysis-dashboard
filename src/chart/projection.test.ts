import { describe, expect, it } from 'vitest'
import { futureProjectionBarCount } from './projection'

describe('futureProjectionBarCount', () => {
  it('keeps a useful but bounded projection tail on phones', () => {
    expect(futureProjectionBarCount(350)).toBe(77)
    expect(futureProjectionBarCount(200)).toBe(48)
  })

  it('preserves the desktop projection ceiling', () => {
    expect(futureProjectionBarCount(1200)).toBe(264)
    expect(futureProjectionBarCount(2000)).toBe(270)
  })

  it('falls back safely for an invalid measurement', () => {
    expect(futureProjectionBarCount(Number.NaN)).toBe(48)
  })
})
