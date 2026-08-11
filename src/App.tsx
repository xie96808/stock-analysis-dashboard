import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  appendJournalRevision,
  createJournalRecord,
  exportJournalProject,
  exportJournalRecord,
  getApiHealth,
  getJournalRecord,
  getMarketBars,
  getMarketQuote,
  importJournalProject,
  listJournalRecords,
  permanentlyDeleteJournalRecord,
  recycleJournalRecord,
  resolveInstrument,
  restoreJournalRecord,
  searchInstruments,
  type ApiHealth,
  type InstrumentSuggestion,
  type JournalRecordDetail,
  type JournalRecordSummary,
  type MarketAdjustment,
  type MarketInstrument,
  type MarketQuoteResponse,
  type MarketTimeframe,
} from './api/client'
import { toBlob, toPng } from 'html-to-image'
import {
  ChartWorkbench,
  type DistributionMode,
  type IndicatorConfig,
  type ProfileLayout,
} from './components/ChartWorkbench'
import { BacktestPanel } from './components/BacktestPanel'
import { AlertPanel } from './components/AlertPanel'
import { WatchlistPanel } from './components/WatchlistPanel'
import { PortfolioPanel } from './components/PortfolioPanel'
import { Icon } from './components/Icon'
import { IntradayView } from './components/IntradayView'
import { JournalCalendar } from './components/JournalCalendar'
import { fixtureBars, type IntradayPoint, type StockBar } from './data/fixture'
import type { Drawing, DrawingStore } from './drawings/model'
import { resolveChipAsOfDate } from './distributions/model'
import { toIntradayPoints, toStockBars } from './market/transform'
import { marketSessionState } from './market/refreshSchedule'
import { parseDrawingStore, parseIndicatorConfig, shanghaiDateKey } from './state/preferences'
import { evaluateAlerts, parseAlertEvents, parseAlertRules, selectAlertBars, type AlertEvent, type AlertRule } from './alerts/model'
import { parseWatchlist, upsertWatchlist, type WatchlistItem } from './watchlist/model'
import { isCompleteMarketSymbol } from './search/model'
import './styles.css'

const LazyMarkdown = lazy(() => import('react-markdown'))

function MarkdownView({ children }: { children: string }) {
  return <Suspense fallback={<span>{children}</span>}><LazyMarkdown>{children}</LazyMarkdown></Suspense>
}

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
type VisibleDistributionMode = Exclude<DistributionMode, 'hidden'>

function savedDistributionMode(): DistributionMode {
  try {
    const saved = window.localStorage.getItem('dashboard-distribution-v2')
    const mode = saved ? (JSON.parse(saved) as { mode?: unknown }).mode : null
    return mode === 'chips' || mode === 'hidden' ? mode : 'volume'
  } catch {
    return 'volume'
  }
}

function savedProfileLayout(): ProfileLayout {
  try {
    const saved = window.localStorage.getItem('dashboard-distribution-v2')
    return saved && (JSON.parse(saved) as { layout?: unknown }).layout === 'dock' ? 'dock' : 'overlay'
  } catch {
    return 'overlay'
  }
}

function savedLastDistributionMode(): VisibleDistributionMode {
  try {
    const saved = window.localStorage.getItem('dashboard-distribution-v2')
    return saved && (JSON.parse(saved) as { lastMode?: unknown }).lastMode === 'chips' ? 'chips' : 'volume'
  } catch {
    return 'volume'
  }
}

function savedProfileWidth() {
  try {
    const saved = window.localStorage.getItem('dashboard-distribution-v2')
    const width = saved ? Number((JSON.parse(saved) as { width?: unknown }).width) : 31
    return Number.isFinite(width) ? Math.min(42, Math.max(18, width)) : 31
  } catch {
    return 31
  }
}

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
  id: string
  date: string
  time: string
  title: string
  body: string
  color: 'blue' | 'amber' | 'slate'
  version: number
  status: 'pending' | 'partial' | 'hit' | 'invalidated'
  deletedAt?: string | null
  screenshotPath?: string | null
}

const initialRecords: RecordItem[] = [
  {
    id: 'fixture-1',
    date: '2026-08-09',
    time: '18:42',
    title: '日线 · 量价等待确认',
    body: '收盘量能温和回升，等待下一交易日确认关键区间的承接。',
    color: 'blue',
    version: 1,
    status: 'pending',
  },
  {
    id: 'fixture-2',
    date: '2026-08-09',
    time: '18:17',
    title: '结构观察',
    body: '价格回到前期成交密集区，观察后续突破是否有效。',
    color: 'amber',
    version: 1,
    status: 'pending',
  },
  {
    id: 'fixture-3',
    date: '2026-08-03',
    time: '19:06',
    title: '日线 · 右侧确认前的预案',
    body: '反弹进入前期成交区，暂不追价，等待收盘确认。',
    color: 'slate',
    version: 1,
    status: 'pending',
  },
  {
    id: 'fixture-4',
    date: '2026-07-28',
    time: '18:31',
    title: '低位结构观察',
    body: '低点附近出现缩量整理，先记录，不提前定义反转。',
    color: 'slate',
    version: 1,
    status: 'pending',
  },
]

function compactVolume(volume: number) {
  if (volume >= 100_000_000) return `${(volume / 100_000_000).toFixed(2)}亿`
  if (volume >= 10_000) return `${(volume / 10_000).toFixed(2)}万`
  return String(Math.round(volume))
}

function formatFreshness(seconds: number) {
  if (seconds < 60) return `${seconds}秒`
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}分钟`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}小时`
  return `${Math.floor(seconds / 86_400)}天`
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

function recordFromSummary(record: JournalRecordSummary): RecordItem {
  return {
    id: record.id,
    date: record.date_key,
    time: new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(record.updated_at)),
    title: record.title,
    body: record.thesis_markdown,
    color: record.result_status === 'hit' ? 'blue' : record.result_status === 'invalidated' ? 'amber' : 'slate',
    version: record.version,
    status: record.result_status,
    deletedAt: record.deleted_at,
    screenshotPath: record.screenshot_path,
  }
}

