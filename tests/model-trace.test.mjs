import assert from 'node:assert/strict'
import test from 'node:test'
import {
  foldModelTraceEvents,
  modelStageMetrics,
} from '../lib/types/observation/model-trace.js'

function message(seq, time, { reasoning = '', reasoningTokens } = {}) {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'assistant',
        content: [
          ...(reasoning === '' ? [] : [{ type: 'reasoning', text: reasoning }]),
          { type: 'text', text: 'done' },
        ],
      },
      ...(reasoningTokens === undefined ? {} : { usage: { inputTokens: 10, outputTokens: 20, reasoningTokens } }),
    },
  }
}

test('one model stage separates first response, visible reasoning, and output generation', () => {
  const traces = foldModelTraceEvents([
    { type: 'step/start', seq: 1, time: 0, data: { turn: 1, step: 1 } },
    { type: 'assistant/chunk', seq: 2, time: 4_000, data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'inspect ' } } },
    { type: 'assistant/chunk', seq: 3, time: 6_000, data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'evidence' } } },
    { type: 'assistant/chunk', seq: 4, time: 7_000, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 1, text: 'done' } } },
    message(5, 8_000, { reasoning: 'inspect evidence', reasoningTokens: 12 }),
  ])
  const trace = traces.get('1:1')

  assert.ok(trace)
  assert.equal(trace.attempts.length, 1)
  assert.equal(trace.attempts[0].kind, 'complete')
  assert.equal(trace.attempts[0].reasoningText, 'inspect evidence')
  assert.equal(trace.attempts[0].fragments.length, 2)
  assert.equal(trace.reasoningTokens, 12)
  assert.deepEqual(modelStageMetrics(trace, 99_000), {
    kind: 'measured',
    live: false,
    totalMs: 8_000,
    firstResponseMs: 4_000,
    visibleReasoningMs: 2_000,
    outputMs: 2_000,
    unattributedMs: 0,
  })
})

test('reasoning content without chunk timestamps stays readable without invented segment time', () => {
  const trace = foldModelTraceEvents([
    { type: 'step/start', seq: 1, time: 1_000, data: { turn: 1, step: 1 } },
    message(2, 6_000, { reasoning: 'provider returned only a final reasoning block' }),
  ]).get('1:1')

  assert.ok(trace)
  assert.equal(trace.attempts[0].reasoningText, 'provider returned only a final reasoning block')
  assert.equal(trace.attempts[0].firstReasoningTime, null)
  assert.deepEqual(modelStageMetrics(trace, 99_000), {
    kind: 'measured',
    live: false,
    totalMs: 5_000,
    firstResponseMs: null,
    visibleReasoningMs: null,
    outputMs: null,
    unattributedMs: 5_000,
  })
})

test('a clipped model trace anchors identity to its first observed event', () => {
  const trace = foldModelTraceEvents([
    { type: 'assistant/chunk', seq: 8, time: 4_000, data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'first ' } } },
    { type: 'assistant/chunk', seq: 9, time: 5_000, data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'observed' } } },
  ]).get('1:1')

  assert.ok(trace)
  assert.equal(trace.startSeq, 8)
  assert.equal(trace.lastSeq, 9)
  assert.equal(trace.startTime, null)
})

test('provider retries preserve each exposed reasoning attempt instead of overwriting it', () => {
  const trace = foldModelTraceEvents([
    { type: 'step/start', seq: 1, time: 0, data: { turn: 1, step: 1 } },
    { type: 'assistant/chunk', seq: 2, time: 1_000, data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'first attempt' } } },
    { type: 'llm/retry', seq: 3, time: 2_500, data: { turn: 1, step: 1, retry: 1, delayMs: 1_000, failure: { message: 'temporary', code: 'retry' }, mode: 'normal', maxRetries: 2 } },
    { type: 'assistant/chunk', seq: 4, time: 4_000, data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'second attempt' } } },
    { type: 'assistant/chunk', seq: 5, time: 4_500, data: { turn: 1, step: 1, chunk: { type: 'tool-call-delta', index: 1, id: 'call', name: 'bash', argumentsDelta: '{' } } },
    message(6, 5_000, { reasoning: 'second attempt' }),
  ]).get('1:1')

  assert.ok(trace)
  assert.equal(trace.attempts.length, 2)
  assert.equal(trace.attempts[0].kind, 'retried')
  assert.equal(trace.attempts[0].retryDelayMs, 1_000)
  assert.equal(trace.attempts[0].reasoningText, 'first attempt')
  assert.equal(trace.attempts[1].kind, 'complete')
  assert.equal(trace.attempts[1].reasoningText, 'second attempt')
  assert.deepEqual(modelStageMetrics(trace, 99_000), {
    kind: 'measured',
    live: false,
    totalMs: 5_000,
    firstResponseMs: 1_000,
    visibleReasoningMs: 0,
    outputMs: 1_000,
    unattributedMs: 3_000,
  })
})

test('an open model stage advances only when the caller supplies a live clock', () => {
  const trace = foldModelTraceEvents([
    { type: 'step/start', seq: 1, time: 2_000, data: { turn: 1, step: 1 } },
    { type: 'assistant/chunk', seq: 2, time: 3_000, data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'still thinking' } } },
  ]).get('1:1')

  assert.ok(trace)
  assert.deepEqual(modelStageMetrics(trace, 8_000), {
    kind: 'measured',
    live: true,
    totalMs: 6_000,
    firstResponseMs: 1_000,
    visibleReasoningMs: 5_000,
    outputMs: null,
    unattributedMs: 0,
  })
})
