import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkGroup, WorkItem, WorkPicture, WorkStep, WorkTurn } from './fold.ts'

/** A measured decode rate or an explicit absence of enough source evidence. */
export type DecodeThroughput =
  | {
    kind: 'measured'
    decodeMs: number
    outputTokens: number
    tokensPerSecond: number
  }
  | { kind: 'unavailable' }

/** Performance evidence correlated to one visible Turn. */
export interface TurnPerformance {
  /** Sum of step/start → assistant/message intervals carrying recorded timing. */
  modelMs: number | null
  /** Sum of tool/call → tool/result intervals represented by this Turn. */
  toolMs: number | null
  /** Lowest-step request dispatch → first non-empty token delta. */
  ttftMs: number | null
  /** Output tokens divided only by first-token → message decode time. */
  throughput: DecodeThroughput
}

/** A trustworthy wall-clock reading or a lower bound caused by a clipped start. */
export type ElapsedReading =
  | { kind: 'exact'; durationMs: number }
  | { kind: 'lower-bound'; durationMs: number }
  | { kind: 'unavailable' }

/** Whole-session wall-clock evidence for the complete history or current loaded window. */
export type SessionTiming =
  | { kind: 'unavailable' }
  | {
    kind: 'measured'
    coverage: 'complete' | 'partial'
    startTime: number
    endTime: number
    elapsedMs: number
    activeTurnMs: number
    betweenTurnMs: number
  }

interface TurnFold {
  firstStep: number
  firstStepTtftMs: number | null
  modelMs: number
  modelSampled: boolean
  decodeMs: number
  outputTokens: number
  decodeSampled: boolean
}

function outputTokensOf(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null || !('outputTokens' in usage)) return null
  const value = usage.outputTokens
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function toolDurationOf(turn: WorkTurn): number | null {
  let durationMs = 0
  let sampled = false
  for (const group of turn.groups) {
    for (const item of group.items) {
      if (item.source !== 'tool' || item.durationMs === null) continue
      durationMs += item.durationMs
      sampled = true
    }
  }
  return sampled ? durationMs : null
}

function foldAssistantNodes(nodes: readonly ConversationNode[]): Map<number, TurnFold> {
  const folds = new Map<number, TurnFold>()
  for (const node of nodes) {
    if (node.kind !== 'assistant') continue
    const timing = node.timing
    const ttftMs = timing !== undefined && timing.stepStartTime !== null && timing.firstTokenTime !== null
      ? Math.max(0, timing.firstTokenTime - timing.stepStartTime)
      : null
    const modelMs = timing !== undefined && timing.stepStartTime !== null
      ? Math.max(0, timing.completedTime - timing.stepStartTime)
      : null
    const decodeMs = timing !== undefined && timing.firstTokenTime !== null
      ? Math.max(0, timing.completedTime - timing.firstTokenTime)
      : null
    const outputTokens = outputTokensOf(node.usage)

    let fold = folds.get(node.turn)
    if (fold === undefined) {
      fold = {
        firstStep: node.step,
        firstStepTtftMs: ttftMs,
        modelMs: 0,
        modelSampled: false,
        decodeMs: 0,
        outputTokens: 0,
        decodeSampled: false,
      }
      folds.set(node.turn, fold)
    } else if (node.step < fold.firstStep) {
      fold.firstStep = node.step
      fold.firstStepTtftMs = ttftMs
    }

    if (modelMs !== null) {
      fold.modelMs += modelMs
      fold.modelSampled = true
    }
    if (decodeMs !== null && outputTokens !== null) {
      fold.decodeMs += decodeMs
      fold.outputTokens += outputTokens
      fold.decodeSampled = true
    }
  }
  return folds
}

/**
 * Correlate durable assistant timing/usage with Watcher's occurrence-preserving Turns.
 * Missing timing or provider usage stays unavailable; this function never estimates it.
 */
export function deriveTurnPerformance(
  nodes: readonly ConversationNode[],
  turns: readonly WorkTurn[],
): ReadonlyMap<number, TurnPerformance> {
  const assistantFolds = foldAssistantNodes(nodes)
  const performance = new Map<number, TurnPerformance>()

  for (const turn of turns) {
    const fold = assistantFolds.get(turn.turn)
    const throughput: DecodeThroughput = fold !== undefined && fold.decodeSampled && fold.decodeMs > 0
      ? {
        kind: 'measured',
        decodeMs: fold.decodeMs,
        outputTokens: fold.outputTokens,
        tokensPerSecond: fold.outputTokens / (fold.decodeMs / 1000),
      }
      : { kind: 'unavailable' }
    performance.set(turn.turn, {
      modelMs: fold?.modelSampled === true ? fold.modelMs : null,
      toolMs: toolDurationOf(turn),
      ttftMs: fold?.firstStepTtftMs ?? null,
      throughput,
    })
  }

  return performance
}

function itemEndTime(item: WorkItem): number {
  return item.resultTime ?? item.time
}

