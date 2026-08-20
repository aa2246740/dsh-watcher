import assert from 'node:assert/strict'
import test from 'node:test'
import {
  groupOverviewSummary,
  overviewStateOf,
  turnNeedsDefaultDisclosure,
  turnOverviewSummary,
} from '../lib/types/hub/overview.js'

test('overview state describes progress without pretending aggregate success', () => {
  assert.equal(overviewStateOf('running', false), 'active')
  assert.equal(overviewStateOf('waiting', false), 'waiting')
  assert.equal(overviewStateOf('failure', false), 'attention')
  assert.equal(overviewStateOf('interrupted', false), 'attention')
  assert.equal(overviewStateOf('unknown', false), 'partial')

  assert.equal(overviewStateOf('success', false), 'settled')
  assert.equal(overviewStateOf('returned', false), 'settled')
  assert.equal(overviewStateOf('success', true), 'current')
  assert.equal(overviewStateOf('returned', true), 'current')
})

test('only the latest or attention-bearing Turn opens by default', () => {
  assert.equal(turnNeedsDefaultDisclosure('settled', false), false)
  assert.equal(turnNeedsDefaultDisclosure('current', true), true)
  assert.equal(turnNeedsDefaultDisclosure('active', false), true)
  assert.equal(turnNeedsDefaultDisclosure('waiting', false), true)
  assert.equal(turnNeedsDefaultDisclosure('attention', false), true)
  assert.equal(turnNeedsDefaultDisclosure('partial', false), true)
})

test('overview summaries hide singleton execution noise and all Step counts', () => {
  assert.equal(groupOverviewSummary({ executionCount: 1 }), '')
  assert.equal(groupOverviewSummary({ executionCount: 2 }), '2 次执行')

  const turn = {
    groups: [
      { executionCount: 1 },
      { executionCount: 23 },
    ],
  }
  assert.equal(turnOverviewSummary(turn), '2 个阶段 · 24 次执行')
  assert.doesNotMatch(turnOverviewSummary(turn), /步骤|Step/i)
})
