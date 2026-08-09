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
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts'
import {
  fixtureBars,
  fixtureMacd,
  futureDates,
  profileRows,
  type StockBar,
} from '../data/fixture'

type Props = {
  logPrice: boolean
  profileVisible: boolean
  cleanMode: boolean
  fontScale: 'standard' | 'large' | 'xlarge'
  onHoverBar: (bar: StockBar | null) => void
  onSelectBar: (bar: StockBar) => void
}

type OverlayGeometry = {
  profile: { y: number; width: number; sell: number; buy: number; emphasis?: boolean }[]
  mainPaneHeight: number
}

function businessDay(date: string): BusinessDay {
  const [year, month, day] = date.split('-').map(Number)
  return { year, month, day }
}

function formatVolume(value: number) {
  if (value >= 10_000_000) return `${(value / 10_000_000).toFixed(2)}千万`
  if (value >= 10_000) return `${(value / 10_000).toFixed(0)}万`
  return `${value}`
}

export function ChartWorkbench({ logPrice, profileVisible, fontScale, onHoverBar, onSelectBar }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const [geometry, setGeometry] = useState<OverlayGeometry>({
    profile: [],
    mainPaneHeight: 420,
  })

  const byDate = useMemo(() => new Map(fixtureBars.map((bar) => [bar.date, bar])), [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

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
        panes: {
          separatorColor: '#e5e8ee',
          separatorHoverColor: '#c7cedb',
          enableResize: true,
        },
      },
      localization: {
        locale: 'zh-CN',
        priceFormatter: (price: number) => price.toFixed(2),
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
        timeVisible: false,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 5.4,
        minBarSpacing: 1.1,
        maxBarSpacing: 24,
        minimumHeight: 35,
        tickMarkMaxCharacterLength: 10,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#87909f',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#2d333f',
        },
        horzLine: {
          color: '#87909f',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#2d333f',
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
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

    candleSeries.setData([
      ...fixtureBars.map((bar) => ({
        time: businessDay(bar.date),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      })),
      ...futureDates.map((date) => ({ time: businessDay(date) })),
    ])

    const futureSpaceSeries = chart.addSeries(LineSeries, {
      color: 'rgba(255,255,255,0)',
      lineVisible: false,
      pointMarkersVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    futureSpaceSeries.setData([
      { time: businessDay('2026-08-07'), value: 65.38 },
      ...futureDates.map((date) => ({ time: businessDay(date), value: 65.38 })),
    ])

    const volumeSeries = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: 'volume' },
        priceLineVisible: false,
        lastValueVisible: false,
        color: '#8a93a1',
        priceScaleId: 'vol',
      },
      1,
    )

    volumeSeries.setData(
      fixtureBars.map((bar) => ({
        time: businessDay(bar.date),
        value: bar.volume,
        color: bar.close >= bar.open ? '#d4d9e1' : '#333943',
      })),
    )
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.16, bottom: 0 },
      borderVisible: false,
    })

    const macdHistogram = chart.addSeries(
      HistogramSeries,
      {
        priceScaleId: 'macd',
        priceLineVisible: false,
        lastValueVisible: false,
      },
      2,
    )
    macdHistogram.setData(
      fixtureMacd.map((point) => ({
        time: businessDay(point.date),
        value: point.histogram,
        color: point.histogram >= 0 ? '#e95b71' : '#32b7a5',
      })),
    )

    const difSeries = chart.addSeries(
      LineSeries,
      {
        priceScaleId: 'macd',
        color: '#e59c24',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      },
      2,
    )
    difSeries.setData(
      fixtureMacd.map((point) => ({ time: businessDay(point.date), value: point.dif })),
    )

    const deaSeries = chart.addSeries(
      LineSeries,
      {
        priceScaleId: 'macd',
        color: '#566ee8',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      },
      2,
    )
    deaSeries.setData(
      fixtureMacd.map((point) => ({ time: businessDay(point.date), value: point.dea })),
    )
    macdHistogram.priceScale().applyOptions({
      scaleMargins: { top: 0.14, bottom: 0.1 },
      borderVisible: false,
    })

    chartRef.current = chart
    candleRef.current = candleSeries

    const updateGeometry = () => {
      const profile = profileRows.flatMap((row) => {
        const y = candleSeries.priceToCoordinate(row.price)
        return y == null ? [] : [{
          y,
          width: row.sell + row.buy,
          sell: row.sell,
          buy: row.buy,
          emphasis: row.emphasis,
        }]
      })

      setGeometry({
        profile,
        mainPaneHeight: chart.panes()[0]?.getHeight() ?? host.clientHeight * 0.64,
      })
    }

    chart.timeScale().fitContent()
    chart.panes()[0]?.setHeight(Math.round(host.clientHeight * 0.62))
    chart.panes()[1]?.setHeight(Math.round(host.clientHeight * 0.15))
    chart.panes()[2]?.setHeight(Math.round(host.clientHeight * 0.19))
    requestAnimationFrame(updateGeometry)

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        onHoverBar(null)
        return
      }
      const time = param.time as BusinessDay
      const date = `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`
      onHoverBar(byDate.get(date) ?? null)
      updateGeometry()
    })
    chart.subscribeClick((param) => {
      if (!param.time) return
      const time = param.time as BusinessDay
      const date = `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`
      const bar = byDate.get(date)
      if (bar) onSelectBar(bar)
    })
    chart.timeScale().subscribeVisibleLogicalRangeChange(updateGeometry)

    const observer = new ResizeObserver(() => {
      chart.resize(host.clientWidth, host.clientHeight)
      chart.panes()[0]?.setHeight(Math.round(host.clientHeight * 0.62))
      chart.panes()[1]?.setHeight(Math.round(host.clientHeight * 0.15))
      chart.panes()[2]?.setHeight(Math.round(host.clientHeight * 0.19))
      requestAnimationFrame(updateGeometry)
    })
    observer.observe(host)

    return () => {
      observer.disconnect()
      chart.remove()
      chartRef.current = null
      candleRef.current = null
    }
  }, [byDate, fontScale, onHoverBar, onSelectBar])

  useEffect(() => {
    const series = candleRef.current
    const chart = chartRef.current
    if (!series || !chart) return
    series.priceScale().applyOptions({
      mode: logPrice ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    })
    requestAnimationFrame(() => {
      chart.timeScale().scrollToPosition(6, false)
      window.dispatchEvent(new Event('resize'))
    })
  }, [logPrice])

  return (
    <div className="chart-stage" aria-label="中国铀业日K图表">
      <div ref={hostRef} className="chart-canvas" />

      <div className="pane-label pane-label-volume" style={{ top: geometry.mainPaneHeight + 10 }}>
        <strong>VOL</strong>
        <span>9.08M</span>
        <span className="pane-label-muted">MA5 {formatVolume(7_630_000)}</span>
        <span className="pane-label-muted">MA10 {formatVolume(8_140_000)}</span>
      </div>
      <div className="pane-label pane-label-macd" style={{ top: geometry.mainPaneHeight + 124 }}>
        <strong>MACD 12 26 9</strong>
        <span className="macd-orange">DIF 0.86</span>
        <span className="macd-blue">DEA 0.41</span>
        <span>柱 0.90</span>
      </div>

      {profileVisible && (
        <div className="volume-profile" style={{ height: geometry.mainPaneHeight }} aria-label="可视区成交量分布">
          <div className="profile-heading">可视区成交量分布</div>
          {geometry.profile.map((row, index) => {
            const scale = 2.3
            return (
              <div
                key={`${row.y}-${index}`}
                className={`profile-row${row.emphasis ? ' is-poc' : ''}`}
                style={{
                  top: row.y,
                  width: `${Math.min(row.width * scale, 100)}%`,
                }}
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

      <div className="chart-watermark">001280 · 中国铀业</div>
    </div>
  )
}
