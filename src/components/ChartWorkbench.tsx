import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  type BusinessDay,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
  type WhitespaceData,
} from 'lightweight-charts'
import { calculateMacd, movingAverage, type StockBar } from '../data/fixture'
import { placeIntradayPrompt, supportsIntraday } from '../chart/intraday'
import type { Drawing } from '../drawings/model'
import { DrawingLayer } from './DrawingLayer'
import { calculateVolumeProfile } from '../profile/calculate'
import { ChipCostPanel } from './ChipCostPanel'
import { calculateChipCostEstimate } from '../chips/calculate'
import { distributionVisibility, type DistributionMode } from '../distributions/model'
import { extendedChipPanelHeight } from '../chips/panelPosition'

export type { DistributionMode } from '../distributions/model'
export type ProfileLayout = 'overlay' | 'dock'

export type IndicatorConfig = {
  maEnabled: boolean
  maPeriods: number[]
  emaEnabled: boolean
  emaPeriod: number
  volumeEnabled: boolean
  macdEnabled: boolean
  macdFast: number
  macdSlow: number
  macdSignal: number
}

type Props = {
  bars: StockBar[]
  instrumentLabel: string
  symbol: string
  market: 'CN' | 'HK'
  timeframe: string
  logPrice: boolean
  percentPrice: boolean
  distributionMode: DistributionMode
  profileLayout: ProfileLayout
  profileWidth: number
  chipBars: StockBar[]
  chipAsOfDate: string
  chipLatestDate: string
  candleTheme: 'mono' | 'cn'
  cleanMode: boolean
  indicators: IndicatorConfig
  activeTool: string
  snapMode: 'off' | 'weak' | 'strong'
  drawings: Drawing[]
  onCommitDrawings: (next: Drawing[]) => void
  fontScale: 'standard' | 'large' | 'xlarge'
  onHoverBar: (bar: StockBar | null) => void
  onSelectBar: (bar: StockBar) => void
  onSelectChipDate: (bar: StockBar) => void
  onResetChipDate: () => void
  onFinishDrawing: () => void
}

type OverlayGeometry = {
  profile: { y: number; width: number; sell: number; buy: number; emphasis: boolean; inValueArea: boolean; price: number }[]
  profileStats: { poc: number; vah: number; val: number; pocY: number | null; vahY: number | null; valY: number | null }
  profileSource: 'visible' | 'anchored'
  chips: { y: number; price: number; weight: number; profitable: boolean }[]
  chipStats: { currentY: number | null; averageY: number | null }
  mainPaneHeight: number
  chartHeight: number
  width: number
  revision: number
}

type IntradayPrompt = {
  bar: StockBar
  x: number
  y: number
}

function businessDay(date: string): BusinessDay {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number)
  return { year, month, day }
}

function chartTime(value: string): Time {
  if (!value.includes(' ')) return businessDay(value)
  return Math.floor(new Date(`${value.replace(' ', 'T')}:00+08:00`).getTime() / 1000) as UTCTimestamp
}

function timeKey(time: Time): string {
  if (typeof time === 'number') return `t:${time}`
  if (typeof time === 'string') return `s:${time}`
  return `d:${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`
}

function formatTime(time: Time) {
  if (typeof time === 'number') {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(time * 1000))
  }
  if (typeof time === 'string') return time
  return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`
}

function createFutureTradingDates(after: string, count = 270) {
  const cursor = new Date(`${after.slice(0, 10)}T00:00:00Z`)
  const values: string[] = []
  while (values.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6) values.push(cursor.toISOString().slice(0, 10))
  }
  return values
}

function formatVolume(value: number) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(0)}万`
  return `${Math.round(value)}`
}

function averageVolume(bars: StockBar[], length: number) {
  const values = bars.slice(-length)
  if (!values.length) return 0
  return values.reduce((sum, bar) => sum + bar.volume, 0) / values.length
}

