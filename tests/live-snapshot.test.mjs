import assert from 'node:assert/strict'
import test from 'node:test'
import { foldSnapshot, mergeObservedPictures } from '../lib/types/observation/fold.js'

function toolResultNode() {
  return {
    kind: 'tool-result',
    seq: 12,
    time: 20_000,
    callId: 'call-1',
    call: { name: 'bash', argsRaw: '{"command":"pnpm test"}' },
    callTime: 10_000,
    content: [{ type: 'text', text: 'done' }],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
  }
}

function snapshotWithToolLocation() {
  const node = toolResultNode()
  return {
    blank: false,
    running: false,
    hasMore: false,
    pending: [],
    runningCalls: [],
    nodes: [node],
    turnTimings: new Map([[2, { startTime: 8_000, endTime: 22_000 }]]),
    views: {
      get: target => target === 'trajectory'
        ? { eventNodes: [node], eventLocations: new Map() }
        : undefined,
    },
    chat: {
      timeline: {
        turnOrder: [2],
        turns: new Map([[2, {
          start: { time: 9_000 },
          end: { time: 21_000 },
          steps: [{ step: 4, start: { time: 10_000 }, end: { time: 20_500 } }],
        }]]),
      },
      locations: {
        getStep: (turn, step) => turn === 2 && step === 4 ? ['tool:call-1'] : [],
      },
      nodes: {
        get: key => key === 'tool:call-1'
          ? {
              anchorSeq: 11,
              data: { root: node },
            }
          : undefined,
      },
    },
  }
}

test('live tool results keep the official Chat step when Trajectory has no event location', () => {
  const picture = foldSnapshot(snapshotWithToolLocation())

  assert.deepEqual(picture.turns.map(turn => turn.turn), [2])
  assert.equal(picture.turns.some(turn => turn.turn === 0), false)
  assert.equal(picture.turns[0].groups[0].steps[0].step, 4)
  assert.equal(picture.turns[0].startTime, 9_000)
  assert.equal(picture.turns[0].endTime, 21_000)
  assert.equal(picture.turns[0].groups[0].steps[0].startTime, 10_000)
  assert.equal(picture.turns[0].groups[0].steps[0].endTime, 20_500)
})

test('loading the final older page clears partial-history state after observation merge', () => {
  const partial = foldSnapshot({ ...snapshotWithToolLocation(), hasMore: true })
  const complete = foldSnapshot({ ...snapshotWithToolLocation(), hasMore: false })

  assert.equal(partial.partialHistory, true)
  assert.equal(mergeObservedPictures(partial, complete).partialHistory, false)
})
