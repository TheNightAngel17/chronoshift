import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  canApply,
  initialTrackingState,
  reduce,
  type SegmentWrite,
  type TrackingEvent,
  type TrackingMachineState
} from './tracking'

const BREAK_BUCKET_ID = 1
const ACME_BUILD = 2
const BETA_FIX = 3

/** Epoch ms for a wall-clock time on the worked example's day, for readable expectations. */
function at(time: string): number {
  return new Date(`2024-06-17T${time}:00.000Z`).getTime()
}

// --- Timeline reconstruction -------------------------------------------------
//
// The reducer only emits writes; the invariants of BUILD_PLAN §5.1 are about the
// timeline those writes build up. This applier is the test's stand-in for issue
// #40's real applier: it folds writes into a history of closed segments plus the
// single open one, and it is itself strict about the writes it accepts (opening
// over an existing open segment, or closing when nothing is open, throws), which
// is how "at most one open segment" gets checked.

interface ClosedSegment {
  bucketId: number
  startedAt: number
  endedAt: number
  confirmedThrough: number
}

interface OpenSegment {
  bucketId: number
  startedAt: number
  confirmedThrough: number
}

interface Timeline {
  closed: ClosedSegment[]
  open: OpenSegment | null
}

function emptyTimeline(): Timeline {
  return { closed: [], open: null }
}

function applyWrite(timeline: Timeline, write: SegmentWrite): void {
  switch (write.kind) {
    case 'openSegment': {
      if (timeline.open !== null) {
        throw new Error('openSegment write while a segment is already open (§5.1.1).')
      }

      timeline.open = {
        bucketId: write.bucketId,
        startedAt: write.startedAt,
        confirmedThrough: write.confirmedThrough
      }
      break
    }

    case 'closeOpenSegment': {
      if (timeline.open === null) {
        throw new Error('closeOpenSegment write with no open segment.')
      }

      timeline.closed.push({
        bucketId: timeline.open.bucketId,
        startedAt: timeline.open.startedAt,
        endedAt: write.endedAt,
        confirmedThrough: write.confirmedThrough
      })
      timeline.open = null
      break
    }

    case 'insertClosedSegment': {
      timeline.closed.push({
        bucketId: write.bucketId,
        startedAt: write.startedAt,
        endedAt: write.endedAt,
        confirmedThrough: write.confirmedThrough
      })
      break
    }

    case 'updateOpenSegment': {
      if (timeline.open === null) {
        throw new Error('updateOpenSegment write with no open segment.')
      }

      timeline.open.confirmedThrough = write.confirmedThrough
      break
    }

    case 'discardOpenSegment': {
      if (timeline.open === null) {
        throw new Error('discardOpenSegment write with no open segment.')
      }

      timeline.open = null
      break
    }

    case 'resolveIdleEvent':
      // Not a timeline row; nothing to reconstruct.
      break
  }
}

/** Asserts every BUILD_PLAN §5.1 invariant over the reconstructed timeline. */
function assertTimelineInvariants(timeline: Timeline, now: number): void {
  const ordered = [...timeline.closed].sort((a, b) => a.startedAt - b.startedAt)

  let previousEndedAt: number | null = null

  for (const segment of ordered) {
    // §5.1.4 — no zero-length (or negative) segments.
    expect(segment.endedAt).toBeGreaterThan(segment.startedAt)
    // §5.1.5 — the watermark lies inside the segment.
    expect(segment.confirmedThrough).toBeGreaterThanOrEqual(segment.startedAt)
    expect(segment.confirmedThrough).toBeLessThanOrEqual(segment.endedAt)

    if (previousEndedAt !== null) {
      // §5.1.2 — no overlaps. Gaps between them are legal (§5.1.3).
      expect(segment.startedAt).toBeGreaterThanOrEqual(previousEndedAt)
    }

    previousEndedAt = segment.endedAt
  }

  if (timeline.open !== null) {
    if (previousEndedAt !== null) {
      expect(timeline.open.startedAt).toBeGreaterThanOrEqual(previousEndedAt)
    }

    expect(timeline.open.startedAt).toBeLessThanOrEqual(now)
    expect(timeline.open.confirmedThrough).toBeGreaterThanOrEqual(timeline.open.startedAt)
    expect(timeline.open.confirmedThrough).toBeLessThanOrEqual(now)
  }
}

