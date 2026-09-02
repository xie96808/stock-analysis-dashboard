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
import { bollingerBands, calculateMacd, movingAverage, parabolicSar, type StockBar } from '../data/fixture'
import { placeIntradayPrompt, supportsIntraday } from '../chart/intraday'
import type { Drawing } from '../drawings/model'
import { DrawingLayer } from './DrawingLayer'
import { calculateVolumeProfile } from '../profile/calculate'
import { ChipCostPanel } from './ChipCostPanel'
import { calculateChipCostEstimate } from '../chips/calculate'
import { distributionVisibility, type DistributionMode } from '../distributions/model'
import { extendedChipPanelHeight } from '../chips/panelPosition'
import { resolveChipOverlayGeometry } from '../chips/geometry'
import { barsInVisibleTimeRange } from '../profile/visibleRange'
import { preservePriceModeViewport } from '../chart/priceModeViewport'
import { createFutureProjectionDates, futureProjectionBarCount } from '../chart/projection'

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
  bollEnabled: boolean
  bollPeriod: number
  bollMultiplier: number
  sarEnabled: boolean
  sarStep: number
  sarMax: number
  eventsEnabled: boolean
}

export type CorporateEventMarker = {
  kind: 'dividend' | 'earnings'
  date: string
  label: string
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
  corporateEvents?: CorporateEventMarker[]
  activeTool: string
  snapMode: 'off' | 'weak' | 'strong'
  drawings: Drawing[]
  resetViewRevision: number
  dataRevision: number
  preserveViewOnDataChange: boolean
  onCommitDrawings: (next: Drawing[]) => void
  fontScale: 'standard' | 'large' | 'xlarge'
  colorMode: 'light' | 'dark'
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
  chipScaleMode: 'chart' | 'cost'
  chipScaleRange: [number, number] | null
  mainPaneHeight: number
  chartHeight: number
  width: number
  revision: number
  events: { x: number; label: string; kind: 'dividend' | 'earnings' }[]
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
  corporateEvents = [],
  activeTool,
  snapMode,
  drawings,
  resetViewRevision,
  dataRevision,
  preserveViewOnDataChange,
  onCommitDrawings,
  fontScale,
  colorMode,
  onHoverBar,
  onSelectBar,
  onSelectChipDate,
  onResetChipDate,
  onFinishDrawing,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const visibleLogicalRangeRef = useRef<{ from: number; to: number } | null>(null)
  const viewIdentityRef = useRef('')
  const appliedDataRevisionRef = useRef(dataRevision)
  const intradayPromptRef = useRef<HTMLDivElement>(null)
  // Keep UI callbacks outside the chart-construction effect. Hovering updates
  // the quote strip in App, which re-renders this component; rebuilding the
  // chart on that render resets a user's wheel zoom and produces a visible
  // full-canvas flash.
  const onHoverBarRef = useRef(onHoverBar)
  const onSelectBarRef = useRef(onSelectBar)
  const onSelectChipDateRef = useRef(onSelectChipDate)
  const activeToolRef = useRef(activeTool)
  const logPriceRef = useRef(logPrice)
  const corporateEventsRef = useRef(corporateEvents)
  onHoverBarRef.current = onHoverBar
  onSelectBarRef.current = onSelectBar
  onSelectChipDateRef.current = onSelectChipDate
  activeToolRef.current = activeTool
  logPriceRef.current = logPrice
  corporateEventsRef.current = corporateEvents
  const [intradayPrompt, setIntradayPrompt] = useState<IntradayPrompt | null>(null)
  const [selectedProfilePrice, setSelectedProfilePrice] = useState<number | null>(null)
  const [geometry, setGeometry] = useState<OverlayGeometry>({
    profile: [],
    profileStats: { poc: 0, vah: 0, val: 0, pocY: null, vahY: null, valY: null },
    profileSource: 'visible',
    chips: [],
    chipStats: { currentY: null, averageY: null },
    chipScaleMode: 'chart',
    chipScaleRange: null,
    mainPaneHeight: 420,
    chartHeight: 0,
    width: 0,
    revision: 0,
    events: [],
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
    const viewIdentity = `${symbol}|${timeframe}|${isMinute ? 'minute' : 'daily'}`
    const dataChanged = appliedDataRevisionRef.current !== dataRevision
    const restoreRange = viewIdentityRef.current === viewIdentity && (!dataChanged || preserveViewOnDataChange)
      ? visibleLogicalRangeRef.current
      : null
    if (viewIdentityRef.current !== viewIdentity) visibleLogicalRangeRef.current = null
    viewIdentityRef.current = viewIdentity
    appliedDataRevisionRef.current = dataRevision

    const chart = createChart(host, {
      width: host.clientWidth,
      height: host.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: colorMode === 'dark' ? '#121722' : '#ffffff' },
        textColor: colorMode === 'dark' ? '#aeb8c8' : '#535967',
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
        fontSize: chartFontSize,
        attributionLogo: false,
        panes: {
          separatorColor: colorMode === 'dark' ? '#2a3342' : '#e5e8ee',
          separatorHoverColor: colorMode === 'dark' ? '#48566b' : '#c7cedb',
          enableResize: true,
        },
      },
      localization: {
        locale: 'zh-CN',
        priceFormatter: (price: number) => price.toFixed(2),
        timeFormatter: formatTime,
      },
      grid: {
        vertLines: { color: colorMode === 'dark' ? '#232b38' : '#eef0f4', style: LineStyle.Solid },
        horzLines: { color: colorMode === 'dark' ? '#232b38' : '#eef0f4', style: LineStyle.Solid },
      },
      rightPriceScale: {
        visible: true,
        borderColor: colorMode === 'dark' ? '#334052' : '#dde1e8',
        scaleMargins: { top: 0.09, bottom: 0.08 },
        minimumWidth: priceScaleWidth,
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor: colorMode === 'dark' ? '#334052' : '#dde1e8',
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
    // A fixed 270-bar projection tail is useful on desktop, but on a narrow
    // phone canvas it can consume every visible logical slot (minBarSpacing is
    // 1.1px) and push all real candles off-screen after fitContent(). Scale the
    // projection area with the actual chart width so the latest history and a
    // useful drawing runway are both visible.
    const futureBarCount = futureProjectionBarCount(host.clientWidth, bars.length)
    const futureDates = !isMinute && latestBar ? createFutureProjectionDates(latestBar.date, futureBarCount, timeframe) : []
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

    if (!cleanMode && indicators.bollEnabled) {
      const bands = bollingerBands(bars, indicators.bollPeriod, indicators.bollMultiplier)
      const addBand = (color: string, key: 'upper' | 'mid' | 'lower', dashed = false) => {
        const series = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        series.setData(bands.flatMap((point) => {
          const value = point[key]
          return value == null ? [] : [{ time: chartTime(point.date), value }]
        }))
      }
      addBand('#5b8def', 'upper')
      addBand('#d79b27', 'mid', true)
      addBand('#5b8def', 'lower')
    }

    if (!cleanMode && indicators.sarEnabled) {
      const sar = parabolicSar(bars, indicators.sarStep, indicators.sarMax)
      const addDots = (color: string, uptrend: boolean) => {
        const data = sar.flatMap((point, index) => (
          point && point.uptrend === uptrend
            ? [{ time: chartTime(bars[index].date), value: point.value }]
            : []
        ))
        if (!data.length) return
        const series = chart.addSeries(LineSeries, {
          color,
          lineVisible: false,
          pointMarkersVisible: true,
          pointMarkersRadius: 3,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
        series.setData(data)
      }
      addDots('#e95b71', true)
      addDots('#2eaa7b', false)
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
      const visibleTimeRange = chart.timeScale().getVisibleRange()
      if (visibleRange) {
        host.dataset.visibleLogicalFrom = visibleRange.from.toFixed(4)
        host.dataset.visibleLogicalTo = visibleRange.to.toFixed(4)
      } else {
        delete host.dataset.visibleLogicalFrom
        delete host.dataset.visibleLogicalTo
      }
      const visibleBars = barsInVisibleTimeRange(bars, visibleTimeRange)
      const anchoredBars = anchoredRange
        ? bars.filter((bar) => {
          const timestamp = bar.date.includes(' ')
            ? new Date(`${bar.date.replace(' ', 'T')}:00+08:00`).getTime()
            : new Date(`${bar.date.slice(0, 10)}T00:00:00+08:00`).getTime()
          return timestamp >= anchoredRange[0] && timestamp <= anchoredRange[1]
        })
        : []
      const profileBars = anchoredBars.length ? anchoredBars : visibleTimeRange ? visibleBars : bars
      host.dataset.profileBarCount = String(profileBars.length)
      const profileResult = calculateVolumeProfile(profileBars, 48, 0.7, logPriceRef.current)
      const mainPaneHeight = chart.panes()[0]?.getHeight() ?? host.clientHeight * 0.64
      const profile = profileResult.rows.flatMap((row) => {
        const y = candleSeries.priceToCoordinate(row.price)
        return y == null || y < 0 || y > mainPaneHeight ? [] : [{
          y,
          width: row.total,
          sell: row.sell,
          buy: row.buy,
          emphasis: row.emphasis,
          inValueArea: row.inValueArea,
          price: row.price,
        }]
      })
      const visibleProfileCoordinate = (price: number) => {
        const coordinate = candleSeries.priceToCoordinate(price)
        return coordinate != null && coordinate >= 0 && coordinate <= mainPaneHeight ? coordinate : null
      }
      const chipGeometry = resolveChipOverlayGeometry(
        currentChipEstimate,
        (price) => candleSeries.priceToCoordinate(price),
        mainPaneHeight,
      )
      setGeometry((current) => ({
        profile,
        profileStats: {
          poc: profileResult.poc,
          vah: profileResult.vah,
          val: profileResult.val,
          pocY: visibleProfileCoordinate(profileResult.poc),
          vahY: visibleProfileCoordinate(profileResult.vah),
          valY: visibleProfileCoordinate(profileResult.val),
        },
        profileSource: anchoredBars.length ? 'anchored' : 'visible',
        chips: chipGeometry.rows,
        chipStats: {
          currentY: chipGeometry.currentY,
          averageY: chipGeometry.averageY,
        },
        chipScaleMode: chipGeometry.scaleMode,
        chipScaleRange: chipGeometry.scaleRange,
        mainPaneHeight,
        chartHeight: host.clientHeight,
        width: host.clientWidth,
        revision: current.revision + 1,
        events: (!cleanMode && indicators.eventsEnabled && !isMinute)
          ? corporateEventsRef.current.flatMap((item) => {
            const x = chart.timeScale().timeToCoordinate(businessDay(item.date))
            if (x == null || x < 8 || x > host.clientWidth - 8) return []
            return [{ x, label: item.label, kind: item.kind }]
          })
          : [],
      }))
    }
    refreshGeometryRef.current = updateGeometry

    if (restoreRange) chart.timeScale().setVisibleLogicalRange(restoreRange)
    else chart.timeScale().fitContent()
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
      const visibleRange = chart.timeScale().getVisibleLogicalRange()
      if (visibleRange) visibleLogicalRangeRef.current = { from: visibleRange.from, to: visibleRange.to }
      if (refreshGeometryRef.current === updateGeometry) refreshGeometryRef.current = () => {}
      chart.remove()
      chartRef.current = null
      candleRef.current = null
    }
  }, [anchoredRange, bars, byTime, candleTheme, cleanMode, colorMode, dataRevision, fontScale, indicators, isMinute, latestBar, macd, market, preserveViewOnDataChange, symbol, timeframe])

  useEffect(() => {
    const frame = requestAnimationFrame(() => refreshGeometryRef.current())
    return () => cancelAnimationFrame(frame)
  }, [chipEstimate])

  useEffect(() => {
    const frame = requestAnimationFrame(() => refreshGeometryRef.current())
    return () => cancelAnimationFrame(frame)
  }, [corporateEvents])

  useEffect(() => {
    if (resetViewRevision <= 0 || !chartRef.current) return
    chartRef.current.timeScale().fitContent()
    const frame = requestAnimationFrame(() => refreshGeometryRef.current())
    return () => cancelAnimationFrame(frame)
  }, [resetViewRevision])

  useEffect(() => {
    const series = candleRef.current
    const chart = chartRef.current
    if (!series || !chart) return
    // The candle series includes future whitespace so investors can draw and
    // project forward. scrollToPosition() anchors to that future tail, which
    // used to move every candle off-screen after a price-mode switch. Capture
    // and restore the exact investor-controlled viewport instead.
    const viewport = preservePriceModeViewport(chart.timeScale().getVisibleLogicalRange())
    series.priceScale().applyOptions({
      autoScale: true,
      mode: percentPrice ? PriceScaleMode.Percentage : logPrice ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    })
    const frame = requestAnimationFrame(() => {
      if (viewport) chart.timeScale().setVisibleLogicalRange(viewport)
      refreshGeometryRef.current()
    })
    return () => cancelAnimationFrame(frame)
  }, [logPrice, percentPrice])

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
  const selectedProfile = selectedProfilePrice == null
    ? null
    : geometry.profile.find((row) => Math.abs(row.price - selectedProfilePrice) < 1e-8) ?? null
  const profileTotal = geometry.profile.reduce((sum, row) => sum + row.width, 0)

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
          scaleMode={geometry.chipScaleMode}
          scaleRange={geometry.chipScaleRange}
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
              <button
                type="button"
                key={`${row.y}-${index}`}
                className={`profile-row${row.emphasis ? ' is-poc' : ''}${row.inValueArea ? ' is-value-area' : ''}`}
                style={{ top: row.y, width: `${Math.max(3, row.width / maxWidth * 100)}%` }}
                aria-label={`${row.price.toFixed(2)}元，成交量${formatVolume(row.width)}，占可视分布${profileTotal ? (row.width / profileTotal * 100).toFixed(2) : '0.00'}%`}
                title={`${row.price.toFixed(2)} · ${formatVolume(row.width)}`}
                onClick={() => setSelectedProfilePrice((current) => current === row.price ? null : row.price)}
              >
                <span className="profile-sell" style={{ flex: row.sell }} />
                <span className="profile-buy" style={{ flex: row.buy }} />
              </button>
            )
          })}
          {selectedProfile && (
            <div className="profile-row-detail" role="status" style={{ top: Math.max(56, Math.min(geometry.mainPaneHeight - 44, selectedProfile.y)) }}>
              <strong>{selectedProfile.price.toFixed(2)}</strong>
              <span>{formatVolume(selectedProfile.width)}</span>
              <em>{profileTotal ? (selectedProfile.width / profileTotal * 100).toFixed(2) : '0.00'}%</em>
            </div>
          )}
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

      {!cleanMode && geometry.events.map((item, index) => (
        <div
          key={`${item.kind}-${item.label}-${item.x}`}
          className={`chart-event-marker is-${item.kind}`}
          style={{ left: item.x, height: geometry.mainPaneHeight }}
        >
          <span style={{ top: 8 + index * 20 }}>{item.label}</span>
        </div>
      ))}
      <div className="chart-watermark">{instrumentLabel}</div>
    </div>
  )
}
