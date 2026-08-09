export type ApiHealth = {
  status: 'ok'
  service: string
  phase: 'P1'
  version: string
  timestamp: string
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

async function requestJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: 'application/json' },
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
