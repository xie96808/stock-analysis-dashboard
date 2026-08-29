import { useEffect, useMemo, useRef } from 'react'
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { createIntradayFixture, type IntradayPoint, type StockBar } from '../data/fixture'
import { resolveIntradaySource } from '../chart/intraday'

type Props = {
  bar: StockBar
  points?: IntradayPoint[]
  fontScale: 'standard' | 'large' | 'xlarge'
  loading?: boolean
  allowFixture?: boolean
}

function formatShanghaiTime(time: Time) {
  if (typeof time !== 'number') return ''
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(time * 1000))
}

export function IntradayView({ bar, points: suppliedPoints, fontScale, loading = false, allowFixture = false }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const source = resolveIntradaySource(suppliedPoints, { loading, allowFixture })
  const points = useMemo(
    () => suppliedPoints?.length ? suppliedPoints : source === 'fixture' ? createIntradayFixture(bar) : [],
    [bar, source, suppliedPoints],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host || !points.length) return

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
      grid: {
        vertLines: { color: '#eef0f4' },
        horzLines: { color: '#eef0f4' },
      },
      localization: {
        locale: 'zh-CN',
        priceFormatter: (price: number) => price.toFixed(2),
        timeFormatter: formatShanghaiTime,
      },
      rightPriceScale: {
        borderColor: '#dde1e8',
        scaleMargins: { top: 0.12, bottom: 0.1 },
        minimumWidth: priceScaleWidth,
      },
      timeScale: {
        borderColor: '#dde1e8',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 3.2,
        minBarSpacing: 1.5,
        minimumHeight: 36,
        tickMarkFormatter: formatShanghaiTime,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#8992a1', style: LineStyle.Dashed, labelBackgroundColor: '#2d333f' },
        horzLine: { color: '#8992a1', style: LineStyle.Dashed, labelBackgroundColor: '#2d333f' },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
    })

    const priceSeries = chart.addSeries(AreaSeries, {
      lineColor: '#2962e8',
      lineWidth: 2,
      topColor: 'rgba(41, 98, 232, 0.14)',
      bottomColor: 'rgba(41, 98, 232, 0.01)',
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerRadius: 4,
    })
    priceSeries.setData(points.map((point) => ({ time: point.timestamp as UTCTimestamp, value: point.price })))

    const averageSeries = chart.addSeries(LineSeries, {
      color: '#d79b27',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    averageSeries.setData(points.map((point) => ({ time: point.timestamp as UTCTimestamp, value: point.average })))

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
    }, 1)
    volumeSeries.setData(points.map((point, index) => ({
      time: point.timestamp as UTCTimestamp,
      value: point.volume,
      color: index === 0 || point.price >= points[index - 1].price ? '#e68a98' : '#62b9aa',
    })))
    volumeSeries.priceScale().applyOptions({ borderVisible: false, scaleMargins: { top: 0.12, bottom: 0 } })

    chart.panes()[0]?.setHeight(Math.round(host.clientHeight * 0.74))
    chart.panes()[1]?.setHeight(Math.round(host.clientHeight * 0.21))
    chart.timeScale().fitContent()

    const observer = new ResizeObserver(() => {
      chart.resize(host.clientWidth, host.clientHeight)
      chart.panes()[0]?.setHeight(Math.round(host.clientHeight * 0.74))
      chart.panes()[1]?.setHeight(Math.round(host.clientHeight * 0.21))
    })
    observer.observe(host)

    return () => {
      observer.disconnect()
      chart.remove()
    }
  }, [bar, fontScale, points])

  return (
    <div className="intraday-stage">
      <div className="intraday-legend">
        <strong>{bar.date} 分时</strong>
        <span>价格 <i className="price-key" /></span>
        <span>均价 <i className="average-key" /></span>
        <span>开 {bar.open.toFixed(2)}</span>
        <span>高 {bar.high.toFixed(2)}</span>
        <span>低 {bar.low.toFixed(2)}</span>
        <span>收 {bar.close.toFixed(2)}</span>
      </div>
      <div ref={hostRef} className="intraday-canvas" />
      {!points.length && (
        <div className="intraday-empty">
          <strong>{loading ? '正在加载5分钟行情' : '该交易日没有可用的5分钟行情'}</strong>
          <span>未使用样例分时代替真实价格</span>
        </div>
      )}
      {source === 'fixture' && <div className="intraday-fixture-banner">样例降级 · 本地拟合预览，不是真实行情</div>}
      <div className="intraday-tip">拖动或滚轮缩放 · 使用顶部“返回日K”回到日线</div>
    </div>
  )
}
