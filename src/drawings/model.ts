export type DrawingType = 'horizontal' | 'trend' | 'ray' | 'channel' | 'rectangle' | 'profile-range' | 'text' | 'freehand' | 'highlighter' | 'measurement'

export type DrawingAnchor = {
  timestampMs: number
  price: number
  pressure?: number
}

export type DrawingStyle = {
  color: string
  width: number
  opacity: number
  dash?: 'solid' | 'dashed'
  fontSize?: number
}

export type Drawing = {
  id: string
  symbol: string
  market: 'CN' | 'HK'
  type: DrawingType
  anchors: DrawingAnchor[]
  path?: DrawingAnchor[]
  text?: string
  timeframeVisibility: string[] | 'all'
  locked: boolean
  hidden: boolean
  style: DrawingStyle
}

export type DrawingStore = {
  version: 1
  workspaces: Record<string, Drawing[]>
}

export const emptyDrawingStore: DrawingStore = { version: 1, workspaces: {} }

export function defaultDrawingStyle(type: DrawingType): DrawingStyle {
  if (type === 'highlighter') return { color: '#f2c94c', width: 14, opacity: 0.34 }
  if (type === 'freehand') return { color: '#2962e8', width: 2.2, opacity: 0.92 }
  if (type === 'rectangle') return { color: '#2962e8', width: 1.7, opacity: 0.16 }
  if (type === 'profile-range') return { color: '#8b61d6', width: 1.6, opacity: 0.1, dash: 'dashed' }
  if (type === 'measurement') return { color: '#566274', width: 1.5, opacity: 0.9, dash: 'dashed' }
  if (type === 'text') return { color: '#343a46', width: 1.5, opacity: 1, fontSize: 16 }
  return { color: '#e84f63', width: 1.8, opacity: 0.95 }
}

export function toolToDrawingType(tool: string): DrawingType | null {
  return ({
    水平线: 'horizontal',
    趋势线: 'trend',
    射线: 'ray',
    平行通道: 'channel',
    矩形区域: 'rectangle',
    锚定分布: 'profile-range',
    文本: 'text',
    自由画笔: 'freehand',
    荧光笔: 'highlighter',
    测量: 'measurement',
  } as Record<string, DrawingType>)[tool] ?? null
}

export function drawingLayerClassName(drawingType: DrawingType | null, selectedId: string | null) {
  return `drawing-layer${drawingType ? ' is-creating' : ''}${selectedId ? ' has-selection' : ''}`
}

export function drawingUsesTimeCoordinate(type: DrawingType) {
  return type !== 'horizontal'
}

export function formatMeasurement(start: DrawingAnchor, end: DrawingAnchor) {
  const change = end.price - start.price
  const percent = start.price > 0 ? change / start.price * 100 : 0
  const elapsedMinutes = Math.max(0, Math.round(Math.abs(end.timestampMs - start.timestampMs) / 60_000))
  const duration = elapsedMinutes >= 1_440
    ? `${Math.round(elapsedMinutes / 1_440)}天`
    : elapsedMinutes >= 60
      ? `${Math.round(elapsedMinutes / 60)}小时`
      : `${elapsedMinutes}分钟`
  const sign = change > 0 ? '+' : ''
  return `${sign}${change.toFixed(2)} · ${sign}${percent.toFixed(2)}% · ${duration}`
}

export function createDrawingId() {
  return `drawing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function replaceDrawingAnchor(drawing: Drawing, index: number, anchor: DrawingAnchor): Drawing {
  if (index < 0 || index >= drawing.anchors.length) return drawing
  return {
    ...drawing,
    anchors: drawing.anchors.map((current, currentIndex) => currentIndex === index ? anchor : current),
  }
}

export function wheelAdjustedPrice(price: number, deltaY: number, multiplier = 1): number {
  const direction = deltaY < 0 ? 1 : deltaY > 0 ? -1 : 0
  if (!direction) return price
  return Math.max(0.01, Number((price + direction * 0.01 * multiplier).toFixed(4)))
}

export function wheelAdjustedFontSize(fontSize: number | undefined, deltaY: number): number {
  const current = Number.isFinite(fontSize) ? Number(fontSize) : 16
  const direction = deltaY < 0 ? 1 : deltaY > 0 ? -1 : 0
  return Math.max(10, Math.min(72, current + direction))
}

export function movePointDrawing(drawing: Drawing, anchor: DrawingAnchor): Drawing {
  if (drawing.anchors.length !== 1) return drawing
  return { ...drawing, anchors: [anchor] }
}

export function commitDrawingGesture(drawings: Drawing[], draft: Drawing, isCreate: boolean): Drawing[] {
  return isCreate
    ? [...drawings, draft]
    : drawings.map((drawing) => drawing.id === draft.id ? draft : drawing)
}
