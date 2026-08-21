import assert from 'node:assert/strict'
import test from 'node:test'
import { createFollow } from '../lib/types/hub/follow.js'

const picture = (...groups) => ({
  nodes: groups.map(([id, ...items]) => ({
    id,
    items: items.map(item => ({ id: item, status: 'success', resultSeq: 1, resultTime: 1 })),
  })),
})

test('follow starts at latest and selection pins one stable phase', () => {
  const follow = createFollow()
  assert.deepEqual(follow.onPicture(picture(['a', 'a1'])), {
    follow: true,
    unread: 0,
    selectedId: null,
  })
  assert.deepEqual(follow.onSelect('a'), {
    follow: false,
    unread: 0,
    selectedId: 'a',
  })
})

test('new occurrences inside the same phase remain visible as unread progress', () => {
  const follow = createFollow()
  follow.onPicture(picture(['a', 'a1']))
  follow.onSelect('a')
  assert.deepEqual(follow.onPicture(picture(['a', 'a1', 'a2', 'a3'])), {
    follow: false,
    unread: 2,
    selectedId: 'a',
  })
})

test('a running occurrence settling is one new progress update, not a disappearing row', () => {
  const follow = createFollow()
  const running = {
    nodes: [{ id: 'a', items: [{ id: 'a1', status: 'running', resultSeq: null, resultTime: null }] }],
  }
  const settled = {
    nodes: [{ id: 'a', items: [{ id: 'a1', status: 'success', resultSeq: 2, resultTime: 3 }] }],
  }
  follow.onPicture(running)
  follow.onSelect('a')
  assert.equal(follow.onPicture(settled).unread, 1)
})

test('back to latest clears unread and selection', () => {
  const follow = createFollow()
  follow.onPicture(picture(['a', 'a1']))
  follow.onSelect('a')
  follow.onPicture(picture(['a', 'a1'], ['b', 'b1']))
  assert.deepEqual(follow.backToLatest(), {
    follow: true,
    unread: 0,
    selectedId: null,
  })
})
