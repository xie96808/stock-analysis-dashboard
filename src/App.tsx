import { useCallback, useMemo, useState } from 'react'
import { ChartWorkbench } from './components/ChartWorkbench'
import { Icon } from './components/Icon'
import { IntradayView } from './components/IntradayView'
import { JournalCalendar } from './components/JournalCalendar'
import { fixtureBars, type StockBar } from './data/fixture'
import './styles.css'

const timeframes = ['1分', '5分', '15分', '30分', '60分', '日K', '周K', '月K']

const tools = [
  ['cursor', '选择'],
  ['trend', '趋势线'],
  ['horizontal', '水平线'],
  ['brush', '自由画笔'],
  ['rectangle', '矩形区域'],
  ['text', '文本'],
  ['measure', '测量'],
  ['eraser', '橡皮擦'],
] as const

type RecordItem = {
  id: number
  date: string
  time: string
  title: string
  body: string
  color: 'blue' | 'amber' | 'slate'
}

const initialRecords: RecordItem[] = [
  {
    id: 1,
    date: '2026-08-09',
    time: '18:42',
    title: '日线 · 量价等待确认',
    body: '收盘量能温和回升，等待下一交易日确认关键区间的承接。',
    color: 'blue',
  },
  {
    id: 2,
    date: '2026-08-09',
    time: '18:17',
    title: '结构观察',
    body: '价格回到前期成交密集区，观察后续突破是否有效。',
    color: 'amber',
  },
  {
    id: 3,
    date: '2026-08-03',
    time: '19:06',
    title: '日线 · 右侧确认前的预案',
    body: '反弹进入前期成交区，暂不追价，等待收盘确认。',
    color: 'slate',
  },
  {
    id: 4,
    date: '2026-07-28',
    time: '18:31',
    title: '低位结构观察',
    body: '低点附近出现缩量整理，先记录，不提前定义反转。',
    color: 'slate',
  },
]

function compactVolume(volume: number) {
  return `${(volume / 1_000_000).toFixed(2)}M`
}

