import assert from 'node:assert/strict'
import test from 'node:test'
import { createFollow } from '../lib/types/hub/follow.js'

const picture = (...ids) => ({ nodes: ids.map(id => ({ id })) })

test('follow starts at latest and selection pins one stable group', () => {
  const follow = createFollow()
  assert.deepEqual(follow.onPicture(picture('a')), {
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

test('new work increments unread without moving a pinned selection', () => {
  const follow = createFollow()
  follow.onPicture(picture('a'))
  follow.onSelect('a')
  assert.deepEqual(follow.onPicture(picture('a', 'b', 'c')), {
    follow: false,
    unread: 2,
    selectedId: 'a',
  })
})

test('back to latest clears unread and selection', () => {
  const follow = createFollow()
  follow.onPicture(picture('a'))
  follow.onSelect('a')
  follow.onPicture(picture('a', 'b'))
  assert.deepEqual(follow.backToLatest(), {
    follow: true,
    unread: 0,
    selectedId: null,
  })
})
