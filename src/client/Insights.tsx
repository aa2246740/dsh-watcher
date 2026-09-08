import { useEffect, useRef, useState } from 'react'
import { alertsOf, DEFAULT_LIMITS, limitsOf, mergeModels, scanSessions } from '../insights/presentation.mjs'
import type { InsightsView } from '../insights/projection.ts'
import css from './Insights.module.css'
type Limits = { silenceSeconds: number; reasoningSeconds: number }
const STORAGE = 'dsh-watcher:insights-display:v1'
function readLimits(): Limits { try { return limitsOf(JSON.parse(localStorage.getItem(STORAGE) ?? '{}')) } catch { return { ...DEFAULT_LIMITS } } }
function useLimits() {
  const [limits, setLimits] = useState(readLimits)
  useEffect(() => { const update = () => setLimits(readLimits()); window.addEventListener('watcher-insights-settings', update); return () => window.removeEventListener('watcher-insights-settings', update) }, [])
  return limits
}
const fmt = (n: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(n)
const duration = (n: number) => n < 1000 ? `${Math.round(n)} ms` : n < 60000 ? `${(n / 1000).toFixed(1)} s` : `${(n / 60000).toFixed(1)} 分`
const tokens = (s: Record<string, number>) => s.reported ? `${s.exactTotals < s.reported ? '≥ ' : ''}${fmt(s.tokens ?? 0)}` : '未报告'
const average = (sum: number, samples: number) => samples ? duration(sum / samples) : '未知'
type Evidence = { turn: number; steps: number[]; seqs: number[] }
export function SessionInsights({ value, now, running, waiting, onEvidence }: {
  value: InsightsView | undefined; now: number; running: boolean; waiting: boolean; onEvidence: (e: Evidence) => void
}) {
  const limits = useLimits()
  const [scope, setScope] = useState<'turn' | 'session'>('turn')
  if (!value) return <p className={css.notice}>统计未接通。此分支需要重启 DSH Host；原有路径仍可查看。</p>
  const stats = scope === 'turn' && value.turn ? value.turn.stats : value.totals
  const alerts = alertsOf(value, now, { running, waiting, limits })
  return <section className={css.summary} aria-label="Watcher 会话分析">
    <div className={css.toolbar}><strong>消耗与异常</strong><div className={css.switcher}>
      <button type="button" aria-pressed={scope === 'turn'} onClick={() => setScope('turn')}>本轮</button>
      <button type="button" aria-pressed={scope === 'session'} onClick={() => setScope('session')}>会话</button>
    </div></div>
    <div className={css.metrics}>
      <div><span>已报告 Token</span><strong>{tokens(stats)}</strong><small>{stats.reported}/{stats.calls} 次调用有用量{value.pending ? ' · 另有请求未结算' : ''}</small></div>
      <div><span>模型累计时间</span><strong>{duration(stats.modelMs ?? 0)}</strong><small>{stats.timedCalls}/{stats.calls} 次有边界记录</small></div>
      <div><span>工具失败 / 执行</span><strong>{stats.toolErrors} / {stats.tools}</strong><small>接口重试 {stats.retries} 次</small></div>
    </div>
    <div className={css.facts}><span>工具累计 {duration(stats.toolMs ?? 0)}</span><span>可见推理采样 {duration(stats.reasoningMs ?? 0)}</span></div>
    <p className={css.caption}>时间按事件边界统计；并行工具累计值不能直接加到总耗时。Token 包含已报告缓存，推理不重复加算。</p>
    <div className={css.alerts} aria-live="polite">
      {alerts.length ? alerts.map((a: Evidence & { id: string; title: string; detail: string }) => <div className={css.alert} key={a.id}>
        <strong>{a.title}</strong><p>{a.detail}</p>
        <button type="button" onClick={() => onEvidence(a)}>定位轮次 {a.turn}{a.steps.length ? ` · 步骤 ${[...new Set(a.steps)].join('、')}` : ''}</button>
        {a.seqs.length ? <small>证据 seq：{a.seqs.join('、')}</small> : null}
      </div>) : <p className={css.quiet}>{waiting ? '等待用户期间不触发静默提醒。' : '当前没有命中诊断规则；不代表任务已通过验收。'}</p>}
    </div>
  </section>
}
type Row = { sessionId: string; value: InsightsView | null; error: string | null }
type Scan = { rows: Row[]; total: number; selected: number }
export function InsightsSettings({ remote }: { remote: unknown }) {
  const [scan, setScan] = useState<Scan>({ rows: [], total: 0, selected: 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [limits, setLimits] = useState(readLimits)
  const [saved, setSaved] = useState('')
  const [query, setQuery] = useState('')
  const controller = useRef<AbortController | null>(null)
  async function refresh(limit: number) {
    controller.current?.abort()
    const next = new AbortController(); controller.current = next
    setBusy(true); setError(''); setScan({ rows: [], total: 0, selected: 0 })
    try {
      const result = await scanSessions(remote, { signal: next.signal, limit,
        onProgress: (progress: Scan) => { if (!next.signal.aborted) setScan(progress) } })
      if (!next.signal.aborted) setScan(result)
    } catch (e) { if (!next.signal.aborted) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (controller.current === next) setBusy(false) }
  }
  useEffect(() => { void refresh(30); return () => controller.current?.abort() }, [remote])
  const views = scan.rows.flatMap(row => row.value ? [row.value] : [])
  const models = mergeModels(views).filter(m => `${m.provider} ${m.model}`.toLowerCase().includes(query.toLowerCase()))
  const failures = scan.rows.filter(row => row.error)
  const findings = views.flatMap(v => v.findings.map(f => ({ ...f, sessionId: v.sessionId })))
  return <section className={css.settings} aria-label="Watcher 统计与诊断">
    <header><h2>Watcher · 统计与诊断</h2><p>先看哪个模型消耗多、等待久、重复失败，再回原会话核对证据。不重复播放工作日志。</p></header>
    <div className={css.toolbar}>
      <button type="button" onClick={() => void refresh(100)} disabled={busy}>刷新最近 100 个会话</button>
      {busy ? <button type="button" onClick={() => { controller.current?.abort(); setBusy(false) }}>停止读取</button> : null}
      <span>{busy ? '读取中 · ' : ''}{views.length}/{scan.total} 个会话已取得统计；本次读取上限 {scan.selected}</span>
    </div>
    <p className={css.notice}>范围：当前 Host 可列出的普通会话，统计完整自有日志，排除 fork 继承前缀。未读取、失败和直接子代理不计为零。压缩、标题等独立辅助调用暂不计入。</p>
    {error ? <p role="alert" className={css.alert}>{error}</p> : null}
    <label className={css.search}>筛选模型<input value={query} onChange={e => setQuery(e.target.value)} placeholder="模型或提供方" /></label>
    <div className={css.tableWrap}><table><thead><tr><th>模型 / 提供方</th><th>调用 / 有用量</th><th>已报告 Token</th><th>平均首响应</th><th>工具失败</th><th>接口重试</th></tr></thead>
      <tbody>{models.map(m => <tr key={`${m.provider}:${m.model}`}><td><strong>{m.model}</strong><small>{m.provider} · {m.sessions} 个会话</small></td>
        <td>{m.calls} / {m.reported}</td><td>{tokens(m)}</td><td>{average(m.firstMs ?? 0, m.firstSamples ?? 0)}</td><td>{m.toolErrors} / {m.tools}</td><td>{m.retries}</td></tr>)}</tbody></table>
      {!models.length ? <p className={css.quiet}>{busy ? '正在读取统计快照…' : '还没有可展示的模型统计。未报告不等于零消耗。'}</p> : null}</div>
    <p className={css.caption}>这是运行样本，不是能力排行榜。首响应采用步骤边界；缺少重试请求起点的样本不混入平均值。没有验收证据，不展示“成功率”。</p>
    <h3>异常会话</h3>
    {findings.length ? findings.slice(-30).map(f => <details className={css.alert} key={`${f.sessionId}:${f.id}`}><summary>{f.title} · 轮次 {f.turn}</summary><p>{f.detail}</p><code>Session {f.sessionId}<br />步骤 {f.steps.join('、')} · seq {f.seqs.join('、')}</code></details>) : <p className={css.quiet}>已取得统计的会话暂未命中重复失败规则。</p>}
    {failures.length ? <details><summary>{failures.length} 个会话未计入统计</summary>{failures.map(f => <p key={f.sessionId}><code>{f.sessionId}</code>：{f.error}</p>)}</details> : null}
    <h3>提醒阈值</h3><p className={css.caption}>仅保存在此浏览器，影响面板提醒，不改变 Agent 行为。</p>
    <div className={css.controls}>
      <label>模型内容静默（秒）<input type="number" min="5" max="3600" value={limits.silenceSeconds} onChange={e => setLimits({ ...limits, silenceSeconds: Number(e.target.value) })} /></label>
      <label>可见推理跨度（秒）<input type="number" min="5" max="3600" value={limits.reasoningSeconds} onChange={e => setLimits({ ...limits, reasoningSeconds: Number(e.target.value) })} /></label>
      <button type="button" onClick={() => { const safe = limitsOf(limits); setLimits(safe); try { localStorage.setItem(STORAGE, JSON.stringify(safe)); window.dispatchEvent(new Event('watcher-insights-settings')); setSaved('已保存') } catch { setSaved('浏览器拒绝保存；当前显示仍可使用') } }}>保存</button><span role="status">{saved}</span>
    </div>
    <p className={css.notice}>只读、本地、无额外模型调用。Watcher 不保存第二份推理或工具正文；统计由 DSH 日志重建。聚合页不会为了扫描而启动任务。</p>
  </section>
}