export default function App() {
  const lastBar = fixtureBars.at(-1)!
  const [hoverBar, setHoverBar] = useState<StockBar | null>(null)
  const [logPrice, setLogPrice] = useState(true)
  const [profileVisible, setProfileVisible] = useState(true)
  const [cleanMode, setCleanMode] = useState(false)
  const [journalOpen, setJournalOpen] = useState(true)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [selectedJournalDate, setSelectedJournalDate] = useState('2026-08-09')
  const [selectedDay, setSelectedDay] = useState<StockBar | null>(null)
  const [timeframe, setTimeframe] = useState('日K')
  const [activeTool, setActiveTool] = useState('选择')
  const [workspace, setWorkspace] = useState('主分析')
  const [note, setNote] = useState('')
  const [records, setRecords] = useState(initialRecords)
  const [toast, setToast] = useState('P0 演示数据 · 2026-08-07 收盘')

  const displayBar = hoverBar ?? lastBar
  const handleHoverBar = useCallback((bar: StockBar | null) => setHoverBar(bar), [])

  const displayDate = useMemo(() => {
    const source = displayBar.date.split('-')
    return `${source[0]}年${Number(source[1])}月${Number(source[2])}日`
  }, [displayBar.date])

  const journalDateLabel = useMemo(() => {
    const [year, month, day] = selectedJournalDate.split('-').map(Number)
    return `${year}年${month}月${day}日`
  }, [selectedJournalDate])

  const filteredRecords = useMemo(
    () => records.filter((record) => record.date === selectedJournalDate),
    [records, selectedJournalDate],
  )

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 2600)
  }

  const addRecord = () => {
    const body = note.trim()
    if (!body) {
      notify('请先写下本次判断')
      return
    }

    setRecords((current) => [
      {
        id: Date.now(),
        date: selectedJournalDate,
        time: new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()),
        title: `${timeframe} · 手动记录`,
        body,
        color: 'blue',
      },
      ...current,
    ])
    setNote('')
    notify('已保存本次 Markdown 记录与图表快照占位')
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand" aria-label="研判看板">
          <span className="brand-mark">研</span>
          <span className="brand-name">研判</span>
          <span className="brand-phase">P0</span>
        </div>

        <div className="symbol-search">
          <Icon name="search" />
          <input defaultValue="001280" aria-label="股票代码" />
          <span className="search-market">SZ</span>
        </div>

        <nav className="header-nav" aria-label="工作区导航">
          <button className="nav-item is-active">图表</button>
          <button className="nav-item" onClick={() => notify('策略复盘将在后续阶段接入')}>复盘</button>
          <button className="nav-item" onClick={() => notify('数据管理将在行情接入阶段开放')}>数据</button>
        </nav>

        <div className="header-actions">
          <label className="workspace-select">
            <Icon name="layers" />
            <select value={workspace} onChange={(event) => setWorkspace(event.target.value)}>
              <option>主分析</option>
              <option>长期趋势</option>
              <option>短线计划</option>
            </select>
          </label>
          <button className="icon-button" title="导出截图" onClick={() => notify('高清截图导出占位已触发')}><Icon name="camera" /></button>
          <button className="icon-button" title="全屏" onClick={() => notify('全屏模式将在视觉确认后接入')}><Icon name="fullscreen" /></button>
          <button className="icon-button" title="设置" onClick={() => notify('设置面板占位')}><Icon name="settings" /></button>
        </div>
      </header>

      <section className="quote-header">
        <div className="instrument">
          <div className="instrument-title">
            <span className="favorite">★</span>
            <strong>中国铀业</strong>
            <span className="instrument-code">001280</span>
            <span className="market-tag">SZSE</span>
          </div>
          <div className="instrument-price">
            <strong>{lastBar.close.toFixed(2)}</strong>
            <span>+0.61</span>
            <span>+0.94%</span>
          </div>
        </div>

        <div className="ohlc-strip">
          <span><small>开</small><b>{displayBar.open.toFixed(2)}</b></span>
          <span><small>高</small><b>{displayBar.high.toFixed(2)}</b></span>
          <span><small>低</small><b>{displayBar.low.toFixed(2)}</b></span>
          <span><small>收</small><b>{displayBar.close.toFixed(2)}</b></span>
          <span><small>成交量</small><b>{compactVolume(displayBar.volume)}</b></span>
          <span className="quote-date"><small>数据日期</small><b>{displayDate}</b></span>
        </div>

        <div className="axis-toggle" aria-label="价格坐标">
          <button className={!logPrice ? 'is-active' : ''} onClick={() => setLogPrice(false)}>普通</button>
          <button className={logPrice ? 'is-active' : ''} onClick={() => setLogPrice(true)}>Log</button>
        </div>
      </section>

      <section className="chart-toolbar">
        <div className="timeframes">
          {timeframes.map((item) => (
            <button
              key={item}
              className={item === timeframe ? 'is-active' : ''}
              onClick={() => {
                setTimeframe(item)
                notify(`${item} 周期占位已选择；P0 仍展示日线样例`)
              }}
            >
              {item}
            </button>
          ))}
        </div>
        <span className="toolbar-divider" />
        <label className="inline-select">
          <span>前复权</span>
          <Icon name="chevron" />
          <select aria-label="复权方式" defaultValue="前复权" onChange={(event) => notify(`已选择${event.target.value}占位`)}>
            <option>前复权</option>
            <option>不复权</option>
            <option>后复权</option>
          </select>
        </label>
        <button className={`toolbar-toggle${profileVisible ? ' is-active' : ''}`} onClick={() => setProfileVisible((value) => !value)}>
          成交量分布
        </button>
        <button className={`toolbar-toggle${cleanMode ? ' is-active' : ''}`} onClick={() => setCleanMode((value) => !value)}>
          纯净模式
        </button>
        <button className="toolbar-action" onClick={() => notify('图表已恢复到建议范围')}>适应画面</button>
        <div className="toolbar-spacer" />
        <span className="data-status"><i />收盘数据</span>
        <button className="journal-toggle" onClick={() => setJournalOpen((value) => !value)}>
          <Icon name="journal" />
          研究记录
        </button>
      </section>

      <main className={`workspace${journalOpen ? ' has-journal' : ''}`}>
        <aside className="drawing-rail" aria-label="画图工具">
          {tools.map(([icon, label]) => (
            <button
              key={label}
              className={activeTool === label ? 'is-active' : ''}
              aria-label={label}
              data-tooltip={label}
              onClick={() => {
                setActiveTool(label)
                notify(`${label}工具已选择（P0 占位）`)
              }}
            >
              <Icon name={icon} />
            </button>
          ))}
          <span className="rail-divider" />
          <button aria-label="撤销" data-tooltip="撤销" onClick={() => notify('撤销')}><Icon name="undo" /></button>
          <button aria-label="重做" data-tooltip="重做" onClick={() => notify('重做')}><Icon name="redo" /></button>
        </aside>

        <section className="chart-region">
          <div className="chart-context">
            <div>
              <strong>中国铀业 · {selectedDay ? `${selectedDay.date} 分时` : timeframe}</strong>
              {!selectedDay && <span>前复权</span>}
              {!selectedDay && <span className={logPrice ? 'log-badge is-log' : 'log-badge'}>{logPrice ? 'LOG' : '线性'}</span>}
              {selectedDay && <span className="intraday-source">由日K进入</span>}
            </div>
            <div className="chart-context-actions">
              {selectedDay ? (
                <button className="back-to-daily" onClick={() => setSelectedDay(null)}>← 返回日K</button>
              ) : <span>工作区：{workspace}</span>}
              <button onClick={() => notify('布局菜单占位')}><Icon name="more" /></button>
            </div>
          </div>
          {selectedDay ? (
            <IntradayView bar={selectedDay} />
          ) : (
            <ChartWorkbench
              logPrice={logPrice}
              profileVisible={profileVisible && !cleanMode}
              cleanMode={cleanMode}
              onHoverBar={handleHoverBar}
              onSelectBar={setSelectedDay}
            />
          )}
        </section>

        {journalOpen && (
          <aside className="journal-panel">
            <div className="journal-header">
              <div>
                <span className="eyebrow">研究日志</span>
                <h2>{journalDateLabel}</h2>
              </div>
              <button className="icon-button" title="收起" onClick={() => setJournalOpen(false)}><Icon name="collapse" /></button>
            </div>

            <div className="journal-summary">
              <div><strong>{filteredRecords.length}</strong><span>当日记录</span></div>
              <div><strong>1</strong><span>关联标的</span></div>
              <button className={calendarOpen ? 'is-active' : ''} onClick={() => setCalendarOpen((value) => !value)}><Icon name="calendar" />按日期查找</button>
            </div>

            {calendarOpen && (
              <JournalCalendar
                selectedDate={selectedJournalDate}
                recordDates={records.map((record) => record.date)}
                onSelect={setSelectedJournalDate}
                onClose={() => setCalendarOpen(false)}
              />
            )}

            <div className="note-composer">
              <div className="composer-title">
                <strong>记录本次判断</strong>
                <span>Markdown</span>
              </div>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="例如：记录本次判断、关键条件、观察区间与判断失效条件……"
              />
              <div className="composer-footer">
                <span>自动附带画线与截图</span>
                <button onClick={addRecord}><Icon name="save" />保存记录</button>
              </div>
            </div>

            <div className="record-list-heading">
              <strong>当日时间线</strong>
              <button onClick={() => notify('历史版本筛选占位')}>全部版本</button>
            </div>

            <div className="record-list">
              {filteredRecords.map((record) => (
                <article className="record-item" key={record.id}>
                  <div className={`record-dot ${record.color}`} />
                  <div className="record-copy">
                    <div className="record-meta"><time>{record.time}</time><span>中国铀业</span><span>v1</span></div>
                    <h3>{record.title}</h3>
                    <p>{record.body}</p>
                    <div className="record-actions">
                      <button onClick={() => notify('历史快照只读预览占位')}>查看快照</button>
                      <button onClick={() => notify('记录已加载到当前工作区占位')}>加载</button>
                      <button
                        onClick={() => {
                          setRecords((current) => current.filter((item) => item.id !== record.id))
                          notify('记录已移入回收站占位')
                        }}
                      >删除</button>
                    </div>
                  </div>
                </article>
              ))}
              {filteredRecords.length === 0 && (
                <div className="record-empty">
                  <Icon name="calendar" />
                  <strong>这一天还没有记录</strong>
                  <span>可以在上方写下第一条 Markdown 笔记</span>
                </div>
              )}
            </div>

            <button className="journal-footer-button" onClick={() => notify('完整历史记录占位')}>
              查看全部历史记录
              <Icon name="chevron" />
            </button>
          </aside>
        )}
      </main>

      <footer className="status-bar">
        <span>工具：{activeTool}</span>
        <span>坐标：{logPrice ? 'Log 价格' : '普通价格'}</span>
        <span>时区：Asia/Shanghai</span>
        <span className="status-spacer" />
        <span>样例数据 · 非实时</span>
        <span>缩放：滚轮 / 触控板</span>
      </footer>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
