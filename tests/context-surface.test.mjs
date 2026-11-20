import assert from 'node:assert/strict'
import { test } from 'vitest'
import { initialState, reduceEvent, viewOf } from '../src/insights/engine.mjs'
import { contextReadingOf } from '../src/client/context-reading.ts'

// Issue #43. Builders follow the event shapes Harness 0.2.0-0.2.2 records:
// `user/message` carries the UserMessage itself as `data`; the other surface
// types wrap it in `data.message`; every surface event has a top-level
// `surfaceOp`; compaction lands as `compaction/summary` (or `compaction/prune`)
// followed by a checkpoint that replaces a positional range. The text is filler.
const price = content => Math.ceil(JSON.stringify(content).length / 4) + 4
const text = n => [{ type: 'text', text: 'x'.repeat(n) }]
const usage = { inputTokens: 100, outputTokens: 10, totalTokens: 110 }

function log() {
  const rows = []
  let seq = 0
  const add = (type, data, extra = {}) => {
    const row = { type, seq, time: seq * 10, data, ...extra }
    rows.push(row)
    seq += 1
    return row.seq
  }
  return {
    rows,
    header: () => add('request/header', { header: { config: { provider: 'p', model: 'm' }, tools: [{ name: 'bash' }] } }),
    system: n => add('system/message', { turn: 0, step: 0, message: { role: 'system', content: text(n) } }, { surfaceOp: 'append' }),
    // Pending input queue only: the same message reaches the surface later as its own user/message.
    queue: () => add('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [{ id: `q${seq}`, role: 'user', source: { kind: 'user' }, content: text(10) }] }),
    consume: () => add('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1, inserted: [] }),
    user: n => add('user/message', { id: `u${seq}`, role: 'user', source: { kind: 'user' }, content: text(n) }, { surfaceOp: 'append' }),
    turn: (turn, body) => {
      add('turn/start', { turn })
      add('step/start', { turn, step: 1 })
      const seqs = body(turn)
      add('step/end', { turn, step: 1 })
      add('turn/end', { turn })
      return seqs
    },
    reply: (turn, n) => add('assistant/message', { turn, step: 1, stream: [], usage, message: { id: `a${seq}`, role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: text(n) } }, { surfaceOp: 'append' }),
    result: (turn, n, surfaceOp = 'append') => add('tool/result', { turn, step: 1, message: { id: `r${seq}`, role: 'user', source: { kind: 'tool', callId: `c${seq}` }, content: [{ type: 'tool-result', toolCallId: `c${seq}`, isError: false, content: text(n) }] } }, { surfaceOp, sourceEventSeqs: [] }),
    prune: seq => add('compaction/prune', { shadowedRange: { start: seq, end: seq }, shadowedSeqs: [seq], shadowedTokenCount: 1 }),
    compact: (start, end, shadowed, n) => {
      add('compaction/summary', { compactionId: `c${seq}`, shadowedRange: { start, end }, shadowedSeqs: shadowed, shadowedTokenCount: 1, summary: 'filler', provider: 'p', model: 'm' })
      return add('user/message', { id: `k${seq}`, role: 'user', source: { kind: 'plugin', plugin: 'compaction-basic', compactionId: `c${seq}` }, content: text(n) },
        { surfaceOp: { op: 'replace', startSeq: start, endSeq: end }, sourceEventSeqs: shadowed })
    },
  }
}
const fold = (rows, state = initialState({ id: 's' })) => rows.reduce(reduceEvent, state)
const totalAt = (rows, seq) => viewOf(fold(rows.filter(r => r.seq <= seq))).context.projected

test('user messages in the recorded shape price into the surface', () => {
  const l = log()
  l.header()
  const u = l.turn(1, () => l.user(400))
  const v = viewOf(fold(l.rows))
  assert.equal(u, 3)
  assert.equal(v.context.surface.conversation, price(text(400)))
})

test('a multi-turn session with two compactions falls each time (issue #43)', () => {
  const l = log()
  l.header()
  l.system(200)
  const turns = []
  const exchange = t => [l.user(2000), l.result(t, 8000), l.reply(t, 1000)]
  for (let turn = 1; turn <= 4; turn++) {
    l.queue(); l.consume()
    turns.push(l.turn(turn, exchange))
  }
  const beforeFirst = totalAt(l.rows, l.rows.at(-1).seq)
  // Compaction keeps the newest turn: the checkpoint lands in front of turn 4.
  const shadowed = turns.slice(0, 3).flat()
  const checkpoint = l.compact(shadowed[0], shadowed.at(-1), shadowed, 600)
  const afterFirst = totalAt(l.rows, checkpoint)
  for (let turn = 5; turn <= 6; turn++) turns.push(l.turn(turn, exchange))
  const beforeSecond = totalAt(l.rows, l.rows.at(-1).seq)
  // The next compaction starts at that checkpoint and ends in turn 4, whose
  // seqs are LOWER than the checkpoint's (the issue's 1196→25 ranges): the
  // range is positional, not a seq interval.
  const kept = turns[3]
  assert.ok(checkpoint > kept.at(-1))
  const second = l.compact(checkpoint, kept.at(-1), [checkpoint, ...kept], 700)
  const s = fold(l.rows)
  const v = viewOf(s)
  assert.ok(afterFirst < beforeFirst / 2, `${afterFirst} should fall well below ${beforeFirst}`)
  assert.ok(v.context.projected < beforeSecond * 0.75, `${v.context.projected} should fall below ${beforeSecond}`)
  assert.equal(v.context.projected, v.context.surface.total)
  assert.equal(v.context.surface.partial, false)
  // Exactly what the model now sees: system prompt, one checkpoint, turns 5-6.
  assert.deepEqual(s.surfaceNodes.map(n => n.seq), [1, second, ...turns[4], ...turns[5]])
  assert.equal(v.context.surface.system, price(text(200)))
  assert.equal(v.context.surface.conversation, price(text(700)) + 2 * (price(text(2000)) + price(text(1000))))
  assert.ok(v.context.surface.tools > 0)
  // The request after a compaction prices the shrunken prompt it was sent with.
  const rows = v.requests
  assert.ok(rows.at(-1).surface.total < rows.at(-3).surface.total)
})

test('inbox splices are the pending queue and never move the surface', () => {
  const l = log()
  l.header()
  l.turn(1, () => [l.user(400)])
  const before = viewOf(fold(l.rows)).context
  l.queue(); l.consume(); l.queue()
  const after = viewOf(fold(l.rows)).context
  assert.deepEqual(after, before)
})

test('a tool-result prune swaps one node in place', () => {
  const l = log()
  l.header()
  const [result, reply] = l.turn(1, t => [l.result(t, 8000), l.reply(t, 100)])
  l.prune(result)
  const pruned = l.result(1, 10, { op: 'replace', startSeq: result, endSeq: result })
  const s = fold(l.rows)
  assert.deepEqual(s.surfaceNodes.map(n => n.seq), [pruned, reply])
  assert.equal(viewOf(s).context.surface.results, price([{ type: 'tool-result', toolCallId: `c${pruned}`, isError: false, content: text(10) }]))
})

test('a replace reaching into history the fold never held marks the estimate partial', () => {
  const l = log()
  for (let i = 0; i < 4; i++) l.user(100)
  const kept = l.user(100)
  const checkpoint = l.compact(1, kept, [1, 2, 3, 4, kept], 50)
  // Seqs below 4 are an inherited prefix: skipped, so the range start is missing.
  const s = fold(l.rows, initialState({ id: 'fork' }, 4))
  assert.deepEqual(s.surfaceNodes.map(n => n.seq), [checkpoint])
  assert.equal(viewOf(s).context.surface.conversation, price(text(50)))
  assert.equal(viewOf(s).context.surface.partial, true)
})

test('a replace whose range cannot be placed appends and marks partial', () => {
  const l = log()
  const a = l.user(100)
  const checkpoint = l.compact(a, 99, [a], 50)
  const s = fold(l.rows)
  assert.deepEqual(s.surfaceNodes.map(n => n.seq), [a, checkpoint])
  assert.equal(viewOf(s).context.surface.partial, true)
})

test('the node cap keeps positions and marks the estimate partial', () => {
  const l = log()
  for (let i = 0; i < 3002; i++) l.user(1)
  const s = fold(l.rows)
  assert.equal(s.surfaceNodes.length, 3000)
  assert.equal(s.surfaceNodes[0].seq, 2)
  assert.equal(viewOf(s).context.surface.partial, true)
  assert.equal(viewOf(s).context.projected, 3000 * price(text(1)))
})

const context = { window: 1000000, surface: { system: 1, tools: 1, memory: 0, files: 0, results: 0, conversation: 554000, total: 556000, partial: false }, projected: 556000 }

test('the host context meter wins over the fold and stays an estimate when projected', () => {
  assert.deepEqual(contextReadingOf(context, { pressureTokens: 170000, projectedTokens: 175000, contextWindow: 1000000 }),
    { tokens: 175000, window: 1000000, exact: false, source: 'host', partial: false })
})

test('only an unmoved provider-reported prompt reads as exact', () => {
  assert.equal(contextReadingOf(context, { pressureTokens: 175000, projectedTokens: 175000 }).exact, true)
  assert.deepEqual(contextReadingOf(context, { pressureTokens: 175000 }),
    { tokens: 175000, window: 1000000, exact: true, source: 'host', partial: false })
})

test('without a host reading the fold is the estimate, partial included', () => {
  assert.deepEqual(contextReadingOf(context, undefined),
    { tokens: 556000, window: 1000000, exact: false, source: 'estimate', partial: false })
  const partial = { ...context, surface: { ...context.surface, partial: true } }
  assert.equal(contextReadingOf(partial, { contextWindow: 1000000 }).partial, true)
  assert.equal(contextReadingOf(partial, { pressureTokens: -1, projectedTokens: 1.5 }).source, 'estimate')
  assert.equal(contextReadingOf(undefined, null), null)
  assert.deepEqual(contextReadingOf(null, { projectedTokens: 10, contextWindow: 0 }),
    { tokens: 10, window: null, exact: false, source: 'host', partial: false })
})
