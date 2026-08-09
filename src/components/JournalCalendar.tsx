import { useMemo, useState } from 'react'
import { Icon } from './Icon'

type Props = {
  selectedDate: string
  recordDates: string[]
  onSelect: (date: string) => void
  onClose: () => void
}

function dateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function JournalCalendar({ selectedDate, recordDates, onSelect, onClose }: Props) {
  const initial = new Date(`${selectedDate}T12:00:00+08:00`)
  const [cursor, setCursor] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1))
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    recordDates.forEach((date) => map.set(date, (map.get(date) ?? 0) + 1))
    return map
  }, [recordDates])

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const startWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const previousMonthDays = new Date(year, month, 0).getDate()

  const cells = Array.from({ length: 42 }, (_, index) => {
    const localDay = index - startWeekday + 1
    if (localDay < 1) {
      const date = new Date(year, month - 1, previousMonthDays + localDay)
      return { date: dateKey(date.getFullYear(), date.getMonth(), date.getDate()), day: date.getDate(), adjacent: true }
    }
    if (localDay > daysInMonth) {
      const date = new Date(year, month + 1, localDay - daysInMonth)
      return { date: dateKey(date.getFullYear(), date.getMonth(), date.getDate()), day: date.getDate(), adjacent: true }
    }
    return { date: dateKey(year, month, localDay), day: localDay, adjacent: false }
  })

  const moveMonth = (offset: number) => {
    setCursor((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1))
  }

  return (
    <div className="journal-calendar" role="dialog" aria-label="按日期查找研究记录">
      <div className="calendar-toolbar">
        <button aria-label="上个月" onClick={() => moveMonth(-1)}><Icon name="chevron" /></button>
        <strong>{year}年{month + 1}月</strong>
        <button aria-label="下个月" onClick={() => moveMonth(1)}><Icon name="chevron" /></button>
      </div>
      <div className="calendar-weekdays">
        {['日', '一', '二', '三', '四', '五', '六'].map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className="calendar-grid">
        {cells.map((cell) => {
          const count = counts.get(cell.date) ?? 0
          return (
            <button
              key={cell.date}
              className={`${cell.adjacent ? 'is-adjacent' : ''}${cell.date === selectedDate ? ' is-selected' : ''}${count ? ' has-records' : ''}`}
              onClick={() => {
                onSelect(cell.date)
                onClose()
              }}
              aria-label={`${cell.date}${count ? `，${count}条记录` : '，没有记录'}`}
            >
              <span>{cell.day}</span>
              {count > 0 && <i>{count}</i>}
            </button>
          )
        })}
      </div>
      <div className="calendar-footer">
        <span><i />有记录</span>
        <button onClick={() => {
          onSelect('2026-08-09')
          setCursor(new Date(2026, 7, 1))
          onClose()
        }}>回到今天</button>
      </div>
    </div>
  )
}