function applyStep(
  state: TrackingMachineState,
  timeline: Timeline,
  event: TrackingEvent
): TrackingMachineState {
  const { state: next, writes } = reduce(state, event)

  for (const write of writes) {
    applyWrite(timeline, write)
  }

  // The machine's own view of whether something is open must match the timeline.
  expect(next.status === 'tracking').toBe(timeline.open !== null)

  if (next.status === 'tracking' && timeline.open !== null) {
    expect(timeline.open.bucketId).toBe(next.open.bucketId)
    expect(timeline.open.startedAt).toBe(next.open.startedAt)
    expect(timeline.open.confirmedThrough).toBe(next.open.confirmedThrough)
  }

  assertTimelineInvariants(timeline, event.now)

  return next
}

// --- BUILD_PLAN §5.2's worked example ---------------------------------------

describe('reduce — BUILD_PLAN §5.2 worked example (retroactive confirmation on switch)', () => {
  it('walks 09:00 start → 09:15 confirm → ignored check-ins → 10:00 backdated switch', () => {
    const timeline = emptyTimeline()

    // 09:00 — start tracking "Acme / Build".
    let state = applyStep(initialTrackingState, timeline, {
      type: 'startTracking',
      now: at('09:00'),
      bucketId: ACME_BUILD,
      sinceWhen: at('09:00')
    })

    expect(state.open).toMatchObject({
      bucketId: ACME_BUILD,
      startedAt: at('09:00'),
      confirmedThrough: at('09:00'),
      origin: 'manual'
    })

    // 09:15 — check-in answered "Yes, still on it": watermark moves, no new segment.
    const confirmed = reduce(state, { type: 'confirmStillOnIt', now: at('09:15') })

    expect(confirmed.writes).toEqual([{ kind: 'updateOpenSegment', confirmedThrough: at('09:15') }])

    state = applyStep(state, timeline, { type: 'confirmStillOnIt', now: at('09:15') })

    expect(state.open).toMatchObject({ startedAt: at('09:00'), confirmedThrough: at('09:15') })

    // 09:30 and 09:45 — check-ins ignored. An ignored prompt raises no transition
    // at all; the closest thing the machine sees is a snooze, which must also
    // leave both the state and the timeline untouched.
    const snoozed = reduce(state, { type: 'snooze', now: at('09:30') })

    expect(snoozed.writes).toEqual([])
    expect(snoozed.state).toBe(state)

    // 10:00 — "Switched to Beta / Fix, since 09:40".
    const switched = reduce(state, {
      type: 'switchBucket',
      now: at('10:00'),
      bucketId: BETA_FIX,
      sinceWhen: at('09:40')
    })

    expect(switched.writes).toEqual([
      // A closes at 09:40, and saying "I switched at 09:40" retroactively
      // confirms A ran until then — the watermark moves from 09:15 to 09:40.
      { kind: 'closeOpenSegment', endedAt: at('09:40'), confirmedThrough: at('09:40') },
      {
        kind: 'openSegment',
        bucketId: BETA_FIX,
        startedAt: at('09:40'),
        confirmedThrough: at('10:00'),
        origin: 'checkin',
        note: null
      }
    ])

    state = applyStep(state, timeline, {
      type: 'switchBucket',
      now: at('10:00'),
      bucketId: BETA_FIX,
      sinceWhen: at('09:40')
    })

    expect(timeline.closed).toEqual([
      {
        bucketId: ACME_BUILD,
        startedAt: at('09:00'),
        endedAt: at('09:40'),
        confirmedThrough: at('09:40')
      }
    ])
    expect(state.open).toMatchObject({ bucketId: BETA_FIX, startedAt: at('09:40') })
  })
})

// --- Transition-by-transition cases -----------------------------------------

function trackingSince(startedAt: number, bucketId = ACME_BUILD): TrackingMachineState {
  return reduce(initialTrackingState, {
    type: 'startTracking',
    now: startedAt,
    bucketId,
    sinceWhen: startedAt
  }).state
}

