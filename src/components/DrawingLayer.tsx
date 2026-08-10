import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { BusinessDay, IChartApi, ISeriesApi, Time, UTCTimestamp } from 'lightweight-charts'
import {
  createDrawingId,
  commitDrawingGesture,
  defaultDrawingStyle,
  replaceDrawingAnchor,
  toolToDrawingType,
  wheelAdjustedPrice,
  type Drawing,
  type DrawingAnchor,
} from '../drawings/model'
import type { StockBar } from '../data/fixture'

type Props = {
  chart: IChartApi | null
  candleSeries: ISeriesApi<'Candlestick'> | null
  width: number
  mainPaneHeight: number
  viewportRevision: number
  symbol: string
  market: 'CN' | 'HK'
  timeframe: string
  activeTool: string
  bars: StockBar[]
  snapMode: 'off' | 'weak' | 'strong'
  drawings: Drawing[]
  onCommit: (next: Drawing[]) => void
  onFinishCreate: () => void
}

type Gesture = {
  kind: 'create' | 'move' | 'anchor'
  drawing: Drawing
  origin?: DrawingAnchor
  initial?: Drawing
  anchorIndex?: number
}

function timeToTimestampMs(time: Time) {
  if (typeof time === 'number') return time * 1000
  if (typeof time === 'string') return new Date(`${time}T00:00:00+08:00`).getTime()
  return new Date(`${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}T00:00:00+08:00`).getTime()
}

function timestampToTime(timestampMs: number, minuteMode: boolean): Time {
  if (minuteMode) return Math.floor(timestampMs / 1000) as UTCTimestamp
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestampMs))
  const number = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return { year: number('year'), month: number('month'), day: number('day') } as BusinessDay
}

function anchorDate(anchor: DrawingAnchor) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(anchor.timestampMs))
}

function translateDrawing(drawing: Drawing, timestampDelta: number, priceDelta: number): Drawing {
  const translate = (anchor: DrawingAnchor) => ({ ...anchor, timestampMs: anchor.timestampMs + timestampDelta, price: anchor.price + priceDelta })
  return {
    ...drawing,
    anchors: drawing.anchors.map(translate),
    path: drawing.path?.map(translate),
  }
}

