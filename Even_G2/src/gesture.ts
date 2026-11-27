// Gesture timing/paging rules, kept pure so the responsiveness regressions can
// be tested without a bridge. Input events arrive over BLE and each paint is
// serialised, so the goal is to accept every real gesture and coalesce the
// resulting repaints instead of dropping gestures behind a long gate.

export type SwipeDirection = 'up' | 'down'
export type InputSource = 'glasses' | 'ring' | 'unknown'

/** Only reject an exact duplicate of the same gesture within this window. */
export const SWIPE_DEDUPE_MS = 24
/** One physical swipe advances this many visible pages. */
export const GESTURE_PAGE_FACTOR = 2
/** Let the lens settle before background status animation resumes. */
export const INTERACTION_QUIET_MS = 900
/** How long the visual acknowledgement marker stays lit. */
export const ACK_PULSE_MS = 180

export interface LastSwipe {
  type: 1 | 2
  source: InputSource
  at: number
}

export function shouldDeliverSwipe(
  last: LastSwipe | undefined,
  type: 1 | 2,
  source: InputSource,
  now: number,
): boolean {
  if (!last) return true
  return !(last.type === type && last.source === source && now - last.at < SWIPE_DEDUPE_MS)
}

export function swipePageDelta(visible: number, factor = GESTURE_PAGE_FACTOR): number {
  return Math.max(1, visible) * Math.max(1, factor)
}

export function interactionActive(now: number, lastInteractionAt: number): boolean {
  return lastInteractionAt > 0 && now - lastInteractionAt < INTERACTION_QUIET_MS
}
