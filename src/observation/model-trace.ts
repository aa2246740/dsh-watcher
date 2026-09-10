/** One timestamped provider-exposed reasoning fragment. */
export interface ReasoningFragment {
  readonly seq: number
  readonly time: number
  readonly text: string
}

interface ModelAttemptEvidence {
  readonly attempt: number
  /** Only the first attempt has an authoritative request-entry boundary. */
  readonly startedAt: number | null
  readonly firstTokenTime: number | null
  readonly firstReasoningTime: number | null
  readonly lastReasoningTime: number | null
  readonly firstOutputTime: number | null
  readonly reasoningText: string
  readonly fragments: readonly ReasoningFragment[]
}

export type ModelAttempt = ModelAttemptEvidence & (
  | { readonly kind: 'running' }
  | { readonly kind: 'complete'; readonly endedAt: number }
  | {
    readonly kind: 'retried'
    readonly endedAt: number
    readonly retry: number
    readonly retryDelayMs: number
  }
  | { readonly kind: 'interrupted'; readonly endedAt: number }
)

type ModelAttempts = readonly [ModelAttempt, ...ModelAttempt[]]

/** Provider/model evidence owned by one authoritative DSH Step. */
export interface ModelStepTrace {
  readonly turn: number
  readonly step: number
  /** Stable identity anchor: the first model event observed for this Step. */
  readonly startSeq: number
  /** Mutable activity cursor: the newest model event folded into this trace. */
  readonly lastSeq: number
  readonly startTime: number | null
  readonly attempts: ModelAttempts
  readonly reasoningTokens: number | null
}

export type ModelStageMetrics = {
  readonly kind: 'measured' | 'partial'
  readonly live: boolean
  readonly totalMs: number | null
  readonly firstResponseMs: number | null
  readonly visibleReasoningMs: number | null
  readonly outputMs: number | null
  readonly unattributedMs: number | null
}

type ModelTraceEventBase = {
  readonly turn: number
  readonly step: number
  readonly seq: number
  readonly time: number
  readonly lastSeq?: number
}

export type ModelTraceEvent = ModelTraceEventBase & (
  | { readonly kind: 'step-start' }
  | { readonly kind: 'reasoning-delta'; readonly text: string; readonly fragments?: readonly ReasoningFragment[] }
  | { readonly kind: 'output-delta' }
  | { readonly kind: 'usage'; readonly reasoningTokens: number | null }
  | {
    readonly kind: 'message'
    readonly reasoningText: string | null
    readonly reasoningTokens: number | null
    readonly fragments: readonly ReasoningFragment[]
    readonly firstOutputTime: number | null
  }
  | {
    readonly kind: 'attempt'
    readonly fragments: readonly ReasoningFragment[]
    readonly firstOutputTime: number | null
  }
  | { readonly kind: 'retry'; readonly retry: number; readonly delayMs: number }
  | { readonly kind: 'step-end' }
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nonNegativeNumber(value: unknown): number | null {
  const number = finiteNumber(value)
  return number !== null && number >= 0 ? number : null
}

function locationOf(value: Record<string, unknown>): ModelTraceEventBase | null {
  const data = value.data
  if (!isRecord(data)) return null
  const turn = finiteNumber(data.turn)
  const step = finiteNumber(data.step)
  const seq = finiteNumber(value.seq)
  const time = finiteNumber(value.time)
  return turn === null || step === null || seq === null || time === null
    ? null
    : { turn, step, seq, time }
}

function reasoningTokensOf(value: unknown): number | null {
  return isRecord(value) ? nonNegativeNumber(value.reasoningTokens) : null
}

function reasoningTextOf(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.content)) return null
  const parts = value.content.flatMap((block): string[] => (
    isRecord(block) && block.type === 'reasoning' && typeof block.text === 'string'
      ? [block.text]
      : []
  ))
  return parts.length === 0 ? null : parts.join('\n\n')
}