export default function App() {
  const [bars, setBars] = useState<StockBar[]>(fixtureBars)
  const [chipBars, setChipBars] = useState<StockBar[]>(fixtureBars)
  const [dailyAlertBars, setDailyAlertBars] = useState<StockBar[]>(fixtureBars)
  const [instrument, setInstrument] = useState<MarketInstrument>(fallbackInstrument)
  const [quote, setQuote] = useState<MarketQuoteResponse | null>(null)
  const [symbolInput, setSymbolInput] = useState('')
  const [symbolSuggestions, setSymbolSuggestions] = useState<InstrumentSuggestion[]>([])
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false)
  const [symbolSearchLoading, setSymbolSearchLoading] = useState(false)
  const [symbolSuggestionIndex, setSymbolSuggestionIndex] = useState(0)
  const [activeSymbol, setActiveSymbol] = useState('001280')
  const [adjustment, setAdjustment] = useState<MarketAdjustment>('qfq')
  const [marketState, setMarketState] = useState<'loading' | 'ready' | 'fallback' | 'error'>('loading')
  const [marketMeta, setMarketMeta] = useState({
    source: 'deterministic-fixture', cached: false, delayed: true, fetchedAt: null as string | null,
    fallbackUsed: false, stale: false, freshnessSeconds: 0, qualityIssues: [] as string[], providerChain: [] as string[],
  })
  const [hoverBar, setHoverBar] = useState<StockBar | null>(null)
  const [logPrice, setLogPrice] = useState(true)
  const [percentPrice, setPercentPrice] = useState(false)
  const [distributionMode, setDistributionMode] = useState<DistributionMode>(savedDistributionMode)
  const [lastDistributionMode, setLastDistributionMode] = useState<VisibleDistributionMode>(savedLastDistributionMode)
  const [profileLayout, setProfileLayout] = useState<ProfileLayout>(savedProfileLayout)
  const [profileWidth, setProfileWidth] = useState(savedProfileWidth)
  const [chipAsOfDate, setChipAsOfDate] = useState<string | null>(null)
  const [cleanMode, setCleanMode] = useState(false)
  const [indicatorOpen, setIndicatorOpen] = useState(false)
  const [indicators, setIndicators] = useState<IndicatorConfig>(() => (
    parseIndicatorConfig(window.localStorage.getItem('dashboard-indicators-v1'), defaultIndicators)
  ))
  const [journalOpen, setJournalOpen] = useState(true)
  const [backtestOpen, setBacktestOpen] = useState(false)
  const [alertOpen, setAlertOpen] = useState(false)
  const [alertRules, setAlertRules] = useState<AlertRule[]>(() => parseAlertRules(window.localStorage.getItem('dashboard-alert-rules-v1')))
  const [alertEvents, setAlertEvents] = useState<AlertEvent[]>(() => parseAlertEvents(window.localStorage.getItem('dashboard-alert-events-v1')))
  const [watchlistOpen, setWatchlistOpen] = useState(false)
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(() => parseWatchlist(window.localStorage.getItem('dashboard-watchlist-v1')))
  const [portfolioOpen, setPortfolioOpen] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [selectedJournalDate, setSelectedJournalDate] = useState(shanghaiDateKey)
  const [selectedDay, setSelectedDay] = useState<StockBar | null>(null)
  const [intradayPoints, setIntradayPoints] = useState<IntradayPoint[]>([])
  const [intradayLoading, setIntradayLoading] = useState(false)
  const [timeframe, setTimeframe] = useState('日K')
  const [activeTool, setActiveTool] = useState('选择')
  const [snapMode, setSnapMode] = useState<'off' | 'weak' | 'strong'>('weak')
  const [candleTheme, setCandleTheme] = useState<'mono' | 'cn'>('mono')
  const [workspace, setWorkspace] = useState('主分析')
  const [drawingStore, setDrawingStore] = useState<DrawingStore>(() => (
    parseDrawingStore(window.localStorage.getItem('dashboard-drawings-v1'))
  ))
  const [drawingHistory, setDrawingHistory] = useState<{ past: Drawing[][]; future: Drawing[][] }>({ past: [], future: [] })
  const [note, setNote] = useState('')
  const [recordTitle, setRecordTitle] = useState('')
  const [recordTags, setRecordTags] = useState('')
  const [recordInvalidation, setRecordInvalidation] = useState('')
  const [recordConfidence, setRecordConfidence] = useState(60)
  const [recordStatus, setRecordStatus] = useState<'pending' | 'partial' | 'hit' | 'invalidated'>('pending')
  const [recordScenarios, setRecordScenarios] = useState({ bull: '', base: '', bear: '' })
  const [records, setRecords] = useState(initialRecords)
  const [deletedRecords, setDeletedRecords] = useState<RecordItem[]>([])
  const [journalState, setJournalState] = useState<'loading' | 'ready' | 'offline'>('loading')
  const [previewRecord, setPreviewRecord] = useState<JournalRecordDetail | null>(null)
  const [previewRevisionId, setPreviewRevisionId] = useState<string | null>(null)
  const [compareRevisions, setCompareRevisions] = useState(false)
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  const [pendingPermanentId, setPendingPermanentId] = useState<string | null>(null)
  const [historicalCutoff, setHistoricalCutoff] = useState<string | null>(null)
  const [importPath, setImportPath] = useState('')
  const [fontScale, setFontScale] = useState<FontScale>(() => {
    const saved = window.localStorage.getItem('dashboard-font-scale')
    return saved === 'standard' || saved === 'xlarge' ? saved : 'large'
  })
  const [apiHealth, setApiHealth] = useState<ApiHealth | null>(null)
  const [apiState, setApiState] = useState<'connecting' | 'ready' | 'offline'>('connecting')
  const [toast, setToast] = useState('正在连接本地行情与研究日志')
  const [marketRefreshRevision, setMarketRefreshRevision] = useState(0)
  const [marketRefreshing, setMarketRefreshing] = useState(false)
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(() => (
    window.localStorage.getItem('dashboard-auto-refresh-v1') === 'true'
  ))
  const [autoRefreshSession, setAutoRefreshSession] = useState(() => marketSessionState(new Date(), fallbackInstrument.market))
  const [viewResetRevision, setViewResetRevision] = useState(0)
  const [chartDataRevision, setChartDataRevision] = useState({ id: 0, preserveView: false })
  const toastTimerRef = useRef<number | null>(null)
  const marketRequestIdRef = useRef(0)
  const marketRefreshHandledRef = useRef(0)
  const intradayRefreshHandledRef = useRef(0)
  const alertEvaluationRef = useRef('')

  const notify = useCallback((message: string) => {
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current)
    setToast(message)
    toastTimerRef.current = window.setTimeout(() => {
      setToast('')
      toastTimerRef.current = null
    }, 2_600)
  }, [])

  const requestMarketRefresh = useCallback(() => {
    if (marketState === 'loading' || marketRefreshing) return
    setMarketRefreshRevision((current) => current + 1)
  }, [marketRefreshing, marketState])
  const requestMarketRefreshRef = useRef(requestMarketRefresh)
  requestMarketRefreshRef.current = requestMarketRefresh

  const chartBars = useMemo(
    () => historicalCutoff ? bars.filter((bar) => bar.date.slice(0, 10) <= historicalCutoff) : bars,
    [bars, historicalCutoff],
  )
  const chipLatestDate = chipBars.at(-1)?.date.slice(0, 10) ?? ''
  const effectiveChipAsOfDate = useMemo(
    () => resolveChipAsOfDate(chipBars.map((bar) => bar.date), chipAsOfDate, historicalCutoff),
    [chipAsOfDate, chipBars, historicalCutoff],
  )
  const lastBar = chartBars.at(-1) ?? bars.at(-1) ?? fixtureBars.at(-1)!
  const displayBar = hoverBar ?? lastBar
  const previousBar = chartBars.length > 1 ? chartBars[chartBars.length - 2] : null
  const referenceClose = historicalCutoff ? previousBar?.close ?? lastBar.close : quote?.previous_close ?? previousBar?.close ?? lastBar.close
  const latestPrice = historicalCutoff ? lastBar.close : quote?.last ?? lastBar.close
  const alertEvaluationBars = useMemo(
    () => selectAlertBars(dailyAlertBars, bars),
    [bars, dailyAlertBars],
  )
  const priceChange = latestPrice - referenceClose
  const priceChangePercent = referenceClose ? priceChange / referenceClose * 100 : 0
  const displayName = instrument.name || instrument.symbol
  const adjustmentLabel = adjustmentLabels[adjustment]
  const workspaceKey = `${instrument.key}::${workspace}`
  const drawings = drawingStore.workspaces[workspaceKey] ?? []
  const handleHoverBar = useCallback((bar: StockBar | null) => setHoverBar(bar), [])
  const handleSelectBar = useCallback((bar: StockBar) => {
    if (timeframe === '日K') setSelectedDay(bar)
  }, [timeframe])
  const handleSelectChipDate = useCallback((bar: StockBar) => {
    if (timeframe !== '日K' || instrument.market !== 'CN') return
    const date = bar.date.slice(0, 10)
    setChipAsOfDate(date)
    setDistributionMode('chips')
    setLastDistributionMode('chips')
    notify(`筹码分布已固定至${date}`)
  }, [instrument.market, notify, timeframe])
  const closeIntraday = useCallback(() => {
    setSelectedDay(null)
    setIntradayPoints([])
  }, [])
  const refreshJournal = useCallback(async (signal?: AbortSignal) => {
    const result = await listJournalRecords({ includeDeleted: true }, signal)
    setRecords(result.filter((record) => !record.deleted_at).map(recordFromSummary))
    setDeletedRecords(result.filter((record) => Boolean(record.deleted_at)).map(recordFromSummary))
    setJournalState('ready')
  }, [])

  const displayDate = useMemo(() => {
    const source = displayBar.date.slice(0, 10).split('-')
    return `${source[0]}年${Number(source[1])}月${Number(source[2])}日`
  }, [displayBar.date])

  const marketFetchedAtLabel = useMemo(() => {
    if (!marketMeta.fetchedAt) return '尚无成功刷新时间'
    const value = new Date(marketMeta.fetchedAt)
    if (!Number.isFinite(value.getTime())) return '刷新时间未知'
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(value)
  }, [marketMeta.fetchedAt])

  const journalDateLabel = useMemo(() => {
    const [year, month, day] = selectedJournalDate.split('-').map(Number)
    return `${year}年${month}月${day}日`
  }, [selectedJournalDate])

  const filteredRecords = useMemo(
    () => records.filter((record) => record.date === selectedJournalDate),
    [records, selectedJournalDate],
  )

  useEffect(() => () => {
    if (toastTimerRef.current != null) window.clearTimeout(toastTimerRef.current)
  }, [])

  useEffect(() => {
    if (apiState === 'ready' && journalState === 'ready' && toast === '正在连接本地行情与研究日志') {
      setToast('')
    }
  }, [apiState, journalState, toast])

  useEffect(() => {
    window.localStorage.setItem('dashboard-font-scale', fontScale)
  }, [fontScale])

  useEffect(() => {
    window.localStorage.setItem('dashboard-auto-refresh-v1', String(autoRefreshEnabled))
  }, [autoRefreshEnabled])

  useEffect(() => {
    window.localStorage.setItem('dashboard-alert-rules-v1', JSON.stringify(alertRules))
  }, [alertRules])

  useEffect(() => {
    window.localStorage.setItem('dashboard-alert-events-v1', JSON.stringify(alertEvents.slice(0, 100)))
  }, [alertEvents])

  useEffect(() => {
    window.localStorage.setItem('dashboard-watchlist-v1', JSON.stringify(watchlist))
  }, [watchlist])

  useEffect(() => {
    const query = symbolInput.trim()
    if (!query) {
      setSymbolSuggestions([])
      setSymbolSearchOpen(false)
      setSymbolSearchLoading(false)
      return
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setSymbolSearchLoading(true)
      searchInstruments(query, 5, controller.signal)
        .then((results) => {
          setSymbolSuggestions(results)
          setSymbolSuggestionIndex(0)
          setSymbolSearchOpen(true)
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setSymbolSuggestions([])
        })
        .finally(() => {
          if (!controller.signal.aborted) setSymbolSearchLoading(false)
        })
    }, 180)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [symbolInput])

  useEffect(() => {
    const updateSession = () => setAutoRefreshSession(marketSessionState(new Date(), instrument.market))
    updateSession()
    const timer = window.setInterval(() => {
      const session = marketSessionState(new Date(), instrument.market)
      setAutoRefreshSession(session)
      if (autoRefreshEnabled && session.open && document.visibilityState === 'visible') {
        requestMarketRefreshRef.current()
      }
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [autoRefreshEnabled, instrument.market])

  useEffect(() => {
    window.localStorage.setItem('dashboard-distribution-v2', JSON.stringify({
      mode: distributionMode,
      lastMode: lastDistributionMode,
      layout: profileLayout,
      width: profileWidth,
    }))
  }, [distributionMode, lastDistributionMode, profileLayout, profileWidth])

  useEffect(() => {
    setChipAsOfDate(null)
    setHistoricalCutoff(null)
    setHoverBar(null)
    setQuote(null)
    setDailyAlertBars([])
  }, [activeSymbol])

  useEffect(() => {
    if (marketState !== 'ready' || !alertEvaluationBars.length) return
    const relevantRules = alertRules.filter((rule) => rule.symbol === instrument.symbol)
    if (!relevantRules.length) return
    const alertDataDate = alertEvaluationBars.at(-1)?.date ?? ''
    const signature = JSON.stringify([instrument.symbol, marketMeta.fetchedAt, latestPrice, alertDataDate, relevantRules])
    if (signature === alertEvaluationRef.current) return
    alertEvaluationRef.current = signature
    const result = evaluateAlerts(relevantRules, alertEvaluationBars, latestPrice)
    if (result.changed) {
      const byId = new Map(result.rules.map((rule) => [rule.id, rule]))
      setAlertRules((current) => current.map((rule) => byId.get(rule.id) ?? rule))
    }
    if (result.events.length) {
      setAlertEvents((current) => [...result.events, ...current].slice(0, 100))
      notify(`条件提醒：${result.events[0].message}`)
    }
  }, [alertEvaluationBars, alertRules, instrument.symbol, latestPrice, marketMeta.fetchedAt, marketState, notify])

  useEffect(() => {
    if (instrument.market !== 'HK' || (distributionMode !== 'chips' && lastDistributionMode !== 'chips')) return
    if (distributionMode === 'chips') {
      setDistributionMode('volume')
      notify('港股暂保留成交量分布；筹码分布第一版使用A股换手口径')
    }
    setLastDistributionMode('volume')
  }, [distributionMode, instrument.market, lastDistributionMode])

  useEffect(() => {
    window.localStorage.setItem('dashboard-indicators-v1', JSON.stringify(indicators))
  }, [indicators])

  useEffect(() => {
    window.localStorage.setItem('dashboard-drawings-v1', JSON.stringify(drawingStore))
  }, [drawingStore])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.altKey) return
      if (event.key === '1') { setLogPrice(false); setPercentPrice(false) }
      if (event.key === '2') { setLogPrice(true); setPercentPrice(false) }
      if (event.key === '3') { setLogPrice(false); setPercentPrice(true) }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

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
    refreshJournal(controller.signal).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setJournalState('offline')
    })
    return () => controller.abort()
  }, [refreshJournal])

  useEffect(() => {
    const controller = new AbortController()
    const requestId = ++marketRequestIdRef.current
    const forceRefresh = marketRefreshRevision > marketRefreshHandledRef.current
    marketRefreshHandledRef.current = marketRefreshRevision
    if (forceRefresh) {
      setMarketRefreshing(true)
    } else {
      setMarketState('loading')
      setChipBars([])
      setSelectedDay(null)
      setIntradayPoints([])
      setHoverBar(null)
      setQuote(null)
    }
    const selectedTimeframe = timeframeValues[timeframe]
    const primaryBarsRequest = getMarketBars(activeSymbol, {
      timeframe: selectedTimeframe,
      adjustment,
      limit: selectedTimeframe.endsWith('m') ? 640 : 2000,
      refresh: forceRefresh,
    }, controller.signal)
    const chipAdjustment: MarketAdjustment = selectedTimeframe.endsWith('m') ? 'none' : adjustment
    const chipBarsRequest = selectedTimeframe === '1d' && chipAdjustment === adjustment
      ? primaryBarsRequest
      : getMarketBars(activeSymbol, {
        timeframe: '1d',
        adjustment: chipAdjustment,
        limit: 2000,
        refresh: forceRefresh,
      }, controller.signal)
    const alertBarsRequest = selectedTimeframe === '1d' && adjustment === 'qfq'
      ? primaryBarsRequest
      : getMarketBars(activeSymbol, {
        timeframe: '1d',
        adjustment: 'qfq',
        limit: 2000,
        refresh: forceRefresh,
      }, controller.signal)
    Promise.all([
      primaryBarsRequest,
      getMarketQuote(activeSymbol, controller.signal).catch(() => null),
      chipBarsRequest.catch(() => null),
      alertBarsRequest.catch(() => null),
    ])
      .then(([response, currentQuote, chipResponse, alertResponse]) => {
        if (requestId !== marketRequestIdRef.current) return
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
        setChartDataRevision((current) => ({ id: current.id + 1, preserveView: forceRefresh }))
        setBars(nextBars)
        setChipBars(chipResponse ? toStockBars(chipResponse) : selectedTimeframe === '1d' ? nextBars : [])
        setDailyAlertBars(alertResponse ? toStockBars(alertResponse) : [])
        setInstrument(response.instrument)
        setQuote(currentQuote)
        setMarketMeta({
          source: response.source,
          cached: response.cached,
          delayed: response.delayed,
          fetchedAt: response.fetched_at,
          fallbackUsed: response.fallback_used,
          stale: response.stale,
          freshnessSeconds: response.freshness_seconds,
          qualityIssues: response.quality_issues,
          providerChain: response.provider_chain,
        })
        setMarketState('ready')
        if (forceRefresh) notify(`已刷新${response.instrument.name ?? response.instrument.symbol}最新行情`)
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (requestId !== marketRequestIdRef.current) return
        if (forceRefresh) {
          notify(error instanceof Error ? `刷新失败，继续显示现有数据：${error.message}` : '刷新失败，继续显示现有数据')
          return
        }
        if (activeSymbol === '001280') {
          setBars(fixtureBars)
          setChipBars(fixtureBars)
          setDailyAlertBars(fixtureBars)
          setInstrument(fallbackInstrument)
          setMarketMeta({
            source: 'deterministic-fixture', cached: false, delayed: true, fetchedAt: null,
            fallbackUsed: false, stale: false, freshnessSeconds: 0, qualityIssues: [], providerChain: [],
          })
          setMarketState('fallback')
          notify('行情服务暂未连接，已保留可交互样例数据')
        } else {
          setMarketState('error')
          notify(error instanceof Error ? `代码或行情读取失败：${error.message}` : '代码或行情读取失败')
        }
      })
      .finally(() => {
        if (requestId === marketRequestIdRef.current) setMarketRefreshing(false)
      })
    return () => controller.abort()
  }, [activeSymbol, adjustment, marketRefreshRevision, notify, timeframe])

  useEffect(() => {
    if (!selectedDay) return
    const controller = new AbortController()
    const forceRefresh = marketRefreshRevision > intradayRefreshHandledRef.current
    intradayRefreshHandledRef.current = marketRefreshRevision
    setIntradayLoading(true)
    getMarketBars(activeSymbol, {
      timeframe: '5m',
      adjustment: 'none',
      limit: 640,
      tradingDate: selectedDay.date.slice(0, 10),
      refresh: forceRefresh,
    }, controller.signal)
      .then((response) => setIntradayPoints(toIntradayPoints(response)))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setIntradayPoints([])
        notify('该日期的5分钟行情不可用，分时面板使用本地拟合预览')
      })
      .finally(() => setIntradayLoading(false))
    return () => controller.abort()
  }, [activeSymbol, marketRefreshRevision, notify, selectedDay])

  useEffect(() => {
    if (!selectedDay) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeIntraday()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [closeIntraday, selectedDay])

  const loadSuggestion = useCallback((suggestion: InstrumentSuggestion) => {
    setActiveSymbol(suggestion.input)
    setSymbolInput('')
    setSymbolSuggestions([])
    setSymbolSearchOpen(false)
    setSymbolSuggestionIndex(0)
    notify(`正在加载${suggestion.name}（${suggestion.symbol}）`)
  }, [notify])

  const submitSymbol = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const value = symbolInput.trim()
    if (!value) {
      notify('请输入A股或港股代码')
      return
    }
    const selected = symbolSuggestions[symbolSuggestionIndex] ?? symbolSuggestions[0]
    if (selected) {
      loadSuggestion(selected)
      return
    }
    try {
      if (isCompleteMarketSymbol(value)) {
        const resolved = await resolveInstrument(value)
        setActiveSymbol(resolved.provider_symbol)
        setSymbolInput('')
        setSymbolSuggestions([])
        setSymbolSearchOpen(false)
        notify(`正在加载${resolved.symbol}`)
        return
      }
      const suggestions = await searchInstruments(value, 1)
      if (suggestions[0]) {
        loadSuggestion(suggestions[0])
        return
      }
      const resolved = await resolveInstrument(value)
      setActiveSymbol(resolved.provider_symbol)
      setSymbolInput('')
      setSymbolSuggestions([])
      setSymbolSearchOpen(false)
      notify(`正在加载${resolved.symbol}`)
    } catch (error) {
      notify(error instanceof Error ? `未找到“${value}”：${error.message}` : `未找到“${value}”`)
    }
  }

  const addCurrentToWatchlist = () => {
    const item: WatchlistItem = {
      key: instrument.key,
      symbol: instrument.symbol,
      name: displayName,
      market: instrument.market,
      exchange: instrument.exchange,
      status: 'pending',
      note: '',
      addedAt: new Date().toISOString(),
      reviewedAt: null,
    }
    const existed = watchlist.some((entry) => entry.key === item.key)
    setWatchlist((current) => upsertWatchlist(current, item))
    notify(existed ? `${displayName}已在自选股中` : `已将${displayName}加入自选股`)
  }

  const selectWatchlistItem = (item: WatchlistItem) => {
    setSymbolInput('')
    setActiveSymbol(item.symbol)
    setWatchlistOpen(false)
    notify(`正在加载自选股：${item.name}`)
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

  const addRecord = async () => {
    const body = note.trim()
    if (!body) {
      notify('请先写下本次判断')
      return
    }

    try {
      notify('正在冻结文字、画线、指标与高清图表快照…')
      const chartNode = document.querySelector<HTMLElement>('.chart-region')
      const screenshot = chartNode ? await toPng(chartNode, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: true,
        filter: (node) => !(node instanceof HTMLElement && node.classList.contains('drawing-inspector')),
      }) : undefined
      const revisionPayload = {
        title: recordTitle.trim() || `${timeframe} · ${body.split('\n')[0].replace(/^#+\s*/, '').slice(0, 42)}`,
        thesis_markdown: body,
        market_data_as_of: lastBar.date,
        chart_state: {
          timeframe, adjustment, logPrice, percentPrice, distributionMode, profileLayout, profileWidth,
          chipAsOfDate: effectiveChipAsOfDate, cleanMode, workspace,
          historicalCutoff, visibleBars: chartBars.length,
        },
        drawings: drawings as unknown as Array<Record<string, unknown>>,
        indicators: indicators as unknown as Record<string, unknown>,
        screenshot_data_url: screenshot,
        tags: recordTags.split(/[,，\s]+/).map((value) => value.trim()).filter(Boolean),
        scenarios: Object.entries(recordScenarios).filter(([, value]) => value.trim()).map(([kind, description]) => ({ kind, description })),
        invalidation: recordInvalidation.trim() || undefined,
        confidence: recordConfidence,
        result_status: recordStatus,
      }
      if (editingRecordId) {
        await appendJournalRevision(editingRecordId, revisionPayload)
      } else {
        await createJournalRecord({
          ...revisionPayload,
          date_key: selectedJournalDate,
          symbol: instrument.key,
          name: displayName,
          market: instrument.market,
          timeframe,
        })
      }
      await refreshJournal()
      setNote('')
      setRecordTitle('')
      setRecordTags('')
      setRecordInvalidation('')
      setEditingRecordId(null)
      notify(editingRecordId ? '新revision已追加，旧版本保持不变' : '研究记录、画线与图表快照已冻结保存')
    } catch (error) {
      notify(error instanceof Error ? `记录保存失败：${error.message}` : '记录保存失败')
    }
  }

  const openRecord = async (recordId: string) => {
    if (recordId.startsWith('fixture-')) {
      notify('本地API连接后可创建正式快照记录')
      return
    }
    try {
      const detail = await getJournalRecord(recordId)
      setPreviewRecord(detail)
      setPreviewRevisionId(detail.current_revision.id)
      setCompareRevisions(false)
    } catch (error) {
      notify(error instanceof Error ? error.message : '记录读取失败')
    }
  }

  const loadRevision = (mode: 'replace' | 'copy' | 'historical') => {
    if (!previewRecord) return
    const revision = previewRecord.revisions.find((item) => item.id === previewRevisionId) ?? previewRecord.current_revision
    const snapshotDrawings = revision.drawings as unknown as Drawing[]
    if (mode === 'copy') {
      replaceWorkspaceDrawings([...drawings, ...snapshotDrawings.map((drawing, index) => ({ ...drawing, id: `${drawing.id}-copy-${Date.now()}-${index}` }))])
    } else {
      replaceWorkspaceDrawings(snapshotDrawings)
    }
    const state = revision.chart_state
    if (typeof state.logPrice === 'boolean') setLogPrice(state.logPrice)
    if (typeof state.percentPrice === 'boolean') setPercentPrice(state.percentPrice)
    if (typeof state.timeframe === 'string' && timeframes.includes(state.timeframe)) setTimeframe(state.timeframe)
    if (state.adjustment === 'qfq' || state.adjustment === 'none' || state.adjustment === 'hfq') setAdjustment(state.adjustment)
    if (state.distributionMode === 'volume' || state.distributionMode === 'chips' || state.distributionMode === 'hidden') {
      setDistributionMode(state.distributionMode)
      if (state.distributionMode !== 'hidden') setLastDistributionMode(state.distributionMode)
    } else if (state.chipVisible === true) {
      setDistributionMode('chips')
      setLastDistributionMode('chips')
    } else if (state.profileMode === 'hidden') {
      setDistributionMode('hidden')
    }
    if (state.profileLayout === 'overlay' || state.profileLayout === 'dock') setProfileLayout(state.profileLayout)
    else if (state.profileMode === 'overlay' || state.profileMode === 'dock') setProfileLayout(state.profileMode)
    if (typeof state.profileWidth === 'number') setProfileWidth(Math.min(42, Math.max(18, state.profileWidth)))
    if (typeof state.chipAsOfDate === 'string') setChipAsOfDate(state.chipAsOfDate.slice(0, 10))
    if (mode === 'historical') setHistoricalCutoff(revision.market_data_as_of.slice(0, 10))
    setPreviewRecord(null)
    notify(mode === 'copy' ? '历史画线已复制到当前工作区' : mode === 'historical' ? '已进入当日视角，行情截止到记录时点' : '当前工作区已替换为历史快照')
  }

  const recycleRecord = async (recordId: string) => {
    if (recordId.startsWith('fixture-')) {
      setRecords((current) => current.filter((item) => item.id !== recordId))
      return
    }
    try {
      await recycleJournalRecord(recordId)
      await refreshJournal()
      notify('记录已移入回收站，可恢复')
    } catch (error) {
      notify(error instanceof Error ? `删除失败：${error.message}` : '删除失败')
    }
  }

  const beginAppendRecord = async (record: RecordItem) => {
    if (record.id.startsWith('fixture-')) {
      notify('正式记录可追加不可覆盖的版本')
      return
    }
    try {
      const detail = await getJournalRecord(record.id)
      setEditingRecordId(record.id)
      setNote(detail.current_revision.thesis_markdown)
      setRecordTitle(detail.current_revision.title)
      notify(`正在基于v${detail.current_revision.version}追加新版本`)
    } catch (error) {
      notify(error instanceof Error ? `版本读取失败：${error.message}` : '版本读取失败')
    }
  }

  const restoreRecordAction = async (recordId: string) => {
    try {
      await restoreJournalRecord(recordId)
      await refreshJournal()
      notify('记录已恢复')
    } catch (error) {
      notify(error instanceof Error ? `恢复失败：${error.message}` : '恢复失败')
    }
  }

  const permanentlyDeleteAction = async (recordId: string) => {
    if (pendingPermanentId !== recordId) {
      setPendingPermanentId(recordId)
      return
    }
    try {
      await permanentlyDeleteJournalRecord(recordId)
      setPendingPermanentId(null)
      await refreshJournal()
      notify('记录及全部revision已永久删除')
    } catch (error) {
      notify(error instanceof Error ? `永久删除失败：${error.message}` : '永久删除失败')
    }
  }

  const exportProjectAction = async () => {
    try {
      const result = await exportJournalProject()
      notify(`完整项目已导出：${result.path}`)
    } catch (error) {
      notify(error instanceof Error ? `项目导出失败：${error.message}` : '项目导出失败')
    }
  }

  const importProjectAction = async () => {
    if (!importPath.trim()) {
      notify('请先填写项目ZIP本地路径')
      return
    }
    try {
      const result = await importJournalProject(importPath.trim())
      await refreshJournal()
      notify(`已恢复${result.records}条记录/${result.revisions}个版本`)
    } catch (error) {
      notify(error instanceof Error ? `项目恢复失败：${error.message}` : '项目恢复失败')
    }
  }

  const exportRecordAction = async (recordId: string) => {
    try {
      const result = await exportJournalRecord(recordId)
      notify(`单条Markdown已导出：${result.record_markdown}`)
    } catch (error) {
      notify(error instanceof Error ? `记录导出失败：${error.message}` : '记录导出失败')
    }
  }

  const exportChartPng = async () => {
    const target = document.querySelector<HTMLElement>('.chart-region')
    if (!target) return
    try {
      notify('正在生成2×高清PNG…')
      const blob = await toBlob(target, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: true,
        filter: (node) => !(node instanceof HTMLElement && node.classList.contains('drawing-inspector')),
      })
      if (!blob) throw new Error('图表像素读取为空')
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.download = `${instrument.symbol}-${timeframe}-${lastBar.date.slice(0, 10)}.png`
      link.href = objectUrl
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
      notify('高清图表PNG已导出')
    } catch (error) {
      notify(error instanceof Error ? `截图导出失败：${error.message}` : '截图导出失败')
    }
  }

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch (error) {
      notify(error instanceof Error ? `全屏切换失败：${error.message}` : '全屏切换失败')
    }
  }

  return (
    <div className="app-shell" data-font-scale={fontScale}>
      <header className="app-header">
        <div className="brand" aria-label="研判看板">
          <span className="brand-mark">研</span>
          <span className="brand-name">研判</span>
          <span className="brand-phase">v1.0</span>
        </div>

        <form className="symbol-search" onSubmit={submitSymbol}>
          <Icon name="search" />
          <input
            value={symbolInput}
            onChange={(event) => {
              setSymbolInput(event.target.value)
              setSymbolSuggestions([])
              setSymbolSearchOpen(Boolean(event.target.value.trim()))
              setSymbolSuggestionIndex(0)
            }}
            onFocus={() => {
              if (symbolInput.trim()) setSymbolSearchOpen(true)
            }}
            onBlur={() => window.setTimeout(() => setSymbolSearchOpen(false), 120)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && symbolSuggestions.length) {
                event.preventDefault()
                setSymbolSearchOpen(true)
                setSymbolSuggestionIndex((current) => (current + 1) % symbolSuggestions.length)
              } else if (event.key === 'ArrowUp' && symbolSuggestions.length) {
                event.preventDefault()
                setSymbolSearchOpen(true)
                setSymbolSuggestionIndex((current) => (current - 1 + symbolSuggestions.length) % symbolSuggestions.length)
              } else if (event.key === 'Escape') {
                setSymbolSearchOpen(false)
              } else if (event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
            aria-label="股票代码"
            aria-autocomplete="list"
            aria-expanded={symbolSearchOpen}
            aria-controls="symbol-suggestions"
            autoComplete="off"
            placeholder="代码 / 名称"
          />
          {symbolInput && (
            <button
              className="symbol-search-clear"
              type="button"
              aria-label="清空搜索"
              title="清空搜索"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setSymbolInput('')
                setSymbolSuggestions([])
                setSymbolSearchOpen(false)
              }}
            >×</button>
          )}
          <button className="search-market" type="submit" title="加载代码">
            {marketState === 'loading' ? '…' : instrument.market === 'HK' ? 'HK' : instrument.exchange === 'SSE' ? 'SH' : instrument.exchange === 'BSE' ? 'BJ' : 'SZ'}
          </button>
          {symbolSearchOpen && (
            <div className="symbol-suggestions" id="symbol-suggestions" role="listbox" aria-label="标的联想">
              {symbolSearchLoading && !symbolSuggestions.length ? (
                <span className="symbol-suggestion-status">正在查找…</span>
              ) : symbolSuggestions.length ? symbolSuggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.exchange}:${suggestion.symbol}`}
                  type="button"
                  role="option"
                  aria-selected={index === symbolSuggestionIndex}
                  className={index === symbolSuggestionIndex ? 'is-active' : ''}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setSymbolSuggestionIndex(index)}
                  onClick={() => loadSuggestion(suggestion)}
                >
                  <span><strong>{suggestion.name}</strong><small>{suggestion.asset_type === 'etf' ? 'ETF' : suggestion.market === 'HK' ? '港股' : 'A股'}</small></span>
                  <em>{suggestion.symbol}</em>
                </button>
              )) : (
                <span className="symbol-suggestion-status">暂无匹配标的</span>
              )}
            </div>
          )}
        </form>

        <nav className="header-nav" aria-label="工作区导航">
          <button className={`nav-item${backtestOpen ? '' : ' is-active'}`} onClick={() => setBacktestOpen(false)}>图表</button>
          <button className="nav-item" onClick={() => { setJournalOpen(true); notify('研究日志已打开，可按日期查看预测与revision') }}>复盘</button>
          <button className={`nav-item${backtestOpen ? ' is-active' : ''}`} onClick={() => setBacktestOpen(true)}>回测</button>
          <button className={`nav-item${alertOpen ? ' is-active' : ''}`} onClick={() => setAlertOpen(true)}>提醒{alertRules.filter((rule) => rule.enabled).length ? ` ${alertRules.filter((rule) => rule.enabled).length}` : ''}</button>
          <button className={`nav-item${watchlistOpen ? ' is-active' : ''}`} onClick={() => setWatchlistOpen(true)}>自选 {watchlist.length}</button>
          <button className={`nav-item${portfolioOpen ? ' is-active' : ''}`} onClick={() => setPortfolioOpen(true)}>模拟</button>
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
          <button className="icon-button" title="导出高清PNG" aria-label="导出高清PNG" onClick={exportChartPng}><Icon name="camera" /></button>
          <button className="icon-button" title="全屏" onClick={toggleFullscreen}><Icon name="fullscreen" /></button>
          <button className="icon-button" title={`K线配色：${candleTheme === 'mono' ? '黑白' : '红涨绿跌'}`} onClick={() => { setCandleTheme((value) => value === 'mono' ? 'cn' : 'mono'); notify('K线配色已切换') }}><Icon name="settings" /></button>
        </div>
      </header>

      <section className="quote-header">
        <div className="instrument">
          <div className="instrument-title">
            <button className={`favorite${watchlist.some((item) => item.key === instrument.key) ? ' is-saved' : ''}`} type="button" aria-label="加入自选股" title="加入自选股" onClick={addCurrentToWatchlist}>★</button>
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
          <button className={!logPrice && !percentPrice ? 'is-active' : ''} onClick={() => { setLogPrice(false); setPercentPrice(false) }}>普通</button>
          <button className={logPrice ? 'is-active' : ''} onClick={() => { setLogPrice(true); setPercentPrice(false) }}>Log</button>
          <button className={percentPrice ? 'is-active' : ''} onClick={() => { setLogPrice(false); setPercentPrice(true) }}>%</button>
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
        <div className="distribution-switch" role="group" aria-label="分布类型">
          <span>分布</span>
          <button
            className={distributionMode === 'volume' ? 'is-active' : ''}
            type="button"
            onClick={() => {
              setDistributionMode('volume')
              setLastDistributionMode('volume')
              notify('已切换为可视区成交量分布')
            }}
          >成交量</button>
          <button
            className={distributionMode === 'chips' ? 'is-active' : ''}
            type="button"
            aria-disabled={instrument.market !== 'CN'}
            title={instrument.market === 'CN' ? '查看截至指定交易日的筹码成本分布' : '筹码分布第一版使用A股换手口径'}
            onClick={() => {
              if (instrument.market !== 'CN') return notify('筹码分布第一版仅对A股启用')
              setDistributionMode('chips')
              setLastDistributionMode('chips')
              notify(`筹码分布截至${effectiveChipAsOfDate}`)
            }}
          >筹码</button>
        </div>
        <button
          className={`toolbar-toggle distribution-visibility${distributionMode === 'hidden' ? '' : ' is-active'}`}
          type="button"
          title={distributionMode === 'hidden' ? '显示分布' : '隐藏分布'}
          onClick={() => {
            if (distributionMode === 'hidden') setDistributionMode(lastDistributionMode)
            else {
              setLastDistributionMode(distributionMode)
              setDistributionMode('hidden')
            }
          }}
        >{distributionMode === 'hidden' ? '显示' : '隐藏'}</button>
        {distributionMode === 'volume' && <label className="inline-select profile-mode-select">
          <span>{profileLayout === 'overlay' ? '覆盖' : '停靠'}</span>
          <Icon name="chevron" />
          <select aria-label="成交量分布布局" value={profileLayout} onChange={(event) => setProfileLayout(event.target.value as ProfileLayout)}>
            <option value="overlay">覆盖</option>
            <option value="dock">停靠</option>
          </select>
        </label>}
        {distributionMode !== 'hidden' && <label className="profile-width-control" title={`分布宽度 ${profileWidth}%`}>
          <span>宽</span><input aria-label="分布宽度" type="range" min="18" max="42" value={profileWidth} onChange={(event) => setProfileWidth(Number(event.target.value))} />
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
        <button className="toolbar-action" onClick={() => {
          setViewResetRevision((current) => current + 1)
          notify('图表已恢复到建议范围')
        }}>适应画面</button>
        <div className="toolbar-spacer" />
        <button
          className={`toolbar-action market-refresh${marketRefreshing ? ' is-refreshing' : ''}`}
          type="button"
          aria-label="刷新最新数据"
          title={`刷新最新数据 · 上次获取 ${marketFetchedAtLabel}`}
          disabled={marketState === 'loading' || marketRefreshing}
          onClick={requestMarketRefresh}
        ><Icon name="refresh" />{marketRefreshing ? '刷新中' : '刷新'}</button>
        <button
          className={`toolbar-toggle auto-refresh${autoRefreshEnabled ? ' is-active' : ''}`}
          type="button"
          aria-pressed={autoRefreshEnabled}
          title={`交易时段每15秒刷新；后台标签页自动暂停 · ${autoRefreshSession.label}`}
          onClick={() => {
            setAutoRefreshEnabled((value) => !value)
            notify(autoRefreshEnabled ? '已关闭15秒自动刷新' : `已开启15秒自动刷新 · ${autoRefreshSession.label}`)
          }}
        >自动15秒<span className={`auto-refresh-dot${autoRefreshSession.open ? ' is-open' : ''}`} /></button>
        <span
          className={`data-status is-${marketRefreshing ? 'loading' : marketMeta.stale ? 'error' : marketState}`}
          title={`数据源：${marketMeta.source} · 获取时间：${marketFetchedAtLabel} · 行情距今：${formatFreshness(marketMeta.freshnessSeconds)}${marketMeta.providerChain.length ? ` · 尝试：${marketMeta.providerChain.join(' → ')}` : ''}${marketMeta.qualityIssues.length ? ` · 提示：${marketMeta.qualityIssues.join('；')}` : ''}`}
        >
          <i />{marketRefreshing ? '正在获取最新数据' : marketState === 'loading' ? '读取行情' : marketState === 'fallback' ? '样例降级' : marketState === 'error' ? '读取失败' : marketMeta.stale ? '过期缓存 · 注意' : marketMeta.fallbackUsed ? '备用行情源' : `${marketMeta.delayed ? '延时' : '实时'}数据${marketMeta.cached ? ' · 缓存' : ''}`}
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
            <div className="indicator-popover-actions">
              <button onClick={() => setIndicators(defaultIndicators)}>恢复默认</button>
              <button className="indicator-popover-close" type="button" aria-label="关闭指标设置" title="关闭指标设置" onClick={() => setIndicatorOpen(false)}>×</button>
            </div>
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
              {!selectedDay && <span className={logPrice ? 'log-badge is-log' : 'log-badge'}>{percentPrice ? '%' : logPrice ? 'LOG' : '线性'}</span>}
              {historicalCutoff && <button className="historical-badge" onClick={() => setHistoricalCutoff(null)}>当日视角 · 截止{historicalCutoff} ×</button>}
              {selectedDay && <span className="intraday-source">{intradayLoading ? '正在加载5分钟行情' : intradayPoints.length ? '真实5分钟行情' : '本地拟合预览'}</span>}
            </div>
            <div className="chart-context-actions">
              {selectedDay ? (
                <button className="back-to-daily" onClick={closeIntraday}>← 返回日K</button>
              ) : <span>工作区：{workspace}</span>}
            </div>
          </div>
          {selectedDay ? (
            <IntradayView bar={selectedDay} points={intradayPoints} fontScale={fontScale} />
          ) : (
            <ChartWorkbench
              bars={chartBars}
              instrumentLabel={displayName}
              symbol={instrument.key}
              market={instrument.market}
              timeframe={timeframe}
              logPrice={logPrice}
              percentPrice={percentPrice}
              distributionMode={distributionMode}
              profileLayout={profileLayout}
              profileWidth={profileWidth}
              chipBars={chipBars}
              chipAsOfDate={effectiveChipAsOfDate}
              chipLatestDate={chipLatestDate}
              candleTheme={candleTheme}
              cleanMode={cleanMode}
              indicators={indicators}
              activeTool={activeTool}
              snapMode={snapMode}
              drawings={drawings}
              resetViewRevision={viewResetRevision}
              dataRevision={chartDataRevision.id}
              preserveViewOnDataChange={chartDataRevision.preserveView}
              onCommitDrawings={commitDrawings}
              fontScale={fontScale}
              onHoverBar={handleHoverBar}
              onSelectBar={handleSelectBar}
              onSelectChipDate={handleSelectChipDate}
              onResetChipDate={() => {
                setChipAsOfDate(null)
                notify(`筹码分布已恢复至最新交易日${chipLatestDate}`)
              }}
              onFinishDrawing={() => {
                setActiveTool('选择')
                notify('画线已创建，可拖动线条或端点微调；点击“完成画线”后锁定')
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
                <strong>{editingRecordId ? '追加历史版本' : '记录本次判断'}</strong>
                <span>{editingRecordId ? 'append-only revision' : 'Markdown'}</span>
              </div>
              <input className="record-title-input" value={recordTitle} onChange={(event) => setRecordTitle(event.target.value)} placeholder="标题（留空则自动生成）" />
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="例如：记录本次判断、关键条件、观察区间与判断失效条件……"
              />
              <div className="record-structure-grid">
                <input aria-label="记录标签" value={recordTags} onChange={(event) => setRecordTags(event.target.value)} placeholder="标签：趋势, 等待确认" />
                <input aria-label="失效条件" value={recordInvalidation} onChange={(event) => setRecordInvalidation(event.target.value)} placeholder="判断失效条件" />
                <input aria-label="看多情景" value={recordScenarios.bull} onChange={(event) => setRecordScenarios((current) => ({ ...current, bull: event.target.value }))} placeholder="看多情景" />
                <input aria-label="基准情景" value={recordScenarios.base} onChange={(event) => setRecordScenarios((current) => ({ ...current, base: event.target.value }))} placeholder="基准情景" />
                <input aria-label="看空情景" value={recordScenarios.bear} onChange={(event) => setRecordScenarios((current) => ({ ...current, bear: event.target.value }))} placeholder="看空情景" />
                <select aria-label="验证状态" value={recordStatus} onChange={(event) => setRecordStatus(event.target.value as typeof recordStatus)}>
                  <option value="pending">待验证</option><option value="partial">部分符合</option><option value="hit">命中</option><option value="invalidated">失效</option>
                </select>
                <label className="confidence-control">置信度 {recordConfidence}%<input aria-label="主观置信度" type="range" min="0" max="100" value={recordConfidence} onChange={(event) => setRecordConfidence(Number(event.target.value))} /></label>
              </div>
              <div className="composer-footer">
                <span>冻结Markdown、画线、指标、坐标与2×截图</span>
                <button onClick={addRecord}><Icon name="save" />{editingRecordId ? '保存新版本' : '保存记录'}</button>
              </div>
              {editingRecordId && <button className="cancel-revision" onClick={() => setEditingRecordId(null)}>取消追加版本</button>}
            </div>

            <div className="record-list-heading">
              <strong>当日时间线</strong>
              <button className={trashOpen ? 'is-active' : ''} onClick={() => setTrashOpen((value) => !value)}>{trashOpen ? '返回时间线' : `回收站 ${deletedRecords.length}`}</button>
            </div>

            <div className="record-list">
              {(trashOpen ? deletedRecords : filteredRecords).map((record) => (
                <article className="record-item" key={record.id}>
                  <div className={`record-dot ${record.color}`} />
                  <div className="record-copy">
                    <div className="record-meta"><time>{record.time}</time><span>{displayName}</span><span>v{record.version}</span><span>{record.status}</span></div>
                    <h3>{record.title}</h3>
                    <div className="record-markdown"><MarkdownView>{record.body}</MarkdownView></div>
                    <div className="record-actions">
                      {!trashOpen && <>
                        <button onClick={() => openRecord(record.id)}>查看快照</button>
                        <button onClick={() => beginAppendRecord(record)}>追加版本</button>
                        <button onClick={() => openRecord(record.id)}>加载</button>
                        <button onClick={() => recycleRecord(record.id)}>删除</button>
                      </>}
                      {trashOpen && <>
                        <button onClick={() => restoreRecordAction(record.id)}>恢复</button>
                        <button className="danger-link" onClick={() => permanentlyDeleteAction(record.id)}>{pendingPermanentId === record.id ? '再次点击永久删除' : '永久删除'}</button>
                      </>}
                    </div>
                  </div>
                </article>
              ))}
              {(trashOpen ? deletedRecords.length : filteredRecords.length) === 0 && (
                <div className="record-empty">
                  <Icon name="calendar" />
                  <strong>{trashOpen ? '回收站为空' : '这一天还没有记录'}</strong>
                  <span>{trashOpen ? '移入回收站的记录可在此恢复' : '可以在上方写下第一条 Markdown 笔记'}</span>
                </div>
              )}
            </div>

            <button className="journal-footer-button" onClick={exportProjectAction}>
              导出全部历史与校验清单
              <Icon name="chevron" />
            </button>
            <div className="journal-import-row">
              <input value={importPath} onChange={(event) => setImportPath(event.target.value)} placeholder="粘贴项目ZIP本地路径" />
              <button onClick={importProjectAction}>恢复</button>
            </div>
            <span className={`journal-storage-state is-${journalState}`}>{journalState === 'ready' ? 'SQLite事实库 · 每日备份30份' : journalState === 'loading' ? '正在读取SQLite' : 'API离线 · 当前展示本地样例'}</span>
          </aside>
        )}
      </main>

      {backtestOpen && <BacktestPanel
        symbol={instrument.symbol}
        name={displayName}
        market={instrument.market}
        onClose={() => setBacktestOpen(false)}
        onMessage={notify}
      />}

      {alertOpen && <AlertPanel
        symbol={instrument.symbol}
        name={displayName}
        price={latestPrice}
        rules={alertRules}
        events={alertEvents}
        onRulesChange={setAlertRules}
        onClearEvents={() => setAlertEvents((current) => current.filter((event) => event.symbol !== instrument.symbol))}
        onClose={() => setAlertOpen(false)}
        onMessage={notify}
      />}

      {watchlistOpen && <WatchlistPanel
        currentKey={instrument.key}
        items={watchlist}
        onChange={setWatchlist}
        onSelect={selectWatchlistItem}
        onClose={() => setWatchlistOpen(false)}
        onMessage={notify}
      />}

      {portfolioOpen && <PortfolioPanel
        symbol={instrument.symbol}
        name={displayName}
        market={instrument.market}
        currentPrice={latestPrice}
        onClose={() => setPortfolioOpen(false)}
        onMessage={notify}
      />}

      {previewRecord && (() => {
        const revision = previewRecord.revisions.find((item) => item.id === previewRevisionId) ?? previewRecord.current_revision
        const previous = previewRecord.revisions.find((item) => item.version === revision.version - 1)
        return (
          <div className="snapshot-modal" role="dialog" aria-modal="true" aria-label="历史记录快照">
            <div className="snapshot-dialog">
              <header>
                <div><span>只读历史快照</span><h2>{revision.title}</h2><small>{previewRecord.date_key} · {previewRecord.symbol} · 数据截止 {revision.market_data_as_of}</small></div>
                <button aria-label="关闭快照" onClick={() => setPreviewRecord(null)}>×</button>
              </header>
              <div className="snapshot-version-bar">
                <label>版本<select aria-label="历史版本" value={revision.id} onChange={(event) => setPreviewRevisionId(event.target.value)}>{previewRecord.revisions.map((item) => <option key={item.id} value={item.id}>v{item.version} · {new Date(item.created_at).toLocaleString('zh-CN')}</option>)}</select></label>
                <span>旧版本永久保留</span>
                <button className={compareRevisions ? 'is-active' : ''} disabled={!previous} onClick={() => setCompareRevisions((value) => !value)}>与v{revision.version - 1}对比</button>
              </div>
              <div className={`snapshot-content${compareRevisions && previous ? ' is-comparing' : ''}`}>
                <section>
                  {revision.screenshot_path ? <img src={`/api/journal/artifact?path=${encodeURIComponent(revision.screenshot_path)}`} alt={`v${revision.version}图表快照`} /> : <div className="snapshot-missing">该版本没有PNG快照</div>}
                  <div className="snapshot-markdown"><MarkdownView>{revision.thesis_markdown}</MarkdownView></div>
                </section>
                {compareRevisions && previous && <section>
                  <h3>v{previous.version} · {previous.title}</h3>
                  {previous.screenshot_path ? <img src={`/api/journal/artifact?path=${encodeURIComponent(previous.screenshot_path)}`} alt={`v${previous.version}图表快照`} /> : <div className="snapshot-missing">该版本没有PNG快照</div>}
                  <div className="snapshot-markdown"><MarkdownView>{previous.thesis_markdown}</MarkdownView></div>
                </section>}
              </div>
              <footer>
                <button onClick={() => loadRevision('historical')}>以当日视角查看</button>
                <button onClick={() => loadRevision('copy')}>复制画线到当前工作区</button>
                <button onClick={() => loadRevision('replace')}>用快照替换工作区</button>
                <button onClick={() => exportRecordAction(previewRecord.id)}>导出Markdown/PNG/JSON</button>
                <button className="primary" onClick={() => { setEditingRecordId(previewRecord.id); setNote(revision.thesis_markdown); setRecordTitle(revision.title); setPreviewRecord(null) }}>基于此版本追加修订</button>
              </footer>
            </div>
          </div>
        )
      })()}

      <footer className="status-bar">
        <span>工具：{activeTool}</span>
        <span>坐标：{percentPrice ? '百分比' : logPrice ? 'Log 价格' : '普通价格'}</span>
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
