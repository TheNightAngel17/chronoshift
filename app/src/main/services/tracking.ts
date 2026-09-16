// The tracking state machine (BUILD_PLAN §5.1, §5.2, §5.3, §5.6; the transition
// table resolved in issue #7).
//
// This module is pure decision logic: `reduce(state, event)` returns the next
// state plus a declarative list of segment writes. It performs no I/O — no
// database access, no IPC, not even a `Date.now()` call (every event carries its
// own `now`), so a given sequence of events always reduces to the same result and
// the property test alongside this file can drive a synthetic clock.
//
// Applying `writes` transactionally against real `segments` rows belongs to a
// separate issue (#40). That is why writes carry no row ids: in this pure world a
// segment that is about to be opened does not have one yet, and the only row a
// transition ever mutates is "the currently open segment", which the applier can
// look up for itself. The write vocabulary is deliberately kept close to
// `main/db/repositories/segments.ts`'s primitives (`open`, `switch`, `update`,
// `delete`) so that mapping is mechanical.
//
// Retrospective edit / split / merge are explicitly *not* transitions of this
// machine (issue #7): they are stateless repository operations over closed rows.
//
// All timestamps are integer UTC epoch milliseconds, matching `Segment`.

import { clampBackdate } from '../../shared/clamp'
import type { IdleResolution, RecoveryChoice, SegmentOrigin } from '../../shared/types'

/**
 * The machine has exactly two states (ADR 0001): "on break" is not one of them —
 * a break is an ordinary switch to the `kind='break'` system bucket (§5.3), and
 * an unresolved idle gap is an orthogonal flag, not a node in this graph.
 */
export type TrackingStatus = 'not_tracking' | 'tracking'

/**
 * What the machine remembers about the segment currently being tracked.
 *
 * Deliberately not a `Segment`: there is no row `id` here (a segment this
 * reducer has just decided to open has not been inserted yet) and no
 * `createdAt`/`updatedAt`. These are exactly the fields a later transition needs
 * in order to compute its writes — the bucket it would close, the floor for a
 * backdate (§5.6), the watermark it would extend (§5.2), and the provenance and
 * note a reopened segment inherits after an idle split.
 */
export interface OpenSegmentState {
  bucketId: number
  startedAt: number
  /** Never `null` here: an open segment is always at least confirmed through its own start (§5.2). */
  confirmedThrough: number
  origin: SegmentOrigin
  note: string | null
}

interface TrackingStateBase {
  /**
   * Set by the caller when `idle_events` holds an unresolved row, cleared by the
   * idle-resolution transitions. Orthogonal to `status` and meaningful only
   * while tracking. This reducer does not refuse transitions on it — prompt
   * arbitration is issue #8's job, not this machine's.
   */
  idleUnresolved: boolean
  /**
   * `endedAt` of the segment immediately before the current one, or `null` if
   * there is none. Kept because §5.6's floor is
   * `max(current segment's startedAt, previous segment's endedAt)`, and a
   * backdated *start* has no current segment to floor against at all.
   */
  previousSegmentEndedAt: number | null
}

/** The machine while a segment is open — the state every transition but `startTracking` needs. */
export type TrackingOpenState = TrackingStateBase & {
  status: 'tracking'
  open: OpenSegmentState
}

export type TrackingMachineState =
  (TrackingStateBase & { status: 'not_tracking'; open: null }) | TrackingOpenState

/** The gap an `IdlePrompt` is resolving — the fields of an `IdleEvent` this machine needs. */
export interface IdleGap {
  /** `idle_events.id`, so the resolution write can name the row it settles. */
  id: number
  startedAt: number
  endedAt: number
}

/**
 * Every event carries the live wall-clock `now` it was raised at; §5.6 step 1
 * requires comparing backdates against live time rather than a cached value, and
 * threading it through the event keeps this module free of clock access.
 */
