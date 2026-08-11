import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { ChipCostEstimate } from '../chips/calculate'
import { clampPanelDrag, type Point, type RectEdges } from '../chips/panelPosition'

export type PositionedChipRow = {
  y: number
  price: number
  weight: number
  profitable: boolean
}

type Props = {
  estimate: ChipCostEstimate
  rows: PositionedChipRow[]
  mainPaneHeight: number
  panelHeight: number
  width: number
  priceScaleOffset: number
  currentY: number | null
  averageY: number | null
  scaleMode: 'chart' | 'cost'
  scaleRange: [number, number] | null
  isLatest: boolean
  onResetToLatest: () => void
}

const qualityLabels = {
  turnover: '流通盘换手模型',
  mixed: '部分换手数据 · 混合估算',
  proxy: '成交量代理 · 降级估算',
} as const

type DragSnapshot = {
  pointerId: number
  pointerStart: Point
  offsetStart: Point
  panel: RectEdges
  card: RectEdges
}

export function ChipCostPanel({
  estimate,
  rows,
  mainPaneHeight,
  panelHeight,
  width,
  priceScaleOffset,
  currentY,
  averageY,
  scaleMode,
  scaleRange,
  isLatest,
  onResetToLatest,
}: Props) {
  const panelRef = useRef<HTMLElement>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragSnapshot | null>(null)
  const [summaryVisible, setSummaryVisible] = useState(true)
  const [summaryOffset, setSummaryOffset] = useState<Point>({ x: 0, y: 0 })
  const [summaryDragging, setSummaryDragging] = useState(false)

  if (!estimate.rows.length) return null
  const max = Math.max(...rows.map((row) => row.weight), 1e-12)
  const rowHeight = Math.max(3, Math.min(9, mainPaneHeight / Math.max(estimate.rows.length, 1) * 0.76))
  const isVisibleCoordinate = (value: number | null): value is number => value != null && value >= 0 && value <= mainPaneHeight
  const averageLabelShift = isVisibleCoordinate(currentY) && isVisibleCoordinate(averageY) && Math.abs(currentY - averageY) < 25
    ? averageY > currentY
      ? Math.min(24, Math.max(0, mainPaneHeight - averageY - 18))
      : -Math.min(24, Math.max(0, averageY - 18))
    : 0

  const startSummaryDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !panelRef.current || !summaryRef.current) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      pointerStart: { x: event.clientX, y: event.clientY },
      offsetStart: summaryOffset,
      panel: panelRef.current.getBoundingClientRect(),
      card: summaryRef.current.getBoundingClientRect(),
    }
    setSummaryDragging(true)
  }

  const moveSummary = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const delta = clampPanelDrag({
      x: event.clientX - drag.pointerStart.x,
      y: event.clientY - drag.pointerStart.y,
    }, drag.panel, drag.card)
    setSummaryOffset({ x: drag.offsetStart.x + delta.x, y: drag.offsetStart.y + delta.y })
  }

  const stopSummaryDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragRef.current = null
    setSummaryDragging(false)
  }

  return (
    <aside
      ref={panelRef}
      className="chip-cost-panel"
      aria-label={`筹码分布，截至${estimate.asOfDate}`}
      style={{ height: panelHeight, width: `${width}%`, right: priceScaleOffset }}
    >
      <header className="chip-panel-heading">
        <div>
          <strong>筹码分布</strong>
          <span>截至 {estimate.asOfDate}</span>
        </div>
        <div className="chip-heading-actions">
          {scaleMode === 'cost' && scaleRange && (
            <em className="chip-cost-axis" title="分钟价格范围过窄，筹码峰使用独立成本轴完整展示">
              成本轴 {scaleRange[0].toFixed(2)}–{scaleRange[1].toFixed(2)}
            </em>
          )}
          <em>{qualityLabels[estimate.quality]}</em>
          {!isLatest && <button type="button" onClick={onResetToLatest}>恢复最新</button>}
          {!summaryVisible && (
            <button className="chip-summary-show" type="button" onClick={() => setSummaryVisible(true)}>
              显示指标
            </button>
          )}
        </div>
      </header>

      <div className="chip-profile-bars" aria-hidden="true">
        {rows.map((row, index) => (
          <i
            key={`${row.price}-${index}`}
            className={`${row.profitable ? 'is-profit' : 'is-loss'}${Math.abs(row.price - estimate.poc) < 1e-8 ? ' is-poc' : ''}`}
            style={{ top: row.y, width: `${Math.max(2, row.weight / max * 100)}%`, height: rowHeight }}
            title={`${row.price.toFixed(2)} · ${(row.weight * 100).toFixed(2)}%`}
          />
        ))}
      </div>

      {panelHeight > mainPaneHeight && (
        <div
          className="chip-panel-footer-space"
          aria-hidden="true"
          style={{ top: mainPaneHeight, height: panelHeight - mainPaneHeight }}
        />
      )}

      {isVisibleCoordinate(currentY) && (
        <div className="chip-reference-line is-current" style={{ top: currentY }}>
          <span>现价</span><strong>{estimate.currentPrice.toFixed(2)}</strong>
        </div>
      )}
      {isVisibleCoordinate(averageY) && (
        <div className="chip-reference-line is-average" style={{ top: averageY }}>
          <span style={{ transform: `translateY(${averageLabelShift}px)` }}>均价</span>
          <strong style={{ transform: `translateY(${averageLabelShift}px)` }}>{estimate.averageCost.toFixed(2)}</strong>
        </div>
      )}

      {summaryVisible && (
        <div
          ref={summaryRef}
          className={`chip-panel-summary${summaryDragging ? ' is-dragging' : ''}`}
          role="group"
          aria-label="筹码指标卡"
          style={{ transform: `translate(${summaryOffset.x}px, ${summaryOffset.y}px)` }}
        >
          <div
            className="chip-summary-toolbar"
            aria-label="拖动筹码指标卡"
            onPointerDown={startSummaryDrag}
            onPointerMove={moveSummary}
            onPointerUp={stopSummaryDrag}
            onPointerCancel={stopSummaryDrag}
          >
            <strong>筹码指标</strong>
            <span>拖动</span>
            <button
              type="button"
              aria-label="关闭筹码指标"
              title="关闭筹码指标"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setSummaryVisible(false)}
            >
              ×
            </button>
          </div>
          <div className="chip-summary-primary">
            <span>收盘获利<strong>{(estimate.profitRatio * 100).toFixed(1)}%</strong></span>
            <span>平均成本<strong>{estimate.averageCost.toFixed(2)}</strong></span>
          </div>
          <dl>
            <div><dt>70%筹码</dt><dd>{estimate.range70[0].toFixed(2)}–{estimate.range70[1].toFixed(2)}</dd><small>集中度 {(estimate.concentration70 * 100).toFixed(1)}%</small></div>
            <div><dt>90%筹码</dt><dd>{estimate.range90[0].toFixed(2)}–{estimate.range90[1].toFixed(2)}</dd><small>集中度 {(estimate.concentration90 * 100).toFixed(1)}%</small></div>
          </dl>
          <div className="chip-legend">
            <span><i className="is-profit" />获利筹码</span>
            <span><i className="is-loss" />套牢筹码</span>
            <small>模型估算，不代表真实账户持仓</small>
          </div>
        </div>
      )}
    </aside>
  )
}
