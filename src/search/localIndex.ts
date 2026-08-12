import type { InstrumentSuggestion } from '../api/client'
import { normalizeSearchQuery } from './cache'

const INDEX_URL = '/instrument-index.json'
const RECENT_KEY = 'dashboard-recent-instruments-v1'
const MAX_RECENT = 12

type IndexedInstrument = { item: InstrumentSuggestion; name: string; symbol: string; providerSymbol: string }

let indexPromise: Promise<IndexedInstrument[]> | null = null
let recentMemory: string[] = []

function normalizeName(value: string) {
  return normalizeSearchQuery(value).replace(/[\sＡ]/g, (character) => character === 'Ａ' ? 'a' : '')
}

function recentSymbols(): string[] {
  if (typeof globalThis.localStorage === 'undefined') return recentMemory
  try {
    const value = JSON.parse(globalThis.localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function loadLocalInstrumentIndex(signal?: AbortSignal): Promise<IndexedInstrument[]> {
  if (!indexPromise) {
    indexPromise = fetch(INDEX_URL, { signal, cache: 'default' })
      .then((response) => {
        if (!response.ok) throw new Error(`Instrument index ${response.status}`)
        return response.json() as Promise<InstrumentSuggestion[]>
      })
      .then((items) => items.map((item) => ({
        item,
        name: normalizeName(item.name),
        symbol: item.symbol.toLowerCase(),
        providerSymbol: item.provider_symbol.toLowerCase(),
      })))
      .catch((error) => {
        indexPromise = null
        throw error
      })
  }
  return indexPromise
}

export async function searchLocalInstruments(query: string, limit = 5, signal?: AbortSignal) {
  const value = normalizeName(query)
  if (!value) return []
  const index = await loadLocalInstrumentIndex(signal)
  const recent = new Map(recentSymbols().map((symbol, position) => [symbol, position]))
  const ranked: Array<{ rank: number; recent: number; nameLength: number; item: InstrumentSuggestion }> = []

  for (const indexed of index) {
    const { item, symbol, providerSymbol, name } = indexed
    let rank = Number.POSITIVE_INFINITY
    if (symbol === value || providerSymbol === value) rank = 0
    else if (symbol.startsWith(value)) rank = 1
    else if (name === value) rank = 2
    else if (name.startsWith(value)) rank = 3
    else if (name.includes(value)) rank = 4
    if (!Number.isFinite(rank)) continue
    ranked.push({ rank, recent: recent.get(item.provider_symbol) ?? MAX_RECENT, nameLength: name.length, item })
  }

  return ranked
    .sort((left, right) => left.rank - right.rank || left.recent - right.recent || left.nameLength - right.nameLength || left.item.symbol.localeCompare(right.item.symbol))
    .slice(0, Math.max(1, Math.min(limit, 10)))
    .map(({ item }) => item)
}

export function rememberRecentInstrument(item: InstrumentSuggestion) {
  const next = [item.provider_symbol, ...recentSymbols().filter((symbol) => symbol !== item.provider_symbol)].slice(0, MAX_RECENT)
  recentMemory = next
  globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(next))
}

export function resetLocalInstrumentIndexForTests() {
  indexPromise = null
  recentMemory = []
}
