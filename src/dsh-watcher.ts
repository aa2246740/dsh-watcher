import type { Context } from '@deepseek-ai/cordis'
import { installProjection } from './insights/projection.ts'
export const name = 'dsh-watcher'
export const inject = ['sessionProjections']
/** Host-owned replayable statistics; no new transport or model-facing writes. */
export function apply(ctx: Context): void { installProjection(ctx) }
