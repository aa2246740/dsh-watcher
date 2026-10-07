import { useMemo, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionPendingInteractionBase, SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createCompleteHistoryLoader } from './history-loader.ts'
import { WorkPicturePanel, useObservedPicture } from './Watcher.tsx'
import type { CompleteHistoryResult } from '../hub/history.ts'
import type { WatcherSnapshot } from '../observation/fold.ts'
import css from './Watcher.module.css'

/**
 * Minimal structural description of the optional `dsh-better-sidebar` tab
 * registration service (published as `ctx.betterSidebar`, see the peer's
 * `client/service.d.ts`). Declared locally on purpose: this package must
 * typecheck and build without the peer installed, so neither values nor types
 * may be imported from it. Semantics mirrored here: `registerTab` takes one
 * descriptor and returns a disposer that unregisters the tab type — hand it to
 * `ctx.effect` so hot reload cannot register it twice.
 */
export interface WatcherSidebarDescriptor {
  /** Unique tab type id; also the host tab's `type` value. */
  id: string
  title: string
  /** Single-instance sugar: opening the tab focuses an existing one. */
  single?: boolean
  /** + menu sort order (ascending); the host default is 100. */
  order?: number
  component: (props: WatcherSidebarTabProps) => ReactNode
}

/** The subset of the host's tab component props the Watcher page reads. */
export interface WatcherSidebarTabProps {
  ctx: ClientContext
  scope: { sessionId: string }
  /** Whether this tab is the active one AND the sidebar panel is open. */
  visible: boolean
}

/** Structural face of `ctx.betterSidebar` relevant to this plugin. */
export interface BetterSidebarService {
  registerTab?: (descriptor: WatcherSidebarDescriptor) => () => void
}

/** Read the optional service off a context without importing the peer. */
export function betterSidebarServiceOf(ctx: ClientContext): BetterSidebarService | undefined {
  const service = (ctx as unknown as { betterSidebar?: BetterSidebarService | undefined }).betterSidebar
  return typeof service === 'object' && service !== null ? service : undefined
}

/** The Watcher tab descriptor registered into dsh-better-sidebar. */
export function watcherSidebarDescriptor(): WatcherSidebarDescriptor {
  return {
    id: 'dsh-watcher:picture',
    title: 'Watcher',
    single: true,
    order: 80,
    component: ({ ctx, scope, visible }) => (
      <WatcherSidebarTab ctx={ctx} sessionId={scope.sessionId as SessionId} visible={visible} />
    ),
  }
}

/** Structural snapshot source (mirrors dsh-client-store's ObservableSnapshot). */
interface ObservableSnapshotLike<T> {
  getSnapshot: () => T
  subscribe: (listener: () => void) => () => void
}

/**
 * Session facts the Watcher needs from the Controller object layer. Declared
 * locally: `ctx.sessions` is injected without importable types in this package.
 */
interface WatcherSessionSnapshot {
  blank: boolean
  running: boolean
  hasMore: boolean
  loadingOlder: boolean
}

interface WatcherSessionFace {
  getSnapshot: () => WatcherSessionSnapshot
  subscribe: (listener: () => void) => () => void
  loadOlder: () => Promise<void>
  projections?: {
    faceOf?: (key: string) => ObservableSnapshotLike<unknown> | undefined
  }
}

interface WatcherSidebarSources {
  conversation: ObservableSnapshotLike<ConversationSnapshot>
  session: ObservableSnapshotLike<WatcherSessionSnapshot>
  status: ObservableSnapshotLike<SessionStatusSnapshot>
  stats: ObservableSnapshotLike<unknown> | undefined
  face: WatcherSessionFace
}

function subscribeNone(): () => void {
  return () => {}
}

function getSnapshotUndefined(): undefined {
  return undefined
}

/** Subscribe to one snapshot source; tolerate an absent source at rest. */
function useObservableValue<T>(source: ObservableSnapshotLike<T> | undefined): T | undefined {
  const subscribe = useMemo(
    () => (source === undefined
      ? undefined
      : (listener: () => void) => source.subscribe(listener)),
    [source],
  )
  const getSnapshot = useMemo(
    () => (source === undefined ? undefined : () => source.getSnapshot()),
    [source],
  )
  return useSyncExternalStore(subscribe ?? subscribeNone, getSnapshot ?? getSnapshotUndefined, getSnapshotUndefined)
}

