import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { loadCompleteHistory, type CompleteHistoryResult } from '../hub/history.ts'

/**
 * The paging verbs the shared loader needs from one Session face. The
 * session-header injection and the Better Sidebar tab both satisfy it from
 * `sessions.binding(id).session`.
 */
export interface WatcherHistorySession {
  loadOlder: () => Promise<void>
  getSnapshot: () => { hasMore: boolean; loadingOlder: boolean }
}

/**
 * The conversation service the caller already resolved. This is a plain
 * dependency, not a Cordis context: Cordis 4.0.5 rejects
 * `ctx.uiConversation = ...` on any object that inherits a context
 * (`cannot set property "uiConversation" in multiple fibers`).
 */
export interface WatcherHistoryConversation {
  binding: (sessionId: SessionId) => {
    snapshot: { getSnapshot: () => ConversationSnapshot }
  }
}

/**
 * Build the explicit whole-history loader for one Session: repeat the
 * Session's public, read-only paging verb until the head stops moving, using
 * the same conversation head key the header overlay reports. Nothing starts
 * it automatically — only a user action does.
 */
export function createCompleteHistoryLoader(
  uiConversation: WatcherHistoryConversation,
  sessionId: SessionId,
  session: WatcherHistorySession,
): (signal: AbortSignal) => Promise<CompleteHistoryResult> {
  return signal => loadCompleteHistory({
    signal,
    loadOlder: () => session.loadOlder(),
    read: () => {
      const sessionSnapshot = session.getSnapshot()
      const conversation = uiConversation.binding(sessionId).snapshot.getSnapshot()
      const chat = conversation.views.get('chat')
      if (chat === undefined) throw new Error('dsh-watcher: Chat conversation target is unavailable')
      const firstNode = chat.legacy.nodes[0]
      const firstTurn = chat.timeline.turnOrder[0]
      return {
        hasMore: sessionSnapshot.hasMore,
        loadingOlder: sessionSnapshot.loadingOlder,
        headKey: `${firstTurn ?? 'none'}:${firstNode?.seq ?? 'none'}:${chat.legacy.nodes.length}`,
      }
    },
  })
}
