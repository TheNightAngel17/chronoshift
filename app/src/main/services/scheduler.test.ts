import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Settings, TrackingState } from '../../shared/types'
import { CheckinScheduler } from './scheduler'

const INTERVAL_MINUTES = 10
const SNOOZE_MINUTES = 5
const INTERVAL_MS = INTERVAL_MINUTES * 60_000
const SNOOZE_MS = SNOOZE_MINUTES * 60_000

function fakeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    checkinIntervalMinutes: INTERVAL_MINUTES,
    idleThresholdMinutes: 5,
    snoozeMinutes: SNOOZE_MINUTES,
    autoStopAfterHours: 8,
    weekStartDay: 0,
    gridStartHour: 6,
    gridEndHour: 22,
    gridSnapMinutes: 15,
    promptStealFocus: false,
    promptSound: false,
    autostartEnabled: false,
    autostartBeginTracking: false,
    theme: 'system',
    ...overrides
  }
}

function trackingState(segmentId: number | null): TrackingState {
  return {
    segment:
      segmentId === null
        ? null
        : {
            id: segmentId,
            bucketId: 1,
            startedAt: 0,
            endedAt: null,
            confirmedThrough: null,
            origin: 'manual',
            note: null,
            createdAt: 0,
            updatedAt: 0
          },
    bucket: null
  }
}

interface SchedulerTestContext {
  scheduler: CheckinScheduler
  requestCheckin: ReturnType<typeof vi.fn>
  getTrackingState: ReturnType<typeof vi.fn>
  isIdleUnresolved: ReturnType<typeof vi.fn>
  clock: { value: number }
}

function setup(clockStart = 0): SchedulerTestContext {
  const clock = { value: clockStart }
  const requestCheckin = vi.fn()
  const getTrackingState = vi.fn(() => trackingState(1))
  const isIdleUnresolved = vi.fn(() => false)

  const scheduler = new CheckinScheduler({
    promptQueue: { requestCheckin },
    getTrackingState,
    isIdleUnresolved,
    settings: { getAll: () => fakeSettings() },
    now: () => clock.value
  })

  return { scheduler, requestCheckin, getTrackingState, isIdleUnresolved, clock }
}

