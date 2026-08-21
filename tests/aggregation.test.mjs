import assert from 'node:assert/strict'
import test from 'node:test'
import { clusterOutcomeSummary, clusterWorkItems } from '../lib/types/hub/aggregation.js'
import { normalizedSignature } from '../lib/types/observation/fold.js'

const item = ({
  id,
  title,
  toolName = 'bash',
  args = {},
  target = null,
  intentKey = null,
  status = 'success',
  step = 1,
  retryOf = null,
  iterationIndex = 0,
}) => ({
  id,
  seq: step,
  resultSeq: step + 100,
  time: step * 1000,
  resultTime: step * 1000 + 200,
  turn: 1,
  step,
  source: 'tool',
  phase: 'build',
  status,
  title,
  subtitle: target ?? title,
  toolName,
  callId: id,
  args,
  argsRaw: JSON.stringify(args),
  rawText: '',
  rawValue: null,
  presentation: { kind: 'empty' },
  durationMs: 200,
  exitCode: status === 'failure' ? 1 : 0,
  signal: null,
  signature: normalizedSignature(toolName, args),
  intentKey,
  target,
  retryOf,
  retryIndex: retryOf === null ? 0 : 1,
  iterationIndex,
  recoveredBy: null,
})

test('different Bash commands never merge merely because both are Bash', () => {
  const clusters = clusterWorkItems([
    item({ id: 'a', title: 'List source', args: { command: 'ls src' }, step: 1 }),
    item({ id: 'b', title: 'Run tests', args: { command: 'pnpm test' }, step: 2 }),
  ])

  assert.equal(clusters.length, 2)
  assert.deepEqual(clusters.map(cluster => cluster.items.map(value => value.id)), [['a'], ['b']])
})

test('an exact repeated call becomes one reversible cluster', () => {
  const args = { command: 'pnpm test' }
  const clusters = clusterWorkItems([
    item({ id: 'a', title: 'Run tests', args, step: 1, status: 'failure' }),
    item({ id: 'b', title: 'Run tests', args, step: 3, retryOf: 'a' }),
  ])

  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].basis, 'exact-call')
  assert.equal(clusters[0].executionCount, 2)
  assert.equal(clusters[0].stepCount, 2)
  assert.equal(clusters[0].retryCount, 1)
  assert.deepEqual(clusters[0].items.map(value => value.id), ['a', 'b'])
  assert.equal(clusterOutcomeSummary(clusters[0]), '1 成功 · 1 失败')
})

test('changed edits to one target group as iterations while preserving each version', () => {
  const intentKey = 'edit\u0000/work/package.json'
  const clusters = clusterWorkItems([
    item({
      id: 'edit-1',
      title: '修改 package.json',
      toolName: 'edit',
      args: { path: '/work/package.json', value: 'one' },
      target: '/work/package.json',
      intentKey,
      step: 4,
    }),
    item({
      id: 'edit-2',
      title: '修改 package.json',
      toolName: 'edit',
      args: { path: '/work/package.json', value: 'two' },
      target: '/work/package.json',
      intentKey,
      step: 5,
      iterationIndex: 1,
    }),
  ])

  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].basis, 'mutable-target')
  assert.equal(clusters[0].iterationCount, 1)
  assert.deepEqual(clusters[0].items.map(value => value.args.value), ['one', 'two'])
})

test('the same non-Bash target can group while different source reads stay exact inside', () => {
  const clusters = clusterWorkItems([
    item({
      id: 'read-1',
      title: '读取 package.json',
      toolName: 'read',
      args: { path: '/work/package.json', offset: 1 },
      target: '/work/package.json',
      step: 1,
    }),
    item({
      id: 'read-2',
      title: '读取 package.json',
      toolName: 'read',
      args: { path: '/work/package.json', offset: 40 },
      target: '/work/package.json',
      step: 2,
    }),
    item({
      id: 'read-3',
      title: '读取 tsconfig.json',
      toolName: 'read',
      args: { path: '/work/tsconfig.json' },
      target: '/work/tsconfig.json',
      step: 3,
    }),
  ])

  assert.equal(clusters.length, 2)
  assert.equal(clusters[0].basis, 'shared-target')
  assert.deepEqual(clusters[0].items.map(value => value.id), ['read-1', 'read-2'])
  assert.deepEqual(clusters[1].items.map(value => value.id), ['read-3'])
})

test('Glob and search calls with one shared cwd still require exact arguments', () => {
  const clusters = clusterWorkItems([
    item({
      id: 'glob-1',
      title: '查找 src/**/*',
      toolName: 'glob',
      args: { path: '/work', pattern: 'src/**/*' },
      target: '/work',
      step: 1,
    }),
    item({
      id: 'glob-2',
      title: '查找 tests/**/*',
      toolName: 'glob',
      args: { path: '/work', pattern: 'tests/**/*' },
      target: '/work',
      step: 2,
    }),
  ])

  assert.equal(clusters.length, 2)
  assert.deepEqual(clusters.map(cluster => cluster.items[0].id), ['glob-1', 'glob-2'])
})