export type TrackingEvent = { now: number } &
  /** 1. Start tracking — `StartPrompt`, or the tray's "Recent: X". */
  (
    | { type: 'startTracking'; bucketId: number; sinceWhen: number; note?: string | null }
    /** 2. "Yes, still on it" from a `CheckinPrompt`. */
    | { type: 'confirmStillOnIt' }
    /** 3. Switch bucket — tray-direct or via a `CheckinPrompt`. */
    | { type: 'switchBucket'; bucketId: number; sinceWhen: number; note?: string | null }
    /** 4. Take a break — a switch to the reserved `kind='break'` bucket (§5.3). */
    | { type: 'takeBreak'; breakBucketId: number; sinceWhen: number }
    /** 5. Stop tracking. */
    | { type: 'stopTracking'; sinceWhen: number }
    /** 6. Snooze the check-in. Changes nothing on the timeline. */
    | { type: 'snooze' }
    /** 7. `IdlePrompt`: keep it on the current bucket. */
    | { type: 'idleKeep'; gap: IdleGap }
    /** 8. `IdlePrompt`: that was a break. */
    | { type: 'idleBreak'; gap: IdleGap; breakBucketId: number }
    /** 9. `IdlePrompt`: it was something else. */
    | { type: 'idleReassign'; gap: IdleGap; bucketId: number }
    /** 10. `IdlePrompt`: leave the gap untracked (§5.1.3 — no filler row). */
    | { type: 'idleUntracked'; gap: IdleGap }
    /**
     * 11. `RecoveryPrompt`: end at last confirmed / last seen / a custom time.
     * `idleEventId` names the `app_gone` row §8.5 always creates before showing
     * this prompt (see `RecoveryInfo.idleEventId`) — it gets resolved as
     * `resolution='split'` per issue #7's table ("reuses idle-resolution shape").
     */
    | {
        type: 'recoveryClose'
        /** Which of §9.4's options produced `at`; provenance for the caller, not used to branch. */
        choice: Exclude<RecoveryChoice, 'keep_running'>
        at: number
        idleEventId: number
      }
    /** 12. `RecoveryPrompt`: keep running — resolves the same `app_gone` row as `resolution='kept'`. */
    | { type: 'recoveryKeepRunning'; idleEventId: number }
  )

/**
 * One intended change to the timeline. A discriminated union rather than
 * repository calls: the reducer decides *what* should happen, and #40 maps these
 * onto `SegmentsRepository` inside a transaction.
 */
export type SegmentWrite =
  /** Insert a new open segment (`ended_at IS NULL`) — `SegmentsRepository.open`. */
  | {
      kind: 'openSegment'
      bucketId: number
      startedAt: number
      confirmedThrough: number
      origin: SegmentOrigin
      note: string | null
    }
  /** Close the currently open segment. `origin` is only present when the transition changes provenance. */
  | { kind: 'closeOpenSegment'; endedAt: number; confirmedThrough: number; origin?: SegmentOrigin }
  /** Insert an already-closed segment — the middle slice of an idle three-way split. */
  | {
      kind: 'insertClosedSegment'
      bucketId: number
      startedAt: number
      endedAt: number
      confirmedThrough: number
      origin: SegmentOrigin
      note: string | null
    }
  /** Move the open segment's watermark without closing it (§5.2) — `SegmentsRepository.update`. */
  | { kind: 'updateOpenSegment'; confirmedThrough: number }
  /**
   * Delete the currently open segment instead of closing it, because closing it
   * at the requested time would produce a zero-length row. §5.1.4 says such rows
   * are invalid and must be rejected or deleted; deleting is the option that
   * still lets the user's actual intent (the switch, the stop) go through.
   */
  | { kind: 'discardOpenSegment' }
  /** Settle the `idle_events` row this resolution answers (§9.3). */
  | {
      kind: 'resolveIdleEvent'
      idleEventId: number
      resolution: IdleResolution
      resolvedAt: number
    }

