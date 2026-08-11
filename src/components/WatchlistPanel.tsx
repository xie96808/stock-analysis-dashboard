import { useMemo, useState } from 'react'
import { nextPendingItem, updateReviewStatus, type ReviewStatus, type WatchlistItem } from '../watchlist/model'

type Props = {
  currentKey: string
  items: WatchlistItem[]
  onChange: (items: WatchlistItem[]) => void
  onSelect: (item: WatchlistItem) => void
  onClose: () => void
  onMessage: (message: string) => void
}

const statusLabels: Record<ReviewStatus, string> = { pending: '待复盘', reviewed: '已复盘', focus: '重点' }

export function WatchlistPanel({ currentKey, items, onChange, onSelect, onClose, onMessage }: Props) {
  const [filter, setFilter] = useState<'all' | ReviewStatus>('all')
  const filtered = useMemo(() => filter === 'all' ? items : items.filter((item) => item.status === filter), [filter, items])
  const pendingCount = items.filter((item) => item.status === 'pending').length

  const next = () => {
    const item = nextPendingItem(items, currentKey)
    if (!item) { onMessage('自选股均已完成复盘'); return }
    onSelect(item)
  }

  return <div className="watchlist-backdrop" role="dialog" aria-modal="true" aria-label="自选股与批量复盘">
    <aside className="watchlist-panel">
      <header><div><span className="eyebrow">自选与复盘队列</span><h2>我的自选股</h2><p>{items.length} 只 · {pendingCount} 只待复盘</p></div><button aria-label="关闭自选股" onClick={onClose}>×</button></header>
      <div className="watchlist-summary"><button className="is-primary" onClick={next}>下一只待复盘</button><button onClick={() => onChange(items.map((item) => updateReviewStatus(item, 'pending')))}>重置今日队列</button></div>
      <nav aria-label="自选股筛选">{(['all', 'pending', 'focus', 'reviewed'] as const).map((value) => <button key={value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{value === 'all' ? '全部' : statusLabels[value]}{value !== 'all' ? ` ${items.filter((item) => item.status === value).length}` : ''}</button>)}</nav>
      <div className="watchlist-items">
        {filtered.map((item) => <article key={item.key} className={item.key === currentKey ? 'is-current' : ''}>
          <button className="watchlist-symbol" onClick={() => onSelect(item)}><strong>{item.name}</strong><span>{item.symbol} · {item.exchange}</span></button>
          <select aria-label={`${item.name}复盘状态`} value={item.status} onChange={(event) => onChange(items.map((entry) => entry.key === item.key ? updateReviewStatus(entry, event.target.value as ReviewStatus) : entry))}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
          <input aria-label={`${item.name}复盘备注`} value={item.note} placeholder="一句话复盘备注" onChange={(event) => onChange(items.map((entry) => entry.key === item.key ? { ...entry, note: event.target.value } : entry))} />
          <button className="watchlist-remove" aria-label={`删除 ${item.name}`} onClick={() => onChange(items.filter((entry) => entry.key !== item.key))}>删除</button>
        </article>)}
        {!filtered.length && <div className="watchlist-empty"><strong>{items.length ? '当前筛选为空' : '还没有自选股'}</strong><span>点击行情名称前的星标，即可加入当前股票。</span></div>}
      </div>
      <footer>状态和备注自动保存在本机；“下一只待复盘”会顺序加载队列。</footer>
    </aside>
  </div>
}
