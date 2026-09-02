import { useMemo, useState } from 'react'
import { useEscapeToClose } from '../ui/useEscapeToClose'
import { runBacktest, type BacktestResult, type BacktestStrategy } from '../api/client'
import { Icon } from './Icon'

type Props = {
  symbol: string
  name: string
  market: 'CN' | 'HK'
  onClose: () => void
  onMessage: (message: string) => void
}

const strategyLabels: Record<BacktestStrategy, string> = {
  ma_cross: '均线交叉',
  breakout: '价格突破',
  macd: 'MACD交叉',
}

export function formatMetricPercent(value: number, signed = true) {
  return `${signed && value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
}

function money(value: number) {
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value)
}

export function BacktestPanel({ symbol, name, market, onClose, onMessage }: Props) {
  const [strategy, setStrategy] = useState<BacktestStrategy>('ma_cross')
  const [fast, setFast] = useState(5)
  const [slow, setSlow] = useState(20)
  const [signal, setSignal] = useState(9)
  const [initialCash, setInitialCash] = useState(100_000)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<BacktestResult | null>(null)
  useEscapeToClose(onClose)

  const chartPoints = useMemo(() => {
    if (!result?.equity_curve.length) return ''
    const values = result.equity_curve.map((point) => point.equity)
    const minimum = Math.min(...values)
    const maximum = Math.max(...values)
    const span = Math.max(1, maximum - minimum)
    return values.map((value, index) => {
      const x = values.length === 1 ? 0 : index / (values.length - 1) * 100
      const y = 96 - (value - minimum) / span * 88
      return `${x.toFixed(2)},${y.toFixed(2)}`
    }).join(' ')
  }, [result])

  const datesReady = Boolean(startDate && endDate)

  const execute = async () => {
    if (!datesReady) {
      onMessage('请先选择开始日期和结束日期')
      return
    }
    setRunning(true)
    try {
      let parameters: Record<string, number>
      if (strategy === 'breakout') parameters = { entry_lookback: slow, exit_lookback: fast }
      else if (strategy === 'macd') parameters = { fast, slow, signal }
      else parameters = { fast, slow }
      const next = await runBacktest({
        symbol,
        ...(startDate ? { start_date: startDate } : {}),
        ...(endDate ? { end_date: endDate } : {}),
        strategy,
        parameters,
        initial_cash: initialCash,
        commission_rate: 0.0003,
        minimum_commission: 5,
        stamp_tax_rate: market === 'CN' ? 0.0005 : 0,
        slippage_bps: 2,
        lot_size: market === 'CN' ? 100 : 1,
      })
      setResult(next)
      onMessage(`回测完成：${strategyLabels[strategy]} · ${next.metrics.trade_count}笔成交`)
    } catch (error) {
      onMessage(error instanceof Error ? `回测失败：${error.message}` : '回测失败')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="backtest-backdrop" role="dialog" aria-modal="true" aria-label="策略回测">
      <section className="backtest-dialog">
        <header>
          <div><span className="eyebrow">策略实验室</span><h2>{name} · 日线回测</h2><p>收盘生成信号，下一交易日开盘成交</p></div>
          <button type="button" aria-label="关闭回测" onClick={onClose}>×</button>
        </header>
        <div className="backtest-body">
          <aside className="backtest-config">
            <label>策略<select aria-label="回测策略" value={strategy} onChange={(event) => setStrategy(event.target.value as BacktestStrategy)}>
              {Object.entries(strategyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <div className="backtest-periods">
              <label>{strategy === 'breakout' ? '离场窗口' : '快线'}<input aria-label="快线或离场窗口" type="number" min="2" max="200" value={fast} onChange={(event) => setFast(Number(event.target.value))} /></label>
              <label>{strategy === 'breakout' ? '突破窗口' : '慢线'}<input aria-label="慢线或突破窗口" type="number" min="3" max="500" value={slow} onChange={(event) => setSlow(Number(event.target.value))} /></label>
              {strategy === 'macd' && <label>信号线<input aria-label="MACD信号周期" type="number" min="2" max="100" value={signal} onChange={(event) => setSignal(Number(event.target.value))} /></label>}
            </div>
            <label>初始资金<input aria-label="回测初始资金" type="number" min="1000" step="10000" value={initialCash} onChange={(event) => setInitialCash(Number(event.target.value))} /></label>
            <label>开始日期<input aria-label="回测开始日期" type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label>结束日期<input aria-label="回测结束日期" type="date" required value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label>
            <div className="backtest-assumptions"><strong>撮合假设</strong><span>佣金 0.03% · 最低5元</span><span>{market === 'CN' ? '卖出印花税 0.05% · 100股整手 · T+1' : '港股印花税暂设0 · 1股整手'}</span><span>滑点 2bp · 停牌/涨跌停不成交</span></div>
            <button className="backtest-run" type="button" disabled={running || !datesReady} title={datesReady ? undefined : '请先选择开始和结束日期'} onClick={execute}><Icon name="play" />{running ? '计算中…' : datesReady ? '运行回测' : '请选择日期'}</button>
          </aside>
          <main className="backtest-results">
            {!result ? <div className="backtest-empty"><Icon name="chart" /><strong>选择日期区间后再运行回测</strong><span>开始和结束日期都选好后才会计算资金曲线、风险收益和逐笔成交。</span></div> : <>
              <div className="backtest-result-heading"><div><strong>{strategyLabels[result.strategy]}</strong><span>{result.start_date} — {result.end_date}</span></div><span>{result.data_source}</span></div>
              <div className="backtest-metrics">
                <div><span>总收益</span><strong className={result.metrics.total_return >= 0 ? 'is-positive' : 'is-negative'}>{formatMetricPercent(result.metrics.total_return)}</strong></div>
                <div><span>年化收益</span><strong>{formatMetricPercent(result.metrics.annualized_return)}</strong></div>
                <div><span>最大回撤</span><strong className="is-negative">{formatMetricPercent(result.metrics.max_drawdown)}</strong></div>
                <div><span>夏普</span><strong>{result.metrics.sharpe_ratio.toFixed(2)}</strong></div>
                <div><span>胜率</span><strong>{formatMetricPercent(result.metrics.win_rate, false)}</strong></div>
                <div><span>期末资产</span><strong>¥{money(result.metrics.ending_equity)}</strong></div>
              </div>
              <div className="backtest-curve"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="回测资金曲线"><polyline points={chartPoints} /></svg><span>策略资金曲线</span></div>
              {result.warnings.length > 0 && <div className="backtest-warnings">{result.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
              <div className="backtest-trades"><table><thead><tr><th>日期</th><th>方向</th><th>成交价</th><th>数量</th><th>费用</th><th>已实现盈亏</th></tr></thead><tbody>
                {result.trades.map((trade, index) => <tr key={`${trade.date}-${trade.side}-${index}`}><td>{trade.date}</td><td className={trade.side === 'buy' ? 'is-positive' : 'is-negative'}>{trade.side === 'buy' ? '买入' : '卖出'}</td><td>{trade.price.toFixed(2)}</td><td>{trade.quantity}</td><td>{trade.fees.toFixed(2)}</td><td>{trade.realized_pnl == null ? '—' : trade.realized_pnl.toFixed(2)}</td></tr>)}
                {!result.trades.length && <tr><td colSpan={6}>该区间没有触发成交</td></tr>}
              </tbody></table></div>
              <small className="backtest-disclaimer">研究模型：{result.execution_model}。结果基于历史数据，不代表未来表现。</small>
            </>}
          </main>
        </div>
      </section>
    </div>
  )
}
