import type { InsightsView } from '../insights/projection.ts'

/**
 * The context "surface" (水面) reading the Watcher panel shows.
 *
 * `host` is the Harness token-meter `contextPressure` projection, the source
 * of the host's own Composer context meter. It is readable only for the open
 * session (`summary: false`), so cold sessions and older views fall back to
 * Watcher's event-folded `estimate`.
 */
export interface ContextReading {
  /** Next request's prompt size, in tokens. */
  tokens: number
  /** Route context window, or null when none was advertised. */
  window: number | null
  /** True only when `tokens` is the provider-reported prompt (● 精确). */
  exact: boolean
  source: 'host' | 'estimate'
  /** The estimate is missing part of the history (inherited prefix or node cap). */
  partial: boolean
}

const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0

/**
 * Pick the most faithful context reading available.
 * @param context - Watcher's own folded context view, if any.
 * @param pressure - raw `useProjection('contextPressure')` value; validated here because Watcher does not depend on token-meter types.
 * @returns the reading, or null when neither source has a value.
 */
export function contextReadingOf(
  context: InsightsView['context'] | null | undefined,
  pressure: unknown,
): ContextReading | null {
  const host = pressure !== null && typeof pressure === 'object' ? pressure as Record<string, unknown> : null
  const reported = count(host?.['pressureTokens']) ? host['pressureTokens'] : null
  const projected = count(host?.['projectedTokens']) ? host['projectedTokens'] : null
  const hostWindow = count(host?.['contextWindow']) && host['contextWindow'] > 0 ? host['contextWindow'] : null
  if (reported !== null || projected !== null) {
    // projectedTokens = provider-reported prompt + a heuristic repricing of what the
    // surface gained or lost since then (e.g. a compaction). Only the unmoved figure is exact.
    const tokens = projected ?? reported ?? 0
    // A missing host window must stay missing. Filling it from Watcher's own
    // window would draw a percentage the host indicator does not show.
    return { tokens, window: hostWindow, exact: tokens === reported, source: 'host', partial: false }
  }
  if (context === null || context === undefined) return null
  return { tokens: context.projected, window: context.window, exact: false, source: 'estimate', partial: context.surface.partial }
}