describe('reduce — issue #7 transition table', () => {
  it('only allows startTracking while not tracking, and only the rest while tracking', () => {
    expect(
      canApply(initialTrackingState, {
        type: 'startTracking',
        now: at('09:00'),
        bucketId: ACME_BUILD,
        sinceWhen: at('09:00')
      })
    ).toBe(true)
    expect(canApply(initialTrackingState, { type: 'snooze', now: at('09:00') })).toBe(false)

    const tracking = trackingSince(at('09:00'))

    expect(canApply(tracking, { type: 'snooze', now: at('09:10') })).toBe(true)
    expect(
      canApply(tracking, {
        type: 'startTracking',
        now: at('09:10'),
        bucketId: BETA_FIX,
        sinceWhen: at('09:05')
      })
    ).toBe(false)
  })

  it('treats an inapplicable event as a no-op rather than throwing', () => {
    const reduced = reduce(initialTrackingState, { type: 'confirmStillOnIt', now: at('09:00') })

    expect(reduced.state).toBe(initialTrackingState)
    expect(reduced.writes).toEqual([])
  })

  it('clamps a backdated start against the previous segment (§5.6)', () => {
    const stopped = reduce(trackingSince(at('09:00')), {
      type: 'stopTracking',
      now: at('10:00'),
      sinceWhen: at('10:00')
    }).state

    // 09:30 is before the previous segment's end (10:00), so it floors to 10:00.
    const restarted = reduce(stopped, {
      type: 'startTracking',
      now: at('11:00'),
      bucketId: BETA_FIX,
      sinceWhen: at('09:30')
    })

    expect(restarted.writes).toEqual([
      {
        kind: 'openSegment',
        bucketId: BETA_FIX,
        startedAt: at('10:00'),
        confirmedThrough: at('10:00'),
        origin: 'manual',
        note: null
      }
    ])
  })

  it('floors a backdated switch to the current segment’s confirmation watermark', () => {
    // Confirm the segment through 09:30, then try to switch "since 09:10" —
    // earlier than what the user already affirmatively confirmed. §5.6 is
    // silent on this case; backdateInto's extra floor keeps it from
    // un-confirming (segments.switch rejects this outright in the real repo).
    const confirmed = reduce(trackingSince(at('09:00')), {
      type: 'confirmStillOnIt',
      now: at('09:30')
    }).state

    const switched = reduce(confirmed, {
      type: 'switchBucket',
      now: at('09:45'),
      bucketId: BETA_FIX,
      sinceWhen: at('09:10')
    })

    expect(switched.writes).toEqual([
      { kind: 'closeOpenSegment', endedAt: at('09:30'), confirmedThrough: at('09:30') },
      {
        kind: 'openSegment',
        bucketId: BETA_FIX,
        startedAt: at('09:30'),
        confirmedThrough: at('09:45'),
        origin: 'checkin',
        note: null
      }
    ])
  })

  it('takes a break as a plain switch to the break bucket (§5.3, ADR 0001)', () => {
    const reduced = reduce(trackingSince(at('09:00')), {
      type: 'takeBreak',
      now: at('12:00'),
      breakBucketId: BREAK_BUCKET_ID,
      sinceWhen: at('11:55')
    })

    expect(reduced.state.status).toBe('tracking')
    expect(reduced.state.open).toMatchObject({ bucketId: BREAK_BUCKET_ID, origin: 'checkin' })
    expect(reduced.writes).toEqual([
      { kind: 'closeOpenSegment', endedAt: at('11:55'), confirmedThrough: at('11:55') },
      {
        kind: 'openSegment',
        bucketId: BREAK_BUCKET_ID,
        startedAt: at('11:55'),
        confirmedThrough: at('12:00'),
        origin: 'checkin',
        note: null
      }
    ])
  })

  it('stops by closing the current segment with a retroactive watermark', () => {
    const reduced = reduce(trackingSince(at('09:00')), {
      type: 'stopTracking',
      now: at('17:00'),
      sinceWhen: at('16:45')
    })

    expect(reduced.state.status).toBe('not_tracking')
    expect(reduced.state.previousSegmentEndedAt).toBe(at('16:45'))
    expect(reduced.writes).toEqual([
      { kind: 'closeOpenSegment', endedAt: at('16:45'), confirmedThrough: at('16:45') }
    ])
  })

  it('discards rather than closes a segment whose close would be zero-length (§5.1.4)', () => {
    const reduced = reduce(trackingSince(at('09:00')), {
      type: 'stopTracking',
      now: at('09:00'),
      sinceWhen: at('09:00')
    })

    expect(reduced.writes).toEqual([{ kind: 'discardOpenSegment' }])
    expect(reduced.state.status).toBe('not_tracking')
  })

  it('extends the watermark and settles the idle event on "keep it on X"', () => {
    const reduced = reduce(trackingSince(at('09:00')), {
      type: 'idleKeep',
      now: at('10:00'),
      gap: { id: 7, startedAt: at('09:30'), endedAt: at('09:55') }
    })

    expect(reduced.state.open).toMatchObject({
      startedAt: at('09:00'),
      confirmedThrough: at('10:00')
    })
    expect(reduced.state.idleUnresolved).toBe(false)
    expect(reduced.writes).toEqual([
      { kind: 'updateOpenSegment', confirmedThrough: at('10:00') },
      { kind: 'resolveIdleEvent', idleEventId: 7, resolution: 'kept', resolvedAt: at('10:00') }
    ])
  })

  it('splits three ways on "that was a break"', () => {
    const reduced = reduce(trackingSince(at('09:00')), {
      type: 'idleBreak',
      now: at('10:00'),
      breakBucketId: BREAK_BUCKET_ID,
      gap: { id: 8, startedAt: at('09:30'), endedAt: at('09:55') }
    })

    expect(reduced.writes).toEqual([
      { kind: 'closeOpenSegment', endedAt: at('09:30'), confirmedThrough: at('09:30') },
      {
        kind: 'insertClosedSegment',
        bucketId: BREAK_BUCKET_ID,
        startedAt: at('09:30'),
        endedAt: at('09:55'),
        confirmedThrough: at('09:55'),
        origin: 'idle_resolution',
        note: null
      },
      {
        kind: 'openSegment',
        bucketId: ACME_BUILD,
        startedAt: at('09:55'),
        confirmedThrough: at('10:00'),
        origin: 'idle_resolution',
        note: null
      },
      { kind: 'resolveIdleEvent', idleEventId: 8, resolution: 'break', resolvedAt: at('10:00') }
    ])
  })

  it('splits three ways onto the chosen bucket on "something else"', () => {
    const reduced = reduce(trackingSince(at('09:00')), {
      type: 'idleReassign',
      now: at('10:00'),
      bucketId: BETA_FIX,
      gap: { id: 9, startedAt: at('09:30'), endedAt: at('09:55') }
    })

    expect(reduced.writes[1]).toEqual({
      kind: 'insertClosedSegment',
      bucketId: BETA_FIX,
      startedAt: at('09:30'),
      endedAt: at('09:55'),
      confirmedThrough: at('09:55'),
      origin: 'idle_resolution',
      note: null
    })
    expect(reduced.writes[3]).toEqual({
      kind: 'resolveIdleEvent',
      idleEventId: 9,
      resolution: 'reassigned',
      resolvedAt: at('10:00')
    })
  })

  it('leaves the gap with no row at all on "leave it untracked" (§5.1.3)', () => {
    const reduced = reduce(trackingSince(at('09:00')), {
      type: 'idleUntracked',
      now: at('10:00'),
      gap: { id: 10, startedAt: at('09:30'), endedAt: at('09:55') }
    })

    expect(reduced.writes).toEqual([
      { kind: 'closeOpenSegment', endedAt: at('09:30'), confirmedThrough: at('09:30') },
      {
        kind: 'openSegment',
        bucketId: ACME_BUILD,
        startedAt: at('09:55'),
        confirmedThrough: at('10:00'),
        origin: 'idle_resolution',
        note: null
      },
      { kind: 'resolveIdleEvent', idleEventId: 10, resolution: 'split', resolvedAt: at('10:00') }
    ])
    expect(reduced.state.previousSegmentEndedAt).toBe(at('09:30'))
  })

  it('closes with recovery provenance and settles the app_gone idle event, or keeps running untouched', () => {
    const tracking = trackingSince(at('09:00'))

    const closed = reduce(tracking, {
      type: 'recoveryClose',
      now: at('13:00'),
      choice: 'end_at_last_seen',
      at: at('11:20'),
      idleEventId: 42
    })

    expect(closed.state.status).toBe('not_tracking')
    expect(closed.writes).toEqual([
      {
        kind: 'closeOpenSegment',
        endedAt: at('11:20'),
        confirmedThrough: at('11:20'),
        origin: 'recovery'
      },
      { kind: 'resolveIdleEvent', idleEventId: 42, resolution: 'split', resolvedAt: at('13:00') }
    ])

    const kept = reduce(tracking, {
      type: 'recoveryKeepRunning',
      now: at('13:00'),
      idleEventId: 42
    })

    expect(kept.state).toBe(tracking)
    expect(kept.writes).toEqual([
      { kind: 'resolveIdleEvent', idleEventId: 42, resolution: 'kept', resolvedAt: at('13:00') }
    ])
  })
})

