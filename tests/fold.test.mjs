import assert from 'node:assert/strict'
import test from 'node:test'
import { foldEvents, pairTools, parseJsonl } from '../lib/types/observation/fold.js'

function call(seq, turn, step, callId, name, args) {
  return {
    type: 'tool/call',
    seq,
    time: seq * 100,
    data: { turn, step, callId, name, arguments: JSON.stringify(args) },
  }
}

function result(seq, turn, step, callId, text, options = {}) {
  return {
    type: 'tool/result',
    seq,
    time: seq * 100,
    data: {
      turn,
      step,
      message: {
        source: { kind: 'tool', callId },
        content: [{
          type: 'tool-result',
          content: [{ type: 'text', text }],
          isError: options.isError === true,
        }],
      },
      ...(options.meta === undefined ? {} : { meta: options.meta }),
      ...(options.resultView === undefined ? {} : { resultView: options.resultView }),
    },
  }
}

function allItems(picture) {
  return picture.nodes.flatMap(group => group.items)
}

test('different bash commands remain distinct parallel executions', () => {
  const events = [
    call(1, 1, 1, 'a', 'bash', { command: 'echo alpha' }),
    call(2, 1, 1, 'b', 'bash', { command: 'echo beta' }),
    result(3, 1, 1, 'a', '[exit code: 0]'),
    result(4, 1, 1, 'b', '[exit code: 0]'),
  ]
  const picture = foldEvents(events)
  const step = picture.turns[0].groups[0].steps[0]
  assert.equal(step.parallel, true)
  assert.equal(step.items.length, 2)
  assert.equal(picture.retryCount, 0)
  assert.equal(picture.iterationCount, 0)
  assert.notEqual(step.items[0].signature, step.items[1].signature)
})

test('an exact failed call followed by a clean repeat is a recovered retry', () => {
  const args = { command: 'pnpm test' }
  const events = [
    call(1, 1, 1, 'a', 'bash', args),
    result(2, 1, 1, 'a', '[exit code: 1]'),
    call(3, 1, 2, 'b', 'bash', args),
    result(4, 1, 2, 'b', '[exit code: 0]'),
  ]
  const picture = foldEvents(events)
  const items = allItems(picture).filter(item => item.source === 'tool')
  assert.equal(picture.retryCount, 1)
  assert.equal(items[1].retryOf, items[0].id)
  assert.equal(items[0].recoveredBy, items[1].id)
  assert.equal(picture.unconfirmedFailureCount, 0)
})

test('changed edits to the same file are iterations, not retries', () => {
  const events = [
    call(1, 1, 1, 'a', 'edit', { file_path: '/tmp/a.ts', old_string: 'a', new_string: 'b' }),
    result(2, 1, 1, 'a', 'edited'),
    call(3, 1, 2, 'b', 'edit', { file_path: '/tmp/a.ts', old_string: 'b', new_string: 'c' }),
    result(4, 1, 2, 'b', 'edited again'),
  ]
  const picture = foldEvents(events)
  const items = allItems(picture).filter(item => item.source === 'tool')
  assert.equal(picture.retryCount, 0)
  assert.equal(picture.iterationCount, 1)
  assert.equal(items[1].iterationIndex, 1)
})

test('visual grouping never crosses a Turn boundary', () => {
  const events = [
    call(1, 1, 1, 'a', 'read', { file_path: '/tmp/a.ts' }),
    result(2, 1, 1, 'a', 'a'),
    call(3, 2, 1, 'b', 'read', { file_path: '/tmp/b.ts' }),
    result(4, 2, 1, 'b', 'b'),
  ]
  const picture = foldEvents(events)
  assert.equal(picture.turnCount, 2)
  assert.equal(picture.nodes.length, 2)
  assert.deepEqual(picture.nodes.map(group => group.turn), [1, 2])
})

