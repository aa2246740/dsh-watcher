import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-watcher'
export const inject = []

/** Host half only joins the Web plugin graph. Observation is the client fold. */
export function apply(_ctx: Context): void {
  console.log('[my-plugins/dsh-watcher] loaded')
}
