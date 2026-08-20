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
 * The rail follows the newest visual group by default. Selecting history or
 * scrolling away pins the viewport; subsequent groups increment `unread`
 * without yanking the reader back to the bottom.
 */
export function createFollow() {
  let follow = true
  let unread = 0
  let selectedId: string | null = null
  let lastGroupId: string | null = null

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

    /** Counts newly observed groups only while the reader is pinned. */
    onPicture(picture: Pick<WorkPicture, 'nodes'>): FollowSnapshot {
      const groups = picture.nodes
      if (groups.length === 0) {
        lastGroupId = null
        catchUp()
        return snapshot()
      }

      const id = groups.at(-1)?.id ?? null
      if (id !== null && id !== lastGroupId) {
        if (!follow && lastGroupId !== null) {
          const previousIndex = groups.findIndex(group => group.id === lastGroupId)
          unread += previousIndex < 0 ? 1 : Math.max(1, groups.length - 1 - previousIndex)
        }
        lastGroupId = id
        if (follow) selectedId = null
      }
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
      lastGroupId = null
      return snapshot()
    },
  }
}