/** Timing evidence carried by one settled attempt's durable stream. */
interface AttemptStreamEvidence {
  readonly fragments: readonly ReasoningFragment[]
  readonly firstOutputTime: number | null
}

/**
 * Read the durable attempt stream 0.1.5-rc.1 settles into `assistant/message`
 * and `assistant/attempt`: delta runs pack `time0` plus per-gap `dt`, while
 * block/usage/finish chunks stay raw with their own `time`. Fragment `seq`s are
 * positions inside that stream, not Session seqs — the records do not carry
 * any, and the UI only counts fragments.
 * @param stream - the raw `data.stream` value.
 * @param seq - event seq the fragments hang off.
 * @returns the evidence, or null when the stream carries none.
 */
function attemptStreamOf(stream: unknown, seq: number): AttemptStreamEvidence | null {
  if (!Array.isArray(stream)) return null
  const fragments: ReasoningFragment[] = []
  let firstOutputTime: number | null = null
  let position = 0
  for (const value of stream) {
    if (!isRecord(value)) continue
    if (value.type === 'reasoning-chunks' || value.type === 'text-chunks' || value.type === 'tool-call-chunks') {
      const reasoning = value.type === 'reasoning-chunks'
      const parts = value.type === 'tool-call-chunks' ? value.args : value.texts
      const gaps = value.dt
      const time0 = value.time0
      if (!Number.isSafeInteger(time0)) continue
      if (!Array.isArray(parts) || parts.length === 0) continue
      if (!Array.isArray(gaps) || gaps.length !== parts.length - 1) continue
      let time = time0 as number
      for (let index = 0; index < parts.length; index++) {
        if (index > 0) {
          const gap = gaps[index - 1]
          if (!Number.isSafeInteger(gap)) { time = Number.NaN; break }
          time += gap as number
        }
        if (!Number.isSafeInteger(time)) break
        const text = parts[index]
        if (reasoning && typeof text === 'string' && text !== '') {
          fragments.push({ seq: seq + position, time, text })
        }
        if (!reasoning && firstOutputTime === null) firstOutputTime = time
        position += 1
      }
      continue
    }
    if (value.type !== 'chunk' || !isRecord(value.chunk) || !Number.isSafeInteger(value.time)) continue
    const type = value.chunk.type
    if (type !== 'reasoning-delta' && type !== 'text-delta' && type !== 'tool-call-delta') continue
    const time = value.time as number
    const text = value.chunk.text
    if (type === 'reasoning-delta' && typeof text === 'string' && text !== '') {
      fragments.push({ seq: seq + position, time, text })
    }
    if (type !== 'reasoning-delta' && firstOutputTime === null) firstOutputTime = time
    position += 1
  }
  return fragments.length === 0 && firstOutputTime === null ? null : { fragments, firstOutputTime }
}

