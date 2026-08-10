import { describe, expect, it } from 'vitest'
import { defaultDrawingStyle, toolToDrawingType } from './model'

describe('drawing model', () => {
  it('maps every implemented toolbar tool to a stable drawing type', () => {
    expect(toolToDrawingType('水平线')).toBe('horizontal')
    expect(toolToDrawingType('趋势线')).toBe('trend')
    expect(toolToDrawingType('自由画笔')).toBe('freehand')
    expect(toolToDrawingType('选择')).toBeNull()
  })

  it('uses a translucent wide stroke for the highlighter', () => {
    const style = defaultDrawingStyle('highlighter')
    expect(style.width).toBeGreaterThan(10)
    expect(style.opacity).toBeLessThan(0.5)
  })
})
