import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { foldEvents, parseJsonl } from '../lib/types/observation/fold.js'
import { deriveSessionTiming, turnElapsedReading } from '../lib/types/observation/performance.js'

const goldenRoot = process.env.WATCHER_GOLDEN_DIR

function itemsOf(picture) {
  return picture.nodes.flatMap(group => group.items)
}

async function replay(id) {
  const text = await readFile(join(goldenRoot, id, 'session.jsonl'), 'utf8')
  return foldEvents(parseJsonl(text))
}

test('celebration session replays without lossy grouping', { skip: goldenRoot === undefined }, async () => {
  const picture = await replay('cdde96b7')
  const items = itemsOf(picture)
  assert.equal(picture.actionCount, 265)
  assert.equal(picture.turnCount, 4)
  assert.equal(items.filter(item => item.source === 'interaction').length, 2)
  assert.ok(items.some(item => item.rawText.length > 900))
  assert.ok(picture.nodes.every(group => group.steps.every(step => step.turn === group.turn)))
  assert.equal(Object.hasOwn(picture, 'loops'), false)

  const longTurn = picture.turns.find(turn => turn.turn === 3)
  assert.ok(longTurn)
  assert.deepEqual(turnElapsedReading(longTurn, false, 0), { kind: 'exact', durationMs: 2_020_092 })
  assert.deepEqual(deriveSessionTiming(picture, 0), {
    kind: 'measured',
    coverage: 'complete',
    startTime: 1_787_195_024_007,
    endTime: 1_787_201_657_600,
    elapsedMs: 6_633_593,
    activeTurnMs: 3_276_689,
    betweenTurnMs: 3_356_904,
  })
})

test('Tetris session preserves orphan result, parallelism, steering, approvals, and images', { skip: goldenRoot === undefined }, async () => {
  const picture = await replay('1eade603')
  const items = itemsOf(picture)
  assert.equal(picture.actionCount, 116)
  assert.equal(picture.turnCount, 9)
  assert.ok(picture.parallelStepCount >= 30)
  assert.equal(items.filter(item => item.source === 'interaction').length, 16)
  assert.ok(items.filter(item => item.source === 'steering').length >= 3)
  assert.equal(items.filter(item => item.source === 'artifact').length, 7)
  assert.equal(items.filter(item => item.toolName === null && item.callId === 'missing-call').length, 0)
  assert.ok(items.some(item => item.source === 'tool' && item.toolName === null))
  assert.ok(picture.nodes.every(group => group.steps.every(step => step.turn === group.turn)))
})
