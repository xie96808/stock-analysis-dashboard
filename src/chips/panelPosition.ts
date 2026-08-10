export type Point = {
  x: number
  y: number
}

export type RectEdges = {
  top: number
  right: number
  bottom: number
  left: number
}

export function clampPanelDrag(delta: Point, panel: RectEdges, card: RectEdges): Point {
  return {
    x: Math.min(panel.right - card.right, Math.max(panel.left - card.left, delta.x)),
    y: Math.min(panel.bottom - card.bottom, Math.max(panel.top - card.top, delta.y)),
  }
}

export function extendedChipPanelHeight(mainPaneHeight: number, chartHeight: number, extension: number): number {
  const main = Math.max(0, mainPaneHeight)
  const available = chartHeight > 0 ? Math.max(main, chartHeight) : main
  return Math.min(available, main + Math.max(0, extension))
}
