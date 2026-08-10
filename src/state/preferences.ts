import type { IndicatorConfig } from '../components/ChartWorkbench'
import type { Drawing, DrawingAnchor, DrawingStore, DrawingStyle, DrawingType } from '../drawings/model'

const drawingTypes = new Set<DrawingType>([
  'horizontal',
  'trend',
  'ray',
  'channel',
  'rectangle',
  'profile-range',
  'text',
  'freehand',
  'highlighter',
  'measurement',
])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function drawingAnchor(value: unknown): DrawingAnchor | null {
  if (!isObject(value) || !finiteNumber(value.timestampMs) || !finiteNumber(value.price) || value.price <= 0) return null
  return {
    timestampMs: value.timestampMs,
    price: value.price,
    ...(finiteNumber(value.pressure) ? { pressure: value.pressure } : {}),
  }
}

function drawingStyle(value: unknown): DrawingStyle | null {
  if (!isObject(value) || typeof value.color !== 'string' || !finiteNumber(value.width) || !finiteNumber(value.opacity)) return null
  if (value.width <= 0 || value.opacity < 0 || value.opacity > 1) return null
  return {
    color: value.color,
    width: value.width,
    opacity: value.opacity,
    ...(value.dash === 'solid' || value.dash === 'dashed' ? { dash: value.dash } : {}),
  }
}

function drawing(value: unknown): Drawing | null {
  if (!isObject(value)) return null
  if (typeof value.id !== 'string' || typeof value.symbol !== 'string') return null
  if (value.market !== 'CN' && value.market !== 'HK') return null
  if (typeof value.type !== 'string' || !drawingTypes.has(value.type as DrawingType)) return null
  if (!Array.isArray(value.anchors)) return null
  const anchors = value.anchors.map(drawingAnchor)
  if (!anchors.length || anchors.some((anchor) => anchor === null)) return null
  const style = drawingStyle(value.style)
  if (!style) return null
  const path = Array.isArray(value.path) ? value.path.map(drawingAnchor) : undefined
  if (path?.some((anchor) => anchor === null)) return null
  const timeframeVisibility = value.timeframeVisibility === 'all'
    ? 'all'
    : Array.isArray(value.timeframeVisibility) && value.timeframeVisibility.every((item) => typeof item === 'string')
      ? value.timeframeVisibility
      : 'all'

  return {
    id: value.id,
    symbol: value.symbol,
    market: value.market,
    type: value.type as DrawingType,
    anchors: anchors as DrawingAnchor[],
    ...(path ? { path: path as DrawingAnchor[] } : {}),
    ...(typeof value.text === 'string' ? { text: value.text } : {}),
    timeframeVisibility,
    locked: value.locked === true,
    hidden: value.hidden === true,
    style,
  }
}

export function parseDrawingStore(raw: string | null): DrawingStore {
  if (!raw) return { version: 1, workspaces: {} }
  try {
    const value: unknown = JSON.parse(raw)
    if (!isObject(value) || value.version !== 1 || !isObject(value.workspaces)) {
      return { version: 1, workspaces: {} }
    }
    const workspaces: Record<string, Drawing[]> = {}
    Object.entries(value.workspaces).forEach(([key, items]) => {
      if (!Array.isArray(items)) return
      workspaces[key] = items.map(drawing).filter((item): item is Drawing => item !== null)
    })
    return { version: 1, workspaces }
  } catch {
    return { version: 1, workspaces: {} }
  }
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value as number)) : fallback
}

export function parseIndicatorConfig(raw: string | null, defaults: IndicatorConfig): IndicatorConfig {
  if (!raw) return defaults
  try {
    const value: unknown = JSON.parse(raw)
    if (!isObject(value)) return defaults
    const maPeriods = Array.isArray(value.maPeriods)
      ? value.maPeriods
        .filter((period): period is number => Number.isInteger(period) && period > 0 && period <= 500)
        .slice(0, 6)
      : []
    return {
      maEnabled: typeof value.maEnabled === 'boolean' ? value.maEnabled : defaults.maEnabled,
      maPeriods: maPeriods.length ? maPeriods : defaults.maPeriods,
      emaEnabled: typeof value.emaEnabled === 'boolean' ? value.emaEnabled : defaults.emaEnabled,
      emaPeriod: boundedInteger(value.emaPeriod, defaults.emaPeriod, 2, 500),
      volumeEnabled: typeof value.volumeEnabled === 'boolean' ? value.volumeEnabled : defaults.volumeEnabled,
      macdEnabled: typeof value.macdEnabled === 'boolean' ? value.macdEnabled : defaults.macdEnabled,
      macdFast: boundedInteger(value.macdFast, defaults.macdFast, 2, 200),
      macdSlow: boundedInteger(value.macdSlow, defaults.macdSlow, 2, 200),
      macdSignal: boundedInteger(value.macdSignal, defaults.macdSignal, 2, 200),
    }
  } catch {
    return defaults
  }
}

export function shanghaiDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