export function DrawingLayer({
  chart,
  candleSeries,
  width,
  mainPaneHeight,
  viewportRevision,
  symbol,
  market,
  timeframe,
  activeTool,
  bars,
  snapMode,
  drawings,
  onCommit,
  onFinishCreate,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [gesture, setGesture] = useState<Gesture | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const drawingType = toolToDrawingType(activeTool)
  const minuteMode = timeframe.endsWith('分')

  const visibleDrawings = useMemo(
    () => drawings.filter((drawing) => !drawing.hidden && (drawing.timeframeVisibility === 'all' || drawing.timeframeVisibility.includes(timeframe))),
    [drawings, timeframe],
  )
  const selected = drawings.find((drawing) => drawing.id === selectedId) ?? null

  const anchorFromEvent = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!chart || !candleSeries || !svgRef.current) return null
    const bounds = svgRef.current.getBoundingClientRect()
    const x = event.clientX - bounds.left
    const y = event.clientY - bounds.top
    if (y < 0 || y > mainPaneHeight) return null
    const time = chart.timeScale().coordinateToTime(x)
    const price = candleSeries.coordinateToPrice(y)
    if (time == null || price == null) return null
    let snappedPrice: number = Number(price)
    const timestampMs = timeToTimestampMs(time)
    if (snapMode !== 'off' && bars.length) {
      const nearest = bars.reduce((best, bar) => {
        const barTimestamp = bar.date.includes(' ')
          ? new Date(`${bar.date.replace(' ', 'T')}:00+08:00`).getTime()
          : new Date(`${bar.date.slice(0, 10)}T00:00:00+08:00`).getTime()
        return Math.abs(barTimestamp - timestampMs) < Math.abs(best.timestamp - timestampMs)
          ? { bar, timestamp: barTimestamp }
          : best
      }, { bar: bars[0], timestamp: bars[0].date.includes(' ') ? new Date(`${bars[0].date.replace(' ', 'T')}:00+08:00`).getTime() : new Date(`${bars[0].date.slice(0, 10)}T00:00:00+08:00`).getTime() })
      const barX = chart.timeScale().timeToCoordinate(timestampToTime(nearest.timestamp, minuteMode))
      const threshold = snapMode === 'strong' ? 22 : 9
      if (barX != null && Math.abs(barX - x) <= threshold) {
        const candidates = [nearest.bar.open, nearest.bar.high, nearest.bar.low, nearest.bar.close]
        const closest = candidates.reduce((best, candidate) => {
          const candidateY = candleSeries.priceToCoordinate(candidate)
          const bestY = candleSeries.priceToCoordinate(best)
          return candidateY != null && (bestY == null || Math.abs(candidateY - y) < Math.abs(bestY - y)) ? candidate : best
        }, candidates[0])
        const closestY = candleSeries.priceToCoordinate(closest)
        if (closestY != null && (snapMode === 'strong' || Math.abs(closestY - y) <= threshold)) snappedPrice = closest
      }
    }
    return { timestampMs, price: snappedPrice, pressure: event.pressure || undefined }
  }

  const point = (anchor: DrawingAnchor) => {
    if (!chart || !candleSeries) return null
    const x = chart.timeScale().timeToCoordinate(timestampToTime(anchor.timestampMs, minuteMode))
    const y = candleSeries.priceToCoordinate(anchor.price)
    return x == null || y == null ? null : { x, y }
  }

  const begin = (event: ReactPointerEvent<SVGSVGElement>) => {
    const target = event.target as SVGElement
    const object = target.closest<SVGElement>('[data-drawing-id]')
    const objectId = object?.dataset.drawingId ?? null
    const anchorHandle = target.closest<SVGElement>('[data-anchor-index]')
    const anchorIndex = anchorHandle?.dataset.anchorIndex == null ? null : Number(anchorHandle.dataset.anchorIndex)

    if (activeTool === '橡皮擦' && objectId) {
      onCommit(drawings.filter((drawing) => drawing.id !== objectId))
      if (selectedId === objectId) setSelectedId(null)
      event.preventDefault()
      return
    }

    if (activeTool === '选择') {
      setSelectedId(objectId)
      if (!objectId) return
      const current = drawings.find((drawing) => drawing.id === objectId)
      const origin = anchorFromEvent(event)
      if (!current || current.locked || !origin) return
      setGesture(anchorIndex != null && Number.isInteger(anchorIndex)
        ? { kind: 'anchor', drawing: current, initial: current, anchorIndex }
        : { kind: 'move', drawing: current, origin, initial: current })
      svgRef.current?.setPointerCapture(event.pointerId)
      event.preventDefault()
      return
    }

    if (!drawingType) return
    const anchor = anchorFromEvent(event)
    if (!anchor) return
    const next: Drawing = {
      id: createDrawingId(),
      symbol,
      market,
      type: drawingType,
      anchors: drawingType === 'horizontal' || drawingType === 'text' ? [anchor] : [anchor, anchor],
      path: drawingType === 'freehand' || drawingType === 'highlighter' ? [anchor] : undefined,
      text: drawingType === 'text' ? '文本批注' : undefined,
      timeframeVisibility: 'all',
      locked: false,
      hidden: false,
      style: defaultDrawingStyle(drawingType),
    }
    setGesture({ kind: 'create', drawing: next })
    svgRef.current?.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const move = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!gesture) return
    const anchor = anchorFromEvent(event)
    if (!anchor) return
    if (gesture.kind === 'anchor' && gesture.initial && gesture.anchorIndex != null) {
      setGesture({
        ...gesture,
        drawing: replaceDrawingAnchor(gesture.initial, gesture.anchorIndex, anchor),
      })
      return
    }
    if (gesture.kind === 'move' && gesture.origin && gesture.initial) {
      setGesture({
        ...gesture,
        drawing: translateDrawing(
          gesture.initial,
          anchor.timestampMs - gesture.origin.timestampMs,
          anchor.price - gesture.origin.price,
        ),
      })
      return
    }
    const current = gesture.drawing
    if (current.type === 'freehand' || current.type === 'highlighter') {
      const previous = current.path?.at(-1)
      if (!previous || Math.abs(previous.timestampMs - anchor.timestampMs) > 1_000 || Math.abs(previous.price - anchor.price) > 0.0001) {
        setGesture({ ...gesture, drawing: { ...current, path: [...(current.path ?? []), anchor], anchors: [current.anchors[0], anchor] } })
      }
    } else if (current.anchors.length > 1) {
      setGesture({ ...gesture, drawing: { ...current, anchors: [current.anchors[0], anchor] } })
    }
  }

  const finish = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!gesture) return
    const draft = gesture.drawing
    const next = commitDrawingGesture(drawings, draft, gesture.kind === 'create')
    onCommit(next)
    setSelectedId(draft.id)
    setGesture(null)
    if (gesture.kind === 'create') onFinishCreate()
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId)
  }

  const patchSelected = (patch: Partial<Drawing>) => {
    if (!selected) return
    onCommit(drawings.map((drawing) => drawing.id === selected.id ? { ...drawing, ...patch } : drawing))
  }

  const rendered = gesture
    ? [...visibleDrawings.filter((drawing) => drawing.id !== gesture.drawing.id), gesture.drawing]
    : visibleDrawings

  return (
    <>
      <svg
        ref={svgRef}
        className={`drawing-layer${drawingType ? ' is-creating' : ''}`}
        width={width}
        height={mainPaneHeight}
        aria-label="金融坐标画线层"
        data-viewport-revision={viewportRevision}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={() => setGesture(null)}
      >
        {rendered.map((drawing) => {
          const anchors = drawing.anchors.map(point)
          const first = anchors[0]
          const second = anchors[1]
          const common = {
            stroke: drawing.style.color,
            strokeWidth: drawing.style.width,
            strokeOpacity: drawing.style.opacity,
            strokeDasharray: drawing.style.dash === 'dashed' ? '7 5' : undefined,
          }
          const className = `drawing-object${drawing.id === selectedId ? ' is-selected' : ''}`
          if (!first) return null
          if (drawing.type === 'horizontal') {
            return <g key={drawing.id} data-drawing-id={drawing.id} className={className}>
              <line className="drawing-hit-target" x1={0} y1={first.y} x2={width} y2={first.y} />
              <line x1={0} y1={first.y} x2={width} y2={first.y} {...common} />
              <text x={Math.max(8, width - 84)} y={first.y - 6} fill={drawing.style.color}>{drawing.anchors[0].price.toFixed(2)}</text>
            </g>
          }
          if (drawing.type === 'text') {
            return <text key={drawing.id} data-drawing-id={drawing.id} className={className} x={first.x} y={first.y} fill={drawing.style.color} opacity={drawing.style.opacity}>{drawing.text}</text>
          }
          if (drawing.type === 'freehand' || drawing.type === 'highlighter') {
            const points = drawing.path?.flatMap((anchor) => {
              const value = point(anchor)
              return value ? [value] : []
            }) ?? []
            return <polyline key={drawing.id} data-drawing-id={drawing.id} className={className} points={points.map((value) => `${value.x},${value.y}`).join(' ')} fill="none" strokeLinecap="round" strokeLinejoin="round" {...common} />
          }
          if (!second) return null
          if (drawing.type === 'rectangle' || drawing.type === 'profile-range') {
            return <rect key={drawing.id} data-drawing-id={drawing.id} className={className} x={Math.min(first.x, second.x)} y={Math.min(first.y, second.y)} width={Math.abs(second.x - first.x)} height={Math.abs(second.y - first.y)} fill={drawing.style.color} fillOpacity={drawing.style.opacity} {...common} strokeOpacity={0.85} />
          }
          const dx = second.x - first.x
          const dy = second.y - first.y
          const rayFactor = drawing.type === 'ray' && Math.abs(dx) > 0.5 ? Math.max(1, (width - first.x) / dx) : 1
          const end = { x: first.x + dx * rayFactor, y: first.y + dy * rayFactor }
          if (drawing.type === 'channel') {
            const length = Math.max(1, Math.hypot(dx, dy))
            const offset = { x: -dy / length * 34, y: dx / length * 34 }
            return <g key={drawing.id} data-drawing-id={drawing.id} className={className}>
              <line x1={first.x} y1={first.y} x2={second.x} y2={second.y} {...common} />
              <line x1={first.x + offset.x} y1={first.y + offset.y} x2={second.x + offset.x} y2={second.y + offset.y} {...common} />
              <line x1={first.x} y1={first.y} x2={first.x + offset.x} y2={first.y + offset.y} {...common} strokeOpacity={0.35} />
              <line x1={second.x} y1={second.y} x2={second.x + offset.x} y2={second.y + offset.y} {...common} strokeOpacity={0.35} />
            </g>
          }
          return <g key={drawing.id} data-drawing-id={drawing.id} className={className}>
            <line className="drawing-hit-target" x1={first.x} y1={first.y} x2={end.x} y2={end.y} />
            <line x1={first.x} y1={first.y} x2={end.x} y2={end.y} {...common} />
          </g>
        })}
        {rendered.flatMap((drawing) => {
          if (drawing.id !== selectedId || drawing.locked || drawing.type === 'freehand' || drawing.type === 'highlighter' || drawing.type === 'text') return []
          return drawing.anchors.flatMap((anchor, anchorIndex) => {
            const value = point(anchor)
            if (!value) return []
            const x = drawing.type === 'horizontal' ? Math.max(18, Math.min(width - 112, value.x)) : value.x
            return [<circle
              key={`${drawing.id}-anchor-${anchorIndex}`}
              className="drawing-anchor-handle"
              data-drawing-id={drawing.id}
              data-anchor-index={anchorIndex}
              cx={x}
              cy={value.y}
              r={6}
            />]
          })
        })}
      </svg>

      {selected && (
        <div className="drawing-inspector" onPointerDown={(event) => event.stopPropagation()}>
          <strong>{selected.type}</strong>
          <label>日期<input type="date" value={anchorDate(selected.anchors[0])} onChange={(event) => {
            const timestampMs = new Date(`${event.target.value}T00:00:00+08:00`).getTime()
            patchSelected({ anchors: [{ ...selected.anchors[0], timestampMs }, ...selected.anchors.slice(1)] })
          }} /></label>
          <label>价格<input
            aria-label="画线价格"
            type="number"
            step="0.01"
            min="0.01"
            title="滚轮微调 ±0.01；按住 Shift 为 ±0.10"
            value={selected.anchors[0].price.toFixed(2)}
            onWheel={(event) => {
              event.preventDefault()
              event.stopPropagation()
              const price = wheelAdjustedPrice(selected.anchors[0].price, event.deltaY, event.shiftKey ? 10 : 1)
              patchSelected({ anchors: [{ ...selected.anchors[0], price }, ...selected.anchors.slice(1)] })
            }}
            onChange={(event) => {
              const price = Number(event.target.value)
              if (Number.isFinite(price) && price > 0) patchSelected({ anchors: [{ ...selected.anchors[0], price }, ...selected.anchors.slice(1)] })
            }}
          /></label>
          {selected.type === 'text' && <label>文字<input value={selected.text ?? ''} onChange={(event) => patchSelected({ text: event.target.value })} /></label>}
          <label>颜色<input aria-label="画线颜色" type="color" value={selected.style.color} onChange={(event) => patchSelected({ style: { ...selected.style, color: event.target.value } })} /></label>
          <label>周期<select value={selected.timeframeVisibility === 'all' ? 'all' : 'current'} onChange={(event) => patchSelected({ timeframeVisibility: event.target.value === 'all' ? 'all' : [timeframe] })}><option value="all">全部周期</option><option value="current">仅{timeframe}</option></select></label>
          {selected.locked ? (
            <button onClick={() => patchSelected({ locked: false })}>解锁编辑</button>
          ) : (
            <button className="is-primary" title="完成并锁定当前画线" onClick={() => {
              patchSelected({ locked: true })
              setSelectedId(null)
            }}>完成画线</button>
          )}
          <button onClick={() => {
            const duplicate = translateDrawing({ ...selected, id: createDrawingId(), locked: false }, 86_400_000, selected.anchors[0].price * 0.01)
            onCommit([...drawings, duplicate]); setSelectedId(duplicate.id)
          }}>复制</button>
          <button onClick={() => patchSelected({ hidden: true })}>隐藏</button>
          <button className="is-danger" onClick={() => { onCommit(drawings.filter((drawing) => drawing.id !== selected.id)); setSelectedId(null) }}>删除</button>
        </div>
      )}
    </>
  )
}
