import assert from 'node:assert/strict'
import test from 'node:test'
import {
  chooseDisclosureDepth,
  createDisclosureState,
  layerDisclosureOpen,
  resetDisclosureOverrides,
  toggleLayerDisclosure,
  toggleTurnDisclosure,
  turnDisclosureOpen,
} from '../lib/types/client/disclosure-depth.js'

test('overview shows the automatic Turn and stops at its phase headers', () => {
  const overview = createDisclosureState()

  assert.equal(turnDisclosureOpen(overview, 6, true), true)
  assert.equal(turnDisclosureOpen(overview, 5, false), false)
  assert.equal(layerDisclosureOpen(overview, 'phase', 'phase-1'), false)
  assert.equal(layerDisclosureOpen(overview, 'step', 'step-1'), false)
  assert.equal(layerDisclosureOpen(overview, 'model', 'model-1'), false)
})

test('detail opens every Turn and nested layer', () => {
  const detail = chooseDisclosureDepth('detail')

  assert.equal(turnDisclosureOpen(detail, 1, false), true)
  assert.equal(layerDisclosureOpen(detail, 'phase', 'phase-1'), true)
  assert.equal(layerDisclosureOpen(detail, 'step', 'step-1'), true)
  assert.equal(layerDisclosureOpen(detail, 'cluster', 'cluster-1'), true)
  assert.equal(layerDisclosureOpen(detail, 'model', 'model-1'), true)
  assert.equal(layerDisclosureOpen(detail, 'reasoning', 'attempt-1'), true)
})

test('manual folds remain authoritative while live defaults change', () => {
  const detail = chooseDisclosureDepth('detail')
  const collapsedTurn = toggleTurnDisclosure(detail, 3, true)
  const collapsedPhase = toggleLayerDisclosure(collapsedTurn, 'phase', 'phase-3')

  assert.equal(turnDisclosureOpen(collapsedPhase, 3, true), false)
  assert.equal(turnDisclosureOpen(collapsedPhase, 3, false), false)
  assert.equal(layerDisclosureOpen(collapsedPhase, 'phase', 'phase-3'), false)
})

test('changing depth clears stale folds and applies the selected hierarchy', () => {
  const openedOverviewPhase = toggleLayerDisclosure(createDisclosureState(), 'phase', 'phase-4')
  assert.equal(layerDisclosureOpen(openedOverviewPhase, 'phase', 'phase-4'), true)

  const detail = chooseDisclosureDepth('detail')
  assert.equal(layerDisclosureOpen(detail, 'phase', 'phase-4'), true)

  const collapsedDetailPhase = toggleLayerDisclosure(detail, 'phase', 'phase-4')
  assert.equal(layerDisclosureOpen(collapsedDetailPhase, 'phase', 'phase-4'), false)

  const overview = chooseDisclosureDepth('overview')
  assert.equal(layerDisclosureOpen(overview, 'phase', 'phase-4'), false)
})

test('changing Session clears node overrides but preserves the chosen depth', () => {
  const collapsed = toggleLayerDisclosure(chooseDisclosureDepth('detail'), 'reasoning', 'attempt-2')
  const nextSession = resetDisclosureOverrides(collapsed)

  assert.equal(nextSession.depth, 'detail')
  assert.deepEqual(nextSession.turns, {})
  assert.equal(layerDisclosureOpen(nextSession, 'reasoning', 'attempt-2'), true)
})
