/** Tongdaxin-compatible indicator formulas. Chart, alerts and tests all use this file. */

export type IndicatorBar = {
  date: string
  high: number
  low: number
  close: number
  volume?: number
}

export type MacdPoint = {
  date: string
  dif: number
  dea: number
  histogram: number
}

export type BollingerPoint = {
  date: string
  mid: number | null
  upper: number | null
  lower: number | null
}

export type SarPoint = {
  date: string
  value: number
  uptrend: boolean
}

/** TDX EMA(X,N) = (2*X + (N-1)*REF(EMA,1)) / (N+1), seeded with the first value. */
export function ema(values: number[], period: number) {
  if (period < 1) return values.map(() => Number.NaN)
  const smoothing = 2 / (period + 1)
  const result: number[] = []
  let previous = values[0] ?? 0
  values.forEach((value, index) => {
    previous = index === 0 ? value : value * smoothing + previous * (1 - smoothing)
    result.push(previous)
  })
  return result
}

/** TDX MA(X,N): simple mean, blank until the window is full. */
export function sma(values: number[], period: number) {
  return values.map((_, index) => {
    if (period < 1 || index + 1 < period) return null
    const window = values.slice(index + 1 - period, index + 1)
    return window.reduce((sum, value) => sum + value, 0) / period
  })
}

export function movingAverage(bars: IndicatorBar[], period: number, exponential = false) {
  const closes = bars.map((bar) => bar.close)
  if (exponential) return ema(closes, period)
  return sma(closes, period)
}

export function volumeMovingAverage(bars: Array<{ volume?: number }>, period: number) {
  return sma(bars.map((bar) => bar.volume ?? 0), period)
}

/**
 * TDX MACD: DIF = EMA(C,fast)-EMA(C,slow), DEA = EMA(DIF,signal),
 * histogram = (DIF-DEA)*2.
 */
export function calculateMacd(
  bars: IndicatorBar[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdPoint[] {
  const closes = bars.map((bar) => bar.close)
  const fast = ema(closes, fastPeriod)
  const slow = ema(closes, slowPeriod)
  const dif = fast.map((value, index) => value - slow[index])
  const dea = ema(dif, signalPeriod)
  return bars.map((bar, index) => ({
    date: bar.date,
    dif: dif[index],
    dea: dea[index],
    histogram: (dif[index] - dea[index]) * 2,
  }))
}

/** TDX BOLL: mid = MA(C,N), bands use population STD (divide by N). */
export function bollingerBands(bars: IndicatorBar[], period = 20, multiplier = 2): BollingerPoint[] {
  const mids = sma(bars.map((bar) => bar.close), period)
  return bars.map((bar, index) => {
    const mid = mids[index]
    if (mid == null) return { date: bar.date, mid: null, upper: null, lower: null }
    const window = bars.slice(index + 1 - period, index + 1)
    const variance = window.reduce((sum, item) => sum + (item.close - mid) ** 2, 0) / period
    const deviation = Math.sqrt(variance) * multiplier
    return { date: bar.date, mid, upper: mid + deviation, lower: mid - deviation }
  })
}

/**
 * Wilder parabolic SAR as used by TDX SAR(*, S, M) with S/M in percent
 * (default 0.02 / 0.20). Today's SAR uses yesterday's AF and EP; then EP/AF
 * update, or reverse onto the prior extreme.
 */
export function parabolicSar(bars: IndicatorBar[], step = 0.02, maximum = 0.2): Array<SarPoint | null> {
  if (bars.length === 0) return []
  if (bars.length === 1) return [{ date: bars[0].date, value: bars[0].low, uptrend: true }]
  let uptrend = bars[1].close >= bars[0].close
  let sar = uptrend ? bars[0].low : bars[0].high
  let extreme = uptrend ? bars[0].high : bars[0].low
  let acceleration = step
  const result: Array<SarPoint | null> = [{ date: bars[0].date, value: sar, uptrend }]
  for (let index = 1; index < bars.length; index += 1) {
    const bar = bars[index]
    const previous = bars[index - 1]
    const prior = bars[index - 2] ?? previous
    let next = sar + acceleration * (extreme - sar)
    next = uptrend
      ? Math.min(next, previous.low, prior.low)
      : Math.max(next, previous.high, prior.high)
    const reversed = (uptrend && bar.low < next) || (!uptrend && bar.high > next)
    if (reversed) {
      next = extreme
      uptrend = !uptrend
      extreme = uptrend ? bar.high : bar.low
      acceleration = step
    } else if (uptrend && bar.high > extreme) {
      extreme = bar.high
      acceleration = Math.min(maximum, acceleration + step)
    } else if (!uptrend && bar.low < extreme) {
      extreme = bar.low
      acceleration = Math.min(maximum, acceleration + step)
    }
    sar = next
    result.push({ date: bar.date, value: sar, uptrend })
  }
  return result
}
