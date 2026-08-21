import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chooseTurnDisclosureMode,
  createTurnDisclosureState,
  resetTurnDisclosureOverrides,
  toggleTurnDisclosure,
  turnDisclosureOpen,
} from '../lib/types/client/turn-disclosure.js'

test('a manually collapsed live Turn stays collapsed while its defaults keep changing', () => {
  const initial = createTurnDisclosureState()
  assert.equal(turnDisclosureOpen(initial, 3, true), true)

  const collapsed = toggleTurnDisclosure(initial, 3, true)
  assert.equal(turnDisclosureOpen(collapsed, 3, true), false)
  assert.equal(turnDisclosureOpen(collapsed, 3, false), false)
  assert.equal(turnDisclosureOpen(collapsed, 3, true), false)
})

test('macro mode keeps current and future Turns collapsed without blocking a local expansion', () => {
  const macro = chooseTurnDisclosureMode('macro')
  assert.equal(turnDisclosureOpen(macro, 1, true), false)
  assert.equal(turnDisclosureOpen(macro, 99, true), false)

  const oneOpen = toggleTurnDisclosure(macro, 99, true)
  assert.equal(turnDisclosureOpen(oneOpen, 99, true), true)
  assert.equal(turnDisclosureOpen(oneOpen, 100, true), false)
})

test('changing Session clears Turn-number overrides but preserves macro observation mode', () => {
  const oneOpen = toggleTurnDisclosure(chooseTurnDisclosureMode('macro'), 4, true)
  const nextSession = resetTurnDisclosureOverrides(oneOpen)

  assert.equal(nextSession.mode, 'macro')
  assert.deepEqual(nextSession.overrides, {})
  assert.equal(turnDisclosureOpen(nextSession, 1, true), false)
})
