import assert from 'node:assert/strict'
import test from 'node:test'
import {
  deriveTurnPerformance,
  deriveSessionTiming,
  formatTokensPerSecond,
  groupElapsedMs,
  itemElapsedMs,
  stepElapsedMs,
  turnElapsedReading,
  turnElapsedMs,
} from '../lib/types/observation/performance.js'

function assistant(turn, step, timing, usage) {
  return {
    kind: 'assistant',
    seq: turn * 100 + step,
    time: timing?.completedTime ?? 0,
    turn,
    step,
    blocks: [],
    ...(timing === undefined ? {} : { timing }),
    ...(usage === undefined ? {} : { usage }),
  }
}

function workTurn(turn, toolDurations = []) {
  return {
    turn,
    status: 'success',
    startTime: null,
    endTime: null,
    groups: [{
      items: [
        ...toolDurations.map(durationMs => ({ source: 'tool', durationMs })),
        { source: 'interaction', durationMs: 9_999 },
        { source: 'tool', durationMs: null },
      ],
    }],
  }
}

test('performance keeps model, tool, TTFT, and decode evidence separate', () => {
  const nodes = [
    assistant(1, 2, { stepStartTime: 10_000, firstTokenTime: 11_000, completedTime: 15_000 }, { outputTokens: 40 }),
    assistant(1, 1, { stepStartTime: 1_000, firstTokenTime: 1_500, completedTime: 5_500 }, { outputTokens: 20 }),
  ]
  const turn = { ...workTurn(1, [2_000, 3_000]), startTime: 0, endTime: 60_000 }
  const metric = deriveTurnPerformance(nodes, [turn]).get(1)

  assert.equal(metric.modelMs, 9_500)
  assert.equal(metric.toolMs, 5_000)
  assert.equal(metric.ttftMs, 500)
  assert.deepEqual(metric.throughput, {
    kind: 'measured',
    decodeMs: 8_000,
    outputTokens: 60,
    tokensPerSecond: 7.5,
  })
})

test('token speed requires provider usage and positive decode time', () => {
  const nodes = [
    assistant(2, 1, { stepStartTime: 1_000, firstTokenTime: 1_500, completedTime: 2_500 }, { outputTokens: '30' }),
    assistant(2, 2, { stepStartTime: 3_000, firstTokenTime: 3_500, completedTime: 3_500 }, { outputTokens: 20 }),
  ]
  const metric = deriveTurnPerformance(nodes, [workTurn(2)]).get(2)

  assert.equal(metric.modelMs, 2_000)
  assert.equal(metric.toolMs, null)
  assert.equal(metric.ttftMs, 500)
  assert.deepEqual(metric.throughput, { kind: 'unavailable' })
})

test('a measured zero-token decode is zero speed rather than missing data', () => {
  const metric = deriveTurnPerformance([
    assistant(3, 1, { stepStartTime: 1_000, firstTokenTime: 1_200, completedTime: 2_200 }, { outputTokens: 0 }),
  ], [workTurn(3)]).get(3)

  assert.equal(metric.throughput.kind, 'measured')
  assert.equal(metric.throughput.tokensPerSecond, 0)
})

test('the lowest visible step owns TTFT even when its timing is unavailable', () => {
  const metric = deriveTurnPerformance([
    assistant(4, 2, { stepStartTime: 2_000, firstTokenTime: 2_300, completedTime: 3_000 }, { outputTokens: 7 }),
    assistant(4, 1, { stepStartTime: null, firstTokenTime: 1_500, completedTime: 2_000 }, { outputTokens: 5 }),
  ], [workTurn(4)]).get(4)

  assert.equal(metric.ttftMs, null)
})

test('token speed formatting matches the RC8 conversation chrome', () => {
  assert.equal(formatTokensPerSecond(34.4), '34')
  assert.equal(formatTokensPerSecond(9.96), '10')
  assert.equal(formatTokensPerSecond(3.14), '3.1')
  assert.equal(formatTokensPerSecond(-1), '0')
})

test('elapsed time is live only for the current unfinished conversation turn', () => {
  const settled = { ...workTurn(5), startTime: 1_000, endTime: 4_500 }
  const running = { ...workTurn(6), groups: [], startTime: 2_000, endTime: null }

  assert.equal(turnElapsedMs(settled, false, 99_000), 3_500)
  assert.equal(turnElapsedMs(running, true, 7_000), 5_000)
  assert.equal(turnElapsedMs(running, false, 7_000), null)
  assert.equal(turnElapsedMs({ ...running, startTime: 8_000 }, true, 7_000), 0)
})

test('session wall clock separates Turn intervals from time between Turns', () => {
  const first = { ...workTurn(1), startTime: 0, endTime: 6 * 60_000 }
  const second = { ...workTurn(2), startTime: 20 * 60_000, endTime: 30 * 60_000 }
  const timing = deriveSessionTiming({
    turns: [first, second],
    nodes: first.groups,
    running: false,
    partialHistory: false,
  }, 99 * 60_000)

  assert.deepEqual(timing, {
    kind: 'measured',
    coverage: 'complete',
    startTime: 0,
    endTime: 30 * 60_000,
    elapsedMs: 30 * 60_000,
    activeTurnMs: 16 * 60_000,
    betweenTurnMs: 14 * 60_000,
  })
})

test('a clipped Turn start is shown as a lower bound and partial session window', () => {
  const group = {
    ...workTurn(3).groups[0],
    startTime: 5_000,
    endTime: 20_000,
    items: [{ source: 'tool', time: 6_000, resultTime: 19_000, durationMs: 13_000 }],
  }
  const turn = { ...workTurn(3), groups: [group], startTime: null, endTime: 21_000 }
  const picture = { turns: [turn], nodes: [group], running: false, partialHistory: true }

  assert.deepEqual(turnElapsedReading(turn, false, 99_000), { kind: 'lower-bound', durationMs: 16_000 })
  assert.equal(deriveSessionTiming(picture, 99_000).coverage, 'partial')
})

test('phase, Step, and running execution expose their own elapsed time', () => {
  const group = { startTime: 1_000, endTime: 9_000 }
  const step = { startTime: 2_000, endTime: 8_000 }
  const runningItem = { durationMs: null, time: 4_000 }

  assert.equal(groupElapsedMs(group, false, 20_000), 8_000)
  assert.equal(stepElapsedMs(step, false, 20_000), 6_000)
  assert.equal(itemElapsedMs(runningItem, true, 20_000), 16_000)
})
