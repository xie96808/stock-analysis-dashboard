import { describe, expect, it } from 'vitest'
import { commitDrawingGesture, defaultDrawingStyle, drawingLayerClassName, drawingUsesTimeCoordinate, formatMeasurement, movePointDrawing, replaceDrawingAnchor, toolToDrawingType, wheelAdjustedFontSize, wheelAdjustedPrice, type Drawing } from './model'

describe('drawing model', () => {
  it('maps every implemented toolbar tool to a stable drawing type', () => {
    expect(toolToDrawingType('水平线')).toBe('horizontal')
    expect(toolToDrawingType('趋势线')).toBe('trend')
    expect(toolToDrawingType('自由画笔')).toBe('freehand')
    expect(toolToDrawingType('测量')).toBe('measurement')
    expect(toolToDrawingType('选择')).toBeNull()
  })

  it('uses a translucent wide stroke for the highlighter', () => {
    const style = defaultDrawingStyle('highlighter')
    expect(style.width).toBeGreaterThan(10)
    expect(style.opacity).toBeLessThan(0.5)
  })

  it('keeps the SVG interactive while a drawing is selected for editing', () => {
    expect(drawingLayerClassName(null, 'line-1')).toContain('has-selection')
    expect(drawingLayerClassName('trend', null)).toContain('is-creating')
    expect(drawingLayerClassName(null, null)).toBe('drawing-layer')
  })

  it('renders horizontal prices without requiring a matching time coordinate', () => {
    expect(drawingUsesTimeCoordinate('horizontal')).toBe(false)
    expect(drawingUsesTimeCoordinate('trend')).toBe(true)
  })

  it('formats price, percentage and elapsed time for measurements', () => {
    expect(formatMeasurement(
      { timestampMs: 0, price: 10 },
      { timestampMs: 2 * 86_400_000, price: 12 },
    )).toBe('+2.00 · +20.00% · 2天')
  })

  it('replaces only the dragged endpoint', () => {
    const drawing: Drawing = {
      id: 'line-1', symbol: 'SZSE:001280', market: 'CN', type: 'trend',
      anchors: [{ timestampMs: 1, price: 10 }, { timestampMs: 2, price: 20 }],
      timeframeVisibility: 'all', locked: false, hidden: false,
      style: defaultDrawingStyle('trend'),
    }
    const next = replaceDrawingAnchor(drawing, 1, { timestampMs: 3, price: 21 })
    expect(next.anchors).toEqual([{ timestampMs: 1, price: 10 }, { timestampMs: 3, price: 21 }])
  })

  it('steps prices by the wheel direction with an optional accelerator', () => {
    expect(wheelAdjustedPrice(59.85, -100)).toBe(59.86)
    expect(wheelAdjustedPrice(59.85, 100)).toBe(59.84)
    expect(wheelAdjustedPrice(59.85, -100, 10)).toBe(59.95)
  })

  it('scales text within readable limits using the wheel', () => {
    expect(wheelAdjustedFontSize(undefined, -100)).toBe(17)
    expect(wheelAdjustedFontSize(24, 100)).toBe(23)
    expect(wheelAdjustedFontSize(72, -100)).toBe(72)
    expect(wheelAdjustedFontSize(10, 100)).toBe(10)
  })

  it('moves a one-anchor text directly onto a valid chart coordinate', () => {
    const drawing: Drawing = {
      id: 'text-1', symbol: 'SZSE:001280', market: 'CN', type: 'text',
      anchors: [{ timestampMs: 1, price: 10 }], text: '判断',
      timeframeVisibility: 'all', locked: false, hidden: false,
      style: defaultDrawingStyle('text'),
    }
    const moved = movePointDrawing(drawing, { timestampMs: 3, price: 12 })
    expect(moved.anchors).toEqual([{ timestampMs: 3, price: 12 }])
  })

  it('commits endpoint edits in place instead of duplicating a drawing', () => {
    const drawing: Drawing = {
      id: 'line-1', symbol: 'SZSE:001280', market: 'CN', type: 'trend',
      anchors: [{ timestampMs: 1, price: 10 }, { timestampMs: 2, price: 20 }],
      timeframeVisibility: 'all', locked: false, hidden: false,
      style: defaultDrawingStyle('trend'),
    }
    const edited = replaceDrawingAnchor(drawing, 1, { timestampMs: 3, price: 21 })
    expect(commitDrawingGesture([drawing], edited, false)).toEqual([edited])
  })
})
