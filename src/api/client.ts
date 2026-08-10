export type ApiHealth = {
  status: 'ok'
  service: string
  phase: string
  version: string
  timestamp: string
}

export type MarketInstrument = {
  symbol: string
  key: string
  market: 'CN' | 'HK'
  exchange: 'SZSE' | 'SSE' | 'BSE' | 'HKEX'
  provider_symbol: string
  currency: 'CNY' | 'HKD'
  name: string | null
}

export type MarketBar = {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount: number | null
  /** Decimal fraction: 0.023 means a 2.3% turnover rate. */
  turnover_rate: number | null
}

export type MarketTimeframe = '1m' | '5m' | '15m' | '30m' | '60m' | '1d' | '1w' | '1M'
export type MarketAdjustment = 'none' | 'qfq' | 'hfq'

export type MarketBarsResponse = {
  instrument: MarketInstrument
  timeframe: MarketTimeframe
  adjustment: MarketAdjustment
  adjustment_applied: MarketAdjustment
  source: string
  fetched_at: string
  cached: boolean
  delayed: boolean
  requested_limit: number
  bars: MarketBar[]
}

export type MarketQuoteResponse = {
  instrument: MarketInstrument
  last: number
  previous_close: number | null
  open: number | null
  high: number | null
  low: number | null
  volume: number | null
  timestamp: string | null
  source: string
  delayed: boolean
}

export type JournalRevision = {
  id: string
  record_id: string
  version: number
  created_at: string
  market_data_as_of: string
  title: string
  thesis_markdown: string
  chart_state: Record<string, unknown>
  drawings: Array<Record<string, unknown>>
  indicators: Record<string, unknown>
  tags: string[]
  scenarios: Array<Record<string, unknown>>
  invalidation: string | null
  targets: Array<Record<string, unknown>>
  confidence: number | null
  result_status: 'pending' | 'partial' | 'hit' | 'invalidated'
  review_markdown: string
  screenshot_path: string | null
}

export type JournalRecordSummary = {
  id: string
  date_key: string
  symbol: string
  name: string
  market: 'CN' | 'HK'
  timeframe: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  revision_id: string
  version: number
  title: string
  thesis_markdown: string
  market_data_as_of: string
  result_status: JournalRevision['result_status']
  screenshot_path: string | null
}

export type JournalRecordDetail = Omit<JournalRecordSummary, 'revision_id' | 'version' | 'title' | 'thesis_markdown' | 'market_data_as_of' | 'result_status' | 'screenshot_path'> & {
  revisions: JournalRevision[]
  current_revision: JournalRevision
}

export type JournalRevisionInput = {
  title: string
  thesis_markdown: string
  market_data_as_of: string
  chart_state: Record<string, unknown>
  drawings: Array<Record<string, unknown>>
  indicators: Record<string, unknown>
  screenshot_data_url?: string
  tags?: string[]
  scenarios?: Array<Record<string, unknown>>
  invalidation?: string
  targets?: Array<Record<string, unknown>>
  confidence?: number
  result_status?: JournalRevision['result_status']
  review_markdown?: string
}

export type JournalCreateInput = JournalRevisionInput & {
  date_key: string
  symbol: string
  name: string
  market: 'CN' | 'HK'
  timeframe: string
}

export type DemoSnapshot = {
  instrument: {
    symbol: string
    market: 'SZSE'
    name: string
    currency: 'CNY'
    adjustment: 'qfq'
    data_as_of: string
    source: 'deterministic-fixture'
    supported_timeframes: string[]
  }
  realtime: false
  note: string
}

async function requestJson<T>(path: string, signal?: AbortSignal, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...init?.headers },
    signal,
  })
  if (!response.ok) throw new Error(`API ${response.status}: ${path}`)
  return response.json() as Promise<T>
}

export function getApiHealth(signal?: AbortSignal) {
  return requestJson<ApiHealth>('/api/health', signal)
}

export function getDemoSnapshot(signal?: AbortSignal) {
  return requestJson<DemoSnapshot>('/api/demo/snapshot/001280', signal)
}

export function resolveInstrument(input: string, signal?: AbortSignal) {
  return requestJson<MarketInstrument>(`/api/instruments/resolve?input=${encodeURIComponent(input)}`, signal)
}

export function getMarketBars(
  symbol: string,
  options: {
    timeframe: MarketTimeframe
    adjustment: MarketAdjustment
    limit?: number
    refresh?: boolean
    tradingDate?: string
  },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    timeframe: options.timeframe,
    adjustment: options.adjustment,
    limit: String(options.limit ?? 640),
  })
  if (options.refresh) query.set('refresh', 'true')
  if (options.tradingDate) query.set('trading_date', options.tradingDate)
  return requestJson<MarketBarsResponse>(`/api/market/bars/${encodeURIComponent(symbol)}?${query}`, signal)
}

export function getMarketQuote(symbol: string, signal?: AbortSignal) {
  return requestJson<MarketQuoteResponse>(`/api/market/quote/${encodeURIComponent(symbol)}`, signal)
}

export function listJournalRecords(options: { dateKey?: string; symbol?: string; includeDeleted?: boolean } = {}, signal?: AbortSignal) {
  const query = new URLSearchParams()
  if (options.dateKey) query.set('date_key', options.dateKey)
  if (options.symbol) query.set('symbol', options.symbol)
  if (options.includeDeleted) query.set('include_deleted', 'true')
  return requestJson<JournalRecordSummary[]>(`/api/journal/records?${query}`, signal)
}

export function createJournalRecord(payload: JournalCreateInput, signal?: AbortSignal) {
  return requestJson<JournalRecordDetail>('/api/journal/records', signal, { method: 'POST', body: JSON.stringify(payload) })
}

export function getJournalRecord(recordId: string, signal?: AbortSignal) {
  return requestJson<JournalRecordDetail>(`/api/journal/records/${recordId}`, signal)
}

export function appendJournalRevision(recordId: string, payload: JournalRevisionInput, signal?: AbortSignal) {
  return requestJson<JournalRecordDetail>(`/api/journal/records/${recordId}/revisions`, signal, { method: 'POST', body: JSON.stringify(payload) })
}

export function recycleJournalRecord(recordId: string) {
  return requestJson<{ recycled: boolean }>(`/api/journal/records/${recordId}`, undefined, { method: 'DELETE' })
}

export function restoreJournalRecord(recordId: string) {
  return requestJson<{ restored: boolean }>(`/api/journal/records/${recordId}/restore`, undefined, { method: 'POST' })
}

export function permanentlyDeleteJournalRecord(recordId: string) {
  return requestJson<{ deleted: boolean }>(`/api/journal/records/${recordId}/permanent?confirm=true`, undefined, { method: 'DELETE' })
}

export function exportJournalRecord(recordId: string) {
  return requestJson<{ path: string; record_markdown: string }>(`/api/journal/records/${recordId}/export`, undefined, { method: 'POST' })
}

export function exportJournalProject() {
  return requestJson<{ path: string }>('/api/journal/export-project', undefined, { method: 'POST' })
}

export function importJournalProject(path: string) {
  return requestJson<{ records: number; revisions: number }>('/api/journal/import-project', undefined, { method: 'POST', body: JSON.stringify({ path }) })
}
