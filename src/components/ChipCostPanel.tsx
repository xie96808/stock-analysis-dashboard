import { useMemo } from 'react'
import type { StockBar } from '../data/fixture'
import { calculateChipCostEstimate } from '../chips/calculate'

type Props = { bars: StockBar[]; currentPrice: number; visible: boolean }

export function ChipCostPanel({ bars, currentPrice, visible }: Props) {
  const estimate = useMemo(() => calculateChipCostEstimate(bars, currentPrice), [bars, currentPrice])
  if (!visible || !estimate.rows.length) return null
  const max = Math.max(...estimate.rows.map((row) => row.weight), 1)
  return (
    <aside className="chip-cost-panel" aria-label="筹码成本估算">
      <header><div><span>筹码成本估算</span><strong>历史成交/换手模型</strong></div><b>{(estimate.profitRatio * 100).toFixed(1)}%<small>估算获利</small></b></header>
      <div className="chip-distribution">
        {estimate.rows.map((row) => <i key={row.price} className={row.profitable ? 'is-profit' : 'is-loss'} style={{ width: `${Math.max(2, row.weight / max * 100)}%` }} title={`${row.price.toFixed(2)} · 估算权重`} />)}
      </div>
      <dl>
        <div><dt>平均成本</dt><dd>{estimate.averageCost.toFixed(2)}</dd></div>
        <div><dt>70%区间</dt><dd>{estimate.range70[0].toFixed(2)}–{estimate.range70[1].toFixed(2)}</dd></div>
        <div><dt>90%区间</dt><dd>{estimate.range90[0].toFixed(2)}–{estimate.range90[1].toFixed(2)}</dd></div>
      </dl>
      <p>基于历史OHLCV与换手代理的估算，不代表真实投资者持仓。</p>
    </aside>
  )
}
