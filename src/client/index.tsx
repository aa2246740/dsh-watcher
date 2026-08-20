import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { Watcher } from './Watcher.tsx'

export const name = 'dsh-watcher-client'
export const inject = ['slots']

/**
 * Native session-header utility. Order 50 sits after Session log (0)
 * and before the files-panel toggle (110). No overlay glyph.
 */
export function apply(ctx: ClientContext) {
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'dsh-watcher',
    order: 50,
    label: 'Watcher',
  }, Watcher))
}
