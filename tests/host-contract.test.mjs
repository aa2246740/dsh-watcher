import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
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

test('the load marker is printed only after registration resolves', async () => {
  const lines = []
  const original = console.log
  console.log = (...args) => { lines.push(args.map(String).join(' ')) }
  try {
    const failure = new Error('stateVersion conflict')
    const rejected = hostContext(() => Object.assign(() => {}, {
      then: (resolve, reject) => Promise.reject(failure).then(resolve, reject),
    }))
    await assert.rejects(apply(rejected.ctx), failure)
    assert.equal(lines.includes('[my-plugins/dsh-watcher] loaded'), false)
    lines.length = 0
    const { ctx } = hostContext(() => () => {})
    await apply(ctx)
    assert.equal(lines.includes('[my-plugins/dsh-watcher] loaded'), true)
  } finally {
    console.log = original
  }
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
  // Same inputs and results as Harness 0.2.2-rc.5
  // packages/client/ui-primitives/tests/overlay-top-margin.client.spec.ts
  // (`--dsh-frame-top-clearance: 40px` parses as 40).
  assert.equal(overlayTopMargin(12, Number.NaN, false), 12)
  assert.equal(overlayTopMargin(12, 40, false), 60)
  assert.equal(overlayTopMargin(12, 40, false, { top: 10, bottom: 24 }, 4), 28)
  assert.equal(overlayTopMargin(12, 40, false, { top: -10, bottom: 24 }, 4), 60)
  assert.equal(overlayTopMargin(12, 40, false, { top: 0, bottom: 4 }, 4), 12)
  assert.equal(overlayTopMargin(80, 40, false), 80)
  assert.equal(overlayTopMargin(12, 40, true), 20)
})

test('the anchored-position copy carries the DeepSeek MIT notice into the client bundle', async () => {
  const source = await readFile(new URL('../src/client/anchored-position.ts', import.meta.url), 'utf8')
  const notices = await readFile(new URL('../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8')
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  for (const text of [source, bundle]) {
    assert.match(text, /Copyright \(c\) 2026 DeepSeek/)
    assert.match(text, /SPDX-License-Identifier: MIT/)
    assert.match(text, /useAnchoredPosition\.ts/)
    assert.match(text, /overlay-top-margin\.ts/)
  }
  assert.match(notices, /Copyright \(c\) 2026 DeepSeek/)
  assert.match(notices, /Permission is hereby granted/)
  assert.ok(pkg.files.includes('THIRD_PARTY_NOTICES.md'))
})

test('every primitives name the built client reads is exported by the installed package', async () => {
  const bundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const binding = bundle.match(/let (\w+) = require\("@deepseek-ai\/dsh-client-ui-primitives"\)/)
  assert.ok(binding, 'lib/client.js requires @deepseek-ai/dsh-client-ui-primitives')
  const names = new Set()
  for (const match of bundle.matchAll(new RegExp(`\\b${binding[1]}\\.([A-Za-z_$][\\w$]*)`, 'g'))) names.add(match[1])
  assert.ok(names.size > 0)
  const require = createRequire(import.meta.url)
  const entry = await readFile(require.resolve('@deepseek-ai/dsh-client-ui-primitives'), 'utf8')
  const exported = new Set()
  for (const block of entry.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of block[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (name) exported.add(name)
    }
  }
  for (const name of names) assert.ok(exported.has(name), `${name} is read by lib/client.js and missing from the installed primitives exports`)
})

test('the client no longer imports primitives that 0.2.2-rc.5 removed', async () => {
  const source = await readFile(new URL('../src/client/Watcher.tsx', import.meta.url), 'utf8')
  const block = source.match(/import \{([^}]*)\} from '@deepseek-ai\/dsh-client-ui-primitives'/)
  assert.ok(block, 'Watcher still imports the injected primitives')
  assert.doesNotMatch(block[1], /\buseAnchoredPosition\b/)
  assert.match(source, /import \{ useAnchoredPosition \} from '\.\/anchored-position\.ts'/)
})
