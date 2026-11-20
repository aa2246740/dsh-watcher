import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'vitest'
import { apply, inject } from '../src/dsh-watcher.ts'
import { initialState, viewOf } from '../src/insights/engine.mjs'
import { overlayTopMargin, placeBelowAnchor } from '../src/client/anchored-position.ts'

/**
 * A fake host context. `register` returns what one Harness line returns:
 * - 0.2.2: an awaitable that yields a projection handle after an async handoff;
 * - 0.2.1: the Cordis effect disposer, a thenable resolving to a plain disposer;
 * - 0.2.0-rc.2: a plain disposer function.
 */
function hostContext(register) {
  const log = { definitions: [], snapshots: [], ready: false }
  const session = { id: 's1' }
  const ctx = {
    sessionProjections: {
      register: definition => {
        log.definitions.push(definition)
        return register(log)
      },
      snapshot: (target, keys) => {
        log.snapshots.push({ target, keys, ready: log.ready })
        return { asOfSeq: -1, values: {} }
      },
    },
    inject: (names, callback) => {
      assert.deepEqual(names, ['sessions'])
      callback({ sessions: { list: () => [session] }, sessionProjections: ctx.sessionProjections, logger: {} })
    },
  }
  return { ctx, log, session }
}

const handleAfterHandoff = log => {
  const handle = { stateOf: () => undefined, readerFor: () => () => undefined, dispose: async () => {} }
  const ready = delay(5).then(() => { log.ready = true; return handle })
  return Object.assign(() => ready.then(() => {}), { then: ready.then.bind(ready) })
}

test('0.2.2 registration is awaited before the plugin finishes loading and before warm-up', async () => {
  const { ctx, log, session } = hostContext(handleAfterHandoff)
  const loading = apply(ctx)
  assert.ok(loading instanceof Promise, 'apply returns a promise so the host can await activation')
  assert.equal(log.snapshots.length, 0, 'no read happens before registration is ready')
  await loading
  assert.equal(log.ready, true)
  assert.deepEqual(log.snapshots, [{ target: session, keys: ['watcherInsights'], ready: true }])
})

test('0.2.2 registration failure rejects plugin activation instead of being logged away', async () => {
  const failure = new Error('stateVersion conflict')
  const { ctx, log } = hostContext(() => Object.assign(() => {}, {
    then: (resolve, reject) => Promise.reject(failure).then(resolve, reject),
  }))
  await assert.rejects(apply(ctx), failure)
  assert.equal(log.snapshots.length, 0)
})

test('0.2.1 thenable disposer and 0.2.0-rc.2 plain disposer still load', async () => {
  const thenableDisposer = () => {
    const disposeAsync = () => {}
    return Object.assign(() => {}, { then: async (resolve, reject) => Promise.resolve(disposeAsync).then(resolve, reject) })
  }
  for (const register of [thenableDisposer, () => () => {}]) {
    const { ctx, log } = hostContext(register)
    await apply(ctx)
    assert.equal(log.definitions.length, 1)
    assert.deepEqual(log.snapshots.map(row => row.keys), [['watcherInsights']])
  }
})

test('the projection keeps its key, version, and Session-summary membership', async () => {
  const { ctx, log } = hostContext(() => () => {})
  await apply(ctx)
  const [definition] = log.definitions
  assert.deepEqual(inject, ['sessionProjections', 'sessions'])
  assert.equal(definition.key, 'watcherInsights')
  // 6: surface nodes are positional (issue #43); a version bump makes the host refold old caches.
  assert.equal(definition.stateVersion, 6)
  // Insights reads watcherInsights from session.list() rows; 0.2.2 drops keys declaring summary: false.
  assert.notEqual(definition.wire.summary, false)
  const state = definition.init({ id: 's1', cwd: '/w' }, 0)
  assert.deepEqual(state, initialState({ id: 's1', cwd: '/w' }, 0))
  assert.deepEqual(definition.wire.viewSchema.parse(definition.wire.view(state)), viewOf(state))
})

test('the panel anchors below its trigger and clamps like the retired Harness hook', () => {
  const base = { gap: 8, margin: 12, topMargin: 12, viewport: { width: 1000, height: 800 } }
  assert.deepEqual(
    placeBelowAnchor({ ...base, anchor: { left: 300, bottom: 40 }, panel: { width: 400, height: 300 } }),
    { left: 300, top: 48 },
  )
  assert.deepEqual(
    placeBelowAnchor({ ...base, anchor: { left: 900, bottom: 700 }, panel: { width: 400, height: 300 } }),
    { left: 588, top: 488 },
  )
  assert.deepEqual(
    placeBelowAnchor({ ...base, anchor: { left: 2, bottom: -50 }, panel: { width: 400, height: 300 } }),
    { left: 12, top: 12 },
  )
  // An unmeasured panel keeps the raw anchor coordinates.
  assert.deepEqual(
    placeBelowAnchor({ ...base, anchor: { left: 2, bottom: -50 }, panel: { width: 0, height: 0 } }),
    { left: 2, top: -42 },
  )
  assert.equal(overlayTopMargin(12, Number.NaN, false), 12)
  assert.equal(overlayTopMargin(12, 28, false), 48)
  assert.equal(overlayTopMargin(12, 28, true), 20)
  assert.equal(overlayTopMargin(30, 0, true), 30)
})

test('the client no longer imports primitives that 0.2.2-rc.5 removed', async () => {
  const source = await readFile(new URL('../src/client/Watcher.tsx', import.meta.url), 'utf8')
  const block = source.match(/import \{([^}]*)\} from '@deepseek-ai\/dsh-client-ui-primitives'/)
  assert.ok(block, 'Watcher still imports the injected primitives')
  assert.doesNotMatch(block[1], /\buseAnchoredPosition\b/)
  assert.match(source, /import \{ useAnchoredPosition \} from '\.\/anchored-position\.ts'/)
})