/** What {@link reduce} returns: the next state, and the writes that get it there. */
export interface TrackingReduction {
  state: TrackingMachineState
  writes: SegmentWrite[]
}

/** A machine that has never tracked anything. */
export const initialTrackingState: TrackingMachineState = {
  status: 'not_tracking',
  open: null,
  idleUnresolved: false,
  previousSegmentEndedAt: null
}

/**
 * Whether `event` is meaningful in `state`. Exposed as a guard predicate because
 * issue #7 makes prompt arbitration issue #8's concern: callers ask before
 * offering an affordance, and {@link reduce} stays total by treating an
 * inapplicable event as a no-op rather than throwing.
 */
export function canApply(state: TrackingMachineState, event: TrackingEvent): boolean {
  return event.type === 'startTracking'
    ? state.status === 'not_tracking'
    : state.status === 'tracking'
}

/**
 * The effective timestamp to use for a backdate that lands inside the currently
 * open segment (a switch, a break, a stop, a recovery close, an idle gap start).
 *
 * Runs §5.6's pipeline via `clampBackdate`, then applies one extra floor: the
 * segment's own confirmation watermark. §5.6 is silent about a backdate that
 * would move behind time the user has already affirmatively confirmed, but
 * un-confirming is not something any transition in issue #7's table intends, and
 * the segments repository rejects it outright, so the watermark acts as a floor.
 *
 * TODO(spec): confirm that flooring a backdate to `confirmed_through` (rather
 * than refusing the transition and telling the user why) is the intended §5.6
 * behaviour.
 */
function backdateInto(
  open: OpenSegmentState,
  value: number,
  now: number,
  previousSegmentEndedAt: number | null
): number {
  const clamped = clampBackdate(value, now, open.startedAt, previousSegmentEndedAt).value

  return Math.max(clamped, Math.min(open.confirmedThrough, now))
}

/**
 * The watermark for "the user has just told us they are on this bucket right
 * now". Takes the later of `now` and the existing watermark so confirmation can
 * only ever move forward (§5.2 — it is a watermark, not a boolean).
 */
function confirmedThroughNow(open: OpenSegmentState, now: number): number {
  return Math.max(open.confirmedThrough, now)
}

/** Closes the open segment, or discards it when the close would be zero-length (§5.1.4). */
function closeOrDiscard(
  open: OpenSegmentState,
  endedAt: number,
  origin?: SegmentOrigin
): { write: SegmentWrite; endedAt: number | null } {
  if (endedAt <= open.startedAt) {
    return { write: { kind: 'discardOpenSegment' }, endedAt: null }
  }

  return {
    write: {
      kind: 'closeOpenSegment',
      endedAt,
      // §5.2's retroactive confirmation: naming a close time affirms the segment
      // ran until then, so the watermark follows the close rather than lagging.
      confirmedThrough: endedAt,
      ...(origin === undefined ? {} : { origin })
    },
    endedAt
  }
}

/** Shared body of transitions 3 (switch) and 4 (take a break) — §5.3 makes them one path. */
function switchToBucket(
  state: TrackingOpenState,
  event: { now: number },
  target: { bucketId: number; sinceWhen: number; note: string | null }
): TrackingReduction {
  const at = backdateInto(state.open, target.sinceWhen, event.now, state.previousSegmentEndedAt)
  const closed = closeOrDiscard(state.open, at)
  const opened: OpenSegmentState = {
    bucketId: target.bucketId,
    startedAt: at,
    confirmedThrough: event.now,
    origin: 'checkin',
    note: target.note
  }

  return {
    state: {
      status: 'tracking',
      open: opened,
      idleUnresolved: state.idleUnresolved,
      previousSegmentEndedAt: closed.endedAt ?? state.previousSegmentEndedAt
    },
    writes: [closed.write, { kind: 'openSegment', ...opened }]
  }
}

