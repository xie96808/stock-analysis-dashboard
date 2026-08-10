import { describe, expect, it } from 'vitest'
import { clampPanelDrag, extendedChipPanelHeight } from './panelPosition'

const panel = { top: 0, right: 400, bottom: 600, left: 0 }
const card = { top: 390, right: 390, bottom: 590, left: 10 }

describe('clampPanelDrag', () => {
  it('keeps an in-bounds drag unchanged', () => {
    expect(clampPanelDrag({ x: -5, y: -120 }, panel, card)).toEqual({ x: -5, y: -120 })
  })

  it('keeps every card edge inside its panel', () => {
    expect(clampPanelDrag({ x: -100, y: 100 }, panel, card)).toEqual({ x: -10, y: 10 })
    expect(clampPanelDrag({ x: 100, y: -500 }, panel, card)).toEqual({ x: 10, y: -390 })
  })
})

describe('extendedChipPanelHeight', () => {
  it('adds a footer buffer without exceeding the chart', () => {
    expect(extendedChipPanelHeight(420, 620, 76)).toBe(496)
    expect(extendedChipPanelHeight(580, 620, 76)).toBe(620)
    expect(extendedChipPanelHeight(420, 0, 76)).toBe(420)
  })
})
