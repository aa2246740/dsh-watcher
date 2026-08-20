import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
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
import {
  foldSnapshot,
  type WorkGroup,
  type WorkItem,
  type WorkPresentation,
  type WorkStatus,
  type WorkTurn,
} from '../observation/fold.ts'
import css from './Watcher.module.css'
import {
  OVERVIEW_STATE_LABEL,
  groupOverviewSummary,
  overviewStateOf,
  turnNeedsDefaultDisclosure,
  turnOverviewSummary,
} from '../hub/overview.ts'

export type WatcherProps = PropsRuntime<'conversation.session.header.utilities'>

type DetailTab = 'result' | 'input' | 'raw'

const PANEL_GAP = 8
const PANEL_MARGIN = 12
const UNPLACED_PANEL_STYLE: CSSProperties = { visibility: 'hidden', left: 0, top: 0 }
const MARKDOWN_CODE_LABELS = Object.freeze({ copyLabel: '复制', copiedLabel: '已复制' })

const STATUS_LABEL: Record<WorkStatus, string> = {
  running: '进行中',
  waiting: '等待用户',
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
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)} s`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round((durationMs % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

function turnDuration(turn: WorkTurn): string | null {
  if (turn.startTime === null || turn.endTime === null) return null
  return formatDuration(Math.max(0, turn.endTime - turn.startTime))
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
  onSelectItem,
  onBack,
}: {
  group: WorkGroup
  selectedItemId: string | null
  onSelectItem: (id: string) => void
  onBack: () => void
}) {
  const [tab, setTab] = useState<DetailTab>('result')
  const fallback = preferredItem(group)
  const selected = group.items.find(item => item.id === selectedItemId) ?? fallback

  useEffect(() => setTab('result'), [group.id, selected?.id])

  if (selected === null) return null
  const duration = formatDuration(selected.durationMs)
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
          <span className={css.location}>回合 {group.turn || '—'} · {group.steps.length} 个步骤</span>
        </div>
        <h2 className={css.inspectorTitle}>{group.title}</h2>
        <p className={css.inspectorSummary}>{group.subtitle}</p>
        <div className={css.groupSignals} aria-label="工作模式">
          {group.parallelStepCount > 0 ? <span>并行 {group.parallelStepCount} 次</span> : null}
          {group.retryCount > 0 ? <span data-attention="">重试 {group.retryCount} 次</span> : null}
          {group.iterationCount > 0 ? <span>有 {group.iterationCount} 次迭代</span> : null}
          {group.unconfirmedFailureCount > 0 ? <span data-error="">{group.unconfirmedFailureCount} 条失败未确认恢复</span> : null}
        </div>
      </header>

      <div className={css.inspectorBody}>
        <section className={css.executionSection} aria-labelledby={`execution-title-${group.id}`}>
          <div className={css.sectionHeading}>
            <h3 id={`execution-title-${group.id}`}>执行路径</h3>
            <span>{group.items.length} 条记录</span>
          </div>
          <div className={css.executionList}>
            {group.steps.map(step => (
              <div key={step.id} className={css.stepBlock} data-parallel={step.parallel ? '' : undefined}>
                <div className={css.stepHeading}>
                  <span>Step {step.step || '—'}</span>
                  {step.parallel ? <span className={css.parallelLabel}>{step.executionCount} 项并行</span> : null}
                </div>
                <div className={css.occurrences}>
                  {step.items.map((item, itemIndex) => (
                    <button
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
                      <IconChevronRightOutline14 size={12} className={css.occurrenceChevron} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
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

/** Native session-header utility: exact work picture, typed evidence, no steering. */
export function Watcher({ useSession, useSessions, sessionId }: WatcherProps) {
  const running = useSessions(list => Boolean(list.byId[sessionId]?.running))
  const snapshot = useSession((state: ConversationSnapshot) => state)
  const picture = useMemo(() => foldSnapshot(snapshot, { running }), [snapshot, running])
  const lastId = picture.nodes.at(-1)?.id ?? null
  const [open, setOpen] = useState(false)
  const [ui, setUi] = useState(() => ({ follow: true, unread: 0, selectedId: null as string | null }))
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [turnDisclosure, setTurnDisclosure] = useState<Record<number, boolean>>({})
  const followRef = useRef(createFollow())
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
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
    followRef.current.reset()
    setUi(followRef.current.snapshot())
    setSelectedItemId(null)
    setTurnDisclosure({})
  }, [sessionId])

  useLayoutEffect(() => {
    setUi(followRef.current.onPicture(picture))
  }, [lastId])

  useLayoutEffect(() => {
    const rail = railRef.current
    if (!rail || !open || !ui.follow) return
    rail.scrollTop = rail.scrollHeight
  }, [ui.follow, lastId, open])

  const selected = ui.selectedId === null ? undefined : picture.nodes.find(group => group.id === ui.selectedId)
  const latestTurnNumber = picture.turns.at(-1)?.turn ?? null
  const nowLabel = picture.now.label || (picture.nodes.length > 0 ? '整理工作路径' : '等待第一步')
  const needsAttention = picture.pendingCount > 0
    || picture.now.status === 'failure'
    || picture.now.status === 'interrupted'
  const summaryState = picture.pendingCount > 0
    ? '等待用户'
    : picture.running
      ? '工作进行中'
      : picture.now.status === 'failure'
        ? '最近一步失败'
        : picture.now.status === 'interrupted'
          ? '工作已中断'
          : picture.nodes.length > 0 ? '工作已停稳' : '等待第一步'

  const selectGroup = (group: WorkGroup) => {
    setUi(followRef.current.onSelect(group.id))
    setSelectedItemId(preferredItem(group)?.id ?? null)
  }

  const onRailScroll = () => {
    const rail = railRef.current
    if (rail === null) return
    const atBottom = rail.scrollHeight - rail.scrollTop - rail.clientHeight < 24
    setUi(followRef.current.onScroll({ atBottom }))
  }

  return (
    <div ref={rootRef} className={css.root} data-dsh-watcher="header">
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        data-open={open ? '' : undefined}
        data-live={picture.running && picture.nodes.length > 0 ? '' : undefined}
        data-attention={needsAttention ? '' : undefined}
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
                  onSelectItem={setSelectedItemId}
                  onBack={() => {
                    setUi(followRef.current.backToLatest())
                    setSelectedItemId(null)
                  }}
                />
              )}

            <section className={css.workPicture} aria-label="Agent 工作路径" data-ud-check="watcher-work-picture" data-ud-role="panel">
              <header className={css.pictureHeader}>
                <div className={css.nowBlock} aria-live="polite">
                  <div className={css.eyebrow} data-attention={needsAttention ? '' : undefined}>
                    <span>现在</span>
                    <span aria-hidden="true">·</span>
                    <span>{summaryState}</span>
                  </div>
                  <div className={css.now} title={nowLabel}>{nowLabel}</div>
                  <div className={css.summary}>
                    <span>{picture.turnCount} 个回合</span>
                    <span>{picture.actionCount} 次执行</span>
                    {picture.partialHistory ? <span data-partial="">仅当前窗口</span> : null}
                  </div>
                </div>
                <Pill
                  className={css.follow}
                  active={ui.follow}
                  aria-pressed={ui.follow}
                  aria-label={ui.follow ? '停止跟随最新工作' : '跟随最新工作'}
                  onClick={() => setUi(followRef.current.setFollow(!ui.follow))}
                >
                  <IconRefreshOutline14 size={12} />
                  {ui.follow ? '跟随' : '已固定'}
                </Pill>
              </header>

              {!ui.follow && ui.unread > 0
                ? (
                  <button type="button" className={css.unread} onClick={() => setUi(followRef.current.backToLatest())}>
                    <IconRefreshOutline14 size={12} />
                    新增 {ui.unread} 段工作 · 回到最新
                  </button>
                )
                : null}

              {picture.nodes.length === 0
                ? (
                  <div className={css.empty}>
                    <span className={css.emptyEye} aria-hidden="true"><IconLivingEye size={22} /></span>
                    <strong>还没有工作记录</strong>
                    <span>第一个回合开始后，路径会从这里生长</span>
                  </div>
                )
                : (
                  <div ref={railRef} className={css.railViewport} onScroll={onRailScroll}>
                    <div className={css.turns}>
                      {picture.turns.map(turn => {
                        const isLatestTurn = turn.turn === latestTurnNumber
                        const turnState = overviewStateOf(turn.status, isLatestTurn)
                        const defaultOpen = turnNeedsDefaultDisclosure(turnState, isLatestTurn)
                        const turnOpen = turnDisclosure[turn.turn] ?? defaultOpen
                        const turnTitle = turn.turn === 0 ? '会话准备' : `回合 ${turn.turn}`
                        const turnSummary = turnOverviewSummary(turn)
                        const duration = turnDuration(turn)
                        return (
                          <section key={turn.turn} className={css.turn} aria-labelledby={`watcher-turn-${turn.turn}`}>
                            <header className={css.turnHeader}>
                              <h2 id={`watcher-turn-${turn.turn}`}>
                                <button
                                  type="button"
                                  className={css.turnToggle}
                                  aria-expanded={turnOpen}
                                  aria-controls={`watcher-turn-body-${turn.turn}`}
                                  aria-label={`${turnTitle}，${OVERVIEW_STATE_LABEL[turnState]}，${turnSummary}${duration === null ? '' : `，${duration}`}`}
                                  onClick={() => setTurnDisclosure(current => ({
                                    ...current,
                                    [turn.turn]: !(current[turn.turn] ?? defaultOpen),
                                  }))}
                                >
                                  <IconChevronRightOutline14 size={13} className={css.turnChevron} />
                                  <span className={css.turnCopy}>
                                    <span className={css.turnTitleLine}>
                                      <span className={css.turnTitle}>{turnTitle}</span>
                                      {turnState === 'settled'
                                        ? null
                                        : <span className={css.overviewTag} data-state={turnState}>{OVERVIEW_STATE_LABEL[turnState]}</span>}
                                    </span>
                                    <span className={css.turnSummary}>{turnSummary}</span>
                                  </span>
                                  <span className={css.turnDuration}>{duration ?? OVERVIEW_STATE_LABEL[turnState]}</span>
                                </button>
                              </h2>
                            </header>
                            <div id={`watcher-turn-body-${turn.turn}`} className={css.turnBody} hidden={!turnOpen}>
                              <div className={css.groupRail}>
                                <span className={css.railLine} aria-hidden="true" />
                                {turn.groups.map(group => {
                                  const isNow = group.id === lastId
                                  const selectedGroup = ui.selectedId === group.id
                                  const phaseState = overviewStateOf(group.status, isNow)
                                  const phaseSummary = groupOverviewSummary(group)
                                  const phaseSignals = [
                                    phaseSummary,
                                    group.parallelStepCount > 0 ? '包含并行' : '',
                                    group.retryCount > 0 ? `重试 ${group.retryCount} 次` : '',
                                    group.iterationCount > 0 ? `迭代 ${group.iterationCount} 次` : '',
                                  ].filter(Boolean).join('，')
                                  return (
                                    <button
                                      key={group.id}
                                      type="button"
                                      className={css.group}
                                      data-selected={selectedGroup ? '' : undefined}
                                      data-now={isNow ? '' : undefined}
                                      data-compact={phaseSummary === '' ? '' : undefined}
                                      data-overview-state={phaseState}
                                      data-ud-motion="watcher-selection"
                                      aria-current={isNow ? 'step' : undefined}
                                      aria-pressed={selectedGroup}
                                      aria-label={`${group.title}${phaseSignals === '' ? '' : `，${phaseSignals}`}，${OVERVIEW_STATE_LABEL[phaseState]}`}
                                      onClick={() => selectGroup(group)}
                                    >
                                      <span className={css.phaseMarker} data-state={phaseState} aria-hidden="true" />
                                      <span className={css.groupCopy}>
                                        <span className={css.groupTitleLine}>
                                          <span className={css.groupTitle} data-watcher-group-title="">{group.title}</span>
                                          {groupBadges(group)}
                                          {phaseState === 'settled'
                                            ? null
                                            : <span className={css.overviewTag} data-state={phaseState}>{OVERVIEW_STATE_LABEL[phaseState]}</span>}
                                        </span>
                                        {phaseSummary === '' ? null : <span className={css.groupMeta}>{phaseSummary}</span>}
                                      </span>
                                      <IconChevronRightOutline14 size={13} className={css.groupChevron} />
                                    </button>
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
