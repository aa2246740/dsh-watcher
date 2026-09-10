import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  modelTraceEventOf,
  startModelStepTrace,
  updateModelStepTrace,
  type ModelStepTrace,
} from '../observation/model-trace.ts'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationStepDataMap {
    /** Provider-exposed model activity retained for one Step. */
    'dsh-watcher-model-stage': ModelStepTrace
  }
}

const modelTraceDefinition: ConversationNodeDefinition<ModelStepTrace> = {
  kind: 'dsh-watcher-model-stage',
  match: (event) => {
    const normalized = modelTraceEventOf(event)
    if (normalized === null) return null
    return {
      id: `${normalized.turn}:${normalized.step}`,
      role: normalized.kind === 'step-start' ? 'start' : 'update',
    }
  },
  start: (_context, match) => {
    const event = modelTraceEventOf(match.event)
    if (event === null || event.kind !== 'step-start') {
      throw new Error('dsh-watcher-model-stage start requires step/start')
    }
    return startModelStepTrace(event)
  },
  update: (context, match) => {
    const event = modelTraceEventOf(match.event)
    return event === null ? context.state : updateModelStepTrace(context.state, event)
  },
  publication: (match) => {
    if (match.event.type === 'step/start') return 'none'
    if (match.event.type !== 'assistant/live-chunk') return 'immediate'
    return match.event.data.chunk.type === 'usage' ? 'none' : 'animation-frame'
  },
  buildLocationData: (context, scope) => {
    if (scope !== 'step' || context.state === undefined) return null
    return {
      kind: 'step',
      turn: context.state.turn,
      step: context.state.step,
      key: 'dsh-watcher-model-stage',
      value: context.state,
    }
  },
}

/** Register the Step-scoped, read-only model-stage projection. */
export function registerModelTraceDefinition(ctx: ClientContext): void {
  ctx.uiConversation.events.register(modelTraceDefinition)
}