/** Parse only the seven event shapes needed by the read-only model-stage fold. */
export function modelTraceEventOf(value: unknown): ModelTraceEvent | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null
  const location = locationOf(value)
  if (location === null || !isRecord(value.data)) return null
  const data = value.data

  if (value.type === 'step/start') return { ...location, kind: 'step-start' }
  if (value.type === 'step/end') return { ...location, kind: 'step-end' }
  if (value.type === 'llm/retry') {
    const retry = nonNegativeNumber(data.retry)
    const delayMs = nonNegativeNumber(data.delayMs)
    return retry === null || delayMs === null
      ? null
      : { ...location, kind: 'retry', retry, delayMs }
  }
  if (value.type === 'assistant/message' || value.type === 'assistant/attempt') {
    const evidence = attemptStreamOf(data.stream, location.seq)
    const fragments = evidence?.fragments ?? []
    const firstOutputTime = evidence?.firstOutputTime ?? null
    // A settled attempt with no surface message keeps only its evidence.
    return value.type === 'assistant/attempt'
      ? { ...location, kind: 'attempt', fragments, firstOutputTime }
      : {
        ...location,
        kind: 'message',
        reasoningText: reasoningTextOf(data.message),
        reasoningTokens: reasoningTokensOf(data.usage),
        fragments,
        firstOutputTime,
      }
  }
  // RC1 historical chunkrow envelopes preserve fragment times and sequence identities.
  if (['chunkrow/reasoning-chunks', 'chunkrow/text-chunks', 'chunkrow/tool-call-chunks'].includes(value.type)) {
    const tool = value.type === 'chunkrow/tool-call-chunks'
    const parts = tool ? data.args : data.texts
    const gaps = data.dt
    if (!Array.isArray(parts) || !parts.length || !parts.every(p => typeof p === 'string')
      || !Array.isArray(gaps) || gaps.length !== parts.length - 1 || !gaps.every(Number.isSafeInteger)) return null
    let time = location.time
    const fragments: ReasoningFragment[] = []
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) time += gaps[i - 1] as number
      if (!Number.isSafeInteger(time)) return null
      const text = parts[i] as string
      if (text !== '' || (tool && typeof data.name === 'string')) fragments.push({ seq: location.seq + i, time, text })
    }
    const first = fragments[0]
    if (!first) return null
    const base = { ...location, time: first.time, lastSeq: location.seq + parts.length - 1 }
    return value.type === 'chunkrow/reasoning-chunks'
      ? { ...base, kind: 'reasoning-delta', text: fragments.map(f => f.text).join(''), fragments }
      : { ...base, kind: 'output-delta' }
  }
  // 0.1.5-rc.1 renamed the client-only live stream event to `assistant/live-chunk`;
  // the pre-0.1.5 spelling stays accepted so recorded transcripts still fold.
  if (!['assistant/live-chunk', 'assistant/chunk'].includes(value.type) || !isRecord(data.chunk) || typeof data.chunk.type !== 'string') {
    return null
  }
  const chunk = data.chunk
  if (chunk.type === 'reasoning-delta') {
    return typeof chunk.text === 'string' && chunk.text !== ''
      ? { ...location, kind: 'reasoning-delta', text: chunk.text }
      : null
  }
  if (chunk.type === 'text-delta') {
    return typeof chunk.text === 'string' && chunk.text !== ''
      ? { ...location, kind: 'output-delta' }
      : null
  }
  if (chunk.type === 'tool-call-delta') {
    const hasArguments = typeof chunk.argumentsDelta === 'string' && chunk.argumentsDelta !== ''
    return hasArguments || typeof chunk.name === 'string'
      ? { ...location, kind: 'output-delta' }
      : null
  }
  if (chunk.type === 'usage') {
    return { ...location, kind: 'usage', reasoningTokens: reasoningTokensOf(chunk.usage) }
  }
  return null
}

function runningAttempt(attempt: number, startedAt: number | null): ModelAttempt {
  return {
    kind: 'running',
    attempt,
    startedAt,
    firstTokenTime: null,
    firstReasoningTime: null,
    lastReasoningTime: null,
    firstOutputTime: null,
    reasoningText: '',
    fragments: [],
  }
}

export function startModelStepTrace(event: ModelTraceEventBase): ModelStepTrace {
  return {
    turn: event.turn,
    step: event.step,
    startSeq: event.seq,
    lastSeq: event.seq,
    startTime: event.time,
    attempts: [runningAttempt(1, event.time)],
    reasoningTokens: null,
  }
}

function partialModelStepTrace(event: ModelTraceEventBase): ModelStepTrace {
  return {
    turn: event.turn,
    step: event.step,
    startSeq: event.seq,
    lastSeq: event.seq,
    startTime: null,
    attempts: [runningAttempt(1, null)],
    reasoningTokens: null,
  }
}

function replaceLast(attempts: ModelAttempts, attempt: ModelAttempt): ModelAttempts {
  if (attempts.length === 1) return [attempt]
  return [attempts[0], ...attempts.slice(1, -1), attempt]
}