// --- Property test (BUILD_PLAN §15.1) ---------------------------------------

/** Every non-retrospective transition that needs an open segment (issue #7's table). */
const TRACKING_EVENT_KINDS = [
  'confirmStillOnIt',
  'switchBucket',
  'takeBreak',
  'stopTracking',
  'snooze',
  'idleKeep',
  'idleBreak',
  'idleReassign',
  'idleUntracked',
  'recoveryClose',
  'recoveryKeepRunning'
] as const

interface GeneratedStep {
  kind: (typeof TRACKING_EVENT_KINDS)[number]
  /** How far the synthetic clock moves before this step. `0` is allowed, to hit degenerate cases. */
  advanceMs: number
  /** How far back the step's "since when" points — often far enough to need clamping. */
  sinceAgoMs: number
  bucketId: number
  gapAgoMs: number
  gapDurationMs: number
}

const HOUR = 60 * 60 * 1000

const stepArbitrary = fc.record<GeneratedStep>({
  kind: fc.constantFrom(...TRACKING_EVENT_KINDS),
  advanceMs: fc.integer({ min: 0, max: HOUR }),
  sinceAgoMs: fc.integer({ min: 0, max: 4 * HOUR }),
  bucketId: fc.integer({ min: BREAK_BUCKET_ID, max: BREAK_BUCKET_ID + 3 }),
  gapAgoMs: fc.integer({ min: 0, max: 2 * HOUR }),
  gapDurationMs: fc.integer({ min: 0, max: 2 * HOUR })
})

