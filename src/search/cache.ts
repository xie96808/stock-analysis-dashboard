import type { InstrumentSuggestion } from '../api/client'

const CACHE_TTL_MS = 10 * 60_000
const MAX_ENTRIES = 80

type CacheEntry = { savedAt: number; results: InstrumentSuggestion[] }
const memoryCache = new Map<string, CacheEntry>()

export function normalizeSearchQuery(query: string) {
  return query.trim().toLocaleLowerCase('zh-CN')
}

export function getCachedSuggestions(query: string, now = Date.now()): InstrumentSuggestion[] | null {
  const key = normalizeSearchQuery(query)
  const entry = memoryCache.get(key)
  if (!entry || now - entry.savedAt > CACHE_TTL_MS) {
    if (entry) memoryCache.delete(key)
    return null
  }
  return entry.results
}

export function cacheSuggestions(query: string, results: InstrumentSuggestion[], now = Date.now()) {
  const key = normalizeSearchQuery(query)
  memoryCache.delete(key)
  memoryCache.set(key, { savedAt: now, results })
  while (memoryCache.size > MAX_ENTRIES) {
    const oldest = memoryCache.keys().next().value
    if (oldest == null) break
    memoryCache.delete(oldest)
  }
}

export function clearSuggestionCache() {
  memoryCache.clear()
}
