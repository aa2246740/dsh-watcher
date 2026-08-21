import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-session-stats/client'
import {
  DiffBlock,
  IconCheckOutline16,
  IconChevronRightOutline14,
  IconCopyOutline16,
  IconRefreshOutline14,
  JsonTree,
  MarkdownText,
  Pill,
  ReadBlock,
  StateDot,
  TerminalBlock,
  useAnchoredPosition,
  writeClipboard,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createFollow } from '../hub/follow.ts'
import type { CompleteHistoryResult } from '../hub/history.ts'
import {
  clusterOutcomeSummary,
  clusterWorkItems,
  type WorkCluster,
} from '../hub/aggregation.ts'
import {
  foldSnapshot,
  mergeObservedPictures,
  type WorkGroup,
  type WorkItem,
  type WorkPresentation,
  type WorkStatus,
  type WorkStep,
  type WorkTurn,
} from '../observation/fold.ts'
import css from './Watcher.module.css'
import {
  OVERVIEW_STATE_LABEL,
  overviewStateOf,
  turnNeedsDefaultDisclosure,
  turnOverviewSummary,
} from '../hub/overview.ts'
import {
  deriveSessionTiming,
  deriveTurnPerformance,
  formatTokensPerSecond,
  groupElapsedMs,
  itemElapsedMs,
  stepElapsedMs,
  turnElapsedReading,
  type SessionTiming,
  type TurnPerformance,
} from '../observation/performance.ts'
import {
  hasReasoningEvidence,
  modelStageMetrics,
  type ModelAttempt,
  type ModelStepTrace,
} from '../observation/model-trace.ts'
import { stepTimelineEntries } from './step-timeline.ts'
import {
  chooseTurnDisclosureMode,
  createTurnDisclosureState,
  resetTurnDisclosureOverrides,
  toggleTurnDisclosure,
  turnDisclosureOpen,
} from './turn-disclosure.ts'

export interface WatcherInjected {
  loadAllHistory: (signal: AbortSignal) => Promise<CompleteHistoryResult>
}

export type WatcherProps = PropsRuntime<'conversation.session.header.utilities'> & WatcherInjected

type DetailTab = 'result' | 'input' | 'raw'
type ObservationMode = 'itemized' | 'grouped'
type HistoryLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'complete' }
  | { kind: 'error'; message: string }

const PANEL_GAP = 8
const PANEL_MARGIN = 12
const UNPLACED_PANEL_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }
const MARKDOWN_CODE_LABELS = Object.freeze({ copyLabel: '复制', copiedLabel: '已复制' })

const STATUS_LABEL: Record<WorkStatus, string> = {
  running: '进行中',
  waiting: '等待你',
  success: '成功',
  failure: '失败',
  returned: '已返回',
  interrupted: '已中断',
  unknown: '未知',
}

function dotState(status: WorkStatus): StateDotState | null {
  if (status === 'running') return 'ongoing'
  if (status === 'waiting') return 'warning'
  if (status === 'failure' || status === 'interrupted') return 'error'
  if (status === 'success') return 'done'
  return null
}

function StatusMark({ status, className }: { status: WorkStatus; className?: string | undefined }) {
  const state = dotState(status)
  return state === null
    ? <span className={`${css.neutralDot}${className === undefined ? '' : ` ${className}`}`} data-status={status} aria-hidden="true" />
    : <StateDot state={state} size={10} className={className} />
}

function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null) return null
  if (durationMs < 1000) return `${Math.round(durationMs)} ms`
  const secondsWithDecimal = Math.round(durationMs / 100) / 10
  if (secondsWithDecimal < 60) {
    return `${secondsWithDecimal < 10 ? secondsWithDecimal.toFixed(1) : Math.round(secondsWithDecimal)} s`
  }
  const totalSeconds = Math.round(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
  }
  return `${minutes}m ${seconds}s`
}

type TurnDurationDisplay = {
  kind: 'exact' | 'partial'
  value: string
}

function turnDuration(turn: WorkTurn, live: boolean, now: number): TurnDurationDisplay | null {
  const reading = turnElapsedReading(turn, live, now)
  if (reading.kind === 'unavailable') return null
  const duration = formatDuration(reading.durationMs)
  if (duration === null) return null
  return {
    kind: reading.kind === 'exact' ? 'exact' : 'partial',
    value: duration,
  }
}

function useLiveClock(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [enabled])

  return now
}

