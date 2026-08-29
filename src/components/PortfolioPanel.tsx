import { useEffect, useMemo, useState } from 'react'
import { createPaperTrade, deletePaperTrade, getPaperPortfolio, type PaperPortfolio } from '../api/client'
import { useEscapeToClose } from '../ui/useEscapeToClose'

type Props = {
  symbol: string
  name: string
  market: 'CN' | 'HK'
  currentPrice: number
  onClose: () => void
  onMessage: (message: string) => void
}

function money(value: number) {
  return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
}

export function PortfolioPanel({ symbol, name, market, currentPrice, onClose, onMessage }: Props) {
  const [portfolio, setPortfolio] = useState<PaperPortfolio | null>(null)
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [price, setPrice] = useState(currentPrice.toFixed(2))
  const [quantity, setQuantity] = useState(market === 'CN' ? 100 : 1)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  useEscapeToClose(onClose)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    getPaperPortfolio(controller.signal).then(setPortfolio).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      onMessage(error instanceof Error ? `模拟持仓读取失败：${error.message}` : '模拟持仓读取失败')
    }).finally(() => setLoading(false))
    return () => controller.abort()
  }, [onMessage])

  useEffect(() => setPrice(currentPrice.toFixed(2)), [currentPrice, symbol])

  const currentPosition = portfolio?.positions.find((item) => item.symbol === symbol)
  const estimatedEquity = useMemo(() => {
    if (!portfolio) return 0
    return portfolio.cash + portfolio.positions.reduce((sum, item) => (
      sum + (item.symbol === symbol ? item.quantity * currentPrice : item.cost_value)
    ), 0)
  }, [currentPrice, portfolio, symbol])

  const submit = async () => {
    const numericPrice = Number(price)
    if (!Number.isFinite(numericPrice) || numericPrice <= 0 || quantity <= 0 || !Number.isInteger(quantity)) {
      onMessage('请输入有效的模拟成交价和整数数量')
      return
    }
    setLoading(true)
    try {
      const next = await createPaperTrade({ symbol, name, market, side, price: numericPrice, quantity, note })
      setPortfolio(next)
      setNote('')
      setPendingDeleteId(null)
      onMessage(`模拟${side === 'buy' ? '买入' : '卖出'}完成：${name} ${quantity}股`)
    } catch (error) {
      onMessage(error instanceof Error ? `模拟成交失败：${error.message}` : '模拟成交失败')
    } finally {
      setLoading(false)
    }
  }

  const removeTrade = async (tradeId: string) => {
    if (pendingDeleteId !== tradeId) {
      setPendingDeleteId(tradeId)
      return
    }
    setLoading(true)
    try {
      setPortfolio(await deletePaperTrade(tradeId))
      setPendingDeleteId(null)
      onMessage('模拟成交已删除并重新计算持仓')
    } catch (error) {
      onMessage(error instanceof Error ? `删除失败：${error.message}` : '删除失败')
    } finally {
      setLoading(false)
    }
  }

  return <div className="portfolio-backdrop" role="dialog" aria-modal="true" aria-label="模拟持仓">
    <section className="portfolio-dialog">
      <header><div><span className="eyebrow">Paper Portfolio</span><h2>模拟持仓</h2><p>本地 SQLite 账本 · 自动佣金与 A 股卖出印花税</p></div><button type="button" aria-label="关闭模拟持仓" onClick={onClose}>×</button></header>
      <div className="portfolio-summary">
        <div><span>估算总资产</span><strong>¥{money(estimatedEquity)}</strong><small>当前股票按最新价，其余按成本</small></div>
        <div><span>可用资金</span><strong>¥{money(portfolio?.cash ?? 0)}</strong><small>初始 ¥100,000</small></div>
        <div><span>持仓成本</span><strong>¥{money(portfolio?.position_cost ?? 0)}</strong><small>{portfolio?.positions.length ?? 0} 个持仓</small></div>
        <div><span>已实现盈亏</span><strong className={(portfolio?.realized_pnl ?? 0) >= 0 ? 'is-positive' : 'is-negative'}>¥{money(portfolio?.realized_pnl ?? 0)}</strong><small>扣除费用</small></div>
      </div>
      <div className="portfolio-body">
        <aside className="paper-order">
          <div className="paper-order-symbol"><span>{market === 'CN' ? 'A股' : '港股'}</span><strong>{name}</strong><small>{symbol} · 最新 {currentPrice.toFixed(2)}</small></div>
          <div className="paper-side"><button type="button" className={side === 'buy' ? 'is-buy' : ''} onClick={() => setSide('buy')}>模拟买入</button><button type="button" className={side === 'sell' ? 'is-sell' : ''} onClick={() => setSide('sell')}>模拟卖出</button></div>
          <label>成交价<input aria-label="模拟成交价" type="number" min="0.01" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} /></label>
          <label>数量<input aria-label="模拟成交数量" type="number" min="1" step={market === 'CN' ? 100 : 1} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></label>
          <label>交易备注<textarea aria-label="模拟交易备注" rows={3} value={note} placeholder="记录本次模拟交易的依据" onChange={(event) => setNote(event.target.value)} /></label>
          <div className="paper-position-hint">{currentPosition ? <>当前持仓 <strong>{currentPosition.quantity}股</strong><span>成本 {currentPosition.average_cost.toFixed(2)} · 浮动 {money((currentPrice - currentPosition.average_cost) * currentPosition.quantity)}</span></> : <span>当前股票暂无模拟持仓</span>}</div>
          <button type="button" className={`paper-submit is-${side}`} disabled={loading} onClick={submit}>{loading ? '处理中…' : `确认${side === 'buy' ? '买入' : '卖出'}`}</button>
          <small>默认佣金 0.03%（最低5元）；A股卖出另计 0.05% 印花税。</small>
        </aside>
        <main className="portfolio-ledger">
          <section><div className="portfolio-section-heading"><strong>持仓</strong><span>{portfolio?.positions.length ?? 0}</span></div><div className="paper-positions">
            {portfolio?.positions.map((item) => <article key={item.symbol}><div><strong>{item.name}</strong><span>{item.symbol} · {item.market}</span></div><div><span>数量</span><strong>{item.quantity}</strong></div><div><span>平均成本</span><strong>{item.average_cost.toFixed(2)}</strong></div><div><span>成本金额</span><strong>¥{money(item.cost_value)}</strong></div></article>)}
            {!portfolio?.positions.length && <div className="portfolio-empty">尚无模拟持仓</div>}
          </div></section>
          <section className="paper-history"><div className="portfolio-section-heading"><strong>成交记录</strong><span>{portfolio?.trades.length ?? 0}</span></div><div className="paper-trades">
            {portfolio?.trades.map((trade) => <article key={trade.id}><span className={`paper-trade-side is-${trade.side}`}>{trade.side === 'buy' ? '买' : '卖'}</span><div><strong>{trade.name} · {trade.quantity}股 @ {trade.price.toFixed(2)}</strong><span>{new Date(trade.traded_at).toLocaleString('zh-CN')} · 费用 {trade.fees.toFixed(2)}{trade.note ? ` · ${trade.note}` : ''}</span></div><button type="button" className={pendingDeleteId === trade.id ? 'paper-trade-delete is-confirming' : 'paper-trade-delete'} aria-label={`删除模拟成交 ${trade.id}`} disabled={loading} onClick={() => void removeTrade(trade.id)}>{pendingDeleteId === trade.id ? '确认删除' : '删除'}</button></article>)}
            {!portfolio?.trades.length && <div className="portfolio-empty">成交后将在这里形成可追溯账本</div>}
          </div></section>
        </main>
      </div>
    </section>
  </div>
}
