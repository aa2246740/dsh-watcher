import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCompleteHistory } from '../lib/types/hub/history.js'

test('load complete history walks every older page until the Session is complete', async () => {
  const windows = [
    { hasMore: true, loadingOlder: false, headKey: 'turn-3' },
    { hasMore: true, loadingOlder: false, headKey: 'turn-2' },
    { hasMore: false, loadingOlder: false, headKey: 'turn-1' },
  ]
  let index = 0
  const controller = new AbortController()

  const result = await loadCompleteHistory({
    read: () => windows[index],
    loadOlder: async () => { index += 1 },
    signal: controller.signal,
  })

  assert.deepEqual(result, { kind: 'complete', pages: 2 })
  assert.equal(index, 2)
})

test('load complete history stops instead of spinning when a page cannot advance', async () => {
  const state = { hasMore: true, loadingOlder: false, headKey: 'same-head' }
  const result = await loadCompleteHistory({
    read: () => state,
    loadOlder: async () => {},
    signal: new AbortController().signal,
  })

  assert.deepEqual(result, { kind: 'blocked', pages: 0, reason: 'no-progress' })
})

test('load complete history respects cancellation before requesting a page', async () => {
  const controller = new AbortController()
  controller.abort()
  let calls = 0

  const result = await loadCompleteHistory({
    read: () => ({ hasMore: true, loadingOlder: false, headKey: 'turn-3' }),
    loadOlder: async () => { calls += 1 },
    signal: controller.signal,
  })

  assert.deepEqual(result, { kind: 'cancelled', pages: 0 })
  assert.equal(calls, 0)
})
