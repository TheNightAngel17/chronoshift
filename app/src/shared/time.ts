// Pure time helpers — see docs/BUILD_PLAN.md §5.5.
//
// Rules enforced here:
// - No Node or DOM APIs. Only `date-fns`, which is itself pure JS and safe to
//   import from both the main and renderer processes.
// - Every timestamp in and out is an integer UTC epoch millisecond. Local
//   time only exists transiently, inside `date-fns`, while it computes a
//   boundary — it is never stored or returned as a string here.
// - No hand-rolled DST arithmetic. Day/week boundaries are delegated
//   entirely to `date-fns`, which already accounts for DST transitions.

import { endOfDay, endOfWeek, startOfDay, startOfWeek } from 'date-fns'

/** 0 = Sunday … 6 = Saturday, matching the `week_start_day` setting. */
export type WeekStartDay = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Returns the epoch ms for local midnight at the start of the day containing `epochMs`. */
export function startOfDayMs(epochMs: number): number {
  return startOfDay(epochMs).getTime()
}

/** Returns the epoch ms for the last local millisecond of the day containing `epochMs`. */
export function endOfDayMs(epochMs: number): number {
  return endOfDay(epochMs).getTime()
}

/**
 * Returns the epoch ms for local midnight at the start of the week containing
 * `epochMs`, where the week begins on `weekStartDay`.
 */
export function startOfWeekMs(epochMs: number, weekStartDay: WeekStartDay): number {
  return startOfWeek(epochMs, { weekStartsOn: weekStartDay }).getTime()
}

/**
 * Returns the epoch ms for the last local millisecond of the week containing
 * `epochMs`, where the week begins on `weekStartDay`.
 */
export function endOfWeekMs(epochMs: number, weekStartDay: WeekStartDay): number {
  return endOfWeek(epochMs, { weekStartsOn: weekStartDay }).getTime()
}
