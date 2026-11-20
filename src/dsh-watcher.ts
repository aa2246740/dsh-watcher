import type { Context } from '@deepseek-ai/cordis'
import { installProjection } from './insights/projection.ts'
import { logInfo } from './log.ts'
export const name = 'dsh-watcher'
export const inject = ['sessionProjections', 'sessions']
/** Host-owned replayable statistics; no new transport or model-facing writes. */
export async function apply(ctx: Context): Promise<void> {
  await installProjection(ctx)
  logInfo('[my-plugins/dsh-watcher] loaded')
}
