import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-projection'
// Untyped local ESM fold: validated at runtime by zod below; single .mjs source kept for node tests.
// @ts-ignore TS7016: no declarations for the local .mjs module
import { initialState, reduceEvent, viewOf, SLOT_CAP } from './engine.mjs'
const number = z.number().finite().nonnegative()
const signed = z.number().finite()
const nullableTime = z.number().finite().nullable()
const stats = z.object({ calls:number,reported:number,exactTotals:number,tokens:number,input:number,output:number,
  cacheRead:number,cacheWrite:number,cacheReports:number.optional(),reasoning:number,reasoningReports:number,modelMs:number,timedCalls:number,
  firstMs:number,firstSamples:number,reasoningMs:number,tools:number,toolErrors:number,toolMs:number,bashMs:number.optional(),retries:number })
const route = z.object({provider:z.string(),model:z.string(),effort:z.string().nullable().optional()})
const finding = z.object({id:z.string(),kind:z.string(),turn:number,seqs:z.array(number),steps:z.array(number),title:z.string(),detail:z.string()})
const turn = z.object({number,startedAt:z.number().finite(),endedAt:nullableTime,steps:number,stats,route:route.optional()}).nullable()
const pending = z.object({turn:number,step:number,start:nullableTime,reasoningFirst:nullableTime,reasoningLast:nullableTime,lastContentAt:nullableTime}).nullable()
const dayModels = z.array(z.object({provider:z.string(),model:z.string(),effort:z.string().optional(),tokens:number}))
const days = z.array(z.object({start:z.number().int().nonnegative(),tokens:number,models:dayModels})).max(SLOT_CAP)
const usage = z.object({input:number,output:number,cacheRead:number,cacheWrite:number,reasoning:number.nullable(),cacheReported:z.boolean().optional(),tokens:number,exact:z.boolean()}).nullable()
const bucketKeys = z.enum(['system','tools','memory','files','results','conversation'])
const surface = z.object({system:number,tools:number,memory:number,files:number,results:number,conversation:number})
const surfaceTotals = surface.extend({total:number})
const surfaceDelta = z.object({system:signed,tools:signed,memory:signed,files:signed,results:signed,conversation:signed,total:signed})
const requestRow = z.object({turn:number,step:number,seq:z.number().int(),endedAt:z.number().finite(),route,usage,
  firstMs:nullableTime,modelMs:nullableTime,reasoningMs:nullableTime,surface:surfaceTotals,delta:surfaceDelta})
const context = z.object({window:number.nullable(),surface:surfaceTotals.extend({partial:z.boolean()}),projected:number})
const toolStat = z.object({name:z.string(),calls:number,errors:number,toolMs:number,stepTokens:number,resultChars:number})
const skillStat = z.object({name:z.string(),modelCalls:number,userCalls:number,errors:number,toolMs:number,stepTokens:number,injectedChars:number,lastSeen:number})
const turnRow = z.object({n:number,start:z.number().finite(),end:z.number().finite(),tokens:number,tools:number,calls:number})
export const viewSchema = z.object({version:z.literal(5),sessionId:z.string(),seq:z.number().int().min(-1),updatedAt:z.number().finite(),
  totals:stats,models:z.array(stats.extend({provider:z.string(),model:z.string(),effort:z.string().optional()})),days,turn,pending,findings:z.array(finding).max(30),findingCount:number,
  context,requests:z.array(requestRow).max(60),
  cwd:z.string().nullable(),preset:z.string().nullable(),prompts:number,
  toolStats:z.array(toolStat),skillStats:z.array(skillStat),turns:z.array(turnRow).max(500)})
const stateSchema = z.object({version:z.literal(5),sessionId:z.string(),skip:number,seq:z.number().int().min(-1),updatedAt:z.number().finite(),
  route,totals:stats,models:z.array(stats.extend({provider:z.string(),model:z.string()})),days,turn,
  cwd:z.string().nullable(),preset:z.string().nullable(),prompts:number,
  stepTokens:z.object({turn:number,step:number,tokens:number}).nullable(),
  stepCalls:z.array(z.object({name:z.string(),skillName:z.string().optional()})).max(500),
  toolStats:z.array(toolStat),skillStats:z.array(skillStat),turns:z.array(turnRow).max(500),
  open:z.object({turn:number,step:number,start:nullableTime,first:nullableTime,reasoningFirst:nullableTime,reasoningLast:nullableTime,lastContentAt:nullableTime,usage,route}).nullable(),
  tools:z.array(z.object({id:z.string(),name:z.string(),start:z.number().finite(),seq:number,step:number,route,signature:z.string().nullable(),skillName:z.string().optional()})),
  previousFailure:z.object({signature:z.string(),resultHash:z.string(),turn:number,seqs:z.array(number),steps:z.array(number)}).nullable(),
  findings:z.array(finding).max(30),findingCount:number,
  contextWindow:number.nullable(),surfaceNodes:z.array(z.object({seq:z.number().int(),bucket:bucketKeys,tokens:number})).max(3000),
  surface,surfacePartial:z.boolean(),lastSurface:surfaceTotals.nullable(),requests:z.array(requestRow).max(60)})
export type InsightsView = z.infer<typeof viewSchema>
type InsightsState = z.infer<typeof stateSchema>
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {watcherInsights:InsightsState}
  interface SessionProjectionMap {watcherInsights:InsightsView}
}
export function installProjection(ctx:Context):void {
  ctx.sessionProjections.register<'watcherInsights',InsightsState>({key:'watcherInsights',stateVersion:5,stateSchema,
    init:(header,inherited)=>stateSchema.parse(initialState(header,inherited)),apply:(state,event)=>reduceEvent(state,event),
    wire:{viewSchema,view:state=>viewOf(state)}})
  ctx.inject(['sessions'], c => {
    try {
      for (const session of (c.sessions as any).list?.() ?? []) {
        try {
          c.sessionProjections.snapshot(session)
        } catch (error) {
          c.logger?.warn?.(`dsh-watcher: projection warm-up failed for a session: ${String(error)}`)
        }
      }
    } catch (error) {
      c.logger?.warn?.(`dsh-watcher: session warm-up skipped: ${String(error)}`)
    }
  })
}