function appendAttempt(attempts: ModelAttempts, attempt: ModelAttempt): ModelAttempts {
  return [...attempts, attempt]
}

function sameStep(trace: ModelStepTrace, event: ModelTraceEventBase): boolean {
  return trace.turn === event.turn && trace.step === event.step
}

/**
 * Fold durable settled-stream evidence onto one attempt. The stream is the
 * authoritative record of what the provider actually emitted, so it replaces
 * whatever the live rows had accumulated — never the other way around.
 * @param attempt - attempt state before settlement.
 * @param event - normalized event carrying the settled evidence.
 * @returns the attempt with real fragment times, or the input when the log
 * carries no durable stream (pre-0.1.5 transcripts).
 */
function applyStreamEvidence(
  attempt: ModelAttempt,
  event: { readonly fragments: readonly ReasoningFragment[]; readonly firstOutputTime: number | null },
): ModelAttempt {
  if (event.fragments.length === 0 && event.firstOutputTime === null) return attempt
  const first = event.fragments[0]
  const last = event.fragments.at(-1)
  return {
    ...attempt,
    firstTokenTime: attempt.firstTokenTime ?? first?.time ?? event.firstOutputTime,
    firstReasoningTime: first?.time ?? attempt.firstReasoningTime,
    lastReasoningTime: last?.time ?? attempt.lastReasoningTime,
    reasoningText: event.fragments.length === 0 ? attempt.reasoningText : event.fragments.map(f => f.text).join(''),
    fragments: event.fragments.length === 0 ? attempt.fragments : event.fragments,
    firstOutputTime: attempt.firstOutputTime ?? event.firstOutputTime,
  }
}

/** Fold one normalized event without discarding reasoning from a retried attempt. */
export function updateModelStepTrace(trace: ModelStepTrace, event: ModelTraceEvent): ModelStepTrace {
  if (!sameStep(trace, event) || event.kind === 'step-start') return trace
  const current = { ...trace, lastSeq: Math.max(trace.lastSeq, event.lastSeq ?? event.seq) }
  const attempt = trace.attempts.at(-1)
  if (attempt === undefined) return trace

  if (event.kind === 'usage') {
    return event.reasoningTokens === null ? current : { ...current, reasoningTokens: event.reasoningTokens }
  }
  if (event.kind === 'reasoning-delta') {
    if (attempt.kind !== 'running') return current
    const fragments = event.fragments ?? [{ seq: event.seq, time: event.time, text: event.text }]
    return {
      ...current,
      attempts: replaceLast(trace.attempts, {
        ...attempt,
        firstTokenTime: attempt.firstTokenTime ?? event.time,
        firstReasoningTime: attempt.firstReasoningTime ?? event.time,
        lastReasoningTime: fragments.at(-1)?.time ?? event.time,
        reasoningText: attempt.reasoningText + event.text,
        fragments: [...attempt.fragments, ...fragments],
      }),
    }
  }
  if (event.kind === 'output-delta') {
    if (attempt.kind !== 'running') return current
    return {
      ...current,
      attempts: replaceLast(trace.attempts, {
        ...attempt,
        firstTokenTime: attempt.firstTokenTime ?? event.time,
        firstOutputTime: attempt.firstOutputTime ?? event.time,
      }),
    }
  }
  if (event.kind === 'retry') {
    if (attempt.kind !== 'running') return current
    const retried: ModelAttempt = {
      ...attempt,
      kind: 'retried',
      endedAt: event.time,
      retry: event.retry,
      retryDelayMs: event.delayMs,
    }
    return {
      ...current,
      attempts: appendAttempt(
        replaceLast(trace.attempts, retried),
        runningAttempt(attempt.attempt + 1, null),
      ),
    }
  }
  if (event.kind === 'attempt') {
    if (attempt.kind !== 'running') return current
    return { ...current, attempts: replaceLast(trace.attempts, applyStreamEvidence(attempt, event)) }
  }
  if (event.kind === 'message') {
    const reasoningTokens = event.reasoningTokens ?? trace.reasoningTokens
    if (attempt.kind !== 'running') return { ...current, reasoningTokens }
    const settled = applyStreamEvidence(attempt, event)
    return {
      ...current,
      reasoningTokens,
      attempts: replaceLast(trace.attempts, {
        ...settled,
        kind: 'complete',
        endedAt: event.time,
        reasoningText: event.reasoningText ?? settled.reasoningText,
      }),
    }
  }
  if (attempt.kind !== 'running') return current
  return {
    ...current,
    attempts: replaceLast(trace.attempts, {
      ...attempt,
      kind: 'interrupted',
      endedAt: event.time,
    }),
  }
}

