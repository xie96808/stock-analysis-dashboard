import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  getApiHealth,
  getMarketBars,
  getMarketQuote,
  type ApiHealth,
  type MarketAdjustment,
  type MarketBarsResponse,
  type MarketInstrument,
  type MarketQuoteResponse,
  type MarketTimeframe,
} from './api/client'
import { ChartWorkbench, type IndicatorConfig } from './components/ChartWorkbench'
import { Icon } from './components/Icon'
import { IntradayView } from './components/IntradayView'
import { JournalCalendar } from './components/JournalCalendar'
import { fixtureBars, type IntradayPoint, type StockBar } from './data/fixture'
import { emptyDrawingStore, type Drawing, type DrawingStore } from './drawings/model'
import './styles.css'

const timeframes = ['1分', '5分', '15分', '30分', '60分', '日K', '周K', '月K']

const timeframeValues: Record<string, MarketTimeframe> = {
  '1分': '1m',
  '5分': '5m',
  '15分': '15m',
  '30分': '30m',
  '60分': '60m',
  日K: '1d',
  周K: '1w',
  月K: '1M',
}

const adjustmentLabels: Record<MarketAdjustment, string> = {
  qfq: '前复权',
  none: '不复权',
  hfq: '后复权',
}

type FontScale = 'standard' | 'large' | 'xlarge'

const tools = [
  ['cursor', '选择'],
  ['trend', '趋势线'],
  ['horizontal', '水平线'],
  ['trend', '射线'],
  ['horizontal', '平行通道'],
  ['brush', '自由画笔'],
  ['brush', '荧光笔'],
  ['rectangle', '矩形区域'],
  ['rectangle', '锚定分布'],
  ['text', '文本'],
  ['measure', '测量'],
  ['eraser', '橡皮擦'],
] as const

type RecordItem = {
  id: number
  date: string
  time: string
  title: string
  body: string
  color: 'blue' | 'amber' | 'slate'
}

const initialRecords: RecordItem[] = [
  {
    id: 1,
    date: '2026-08-09',
    time: '18:42',
    title: '日线 · 量价等待确认',
    body: '收盘量能温和回升，等待下一交易日确认关键区间的承接。',
    color: 'blue',
  },
  {
    id: 2,
    date: '2026-08-09',
    time: '18:17',
    title: '结构观察',
    body: '价格回到前期成交密集区，观察后续突破是否有效。',
    color: 'amber',
  },
  {
    id: 3,
    date: '2026-08-03',
    time: '19:06',
    title: '日线 · 右侧确认前的预案',
    body: '反弹进入前期成交区，暂不追价，等待收盘确认。',
    color: 'slate',
  },
  {
    id: 4,
    date: '2026-07-28',
    time: '18:31',
    title: '低位结构观察',
    body: '低点附近出现缩量整理，先记录，不提前定义反转。',
    color: 'slate',
  },
]

function compactVolume(volume: number) {
  if (volume >= 100_000_000) return `${(volume / 100_000_000).toFixed(2)}亿`
  if (volume >= 10_000) return `${(volume / 10_000).toFixed(2)}万`
  return String(Math.round(volume))
}

function toStockBars(response: MarketBarsResponse): StockBar[] {
  return response.bars.map((bar) => ({
    date: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume,
  }))
}

function toIntradayPoints(response: MarketBarsResponse): IntradayPoint[] {
  let cumulativeValue = 0
  let cumulativeVolume = 0
  return response.bars.map((bar) => {
    const timestamp = Math.floor(new Date(`${bar.time.replace(' ', 'T')}:00+08:00`).getTime() / 1000)
    cumulativeValue += bar.close * bar.volume
    cumulativeVolume += bar.volume
    return {
      timestamp,
      price: bar.close,
      average: cumulativeVolume > 0 ? cumulativeValue / cumulativeVolume : bar.close,
      volume: bar.volume,
    }
  })
}

const fallbackInstrument: MarketInstrument = {
  symbol: '001280',
  key: 'SZSE:001280',
  market: 'CN',
  exchange: 'SZSE',
  provider_symbol: 'sz001280',
  currency: 'CNY',
  name: '中国铀业',
}

const defaultIndicators: IndicatorConfig = {
  maEnabled: true,
  maPeriods: [5, 10, 20, 30],
  emaEnabled: false,
  emaPeriod: 20,
  volumeEnabled: true,
  macdEnabled: true,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
}