function TurnMetricStrip({ performance }: { performance: TurnPerformance }) {
  const metrics = [
    ['模型', formatDuration(performance.modelMs)],
    ['工具', formatDuration(performance.toolMs)],
    ['首 token', formatDuration(performance.ttftMs)],
  ].filter((metric): metric is [string, string] => metric[1] !== null)

  if (metrics.length === 0) return null
  return (
    <dl className={css.turnMetrics} aria-label="对话轮次性能分解">
      {metrics.map(([label, value]) => (
        <div key={label} className={css.turnMetric}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function SessionTimeLedger({ timing }: { timing: SessionTiming }) {
  if (timing.kind === 'unavailable') return null
  const metrics = [
    [timing.coverage === 'complete' ? '会话总跨度' : '已加载跨度', formatDuration(timing.elapsedMs)],
    ['轮次内耗时', formatDuration(timing.activeTurnMs)],
    ['轮次间隔', formatDuration(timing.betweenTurnMs)],
  ]
  return (
    <dl
      className={css.sessionTiming}
      aria-label="会话墙钟时间分解"
      title="会话跨度等于轮次内耗时与轮次之间间隔；已加载跨度表示更早历史尚未载入"
    >
      {metrics.map(([label, value]) => (
        <div key={label} className={css.sessionTimingMetric}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function rawOf(item: WorkItem): string {
  if (item.rawText.trim() !== '') return item.rawText
  try {
    return JSON.stringify(item.rawValue, null, 2) ?? String(item.rawValue)
  } catch {
    return String(item.rawValue)
  }
}

function isJsonValue(value: unknown): value is object | unknown[] {
  return typeof value === 'object' && value !== null
}

function CopyRawButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
  }, [])

  const copy = () => {
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <button type="button" className={css.copyRaw} onClick={copy} aria-label={copied ? '原始数据已复制' : '复制原始数据'}>
      {copied ? <IconCheckOutline16 size={14} /> : <IconCopyOutline16 size={14} />}
      {copied ? '已复制' : '复制'}
    </button>
  )
}

function ResultPresentation({ presentation }: { presentation: WorkPresentation }) {
  switch (presentation.kind) {
    case 'terminal':
      return (
        <TerminalBlock
          command={presentation.command}
          cwd={presentation.cwd ?? undefined}
          output={presentation.output}
          exitCode={presentation.exitCode ?? undefined}
          signal={presentation.signal ?? undefined}
          running={presentation.running}
          maxLines={18}
        />
      )
    case 'read':
      return (
        <ReadBlock
          label={presentation.label}
          lang={presentation.lang ?? undefined}
          lines={presentation.lines}
          totalLines={presentation.totalLines}
          maxLines={18}
        />
      )
    case 'diff':
      return <DiffBlock diffs={presentation.diffs} maxLines={18} />
    case 'json':
      return <div className={css.jsonSurface}><JsonTree data={presentation.data} label="结构化结果" /></div>
    case 'text':
      return (
        <article className={css.documentResult} data-watcher-document="">
          <MarkdownText text={presentation.text} codeLabels={MARKDOWN_CODE_LABELS} />
        </article>
      )
    case 'image':
      return (
        <div className={css.artifactResult}>
          <div className={css.artifactGlyph} aria-hidden="true">▧</div>
          <strong>图片附件</strong>
          <span>附件已保留在本次会话记录中</span>
          {isJsonValue(presentation.attachment)
            ? <div className={css.jsonSurface}><JsonTree data={presentation.attachment} label="图片附件信息" /></div>
            : null}
        </div>
      )
    case 'empty':
      return <div className={css.detailEmpty}>这次执行还没有可显示的结果</div>
  }
}

function preferredItem(group: WorkGroup): WorkItem | null {
  return group.items.find(item => item.status === 'failure' && item.recoveredBy === null)
    ?? group.items.find(item => item.status === 'waiting' || item.status === 'running')
    ?? group.items.at(-1)
    ?? null
}

function groupStatusLabel(group: WorkGroup): string {
  return group.status === 'failure' ? '含失败记录' : STATUS_LABEL[group.status]
}

function itemPattern(item: WorkItem): string | null {
  if (item.retryIndex > 0) return `重试 ${item.retryIndex} 次`
  if (item.iterationIndex > 0) return `迭代第 ${item.iterationIndex + 1} 版`
  if (item.recoveredBy !== null) return '后续已恢复'
  return null
}

function ExecutionInspector({
  group,
  selectedItemId,
  live,
  now,
  onSelectItem,
  onBack,
}: {
  group: WorkGroup
  selectedItemId: string | null
  live: boolean
  now: number
  onSelectItem: (id: string) => void
  onBack: () => void
}) {
  const [tab, setTab] = useState<DetailTab>('result')
  const fallback = preferredItem(group)
  const selected = group.items.find(item => item.id === selectedItemId) ?? fallback

  useEffect(() => setTab('result'), [group.id, selected?.id])

  if (selected === null) return null
  const duration = formatDuration(itemElapsedMs(selected, live && selected.status === 'running', now))
  const groupDuration = formatDuration(groupElapsedMs(group, live, now))
  const raw = rawOf(selected)
  const hasInput = Object.keys(selected.args).length > 0
  const pattern = itemPattern(selected)

  return (
    <aside className={css.inspector} aria-label={`${group.title} 的执行详情`} data-ud-check="watcher-inspector" data-ud-role="panel">
      <header className={css.inspectorHeader}>
        <button type="button" className={css.inspectorBack} onClick={onBack} aria-label="返回工作路径">
          <IconChevronRightOutline14 size={13} aria-hidden="true" />
          工作路径
        </button>
        <div className={css.statusLine} data-status={group.status}>
          <StatusMark status={group.status} />
          <span>{groupStatusLabel(group)}</span>
          <span className={css.location}>
            对话轮次 {group.turn || '—'} · {group.steps.length} 个步骤{groupDuration === null ? '' : ` · ${groupDuration}`}
          </span>
        </div>
        <h2 className={css.inspectorTitle}>{group.title}</h2>
        <p className={css.inspectorSummary}>{group.subtitle}</p>
        <div className={css.groupSignals} aria-label="工作模式">
          {group.parallelStepCount > 0 ? <span>并行 {group.parallelStepCount} 次</span> : null}
          {group.retryCount > 0 ? <span data-retry="">重试 {group.retryCount} 次</span> : null}
          {group.iterationCount > 0 ? <span>有 {group.iterationCount} 次迭代</span> : null}
          {group.unconfirmedFailureCount > 0 ? <span data-error="">{group.unconfirmedFailureCount} 条失败后未见成功证据</span> : null}
        </div>
      </header>

      <div className={css.inspectorBody}>
        <section className={css.executionSection} aria-labelledby={`execution-title-${group.id}`}>
          <div className={css.sectionHeading}>
            <h3 id={`execution-title-${group.id}`}>执行路径</h3>
            <span>{group.items.length} 条记录</span>
          </div>
          <div className={css.executionList}>
            {group.steps.map((step, stepIndex) => {
              const stepLive = live && stepIndex === group.steps.length - 1
              const stepDuration = formatDuration(stepElapsedMs(step, stepLive, now))
              return <div key={step.id} className={css.stepBlock} data-parallel={step.parallel ? '' : undefined}>
                <div className={css.stepHeading}>
                  <span>步骤 {step.step || '—'}</span>
                  <span className={css.stepSignals}>
                    {stepDuration === null ? null : <span className={css.stepDuration}>{stepDuration}</span>}
                    {step.parallel ? <span className={css.parallelLabel}>{step.executionCount} 项并行</span> : null}
                  </span>
                </div>
                <div className={css.occurrences}>
                  {step.items.map((item, itemIndex) => {
                    const itemDuration = formatDuration(itemElapsedMs(item, stepLive && item.status === 'running', now))
                    return <button
                      key={item.id}
                      type="button"
                      className={css.occurrence}
                      data-selected={item.id === selected.id ? '' : undefined}
                      data-status={item.status}
                      aria-pressed={item.id === selected.id}
                      onClick={() => onSelectItem(item.id)}
                    >
                      <StatusMark status={item.status} className={css.occurrenceDot} />
                      <span className={css.occurrenceCopy}>
                        <span className={css.occurrenceTitle}>{item.title}</span>
                        <span className={css.occurrenceMeta}>
                          {item.toolName ?? item.source}
                          {step.items.length > 1 ? ` · 分支 ${itemIndex + 1}` : ''}
                          {itemPattern(item) === null ? '' : ` · ${itemPattern(item)}`}
                        </span>
                      </span>
                      {itemDuration === null ? null : <span className={css.occurrenceDuration}>{itemDuration}</span>}
                      <IconChevronRightOutline14 size={12} className={css.occurrenceChevron} />
                    </button>
                  })}
                </div>
              </div>
            })}
          </div>
        </section>

        <section className={css.detailSection} aria-labelledby={`detail-title-${selected.id}`}>
          <div className={css.detailHeader}>
            <div className={css.detailIdentity}>
              <div className={css.detailStatus} data-status={selected.status}>
                <StatusMark status={selected.status} />
                <span>{STATUS_LABEL[selected.status]}</span>
                {pattern === null ? null : <span className={css.patternLabel}>{pattern}</span>}
              </div>
              <h3 id={`detail-title-${selected.id}`}>{selected.title}</h3>
              <p title={selected.subtitle}>{selected.subtitle || '没有补充说明'}</p>
            </div>
            <dl className={css.metrics}>
              {duration === null ? null : <><dt>耗时</dt><dd>{duration}</dd></>}
              {selected.exitCode === null ? null : <><dt>退出码</dt><dd data-error={selected.exitCode === 0 ? undefined : ''}>{selected.exitCode}</dd></>}
              {selected.signal === null ? null : <><dt>信号</dt><dd data-error="">{selected.signal}</dd></>}
            </dl>
          </div>

          <div className={css.tabs} role="tablist" aria-label="执行数据">
            {([
              ['result', '结果'],
              ['input', '输入'],
              ['raw', '原始'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={css.tab}
                data-active={tab === id ? '' : undefined}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={css.tabPanel} role="tabpanel">
            {tab === 'result' ? <ResultPresentation presentation={selected.presentation} /> : null}
            {tab === 'input'
              ? hasInput
                ? <div className={css.jsonSurface}><JsonTree data={selected.args} label="执行输入" /></div>
                : <div className={css.detailEmpty}>这条记录没有工具输入</div>
              : null}
            {tab === 'raw'
              ? (
                <div className={css.rawPanel}>
                  <div className={css.rawToolbar}>
                    <span>完整原始数据 · 不截断</span>
                    <CopyRawButton text={raw} />
                  </div>
                  <pre>{raw || '没有原始数据'}</pre>
                </div>
              )
              : null}
          </div>
        </section>
      </div>
      <footer className={css.inspectorFooter}>只读观察 · 不会改变 Agent</footer>
    </aside>
  )
}

/** The pupil scans only while live; the complete eye remains a useful static glyph. */
function IconLivingEye({ size = 17 }: { size?: number }) {
  return (
    <svg
      className={css.eye}
      data-ud-motion="watcher-eye-scan"
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <g className={css.eyeBlink}>
        <path
          className={css.eyeOutline}
          fill="currentColor"
          fillRule="evenodd"
          d="M9 3.25c-3.93 0-7.03 2.88-7.9 5.75.87 2.87 3.97 5.75 7.9 5.75s7.03-2.88 7.9-5.75C16.03 6.13 12.93 3.25 9 3.25Zm0 9.95A4.2 4.2 0 1 1 9 4.8a4.2 4.2 0 0 1 0 8.4Z"
        />
        <g className={css.eyePupil}>
          <circle cx="9" cy="9" r="2.05" fill="currentColor" />
          <circle cx="9.65" cy="8.35" r="0.45" fill="var(--dsw-specific-menu)" opacity="0.9" />
        </g>
      </g>
    </svg>
  )
}

function groupBadges(group: WorkGroup) {
  return (
    <span className={css.groupBadges} aria-hidden="true">
      {group.parallelStepCount > 0
        ? <span data-kind="parallel">{group.parallelStepCount === 1 ? '并行' : `并行 ${group.parallelStepCount} 组`}</span>
        : null}
      {group.retryCount > 0 ? <span data-kind="retry">重试 {group.retryCount}</span> : null}
      {group.iterationCount > 0 ? <span data-kind="iteration">迭代 {group.iterationCount}</span> : null}
    </span>
  )
}

function showOverviewTag(state: ReturnType<typeof overviewStateOf>): boolean {
  return state === 'waiting' || state === 'failure' || state === 'interrupted' || state === 'partial'
}

function itemMeta(item: WorkItem, { branch, step }: { branch: number | null; step: number | null }): string {
  return [
    step === null ? null : `步骤 ${step || '—'}`,
    item.toolName ?? item.source,
    branch === null ? null : `分支 ${branch}`,
    itemPattern(item),
  ].filter((part): part is string => part !== null && part !== '').join(' · ')
}

function branchNumberOf(step: WorkStep, item: WorkItem): number | null {
  if (!step.parallel) return null
  const index = step.items.findIndex(candidate => candidate.id === item.id)
  return index < 0 ? null : index + 1
}

function clusterBasisLabel(cluster: WorkCluster): string | null {
  if (cluster.executionCount < 2) return null
  if (cluster.basis === 'mutable-target' || cluster.basis === 'shared-target') return '同一目标'
  if (cluster.basis === 'exact-call') return '同一指令'
  return null
}

function reasoningAttemptDuration(attempt: ModelAttempt, now: number): number | null {
  if (attempt.firstReasoningTime === null || attempt.lastReasoningTime === null) return null
  const end = attempt.kind === 'running' && attempt.firstOutputTime === null
    ? now
    : attempt.lastReasoningTime
  return Math.max(0, end - attempt.firstReasoningTime)
}

function reasoningAttemptState(attempt: ModelAttempt): string {
  if (attempt.kind === 'running') return '生成中'
  if (attempt.kind === 'retried') return '已重试'
  if (attempt.kind === 'interrupted') return '已中断'
  return '已完成'
}

type ModelStageSegment = {
  key: 'wait' | 'reasoning' | 'output' | 'unattributed'
  label: string
  durationMs: number | null
  unavailableLabel: string
}

function ModelStage({
  trace,
  stepId,
  now,
  open,
  reasoningDisclosure,
  onToggle,
  onToggleReasoning,
}: {
  trace: ModelStepTrace
  stepId: string
  now: number
  open: boolean
  reasoningDisclosure: Readonly<Record<string, boolean>>
  onToggle: () => void
  onToggleReasoning: (key: string, open: boolean) => void
}) {
  const metrics = modelStageMetrics(trace, now)
  const hasReasoning = hasReasoningEvidence(trace)
  const total = formatDuration(metrics.totalMs)
  const visibleReasoning = formatDuration(metrics.visibleReasoningMs)
  const reasoningAttempts = trace.attempts.filter(attempt => attempt.reasoningText.trim() !== '')
  const summary = [
    total === null ? '时间不完整' : `模型 ${total}`,
    hasReasoning
      ? visibleReasoning === null ? '可见推理已记录' : `可见推理 ${visibleReasoning}`
      : null,
    trace.reasoningTokens === null ? null : `${trace.reasoningTokens.toLocaleString('zh-CN')} 推理 token`,
    metrics.live ? '进行中' : null,
  ].filter((value): value is string => value !== null).join(' · ')
  const segments: ModelStageSegment[] = [
    {
      key: 'wait',
      label: '首响应等待',
      durationMs: metrics.firstResponseMs,
      unavailableLabel: '时间戳不可用',
    },
    {
      key: 'reasoning',
      label: '可见推理',
      durationMs: metrics.visibleReasoningMs,
      unavailableLabel: hasReasoning ? '分段耗时不可用' : '未记录',
    },
    {
      key: 'output',
      label: '输出 / 工具意图',
      durationMs: metrics.outputMs,
      unavailableLabel: '时间戳不可用',
    },
    ...metrics.unattributedMs !== null && metrics.unattributedMs > 0
      ? [{
          key: 'unattributed' as const,
          label: '重试 / 未归因',
          durationMs: metrics.unattributedMs,
          unavailableLabel: '不可用',
        }]
      : [],
  ]
  const measuredSegments = segments.filter((segment): segment is ModelStageSegment & { durationMs: number } => (
    segment.durationMs !== null && segment.durationMs > 0
  ))
  const bodyId = `watcher-model-stage-${stepId}`

  return (
    <section className={css.modelStage} data-live={metrics.live ? '' : undefined}>
      <button
        type="button"
        className={css.modelStageToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        title="模型阶段只使用 DSH 会话中供应商公开写入的事件"
        onClick={onToggle}
      >
        <IconChevronRightOutline14 size={11} className={css.modelStageChevron} />
        <span className={css.modelStageGlyph} aria-hidden="true" />
        <span className={css.modelStageCopy}>
          <span className={css.modelStageTitle}>模型阶段</span>
          <span className={css.modelStageSummary}>{summary}</span>
        </span>
      </button>

      <div id={bodyId} className={css.modelStageBody} hidden={!open}>
        {measuredSegments.length === 0
          ? null
          : (
            <div className={css.modelStageBar} aria-label="模型阶段耗时比例">
              {measuredSegments.map(segment => (
                <span
                  key={segment.key}
                  data-segment={segment.key}
                  style={{ flexGrow: Math.max(segment.durationMs, 1) }}
                  title={`${segment.label} ${formatDuration(segment.durationMs) ?? ''}`}
                />
              ))}
            </div>
          )}

        <dl className={css.modelStageLedger}>
          {segments.map(segment => (
            <div key={segment.key} className={css.modelStageMetric}>
              <dt>
                <span className={css.modelStageSwatch} data-segment={segment.key} aria-hidden="true" />
                {segment.label}
              </dt>
              <dd>{formatDuration(segment.durationMs) ?? segment.unavailableLabel}</dd>
            </div>
          ))}
        </dl>

        {reasoningAttempts.length === 0
          ? <p className={css.modelStageNote}>本 Step 没有供应商可见推理记录</p>
          : (
            <div className={css.reasoningAttempts}>
              <p className={css.modelStageNote}>仅展示供应商写入 DSH 会话的可见 reasoning；不补写未记录内容。</p>
              {reasoningAttempts.map(attempt => {
                const key = `${stepId}:attempt:${attempt.attempt}`
                const reasoningOpen = reasoningDisclosure[key] ?? false
                const duration = formatDuration(reasoningAttemptDuration(attempt, now))
                const meta = [
                  reasoningAttemptState(attempt),
                  duration ?? '分段耗时不可用',
                  `${attempt.fragments.length} 个流片段`,
                  attempt.kind === 'retried' ? `等待重试 ${formatDuration(attempt.retryDelayMs) ?? '—'}` : null,
                ].filter((value): value is string => value !== null).join(' · ')
                return (
                  <section key={key} className={css.reasoningDisclosure} data-open={reasoningOpen ? '' : undefined}>
                    <button
                      type="button"
                      className={css.reasoningToggle}
                      aria-expanded={reasoningOpen}
                      aria-controls={`watcher-reasoning-${key}`}
                      onClick={() => onToggleReasoning(key, reasoningOpen)}
                    >
                      <IconChevronRightOutline14 size={11} className={css.reasoningChevron} />
                      <span className={css.reasoningLabel}>
                        {reasoningAttempts.length === 1 ? '推理记录' : `尝试 ${attempt.attempt}`}
                      </span>
                      <span className={css.reasoningMeta}>{meta}</span>
                    </button>
                    <article
                      id={`watcher-reasoning-${key}`}
                      className={css.reasoningBody}
                      hidden={!reasoningOpen}
                    >
                      <MarkdownText text={attempt.reasoningText} codeLabels={MARKDOWN_CODE_LABELS} />
                    </article>
                  </section>
                )
              })}
            </div>
          )}
      </div>
    </section>
  )
}

function OverviewOccurrenceButton({
  item,
  occurrenceNumber,
  branch,
  step,
  live,
  selected,
  now,
  onSelect,
}: {
  item: WorkItem
  occurrenceNumber: number
  branch: number | null
  step: number | null
  live: boolean
  selected: boolean
  now: number
  onSelect: () => void
}) {
  const duration = formatDuration(itemElapsedMs(item, live, now))
  const meta = itemMeta(item, { branch, step })
  return (
    <button
      type="button"
      className={css.overviewOccurrence}
      data-selected={selected ? '' : undefined}
      data-current={live ? '' : undefined}
      data-status={item.status}
      data-ud-motion="watcher-live-append"
      aria-current={live ? 'step' : undefined}
      aria-pressed={selected}
      aria-label={`记录 ${occurrenceNumber}，${item.title}，${meta}${duration === null ? '' : `，耗时 ${duration}`}，${STATUS_LABEL[item.status]}`}
      onClick={onSelect}
    >
      <span className={css.overviewOccurrenceIndex}>{String(occurrenceNumber).padStart(2, '0')}</span>
      <span className={css.overviewOccurrenceDotSlot} aria-hidden="true">
        <StatusMark status={item.status} className={css.overviewOccurrenceDot} />
      </span>
      <span className={css.overviewOccurrenceCopy}>
        <span className={css.overviewOccurrenceTitle}>{item.title}</span>
        <span className={css.overviewOccurrenceMeta}>{meta}</span>
      </span>
      {duration === null ? null : <span className={css.overviewOccurrenceDuration}>{duration}</span>}
      <IconChevronRightOutline14 size={12} className={css.overviewOccurrenceChevron} />
    </button>
  )
}

function PhaseOverview({
  group,
  isNow,
  running,
  now,
  selectedGroup,
  selectedItemId,
  observationMode,
  open,
  stepDisclosure,
  clusterDisclosure,
  modelDisclosure,
  reasoningDisclosure,
  onToggle,
  onToggleStep,
  onToggleCluster,
  onToggleModel,
  onToggleReasoning,
  onSelectItem,
}: {
  group: WorkGroup
  isNow: boolean
  running: boolean
  now: number
  selectedGroup: boolean
  selectedItemId: string | null
  observationMode: ObservationMode
  open: boolean
  stepDisclosure: Readonly<Record<string, boolean>>
  clusterDisclosure: Readonly<Record<string, boolean>>
  modelDisclosure: Readonly<Record<string, boolean>>
  reasoningDisclosure: Readonly<Record<string, boolean>>
  onToggle: () => void
  onToggleStep: (step: WorkStep, defaultOpen: boolean) => void
  onToggleCluster: (cluster: WorkCluster, defaultOpen: boolean) => void
  onToggleModel: (key: string, defaultOpen: boolean) => void
  onToggleReasoning: (key: string, defaultOpen: boolean, modelKey: string) => void
  onSelectItem: (item: WorkItem) => void
}) {
  const phaseState = overviewStateOf(group.status, isNow)
  const phaseDuration = formatDuration(groupElapsedMs(group, isNow && running, now))
  const phaseSummary = [
    `${group.steps.length} 个步骤`,
    `${group.executionCount} 次执行`,
    phaseDuration,
  ].filter((part): part is string => part !== null).join(' · ')
  const latestItemId = group.items.at(-1)?.id ?? null
  const clusters = clusterWorkItems(group.items.filter(item => item.source !== 'model'))
  const latestClusterId = clusters.at(-1)?.id ?? null
  const modelSteps = group.steps.filter((step): step is WorkStep & { model: ModelStepTrace } => step.model !== null)
  const groupedModelsKey = `${group.id}:model-list`
  const groupedModelsDefaultOpen = isNow && running
  const groupedModelsOpen = modelDisclosure[groupedModelsKey] ?? groupedModelsDefaultOpen

  return (
    <section
      className={css.phase}
      data-selected={selectedGroup ? '' : undefined}
      data-now={isNow ? '' : undefined}
      data-overview-state={phaseState}
      aria-label={`${group.title}，${phaseSummary}，${OVERVIEW_STATE_LABEL[phaseState]}`}
    >
      <header className={css.phaseHeader}>
        <button
          type="button"
          className={css.phaseToggle}
          aria-expanded={open}
          aria-controls={`watcher-phase-body-${group.id}`}
          aria-label={`${group.title}，${phaseSummary}，${open ? '收起阶段' : '展开阶段'}`}
          onClick={onToggle}
        >
          <span className={css.phaseMarker} data-state={phaseState} aria-hidden="true" />
          <IconChevronRightOutline14 size={12} className={css.phaseChevron} />
          <span className={css.phaseCopy}>
            <span className={css.phaseTitleLine}>
              <span className={css.phaseTitle} data-watcher-group-title="">{group.title}</span>
              {groupBadges(group)}
              {showOverviewTag(phaseState)
                ? <span className={css.overviewTag} data-state={phaseState}>{OVERVIEW_STATE_LABEL[phaseState]}</span>
                : null}
            </span>
            <span className={css.phaseMeta}>{phaseSummary}</span>
          </span>
        </button>
      </header>

      <div id={`watcher-phase-body-${group.id}`} hidden={!open}>
        {observationMode === 'itemized'
          ? (
            <div className={css.stepTimeline} data-observation-mode="itemized">
              {group.steps.map(step => {
                const stepLive = isNow && running && step.items.some(item => item.id === latestItemId && item.status === 'running')
                const stepDuration = formatDuration(stepElapsedMs(step, stepLive, now))
                const stepOpen = stepDisclosure[step.id] ?? true
                const modelMetrics = step.model === null ? null : modelStageMetrics(step.model, now)
                const modelDuration = formatDuration(modelMetrics?.totalMs ?? null)
                const showStepTotal = stepDuration !== null && stepDuration !== modelDuration
                const modelDefaultOpen = modelMetrics?.live === true
                const modelOpen = modelDisclosure[step.id] ?? modelDefaultOpen
                const timelineEntries = stepTimelineEntries(step)
                return (
                  <section
                    key={step.id}
                    className={css.overviewStep}
                    data-current={stepLive ? '' : undefined}
                    data-parallel={step.parallel ? '' : undefined}
                  >
                    <header className={css.overviewStepHeader}>
                      <button
                        type="button"
                        className={css.stepToggle}
                        aria-expanded={stepOpen}
                        aria-controls={`watcher-step-body-${step.id}`}
                        aria-label={`步骤 ${step.step || '—'}，${step.executionCount} 次执行${stepDuration === null ? '' : `，耗时 ${stepDuration}`}，${stepOpen ? '收起步骤' : '展开步骤'}`}
                        onClick={() => onToggleStep(step, stepOpen)}
                      >
                        <IconChevronRightOutline14 size={11} className={css.stepChevron} />
                        <span className={css.overviewStepLabel}>步骤 {step.step || '—'}</span>
                        <span className={css.overviewStepSignals}>
                          {step.executionCount > 0 ? <span>{step.executionCount} 次</span> : null}
                          {step.parallel ? <span className={css.parallelLabel}>{step.executionCount} 项并行</span> : null}
                          {modelDuration === null ? null : <span>模型 {modelDuration}</span>}
                          {showStepTotal ? <span>总 {stepDuration}</span> : null}
                        </span>
                      </button>
                    </header>
                    <div id={`watcher-step-body-${step.id}`} className={css.overviewOccurrences} hidden={!stepOpen}>
                      {timelineEntries.map(entry => {
                        if (entry.kind === 'model') {
                          return (
                            <ModelStage
                              key={`model:${step.id}`}
                              trace={entry.trace}
                              stepId={step.id}
                              now={now}
                              open={modelOpen}
                              reasoningDisclosure={reasoningDisclosure}
                              onToggle={() => onToggleModel(step.id, modelOpen)}
                              onToggleReasoning={(key, defaultOpen) => onToggleReasoning(key, defaultOpen, step.id)}
                            />
                          )
                        }

                        const item = entry.item
                        return (
                          <OverviewOccurrenceButton
                            key={item.id}
                            item={item}
                            occurrenceNumber={group.items.findIndex(candidate => candidate.id === item.id) + 1}
                            branch={step.parallel ? entry.occurrenceIndex + 1 : null}
                            step={null}
                            live={stepLive && item.id === latestItemId && item.status === 'running'}
                            selected={selectedGroup && selectedItemId === item.id}
                            now={now}
                            onSelect={() => onSelectItem(item)}
                          />
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
          )
          : (
            <div className={css.analysisClusters} data-observation-mode="grouped">
              {modelSteps.length === 0
                ? null
                : (
                  <section className={css.groupedModelStages} data-open={groupedModelsOpen ? '' : undefined}>
                    <button
                      type="button"
                      className={css.groupedModelToggle}
                      aria-expanded={groupedModelsOpen}
                      aria-controls={`watcher-grouped-models-${group.id}`}
                      onClick={() => onToggleModel(groupedModelsKey, groupedModelsOpen)}
                    >
                      <IconChevronRightOutline14 size={11} className={css.groupedModelChevron} />
                      <span>
                        <strong>模型阶段汇总</strong>
                        <small>{modelSteps.length} 个 Step · 按 Step 保留，不合并推理</small>
                      </span>
                    </button>
                    <div
                      id={`watcher-grouped-models-${group.id}`}
                      className={css.groupedModelList}
                      hidden={!groupedModelsOpen}
                    >
                      {modelSteps.map(step => {
                        const metrics = modelStageMetrics(step.model, now)
                        const defaultOpen = metrics.live
                        const modelOpen = modelDisclosure[step.id] ?? defaultOpen
                        return (
                          <div key={step.id} className={css.groupedModelStep}>
                            <span className={css.groupedModelStepLabel}>步骤 {step.step || '—'}</span>
                            <ModelStage
                              trace={step.model}
                              stepId={`${step.id}:grouped`}
                              now={now}
                              open={modelOpen}
                              reasoningDisclosure={reasoningDisclosure}
                              onToggle={() => onToggleModel(step.id, modelOpen)}
                              onToggleReasoning={(key, defaultOpen) => onToggleReasoning(key, defaultOpen, step.id)}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </section>
                )}
              {clusters.map(cluster => {
                if (cluster.executionCount === 1) {
                  const item = cluster.items[0]
                  const sourceStep = group.steps.find(step => step.items.some(candidate => candidate.id === item.id))
                  const branch = sourceStep === undefined ? null : branchNumberOf(sourceStep, item)
                  return (
                    <div key={cluster.id} className={css.analysisSingleton}>
                      <OverviewOccurrenceButton
                        item={item}
                        occurrenceNumber={group.items.findIndex(candidate => candidate.id === item.id) + 1}
                        branch={branch}
                        step={item.step}
                        live={isNow && running && item.id === latestItemId && item.status === 'running'}
                        selected={selectedGroup && selectedItemId === item.id}
                        now={now}
                        onSelect={() => onSelectItem(item)}
                      />
                    </div>
                  )
                }
                const defaultOpen = isNow && cluster.id === latestClusterId
                const clusterOpen = clusterDisclosure[cluster.id] ?? defaultOpen
                const basisLabel = clusterBasisLabel(cluster)
                const outcome = clusterOutcomeSummary(cluster)
                const clusterMeta = [
                  basisLabel,
                  `${cluster.executionCount} 次执行`,
                  `${cluster.stepCount} 个步骤`,
                  outcome,
                ].filter((part): part is string => part !== null && part !== '').join(' · ')
                return (
                  <section key={cluster.id} className={css.analysisCluster} data-open={clusterOpen ? '' : undefined}>
                    <button
                      type="button"
                      className={css.analysisClusterToggle}
                      aria-expanded={clusterOpen}
                      aria-controls={`watcher-cluster-body-${cluster.id}`}
                      aria-label={`${cluster.title}，${clusterMeta}，${clusterOpen ? '收起同类执行' : '展开同类执行'}`}
                      onClick={() => onToggleCluster(cluster, clusterOpen)}
                    >
                      <IconChevronRightOutline14 size={11} className={css.analysisClusterChevron} />
                      <span className={css.analysisClusterDotSlot} aria-hidden="true">
                        <StatusMark status={cluster.latestStatus} className={css.analysisClusterDot} />
                      </span>
                      <span className={css.analysisClusterCopy}>
                        <span className={css.analysisClusterTitle}>{cluster.title}</span>
                        <span className={css.analysisClusterMeta}>{clusterMeta}</span>
                      </span>
                      {cluster.executionCount > 1
                        ? <span className={css.analysisClusterCount}>×{cluster.executionCount}</span>
                        : null}
                    </button>
                    <div
                      id={`watcher-cluster-body-${cluster.id}`}
                      className={css.analysisClusterItems}
                      hidden={!clusterOpen}
                    >
                      {cluster.items.map(item => {
                        const sourceStep = group.steps.find(step => step.items.some(candidate => candidate.id === item.id))
                        const branch = sourceStep === undefined ? null : branchNumberOf(sourceStep, item)
                        return (
                          <OverviewOccurrenceButton
                            key={item.id}
                            item={item}
                            occurrenceNumber={group.items.findIndex(candidate => candidate.id === item.id) + 1}
                            branch={branch}
                            step={item.step}
                            live={isNow && running && item.id === latestItemId && item.status === 'running'}
                            selected={selectedGroup && selectedItemId === item.id}
                            now={now}
                            onSelect={() => onSelectItem(item)}
                          />
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
          )}
      </div>
    </section>
  )
}

/** Native session-header utility: exact work picture, typed evidence, no steering. */
export function Watcher({ useSession, useSessions, useProjection, sessionId, loadAllHistory }: WatcherProps) {
  const running = useSessions(list => Boolean(list.byId[sessionId]?.running))
  const snapshot = useSession((state: ConversationSnapshot) => state)
  const wholeSessionStats = useProjection('sessionStats')
  const snapshotPicture = useMemo(() => foldSnapshot(snapshot, { running }), [snapshot, running])
  const observedRef = useRef<{ sessionId: string; picture: typeof snapshotPicture } | null>(null)
  const picture = useMemo(() => {
    const previous = observedRef.current?.sessionId === sessionId
      ? observedRef.current.picture
      : null
    const next = previous === null ? snapshotPicture : mergeObservedPictures(previous, snapshotPicture)
    observedRef.current = { sessionId, picture: next }
    return next
  }, [sessionId, snapshotPicture])
  const performanceByTurn = useMemo(
    () => deriveTurnPerformance(snapshot.nodes, picture.turns),
    [snapshot.nodes, picture.turns],
  )
  const lastGroup = picture.nodes.at(-1)
  const lastGroupId = lastGroup?.id ?? null
  const lastItem = lastGroup?.items.at(-1)
  const latestActivityKey = lastItem === undefined
    ? lastGroupId
    : `${lastGroupId}:${lastItem.id}:${lastItem.seq}:${lastItem.status}:${lastItem.resultSeq ?? 'open'}:${lastItem.resultTime ?? 'open'}`
  const [open, setOpen] = useState(false)
  const [ui, setUi] = useState(() => ({ follow: true, unread: 0, selectedId: null as string | null }))
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [observationMode, setObservationMode] = useState<ObservationMode>('itemized')
  const [turnDisclosure, setTurnDisclosure] = useState(createTurnDisclosureState)
  const [phaseDisclosure, setPhaseDisclosure] = useState<Record<string, boolean>>({})
  const [stepDisclosure, setStepDisclosure] = useState<Record<string, boolean>>({})
  const [clusterDisclosure, setClusterDisclosure] = useState<Record<string, boolean>>({})
  const [modelDisclosure, setModelDisclosure] = useState<Record<string, boolean>>({})
  const [reasoningDisclosure, setReasoningDisclosure] = useState<Record<string, boolean>>({})
  const [historyLoad, setHistoryLoad] = useState<HistoryLoadState>({ kind: 'idle' })
  const now = useLiveClock(open && picture.running)
  const sessionTiming = deriveSessionTiming(picture, now)
  const followRef = useRef(createFollow())
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const programmaticScrollRef = useRef(false)
  const historyAbortRef = useRef<AbortController | null>(null)
  const panelPosition = useAnchoredPosition({
    open,
    anchorRef: triggerRef,
    panelRef,
    gap: PANEL_GAP,
    margin: PANEL_MARGIN,
  })

  // The panel is portaled out of the conversation header so it can sit above
  // the sticky composer and every shell column. Outside dismissal therefore
  // has to test the in-place trigger and the portaled surface independently.
  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return
      if (rootRef.current?.contains(event.target) === true) return
      if (panelRef.current?.contains(event.target) === true) return
      setOpen(false)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  useLayoutEffect(() => {
    historyAbortRef.current?.abort()
    historyAbortRef.current = null
    setHistoryLoad({ kind: 'idle' })
    followRef.current.reset()
    setUi(followRef.current.snapshot())
    setSelectedItemId(null)
    setTurnDisclosure(resetTurnDisclosureOverrides)
    setPhaseDisclosure({})
    setStepDisclosure({})
    setClusterDisclosure({})
    setModelDisclosure({})
    setReasoningDisclosure({})
  }, [sessionId])

  useEffect(() => () => {
    historyAbortRef.current?.abort()
  }, [])

  useLayoutEffect(() => {
    setUi(followRef.current.onPicture(picture))
  }, [latestActivityKey])

  useLayoutEffect(() => {
    const rail = railRef.current
    if (!rail || !open || !ui.follow) return
    programmaticScrollRef.current = true
    rail.scrollTop = rail.scrollHeight
    const frame = requestAnimationFrame(() => {
      programmaticScrollRef.current = false
    })
    return () => {
      cancelAnimationFrame(frame)
      programmaticScrollRef.current = false
    }
  }, [ui.follow, latestActivityKey, observationMode, open])

  const selected = ui.selectedId === null ? undefined : picture.nodes.find(group => group.id === ui.selectedId)
  const latestTurnNumber = picture.turns.at(-1)?.turn ?? null
  const totalTurnCount = Math.max(picture.turnCount, wholeSessionStats?.turns ?? 0)
  const totalStepCount = Math.max(picture.stepCount, wholeSessionStats?.steps ?? 0)
  const historyProgress = totalStepCount > picture.stepCount
    ? `${picture.stepCount}/${totalStepCount} 个步骤`
    : totalTurnCount > picture.turnCount
      ? `${picture.turnCount}/${totalTurnCount} 个对话轮次`
      : `${picture.stepCount} 个步骤已载入`
  const nowLabel = picture.now.label || (picture.nodes.length > 0 ? '整理工作路径' : '等待第一步')
  const hasEdgeAlert = picture.pendingCount > 0
    || picture.now.status === 'failure'
    || picture.now.status === 'interrupted'
  const summaryState = picture.pendingCount > 0
    ? '等待你'
    : picture.running
      ? '正在执行'
      : picture.now.status === 'failure'
        ? '最近一步失败'
        : picture.now.status === 'interrupted'
          ? '已中断'
          : picture.nodes.length > 0 ? '已停稳' : '等待任务'

  const selectItem = (group: WorkGroup, item: WorkItem) => {
    setUi(followRef.current.onSelect(group.id))
    setSelectedItemId(item.id)
  }

  const onRailScroll = () => {
    if (programmaticScrollRef.current) return
    const rail = railRef.current
    if (rail === null) return
    const atBottom = rail.scrollHeight - rail.scrollTop - rail.clientHeight < 24
    setUi(followRef.current.onScroll({ atBottom }))
  }

  const backToLatest = () => {
    programmaticScrollRef.current = true
    setUi(followRef.current.backToLatest())
  }

  const pinForDisclosure = () => {
    if (ui.follow) setUi(followRef.current.setFollow(false))
  }

  const chooseObservationMode = (mode: ObservationMode) => {
    if (mode === observationMode) return
    if (ui.follow) programmaticScrollRef.current = true
    setObservationMode(mode)
  }

  const startHistoryLoad = () => {
    if (historyLoad.kind === 'loading' || historyLoad.kind === 'complete') return
    historyAbortRef.current?.abort()
    const controller = new AbortController()
    historyAbortRef.current = controller
    setHistoryLoad({ kind: 'loading' })
    void loadAllHistory(controller.signal).then((result) => {
      if (historyAbortRef.current !== controller) return
      if (result.kind === 'blocked') {
        const message = result.reason === 'busy'
          ? '主会话正在载入历史，请稍后重试'
          : result.reason === 'page-limit'
            ? '历史页数超出安全上限，请分次重试'
            : '历史分页没有继续前进，请重试'
        setHistoryLoad({ kind: 'error', message })
      } else if (result.kind === 'complete') {
        // Keep a short terminal state until React observes the final Session
        // page. This prevents a stale `hasMore` render from starting the loop
        // a second time after the official loader has already reached page 1.
        setHistoryLoad({ kind: 'complete' })
      } else {
        setHistoryLoad({ kind: 'idle' })
      }
    }).catch((error: unknown) => {
      if (historyAbortRef.current !== controller || controller.signal.aborted) return
      setHistoryLoad({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }).finally(() => {
      if (historyAbortRef.current === controller) historyAbortRef.current = null
    })
  }

  useEffect(() => {
    if (!open || !snapshot.hasMore || historyLoad.kind !== 'idle') return
    startHistoryLoad()
  }, [open, snapshot.hasMore, historyLoad.kind, sessionId])

  useEffect(() => {
    if (historyLoad.kind !== 'complete' || snapshot.hasMore) return
    setHistoryLoad({ kind: 'idle' })
  }, [historyLoad.kind, snapshot.hasMore])

  return (
    <div ref={rootRef} className={css.root} data-dsh-watcher="header">
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        data-open={open ? '' : undefined}
        data-live={picture.running && picture.nodes.length > 0 ? '' : undefined}
        data-alert={hasEdgeAlert ? '' : undefined}
        aria-expanded={open}
        aria-label={`Watcher，${summaryState}`}
        title="Watcher"
        onClick={() => setOpen(value => !value)}
      >
        <IconLivingEye />
      </button>

      {open
        ? createPortal(
          <div
            ref={panelRef}
            className={css.menu}
            style={panelPosition ?? UNPLACED_PANEL_STYLE}
            role="dialog"
            aria-modal="false"
            aria-label="Watcher 工作图"
            data-dsh-watcher-panel=""
            data-ud-motion="watcher-panel-enter"
          >
            {selected === undefined
              ? null
              : (
                <ExecutionInspector
                  group={selected}
                  selectedItemId={selectedItemId}
                  live={picture.running && selected.id === lastGroupId}
                  now={now}
                  onSelectItem={setSelectedItemId}
                  onBack={() => {
                    backToLatest()
                    setSelectedItemId(null)
                  }}
                />
              )}

            <section className={css.workPicture} aria-label="Agent 工作路径" data-ud-check="watcher-work-picture" data-ud-role="panel">
              <header className={css.pictureHeader}>
                <div className={css.nowBlock} aria-live="polite">
                  <div className={css.eyebrow} data-alert={hasEdgeAlert ? '' : undefined}>
                    <span>{summaryState}</span>
                  </div>
                  <div className={css.now} title={nowLabel}>{nowLabel}</div>
                  <div className={css.summary}>
                    <span>
                      {snapshot.hasMore && totalTurnCount > picture.turnCount
                        ? `已载入 ${picture.turnCount}/${totalTurnCount} 个对话轮次`
                        : `${picture.turnCount} 个对话轮次`}
                    </span>
                    <span>
                      {snapshot.hasMore && totalStepCount > picture.stepCount
                        ? `${picture.stepCount}/${totalStepCount} 个步骤`
                        : `${picture.stepCount} 个步骤`}
                    </span>
                    <span>{picture.actionCount} 次执行</span>
                    {snapshot.hasMore ? <span data-partial="">仅最近历史</span> : null}
                  </div>
                </div>
                <Pill
                  className={css.follow}
                  active={ui.follow}
                  aria-pressed={ui.follow}
                  aria-label={ui.follow ? '停止跟随最新工作' : '跟随最新工作'}
                  onClick={() => {
                    if (!ui.follow) programmaticScrollRef.current = true
                    setUi(followRef.current.setFollow(!ui.follow))
                  }}
                >
                  <IconRefreshOutline14 size={12} />
                  {ui.follow ? '自动跟随' : '浏览历史'}
                </Pill>
              </header>

              <SessionTimeLedger timing={sessionTiming} />

              <div className={css.viewToolbar} aria-label="观察方式">
                <span className={css.viewToolbarLabel}>观察方式</span>
                <div className={css.viewMode} role="group" aria-label="工作路径观察方式">
                  <button
                    type="button"
                    data-active={observationMode === 'itemized' ? '' : undefined}
                    aria-pressed={observationMode === 'itemized'}
                    title="按时间顺序展示每个步骤和每次执行"
                    onClick={() => chooseObservationMode('itemized')}
                  >
                    逐项
                  </button>
                  <button
                    type="button"
                    data-active={observationMode === 'grouped' ? '' : undefined}
                    aria-pressed={observationMode === 'grouped'}
                    title="按同一目标或完全相同的指令归类，展开仍可查看原始执行"
                    onClick={() => chooseObservationMode('grouped')}
                  >
                    归类
                  </button>
                </div>
                <button
                  type="button"
                  className={css.turnOverviewToggle}
                  data-active={turnDisclosure.mode === 'macro' ? '' : undefined}
                  aria-pressed={turnDisclosure.mode === 'macro'}
                  title={turnDisclosure.mode === 'macro'
                    ? '退出轮次概览，恢复自动展开最新轮次'
                    : '收起所有轮次；新进展和未来轮次也保持收起'}
                  onClick={() => {
                    pinForDisclosure()
                    setTurnDisclosure(current => chooseTurnDisclosureMode(
                      current.mode === 'macro' ? 'automatic' : 'macro',
                    ))
                  }}
                >
                  轮次概览
                </button>
                <span className={css.viewModeHint}>
                  {turnDisclosure.mode === 'macro'
                    ? '新进展保持收起'
                    : observationMode === 'itemized' ? '完整时间线' : '可展开原始记录'}
                </span>
              </div>

              {snapshot.hasMore || historyLoad.kind === 'loading'
                ? (
                  <div className={css.historyNotice} data-state={historyLoad.kind} role="status" aria-live="polite">
                    <span className={css.historyNoticeCopy}>
                      <strong>
                        {historyLoad.kind === 'loading'
                          ? '正在补齐历史'
                          : historyLoad.kind === 'error'
                            ? '历史载入受阻'
                            : historyLoad.kind === 'complete'
                              ? '历史已补齐'
                              : '准备补齐历史'}
                      </strong>
                      <span>
                        {historyLoad.kind === 'loading'
                          ? `已载入 ${historyProgress}`
                          : historyLoad.kind === 'error'
                            ? historyLoad.message
                            : historyLoad.kind === 'complete'
                              ? `已载入 ${historyProgress}`
                              : `当前 ${historyProgress}，即将自动载入更早记录`}
                      </span>
                    </span>
                    {historyLoad.kind === 'error'
                      ? (
                        <button
                          type="button"
                          onClick={startHistoryLoad}
                          title="通过 RC8 官方会话分页重试补齐更早历史"
                        >
                          重试载入
                        </button>
                      )
                      : null}
                  </div>
                )
                : null}

              {!ui.follow && ui.unread > 0
                ? (
                  <button type="button" className={css.unread} onClick={backToLatest}>
                    <IconRefreshOutline14 size={12} />
                    {ui.unread} 条新进展 · 查看最新
                  </button>
                )
                : null}

              {picture.nodes.length === 0
                ? (
                  <div className={css.empty}>
                    <span className={css.emptyEye} aria-hidden="true"><IconLivingEye size={22} /></span>
                    <strong>还没有工作记录</strong>
                    <span>第一轮对话开始后，路径会从这里生长</span>
                  </div>
                )
                : (
                  <div ref={railRef} className={css.railViewport} onScroll={onRailScroll}>
                    <div className={css.turns}>
                      {picture.turns.map(turn => {
                        const isLatestTurn = turn.turn === latestTurnNumber
                        const turnState = overviewStateOf(turn.status, isLatestTurn)
                        const automaticDefaultOpen = turnNeedsDefaultDisclosure(turnState, isLatestTurn)
                        const turnOpen = turnDisclosureOpen(turnDisclosure, turn.turn, automaticDefaultOpen)
                        const turnTitle = turn.turn === 0 ? '会话准备' : `对话轮次 ${turn.turn}`
                        const turnSummary = turnOverviewSummary(turn)
                        const performance = performanceByTurn.get(turn.turn)
                        const isLiveTurn = isLatestTurn && picture.running
                        const duration = turnDuration(turn, isLiveTurn, now)
                        const tokenSpeed = performance?.throughput.kind === 'measured'
                          ? `${formatTokensPerSecond(performance.throughput.tokensPerSecond)} tok/s`
                          : null
                        const durationAria = duration === null
                          ? ''
                          : duration.kind === 'exact'
                            ? `，总耗时 ${duration.value}`
                            : `，已记录 ${duration.value}，开头未载入`
                        const secondaryPerformance = [
                          duration?.kind === 'partial' ? '开头未载入' : null,
                          tokenSpeed,
                        ].filter((value): value is string => value !== null).join(' · ')
                        return (
                          <section key={turn.turn} className={css.turn} aria-labelledby={`watcher-turn-${turn.turn}`}>
                            <header className={css.turnHeader}>
                              <h2 id={`watcher-turn-${turn.turn}`}>
                                <button
                                  type="button"
                                  className={css.turnToggle}
                                  aria-expanded={turnOpen}
                                  aria-controls={`watcher-turn-body-${turn.turn}`}
                                  aria-label={`${turnTitle}，${OVERVIEW_STATE_LABEL[turnState]}，${turnSummary}${durationAria}${tokenSpeed === null ? '' : `，生成速度 ${tokenSpeed}`}，${turnOpen ? '收起轮次' : '展开轮次'}`}
                                  title={turnOpen ? '收起此轮次；新进展仍会继续更新' : '展开此轮次'}
                                  onClick={() => {
                                    pinForDisclosure()
                                    setTurnDisclosure(current => toggleTurnDisclosure(
                                      current,
                                      turn.turn,
                                      automaticDefaultOpen,
                                    ))
                                  }}
                                >
                                  <IconChevronRightOutline14 size={13} className={css.turnChevron} />
                                      <span className={css.turnCopy}>
                                        <span className={css.turnTitleLine}>
                                          <span className={css.turnTitle}>{turnTitle}</span>
                                          {showOverviewTag(turnState)
                                            ? <span className={css.overviewTag} data-state={turnState}>{OVERVIEW_STATE_LABEL[turnState]}</span>
                                            : null}
                                    </span>
                                    <span className={css.turnSummary}>{turnSummary}</span>
                                  </span>
                                  <span className={css.turnPerformance}>
                                    <span className={css.turnDuration}>
                                      {duration === null
                                        ? OVERVIEW_STATE_LABEL[turnState]
                                        : duration.kind === 'exact'
                                          ? `总 ${duration.value}`
                                          : `已记录 ${duration.value}`}
                                    </span>
                                    {secondaryPerformance === '' ? null : <span className={css.turnSpeed}>{secondaryPerformance}</span>}
                                  </span>
                                </button>
                              </h2>
                            </header>
                            <div id={`watcher-turn-body-${turn.turn}`} className={css.turnBody} hidden={!turnOpen}>
                              {performance === undefined ? null : <TurnMetricStrip performance={performance} />}
                              <div className={css.groupRail}>
                                <span className={css.railLine} aria-hidden="true" />
                                {turn.groups.map(group => {
                                  const isNow = group.id === lastGroupId
                                  const selectedGroup = ui.selectedId === group.id
                                  const phaseOpen = phaseDisclosure[group.id] ?? true
                                  return (
                                    <PhaseOverview
                                      key={group.id}
                                      group={group}
                                      isNow={isNow}
                                      running={picture.running}
                                      now={now}
                                      selectedGroup={selectedGroup}
                                      selectedItemId={selectedItemId}
                                      observationMode={observationMode}
                                      open={phaseOpen}
                                      stepDisclosure={stepDisclosure}
                                      clusterDisclosure={clusterDisclosure}
                                      modelDisclosure={modelDisclosure}
                                      reasoningDisclosure={reasoningDisclosure}
                                      onToggle={() => {
                                        pinForDisclosure()
                                        setPhaseDisclosure(current => ({ ...current, [group.id]: !phaseOpen }))
                                      }}
                                      onToggleStep={(step, defaultOpen) => {
                                        pinForDisclosure()
                                        setStepDisclosure(current => ({ ...current, [step.id]: !defaultOpen }))
                                      }}
                                      onToggleCluster={(cluster, defaultOpen) => {
                                        pinForDisclosure()
                                        setClusterDisclosure(current => ({ ...current, [cluster.id]: !defaultOpen }))
                                      }}
                                      onToggleModel={(key, defaultOpen) => {
                                        pinForDisclosure()
                                        setModelDisclosure(current => ({ ...current, [key]: !defaultOpen }))
                                      }}
                                      onToggleReasoning={(key, defaultOpen, modelKey) => {
                                        pinForDisclosure()
                                        if (!defaultOpen) {
                                          // Opening a nested reasoning record is explicit reading intent.
                                          // Keep its parent open when the live model settles and its
                                          // automatic default changes from open to closed.
                                          setModelDisclosure(current => ({ ...current, [modelKey]: true }))
                                        }
                                        setReasoningDisclosure(current => ({ ...current, [key]: !defaultOpen }))
                                      }}
                                      onSelectItem={item => selectItem(group, item)}
                                    />
                                  )
                                })}
                              </div>
                            </div>
                          </section>
                        )
                      })}
                    </div>
                  </div>
                )}
            </section>
          </div>,
          document.body,
        )
        : null}
    </div>
  )
}