/**
 * Resolve the Watcher's data sources for one Session through the same doors the
 * session-header overlay uses: `sessions.binding` for the Session face and
 * `uiConversation.binding` for the Conversation snapshot. Returns undefined
 * while the Session has no retained binding (the tab shows its waiting state).
 */
function resolveSidebarSources(ctx: ClientContext, sessionId: SessionId): WatcherSidebarSources | undefined {
  const sessions = ctx.sessions as
    | { binding?: (id: SessionId) => { session?: WatcherSessionFace } | undefined }
    | undefined
  const face = sessions?.binding?.(sessionId)?.session
  if (face === undefined) return undefined
  try {
    const conversation = ctx.uiConversation.binding(sessionId).snapshot
    const status = ctx.uiSession.sessionStatus
    const stats = face.projections?.faceOf?.('sessionStats')
    return { conversation, session: face, status, stats, face }
  } catch {
    // `uiConversation.binding` throws while the Session binding is not current.
    return undefined
  }
}

function waitingRoot(): ReactNode {
  return (
    <div className={css.sidebarHost} data-watcher-sidebar="waiting">
      <span role="status">Watcher 正在等待会话记录…</span>
    </div>
  )
}

/**
 * The Better Sidebar tab body: the session-header overlay's work picture,
 * ported onto `scope.sessionId` without the portal, the trigger, or the drag
 * frame. Reads the same Session/Conversation stores through their binding
 * faces; the cost/performance HUD and whole-history paging stay explicit (and
 * `visible: false` never starts a load — only the button does).
 */
export function WatcherSidebarTab({ ctx, sessionId, visible }: {
  ctx: ClientContext
  sessionId: SessionId
  visible: boolean
}): ReactNode {
  const sources = useMemo(() => resolveSidebarSources(ctx, sessionId), [ctx, sessionId])
  const conversation = useObservableValue(sources?.conversation)
  const sessionSnapshot = useObservableValue(sources?.session)
  const statusMap = useObservableValue(sources?.status)
  const statsValue = useObservableValue(sources?.stats)
  const stats = statsValue as { turns: number; steps: number } | undefined
  const pendingInteraction: SessionPendingInteractionBase | undefined =
    statusMap?.get(sessionId)?.pendingInteraction
  const chat = conversation?.views?.get('chat')

  const snapshot = useMemo<WatcherSnapshot | undefined>(() => {
    if (conversation === undefined || chat === undefined || sessionSnapshot === undefined) return undefined
    return {
      views: conversation.views,
      chat,
      nodes: chat.legacy.nodes,
      turnTimings: chat.legacy.turnTimings,
      runningCalls: chat.legacy.runningCalls,
      pending: pendingInteraction === undefined ? [] : [pendingInteraction],
      blank: sessionSnapshot.blank,
      running: sessionSnapshot.running,
      hasMore: sessionSnapshot.hasMore,
    }
  }, [conversation, chat, pendingInteraction, sessionSnapshot])

  if (snapshot === undefined) return waitingRoot()
  return (
    <WatcherSidebarReady
      ctx={ctx}
      sessionId={sessionId}
      visible={visible}
      snapshot={snapshot}
      stats={stats}
      face={sources?.face}
    />
  )
}

function WatcherSidebarReady({ ctx, sessionId, visible, snapshot, stats, face }: {
  ctx: ClientContext
  sessionId: SessionId
  visible: boolean
  snapshot: WatcherSnapshot
  stats: { turns: number; steps: number } | undefined
  face: WatcherSessionFace | undefined
}): ReactNode {
  const { picture, performanceByTurn } = useObservedPicture(sessionId, snapshot)
  // The loader exists only while the Session face does; the "载入全部历史"
  // control is the sole trigger, so a hidden (visible=false) tab never pages.
  const loadAllHistory = useMemo(
    () => (face === undefined ? undefined : createCompleteHistoryLoader(ctx, sessionId, face)),
    [ctx, sessionId, face],
  )
  return (
    <div className={css.sidebarHost} data-watcher-sidebar="picture">
      <WorkPicturePanel
        sessionId={sessionId}
        picture={picture}
        performanceByTurn={performanceByTurn}
        hasMore={snapshot.hasMore}
        stats={stats}
        insights={undefined}
        hideInsights
        loadAllHistory={loadAllHistory}
        live={visible}
        domIdPrefix="watcher-side-turn"
      />
    </div>
  )
}
