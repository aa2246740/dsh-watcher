import type { WorkPicture } from '../observation/fold.ts'

export interface FollowSnapshot {
  follow: boolean
  unread: number
  selectedId: string | null
}

export interface RailScrollState {
  atBottom: boolean
}

/**
 * Follow versus pin state for the work rail.
 *
 * The rail follows the newest recorded occurrence by default. Selecting
 * history or scrolling away pins the viewport; later occurrences and result
 * updates increment `unread` without yanking the reader away from evidence.
 */
export function createFollow() {
  let follow = true
  let unread = 0
  let selectedId: string | null = null
  let lastCursor: string | null = null
  let observedOccurrenceIds: readonly string[] = []

  function snapshot(): FollowSnapshot {
    return { follow, unread, selectedId }
  }

  function catchUp(): void {
    follow = true
    unread = 0
    selectedId = null
  }

  return {
    snapshot,

    /** Counts appended occurrences or a settled live result while pinned. */
    onPicture(picture: Pick<WorkPicture, 'nodes'>): FollowSnapshot {
      const groups = picture.nodes
      if (groups.length === 0) {
        lastCursor = null
        observedOccurrenceIds = []
        catchUp()
        return snapshot()
      }

      const occurrenceIds = groups.flatMap(group => group.items.map(item => `${group.id}:${item.id}`))
      const group = groups.at(-1)
      const item = group?.items.at(-1)
      const cursor = group === undefined
        ? null
        : item === undefined
          ? group.id
          : `${group.id}:${item.id}:${item.status}:${item.resultSeq ?? 'open'}:${item.resultTime ?? 'open'}`
      if (cursor !== null && cursor !== lastCursor) {
        if (!follow && lastCursor !== null) {
          const previousIds = new Set(observedOccurrenceIds)
          const appended = occurrenceIds.filter(id => !previousIds.has(id)).length
          unread += Math.max(1, appended)
        }
        lastCursor = cursor
        if (follow) selectedId = null
      }
      observedOccurrenceIds = occurrenceIds
      return snapshot()
    },

    onSelect(id: string): FollowSnapshot {
      follow = false
      selectedId = id
      return snapshot()
    },

    onScroll({ atBottom }: RailScrollState): FollowSnapshot {
      if (atBottom) {
        if (unread === 0 && selectedId === null) follow = true
      } else if (follow) {
        follow = false
      }
      return snapshot()
    },

    setFollow(next: boolean): FollowSnapshot {
      if (next) catchUp()
      else follow = false
      return snapshot()
    },

    backToLatest(): FollowSnapshot {
      catchUp()
      return snapshot()
    },

    reset(): FollowSnapshot {
      catchUp()
      lastCursor = null
      observedOccurrenceIds = []
      return snapshot()
    },
  }
}
