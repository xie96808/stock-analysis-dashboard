export type SupportedMarket = 'CN' | 'HK'

export type MarketSessionState = {
  open: boolean
  phase: 'preopen' | 'morning' | 'lunch' | 'afternoon' | 'closed' | 'weekend'
  label: string
}

type ShanghaiClock = {
  weekday: number
  minutes: number
}

function shanghaiClock(now: Date): ShanghaiClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday)
  return {
    weekday,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  }
}

export function marketSessionState(now: Date, market: SupportedMarket): MarketSessionState {
  const clock = shanghaiClock(now)
  if (clock.weekday === 0 || clock.weekday === 6) {
    return { open: false, phase: 'weekend', label: '周末休市' }
  }

  const morningEnd = market === 'HK' ? 12 * 60 : 11 * 60 + 30
  const afternoonEnd = market === 'HK' ? 16 * 60 : 15 * 60
  if (clock.minutes < 9 * 60 + 30) return { open: false, phase: 'preopen', label: '等待开市' }
  if (clock.minutes < morningEnd) return { open: true, phase: 'morning', label: '上午交易' }
  if (clock.minutes < 13 * 60) return { open: false, phase: 'lunch', label: '午间休市' }
  if (clock.minutes < afternoonEnd) return { open: true, phase: 'afternoon', label: '下午交易' }
  return { open: false, phase: 'closed', label: '已收市' }
}

