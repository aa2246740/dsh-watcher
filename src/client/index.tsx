import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { loadCompleteHistory } from '../hub/history.ts'
import { Watcher, type WatcherInjected } from './Watcher.tsx'
import { registerModelTraceDefinition } from './model-trace-definition.ts'

export const name = 'dsh-watcher-client'
export const inject = ['slots', 'sessions', 'conversationEvents']

/**
 * Native session-header utility. Order 50 sits after Session log (0)
 * and before the files-panel toggle (110). No overlay glyph.
 */
export function apply(ctx: ClientContext) {
  registerModelTraceDefinition(ctx)
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'dsh-watcher',
    order: 50,
    label: 'Watcher',
    inject: (sessionId: SessionId): WatcherInjected => {
      const session = ctx.sessions.binding(sessionId)?.session
      if (session === undefined) throw new Error(`dsh-watcher: session "${sessionId}" is unavailable`)
      return {
        loadAllHistory: signal => loadCompleteHistory({
          signal,
          loadOlder: () => session.loadOlder(),
          read: () => {
            const snapshot = session.getSnapshot()
            const firstNode = snapshot.nodes[0]
            const firstTurn = snapshot.chat.timeline.turnOrder[0]
            return {
              hasMore: snapshot.hasMore,
              loadingOlder: snapshot.loadingOlder,
              headKey: `${firstTurn ?? 'none'}:${firstNode?.seq ?? 'none'}:${snapshot.nodes.length}`,
            }
          },
        }),
      }
    },
  }, Watcher))
}
