import { useEffect, useState, useMemo } from 'react'
// Untyped local ESM helpers: single .mjs source kept for node tests.
// @ts-ignore TS7016: no declarations for the local .mjs module
import { alertsOf, DEFAULT_LIMITS, limitsOf, scanSessions, mergeModels } from '../insights/presentation.mjs'
import type { InsightsView } from '../insights/projection.ts'
import css from './Insights.module.css'
import { TimingPanel } from './TimingPanel.tsx'

type Limits = { silenceSeconds: number; reasoningSeconds: number }
const STORAGE = 'dsh-watcher:insights-display:v1'

function readLimits(): Limits {
  try {
    return limitsOf(JSON.parse(localStorage.getItem(STORAGE) ?? '{}'))
  } catch {
    return { ...DEFAULT_LIMITS }
  }
}

function useLimits() {
  const [limits, setLimits] = useState(readLimits)
  useEffect(() => {
    const update = () => setLimits(readLimits())
    window.addEventListener('watcher-insights-settings', update)
    return () => window.removeEventListener('watcher-insights-settings', update)
  }, [])
  return limits
}

const fmt = (n: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(n)

const fmtCompact = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)} 亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`
  return fmt(n)
}

const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const dayLabel = (key: string) => {
  const [, m, d] = key.split('-')
  return `${Number(m)}/${Number(d)}`
}

const PALETTE = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#6366f1']

function effortLabel(effort: string | null | undefined): string {
  if (!effort) return ''
  const map: Record<string, string> = { high: '高', medium: '中', low: '低' }
  return map[effort.toLowerCase()] ?? effort
}

type Evidence = { turn: number; steps: number[]; seqs: number[] }

export function SessionInsights({ value, now, running, waiting, onEvidence }: {
  value: InsightsView | undefined; now: number; running: boolean; waiting: boolean; onEvidence: (e: Evidence) => void
}) {
  const limits = useLimits()
  const [scope, setScope] = useState<'turn' | 'session'>('turn')
  const [modelFilter, setModelFilter] = useState<'all' | number>('all')
  if (!value) return null

  const isMultiModel = (value.models?.length ?? 0) > 1
  const selectedModel = scope === 'session' && modelFilter !== 'all' && value.models[modelFilter]
    ? value.models[modelFilter]
    : undefined
  const stats = scope === 'turn' && value.turn
    ? value.turn.stats
    : (selectedModel ?? value.totals)
  const alerts = alertsOf(value, now, { running, waiting, limits })
  const currentRoute = value.turn?.route ?? (value.models && value.models.length > 0 ? value.models[0] : undefined)
  const totalIn = (stats.input ?? 0) + (stats.cacheRead ?? 0)
  const cachePct = totalIn > 0 ? Math.round(((stats.cacheRead ?? 0) / totalIn) * 100) : 0

  return (
    <section className={css.hudBox} aria-label="耗时分布与运行健康度">
      <div className={css.hudTop}>
        <div className={css.hudTopLeft}>
          <span className={css.hudHeading}>
            {scope === 'turn'
              ? '本轮'
              : selectedModel
                ? `模型: ${selectedModel.model}`
                : '全会话'}
          </span>
          {scope === 'turn' && currentRoute?.model ? (
            <span className={css.currentModelTag} title={currentRoute.model}>
              <strong className={css.modelTagText}>{currentRoute.model}</strong>
              {currentRoute.effort ? (
                <span className={css.effortTag}>思考: {effortLabel(currentRoute.effort)}</span>
              ) : null}
            </span>
          ) : null}
          <span className={css.contextTag}>
            上下文 <strong>{fmt(stats.input ?? 0)}</strong> Token
          </span>
        </div>
        <div className={css.hudTopRight}>
          <span className={css.tokenStat}>
            <strong>{fmt(stats.tokens ?? 0)}</strong> Token ({cachePct}% 命中)
          </span>
          <div className={css.scopeGroup} role="group" aria-label="统计范围切换">
            <button type="button" className={css.scopeBtn} data-active={scope === 'turn' ? '' : undefined}
              onClick={() => { setScope('turn'); setModelFilter('all') }}>本轮</button>
            <button type="button" className={css.scopeBtn} data-active={scope === 'session' ? '' : undefined}
              onClick={() => setScope('session')}>全会话</button>
          </div>
        </div>
      </div>
      {scope === 'session' && isMultiModel ? (
        <div className={css.modelTabBar} role="tablist" aria-label="多模型切换">
          <button type="button" className={css.modelTabBtn} data-active={modelFilter === 'all' ? '' : undefined}
            onClick={() => setModelFilter('all')}>全部模型汇总 ({value.models.length})</button>
          {value.models.map((m: any, idx: number) => (
            <button type="button" key={idx} className={css.modelTabBtn} data-active={modelFilter === idx ? '' : undefined}
              onClick={() => setModelFilter(idx)}>{m.model} ({m.calls}次)</button>
          ))}
        </div>
      ) : null}
      <div className={css.hudBody}>
        <TimingPanel stats={stats} scope={scope} />
        {alerts.length > 0 ? (
          <div className={css.alertSection} aria-live="polite">
            {alerts.map((a: Evidence & { id: string; title: string; detail: string; kind?: string }) => {
              const isRepeat = a.kind === 'repeated-failure' || a.id.startsWith('repeat')
              const isSilence = a.id === 'silence'
              const isReason = a.id === 'reasoning-span'
              const tag = isRepeat ? '连续报错' : isSilence ? '网络停顿' : isReason ? '思考超时' : '异常'
              return (
                <div key={a.id} className={`${css.alertCard} ${isRepeat ? css.alertCardDanger : css.alertCardWarn}`}>
                  <div className={css.alertLeft}>
                    <span className={`${css.alertTag} ${isRepeat ? css.tagDanger : css.tagWarn}`}>{tag}</span>
                    <div className={css.alertTexts}>
                      <strong className={css.alertMainText}>{a.title}</strong>
                      <span className={css.alertSubText}>{a.detail}</span>
                    </div>
                  </div>
                  <button type="button" className={css.alertActionBtn} onClick={() => onEvidence(a)}>定位现场</button>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    </section>
  )
}

export function InsightsSettings(props: { remote?: any }) {
  const limits = useLimits()
  const [silence, setSilence] = useState(limits.silenceSeconds)
  const [reasoning, setReasoning] = useState(limits.reasoningSeconds)
  const [saved, setSaved] = useState(false)
  const [userPickedRange, setUserPickedRange] = useState<boolean>(false)
  const [range, setRange] = useState<'7' | '30'>('7')
  const [sessionSort, setSessionSort] = useState<'tokens' | 'time' | 'errors'>('tokens')
  const [loading, setLoading] = useState(false)
  const [sessions, setSessions] = useState<{ total: number; rows: any[] } | null>(null)
  const [openSessionId, setOpenSessionId] = useState<string | null>(null)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const [activeDrilldown, setActiveDrilldown] = useState<'speed' | 'latency' | 'thinking' | 'cache' | 'tool' | 'reliability' | null>(null)

  useEffect(() => {
    if (!props.remote) return
    let active = true
    setLoading(true)
    scanSessions(props.remote, { limit: 100 })
      .then(res => {
        if (active) {
          setSessions(res)
          // 智能感知：如果历史跨度确实超过 7 天，自动提档到 30 天；否则保持清爽的 7 天
          if (!userPickedRange) {
            const times = (res?.rows ?? [])
              .map((r: any) => r.updatedAt)
              .filter((t: any) => typeof t === 'number' && t > 0)
            if (times.length >= 2) {
              const span = Math.max(...times) - Math.min(...times)
              if (span > 7 * 86400000) {
                setRange('30')
              }
            }
          }
        }
      })
      .catch(console.error)
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [props.remote, userPickedRange])

  const refresh = () => {
    if (!props.remote || loading) return
    setLoading(true)
    scanSessions(props.remote, { limit: 100 })
      .then(setSessions)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  const save = () => {
    localStorage.setItem(STORAGE, JSON.stringify({ silenceSeconds: silence, reasoningSeconds: reasoning }))
    window.dispatchEvent(new CustomEvent('watcher-insights-settings'))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const analytics = useMemo(() => {
    if (!sessions) return null
    const days = Number(range)
    const cutoff = Date.now() - days * 86400000
    const validRows = sessions.rows.filter((r: any) => r.value && (!r.updatedAt || r.updatedAt >= cutoff))
    const validViews = validRows.map((r: any) => r.value)
    let totalTokens = 0
    let totalModelMs = 0
    let totalToolMs = 0
    let totalBashMs = 0
    let totalTools = 0
    let totalCacheRead = 0
    let totalInput = 0
    let totalErrors = 0
    let totalRetries = 0

    validViews.forEach((v: any) => {
      totalTokens += v.totals.tokens ?? 0
      totalModelMs += v.totals.modelMs ?? 0
      totalToolMs += v.totals.toolMs ?? 0
      totalBashMs += v.totals.bashMs ?? 0
      totalTools += v.totals.tools ?? 0
      totalCacheRead += v.totals.cacheRead ?? 0
      totalInput += v.totals.input ?? 0
      totalErrors += v.totals.toolErrors ?? 0
      totalRetries += v.totals.retries ?? 0
    })

    const totalWallMs = totalModelMs + totalToolMs
    const toolTimePct = totalWallMs > 0 ? Math.round((totalToolMs / totalWallMs) * 100) : 0
    const totalFileMs = Math.max(0, totalToolMs - totalBashMs)
    const bashPct = totalToolMs > 0 ? Math.round((totalBashMs / totalToolMs) * 100) : 0
    const filePct = Math.max(0, 100 - bashPct)
    const totalInAll = totalInput + totalCacheRead
    const cacheHitPct = totalInAll > 0 ? Math.round((totalCacheRead / totalInAll) * 100) : 0

    // 重点：按纯模型名称汇总去重，确保模型级排行榜中每个模型仅出现一次，杜绝同名混杂和 React 重复 key 乱序！
    const modelMap = new Map<string, any>()
    for (const view of validViews) {
      for (const m of view.models ?? []) {
        const name = m.model || '未标注'
        let row = modelMap.get(name)
        if (!row) {
          row = { model: name, calls: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, modelMs: 0, firstMs: 0, firstSamples: 0 }
          modelMap.set(name, row)
        }
        for (const k of ['calls', 'tokens', 'input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'modelMs', 'firstMs', 'firstSamples']) {
          if (typeof m[k] === 'number' && Number.isFinite(m[k])) {
            row[k] += m[k]
          }
        }
      }
    }
    const uniqueModels = [...modelMap.values()]

    // 1. 首响应延迟由短到长（升序：最快在上，TTFT 速度排行榜）
    const speedList = uniqueModels
      .filter((m: any) => (m.firstSamples ?? 0) > 0 && (m.firstMs ?? 0) > 0)
      .sort((a: any, b: any) => (a.firstMs / a.firstSamples) - (b.firstMs / b.firstSamples))

    // 2. 首响应排队由长到短（降序：最慢在上，延迟瓶颈排行榜）
    const latencyList = uniqueModels
      .filter((m: any) => (m.firstSamples ?? 0) > 0 && (m.firstMs ?? 0) > 0)
      .sort((a: any, b: any) => (b.firstMs / b.firstSamples) - (a.firstMs / a.firstSamples))

    // 3. 深度推导按思考 Token 占比降序（从高到低）
    const thinkList = uniqueModels
      .filter((m: any) => (m.reasoning ?? 0) > 0)
      .sort((a: any, b: any) => {
        const ratioA = a.reasoning / (((a.reasoning ?? 0) + (a.output ?? 0)) || 1)
        const ratioB = b.reasoning / (((b.reasoning ?? 0) + (b.output ?? 0)) || 1)
        return ratioB - ratioA || b.reasoning - a.reasoning
      })

    // 4. 前缀缓存按命中率降序（从高到低）
    const cacheList = uniqueModels
      .filter((m: any) => (m.tokens ?? 0) > 0)
      .sort((a: any, b: any) => {
        const rateA = (a.cacheRead ?? 0) / (((a.input ?? 0) + (a.cacheRead ?? 0)) || 1)
        const rateB = (b.cacheRead ?? 0) / (((b.input ?? 0) + (b.cacheRead ?? 0)) || 1)
        return rateB - rateA || (b.cacheRead ?? 0) - (a.cacheRead ?? 0)
      })

    // 头部 6 大 KPI 卡片数据：精准绑定对应排行榜的第一名！
    const fastKing = speedList[0]
    const slowKing = latencyList[0]
    const thinkKing = thinkList[0]
    const bestCacheModel = cacheList[0]

    // 工具高耗时排查会话 TOP 3 (严格按工具总耗时降序)
    const topToolSessions = [...validRows]
      .filter((r: any) => (r.value?.totals?.toolMs ?? 0) > 0)
      .sort((a: any, b: any) => (b.value.totals.toolMs ?? 0) - (a.value.totals.toolMs ?? 0))
      .slice(0, 3)

    // 报错与重试排查会话 (严格按报错量降序)
    const errorSessions = [...validRows]
      .filter((r: any) => (r.value?.totals?.toolErrors ?? 0) > 0 || (r.value?.totals?.retries ?? 0) > 0)
      .sort((a: any, b: any) => {
        const scoreA = (a.value.totals.toolErrors ?? 0) * 100 + (a.value.totals.retries ?? 0)
        const scoreB = (b.value.totals.toolErrors ?? 0) * 100 + (b.value.totals.retries ?? 0)
        return scoreB - scoreA
      })
      .slice(0, 6)

    // 重点对话账单：严格按用户指定的维度降序排序！
    const sortedSessions = [...validRows].sort((a: any, b: any) => {
      const va = a.value.totals
      const vb = b.value.totals
      if (sessionSort === 'tokens') {
        return (vb.tokens ?? 0) - (va.tokens ?? 0)
      }
      if (sessionSort === 'time') {
        const timeA = (va.modelMs ?? 0) + (va.toolMs ?? 0)
        const timeB = (vb.modelMs ?? 0) + (vb.toolMs ?? 0)
        return timeB - timeA
      }
      if (sessionSort === 'errors') {
        const scoreA = (va.toolErrors ?? 0) * 100 + (va.retries ?? 0)
        const scoreB = (vb.toolErrors ?? 0) * 100 + (vb.retries ?? 0)
        return scoreB - scoreA || (vb.tokens ?? 0) - (va.tokens ?? 0)
      }
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    })
    const maxSessionTokens = Math.max(1, ...sortedSessions.map((s: any) => s.value?.totals?.tokens ?? 0))

    // 环形图数据：纯模型排序，前 4 名 + 其余汇总为 "其他"，并保证严格按 Token 降序排列！
    const tokenRankedModels = [...uniqueModels].sort((a, b) => b.tokens - a.tokens)
    const topModels = tokenRankedModels.slice(0, 4)
    const restModels = tokenRankedModels.slice(4)
    const restTokens = restModels.reduce((sum: number, m: any) => sum + (m.tokens ?? 0), 0)
    const donutModels = [...topModels]
    if (restTokens > 0) {
      donutModels.push({ model: '其他模型', tokens: restTokens })
    }
    donutModels.sort((a: any, b: any) => (b.tokens ?? 0) - (a.tokens ?? 0))

    const donutTotal = donutModels.reduce((sum: number, m: any) => sum + (m.tokens ?? 0), 0)

    const colorOf = (name: string) => {
      const found = donutModels.findIndex((m: any) => m.model === name)
      return PALETTE[(found >= 0 ? found : 0) % PALETTE.length]
    }

    // 环形切片计算：无缝精准闭环，最后一段精确吸附
    const circumference = 2 * Math.PI * 38 // 238.761...
    let accumulated = 0
    const donutSegments = donutTotal <= 0 ? [] : donutModels.map((m: any, idx: number) => {
      const pctRatio = m.tokens / donutTotal
      const strokeLength = idx === donutModels.length - 1
        ? Math.max(0, circumference - accumulated)
        : pctRatio * circumference
      const gapLength = Math.max(0, circumference - strokeLength)
      const offset = -accumulated
      accumulated += strokeLength
      return {
        model: m.model,
        tokens: m.tokens,
        pct: Math.round(pctRatio * 100),
        color: PALETTE[idx % PALETTE.length],
        dasharray: `${strokeLength} ${gapLength}`,
        dashoffset: offset,
      }
    })

    // 每日活动序列
    const keys: string[] = []
    for (let i = days - 1; i >= 0; i--) keys.push(dayKey(Date.now() - i * 86400000))
    const byDay = new Map(keys.map(k => [k, new Map<string, number>()]))
    validRows.forEach((row: any) => {
      const key = row.updatedAt ? dayKey(row.updatedAt) : keys[keys.length - 1]
      const bucket = byDay.get(key)
      if (!bucket) return
      const models = row.value.models?.length
        ? row.value.models
        : [{ model: '未标注', tokens: row.value.totals.tokens ?? 0 }]
      models.forEach((m: any) => {
        bucket.set(m.model, (bucket.get(m.model) ?? 0) + (m.tokens ?? 0))
      })
    })

    const todayStr = dayKey(Date.now())
    const yesterdayStr = dayKey(Date.now() - 86400000)

    const daySeries = keys.map(key => {
      const bucket = byDay.get(key) ?? new Map()
      const segments = [...bucket.entries()]
        .map(([model, tokens]) => ({ model, tokens, color: colorOf(model) }))
        .sort((a, b) => b.tokens - a.tokens)
      const label = range === '7'
        ? (key === todayStr ? '今天' : key === yesterdayStr ? '昨天' : dayLabel(key))
        : (key.endsWith('01') || key.endsWith('05') || key.endsWith('10') || key.endsWith('15') || key.endsWith('20') || key.endsWith('25') ? dayLabel(key) : '')
      return { key, label, total: segments.reduce((s, x) => s + x.tokens, 0), segments }
    })
    const dayMax = Math.max(1, ...daySeries.map(d => d.total))

    return {
      validCount: validRows.length,
      listed: sessions.total,
      totalTokens,
      totalTimeHours: ((totalModelMs + totalToolMs) / 3600000).toFixed(1),
      cacheHitPct,
      totalCacheRead,
      totalToolMs,
      totalBashMs,
      totalFileMs,
      bashPct,
      filePct,
      topToolSessions,
      errorSessions,
      sortedSessions,
      maxSessionTokens,
      totalTools,
      toolTimePct,
      totalErrors,
      totalRetries,
      speedList,
      latencyList,
      thinkList,
      cacheList,
      donutModels,
      donutTotal,
      donutSegments,
      thinkKing,
      fastKing,
      slowKing,
      bestCacheModel,
      daySeries,
      dayMax,
    }
  }, [sessions, range, sessionSort])

  const cacheNote = !analytics
    ? ''
    : analytics.cacheHitPct >= 70 ? '命中较高'
      : analytics.cacheHitPct >= 40 ? '一般'
        : '命中偏低'

  // 环形中心展示信息（不重复上面大数，展示主力占比或悬停选中的模型）
  const activeSeg = hoveredIdx !== null && analytics?.donutSegments[hoveredIdx]
    ? analytics.donutSegments[hoveredIdx]
    : null
  const topModel = analytics?.donutSegments[0]

  return (
    <div className={css.settingsContainer}>
      <div className={css.cockpitHeader}>
        <div className={css.cockpitTitleArea}>
          <h2 className={css.cockpitMainTitle}>对话开销与模型风云榜</h2>
          <p className={css.cockpitSubTitle}>只读汇总本地已缓存的对话。按活动日期归组，无额外后台开销。</p>
        </div>
        <div className={css.headerRightControls}>
          <div className={css.rangeSwitchGroup}>
            <button
              type="button"
              className={css.rangeBtn}
              data-active={range === '7' ? '' : undefined}
              onClick={() => { setUserPickedRange(true); setRange('7'); }}
            >
              近 7 天
            </button>
            <button
              type="button"
              className={css.rangeBtn}
              data-active={range === '30' ? '' : undefined}
              onClick={() => { setUserPickedRange(true); setRange('30'); }}
            >
              近 30 天
            </button>
          </div>
          <button type="button" className={css.settingsScanBtn} onClick={refresh} disabled={loading || !props.remote}>
            {loading ? '正在刷新' : '刷新'}
          </button>
        </div>
      </div>

      <div className={css.heroStatsRow}>
        <div className={css.heroBigNum}>
          {analytics ? fmtCompact(analytics.totalTokens) : '-'} <span className={css.heroUnit}>Token</span>
        </div>
        <div className={css.heroMetaCol}>
          <span>累计耗时 <strong>{analytics ? `${analytics.totalTimeHours} 小时` : '-'}</strong></span>
          <span>缓存命中 <strong>{analytics ? `${analytics.cacheHitPct}% (${cacheNote})` : '-'}</strong></span>
          <span>有统计的对话 <strong>{analytics ? `${analytics.validCount} / ${analytics.listed}` : '-'}</strong></span>
        </div>
      </div>

      {/* 六大极客风云与问题洞察榜单：两列规整自适应排版，右下角动作条绝对平齐 */}
      <div className={css.roastGrid}>
        {/* 卡片 1: 极致打字机 */}
        <div
          className={`${css.roastItem} ${activeDrilldown === 'speed' ? css.roastItemActive : ''}`}
          onClick={() => setActiveDrilldown(activeDrilldown === 'speed' ? null : 'speed')}
        >
          <div className={css.roastHead}>
            <span className={css.roastTag} style={{ color: '#10b981' }}>极致打字机</span>
            <span className={css.roastCategoryBadge}>速度王者</span>
          </div>
          <div className={css.roastTitle} title={analytics?.fastKing?.model}>{analytics?.fastKing?.model ?? '暂无数据'}</div>
          <div className={css.roastDesc} title="首字响应最迅速，轻量改错利器">首字响应最迅速，轻量改错利器</div>
          <div className={css.roastVal} style={{ color: '#10b981' }}>
            {analytics?.fastKing?.firstSamples ? `首字均值 ${(analytics.fastKing.firstMs / analytics.fastKing.firstSamples / 1000).toFixed(2)} 秒` : '暂无数据'}
          </div>
          <div className={css.roastFooter}>
            <span className={css.roastFooterLeft}>首响应耗时</span>
            <span className={css.roastAction}>{activeDrilldown === 'speed' ? '收起透视 ▴' : '透视详情 ›'}</span>
          </div>
        </div>

        {/* 卡片 2: 最慢树懒 */}
        <div
          className={`${css.roastItem} ${activeDrilldown === 'latency' ? css.roastItemActive : ''}`}
          onClick={() => setActiveDrilldown(activeDrilldown === 'latency' ? null : 'latency')}
        >
          <div className={css.roastHead}>
            <span className={css.roastTag} style={{ color: '#d97706' }}>最慢树懒</span>
            <span className={css.roastCategoryBadge}>延迟瓶颈</span>
          </div>
          <div className={css.roastTitle} title={analytics?.slowKing?.model}>{analytics?.slowKing?.model ?? '暂无数据'}</div>
          <div className={css.roastDesc} title="首字排队最久，点根烟等它开工">首字排队最久，点根烟等它开工</div>
          <div className={css.roastVal} style={{ color: '#d97706' }}>
            {analytics?.slowKing?.firstSamples ? `首字均值 ${(analytics.slowKing.firstMs / analytics.slowKing.firstSamples / 1000).toFixed(2)} 秒` : '暂无数据'}
          </div>
          <div className={css.roastFooter}>
            <span className={css.roastFooterLeft}>排队瓶颈</span>
            <span className={css.roastAction}>{activeDrilldown === 'latency' ? '收起透视 ▴' : '透视详情 ›'}</span>
          </div>
        </div>

        {/* 卡片 3: 深度沉思狂 */}
        <div
          className={`${css.roastItem} ${activeDrilldown === 'thinking' ? css.roastItemActive : ''}`}
          onClick={() => setActiveDrilldown(activeDrilldown === 'thinking' ? null : 'thinking')}
        >
          <div className={css.roastHead}>
            <span className={css.roastTag} style={{ color: '#8b5cf6' }}>深度沉思狂</span>
            <span className={css.roastCategoryBadge}>推理硬核</span>
          </div>
          <div className={css.roastTitle} title={analytics?.thinkKing?.model}>{analytics?.thinkKing?.model ?? '暂无思考记录'}</div>
          <div className={css.roastDesc} title="思考 Token 占自身输出比例最高">思考 Token 占自身输出比例最高</div>
          <div className={css.roastVal} style={{ color: '#8b5cf6' }}>
            {analytics?.thinkKing ? `思考占比 ${Math.round(((analytics.thinkKing.reasoning ?? 0) / (((analytics.thinkKing.reasoning ?? 0) + (analytics.thinkKing.output ?? 0)) || 1)) * 100)}%` : '无推理记录'}
          </div>
          <div className={css.roastFooter}>
            <span className={css.roastFooterLeft}>推导占比</span>
            <span className={css.roastAction}>{activeDrilldown === 'thinking' ? '收起透视 ▴' : '透视详情 ›'}</span>
          </div>
        </div>

        {/* 卡片 4: 省流小能手 / 缓存待提升 */}
        <div
          className={`${css.roastItem} ${activeDrilldown === 'cache' ? css.roastItemActive : ''}`}
          onClick={() => setActiveDrilldown(activeDrilldown === 'cache' ? null : 'cache')}
        >
          <div className={css.roastHead}>
            <span className={css.roastTag} style={{ color: (analytics?.cacheHitPct ?? 0) >= 40 ? '#10b981' : '#f59e0b' }}>
              {(analytics?.cacheHitPct ?? 0) >= 40 ? '省流小能手' : '缓存待提升'}
            </span>
            <span className={css.roastCategoryBadge}>成本控制</span>
          </div>
          <div className={css.roastTitle} title={analytics?.bestCacheModel?.model}>
            {(analytics?.cacheHitPct ?? 0) >= 40 ? (analytics?.bestCacheModel?.model ?? '上下文复用') : '上下文重传较多'}
          </div>
          <div className={css.roastDesc} title={(analytics?.cacheHitPct ?? 0) >= 40 ? '前缀缓存命中率高，大幅节约 Token' : '较多长文本全量重传，可利用前缀缓存'}>
            {(analytics?.cacheHitPct ?? 0) >= 40 ? '前缀缓存命中率高，大幅节约 Token' : '较多长文本全量重传，可利用前缀缓存'}
          </div>
          <div className={css.roastVal} style={{ color: (analytics?.cacheHitPct ?? 0) >= 40 ? '#10b981' : '#f59e0b' }}>
            {analytics ? `命中 ${analytics.cacheHitPct}% (${fmtCompact(analytics.totalCacheRead)} Token)` : '-'}
          </div>
          <div className={css.roastFooter}>
            <span className={css.roastFooterLeft}>缓存效率</span>
            <span className={css.roastAction}>{activeDrilldown === 'cache' ? '收起透视 ▴' : '透视详情 ›'}</span>
          </div>
        </div>

        {/* 卡片 5: 终端耗时狂 / 秒级放行 */}
        <div
          className={`${css.roastItem} ${activeDrilldown === 'tool' ? css.roastItemActive : ''}`}
          onClick={() => setActiveDrilldown(activeDrilldown === 'tool' ? null : 'tool')}
        >
          <div className={css.roastHead}>
            <span className={css.roastTag} style={{ color: (analytics?.toolTimePct ?? 0) >= 30 ? '#f59e0b' : '#3b82f6' }}>
              {(analytics?.toolTimePct ?? 0) >= 30 ? '终端耗时狂' : '秒级放行'}
            </span>
            <span className={css.roastCategoryBadge}>工程归因</span>
          </div>
          <div className={css.roastTitle}>
            {(analytics?.toolTimePct ?? 0) >= 30 ? `本地命令占 ${analytics?.toolTimePct}% 耗时` : `本地损耗仅 ${analytics?.toolTimePct ?? 0}%`}
          </div>
          <div className={css.roastDesc} title={(analytics?.toolTimePct ?? 0) >= 30 ? '很多时候不是模型卡，是本地脚本跑太久' : '本地工具极速执行，等待时间主要在云端'}>
            {(analytics?.toolTimePct ?? 0) >= 30 ? '很多时候不是模型卡，是本地脚本跑太久' : '本地工具极速执行，等待时间主要在云端'}
          </div>
          <div className={css.roastVal} style={{ color: (analytics?.toolTimePct ?? 0) >= 30 ? '#f59e0b' : '#3b82f6' }}>
            {analytics ? `工具耗时 ${Math.round(analytics.totalToolMs / 1000)} 秒 (${analytics.totalTools} 次)` : '-'}
          </div>
          <div className={css.roastFooter}>
            <span className={css.roastFooterLeft}>本地耗时</span>
            <span className={css.roastAction}>{activeDrilldown === 'tool' ? '收起透视 ▴' : '透视详情 ›'}</span>
          </div>
        </div>

        {/* 卡片 6: 运行可靠度 */}
        <div
          className={`${css.roastItem} ${activeDrilldown === 'reliability' ? css.roastItemActive : ''}`}
          onClick={() => setActiveDrilldown(activeDrilldown === 'reliability' ? null : 'reliability')}
        >
          <div className={css.roastHead}>
            <span className={css.roastTag} style={{ color: (analytics?.totalErrors ?? 0) > 0 ? '#ef4444' : '#10b981' }}>
              {(analytics?.totalErrors ?? 0) > 0 ? '翻车排查' : '运行可靠度'}
            </span>
            <span className={css.roastCategoryBadge}>稳定性</span>
          </div>
          <div className={css.roastTitle} title={(analytics?.totalErrors ?? 0) > 0 ? '存在工具报错' : '执行顺畅'}>
            {(analytics?.totalErrors ?? 0) > 0 ? `${analytics?.totalErrors} 次工具报错` : '100% 顺畅'}
          </div>
          <div className={css.roastDesc} title={(analytics?.totalErrors ?? 0) > 0 ? '命令执行或参数错误，注意环境排查' : '未发生命令报错或异常，执行稳健'}>
            {(analytics?.totalErrors ?? 0) > 0 ? '命令执行或参数错误，注意环境排查' : '未发生命令报错或异常，执行稳健'}
          </div>
          <div className={css.roastVal} style={{ color: (analytics?.totalErrors ?? 0) > 0 ? '#ef4444' : '#10b981' }}>
            {(analytics?.totalErrors ?? 0) > 0 ? `${analytics?.totalErrors} 次报错 · ${analytics?.totalRetries} 次重试` : '0 报错 · 0 重试'}
          </div>
          <div className={css.roastFooter}>
            <span className={css.roastFooterLeft}>异常检测</span>
            <span className={css.roastAction}>{activeDrilldown === 'reliability' ? '收起透视 ▴' : '透视详情 ›'}</span>
          </div>
        </div>
      </div>

      {/* KPI 卡片深度下钻透视面板：严格严谨排序，绝不出框 */}
      {activeDrilldown && analytics ? (
        <div className={css.drilldownPanel}>
          <div className={css.drilldownHead}>
            <div className={css.drilldownTitleGroup}>
              <span className={css.drilldownTitle}>
                {activeDrilldown === 'speed' && '⚡ 模型首字响应延迟对比 (TTFT)'}
                {activeDrilldown === 'latency' && '🐢 模型首字排队耗时排行榜'}
                {activeDrilldown === 'thinking' && '🧠 深度推导算力分配明细'}
                {activeDrilldown === 'cache' && '💰 前缀缓存命中率排行榜'}
                {activeDrilldown === 'tool' && '⏱️ 本地工具与终端命令耗时全景拆解'}
                {activeDrilldown === 'reliability' && '🛡️ 运行可靠度与报错排查'}
              </span>
              <span className={css.drilldownSub}>
                {activeDrilldown === 'speed' && '按首响应延迟升序排列（最快在上，首字响应最迅速）'}
                {activeDrilldown === 'latency' && '按排队耗时降序排列（排队最久在上，定位卡顿瓶颈）'}
                {activeDrilldown === 'thinking' && '按思考 Token 占比降序排列（对比自我推导与正文算力比重）'}
                {activeDrilldown === 'cache' && '按前缀缓存命中率降序排列（直接决定上下文成本与省钱效率）'}
                {activeDrilldown === 'tool' && '本地工具耗时全景拆解（按单会话本地执行耗时由大到小降序排查）'}
                {activeDrilldown === 'reliability' && '按报错与重试次数降序排查（优先定位最高频故障会话）'}
              </span>
            </div>
            <button
              type="button"
              className={css.drilldownCloseBtn}
              onClick={() => setActiveDrilldown(null)}
            >
              收起 ✕
            </button>
          </div>

          {/* 1. 速度 / 延迟下钻：每个模型唯一，严格升序/降序 */}
          {activeDrilldown === 'speed' && (
            <div className={css.rankList}>
              {analytics.speedList.map((m: any, idx: number) => {
                const avgMs = m.firstMs / m.firstSamples
                const minMs = analytics.speedList[0].firstMs / analytics.speedList[0].firstSamples
                // 最快的模型得分为 100%，后续依次递减，条长完美单调递减
                const score = Math.max(10, Math.min(100, Math.round((minMs / avgMs) * 100)))
                const color = avgMs < 1000 ? '#10b981' : avgMs < 3000 ? '#3b82f6' : '#f59e0b'
                return (
                  <div key={m.model} className={css.rankItem}>
                    <div className={css.rankItemTop}>
                      <div className={css.rankItemLeft}>
                        <span className={`${css.rankBadge} ${idx === 0 ? css.rankBadgeGold : ''}`}>#{idx + 1}</span>
                        <span className={css.rankName} title={m.model}>{m.model}</span>
                      </div>
                      <span className={css.rankValMain} style={{ color }}>
                        {(avgMs / 1000).toFixed(2)} 秒
                      </span>
                    </div>
                    <div className={css.rankTrack}>
                      <div className={css.rankBar} style={{ width: `${score}%`, background: color }} />
                    </div>
                    <div className={css.rankSubText}>
                      <span>速度敏捷得分 <strong>{score}分</strong> (首字均值 {(avgMs / 1000).toFixed(2)}s)</span>
                      <span>累计采样 {m.firstSamples} 次</span>
                    </div>
                  </div>
                )
              })}
              {analytics.speedList.length === 0 ? (
                <div className={css.drilldownEmpty}>暂无模型首字响应延迟采样数据。</div>
              ) : null}
            </div>
          )}

          {activeDrilldown === 'latency' && (
            <div className={css.rankList}>
              {analytics.latencyList.map((m: any, idx: number) => {
                const avgMs = m.firstMs / m.firstSamples
                const maxMs = analytics.latencyList[0].firstMs / analytics.latencyList[0].firstSamples
                // 最慢的模型瓶颈权重 100%，后续依次递减，条长完美单调递减
                const bottleneckPct = Math.max(10, Math.min(100, Math.round((avgMs / maxMs) * 100)))
                const color = avgMs > 5000 ? '#ef4444' : avgMs > 2000 ? '#f59e0b' : '#3b82f6'
                return (
                  <div key={m.model} className={css.rankItem}>
                    <div className={css.rankItemTop}>
                      <div className={css.rankItemLeft}>
                        <span className={`${css.rankBadge} ${idx === 0 ? css.rankBadgeGold : ''}`}>#{idx + 1}</span>
                        <span className={css.rankName} title={m.model}>{m.model}</span>
                      </div>
                      <span className={css.rankValMain} style={{ color }}>
                        {(avgMs / 1000).toFixed(2)} 秒
                      </span>
                    </div>
                    <div className={css.rankTrack}>
                      <div className={css.rankBar} style={{ width: `${bottleneckPct}%`, background: color }} />
                    </div>
                    <div className={css.rankSubText}>
                      <span>排队延迟 <strong>{(avgMs / 1000).toFixed(2)}s</strong> (瓶颈权重 {bottleneckPct}%)</span>
                      <span>累计采样 {m.firstSamples} 次</span>
                    </div>
                  </div>
                )
              })}
              {analytics.latencyList.length === 0 ? (
                <div className={css.drilldownEmpty}>暂无模型排队延迟采样数据。</div>
              ) : null}
            </div>
          )}

          {/* 2. 深度思考推导下钻：严格按思考占比降序 */}
          {activeDrilldown === 'thinking' && (
            <div className={css.rankList}>
              {analytics.thinkList.map((m: any, idx: number) => {
                const totalTokens = (m.reasoning ?? 0) + (m.output ?? 0)
                const thinkPct = totalTokens > 0 ? Math.round((m.reasoning / totalTokens) * 100) : 0
                return (
                  <div key={m.model} className={css.rankItem}>
                    <div className={css.rankItemTop}>
                      <div className={css.rankItemLeft}>
                        <span className={`${css.rankBadge} ${idx === 0 ? css.rankBadgeGold : ''}`}>#{idx + 1}</span>
                        <span className={css.rankName} title={m.model}>{m.model}</span>
                      </div>
                      <span className={css.rankValMain} style={{ color: '#8b5cf6' }}>
                        思考占比 {thinkPct}%
                      </span>
                    </div>
                    <div className={css.toolCompoundTrack} style={{ height: '8px' }}>
                      <div style={{ width: `${thinkPct}%`, background: '#8b5cf6', height: '100%' }} title={`思考: ${thinkPct}%`} />
                      <div style={{ width: `${100 - thinkPct}%`, background: '#38bdf8', height: '100%' }} title={`正文: ${100 - thinkPct}%`} />
                    </div>
                    <div className={css.rankSubText}>
                      <span>思考推导 <strong>{fmtCompact(m.reasoning)}</strong> Token ({thinkPct}%)</span>
                      <span>正文输出 <strong>{fmtCompact(m.output)}</strong> Token</span>
                    </div>
                  </div>
                )
              })}
              {analytics.thinkList.length === 0 ? (
                <div className={css.drilldownEmpty}>当前时间范围内未检测到调用带推导思考过程的模型。</div>
              ) : null}
            </div>
          )}

          {/* 3. 前缀缓存下钻：严格按命中率降序 */}
          {activeDrilldown === 'cache' && (
            <div className={css.rankList}>
              {analytics.cacheList.map((m: any, idx: number) => {
                const totalIn = (m.input ?? 0) + (m.cacheRead ?? 0)
                const hitPct = totalIn > 0 ? Math.round(((m.cacheRead ?? 0) / totalIn) * 100) : 0
                return (
                  <div key={m.model} className={css.rankItem}>
                    <div className={css.rankItemTop}>
                      <div className={css.rankItemLeft}>
                        <span className={`${css.rankBadge} ${idx === 0 ? css.rankBadgeGold : ''}`}>#{idx + 1}</span>
                        <span className={css.rankName} title={m.model}>{m.model}</span>
                      </div>
                      <span className={css.rankValMain} style={{ color: '#10b981' }}>
                        命中率 {hitPct}%
                      </span>
                    </div>
                    <div className={css.toolCompoundTrack} style={{ height: '8px' }}>
                      <div style={{ width: `${hitPct}%`, background: '#10b981', height: '100%' }} title={`缓存命中: ${hitPct}%`} />
                      <div style={{ width: `${100 - hitPct}%`, background: 'var(--dsw-alias-border-l3, #94a3b8)', height: '100%' }} title={`未命中: ${100 - hitPct}%`} />
                    </div>
                    <div className={css.rankSubText}>
                      <span>命中复用 <strong>{fmtCompact(m.cacheRead ?? 0)}</strong> Token ({hitPct}%)</span>
                      <span>实付输入 <strong>{fmtCompact(m.input ?? 0)}</strong> Token</span>
                    </div>
                  </div>
                )
              })}
              {analytics.cacheList.length === 0 ? (
                <div className={css.drilldownEmpty}>暂无模型缓存使用记录。</div>
              ) : null}
            </div>
          )}

          {/* 4. 本地工具耗时下钻：排序严谨，严格降序 */}
          {activeDrilldown === 'tool' && (
            <div className={css.toolDrillSection}>
              {/* 顶部复合比例条 */}
              <div className={css.toolCompoundBox}>
                <div className={css.toolCompoundTrack}>
                  <div className={css.toolSliceBash} style={{ width: `${analytics.bashPct}%` }} />
                  <div className={css.toolSliceFile} style={{ width: `${analytics.filePct}%` }} />
                </div>
                <div className={css.toolCompoundLegend}>
                  <span><i className={css.dlDot} style={{ background: 'var(--dsw-static-green-500, #10b981)' }} /> 终端命令 (Bash): <strong>{Math.round(analytics.totalBashMs / 1000)}秒 ({analytics.bashPct}%)</strong></span>
                  <span><i className={css.dlDot} style={{ background: '#0ea5e9' }} /> 文件与通用读写: <strong>{Math.round(analytics.totalFileMs / 1000)}秒 ({analytics.filePct}%)</strong></span>
                </div>
              </div>

              {/* 两张典型场景拆解卡片 */}
              <div className={css.toolGridCards}>
                <div className={css.toolMiniCard}>
                  <div className={css.toolMiniTitle}>
                    <i className={css.dlDot} style={{ background: 'var(--dsw-static-green-500, #10b981)' }} />
                    <span>终端 Bash 命令 (测试/构建/脚本)</span>
                  </div>
                  <div className={css.toolMiniNum}>{Math.round(analytics.totalBashMs / 1000)} 秒</div>
                  <div className={css.toolMiniDesc}>
                    包含 npm run, cargo, git, Python 以及本地自动化测试脚本等高耗时运行环节。
                  </div>
                </div>

                <div className={css.toolMiniCard}>
                  <div className={css.toolMiniTitle}>
                    <i className={css.dlDot} style={{ background: '#0ea5e9' }} />
                    <span>文件操作与其他工具 (读写/检索)</span>
                  </div>
                  <div className={css.toolMiniNum}>{Math.round(analytics.totalFileMs / 1000)} 秒</div>
                  <div className={css.toolMiniDesc}>
                    包含 read, write, edit, glob, grep 等轻量快速文件读写。单次耗时通常在毫秒级。
                  </div>
                </div>
              </div>

              {/* 最耗时的对话工具执行排查 (严格按耗时降序) */}
              {analytics.topToolSessions && analytics.topToolSessions.length > 0 ? (
                <div className={css.toolTopList}>
                  <div className={css.toolTopListTitle}>单会话工具总耗时 TOP 3 (降序排查)</div>
                  {analytics.topToolSessions.slice(0, 3).map((s: any, idx: number) => {
                    const tMs = s.value?.totals?.toolMs ?? 0
                    const bMs = s.value?.totals?.bashMs ?? 0
                    const fMs = Math.max(0, tMs - bMs)
                    const bPct = tMs > 0 ? Math.round((bMs / tMs) * 100) : 0
                    return (
                      <div key={s.sessionId} className={css.rankItem}>
                        <div className={css.rankItemTop}>
                          <div className={css.rankItemLeft}>
                            <span className={`${css.rankBadge} ${idx === 0 ? css.rankBadgeGold : ''}`}>#{idx + 1}</span>
                            <span className={css.sessionIdTag}>{s.sessionId.slice(0, 14)}…</span>
                            <span className={css.rankName} title={s.value?.models?.[0]?.model}>{s.value?.models?.[0]?.model ?? '通用会话'}</span>
                          </div>
                          <span className={css.rankValMain}>
                            总计 {Math.round(tMs / 1000)} 秒
                          </span>
                        </div>
                        <div className={css.toolCompoundTrack} style={{ height: '8px' }}>
                          <div style={{ width: `${bPct}%`, background: 'var(--dsw-static-green-500, #10b981)', height: '100%' }} title={`终端命令: ${Math.round(bMs/1000)}s`} />
                          <div style={{ width: `${100 - bPct}%`, background: '#0ea5e9', height: '100%' }} title={`文件读写: ${Math.round(fMs/1000)}s`} />
                        </div>
                        <div className={css.rankSubText}>
                          <span>终端 Bash <strong>{Math.round(bMs / 1000)}s</strong> ({bPct}%)</span>
                          <span>文件读写 <strong>{Math.round(fMs / 1000)}s</strong> ({100 - bPct}%)</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )}

          {/* 5. 运行可靠度与报错排查下钻：严格按报错次数降序 */}
          {activeDrilldown === 'reliability' && (
            <div className={css.errorDrillSection}>
              {analytics.totalErrors === 0 && analytics.totalRetries === 0 ? (
                <div className={css.errorAllGoodBox}>
                  ✓ 全部会话工具执行 100% 顺畅，未记录到任何非零退出码或重试异常！
                </div>
              ) : (
                <div className={css.errorSessionList}>
                  <div className={css.toolTopListTitle}>报错与重试排查列表 (按异常严重度降序)</div>
                  {analytics.errorSessions.map((s: any, idx: number) => (
                    <div key={s.sessionId} className={css.errorSessionRow}>
                      <span className={`${css.rankBadge} ${idx === 0 ? css.rankBadgeGold : ''}`}>#{idx + 1}</span>
                      <span className={css.sessionIdTag}>{s.sessionId.slice(0, 14)}…</span>
                      <span className={css.rankName}>{s.value?.models?.[0]?.model ?? '通用对话'}</span>
                      <span className={s.value?.totals?.toolErrors > 0 ? css.statusBad : css.statusOk}>
                        {s.value?.totals?.toolErrors > 0 ? `${s.value.totals.toolErrors} 次报错` : '0 报错'}
                      </span>
                      <span className={s.value?.totals?.retries > 0 ? css.statusWarn : css.statusOk}>
                        {s.value?.totals?.retries > 0 ? `${s.value.totals.retries} 次重试` : '0 重试'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ) : null}

      <div className={css.vizSplitGrid}>
        {/* 模型支出份额 (环形图 100% 闭环无缺口，图例按 Token 严格降序) */}
        <div className={css.vizPanel}>
          <div className={css.vizHead}>
            <span className={css.vizTitle}>模型支出份额</span>
            <span className={css.vizSub}>按消耗 Token 降序排列</span>
          </div>
          <div className={css.donutWrap}>
            <div className={css.donutSvgBox}>
              <svg viewBox="0 0 100 100" className={css.donutSvg}>
                <circle cx="50" cy="50" r="38" fill="none" stroke="var(--dsw-alias-bg-layer-2)" strokeWidth="12" />
                <g transform="rotate(-90 50 50)">
                  {(analytics?.donutSegments.length ?? 0) === 1 ? (
                    <circle cx="50" cy="50" r="38" fill="none" stroke={analytics!.donutSegments[0].color} strokeWidth="12" />
                  ) : (
                    analytics?.donutSegments.map((seg, idx) => (
                      <circle
                        key={idx}
                        cx="50"
                        cy="50"
                        r="38"
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="12"
                        strokeDasharray={seg.dasharray}
                        strokeDashoffset={seg.dashoffset}
                      />
                    ))
                  )}
                </g>
              </svg>
              <div className={css.donutCenterText}>
                <div className={css.donutCenterNum}>
                  {activeSeg ? `${activeSeg.pct}%` : topModel ? `${topModel.pct}%` : `${analytics?.donutSegments.length ?? 0}款`}
                </div>
                <div className={css.donutCenterSub}>
                  {activeSeg ? '选中占比' : '主力占比'}
                </div>
              </div>
            </div>
            <div className={css.donutLegendList}>
              {analytics?.donutSegments.map((seg, idx) => (
                <div
                  key={idx}
                  className={`${css.donutLegendRow} ${hoveredIdx === idx ? css.donutLegendRowActive : ''}`}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                >
                  <span className={css.dlLeft}>
                    <i className={css.dlDot} style={{ background: seg.color }} />
                    <span className={css.dlName} title={seg.model}>{seg.model}</span>
                  </span>
                  <span className={css.dlRight}>{fmtCompact(seg.tokens)} · {seg.pct}%</span>
                </div>
              ))}
            </div>
          </div>
          {/* 专属模型全名与份额透视条：彻底舒展超长模型名 */}
          {(activeSeg || topModel) ? (
            <div className={css.donutInspectBar}>
              <i className={css.dlDot} style={{ background: (activeSeg || topModel)?.color }} />
              <span className={css.donutInspectName} title={(activeSeg || topModel)?.model}>
                {(activeSeg || topModel)?.model}
              </span>
              <span className={css.donutInspectTag}>{activeSeg ? '当前高亮' : '全场主力'}</span>
              <span className={css.donutInspectVal}>
                {fmtCompact((activeSeg || topModel)?.tokens ?? 0)} Token ({ (activeSeg || topModel)?.pct }%)
              </span>
            </div>
          ) : null}
        </div>

        {/* 每日编码活跃度 (自适应舒展排版) */}
        <div className={css.vizPanel}>
          <div className={css.vizHead}>
            <span className={css.vizTitle}>每日编码活跃度</span>
            <span className={css.vizSub}>近 {range} 天分布</span>
          </div>
          <div className={`${css.dayStack} ${range === '7' ? css.dayStackWeek : ''}`} aria-label="按日活跃柱图">
            {(analytics?.daySeries ?? []).map(day => (
              <div key={day.key} className={css.dayCol} title={`${day.key} · ${fmtCompact(day.total)} Token`}>
                <div className={css.dayColFill}>
                  {day.total > 0 ? (
                    day.segments.map(seg => (
                      <div key={seg.model} className={css.daySeg} style={{
                        height: `${(seg.tokens / analytics!.dayMax) * 100}%`,
                        background: seg.color,
                      }} />
                    ))
                  ) : (
                    <div className={css.dayEmptyDot} />
                  )}
                </div>
                <span className={css.dayLabel}>{day.label}</span>
              </div>
            ))}
          </div>
          <div className={css.chartFoot}>
            每日柱高代表当天最后活动的对话 Token 汇总，分色对应左侧调用模型。
          </div>
        </div>
      </div>

      {/* 重点对话账单：严格按选定维度降序排序！ */}
      <div className={css.vizPanel}>
        <div className={css.vizHead}>
          <div className={css.tableTitleGroup}>
            <span className={css.vizTitle}>重点对话账单</span>
            <span className={css.vizSub}>
              {sessionSort === 'tokens' && '按 Token 消耗由高到低严格排序'}
              {sessionSort === 'time' && '按执行总耗时由长到短严格排序'}
              {sessionSort === 'errors' && '按报错与重试次数降序排查'}
            </span>
          </div>
          <div className={css.tableSortGroup} role="group" aria-label="对话账单排序切换">
            <button
              type="button"
              className={css.sortBtn}
              data-active={sessionSort === 'tokens' ? '' : undefined}
              onClick={() => setSessionSort('tokens')}
            >
              Token 消耗 ↓
            </button>
            <button
              type="button"
              className={css.sortBtn}
              data-active={sessionSort === 'time' ? '' : undefined}
              onClick={() => setSessionSort('time')}
            >
              总耗时 ↓
            </button>
            <button
              type="button"
              className={css.sortBtn}
              data-active={sessionSort === 'errors' ? '' : undefined}
              onClick={() => setSessionSort('errors')}
            >
              故障数 ↓
            </button>
          </div>
        </div>

        {sessions && sessions.rows.length > 0 ? (
          <div className={css.sessionTableBox}>
            <div className={css.sessionTableHeader}>
              <span>排名 · 会话ID</span>
              <span>主用模型</span>
              <span style={{ textAlign: 'right' }}>Token 消耗</span>
              <span style={{ textAlign: 'right' }}>总耗时</span>
              <span style={{ textAlign: 'center' }}>运行状态</span>
              <span />
            </div>
            {analytics?.sortedSessions.slice(0, 10).map((row: any, idx: number) => {
              const val = row.value
              const isOpen = openSessionId === row.sessionId
              const errCount = val.totals.toolErrors ?? 0
              const retryCount = val.totals.retries ?? 0
              const modelMs = val.totals.modelMs ?? 0
              const toolMs = val.totals.toolMs ?? 0
              const totalMs = modelMs + toolMs
              const modelPct = totalMs > 0 ? Math.round((modelMs / totalMs) * 100) : 50
              const status = errCount > 0
                ? `${errCount} 次报错`
                : retryCount > 0 ? `${retryCount} 次重试` : '顺畅'
              const tokenBarPct = Math.max(4, Math.round(((val.totals.tokens ?? 0) / analytics.maxSessionTokens) * 100))
              return (
                <div key={row.sessionId} className={`${css.sessionItemRow} ${isOpen ? css.sessionItemOpen : ''}`}>
                  <button type="button" className={css.sessionItemHead} onClick={() => setOpenSessionId(isOpen ? null : row.sessionId)}>
                    <span className={css.sessionIdTag} title={row.sessionId}>
                      <strong className={css.tableRankNum}>#{idx + 1}</strong> {row.sessionId.length > 12 ? `${row.sessionId.slice(0, 6)}…${row.sessionId.slice(-3)}` : row.sessionId}
                    </span>
                    <span className={css.sessionModelCell} title={val.models?.[0]?.model}>{val.models?.[0]?.model ?? '未标注'}</span>
                    <div className={css.sessionTokenCell}>
                      <span>{fmtCompact(val.totals.tokens)}</span>
                      <div className={css.sessionTokenBar} style={{ width: `${tokenBarPct}%` }} />
                    </div>
                    <span style={{ textAlign: 'right' }}>{Math.round(totalMs / 1000)} 秒</span>
                    <span style={{ textAlign: 'center' }} className={errCount > 0 ? css.statusBad : retryCount > 0 ? css.statusWarn : css.statusOk}>{status}</span>
                    <span className={css.arrowIcon}>›</span>
                  </button>
                  {isOpen ? (
                    <div className={css.sessionItemDrawer}>
                      <div className={css.drawerTitle}>耗时构成下钻：模型响应 vs 本地工具</div>
                      <div className={css.drawerBarTrack}>
                        <div className={css.drawerSliceModel} style={{ width: `${modelPct}%` }} />
                        <div className={css.drawerSliceTool} style={{ width: `${100 - modelPct}%` }} />
                      </div>
                      <div className={css.drawerMetaRow}>
                        <span>模型 {Math.round(modelMs / 1000)} 秒 (首响应均值 {val.totals.firstSamples ? (val.totals.firstMs / val.totals.firstSamples / 1000).toFixed(1) : 0}s)</span>
                        <span>工具 {Math.round(toolMs / 1000)} 秒 · {val.totals.tools} 次执行</span>
                        <span>缓存命中率 {val.totals.input + val.totals.cacheRead > 0 ? Math.round((val.totals.cacheRead / (val.totals.input + val.totals.cacheRead)) * 100) : 0}%</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <div className={css.emptyScan}>暂无已缓存的对话统计。</div>
        )}
      </div>

      <details className={css.settingsDrawer}>
        <summary className={css.settingsSummary}>⚙ 高级报警阈值设置 (默认开箱即用，无需频繁调整)</summary>
        <div className={css.settingsDrawerContent}>
          <label className={css.settingInlineItem}>
            <span>等多久没字算卡顿:</span>
            <input type="number" min={5} max={300} className={css.settingsMiniInput} value={silence}
              onChange={e => setSilence(Number(e.target.value))} />
            <span>秒</span>
          </label>
          <label className={css.settingInlineItem}>
            <span>单次推导思考超时:</span>
            <input type="number" min={10} max={600} className={css.settingsMiniInput} value={reasoning}
              onChange={e => setReasoning(Number(e.target.value))} />
            <span>秒</span>
          </label>
          <button type="button" className={css.settingsMiniSaveBtn} onClick={save}>{saved ? '已保存 ✓' : '保存'}</button>
        </div>
      </details>
    </div>
  )
}
