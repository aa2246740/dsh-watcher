/*!
 * Copyright (c) 2026 DeepSeek
 * SPDX-License-Identifier: MIT
 *
 * Below/start placement copied from DeepSeek Harness:
 * - 0.2.1-rc.5 packages/client/ui-primitives/src/useAnchoredPosition.ts
 * - 0.2.2-rc.5 packages/client/ui-primitives/src/overlay-top-margin.ts
 * The permission notice ships in THIRD_PARTY_NOTICES.md.
 *
 * Harness 0.2.1 exported useAnchoredPosition from
 * `@deepseek-ai/dsh-client-ui-primitives`. 0.2.2-rc.5 removed it, so an
 * injected import was `undefined` and the header button threw as soon as it
 * rendered. Watcher owns this copy so one bundle runs on every supported line.
 */
/**
 * Keep the portaled Watcher panel anchored below its header trigger.
 */
import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react'

/** Anchor rectangle, panel size, and viewport size in CSS pixels. */
export interface AnchoredPlacementInput {
  anchor: { left: number; bottom: number }
  panel: { width: number; height: number }
  viewport: { width: number; height: number }
  gap: number
  margin: number
  /** Top margin after the desktop frame's reserved strip; at least `margin`. */
  topMargin: number
}

/**
 * Place the panel below the anchor, aligned to its left edge, and clamp it
 * inside the viewport. A zero panel dimension (not yet laid out) skips that
 * axis's clamp, matching the Harness hook.
 * @returns fixed `left` / `top` coordinates for the panel.
 */
export function placeBelowAnchor(input: AnchoredPlacementInput): { left: number; top: number } {
  const { anchor, panel, viewport, gap, margin, topMargin } = input
  let left = anchor.left
  let top = anchor.bottom + gap
  if (panel.width > 0) left = Math.min(Math.max(left, margin), viewport.width - panel.width - margin)
  if (panel.height > 0) top = Math.min(Math.max(top, topMargin), viewport.height - panel.height - margin)
  return { left, top }
}

/**
 * Resolve the top margin an overlay keeps from the viewport edge.
 * @param min - the overlay's own viewport margin, used as the floor.
 * @param clearance - `--dsh-frame-top-clearance` in px, or NaN when unset.
 * @param fullscreen - whether the frame strip is hidden.
 * @returns the larger of `min` and the frame clearance plus 20px.
 */
export function overlayTopMargin(min: number, clearance: number, fullscreen: boolean): number {
  if (Number.isNaN(clearance)) return min
  return Math.max(min, (fullscreen ? 0 : clearance) + 20)
}

function frameTopMargin(min: number): number {
  const root = document.documentElement
  const clearance = Number.parseFloat(getComputedStyle(root).getPropertyValue('--dsh-frame-top-clearance'))
  return overlayTopMargin(min, clearance, root.hasAttribute('data-fullscreen'))
}

/** Inputs for {@link useAnchoredPosition}. */
export interface AnchoredPositionOptions {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  panelRef: RefObject<HTMLElement | null>
  gap: number
  margin: number
}

/**
 * Track the anchor while open and return the panel's fixed coordinates.
 * Re-runs on scroll (capture phase), resize, and the panel's own size changes.
 * @returns `left` / `top`, or `null` before the first measurement.
 */
export function useAnchoredPosition(options: AnchoredPositionOptions): CSSProperties | null {
  const { open, anchorRef, panelRef, gap, margin } = options
  const [position, setPosition] = useState<CSSProperties | null>(null)
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null)
      return
    }
    const place = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (rect === undefined) return
      const panel = panelRef.current
      setPosition(placeBelowAnchor({
        anchor: { left: rect.left, bottom: rect.bottom },
        panel: { width: panel?.offsetWidth ?? 0, height: panel?.offsetHeight ?? 0 },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        gap,
        margin,
        topMargin: frameTopMargin(margin),
      }))
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    const panel = panelRef.current
    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && panel !== null) {
      observer = new ResizeObserver(place)
      observer.observe(panel)
    }
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, anchorRef, panelRef, gap, margin])
  return position
}
