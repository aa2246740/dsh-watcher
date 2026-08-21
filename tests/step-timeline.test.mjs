import assert from 'node:assert/strict'
import test from 'node:test'
import { stepTimelineEntries } from '../lib/types/client/step-timeline.js'
import { foldEvents } from '../lib/types/observation/fold.js'

function entryLabel(entry) {
  return entry.kind === 'model' ? 'model' : entry.item.source
}

test('a first Step presents entered user input before model work and Agent output', () => {
  const picture = foldEvents([
    { type: 'turn/start', seq: 1, time: 100, data: { turn: 1 } },
    { type: 'step/start', seq: 2, time: 200, data: { turn: 1, step: 1 } },
    {
      type: 'user/message',
      seq: 3,
      time: 210,
      data: {
        source: { kind: 'user' },
        content: [{ type: 'text', text: '请检查这个插件' }],
      },
    },
    {
      type: 'assistant/chunk',
      seq: 4,
      time: 800,
      data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '先读取代码' } },
    },
    {
      type: 'assistant/message',
      seq: 5,
      time: 1_200,
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: '先读取代码' },
            { type: 'text', text: '检查完成' },
          ],
        },
      },
    },
    { type: 'step/end', seq: 6, time: 1_210, data: { turn: 1, step: 1 } },
  ])
  const step = picture.turns[0].groups[0].steps[0]

  assert.deepEqual(stepTimelineEntries(step).map(entryLabel), ['user', 'model', 'assistant'])
})

test('a later Step with no entered input starts with its model stage', () => {
  const picture = foldEvents([
    { type: 'step/start', seq: 1, time: 100, data: { turn: 1, step: 2 } },
    {
      type: 'assistant/message',
      seq: 2,
      time: 200,
      data: {
        turn: 1,
        step: 2,
        message: { role: 'assistant', content: [{ type: 'text', text: '继续执行' }] },
      },
    },
  ])
  const step = picture.turns[0].groups[0].steps[0]

  assert.deepEqual(stepTimelineEntries(step).map(entryLabel), ['model', 'assistant'])
})

test('steering queued during a live Step does not move ahead of its running model', () => {
  const picture = foldEvents([
    { type: 'step/start', seq: 1, time: 100, data: { turn: 1, step: 1 } },
    {
      type: 'assistant/chunk',
      seq: 2,
      time: 200,
      data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: '正在处理' } },
    },
    {
      type: 'agent/inbox/spliced',
      seq: 3,
      time: 300,
      data: {
        target: 'next-step',
        inserted: [{ source: { kind: 'user' }, content: [{ type: 'text', text: '再补充一点' }] }],
      },
    },
    {
      type: 'assistant/message',
      seq: 4,
      time: 400,
      data: {
        turn: 1,
        step: 1,
        message: { role: 'assistant', content: [{ type: 'text', text: '当前步骤完成' }] },
      },
    },
  ])
  const step = picture.turns[0].groups[0].steps[0]

  assert.deepEqual(stepTimelineEntries(step).map(entryLabel), ['model', 'steering', 'assistant'])
})
