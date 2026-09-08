import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection'
import { emptyStats, initialState, reduceEvent, viewOf } from './engine.mjs'
const number = z.number().finite().nonnegative()
const nullableTime = z.number().finite().nullable()
const stats = z.object(Object.fromEntries(Object.keys(emptyStats()).map(k => [k, number])))
const route = z.object({ provider: z.string(), model: z.string() })
const finding = z.object({ id: z.string(), kind: z.string(), turn: number, seqs: z.array(number), steps: z.array(number), title: z.string(), detail: z.string() })
const turn = z.object({ number, startedAt: z.number().finite(), endedAt: nullableTime, steps: number, stats }).nullable()
const pending = z.object({ turn: number, step: number, start: nullableTime, reasoningFirst: nullableTime, reasoningLast: nullableTime, lastContentAt: nullableTime }).nullable()
export const viewSchema = z.object({
  version: z.literal(1), sessionId: z.string(), seq: z.number().int().min(-1), updatedAt: z.number().finite(),
  totals: stats, models: z.array(stats.extend({ provider: z.string(), model: z.string() })),
  turn, pending, findings: z.array(finding).max(30), findingCount: number,
})
const usage = z.object({ input: number, output: number, cacheRead: number, cacheWrite: number, reasoning: number.nullable(), tokens: number, exact: z.boolean() }).nullable()
const stateSchema = z.object({
  version: z.literal(1), sessionId: z.string(), skip: number, seq: z.number().int().min(-1), updatedAt: z.number().finite(),
  route, totals: stats, models: z.array(stats.extend({ provider: z.string(), model: z.string() })), turn,
  open: z.object({ turn: number, step: number, start: nullableTime, first: nullableTime,
    reasoningFirst: nullableTime, reasoningLast: nullableTime, lastContentAt: nullableTime, usage, route }).nullable(),
  tools: z.array(z.object({ id: z.string(), name: z.string(), start: z.number().finite(), seq: number, step: number, route, signature: z.string().nullable() })),
  previousFailure: z.object({ signature: z.string(), resultHash: z.string(), turn: number, seqs: z.array(number), steps: z.array(number) }).nullable(),
  findings: z.array(finding).max(30), findingCount: number, wire: viewSchema,
})
export type InsightsView = z.infer<typeof viewSchema>
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { watcherInsights: z.infer<typeof stateSchema> }
  interface SessionProjectionMap { watcherInsights: InsightsView }
}
export function installProjection(ctx: Context): void {
  ctx.sessionProjections.register({
    key: 'watcherInsights', stateVersion: 1, stateSchema,
    init: (header, inherited) => stateSchema.parse(initialState(header, inherited)),
    apply: (state, event) => reduceEvent(state, event),
    wire: { viewSchema, view: state => viewOf(state) },
  })
}