export function ChartWorkbench({
  bars,
  instrumentLabel,
  symbol,
  market,
  timeframe,
  logPrice,
  percentPrice,
  distributionMode,
  profileLayout,
  profileWidth,
  chipBars,
  chipAsOfDate,
  chipLatestDate,
  candleTheme,
  cleanMode,
  indicators,
  activeTool,
  snapMode,
  drawings,
  onCommitDrawings,
  fontScale,
  onHoverBar,
  onSelectBar,
  onSelectChipDate,
  onResetChipDate,
  onFinishDrawing,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const intradayPromptRef = useRef<HTMLDivElement>(null)
  // Keep UI callbacks outside the chart-construction effect. Hovering updates
  // the quote strip in App, which re-renders this component; rebuilding the
  // chart on that render resets a user's wheel zoom and produces a visible
  // full-canvas flash.
  const onHoverBarRef = useRef(onHoverBar)
  const onSelectBarRef = useRef(onSelectBar)
  const onSelectChipDateRef = useRef(onSelectChipDate)
  const activeToolRef = useRef(activeTool)
  onHoverBarRef.current = onHoverBar
  onSelectBarRef.current = onSelectBar
  onSelectChipDateRef.current = onSelectChipDate
  activeToolRef.current = activeTool
  const [intradayPrompt, setIntradayPrompt] = useState<IntradayPrompt | null>(null)
  const [geometry, setGeometry] = useState<OverlayGeometry>({
    profile: [],
    profileStats: { poc: 0, vah: 0, val: 0, pocY: null, vahY: null, valY: null },
    profileSource: 'visible',
    chips: [],
    chipStats: { currentY: null, averageY: null },
    mainPaneHeight: 420,
    chartHeight: 0,
    width: 0,
    revision: 0,
  })

  const byTime = useMemo(() => new Map(bars.map((bar) => [timeKey(chartTime(bar.date)), bar])), [bars])
  const macd = useMemo(
    () => calculateMacd(bars, indicators.macdFast, indicators.macdSlow, indicators.macdSignal),
    [bars, indicators.macdFast, indicators.macdSignal, indicators.macdSlow],
  )
  const anchoredRange = useMemo(() => {
    const anchor = drawings.filter((drawing) => drawing.type === 'profile-range' && !drawing.hidden).at(-1)
    if (!anchor || anchor.anchors.length < 2) return null
    return [Math.min(anchor.anchors[0].timestampMs, anchor.anchors[1].timestampMs), Math.max(anchor.anchors[0].timestampMs, anchor.anchors[1].timestampMs)] as const
  }, [drawings])
  const latestBar = bars.at(-1)
  const latestMacd = macd.at(-1)
  const chipSourceBars = useMemo(
    () => chipBars.filter((bar) => bar.date.slice(0, 10) <= chipAsOfDate),
    [chipAsOfDate, chipBars],
  )
  const chipCurrentPrice = chipSourceBars.at(-1)?.close ?? 0
  const chipEstimate = useMemo(
    () => calculateChipCostEstimate(chipSourceBars, chipCurrentPrice),
    [chipCurrentPrice, chipSourceBars],
  )
  // A historical chip date changes only the overlay. Keeping it behind a ref
  // prevents that change from rebuilding the Lightweight Charts instance and
  // calling fitContent(), which would discard the user's current wheel zoom.
  const chipEstimateRef = useRef(chipEstimate)
  const refreshGeometryRef = useRef<() => void>(() => {})
  chipEstimateRef.current = chipEstimate
  // Base the chart time type on the payload, not the selected button. During a
  // fast period switch React can briefly render the previous response; mixing
  // BusinessDay and UTCTimestamp in one series would make Lightweight Charts fail.
  const isMinute = bars[0]?.date.includes(' ') ?? timeframe.endsWith('分')
  const chartFontSize = fontScale === 'standard' ? 15 : fontScale === 'large' ? 16 : 18
  const priceScaleWidth = fontScale === 'xlarge' ? 92 : fontScale === 'large' ? 84 : 78
  const visibleDistribution = distributionVisibility(distributionMode, cleanMode, market)
  const chipPanelHeight = extendedChipPanelHeight(geometry.mainPaneHeight, geometry.chartHeight, geometry.chartHeight)

  useEffect(() => {
    const host = hostRef.current
    if (!host || !bars.length) return

    const chart = createChart(host, {
      width: host.clientWidth,
      height: host.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#535967',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
        fontSize: chartFontSize,
        attributionLogo: false,
        panes: { separatorColor: '#e5e8ee', separatorHoverColor: '#c7cedb', enableResize: true },
      },
      localization: {
        locale: 'zh-CN',
        priceFormatter: (price: number) => price.toFixed(2),
        timeFormatter: formatTime,
      },
      grid: {
        vertLines: { color: '#eef0f4', style: LineStyle.Solid },
        horzLines: { color: '#eef0f4', style: LineStyle.Solid },
      },
      rightPriceScale: {
        visible: true,
        borderColor: '#dde1e8',
        scaleMargins: { top: 0.09, bottom: 0.08 },
        minimumWidth: priceScaleWidth,
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor: '#dde1e8',
        timeVisible: isMinute,
        secondsVisible: false,
        rightOffset: isMinute ? 3 : 6,
        barSpacing: isMinute ? 7 : 5.4,
        minBarSpacing: 1.1,
        maxBarSpacing: 24,
        minimumHeight: 35,
        tickMarkMaxCharacterLength: 10,
        tickMarkFormatter: formatTime,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#87909f', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#2d333f' },
        horzLine: { color: '#87909f', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#2d333f' },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: candleTheme === 'cn' ? '#e65b70' : '#ffffff',
      downColor: candleTheme === 'cn' ? '#2eaa7b' : '#17191f',
      borderUpColor: candleTheme === 'cn' ? '#e65b70' : '#17191f',
      borderDownColor: candleTheme === 'cn' ? '#2eaa7b' : '#17191f',
      wickUpColor: candleTheme === 'cn' ? '#e65b70' : '#17191f',
      wickDownColor: candleTheme === 'cn' ? '#2eaa7b' : '#17191f',
      priceLineVisible: false,
      lastValueVisible: true,
    })
    const candleData: Array<CandlestickData<Time> | WhitespaceData<Time>> = bars.map((bar) => ({
      time: chartTime(bar.date),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }))
    const futureDates = !isMinute && latestBar ? createFutureTradingDates(latestBar.date) : []
    candleData.push(...futureDates.map((date) => ({ time: businessDay(date) })))
    candleSeries.setData(candleData)

    if (!cleanMode && indicators.maEnabled) {
      const palette = ['#20242c', '#d79b27', '#e05a76', '#3eaa70', '#8157c7']
      indicators.maPeriods.forEach((period, paletteIndex) => {
        const values = movingAverage(bars, period)
        const series = chart.addSeries(LineSeries, {
          color: palette[paletteIndex % palette.length],
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        series.setData(values.flatMap((value, index) => value == null ? [] : [{ time: chartTime(bars[index].date), value }]))
      })
    }

    if (!cleanMode && indicators.emaEnabled) {
      const values = movingAverage(bars, indicators.emaPeriod, true)
      const series = chart.addSeries(LineSeries, {
        color: '#8b61d6',
        lineWidth: 2,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      series.setData(values.flatMap((value, index) => value == null ? [] : [{ time: chartTime(bars[index].date), value }]))
    }

    if (futureDates.length && latestBar) {
      const futureSpaceSeries = chart.addSeries(LineSeries, {
        color: 'rgba(255,255,255,0)',
        lineVisible: false,
        pointMarkersVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      futureSpaceSeries.setData([
        { time: businessDay(latestBar.date), value: latestBar.close },
        ...futureDates.map((date) => ({ time: businessDay(date), value: latestBar.close })),
      ])
    }

    let nextPane = 1
    const volumePane = !cleanMode && indicators.volumeEnabled ? nextPane++ : null
    const macdPane = !cleanMode && indicators.macdEnabled ? nextPane++ : null

    if (volumePane != null) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
      color: '#8a93a1',
      priceScaleId: 'vol',
      }, volumePane)
      volumeSeries.setData(bars.map((bar) => ({
        time: chartTime(bar.date),
        value: bar.volume,
        color: bar.close >= bar.open ? '#d4d9e1' : '#333943',
      })))
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.16, bottom: 0 }, borderVisible: false })
    }

    if (macdPane != null) {
      const macdHistogram = chart.addSeries(HistogramSeries, {
        priceScaleId: 'macd', priceLineVisible: false, lastValueVisible: false,
      }, macdPane)
      macdHistogram.setData(macd.map((point) => ({
        time: chartTime(point.date),
        value: point.histogram,
        color: point.histogram >= 0 ? '#e95b71' : '#32b7a5',
      })))
      const difSeries = chart.addSeries(LineSeries, {
        priceScaleId: 'macd', color: '#e59c24', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      }, macdPane)
      difSeries.setData(macd.map((point) => ({ time: chartTime(point.date), value: point.dif })))
      const deaSeries = chart.addSeries(LineSeries, {
        priceScaleId: 'macd', color: '#566ee8', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      }, macdPane)
      deaSeries.setData(macd.map((point) => ({ time: chartTime(point.date), value: point.dea })))
      macdHistogram.priceScale().applyOptions({ scaleMargins: { top: 0.14, bottom: 0.1 }, borderVisible: false })
    }

    chartRef.current = chart
    candleRef.current = candleSeries
    const updateGeometry = () => {
      const currentChipEstimate = chipEstimateRef.current
      const visibleRange = chart.timeScale().getVisibleLogicalRange()
      if (visibleRange) {
        host.dataset.visibleLogicalFrom = visibleRange.from.toFixed(4)
        host.dataset.visibleLogicalTo = visibleRange.to.toFixed(4)
      } else {
        delete host.dataset.visibleLogicalFrom
        delete host.dataset.visibleLogicalTo
      }
      const visibleBars = visibleRange
        ? bars.slice(Math.max(0, Math.floor(visibleRange.from)), Math.min(bars.length, Math.ceil(visibleRange.to) + 1))
        : bars
      const anchoredBars = anchoredRange
        ? bars.filter((bar) => {
          const timestamp = bar.date.includes(' ')
            ? new Date(`${bar.date.replace(' ', 'T')}:00+08:00`).getTime()
            : new Date(`${bar.date.slice(0, 10)}T00:00:00+08:00`).getTime()
          return timestamp >= anchoredRange[0] && timestamp <= anchoredRange[1]
        })
        : []
      const profileResult = calculateVolumeProfile(anchoredBars.length ? anchoredBars : visibleBars.length ? visibleBars : bars, 48, 0.7, logPrice)
      const profile = profileResult.rows.flatMap((row) => {
        const y = candleSeries.priceToCoordinate(row.price)
        return y == null ? [] : [{
          y,
          width: row.total,
          sell: row.sell,
          buy: row.buy,
          emphasis: row.emphasis,
          inValueArea: row.inValueArea,
          price: row.price,
        }]
      })
      const chips = currentChipEstimate.rows.flatMap((row) => {
        const y = candleSeries.priceToCoordinate(row.price)
        return y == null ? [] : [{ y, price: row.price, weight: row.weight, profitable: row.profitable }]
      })
      setGeometry((current) => ({
        profile,
        profileStats: {
          poc: profileResult.poc,
          vah: profileResult.vah,
          val: profileResult.val,
          pocY: candleSeries.priceToCoordinate(profileResult.poc),
          vahY: candleSeries.priceToCoordinate(profileResult.vah),
          valY: candleSeries.priceToCoordinate(profileResult.val),
        },
        profileSource: anchoredBars.length ? 'anchored' : 'visible',
        chips,
        chipStats: {
          currentY: candleSeries.priceToCoordinate(currentChipEstimate.currentPrice),
          averageY: candleSeries.priceToCoordinate(currentChipEstimate.averageCost),
        },
        mainPaneHeight: chart.panes()[0]?.getHeight() ?? host.clientHeight * 0.64,
        chartHeight: host.clientHeight,
        width: host.clientWidth,
        revision: current.revision + 1,
      }))
    }
    refreshGeometryRef.current = updateGeometry

    chart.timeScale().fitContent()
    const mainRatio = nextPane === 1 ? 0.94 : nextPane === 2 ? 0.76 : 0.62
    chart.panes()[0]?.setHeight(Math.round(host.clientHeight * mainRatio))
    if (volumePane != null) chart.panes()[volumePane]?.setHeight(Math.round(host.clientHeight * 0.15))
    if (macdPane != null) chart.panes()[macdPane]?.setHeight(Math.round(host.clientHeight * 0.19))
    requestAnimationFrame(updateGeometry)

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        onHoverBarRef.current(null)
        return
      }
      onHoverBarRef.current(byTime.get(timeKey(param.time)) ?? null)
    })
    chart.subscribeClick((param) => {
      if (!supportsIntraday(timeframe, activeToolRef.current) || !param.time || !param.point) {
        setIntradayPrompt(null)
        return
      }
      const bar = byTime.get(timeKey(param.time))
      if (!bar) {
        setIntradayPrompt(null)
        return
      }
      const position = placeIntradayPrompt(
        param.point,
        { width: host.clientWidth, height: host.clientHeight },
        { width: 224, height: market === 'CN' ? 158 : 116 },
      )
      setIntradayPrompt({
        bar,
        ...position,
      })
    })
    let profileTimer = 0
    const scheduleProfile = () => {
      window.clearTimeout(profileTimer)
      profileTimer = window.setTimeout(updateGeometry, 140)
    }
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleProfile)

    const observer = new ResizeObserver(() => {
      chart.resize(host.clientWidth, host.clientHeight)
      chart.panes()[0]?.setHeight(Math.round(host.clientHeight * mainRatio))
      if (volumePane != null) chart.panes()[volumePane]?.setHeight(Math.round(host.clientHeight * 0.15))
      if (macdPane != null) chart.panes()[macdPane]?.setHeight(Math.round(host.clientHeight * 0.19))
      requestAnimationFrame(updateGeometry)
    })
    observer.observe(host)
    return () => {
      window.clearTimeout(profileTimer)
      observer.disconnect()
      if (refreshGeometryRef.current === updateGeometry) refreshGeometryRef.current = () => {}
      chart.remove()
      chartRef.current = null
      candleRef.current = null
    }
  }, [anchoredRange, bars, byTime, candleTheme, cleanMode, fontScale, indicators, isMinute, latestBar, logPrice, macd, market, timeframe])

  useEffect(() => {
    const frame = requestAnimationFrame(() => refreshGeometryRef.current())
    return () => cancelAnimationFrame(frame)
  }, [chipEstimate])

  useEffect(() => {
    const series = candleRef.current
    const chart = chartRef.current
    if (!series || !chart) return
    series.priceScale().applyOptions({ mode: percentPrice ? PriceScaleMode.Percentage : logPrice ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal })
    requestAnimationFrame(() => {
      chart.timeScale().scrollToPosition(isMinute ? 3 : 6, false)
      window.dispatchEvent(new Event('resize'))
    })
  }, [isMinute, logPrice, percentPrice])

  useEffect(() => {
    setIntradayPrompt(null)
  }, [symbol, timeframe])

  useEffect(() => {
    if (!intradayPrompt) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIntradayPrompt(null)
    }
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !intradayPromptRef.current?.contains(event.target)) {
        setIntradayPrompt(null)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    return () => {
      window.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
    }
  }, [intradayPrompt])

  const profileLevels = useMemo(() => {
    const source = [
      { name: 'VAH', price: geometry.profileStats.vah, y: geometry.profileStats.vahY },
      { name: 'POC', price: geometry.profileStats.poc, y: geometry.profileStats.pocY },
      { name: 'VAL', price: geometry.profileStats.val, y: geometry.profileStats.valY },
    ].filter((item): item is { name: string; price: number; y: number } => item.y != null).sort((left, right) => left.y - right.y)
    source.forEach((item, index) => {
      if (index > 0 && item.y - source[index - 1].y < 24) item.y = source[index - 1].y + 24
    })
    const overflow = (source.at(-1)?.y ?? 0) - (geometry.mainPaneHeight - 14)
    if (overflow > 0) source.forEach((item) => { item.y -= overflow })
    return source
  }, [geometry.mainPaneHeight, geometry.profileStats])

  return (
    <div className="chart-stage" aria-label={`${instrumentLabel}${timeframe}图表`}>
      <div ref={hostRef} className="chart-canvas" />
      <DrawingLayer
        chart={chartRef.current}
        candleSeries={candleRef.current}
        width={geometry.width}
        mainPaneHeight={geometry.mainPaneHeight}
        viewportRevision={geometry.revision}
        symbol={symbol}
        market={market}
        timeframe={timeframe}
        activeTool={activeTool}
        bars={bars}
        snapMode={snapMode}
        drawings={drawings}
        onCommit={onCommitDrawings}
        onFinishCreate={onFinishDrawing}
      />
      {intradayPrompt && supportsIntraday(timeframe, activeTool) && (
        <div
          ref={intradayPromptRef}
          className="intraday-prompt"
          role="dialog"
          aria-label={`${intradayPrompt.bar.date.slice(0, 10)} 日K操作`}
          style={{ left: intradayPrompt.x, top: intradayPrompt.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="intraday-prompt-heading">
            <span>{intradayPrompt.bar.date.slice(0, 10)}</span>
            <button type="button" aria-label="关闭日K操作菜单" onClick={() => setIntradayPrompt(null)}>×</button>
          </div>
          <div className="intraday-prompt-ohlc">
            <span>开 {intradayPrompt.bar.open.toFixed(2)}</span>
            <span>收 {intradayPrompt.bar.close.toFixed(2)}</span>
          </div>
          <button
            type="button"
            className="intraday-prompt-action"
            onClick={() => {
              onSelectBarRef.current(intradayPrompt.bar)
              setIntradayPrompt(null)
            }}
          >
            查看当日分时图
          </button>
          {market === 'CN' && <button
            type="button"
            className="intraday-prompt-action is-secondary"
            onClick={() => {
              onSelectChipDateRef.current(intradayPrompt.bar)
              setIntradayPrompt(null)
            }}
          >
            查看截至当日筹码
          </button>}
        </div>
      )}
      {visibleDistribution.chips && (
        <ChipCostPanel
          estimate={chipEstimate}
          rows={geometry.chips}
          mainPaneHeight={geometry.mainPaneHeight}
          panelHeight={chipPanelHeight}
          width={profileWidth}
          priceScaleOffset={priceScaleWidth}
          currentY={geometry.chipStats.currentY}
          averageY={geometry.chipStats.averageY}
          isLatest={chipAsOfDate === chipLatestDate}
          onResetToLatest={onResetChipDate}
        />
      )}
      {!cleanMode && indicators.volumeEnabled && <div className="pane-label pane-label-volume" style={{ top: geometry.mainPaneHeight + 10 }}>
        <strong>VOL</strong>
        <span>{formatVolume(latestBar?.volume ?? 0)}</span>
        <span className="pane-label-muted">MA5 {formatVolume(averageVolume(bars, 5))}</span>
        <span className="pane-label-muted">MA10 {formatVolume(averageVolume(bars, 10))}</span>
      </div>}
      {!cleanMode && indicators.macdEnabled && <div className="pane-label pane-label-macd" style={{ top: geometry.mainPaneHeight + (indicators.volumeEnabled ? 124 : 10) }}>
        <strong>MACD {indicators.macdFast} {indicators.macdSlow} {indicators.macdSignal}</strong>
        <span className="macd-orange">DIF {latestMacd?.dif.toFixed(2) ?? '--'}</span>
        <span className="macd-blue">DEA {latestMacd?.dea.toFixed(2) ?? '--'}</span>
        <span>柱 {latestMacd?.histogram.toFixed(2) ?? '--'}</span>
      </div>}

      {visibleDistribution.volume && (
        <div
          className="volume-profile"
          data-mode={profileLayout}
          style={{ height: geometry.mainPaneHeight, width: `${profileWidth}%`, right: priceScaleWidth }}
          aria-label={geometry.profileSource === 'anchored' ? '锚定区间成交量分布' : '可视区成交量分布'}
        >
          <div className="profile-heading">{geometry.profileSource === 'anchored' ? '锚定区间' : '可视区'}成交量分布</div>
          {geometry.profile.map((row, index) => {
            const maxWidth = Math.max(...geometry.profile.map((item) => item.width), 1)
            return (
              <div
                key={`${row.y}-${index}`}
                className={`profile-row${row.emphasis ? ' is-poc' : ''}${row.inValueArea ? ' is-value-area' : ''}`}
                style={{ top: row.y, width: `${Math.max(3, row.width / maxWidth * 100)}%` }}
              >
                <span className="profile-sell" style={{ flex: row.sell }} />
                <span className="profile-buy" style={{ flex: row.buy }} />
              </div>
            )
          })}
          <div className="profile-legend">
            <span><i className="legend-sell" />主动卖</span>
            <span><i className="legend-buy" />主动买</span>
          </div>
          {profileLevels.map((level) => (
            <div key={level.name} className={`profile-level is-${level.name.toLowerCase()}`} style={{ top: level.y }}>
              <span>{level.name}</span><strong>{level.price.toFixed(2)}</strong>
            </div>
          ))}
        </div>
      )}

      <div className="chart-watermark">{instrumentLabel}</div>
    </div>
  )
}