function observedTurnRange(
  turn: WorkTurn,
  live: boolean,
  now: number,
): { startTime: number; endTime: number; exactBounds: boolean } | null {
  const items = turn.groups.flatMap(group => group.items)
  const observedStarts = [
    ...turn.groups.flatMap(group => group.startTime === null ? [] : [group.startTime]),
    ...items.map(item => item.time),
  ]
  const observedEnds = [
    ...turn.groups.flatMap(group => group.endTime === null ? [] : [group.endTime]),
    ...items.map(itemEndTime),
  ]
  const fallbackStart = observedStarts.length === 0 ? null : Math.min(...observedStarts)
  const fallbackEnd = observedEnds.length === 0 ? null : Math.max(...observedEnds)
  const startTime = turn.startTime ?? fallbackStart
  const endTime = turn.endTime ?? (live ? now : fallbackEnd)
  if (startTime === null || endTime === null) return null
  return {
    startTime,
    endTime: Math.max(startTime, endTime),
    exactBounds: turn.startTime !== null && (turn.endTime !== null || live),
  }
}

/** Settled Turn duration, live current duration, or a lower bound for a clipped Turn start. */
export function turnElapsedReading(turn: WorkTurn, live: boolean, now: number): ElapsedReading {
  const range = observedTurnRange(turn, live, now)
  if (range === null) return { kind: 'unavailable' }
  return {
    kind: range.exactBounds ? 'exact' : 'lower-bound',
    durationMs: range.endTime - range.startTime,
  }
}

/** Backward-compatible numeric face for callers that do not need coverage copy. */
export function turnElapsedMs(turn: WorkTurn, live: boolean, now: number): number | null {
  const reading = turnElapsedReading(turn, live, now)
  return reading.kind === 'unavailable' ? null : reading.durationMs
}

function boundedElapsed(startTime: number | null, endTime: number | null, live: boolean, now: number): number | null {
  if (startTime === null) return null
  const end = endTime ?? (live ? now : null)
  return end === null ? null : Math.max(0, end - startTime)
}

/** One phase's wall-clock span from its first Step start to its last Step end. */
export function groupElapsedMs(group: WorkGroup, live: boolean, now: number): number | null {
  return boundedElapsed(group.startTime, group.endTime, live, now)
}

/** One Step's wall-clock span, including model, tools, and in-step waits. */
export function stepElapsedMs(step: WorkStep, live: boolean, now: number): number | null {
  return boundedElapsed(step.startTime, step.endTime, live, now)
}

/** One execution's settled duration or live elapsed interval. */
export function itemElapsedMs(item: WorkItem, live: boolean, now: number): number | null {
  return item.durationMs ?? (live ? Math.max(0, now - item.time) : null)
}

function unionDuration(intervals: readonly { startTime: number; endTime: number }[]): number {
  const sorted = [...intervals].sort((left, right) => left.startTime - right.startTime || left.endTime - right.endTime)
  const first = sorted[0]
  if (first === undefined) return 0
  let startTime = first.startTime
  let endTime = first.endTime
  let durationMs = 0
  for (const interval of sorted.slice(1)) {
    if (interval.startTime <= endTime) {
      endTime = Math.max(endTime, interval.endTime)
      continue
    }
    durationMs += Math.max(0, endTime - startTime)
    startTime = interval.startTime
    endTime = interval.endTime
  }
  return durationMs + Math.max(0, endTime - startTime)
}

/**
 * Decompose the loaded session span into DSH Turn intervals and time between Turns.
 * Partial history is labelled as a window; missing Turn starts use observed work only.
 */
export function deriveSessionTiming(picture: WorkPicture, now: number): SessionTiming {
  const latestTurn = picture.turns.at(-1)?.turn ?? null
  const ranges = picture.turns.flatMap((turn) => {
    const live = picture.running && turn.turn === latestTurn
    const range = observedTurnRange(turn, live, now)
    return range === null ? [] : [range]
  })
  if (ranges.length === 0) return { kind: 'unavailable' }

  const startTime = Math.min(...ranges.map(range => range.startTime))
  const endTime = picture.running ? Math.max(startTime, now) : Math.max(...ranges.map(range => range.endTime))
  const elapsedMs = Math.max(0, endTime - startTime)
  const activeTurnMs = Math.min(elapsedMs, unionDuration(ranges))
  const coverage = picture.partialHistory || ranges.some(range => !range.exactBounds)
    ? 'partial'
    : 'complete'
  return {
    kind: 'measured',
    coverage,
    startTime,
    endTime,
    elapsedMs,
    activeTurnMs,
    betweenTurnMs: Math.max(0, elapsedMs - activeTurnMs),
  }
}

/** Whole tokens from ten up, one decimal below, matching DSH's RC8 chat chrome. */
export function formatTokensPerSecond(tokensPerSecond: number): string {
  const clamped = Math.max(0, tokensPerSecond)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}
