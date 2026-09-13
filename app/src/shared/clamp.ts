// Backdate clamping helper (BUILD_PLAN §5.6, as resolved by issue #10's
// ordered-pipeline clarification).
//
// This file must be importable from both the main process and the renderer:
// no Node APIs (fs, path, electron, ...) and no DOM APIs. §5.6 requires the
// rule to be enforced in the main process, not just the UI, so this is the
// single source of truth both sides call into.
//
// All timestamps are integer UTC epoch milliseconds, matching `Segment`'s
// `startedAt`/`endedAt` fields (see `shared/types.ts`) — this module takes
// plain numbers rather than importing `Segment` so it stays a leaf/pure
// utility with no dependency on the segments module.

/** Result of {@link clampBackdate}: the usable value, and whether it differs from the input. */
export interface ClampBackdateResult {
  /** The value to actually use, after applying the §5.6 pipeline. */
  value: number
  /** `true` when `value` differs from the value passed in, so callers can surface a note. */
  wasAdjusted: boolean
}

/**
 * Applies §5.6's backdate clamping rules to a candidate "since when" value, as
 * an ordered pipeline (not independent checks — later steps can compound on
 * earlier ones):
 *
 * 1. Clamp to `now` if `value` is in the future. `now` is live wall-clock
 *    time, not a cached value, so a backward clock change doesn't leave a
 *    stale future value unclamped.
 * 2. Floor to `max(currentSegmentStartedAt, previousSegmentEndedAt)`. A
 *    missing previous segment (the very first segment ever) means no floor
 *    from that side, so the floor is simply `currentSegmentStartedAt`.
 * 3. If step 2's result is `>= now`, or otherwise zero/negative length, snap
 *    to `now` — this also catches the case where flooring against a previous
 *    segment pushes the result to or past `now`.
 *
 * @param value Candidate backdate value, epoch ms.
 * @param now Live wall-clock time, epoch ms.
 * @param currentSegmentStartedAt The segment being backdated into's `startedAt`, epoch ms.
 * @param previousSegmentEndedAt The prior segment's `endedAt`, or `null` if there is none.
 */
export function clampBackdate(
  value: number,
  now: number,
  currentSegmentStartedAt: number,
  previousSegmentEndedAt: number | null
): ClampBackdateResult {
  const original = value

  // Step 1: clamp to now if in the future.
  let result = value > now ? now : value

  // Step 2: floor to max(currentSegmentStartedAt, previousSegmentEndedAt).
  const floor = Math.max(currentSegmentStartedAt, previousSegmentEndedAt ?? -Infinity)
  if (result < floor) {
    result = floor
  }

  // Step 3: snap to now if step 2's result is >= now, or otherwise non-positive length.
  if (result >= now) {
    result = now
  }

  return { value: result, wasAdjusted: result !== original }
}
