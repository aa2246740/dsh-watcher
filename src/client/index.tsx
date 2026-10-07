import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createCompleteHistoryLoader, type WatcherHistorySession } from './history-loader.ts'
import { Watcher, type WatcherInjected } from './Watcher.tsx'
import { registerModelTraceDefinition } from './model-trace-definition.ts'
import { betterSidebarServiceOf, watcherSidebarDescriptor } from './SidebarTab.tsx'
import { InsightsSettings } from './Insights.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'

export const name = 'dsh-watcher-client'
export const inject = ['slots', 'sessions', 'uiConversation']

/**
 * Native session-header utility. Order 50 sits after Session log (0)
 * and before the files-panel toggle (110). No overlay glyph.
 */
export function apply(ctx: ClientContext) {
  registerModelTraceDefinition(ctx)
  ctx.inject(['remote', 'remote.session'], c => {
    c.slots.inject('settings.section', () => c.slots.register({
      name: 'settings.section', id: 'watcher-insights', order: 85,
      label: 'Watcher', inject: () => ({ remote: c.remote }),
    }, InsightsSettings))
  })
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'dsh-watcher',
    order: 50,
    label: 'Watcher',
    inject: (sessionId: SessionId): WatcherInjected => {
      // Workspace Host provides ISessions.binding(); keep runtime behavior.
      const session = (ctx.sessions as any).binding?.(sessionId)?.session as
        | WatcherHistorySession
        | undefined
      if (session === undefined) throw new Error(`dsh-watcher: session "${sessionId}" is unavailable`)
      return {
        loadAllHistory: signal => createCompleteHistoryLoader(ctx, sessionId, session)(signal),
      }
    },
  }, Watcher))
  // Optional Better Sidebar tab. `dsh-better-sidebar` is an optional runtime
  // peer: when it is absent the inject never fires and nothing happens. The
  // effect hands registerTab's disposer to cordis, so hot reload unregisters
  // the tab before the plugin re-applies — no duplicate registrations.
  ctx.inject(['betterSidebar'], c => {
    const betterSidebar = betterSidebarServiceOf(c)
    const { registerTab } = betterSidebar ?? {}
    if (typeof registerTab !== 'function') return
    c.effect(() => registerTab(watcherSidebarDescriptor()))
  })
}