export default function App() {
  const [bars, setBars] = useState<StockBar[]>(fixtureBars)
  const [instrument, setInstrument] = useState<MarketInstrument>(fallbackInstrument)
  const [quote, setQuote] = useState<MarketQuoteResponse | null>(null)
  const [symbolInput, setSymbolInput] = useState('001280')
  const [activeSymbol, setActiveSymbol] = useState('001280')
  const [adjustment, setAdjustment] = useState<MarketAdjustment>('qfq')
  const [marketState, setMarketState] = useState<'loading' | 'ready' | 'fallback' | 'error'>('loading')
  const [marketMeta, setMarketMeta] = useState({ source: 'deterministic-fixture', cached: false, delayed: true })
  const lastBar = bars.at(-1) ?? fixtureBars.at(-1)!
  const [hoverBar, setHoverBar] = useState<StockBar | null>(null)
  const [logPrice, setLogPrice] = useState(true)
  const [profileMode, setProfileMode] = useState<'overlay' | 'dock' | 'hidden'>('overlay')
  const [profileWidth, setProfileWidth] = useState(31)
  const [cleanMode, setCleanMode] = useState(false)
  const [indicatorOpen, setIndicatorOpen] = useState(false)
  const [indicators, setIndicators] = useState<IndicatorConfig>(() => {
    try {
      const saved = window.localStorage.getItem('dashboard-indicators-v1')
      return saved ? { ...defaultIndicators, ...JSON.parse(saved) as Partial<IndicatorConfig> } : defaultIndicators
    } catch {
      return defaultIndicators
    }
  })
  const [journalOpen, setJournalOpen] = useState(true)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [selectedJournalDate, setSelectedJournalDate] = useState('2026-08-09')
  const [selectedDay, setSelectedDay] = useState<StockBar | null>(null)
  const [intradayPoints, setIntradayPoints] = useState<IntradayPoint[]>([])
  const [intradayLoading, setIntradayLoading] = useState(false)
  const [timeframe, setTimeframe] = useState('日K')
  const [activeTool, setActiveTool] = useState('选择')
  const [snapMode, setSnapMode] = useState<'off' | 'weak' | 'strong'>('weak')
  const [workspace, setWorkspace] = useState('主分析')
  const [drawingStore, setDrawingStore] = useState<DrawingStore>(() => {
    try {
      const saved = window.localStorage.getItem('dashboard-drawings-v1')
      return saved ? JSON.parse(saved) as DrawingStore : emptyDrawingStore
    } catch {
      return emptyDrawingStore
    }
  })
  const [drawingHistory, setDrawingHistory] = useState<{ past: Drawing[][]; future: Drawing[][] }>({ past: [], future: [] })
  const [note, setNote] = useState('')
  const [records, setRecords] = useState(initialRecords)
  const [fontScale, setFontScale] = useState<FontScale>(() => {
    const saved = window.localStorage.getItem('dashboard-font-scale')
    return saved === 'standard' || saved === 'xlarge' ? saved : 'large'
  })
  const [apiHealth, setApiHealth] = useState<ApiHealth | null>(null)
  const [apiState, setApiState] = useState<'connecting' | 'ready' | 'offline'>('connecting')
  const [toast, setToast] = useState('P2 行情接入 · 正在读取真实收盘数据')

  const displayBar = hoverBar ?? lastBar
  const previousBar = bars.length > 1 ? bars[bars.length - 2] : null
  const referenceClose = quote?.previous_close ?? previousBar?.close ?? lastBar.close
  const latestPrice = quote?.last ?? lastBar.close
  const priceChange = latestPrice - referenceClose
  const priceChangePercent = referenceClose ? priceChange / referenceClose * 100 : 0
  const displayName = instrument.name || instrument.symbol
  const adjustmentLabel = adjustmentLabels[adjustment]
  const workspaceKey = `${instrument.key}::${workspace}`
  const drawings = drawingStore.workspaces[workspaceKey] ?? []
  const handleHoverBar = useCallback((bar: StockBar | null) => setHoverBar(bar), [])

  const displayDate = useMemo(() => {
    const source = displayBar.date.split('-')
    return `${source[0]}年${Number(source[1])}月${Number(source[2])}日`
  }, [displayBar.date])

  const journalDateLabel = useMemo(() => {
    const [year, month, day] = selectedJournalDate.split('-').map(Number)
    return `${year}年${month}月${day}日`
  }, [selectedJournalDate])

  const filteredRecords = useMemo(
    () => records.filter((record) => record.date === selectedJournalDate),
    [records, selectedJournalDate],
  )

  useEffect(() => {
    window.localStorage.setItem('dashboard-font-scale', fontScale)
  }, [fontScale])

  useEffect(() => {
    window.localStorage.setItem('dashboard-indicators-v1', JSON.stringify(indicators))
  }, [indicators])

  useEffect(() => {
    window.localStorage.setItem('dashboard-drawings-v1', JSON.stringify(drawingStore))
  }, [drawingStore])

  useEffect(() => {
    setDrawingHistory({ past: [], future: [] })
  }, [workspaceKey])

  useEffect(() => {
    const controller = new AbortController()
    getApiHealth(controller.signal)
      .then((health) => {
        setApiHealth(health)
        setApiState('ready')
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setApiState('offline')
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setMarketState('loading')
    setSelectedDay(null)
    setIntradayPoints([])
    const selectedTimeframe = timeframeValues[timeframe]
    Promise.all([
      getMarketBars(activeSymbol, {
        timeframe: selectedTimeframe,
        adjustment,
        limit: selectedTimeframe.endsWith('m') ? 640 : 520,
      }, controller.signal),
      getMarketQuote(activeSymbol, controller.signal).catch(() => null),
    ])
      .then(([response, currentQuote]) => {
        const nextBars = toStockBars(response)
        if (!nextBars.length) throw new Error('行情源未返回K线')
        const savedAdjustment = window.localStorage.getItem(`market-adjustment:${response.instrument.key}`)
        if (
          (savedAdjustment === 'qfq' || savedAdjustment === 'none' || savedAdjustment === 'hfq')
          && savedAdjustment !== adjustment
        ) {
          setInstrument(response.instrument)
          setAdjustment(savedAdjustment)
          return
        }
        setBars(nextBars)
        setInstrument(response.instrument)
        setQuote(currentQuote)
        setMarketMeta({ source: response.source, cached: response.cached, delayed: response.delayed })
        setMarketState('ready')
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (activeSymbol === '001280') {
          setBars(fixtureBars)
          setInstrument(fallbackInstrument)
          setMarketMeta({ source: 'deterministic-fixture', cached: false, delayed: true })
          setMarketState('fallback')
          notify('行情服务暂未连接，已保留可交互样例数据')
        } else {
          setMarketState('error')
          notify(error instanceof Error ? `代码或行情读取失败：${error.message}` : '代码或行情读取失败')
        }
      })
    return () => controller.abort()
  }, [activeSymbol, adjustment, timeframe])

  useEffect(() => {
    if (!selectedDay) return
    const controller = new AbortController()
    setIntradayLoading(true)
    getMarketBars(activeSymbol, {
      timeframe: '5m',
      adjustment: 'none',
      limit: 640,
      tradingDate: selectedDay.date.slice(0, 10),
    }, controller.signal)
      .then((response) => setIntradayPoints(toIntradayPoints(response)))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setIntradayPoints([])
        notify('该日期的5分钟行情不可用，分时面板使用本地拟合预览')
      })
      .finally(() => setIntradayLoading(false))
    return () => controller.abort()
  }, [activeSymbol, selectedDay])

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  const submitSymbol = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = symbolInput.trim()
    if (!value) {
      notify('请输入A股或港股代码')
      return
    }
    setActiveSymbol(value)
  }

  const replaceWorkspaceDrawings = useCallback((next: Drawing[]) => {
    setDrawingStore((current) => ({
      version: 1,
      workspaces: { ...current.workspaces, [workspaceKey]: next },
    }))
  }, [workspaceKey])

  const commitDrawings = useCallback((next: Drawing[]) => {
    setDrawingHistory((current) => ({ past: [...current.past.slice(-79), drawings], future: [] }))
    replaceWorkspaceDrawings(next)
  }, [drawings, replaceWorkspaceDrawings])

  const undoDrawing = () => {
    setDrawingHistory((current) => {
      const previous = current.past.at(-1)
      if (!previous) {
        notify('没有可撤销的画线操作')
        return current
      }
      replaceWorkspaceDrawings(previous)
      return { past: current.past.slice(0, -1), future: [drawings, ...current.future] }
    })
  }

  const redoDrawing = () => {
    setDrawingHistory((current) => {
      const next = current.future[0]
      if (!next) {
        notify('没有可重做的画线操作')
        return current
      }
      replaceWorkspaceDrawings(next)
      return { past: [...current.past, drawings], future: current.future.slice(1) }
    })
  }

  const addRecord = () => {
    const body = note.trim()
    if (!body) {
      notify('请先写下本次判断')
      return
    }

    setRecords((current) => [
      {
        id: Date.now(),
        date: selectedJournalDate,
        time: new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()),
        title: `${timeframe} · 手动记录`,
        body,
        color: 'blue',
      },
      ...current,
    ])
    setNote('')
    notify('已保存本次 Markdown 记录与图表快照占位')
  }

  return (
    <div className="app-shell" data-font-scale={fontScale}>
      <header className="app-header">
        <div className="brand" aria-label="研判看板">
          <span className="brand-mark">研</span>
          <span className="brand-name">研判</span>
          <span className="brand-phase">P5</span>
        </div>

        <form className="symbol-search" onSubmit={submitSymbol}>
          <Icon name="search" />
          <input
            value={symbolInput}
            onChange={(event) => setSymbolInput(event.target.value)}
            aria-label="股票代码"
            placeholder="A股 / 港股代码"
          />
          <button className="search-market" type="submit" title="加载代码">
            {marketState === 'loading' ? '…' : instrument.market === 'HK' ? 'HK' : instrument.exchange === 'SSE' ? 'SH' : instrument.exchange === 'BSE' ? 'BJ' : 'SZ'}
          </button>
        </form>

        <nav className="header-nav" aria-label="工作区导航">
          <button className="nav-item is-active">图表</button>
          <button className="nav-item" onClick={() => notify('复盘工作流将在 P6 接入')}>复盘</button>
          <button className="nav-item" onClick={() => notify(`${displayName} · ${marketMeta.source}${marketMeta.cached ? ' · 缓存命中' : ''}`)}>数据</button>
        </nav>

        <div className="header-actions">
          <label className="font-scale-control">
            <span>字号</span>
            <select
              aria-label="界面字号"
              value={fontScale}
              onChange={(event) => setFontScale(event.target.value as FontScale)}
            >
              <option value="standard">标准</option>
              <option value="large">大</option>
              <option value="xlarge">特大</option>
            </select>
          </label>
          <label className="workspace-select">
            <Icon name="layers" />
            <select value={workspace} onChange={(event) => setWorkspace(event.target.value)}>
              <option>主分析</option>
              <option>长期趋势</option>
              <option>短线计划</option>
            </select>
          </label>
          <button className="icon-button" title="导出截图" onClick={() => notify('高清截图导出将在 P7 接入')}><Icon name="camera" /></button>
          <button className="icon-button" title="全屏" onClick={() => notify('全屏模式将在视觉确认后接入')}><Icon name="fullscreen" /></button>
          <button className="icon-button" title="设置" onClick={() => notify('设置面板占位')}><Icon name="settings" /></button>
        </div>
      </header>

      <section className="quote-header">
        <div className="instrument">
          <div className="instrument-title">
            <span className="favorite">★</span>
            <strong>{displayName}</strong>
            <span className="instrument-code">{instrument.symbol}</span>
            <span className="market-tag">{instrument.exchange}</span>
          </div>
          <div className="instrument-price">
            <strong>{latestPrice.toFixed(2)}</strong>
            <span className={priceChange >= 0 ? '' : 'is-negative'}>{priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}</span>
            <span className={priceChangePercent >= 0 ? '' : 'is-negative'}>{priceChangePercent >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%</span>
          </div>
        </div>

        <div className="ohlc-strip">
          <span><small>开</small><b>{displayBar.open.toFixed(2)}</b></span>
          <span><small>高</small><b>{displayBar.high.toFixed(2)}</b></span>
          <span><small>低</small><b>{displayBar.low.toFixed(2)}</b></span>
          <span><small>收</small><b>{displayBar.close.toFixed(2)}</b></span>
          <span><small>成交量</small><b>{compactVolume(hoverBar ? displayBar.volume : (quote?.volume ?? displayBar.volume))}</b></span>
          <span className="quote-date"><small>数据日期</small><b>{displayDate}</b></span>
        </div>

        <div className="axis-toggle" aria-label="价格坐标">
          <button className={!logPrice ? 'is-active' : ''} onClick={() => setLogPrice(false)}>普通</button>
          <button className={logPrice ? 'is-active' : ''} onClick={() => setLogPrice(true)}>Log</button>
        </div>
      </section>

      <section className="chart-toolbar">
        <div className="timeframes">
          {timeframes.map((item) => (
            <button
              key={item}
              className={item === timeframe ? 'is-active' : ''}
              onClick={() => {
                setTimeframe(item)
                notify(`正在加载${item}真实行情`)
              }}
            >
              {item}
            </button>
          ))}
        </div>
        <span className="toolbar-divider" />
        <label className="inline-select">
          <span>{adjustmentLabel}</span>
          <Icon name="chevron" />
          <select
            aria-label="复权方式"
            value={adjustment}
            onChange={(event) => {
              const nextAdjustment = event.target.value as MarketAdjustment
              window.localStorage.setItem(`market-adjustment:${instrument.key}`, nextAdjustment)
              setAdjustment(nextAdjustment)
              notify(`正在加载${adjustmentLabels[nextAdjustment]}行情`)
            }}
          >
            <option value="qfq">前复权</option>
            <option value="none">不复权</option>
            <option value="hfq">后复权</option>
          </select>
        </label>
        <button className={`toolbar-toggle${profileMode !== 'hidden' ? ' is-active' : ''}`} onClick={() => setProfileMode((value) => value === 'hidden' ? 'overlay' : 'hidden')}>
          成交量分布
        </button>
        <label className="inline-select profile-mode-select">
          <span>分布 · {profileMode === 'overlay' ? '覆盖' : profileMode === 'dock' ? '停靠' : '隐藏'}</span>
          <select aria-label="成交量分布模式" value={profileMode} onChange={(event) => setProfileMode(event.target.value as 'overlay' | 'dock' | 'hidden')}>
            <option value="overlay">覆盖</option>
            <option value="dock">停靠</option>
            <option value="hidden">隐藏</option>
          </select>
        </label>
        {profileMode !== 'hidden' && <label className="profile-width-control" title={`分布宽度 ${profileWidth}%`}>
          <span>宽</span><input aria-label="成交量分布宽度" type="range" min="18" max="42" value={profileWidth} onChange={(event) => setProfileWidth(Number(event.target.value))} />
        </label>}
        <button className={`toolbar-toggle${cleanMode ? ' is-active' : ''}`} onClick={() => setCleanMode((value) => !value)}>
          纯净模式
        </button>
        <button className={`toolbar-toggle${indicatorOpen ? ' is-active' : ''}`} onClick={() => setIndicatorOpen((value) => !value)}>
          指标设置
        </button>
        <label className="inline-select snap-select">
          <span>吸附 · {snapMode === 'off' ? '关' : snapMode === 'weak' ? '弱' : '强'}</span>
          <select aria-label="画线吸附" value={snapMode} onChange={(event) => setSnapMode(event.target.value as 'off' | 'weak' | 'strong')}>
            <option value="off">关闭</option>
            <option value="weak">弱</option>
            <option value="strong">强</option>
          </select>
        </label>
        <button className="toolbar-action" onClick={() => notify('图表已恢复到建议范围')}>适应画面</button>
        <div className="toolbar-spacer" />
        <span className={`data-status is-${marketState}`} title={`数据源：${marketMeta.source}`}>
          <i />{marketState === 'loading' ? '读取行情' : marketState === 'fallback' ? '样例降级' : marketState === 'error' ? '读取失败' : `${marketMeta.delayed ? '延时' : '实时'}数据${marketMeta.cached ? ' · 缓存' : ''}`}
        </span>
        <button className="journal-toggle" onClick={() => setJournalOpen((value) => !value)}>
          <Icon name="journal" />
          研究记录
        </button>
      </section>

      {indicatorOpen && (
        <section className="indicator-popover" aria-label="指标参数设置">
          <div className="indicator-popover-heading">
            <div><span>指标参数</span><strong>主图与副图</strong></div>
            <button onClick={() => setIndicators(defaultIndicators)}>恢复默认</button>
          </div>
          <label className="indicator-check">
            <input type="checkbox" checked={indicators.maEnabled} onChange={(event) => setIndicators((current) => ({ ...current, maEnabled: event.target.checked }))} />
            <span>MA</span>
            <input
              aria-label="MA周期"
              value={indicators.maPeriods.join(',')}
              onChange={(event) => {
                const periods = event.target.value.split(',').map(Number).filter((value) => Number.isInteger(value) && value > 0 && value <= 500)
                if (periods.length) setIndicators((current) => ({ ...current, maPeriods: periods.slice(0, 6) }))
              }}
            />
          </label>
          <label className="indicator-check">
            <input type="checkbox" checked={indicators.emaEnabled} onChange={(event) => setIndicators((current) => ({ ...current, emaEnabled: event.target.checked }))} />
            <span>EMA</span>
            <input aria-label="EMA周期" type="number" min="2" max="500" value={indicators.emaPeriod} onChange={(event) => setIndicators((current) => ({ ...current, emaPeriod: Number(event.target.value) || 20 }))} />
          </label>
          <label className="indicator-check compact">
            <input type="checkbox" checked={indicators.volumeEnabled} onChange={(event) => setIndicators((current) => ({ ...current, volumeEnabled: event.target.checked }))} />
            <span>VOL 成交量</span>
          </label>
          <label className="indicator-check macd-config">
            <input type="checkbox" checked={indicators.macdEnabled} onChange={(event) => setIndicators((current) => ({ ...current, macdEnabled: event.target.checked }))} />
            <span>MACD</span>
            {(['macdFast', 'macdSlow', 'macdSignal'] as const).map((key) => (
              <input
                key={key}
                aria-label={key === 'macdFast' ? 'MACD快线' : key === 'macdSlow' ? 'MACD慢线' : 'MACD信号线'}
                type="number"
                min="2"
                max="200"
                value={indicators[key]}
                onChange={(event) => setIndicators((current) => ({ ...current, [key]: Number(event.target.value) || defaultIndicators[key] }))}
              />
            ))}
          </label>
          <span className="indicator-hint">拖动副图分隔线可调整面板高度；全部面板共享时间轴与十字光标。</span>
        </section>
      )}

      <main className={`workspace${journalOpen ? ' has-journal' : ''}`}>
        <aside className="drawing-rail" aria-label="画图工具">
          {tools.map(([icon, label]) => (
            <button
              key={label}
              className={activeTool === label ? 'is-active' : ''}
              aria-label={label}
              data-tooltip={label}
              onClick={() => {
                setActiveTool(label)
                notify(label === '选择' ? '选择、移动并编辑画线对象' : `${label}已启用；在主图价格区域拖动创建`)
              }}
            >
              <Icon name={icon} />
            </button>
          ))}
          <span className="rail-divider" />
          <button aria-label="撤销" data-tooltip="撤销" onClick={undoDrawing}><Icon name="undo" /></button>
          <button aria-label="重做" data-tooltip="重做" onClick={redoDrawing}><Icon name="redo" /></button>
        </aside>

        <section className="chart-region">
          <div className="chart-context">
            <div>
              <strong>{displayName} · {selectedDay ? `${selectedDay.date.slice(0, 10)} 分时` : timeframe}</strong>
              {!selectedDay && <span>{adjustmentLabel}</span>}
              {!selectedDay && <span className={logPrice ? 'log-badge is-log' : 'log-badge'}>{logPrice ? 'LOG' : '线性'}</span>}
              {selectedDay && <span className="intraday-source">{intradayLoading ? '正在加载5分钟行情' : intradayPoints.length ? '真实5分钟行情' : '本地拟合预览'}</span>}
            </div>
            <div className="chart-context-actions">
              {selectedDay ? (
                <button className="back-to-daily" onClick={() => setSelectedDay(null)}>← 返回日K</button>
              ) : <span>工作区：{workspace}</span>}
              <button onClick={() => notify('布局菜单占位')}><Icon name="more" /></button>
            </div>
          </div>
          {selectedDay ? (
            <IntradayView bar={selectedDay} points={intradayPoints} fontScale={fontScale} />
          ) : (
            <ChartWorkbench
              bars={bars}
              instrumentLabel={displayName}
              symbol={instrument.key}
              market={instrument.market}
              timeframe={timeframe}
              logPrice={logPrice}
              profileVisible={profileMode !== 'hidden' && !cleanMode}
              profileMode={profileMode}
              profileWidth={profileWidth}
              cleanMode={cleanMode}
              indicators={indicators}
              activeTool={activeTool}
              snapMode={snapMode}
              drawings={drawings}
              onCommitDrawings={commitDrawings}
              fontScale={fontScale}
              onHoverBar={handleHoverBar}
              onSelectBar={(bar) => {
                if (timeframe === '日K') setSelectedDay(bar)
              }}
            />
          )}
        </section>

        {journalOpen && (
          <aside className="journal-panel">
            <div className="journal-header">
              <div>
                <span className="eyebrow">研究日志</span>
                <h2>{journalDateLabel}</h2>
              </div>
              <button className="icon-button" title="收起" onClick={() => setJournalOpen(false)}><Icon name="collapse" /></button>
            </div>

            <div className="journal-summary">
              <div><strong>{filteredRecords.length}</strong><span>当日记录</span></div>
              <div><strong>1</strong><span>关联标的</span></div>
              <button className={calendarOpen ? 'is-active' : ''} onClick={() => setCalendarOpen((value) => !value)}><Icon name="calendar" />按日期查找</button>
            </div>

            {calendarOpen && (
              <JournalCalendar
                selectedDate={selectedJournalDate}
                recordDates={records.map((record) => record.date)}
                onSelect={setSelectedJournalDate}
                onClose={() => setCalendarOpen(false)}
              />
            )}

            <div className="note-composer">
              <div className="composer-title">
                <strong>记录本次判断</strong>
                <span>Markdown</span>
              </div>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="例如：记录本次判断、关键条件、观察区间与判断失效条件……"
              />
              <div className="composer-footer">
                <span>自动附带画线与截图</span>
                <button onClick={addRecord}><Icon name="save" />保存记录</button>
              </div>
            </div>

            <div className="record-list-heading">
              <strong>当日时间线</strong>
              <button onClick={() => notify('历史版本筛选将在 P6 接入')}>全部版本</button>
            </div>

            <div className="record-list">
              {filteredRecords.map((record) => (
                <article className="record-item" key={record.id}>
                  <div className={`record-dot ${record.color}`} />
                  <div className="record-copy">
                    <div className="record-meta"><time>{record.time}</time><span>{displayName}</span><span>v1</span></div>
                    <h3>{record.title}</h3>
                    <p>{record.body}</p>
                    <div className="record-actions">
                      <button onClick={() => notify('历史快照只读预览将在 P6 接入')}>查看快照</button>
                      <button onClick={() => notify('从历史记录加载工作区将在 P6 接入')}>加载</button>
                      <button
                        onClick={() => {
                          setRecords((current) => current.filter((item) => item.id !== record.id))
                          notify('本次会话已删除；持久化回收站将在 P6 接入')
                        }}
                      >删除</button>
                    </div>
                  </div>
                </article>
              ))}
              {filteredRecords.length === 0 && (
                <div className="record-empty">
                  <Icon name="calendar" />
                  <strong>这一天还没有记录</strong>
                  <span>可以在上方写下第一条 Markdown 笔记</span>
                </div>
              )}
            </div>

            <button className="journal-footer-button" onClick={() => notify('完整历史记录将在 P6 接入')}>
              查看全部历史记录
              <Icon name="chevron" />
            </button>
          </aside>
        )}
      </main>

      <footer className="status-bar">
        <span>工具：{activeTool}</span>
        <span>坐标：{logPrice ? 'Log 价格' : '普通价格'}</span>
        <span>时区：Asia/Shanghai</span>
        <span className={`api-state is-${apiState}`}>
          <i />{apiState === 'ready' ? `本地API · ${apiHealth?.version}` : apiState === 'connecting' ? '正在连接API' : '样例降级模式'}
        </span>
        <span className="status-spacer" />
        <span>{marketState === 'ready' ? `${marketMeta.source} · ${marketMeta.delayed ? '收盘/延时' : '实时'}` : '样例数据 · 非实时'}</span>
        <span>缩放：滚轮 / 触控板</span>
      </footer>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
