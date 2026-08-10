import { describe, expect, it } from 'vitest'
import { nextPendingItem, parseWatchlist, updateReviewStatus, upsertWatchlist, type WatchlistItem } from './model'

const first: WatchlistItem = {
  key: 'CN:001280', symbol: '001280', name: '甲', market: 'CN', exchange: 'SZSE', status: 'pending',
  note: '', addedAt: '2026-08-10T00:00:00Z', reviewedAt: null,
}
const second: WatchlistItem = { ...first, key: 'HK:00700', symbol: '00700', name: '乙', market: 'HK', exchange: 'HKEX' }

describe('watchlist model', () => {
  it('adds without duplicates and updates instrument metadata', () => {
    expect(upsertWatchlist([], first)).toEqual([first])
    expect(upsertWatchlist([first], { ...first, name: '更新名称' })).toHaveLength(1)
    expect(upsertWatchlist([first], { ...first, name: '更新名称' })[0].name).toBe('更新名称')
  })

  it('tracks review completion and returns the next pending symbol', () => {
    const reviewed = updateReviewStatus(first, 'reviewed', new Date('2026-08-10T01:00:00Z'))
    expect(reviewed.reviewedAt).toBe('2026-08-10T01:00:00.000Z')
    expect(nextPendingItem([reviewed, second])?.key).toBe(second.key)
  })

  it('validates persisted input', () => {
    expect(parseWatchlist(JSON.stringify([first]))).toEqual([first])
    expect(parseWatchlist('{broken')).toEqual([])
    expect(parseWatchlist('[{"symbol":"1"}]')).toEqual([])
  })
})
