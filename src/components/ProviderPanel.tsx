import { useEffect, useState } from 'react'
import { getMarketProviders, type MarketProviderStatus } from '../api/client'
import { useEscapeToClose } from '../ui/useEscapeToClose'

type Props = {
  symbol: string
  name: string
  source: string
  cached: boolean
  delayed: boolean
  stale: boolean
  fallbackUsed: boolean
  freshnessSeconds: number
  qualityIssues: string[]
  providerChain: string[]
  onClose: () => void
  onMessage: (message: string) => void
}

function formatTime(value: string | null) {
  if (!value) return '尚未成功'
  const stamp = new Date(value)
  if (Number.isNaN(stamp.getTime())) return value
  return stamp.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
}

export function ProviderPanel({
  symbol, name, source, cached, delayed, stale, fallbackUsed, freshnessSeconds,
  qualityIssues, providerChain, onClose, onMessage,
}: Props) {
  const [providers, setProviders] = useState<MarketProviderStatus[] | null>(null)
  const [loading, setLoading] = useState(true)
  useEscapeToClose(onClose)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    getMarketProviders(controller.signal).then(setProviders).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      onMessage(error instanceof Error ? `行情源状态读取失败：${error.message}` : '行情源状态读取失败')
    }).finally(() => setLoading(false))
    return () => controller.abort()
  }, [onMessage])

  return <div className="provider-backdrop" role="dialog" aria-modal="true" aria-label="行情源状态" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="provider-dialog" onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div>
          <span className="eyebrow">行情源</span>
          <h2>{name} · {symbol}</h2>
          <p>当前K线来自 {source}{cached ? ' · 缓存命中' : ''}{delayed ? ' · 延时/收盘' : ' · 实时'}{stale ? ' · 过期缓存' : ''}{fallbackUsed ? ' · 已使用备用源' : ''}</p>
        </div>
        <button type="button" aria-label="关闭行情源" onClick={onClose}>×</button>
      </header>
      <div className="provider-current">
        <div><span>当前源</span><strong>{source}</strong></div>
        <div><span>新鲜度</span><strong>{freshnessSeconds ? `${Math.round(freshnessSeconds)}秒` : '刚刚'}</strong></div>
        <div><span>尝试链</span><strong>{providerChain.length ? providerChain.join(' → ') : source}</strong></div>
      </div>
      {qualityIssues.length > 0 && <div className="provider-issues">{qualityIssues.map((issue) => <span key={issue}>{issue}</span>)}</div>}
      <div className="provider-list" aria-live="polite">
        {loading && <div className="provider-empty">正在读取行情源健康状态…</div>}
        {!loading && providers?.map((item) => (
          <article key={item.name} className={item.healthy ? 'is-healthy' : 'is-unhealthy'}>
            <div>
              <strong>{item.name}</strong>
              <span>优先级 {item.priority} · 失败 {item.failures} 次</span>
            </div>
            <div>
              <span className="provider-pill">{item.healthy ? '健康' : '异常'}</span>
              <small>上次成功 {formatTime(item.last_success_at)}</small>
              {item.last_error && <small className="provider-error">{item.last_error}</small>}
            </div>
          </article>
        ))}
        {!loading && !providers?.length && <div className="provider-empty">API 未返回行情源状态</div>}
      </div>
      <footer>状态来自 /api/market/providers；看板状态栏同步显示当前K线实际使用的数据源。</footer>
    </section>
  </div>
}