describe('CheckinScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('schedules the first check-in at now + checkin_interval_minutes when a segment opens', () => {
    const { scheduler, clock } = setup(1_000)

    scheduler.segmentOpened()

    expect(scheduler.nextCheckinAt).toBe(1_000 + INTERVAL_MS)
    clock.value = 1_000 + INTERVAL_MS
  })

  it('fires the check-in exactly at the target when wall clock and timer agree', () => {
    const { scheduler, requestCheckin, clock } = setup(0)

    scheduler.segmentOpened()
    clock.value = INTERVAL_MS
    vi.advanceTimersByTime(INTERVAL_MS)

    expect(requestCheckin).toHaveBeenCalledTimes(1)
    expect(requestCheckin).toHaveBeenCalledWith(trackingState(1))
  })

  it('self-corrects when a tick fires early relative to the target instead of firing off-schedule', () => {
    const { scheduler, requestCheckin, clock } = setup(0)

    scheduler.segmentOpened()

    // Advance the real (fake) timer clock all the way to the target, but
    // keep the injected `now()` short of it — simulating a callback that
    // fired early relative to wall-clock time. The scheduler must not fire.
    clock.value = INTERVAL_MS - 5_000
    vi.advanceTimersByTime(INTERVAL_MS)
    expect(requestCheckin).not.toHaveBeenCalled()

    // Once wall-clock time actually reaches the target, the rearmed timer
    // (for the remaining 5s) fires it.
    clock.value = INTERVAL_MS
    vi.advanceTimersByTime(5_000)
    expect(requestCheckin).toHaveBeenCalledTimes(1)
  })

  it('still fires at the exact absolute target after irregular, uneven advances', () => {
    const { scheduler, requestCheckin, clock } = setup(0)

    scheduler.segmentOpened()

    const chunks = [137, 4_001, 250_000, 90_863, INTERVAL_MS - 137 - 4_001 - 250_000 - 90_863]
    for (const chunk of chunks) {
      clock.value += chunk
      vi.advanceTimersByTime(chunk)
    }

    expect(clock.value).toBe(INTERVAL_MS)
    expect(requestCheckin).toHaveBeenCalledTimes(1)
  })

  it('re-evaluates against the fixed target on resume instead of drifting', () => {
    const { scheduler, requestCheckin, clock } = setup(0)

    scheduler.segmentOpened()
    expect(scheduler.nextCheckinAt).toBe(INTERVAL_MS)

    // Simulate the process having been asleep: wall-clock time jumps past
    // the target with no timers having fired at all.
    clock.value = INTERVAL_MS + 60_000
    scheduler.reevaluate()
    vi.advanceTimersByTime(0)

    expect(requestCheckin).toHaveBeenCalledTimes(1)
  })

  it('reschedules confirm/switch at checkin_interval_minutes from the moment of the call', () => {
    const { scheduler, requestCheckin, clock } = setup(0)

    scheduler.segmentOpened()
    clock.value = 3_000
    scheduler.confirmEquivalent()

    expect(scheduler.nextCheckinAt).toBe(3_000 + INTERVAL_MS)

    clock.value = 3_000 + INTERVAL_MS
    vi.advanceTimersByTime(INTERVAL_MS)
    expect(requestCheckin).toHaveBeenCalledTimes(1)
  })

  it('reschedules snooze at snooze_minutes (not the normal interval) from the moment of the call', () => {
    const { scheduler, requestCheckin, clock } = setup(0)

    scheduler.segmentOpened()
    clock.value = 3_000
    scheduler.snooze()

    expect(scheduler.nextCheckinAt).toBe(3_000 + SNOOZE_MS)

    clock.value = 3_000 + SNOOZE_MS
    vi.advanceTimersByTime(SNOOZE_MS)
    expect(requestCheckin).toHaveBeenCalledTimes(1)
  })

  it('does not accelerate or back off after an ignored/timed-out check-in: the next tick still fires at the original target', () => {
    const { scheduler, requestCheckin, clock } = setup(0)

    scheduler.segmentOpened()
    clock.value = INTERVAL_MS
    vi.advanceTimersByTime(INTERVAL_MS)
    expect(requestCheckin).toHaveBeenCalledTimes(1)

    // No confirm/switch/snooze call happens (the prompt was ignored) — the
    // scheduler itself never learns that. The next check-in must still be
    // scheduled exactly one interval after the target that just fired.
    expect(scheduler.nextCheckinAt).toBe(2 * INTERVAL_MS)

    clock.value = 2 * INTERVAL_MS
    vi.advanceTimersByTime(INTERVAL_MS)
    expect(requestCheckin).toHaveBeenCalledTimes(2)
  })

  it('never requests the Checkin slot while no segment is open', () => {
    const { scheduler, requestCheckin, getTrackingState, clock } = setup(0)

    scheduler.segmentOpened()
    scheduler.segmentClosed()

    clock.value = INTERVAL_MS
    vi.advanceTimersByTime(INTERVAL_MS)

    expect(requestCheckin).not.toHaveBeenCalled()
    expect(scheduler.nextCheckinAt).toBeNull()

    // Also defensive at fire time: even if segmentClosed() weren't called,
    // a tick landing while getTrackingState() reports no open segment must
    // not fire.
    getTrackingState.mockReturnValue(trackingState(null))
    scheduler.segmentOpened()
    clock.value += INTERVAL_MS
    vi.advanceTimersByTime(INTERVAL_MS)
    expect(requestCheckin).not.toHaveBeenCalled()
  })

  it('never requests the Checkin slot while idle is unresolved', () => {
    const { scheduler, requestCheckin, isIdleUnresolved, clock } = setup(0)

    isIdleUnresolved.mockReturnValue(true)
    scheduler.segmentOpened()

    clock.value = INTERVAL_MS
    vi.advanceTimersByTime(INTERVAL_MS)

    expect(requestCheckin).not.toHaveBeenCalled()
  })

  it('defaults isIdleUnresolved to false when none is injected', () => {
    const requestCheckin = vi.fn()
    const clock = { value: 0 }
    const scheduler = new CheckinScheduler({
      promptQueue: { requestCheckin },
      getTrackingState: () => trackingState(1),
      settings: { getAll: () => fakeSettings() },
      now: () => clock.value
    })

    scheduler.segmentOpened()
    clock.value = INTERVAL_MS
    vi.advanceTimersByTime(INTERVAL_MS)

    expect(requestCheckin).toHaveBeenCalledTimes(1)
  })

  it('reads settings freshly on each schedule, so interval changes take effect without a restart', () => {
    const clock = { value: 0 }
    const requestCheckin = vi.fn()
    let intervalMinutes = INTERVAL_MINUTES

    const scheduler = new CheckinScheduler({
      promptQueue: { requestCheckin },
      getTrackingState: () => trackingState(1),
      settings: { getAll: () => fakeSettings({ checkinIntervalMinutes: intervalMinutes }) },
      now: () => clock.value
    })

    scheduler.segmentOpened()
    expect(scheduler.nextCheckinAt).toBe(INTERVAL_MS)

    intervalMinutes = 1
    clock.value = 500
    scheduler.confirmEquivalent()

    expect(scheduler.nextCheckinAt).toBe(500 + 60_000)
  })

  it('cancel() clears any pending schedule', () => {
    const { scheduler, requestCheckin, clock } = setup(0)

    scheduler.segmentOpened()
    scheduler.cancel()

    expect(scheduler.nextCheckinAt).toBeNull()

    clock.value = INTERVAL_MS
    vi.advanceTimersByTime(INTERVAL_MS)
    expect(requestCheckin).not.toHaveBeenCalled()
  })
})
