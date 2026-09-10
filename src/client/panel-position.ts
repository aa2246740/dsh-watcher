/**
 * Anchored placement for the Watcher panel, correct under page zoom.
 *
 * The shared `useAnchoredPosition` primitive mixes two coordinate spaces, so a
 * page-level `html { zoom: … }` — a stylesheet a deployment may layer on top of
 * the shell, independent of this plugin — pushes the panel off the right edge:
 *
 * - `getBoundingClientRect()` and `window.innerWidth/innerHeight` are in
 *   VISUAL pixels — the zoom is already applied;
 * - `offsetWidth/offsetHeight` and every inline length (`left`, `max-width`)
 *   are in UNZOOMED layout pixels.
 *
 * Under zoom 1.1 a 720px panel is 792 visual px wide while the clamp subtracts
 * 720 from a 1896 visual viewport, so the panel lands ~176px past the edge.
 * This hook converts the panel's box into visual pixels once, clamps there, and
 * returns every length back in layout pixels. At zoom 1 the math is identical
 * to the primitive.
 * @module dsh-watcher/client/panel-position
 */

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

/** Inputs for {@link useAnchoredPanel}. */
export interface AnchoredPanelOptions {
  /** Whether the floating element is mounted and should track its anchor. */
  open: boolean
  /** The element the panel is placed from. */
  anchorRef: RefObject<HTMLElement | null>
  /** The floating element, measured so the clamp uses real dimensions. */
  panelRef: RefObject<HTMLElement | null>
  /** Which anchor edge the panel hangs from: below it (`bottom`, the default) or above it (`top`). */
  side?: 'top' | 'bottom'
  /** Distance kept between the anchor edge named by `side` and the panel, in layout pixels. */
  gap: number
  /** Distance kept between the panel and each viewport edge, in layout pixels. */
  margin: number
}

/** Placement plus the measured limits the panel's own CSS consumes. */
export interface AnchoredPanelStyle extends CSSProperties {
  /** Hard width ceiling in layout pixels: the visual viewport minus both margins. */
  '--watcher-panel-limit-w': string
  /** Hard height ceiling in layout pixels: the visual viewport minus both margins. */
  '--watcher-panel-limit-h': string
}

/**
 * Track an anchor and return zoom-correct fixed coordinates and size limits.
 * @param options - the open state, the two refs, the placement side, and the gap/margin distances.
 * @returns the panel's inline style, or `null` before the first measurement.
 */
export function useAnchoredPanel(options: AnchoredPanelOptions): AnchoredPanelStyle | null {
  const { open, anchorRef, panelRef, side = 'bottom', gap, margin } = options
  const [position, setPosition] = useState<AnchoredPanelStyle | null>(null)
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const place = () => {
      const anchor = anchorRef.current
      const panel = panelRef.current
      if (anchor === null || panel === null) return
      const rect = anchor.getBoundingClientRect()
      const measured = panel.getBoundingClientRect()
      const layoutWidth = panel.offsetWidth
      const layoutHeight = panel.offsetHeight
      // `rect` over `offsetWidth` is the page zoom factor (1 when unzoomed).
      // A zero-sized box cannot state it, so the unzoomed default applies.
      // The panel's own entry animation must translate only — a scaling
      // keyframe would shrink this measurement for the frame it runs in.
      const scale = layoutWidth > 0 && measured.width > 0 ? measured.width / layoutWidth : 1
      const limitW = Math.max(0, window.innerWidth - margin * 2 * scale)
      const limitH = Math.max(0, window.innerHeight - margin * 2 * scale)
      const visualWidth = Math.min(layoutWidth * scale, limitW)
      const visualHeight = Math.min(layoutHeight * scale, limitH)
      const visualMargin = margin * scale
      let left = rect.left
      let top = side === 'top' ? rect.top - gap * scale - visualHeight : rect.bottom + gap * scale
      if (visualWidth > 0) {
        left = Math.min(Math.max(left, visualMargin), window.innerWidth - visualWidth - visualMargin)
      }
      if (visualHeight > 0) {
        top = Math.min(Math.max(top, visualMargin), window.innerHeight - visualHeight - visualMargin)
      }
      setPosition({
        left: `${String(left / scale)}px`,
        top: `${String(top / scale)}px`,
        '--watcher-panel-limit-w': `${String(limitW / scale)}px`,
        '--watcher-panel-limit-h': `${String(limitH / scale)}px`,
      })
    }
    // The first run measures the panel in the same commit that opened it, so the
    // clamp uses real dimensions before anything paints.
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    // The panel resizes without either event — a status line appearing, a long
    // step list arriving, the inspector replacing the work picture. A stale
    // clamp would let a panel near an edge cross the margin it must respect.
    let observer: ResizeObserver | null = null
    const observed = panelRef.current
    if (typeof ResizeObserver !== 'undefined' && observed !== null) {
      observer = new ResizeObserver(place)
      observer.observe(observed)
    }
    // A transform does not resize the box, so the observer stays silent through
    // the entry animation; re-place once it ends to drop any transformed-frame
    // measurement the first pass had to make.
    const settled = panelRef.current
    settled?.addEventListener('animationend', place)
    return () => {
      observer?.disconnect()
      settled?.removeEventListener('animationend', place)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, anchorRef, panelRef, side, gap, margin])
  return position
}
