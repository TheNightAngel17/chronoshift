// Check-in scheduler (BUILD_PLAN §8.3, decision ticket #8's reschedule-rule
// resolution).
//
// Owns exactly one thing: the timestamp the next check-in is due, and a timer
// armed against it. When that timestamp arrives, it asks `promptQueue.ts`
// (issue #42) to display the Checkin prompt — it never builds a
// `BrowserWindow` itself. Like `promptQueue.ts` and `tray/menu.ts`, this
// module is deliberately Electron-free: every dependency (the tracking state
// to check, the idle-unresolved predicate, the settings to read, the clock)
// is injected, so it's unit-testable with fake timers and no real app.
//
// Self-correcting timer: `setTimeout`'s delay is only ever a *hint*. Each
// time the timer fires, `tick()` recomputes the remaining delay from the
// fixed target timestamp rather than trusting that the callback fired
// exactly on time — a callback that fires early (clock skew) or very late
// (the OS suspended the process) both self-correct against the same target
// instead of drifting. `reevaluate()` re-arms against that same target and
// exists so a caller can invoke it from Electron's `powerMonitor` `resume`
// event without this module importing `electron` itself.
//
// Reschedule triggers, per issue #8's resolution of decision ticket #8:
//   - `segmentOpened()`      — a segment just opened; first schedule.
//   - `segmentClosed()`      — no segment is open; suppress entirely.
//   - `confirmEquivalent()`  — confirm, switch, and (once #36 wires their
//                              callers) Recovery's "keep running" and idle
//                              resolution all reschedule identically: fresh
//                              `checkin_interval_minutes` from right now.
//                              This one method is that seam for all four.
//   - `snooze()`             — reschedules `snooze_minutes` from right now
//                              instead of the normal interval.
// Ignoring/timing out a prompt is deliberately *not* a method here: per
// §8.3 it must not reschedule aggressively, so the already-armed timer is
// simply left alone and fires one interval after the target that just
// fired (see `fire()`) — this module never even learns that a prompt timed
// out; that is `promptQueue.ts`'s job (it records `response='timeout'`).

import type { PromptQueue } from './promptQueue'
import type { TrackingState } from '../../shared/types'
import * as defaultSettingsRepository from '../db/repositories/settings'

type SettingsReader = Pick<typeof defaultSettingsRepository, 'getAll'>

export interface CheckinSchedulerOptions {
  /** Only `requestCheckin` is called; never constructed or reached into. */
  promptQueue: Pick<PromptQueue, 'requestCheckin'>
  /**
   * No tracking-state singleton exists yet in this codebase (tracking.ts is
   * a pure `(state, event) => state` reducer with nowhere it stores "the"
   * current state, and no `tracking:state` IPC handler is wired). A later
   * issue supplies the real implementation; this issue just needs the seam.
   */
  getTrackingState: () => TrackingState
  /**
   * Stubbed until Phase 6 wires the real idle monitor: defaults to
   * unconditionally `false` so this issue's tests stay deterministic
   * without `idle_events` in the picture yet.
   */
  isIdleUnresolved?: () => boolean
  /** Defaults to the real settings repository; tests inject a fake. */
  settings?: SettingsReader
  /** Defaults to `Date.now`; tests inject a fake clock. */
  now?: () => number
}

/**
 * Schedules the next Checkin-slot request per BUILD_PLAN §8.3, self-correcting
 * against a fixed target timestamp rather than trusting `setTimeout`/
 * `setInterval` drift.
 */
export class CheckinScheduler {
  private readonly promptQueue: Pick<PromptQueue, 'requestCheckin'>
  private readonly getTrackingState: () => TrackingState
  private readonly isIdleUnresolved: () => boolean
  private readonly settings: SettingsReader
  private readonly now: () => number

  /** The next due timestamp, or `null` while nothing is scheduled. */
  private targetAt: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(options: CheckinSchedulerOptions) {
    this.promptQueue = options.promptQueue
    this.getTrackingState = options.getTrackingState
    this.isIdleUnresolved = options.isIdleUnresolved ?? (() => false)
    this.settings = options.settings ?? defaultSettingsRepository
    this.now = options.now ?? Date.now
  }

  /** The currently-armed target timestamp, or `null`. Exposed for tests/diagnostics. */
  get nextCheckinAt(): number | null {
    return this.targetAt
  }

  /** A segment just opened: schedule the first check-in at `now + checkin_interval_minutes`. */
  segmentOpened(): void {
    this.scheduleFromNow(this.intervalMs())
  }

  /** No segment is open any more: never fire while there's nothing to check in on. */
  segmentClosed(): void {
    this.cancel()
  }

  /**
   * Confirm, switch, and — once #36 wires their callers — Recovery's "keep
   * running" and idle resolution: all reschedule identically, fresh
   * `checkin_interval_minutes` from this moment.
   */
  confirmEquivalent(): void {
    this.scheduleFromNow(this.intervalMs())
  }

  /** Snooze reschedules `snooze_minutes` from this moment instead of the normal interval. */
  snooze(): void {
    this.scheduleFromNow(this.snoozeMs())
  }

  /**
   * Re-arms the timer against the existing target without changing it.
   * Intended to be called from Electron's `powerMonitor` `resume` event (kept
   * out of this module so it stays Electron-free): a suspended process's
   * timers don't run while asleep, so on wake the delay needs recomputing
   * against wall-clock time rather than trusting whatever was left of the
   * pre-sleep timer.
   */
  reevaluate(): void {
    this.armTimer()
  }

  /** Cancels any pending schedule. For app shutdown and test teardown. */
  cancel(): void {
    this.targetAt = null
    this.clearTimer()
  }

  private intervalMs(): number {
    return this.settings.getAll().checkinIntervalMinutes * 60_000
  }

  private snoozeMs(): number {
    return this.settings.getAll().snoozeMinutes * 60_000
  }

  private scheduleFromNow(delayMs: number): void {
    this.scheduleAt(this.now() + delayMs)
  }

  private scheduleAt(targetAt: number): void {
    this.targetAt = targetAt
    this.armTimer()
  }

  private armTimer(): void {
    this.clearTimer()

    if (this.targetAt === null) {
      return
    }

    const delay = Math.max(0, this.targetAt - this.now())
    this.timer = setTimeout(() => this.tick(), delay)
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private tick(): void {
    if (this.targetAt === null) {
      return
    }

    if (this.now() < this.targetAt) {
      // Fired early relative to the target (clock skew, or a rearm racing
      // its own old timer) — self-correct by re-arming against the same
      // fixed target rather than firing off-schedule.
      this.armTimer()
      return
    }

    this.fire()
  }

  private fire(): void {
    const firedTarget = this.targetAt as number
    const state = this.getTrackingState()

    if (!state.segment) {
      // Never request the Checkin slot while no segment is open. Nothing to
      // reschedule against until segmentOpened() supplies a fresh target.
      this.cancel()
      return
    }

    if (this.isIdleUnresolved()) {
      // Never request the Checkin slot while idle is unresolved. Resolving
      // it is itself a confirm-equivalent trigger (once #36 wires it) that
      // reschedules fresh, so this tick drops without arming another timer.
      this.cancel()
      return
    }

    this.promptQueue.requestCheckin(state)

    // Ignoring this prompt must not reschedule aggressively (§8.3): the next
    // one fires one interval after the target that *just* fired, not one
    // interval from now, so a chain of ignored prompts never drifts later
    // and later relative to the original schedule.
    this.scheduleAt(firedTarget + this.intervalMs())
  }
}
