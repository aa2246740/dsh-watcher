import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { loadCompleteHistory } from '../hub/history.ts'
import { Watcher, type WatcherInjected } from './Watcher.tsx'
import { registerModelTraceDefinition } from './model-trace-definition.ts'

export const name = 'dsh-watcher-client'
export const inject = ['slots', 'sessions', 'uiConversation']

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
            const sessionSnapshot = session.getSnapshot()
            const conversation = ctx.uiConversation.binding(sessionId).snapshot.getSnapshot()
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
        }),
      }
    },
  }, Watcher))
}
