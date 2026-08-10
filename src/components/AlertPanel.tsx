import { useMemo, useState } from 'react'
import { alertTypeLabels, type AlertEvent, type AlertRule, type AlertType } from '../alerts/model'
import { Icon } from './Icon'

type Props = {
  symbol: string
  name: string
  price: number
  rules: AlertRule[]
  events: AlertEvent[]
  onRulesChange: (rules: AlertRule[]) => void
  onClearEvents: () => void
  onClose: () => void
  onMessage: (message: string) => void
}

function conditionLabel(rule: AlertRule) {
  const label = alertTypeLabels[rule.type]
  if (rule.type.startsWith('macd')) return label
  return `${label} ${rule.threshold?.toFixed(rule.type === 'volume_ratio' ? 1 : 2)}`
}

export function AlertPanel({ symbol, name, price, rules, events, onRulesChange, onClearEvents, onClose, onMessage }: Props) {
  const [type, setType] = useState<AlertType>('price_above')
  const [threshold, setThreshold] = useState(price.toFixed(2))
  const currentRules = useMemo(() => rules.filter((rule) => rule.symbol === symbol), [rules, symbol])
  const currentEvents = useMemo(() => events.filter((event) => event.symbol === symbol), [events, symbol])

  const addRule = () => {
    const numeric = Number(threshold)
    if (!type.startsWith('macd') && (!Number.isFinite(numeric) || numeric <= 0)) {
      onMessage('请输入大于0的提醒阈值')
      return
    }
    const next: AlertRule = {
      id: crypto.randomUUID(), symbol, name, type,
      threshold: type.startsWith('macd') ? null : numeric,
      enabled: true, createdAt: new Date().toISOString(), lastCondition: false, lastTriggeredAt: null,
    }
    onRulesChange([next, ...rules])
    onMessage(`已添加提醒：${conditionLabel(next)}`)
  }

  return <div className="alert-backdrop" role="dialog" aria-modal="true" aria-label="条件提醒">
    <section className="alert-dialog">
      <header><div><span className="eyebrow">本地条件提醒</span><h2>{name} · {price.toFixed(2)}</h2><p>行情刷新后计算，条件由假变真时触发一次</p></div><button aria-label="关闭提醒" onClick={onClose}>×</button></header>
      <div className="alert-create">
        <label>条件<select aria-label="提醒条件" value={type} onChange={(event) => setType(event.target.value as AlertType)}>{Object.entries(alertTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {!type.startsWith('macd') && <label>{type === 'volume_ratio' ? '倍数' : '价格'}<input aria-label="提醒阈值" type="number" min="0.01" step={type === 'volume_ratio' ? '0.1' : '0.01'} value={threshold} onChange={(event) => setThreshold(event.target.value)} /></label>}
        <button type="button" onClick={addRule}>＋ 添加提醒</button>
      </div>
      <div className="alert-columns">
        <section><div className="alert-section-heading"><strong>规则</strong><span>{currentRules.filter((item) => item.enabled).length} 个启用</span></div><div className="alert-list">
          {currentRules.map((rule) => <article key={rule.id} className={rule.enabled ? '' : 'is-disabled'}><div><strong>{conditionLabel(rule)}</strong><span>{rule.lastTriggeredAt ? `上次触发 ${new Date(rule.lastTriggeredAt).toLocaleString('zh-CN')}` : '尚未触发'}</span></div><button aria-label={`${rule.enabled ? '停用' : '启用'} ${conditionLabel(rule)}`} onClick={() => onRulesChange(rules.map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled, lastCondition: false } : item))}>{rule.enabled ? '已启用' : '已停用'}</button><button aria-label={`删除 ${conditionLabel(rule)}`} onClick={() => onRulesChange(rules.filter((item) => item.id !== rule.id))}>删除</button></article>)}
          {!currentRules.length && <div className="alert-empty"><Icon name="bell" /><span>还没有提醒规则</span></div>}
        </div></section>
        <section><div className="alert-section-heading"><strong>触发记录</strong><button onClick={onClearEvents}>清空</button></div><div className="alert-list alert-events">
          {currentEvents.map((event) => <article key={event.id}><div><strong>{event.message}</strong><span>{new Date(event.triggeredAt).toLocaleString('zh-CN')}</span></div></article>)}
          {!currentEvents.length && <div className="alert-empty"><Icon name="bell" /><span>暂无触发记录</span></div>}
        </div></section>
      </div>
      <footer>规则和记录仅保存在本机浏览器；打开看板并刷新行情时进行计算。</footer>
    </section>
  </div>
}

