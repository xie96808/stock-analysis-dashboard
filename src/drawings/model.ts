export type DrawingType = 'horizontal' | 'trend' | 'ray' | 'channel' | 'rectangle' | 'profile-range' | 'text' | 'freehand' | 'highlighter'

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
  if (type === 'text') return { color: '#343a46', width: 1.5, opacity: 1 }
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
  } as Record<string, DrawingType>)[tool] ?? null
}

export function createDrawingId() {
  return `drawing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