/**
 * Shared body of transitions 8, 9 and 10 — the idle three-way split. The current
 * segment closes at the gap's start, the gap itself is either filled with
 * `gapBucketId`'s segment or left as legal untracked time (§5.1.3) when
 * `gapBucketId` is `null`, and the original bucket reopens at the gap's end.
 */
function resolveIdleGap(
  state: TrackingOpenState,
  event: { now: number },
  gap: IdleGap,
  gapBucketId: number | null,
  resolution: IdleResolution
): TrackingReduction {
  const gapStart = backdateInto(state.open, gap.startedAt, event.now, state.previousSegmentEndedAt)
  // The gap's end is floored to its own start (so the middle slice never runs
  // backwards) and snapped to `now` if it claims to be in the future.
  const gapEnd = clampBackdate(gap.endedAt, event.now, gapStart, null).value

  const closed = closeOrDiscard(state.open, gapStart)
  const writes: SegmentWrite[] = [closed.write]

  // A zero-length gap has nothing to attribute, so it gets no row either way
  // (§5.1.4) — the close and the reopen simply meet at the same instant.
  if (gapBucketId !== null && gapEnd > gapStart) {
    writes.push({
      kind: 'insertClosedSegment',
      bucketId: gapBucketId,
      startedAt: gapStart,
      endedAt: gapEnd,
      confirmedThrough: gapEnd,
      origin: 'idle_resolution',
      note: null
    })
  }

  const reopened: OpenSegmentState = {
    bucketId: state.open.bucketId,
    startedAt: gapEnd,
    confirmedThrough: event.now,
    origin: 'idle_resolution',
    note: state.open.note
  }

  writes.push({ kind: 'openSegment', ...reopened })
  writes.push({
    kind: 'resolveIdleEvent',
    idleEventId: gap.id,
    resolution,
    resolvedAt: event.now
  })

  const filledGapEndedAt = gapBucketId !== null && gapEnd > gapStart ? gapEnd : null

  return {
    state: {
      status: 'tracking',
      open: reopened,
      idleUnresolved: false,
      previousSegmentEndedAt: filledGapEndedAt ?? closed.endedAt ?? state.previousSegmentEndedAt
    },
    writes
  }
}

/** Stop (5) and recovery-close (11): close the open segment and leave `tracking`. */
function closeAndStop(
  state: TrackingOpenState,
  event: { now: number },
  at: number,
  origin?: SegmentOrigin
): TrackingReduction {
  const effective = backdateInto(state.open, at, event.now, state.previousSegmentEndedAt)
  const closed = closeOrDiscard(state.open, effective, origin)

  return {
    state: {
      status: 'not_tracking',
      open: null,
      idleUnresolved: false,
      previousSegmentEndedAt: closed.endedAt ?? state.previousSegmentEndedAt
    },
    writes: [closed.write]
  }
}

/**
 * Applies one event to the machine, returning the next state and the writes that
 * realise it. Pure and total: an event that makes no sense in the current state
 * (see {@link canApply}) returns the state unchanged with no writes.
 */