test('full raw output remains available beyond the old 900-character cap', () => {
  const text = 'x'.repeat(2400)
  const picture = foldEvents([
    call(1, 1, 1, 'a', 'bash', { command: 'long-output' }),
    result(2, 1, 1, 'a', text),
  ])
  const item = allItems(picture).find(value => value.callId === 'a')
  assert.equal(item.rawText.length, 2400)
  assert.equal(item.presentation.kind, 'terminal')
  assert.equal(item.presentation.output.length, 2400)
})

test('an orphan result remains visible with unknown status', () => {
  const orphan = result(2, 1, 1, 'missing-call', 'orphan payload')
  assert.equal(pairTools([orphan]).length, 1)
  const picture = foldEvents([orphan])
  assert.equal(picture.actionCount, 1)
  assert.equal(allItems(picture)[0].status, 'unknown')
})

test('inner structured exitCode drives failure instead of false green', () => {
  const picture = foldEvents([
    call(1, 1, 1, 'a', 'dshx_check', { name: 'demo' }),
    result(2, 1, 1, 'a', '{"exitCode":1,"output":"bad"}'),
  ])
  const item = allItems(picture).find(value => value.callId === 'a')
  assert.equal(item.exitCode, 1)
  assert.equal(item.status, 'failure')
})

test('a result without authoritative outcome stays neutral returned', () => {
  const picture = foldEvents([
    call(1, 1, 1, 'a', 'custom_tool', { value: 1 }),
    result(2, 1, 1, 'a', 'the tool returned some text'),
  ])
  assert.equal(allItems(picture).find(value => value.callId === 'a').status, 'returned')
})

test('an earlier failure remains evidence without becoming the current state forever', () => {
  const picture = foldEvents([
    call(1, 1, 1, 'a', 'bash', { command: 'pnpm test' }),
    result(2, 1, 1, 'a', '[exit code: 1]'),
    call(3, 1, 2, 'b', 'edit', { file_path: '/tmp/a.ts', old_string: 'a', new_string: 'b' }),
    result(4, 1, 2, 'b', '', { resultView: { card: 'diff', diffs: [{ path: '/tmp/a.ts', oldText: 'a', newText: 'b' }] } }),
  ])
  assert.equal(picture.unconfirmedFailureCount, 1)
  assert.equal(picture.now.status, 'success')
})

test('approval wait and user steering are first-class records', () => {
  const events = [
    { type: 'turn/start', seq: 1, time: 100, data: { turn: 1 } },
    { type: 'step/start', seq: 2, time: 200, data: { turn: 1, step: 1 } },
    call(3, 1, 1, 'a', 'edit', { file_path: '/tmp/a.ts', old_string: 'a', new_string: 'b' }),
    { type: 'approval/asked', seq: 4, time: 400, data: { id: 'approval-1', callId: 'a', toolName: 'edit' } },
    { type: 'approval/decided', seq: 5, time: 1900, data: { id: 'approval-1', outcome: 'allowed-once' } },
    result(6, 1, 1, 'a', 'edited'),
    {
      type: 'agent/inbox/spliced',
      seq: 7,
      time: 2000,
      data: {
        target: 'next-step',
        inserted: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '背景你可以自己生成' }] }],
      },
    },
  ]
  const picture = foldEvents(events)
  const items = allItems(picture)
  const interaction = items.find(item => item.source === 'interaction')
  const steering = items.find(item => item.source === 'steering')
  assert.equal(interaction.durationMs, 1500)
  assert.equal(interaction.status, 'returned')
  assert.equal(steering.rawText, '背景你可以自己生成')
})

test('assistant image blocks are preserved as artifacts', () => {
  const picture = foldEvents([{
    type: 'assistant/message',
    seq: 10,
    time: 1000,
    data: {
      turn: 1,
      step: 2,
      message: { content: [{ type: 'image', attachment: { hash: 'sha256:test', mimeType: 'image/png' } }] },
    },
  }])
  const artifact = allItems(picture).find(item => item.source === 'artifact')
  assert.equal(artifact.presentation.kind, 'image')
})

test('parseJsonl keeps complete lines and skips one torn append', () => {
  const events = parseJsonl('{"type":"turn/start","seq":1}\n{"type":')
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'turn/start')
})
