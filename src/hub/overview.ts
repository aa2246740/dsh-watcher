import type { WorkGroup, WorkStatus, WorkTurn } from '../observation/fold.ts'

/** Overview progress is deliberately separate from execution evidence status. */
export type OverviewState = 'active' | 'current' | 'waiting' | 'failure' | 'interrupted' | 'settled' | 'partial'

export const OVERVIEW_STATE_LABEL: Readonly<Record<OverviewState, string>> = Object.freeze({
  active: '进行中',
  current: '当前',
  waiting: '等待你',
  failure: '有失败记录',
  interrupted: '已中断',
  settled: '已结束',
  partial: '数据不完整',
})

/** Project evidence status into the one question overview markers answer: where should the user look? */
export function overviewStateOf(status: WorkStatus, isLatest: boolean): OverviewState {
  if (status === 'waiting') return 'waiting'
  if (status === 'failure') return 'failure'
  if (status === 'interrupted') return 'interrupted'
  if (status === 'running') return 'active'
  if (status === 'unknown') return 'partial'
  return isLatest ? 'current' : 'settled'
}

export function groupOverviewSummary(group: WorkGroup): string {
  return group.executionCount > 1 ? `${group.executionCount} 次执行` : ''
}

export function turnOverviewSummary(turn: WorkTurn): string {
  const executionCount = turn.groups.reduce((sum, group) => sum + group.executionCount, 0)
  return [
    `${turn.groups.length} 个阶段`,
    executionCount > 0 ? `${executionCount} 次执行` : null,
  ].filter((part): part is string => part !== null).join(' · ')
}

export function turnNeedsDefaultDisclosure(state: OverviewState, isLatest: boolean): boolean {
  return isLatest || state === 'active' || state === 'waiting' || state === 'partial'
}