export function reduce(state: TrackingMachineState, event: TrackingEvent): TrackingReduction {
  if (!canApply(state, event)) {
    return { state, writes: [] }
  }

  if (event.type === 'startTracking') {
    // There is no "current segment" to floor against yet — the segment being
    // backdated is the one about to open, so its own `startedAt` is the
    // candidate itself and the only real floor is the previous segment's end.
    const startedAt = clampBackdate(
      event.sinceWhen,
      event.now,
      event.sinceWhen,
      state.previousSegmentEndedAt
    ).value

    const opened: OpenSegmentState = {
      bucketId: event.bucketId,
      startedAt,
      confirmedThrough: startedAt,
      origin: 'manual',
      note: event.note ?? null
    }

    return {
      state: {
        status: 'tracking',
        open: opened,
        idleUnresolved: state.idleUnresolved,
        previousSegmentEndedAt: state.previousSegmentEndedAt
      },
      writes: [{ kind: 'openSegment', ...opened }]
    }
  }

  // Everything below is `tracking`-only, which `canApply` has already checked.
  if (state.status !== 'tracking') {
    return { state, writes: [] }
  }

  const tracking = state

  switch (event.type) {
    case 'confirmStillOnIt': {
      const confirmedThrough = confirmedThroughNow(tracking.open, event.now)

      if (confirmedThrough === tracking.open.confirmedThrough) {
        return { state, writes: [] }
      }

      return {
        state: { ...tracking, open: { ...tracking.open, confirmedThrough } },
        writes: [{ kind: 'updateOpenSegment', confirmedThrough }]
      }
    }

    case 'switchBucket':
      return switchToBucket(tracking, event, {
        bucketId: event.bucketId,
        sinceWhen: event.sinceWhen,
        note: event.note ?? null
      })

    case 'takeBreak':
      // §5.3: the break bucket is just another switch target, nothing special.
      return switchToBucket(tracking, event, {
        bucketId: event.breakBucketId,
        sinceWhen: event.sinceWhen,
        note: null
      })

    case 'stopTracking':
      return closeAndStop(tracking, event, event.sinceWhen)

    case 'snooze':
      // Snooze only moves the scheduler's next prompt time (issue #8); the
      // timeline is untouched and the watermark deliberately does not advance.
      return { state, writes: [] }

    case 'idleKeep': {
      const confirmedThrough = confirmedThroughNow(tracking.open, event.now)
      const writes: SegmentWrite[] =
        confirmedThrough === tracking.open.confirmedThrough
          ? []
          : [{ kind: 'updateOpenSegment', confirmedThrough }]

      writes.push({
        kind: 'resolveIdleEvent',
        idleEventId: event.gap.id,
        resolution: 'kept',
        resolvedAt: event.now
      })

      return {
        state: {
          ...tracking,
          open: { ...tracking.open, confirmedThrough },
          idleUnresolved: false
        },
        writes
      }
    }

    case 'idleBreak':
      return resolveIdleGap(tracking, event, event.gap, event.breakBucketId, 'break')

    case 'idleReassign':
      return resolveIdleGap(tracking, event, event.gap, event.bucketId, 'reassigned')

    case 'idleUntracked':
      // Issue #7's table assigns this transition `resolution='split'` (the
      // segment really is split around the gap, which is left with no row).
      return resolveIdleGap(tracking, event, event.gap, null, 'split')

    case 'recoveryClose': {
      // The recovered segment's provenance becomes 'recovery' per issue #7's
      // table. (`SegmentPatch` does not accept `origin` today — #40's mapping
      // will need it to.) The `app_gone` idle event that triggered this prompt
      // (§8.5) is settled alongside it, as 'split' per issue #7's table.
      const closed = closeAndStop(tracking, event, event.at, 'recovery')

      return {
        state: closed.state,
        writes: [
          ...closed.writes,
          {
            kind: 'resolveIdleEvent',
            idleEventId: event.idleEventId,
            resolution: 'split',
            resolvedAt: event.now
          }
        ]
      }
    }

    case 'recoveryKeepRunning':
      // The segment was genuinely still running — the timeline is untouched,
      // but the `app_gone` idle event still needs settling, as 'kept'.
      return {
        state,
        writes: [
          {
            kind: 'resolveIdleEvent',
            idleEventId: event.idleEventId,
            resolution: 'kept',
            resolvedAt: event.now
          }
        ]
      }

    default: {
      // Exhaustiveness guard: a new `TrackingEvent` variant added without a
      // matching `case` above fails the build here instead of silently no-oping.
      const unhandled: never = event
      throw new Error(`Unhandled tracking event: ${JSON.stringify(unhandled)}`)
    }
  }
}
