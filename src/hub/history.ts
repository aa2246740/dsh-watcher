/** Minimal public facts needed to page one shared RC8 Session window. */
export interface HistoryWindowState {
  hasMore: boolean
  loadingOlder: boolean
  headKey: string
}

export type CompleteHistoryResult =
  | { kind: 'complete'; pages: number }
  | { kind: 'cancelled'; pages: number }
  | { kind: 'blocked'; pages: number; reason: 'busy' | 'no-progress' | 'page-limit' }

export interface CompleteHistoryOptions {
  read: () => HistoryWindowState
  loadOlder: () => Promise<void>
  signal: AbortSignal
  maxPages?: number
}

/**
 * Pull every older RC8 page in order. The Session remains the sole owner of
 * history continuity; this helper only repeats its public, read-only paging
 * verb and fails closed if one request does not advance the visible head.
 */
export async function loadCompleteHistory({
  read,
  loadOlder,
  signal,
  maxPages = 1_000,
}: CompleteHistoryOptions): Promise<CompleteHistoryResult> {
  let pages = 0
  while (pages < maxPages) {
    if (signal.aborted) return { kind: 'cancelled', pages }
    const before = read()
    if (!before.hasMore) return { kind: 'complete', pages }
    if (before.loadingOlder) return { kind: 'blocked', pages, reason: 'busy' }

    await loadOlder()
    if (signal.aborted) return { kind: 'cancelled', pages }

    const after = read()
    if (!after.hasMore) return { kind: 'complete', pages: pages + 1 }
    if (after.headKey === before.headKey) {
      return { kind: 'blocked', pages, reason: 'no-progress' }
    }
    pages += 1
  }
  return { kind: 'blocked', pages, reason: 'page-limit' }
}
