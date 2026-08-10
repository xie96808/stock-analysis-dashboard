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
  timeframe: string
  logPrice: boolean
  profileVisible: boolean
  cleanMode: boolean
  indicators: IndicatorConfig
  fontScale: 'standard' | 'large' | 'xlarge'
  onHoverBar: (bar: StockBar | null) => void
  onSelectBar: (bar: StockBar) => void
}

type OverlayGeometry = {
  profile: { y: number; width: number; sell: number; buy: number; emphasis?: boolean }[]
  mainPaneHeight: number
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

function createFutureTradingDates(after: string, count = 130) {
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

function visualProfile(bars: StockBar[], bins = 18) {
  if (!bars.length) return []
  const low = Math.min(...bars.map((bar) => bar.low))
  const high = Math.max(...bars.map((bar) => bar.high))
  const step = Math.max((high - low) / bins, Number.EPSILON)
  const rows = Array.from({ length: bins }, (_, index) => ({
    price: low + (index + 0.5) * step,
    buy: 0,
    sell: 0,
  }))
  bars.forEach((bar) => {
    const index = Math.max(0, Math.min(bins - 1, Math.floor((bar.close - low) / step)))
    const rising = bar.close >= bar.open
    rows[index].buy += bar.volume * (rising ? 0.58 : 0.42)
    rows[index].sell += bar.volume * (rising ? 0.42 : 0.58)
  })
  const poc = rows.reduce((best, row) => row.buy + row.sell > best.buy + best.sell ? row : best, rows[0])
  return rows.map((row) => ({ ...row, emphasis: row === poc }))
}

export function ChartWorkbench({
  bars,
  instrumentLabel,
  timeframe,
  logPrice,
  profileVisible,
  cleanMode,
  indicators,
  fontScale,
  onHoverBar,
  onSelectBar,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const [geometry, setGeometry] = useState<OverlayGeometry>({ profile: [], mainPaneHeight: 420 })

  const byTime = useMemo(() => new Map(bars.map((bar) => [timeKey(chartTime(bar.date)), bar])), [bars])
  const macd = useMemo(
    () => calculateMacd(bars, indicators.macdFast, indicators.macdSlow, indicators.macdSignal),
    [bars, indicators.macdFast, indicators.macdSignal, indicators.macdSlow],
  )
  const profileSource = useMemo(() => visualProfile(bars), [bars])
  const latestBar = bars.at(-1)
  const latestMacd = macd.at(-1)
  // Base the chart time type on the payload, not the selected button. During a
  // fast period switch React can briefly render the previous response; mixing
  // BusinessDay and UTCTimestamp in one series would make Lightweight Charts fail.
  const isMinute = bars[0]?.date.includes(' ') ?? timeframe.endsWith('分')

  useEffect(() => {
    const host = hostRef.current
    if (!host || !bars.length) return

    const chartFontSize = fontScale === 'standard' ? 15 : fontScale === 'large' ? 16 : 18
    const priceScaleWidth = fontScale === 'xlarge' ? 92 : fontScale === 'large' ? 84 : 78
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
      upColor: '#ffffff',
      downColor: '#17191f',
      borderUpColor: '#17191f',
      borderDownColor: '#17191f',
      wickUpColor: '#17191f',
      wickDownColor: '#17191f',
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
      const profile = profileSource.flatMap((row) => {
        const y = candleSeries.priceToCoordinate(row.price)
        return y == null ? [] : [{
          y,
          width: row.sell + row.buy,
          sell: row.sell,
          buy: row.buy,
          emphasis: row.emphasis,
        }]
      })
      setGeometry({ profile, mainPaneHeight: chart.panes()[0]?.getHeight() ?? host.clientHeight * 0.64 })
    }

    chart.timeScale().fitContent()
    const mainRatio = nextPane === 1 ? 0.94 : nextPane === 2 ? 0.76 : 0.62
    chart.panes()[0]?.setHeight(Math.round(host.clientHeight * mainRatio))
    if (volumePane != null) chart.panes()[volumePane]?.setHeight(Math.round(host.clientHeight * 0.15))
    if (macdPane != null) chart.panes()[macdPane]?.setHeight(Math.round(host.clientHeight * 0.19))
    requestAnimationFrame(updateGeometry)

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        onHoverBar(null)
        return
      }
      onHoverBar(byTime.get(timeKey(param.time)) ?? null)
      updateGeometry()
    })
    chart.subscribeClick((param) => {
      if (!param.time) return
      const bar = byTime.get(timeKey(param.time))
      if (bar) onSelectBar(bar)
    })
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateGeometry)

    const observer = new ResizeObserver(() => {
      chart.resize(host.clientWidth, host.clientHeight)
      chart.panes()[0]?.setHeight(Math.round(host.clientHeight * mainRatio))
      if (volumePane != null) chart.panes()[volumePane]?.setHeight(Math.round(host.clientHeight * 0.15))
      if (macdPane != null) chart.panes()[macdPane]?.setHeight(Math.round(host.clientHeight * 0.19))
      requestAnimationFrame(updateGeometry)
    })
    observer.observe(host)
    return () => {
      observer.disconnect()
      chart.remove()
      chartRef.current = null
      candleRef.current = null
    }
  }, [bars, byTime, cleanMode, fontScale, indicators, instrumentLabel, isMinute, latestBar, macd, onHoverBar, onSelectBar, profileSource, timeframe])

  useEffect(() => {
    const series = candleRef.current
    const chart = chartRef.current
    if (!series || !chart) return
    series.priceScale().applyOptions({ mode: logPrice ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal })
    requestAnimationFrame(() => {
      chart.timeScale().scrollToPosition(isMinute ? 3 : 6, false)
      window.dispatchEvent(new Event('resize'))
    })
  }, [isMinute, logPrice])

  return (
    <div className="chart-stage" aria-label={`${instrumentLabel}${timeframe}图表`}>
      <div ref={hostRef} className="chart-canvas" />
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

      {profileVisible && (
        <div className="volume-profile" style={{ height: geometry.mainPaneHeight }} aria-label="可视区成交量分布">
          <div className="profile-heading">可视区成交量分布</div>
          {geometry.profile.map((row, index) => {
            const maxWidth = Math.max(...geometry.profile.map((item) => item.width), 1)
            return (
              <div
                key={`${row.y}-${index}`}
                className={`profile-row${row.emphasis ? ' is-poc' : ''}`}
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
        </div>
      )}

      <div className="chart-watermark">{instrumentLabel}</div>
    </div>
  )
}
