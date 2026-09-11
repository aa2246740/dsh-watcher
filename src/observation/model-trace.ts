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

function chunkEventOf(location: ModelTraceEventBase, chunk: unknown): ModelTraceEvent | null {
  if (!isRecord(chunk) || typeof chunk.type !== 'string') return null
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

function packedRunEventOf(
  location: ModelTraceEventBase,
  type: 'reasoning-chunks' | 'text-chunks' | 'tool-call-chunks',
  parts: unknown,
  gaps: unknown,
  name?: unknown,
): ModelTraceEvent | null {
  const tool = type === 'tool-call-chunks'
  if (!Array.isArray(parts) || !parts.length || !parts.every(p => typeof p === 'string')
    || !Array.isArray(gaps) || gaps.length !== parts.length - 1 || !gaps.every(Number.isSafeInteger)) return null
  let time = location.time
  const fragments: ReasoningFragment[] = []
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) time += gaps[i - 1] as number
    if (!Number.isSafeInteger(time)) return null
    const text = parts[i] as string
    if (text !== '' || (tool && typeof name === 'string')) fragments.push({ seq: location.seq + i, time, text })
  }
  const first = fragments[0]
  if (!first) return null
  const base = { ...location, time: first.time, lastSeq: location.seq + parts.length - 1 }
  return type === 'reasoning-chunks'
    ? { ...base, kind: 'reasoning-delta', text: fragments.map(f => f.text).join(''), fragments }
    : { ...base, kind: 'output-delta' }
}

function streamEventsOf(base: ModelTraceEventBase, stream: unknown): ModelTraceEvent[] {
  if (!Array.isArray(stream)) return []
  const events: ModelTraceEvent[] = []
  let seq = base.seq
  for (const record of stream) {
    if (!isRecord(record) || typeof record.type !== 'string') continue
    if (record.type === 'chunk') {
      const time = finiteNumber(record.time)
      if (time === null) continue
      const event = chunkEventOf({ ...base, seq, time }, record.chunk)
      if (event !== null) {
        events.push(event)
        seq += 1
      }
      continue
    }
    if (record.type !== 'reasoning-chunks' && record.type !== 'text-chunks' && record.type !== 'tool-call-chunks') {
      continue
    }
    const time0 = finiteNumber(record.time0)
    if (time0 === null) continue
    const event = packedRunEventOf(
      { ...base, seq, time: time0 },
      record.type,
      record.type === 'tool-call-chunks' ? record.args : record.texts,
      record.dt,
      record.name,
    )
    if (event !== null) {
      events.push(event)
      seq = (event.lastSeq ?? event.seq) + 1
    }
  }
  return events
}

function messageEventOf(location: ModelTraceEventBase, data: Record<string, unknown>): ModelTraceEvent {
  return {
    ...location,
    kind: 'message',
    reasoningText: reasoningTextOf(data.message),
    reasoningTokens: reasoningTokensOf(data.usage),
  }
}

/** Expand one Session/Conversation value into the model-stage events it carries. */
export function modelTraceEventsOf(value: unknown): ModelTraceEvent[] {
  if (!isRecord(value) || typeof value.type !== 'string') return []
  const location = locationOf(value)
  if (location === null || !isRecord(value.data)) return []
  const data = value.data

  if (value.type === 'step/start') return [{ ...location, kind: 'step-start' }]
  if (value.type === 'step/end') return [{ ...location, kind: 'step-end' }]
  if (value.type === 'llm/retry') {
    const retry = nonNegativeNumber(data.retry)
    const delayMs = nonNegativeNumber(data.delayMs)
    return retry === null || delayMs === null ? [] : [{ ...location, kind: 'retry', retry, delayMs }]
  }
  if (value.type === 'assistant/attempt') return streamEventsOf(location, data.stream)
  if (value.type === 'assistant/message') {
    return [...streamEventsOf(location, data.stream), messageEventOf(location, data)]
  }
  // RC1 historical chunkrow envelopes preserve fragment times and sequence identities.
  if (value.type === 'chunkrow/reasoning-chunks' || value.type === 'chunkrow/text-chunks' || value.type === 'chunkrow/tool-call-chunks') {
    const event = packedRunEventOf(
      location,
      value.type === 'chunkrow/reasoning-chunks'
        ? 'reasoning-chunks'
        : value.type === 'chunkrow/text-chunks'
          ? 'text-chunks'
          : 'tool-call-chunks',
      value.type === 'chunkrow/tool-call-chunks' ? data.args : data.texts,
      data.dt,
      data.name,
    )
    return event === null ? [] : [event]
  }
  if (value.type === 'assistant/live-chunk') {
    const event = chunkEventOf(location, data.chunk)
    return event === null ? [] : [event]
  }
  return []
}

/** Parse only the first model-stage event carried by one value. */
export function modelTraceEventOf(value: unknown): ModelTraceEvent | null {
  return modelTraceEventsOf(value)[0] ?? null
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
  if (event.kind === 'message') {
    const reasoningTokens = event.reasoningTokens ?? trace.reasoningTokens
    if (attempt.kind !== 'running') return { ...current, reasoningTokens }
    return {
      ...current,
      reasoningTokens,
      attempts: replaceLast(trace.attempts, {
        ...attempt,
        kind: 'complete',
        endedAt: event.time,
        reasoningText: event.reasoningText ?? attempt.reasoningText,
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
    for (const event of modelTraceEventsOf(value)) {
      const key = `${event.turn}:${event.step}`
      const current = traces.get(key)
      if (event.kind === 'step-start') {
        traces.set(key, startModelStepTrace(event))
        continue
      }
      const trace = current ?? partialModelStepTrace(event)
      traces.set(key, updateModelStepTrace(trace, event))
    }
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