function buildEvent(
  state: TrackingMachineState,
  step: GeneratedStep,
  now: number,
  idleEventId: number
): TrackingEvent {
  // Only `startTracking` makes sense while stopped, so a step drawn for a
  // stopped machine becomes a (possibly backdated) start.
  if (state.status === 'not_tracking') {
    return {
      type: 'startTracking',
      now,
      bucketId: step.bucketId,
      sinceWhen: now - step.sinceAgoMs
    }
  }

  const gap = {
    id: idleEventId,
    startedAt: now - step.gapAgoMs - step.gapDurationMs,
    endedAt: now - step.gapAgoMs
  }

  switch (step.kind) {
    case 'switchBucket':
      return {
        type: 'switchBucket',
        now,
        bucketId: step.bucketId,
        sinceWhen: now - step.sinceAgoMs
      }
    case 'takeBreak':
      return {
        type: 'takeBreak',
        now,
        breakBucketId: BREAK_BUCKET_ID,
        sinceWhen: now - step.sinceAgoMs
      }
    case 'stopTracking':
      return { type: 'stopTracking', now, sinceWhen: now - step.sinceAgoMs }
    case 'idleKeep':
      return { type: 'idleKeep', now, gap }
    case 'idleBreak':
      return { type: 'idleBreak', now, gap, breakBucketId: BREAK_BUCKET_ID }
    case 'idleReassign':
      return { type: 'idleReassign', now, gap, bucketId: step.bucketId }
    case 'idleUntracked':
      return { type: 'idleUntracked', now, gap }
    case 'recoveryClose':
      return {
        type: 'recoveryClose',
        now,
        choice: 'end_at_custom',
        at: now - step.sinceAgoMs,
        idleEventId
      }
    case 'recoveryKeepRunning':
      return { type: 'recoveryKeepRunning', now, idleEventId }
    case 'snooze':
      return { type: 'snooze', now }
    case 'confirmStillOnIt':
      return { type: 'confirmStillOnIt', now }
  }
}

describe('reduce — segment invariants over random transition sequences (§15.1)', () => {
  it('keeps the §5.1 timeline invariants after every step', () => {
    fc.assert(
      fc.property(fc.array(stepArbitrary, { minLength: 1, maxLength: 200 }), (steps) => {
        const timeline = emptyTimeline()
        let state = initialTrackingState
        let now = at('08:00')
        let idleEventId = 0

        for (const step of steps) {
          // A monotonically non-decreasing clock: §5.6's rules are about
          // backdating, and real wall-clock time does not run backwards between
          // two events in the same session.
          now += step.advanceMs
          idleEventId += 1

          // applyStep asserts every invariant, so a violation fails the property
          // and fast-check shrinks the sequence that caused it.
          state = applyStep(state, timeline, buildEvent(state, step, now, idleEventId))
        }
      }),
      { numRuns: 300 }
    )
  })
})
