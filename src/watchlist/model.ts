export type ReviewStatus = 'pending' | 'reviewed' | 'focus'

export type WatchlistItem = {
  key: string
  symbol: string
  name: string
  market: 'CN' | 'HK'
  exchange: string
  status: ReviewStatus
  note: string
  addedAt: string
  reviewedAt: string | null
}

export function parseWatchlist(value: string | null): WatchlistItem[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is WatchlistItem => {
      if (!item || typeof item !== 'object') return false
      const entry = item as Partial<WatchlistItem>
      return typeof entry.key === 'string' && typeof entry.symbol === 'string' && typeof entry.name === 'string'
        && (entry.market === 'CN' || entry.market === 'HK')
        && (entry.status === 'pending' || entry.status === 'reviewed' || entry.status === 'focus')
    })
  } catch {
    return []
  }
}

export function upsertWatchlist(items: WatchlistItem[], item: WatchlistItem) {
  const existing = items.findIndex((entry) => entry.key === item.key)
  if (existing < 0) return [item, ...items]
  return items.map((entry, index) => index === existing ? { ...entry, name: item.name, exchange: item.exchange } : entry)
}

export function updateReviewStatus(item: WatchlistItem, status: ReviewStatus, now = new Date()): WatchlistItem {
  return {
    ...item,
    status,
    reviewedAt: status === 'pending' ? null : now.toISOString(),
  }
}

export function nextPendingItem(items: WatchlistItem[], currentKey?: string) {
  const pending = items.filter((item) => item.status === 'pending')
  if (!pending.length) return null
  const currentIndex = pending.findIndex((item) => item.key === currentKey)
  return pending[(currentIndex + 1) % pending.length]
}