/** Fold raw Session-like values for golden replay and boundary tests. */
export function foldModelTraceEvents(values: readonly unknown[]): ReadonlyMap<string, ModelStepTrace> {
  const traces = new Map<string, ModelStepTrace>()
  for (const value of values) {
    const event = modelTraceEventOf(value)
    if (event === null) continue
    const key = `${event.turn}:${event.step}`
    const current = traces.get(key)
    if (event.kind === 'step-start') {
      traces.set(key, startModelStepTrace(event))
      continue
    }
    const trace = current ?? partialModelStepTrace(event)
    traces.set(key, updateModelStepTrace(trace, event))
  }
  return traces
}

function attemptEnd(attempt: ModelAttempt, now: number): number | null {
  return attempt.kind === 'running' ? now : attempt.endedAt
}

function firstTokenTime(trace: ModelStepTrace): number | null {
  for (const attempt of trace.attempts) {
    if (attempt.firstTokenTime !== null) return attempt.firstTokenTime
  }
  return null
}

function visibleReasoningDuration(trace: ModelStepTrace, _now: number): number | null {
  let sampled = false
  let total = 0
  for (const attempt of trace.attempts) {
    if (attempt.firstReasoningTime === null || attempt.lastReasoningTime === null) continue
    if (attempt.firstOutputTime !== null && attempt.lastReasoningTime > attempt.firstOutputTime) continue // interleaved timing remains unattributed
    sampled = true
    // An open request does not prove continuously emitted reasoning.
    const end = attempt.lastReasoningTime
    total += Math.max(0, end - attempt.firstReasoningTime)
  }
  return sampled ? total : null
}

/** Derive additive display segments without calling unobserved latency Thinking. */
export function modelStageMetrics(trace: ModelStepTrace, now: number): ModelStageMetrics {
  const last = trace.attempts.at(-1)
  const live = last?.kind === 'running'
  const end = last === undefined ? null : attemptEnd(last, now)
  const totalMs = trace.startTime === null || end === null ? null : Math.max(0, end - trace.startTime)
  const firstToken = firstTokenTime(trace)
  const firstResponseMs = trace.startTime === null || firstToken === null
    ? null
    : Math.max(0, firstToken - trace.startTime)
  const visibleReasoningMs = visibleReasoningDuration(trace, now)
  const finalReasoning = last?.lastReasoningTime ?? null
  const outputStart = last?.firstOutputTime ?? null
  const outputMs = outputStart === null || end === null || (live && finalReasoning !== null && last?.firstOutputTime === null)
    ? null
    : Math.max(0, end - outputStart)
  const attributed = (firstResponseMs ?? 0) + (visibleReasoningMs ?? 0) + (outputMs ?? 0)
  const unattributedMs = totalMs === null ? null : Math.max(0, totalMs - attributed)
  return {
    kind: trace.startTime === null ? 'partial' : 'measured',
    live,
    totalMs,
    firstResponseMs,
    visibleReasoningMs,
    outputMs,
    unattributedMs,
  }
}

export function hasReasoningEvidence(trace: ModelStepTrace): boolean {
  return trace.attempts.some(attempt => attempt.reasoningText.trim() !== '' || attempt.fragments.length > 0)
}
