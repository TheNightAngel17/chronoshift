// The `tracking:*` IPC channels (BUILD_PLAN §11).
//
// This module is the impure shell around `services/tracking.ts`'s pure reducer:
// it reads the live wall clock, reconstructs the machine's state from the
// database, asks the reducer what should happen, and applies the resulting
// writes through the segments repository inside one transaction.
//
// There is deliberately no in-memory machine instance. The reducer is stateless
// between calls, and `segments` is the single source of truth for "what is
// being tracked right now" (§5.1) — keeping a cached copy alongside it would
// just be a second place to go stale after a retrospective edit, a recovery, or
// a crash.

import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { IpcEventChannel, IpcInvokeChannel } from '../../../shared/ipc-contract'
import type { Segment, TrackingState } from '../../../shared/types'
import { getDatabase } from '../../db/connection'
import { BucketsRepository } from '../../db/repositories/buckets'
import * as idleEvents from '../../db/repositories/idleEvents'
import { createSegmentsRepository, type SegmentsRepository } from '../../db/repositories/segments'
import {
  reduce,
  type SegmentWrite,
  type TrackingEvent,
  type TrackingMachineState
} from '../../services/tracking'
import {
  broadcastIpcEvent,
  err,
  validateIntegerArgument,
  validateNoArguments,
  validateOptionalIntegerArgument,
  validatePositiveIntegerArgument,
  withResult,
  type InvokeHandler,
  type IpcEventEmitter,
  type IpcRegistrar
} from './common'

interface TrackingDependencies {
  database: Database.Database
  segments: SegmentsRepository
  buckets: BucketsRepository
  emit: IpcEventEmitter
}

/** The machine state plus the row the "currently open segment" writes refer to. */
interface LoadedTracking {
  machine: TrackingMachineState
  openSegment: Segment | null
}

/**
 * The open segment right now, if any. `range(t, t)` is a point query for "the
 * segment covering instant `t`" (see `segments.integration.test.ts`); §5.1
 * allows at most one segment there, and the `endedAt === null` filter is a
 * belt-and-braces check that it really is the open one.
 */
function findOpenSegment(segments: SegmentsRepository, now: number): Segment | null {
  return segments.range(now, now).find((segment) => segment.endedAt === null) ?? null
}

/**
 * `endedAt` of the closed segment immediately before `referencePoint` — §5.6's
 * backdate floor. There is no "the segment before X" repository method, so this
 * scans the timeline up to that point, consistent with the unbounded scan
 * `segments.ts`'s own `assertTimelineInvariants` already does.
 */
function findPreviousSegmentEndedAt(
  segments: SegmentsRepository,
  referencePoint: number
): number | null {
  let latest: number | null = null

  for (const segment of segments.range(0, referencePoint)) {
    if (segment.endedAt !== null && segment.endedAt <= referencePoint) {
      latest = latest === null ? segment.endedAt : Math.max(latest, segment.endedAt)
    }
  }

  return latest
}

/**
 * Rebuilds `TrackingMachineState` from the database as of `now`. Every tracking
 * handler starts here, including `tracking:state` (which just reports it).
 */
export function loadTrackingState(
  dependencies: Pick<TrackingDependencies, 'database' | 'segments'>,
  now: number
): LoadedTracking {
  const openSegment = findOpenSegment(dependencies.segments, now)
  const referencePoint = openSegment?.startedAt ?? now
  const previousSegmentEndedAt = findPreviousSegmentEndedAt(dependencies.segments, referencePoint)
  const idleUnresolved = idleEvents.getUnresolved(dependencies.database) !== null

  if (openSegment === null) {
    return {
      machine: { status: 'not_tracking', open: null, idleUnresolved, previousSegmentEndedAt },
      openSegment: null
    }
  }

  return {
    machine: {
      status: 'tracking',
      open: {
        bucketId: openSegment.bucketId,
        startedAt: openSegment.startedAt,
        // `OpenSegmentState.confirmedThrough` is not nullable: an open segment is
        // always at least confirmed through its own start (§5.2), which is also
        // how the reducer's own `startTracking` initialises it.
        confirmedThrough: openSegment.confirmedThrough ?? openSegment.startedAt,
        origin: openSegment.origin,
        note: openSegment.note
      },
      idleUnresolved,
      previousSegmentEndedAt
    },
    openSegment
  }
}

/** The `TrackingState` the renderer sees: the open segment and its bucket, or both `null`. */
function readTrackingState(dependencies: TrackingDependencies, now: number): TrackingState {
  const segment = findOpenSegment(dependencies.segments, now)

  return {
    segment,
    bucket: segment === null ? null : dependencies.buckets.getById(segment.bucketId)
  }
}

/**
 * Applies the reducer's writes in one transaction. A switch's close-then-open
 * pair must not land half-applied (§14); the repository methods are each their
 * own transaction, which better-sqlite3 nests via savepoints.
 *
 * Deliberately does not call `SegmentsRepository.switch()` even though a
 * `switchBucket`/`stopTracking` transition looks like exactly that method's
 * job: the reducer's writes are more general than `switch()`'s fixed
 * close-then-open shape (a zero-length close becomes `discardOpenSegment`, a
 * delete, which `switch()` has no equivalent of), so every write kind is
 * applied through the same one-write-at-a-time loop regardless of which
 * transition produced it.
 */
function applyWrites(
  dependencies: TrackingDependencies,
  writes: SegmentWrite[],
  openSegmentId: number | null
): void {
  const requireOpenSegmentId = (kind: string): number => {
    if (openSegmentId === null) {
      throw new Error(`Cannot apply "${kind}" without an open segment.`)
    }

    return openSegmentId
  }

  const apply = dependencies.database.transaction((pending: SegmentWrite[]): void => {
    for (const write of pending) {
      switch (write.kind) {
        case 'openSegment':
          dependencies.segments.open({
            bucketId: write.bucketId,
            startedAt: write.startedAt,
            confirmedThrough: write.confirmedThrough,
            origin: write.origin,
            note: write.note
          })
          break

        case 'closeOpenSegment':
          // No `origin` in this issue's scope: only the recovery transition ever
          // sets that override, and `recovery:*` is a later issue.
          dependencies.segments.update(requireOpenSegmentId(write.kind), {
            endedAt: write.endedAt,
            confirmedThrough: write.confirmedThrough
          })
          break

        case 'insertClosedSegment':
          dependencies.segments.create({
            bucketId: write.bucketId,
            startedAt: write.startedAt,
            endedAt: write.endedAt,
            confirmedThrough: write.confirmedThrough,
            origin: write.origin,
            note: write.note
          })
          break

        case 'updateOpenSegment':
          dependencies.segments.update(requireOpenSegmentId(write.kind), {
            confirmedThrough: write.confirmedThrough
          })
          break

        case 'discardOpenSegment':
          dependencies.segments.delete(requireOpenSegmentId(write.kind))
          break

        case 'resolveIdleEvent':
          idleEvents.resolve(
            write.idleEventId,
            write.resolution,
            write.resolvedAt,
            dependencies.database
          )
          break

        default: {
          // Exhaustiveness guard, mirroring `services/tracking.ts`'s own: a new
          // `SegmentWrite` kind fails the build here rather than silently no-oping.
          const unhandled: never = write
          throw new Error(`Unhandled segment write: ${JSON.stringify(unhandled)}`)
        }
      }
    }
  })

  apply(writes)
}

/**
 * Loads the machine, reduces `event`, applies the writes, and returns the
 * resulting `TrackingState`. `tracking:changed` fires only when something
 * actually changed — a no-op transition (an ignored snooze, a confirmation that
 * does not move the watermark) has no news for anyone.
 */
function applyTrackingEvent(
  dependencies: TrackingDependencies,
  event: TrackingEvent
): TrackingState {
  const loaded = loadTrackingState(dependencies, event.now)
  const { writes } = reduce(loaded.machine, event)

  if (writes.length === 0) {
    return readTrackingState(dependencies, event.now)
  }

  applyWrites(dependencies, writes, loaded.openSegment?.id ?? null)

  // Reuse the event's own `now` rather than re-reading the clock: this module's
  // whole point is that every instant it reasons about comes from the event
  // (see the file header), not a fresh `Date.now()` call after the fact.
  const state = readTrackingState(dependencies, event.now)
  dependencies.emit(IpcEventChannel.trackingChanged, state)

  return state
}

export function registerTrackingIpcHandlers(
  registrar: IpcRegistrar = ipcMain,
  database: Database.Database = getDatabase(),
  emit: IpcEventEmitter = broadcastIpcEvent,
  segments: SegmentsRepository = createSegmentsRepository(database),
  buckets: BucketsRepository = new BucketsRepository(database)
): void {
  const dependencies: TrackingDependencies = { database, segments, buckets, emit }

  const stateHandler: InvokeHandler<typeof IpcInvokeChannel.trackingState> = (_event, ...args) => {
    const argsError = validateNoArguments(args)

    if (argsError) {
      return err(argsError)
    }

    return withResult(() => readTrackingState(dependencies, Date.now()))
  }

  const startHandler: InvokeHandler<typeof IpcInvokeChannel.trackingStart> = (
    _event,
    bucketId,
    since
  ) => {
    const bucketError = validateIntegerArgument(bucketId, 'bucketId')

    if (bucketError) {
      return err(bucketError)
    }

    const sinceError = validateOptionalIntegerArgument(since, 'since')

    if (sinceError) {
      return err(sinceError)
    }

    return withResult(() => {
      const now = Date.now()

      // §5.6: "Default: now" — an omitted `since` means "starting right now".
      return applyTrackingEvent(dependencies, {
        type: 'startTracking',
        now,
        bucketId,
        sinceWhen: since ?? now
      })
    })
  }

  const switchHandler: InvokeHandler<typeof IpcInvokeChannel.trackingSwitch> = (
    _event,
    bucketId,
    since
  ) => {
    const bucketError = validateIntegerArgument(bucketId, 'bucketId')

    if (bucketError) {
      return err(bucketError)
    }

    const sinceError = validateOptionalIntegerArgument(since, 'since')

    if (sinceError) {
      return err(sinceError)
    }

    return withResult(() => {
      const now = Date.now()

      // Taking a break is an ordinary switch to the reserved `kind='break'`
      // bucket (§5.3, ADR 0001), so it needs no channel of its own.
      return applyTrackingEvent(dependencies, {
        type: 'switchBucket',
        now,
        bucketId,
        sinceWhen: since ?? now
      })
    })
  }

  const stopHandler: InvokeHandler<typeof IpcInvokeChannel.trackingStop> = (_event, since) => {
    const sinceError = validateOptionalIntegerArgument(since, 'since')

    if (sinceError) {
      return err(sinceError)
    }

    return withResult(() => {
      const now = Date.now()

      return applyTrackingEvent(dependencies, {
        type: 'stopTracking',
        now,
        sinceWhen: since ?? now
      })
    })
  }

  const confirmHandler: InvokeHandler<typeof IpcInvokeChannel.trackingConfirm> = (_event, at) => {
    const atError = validateOptionalIntegerArgument(at, 'at')

    if (atError) {
      return err(atError)
    }

    // `at` substitutes for wall-clock now (a caller with its own clock, a
    // deterministic test); it is not a backdate — confirmation always sets the
    // watermark to the transition's `now` (§5.2).
    return withResult(() =>
      applyTrackingEvent(dependencies, { type: 'confirmStillOnIt', now: at ?? Date.now() })
    )
  }

  const snoozeHandler: InvokeHandler<typeof IpcInvokeChannel.trackingSnooze> = (
    _event,
    minutes
  ) => {
    if (minutes !== undefined) {
      const minutesError = validatePositiveIntegerArgument(minutes, 'minutes')

      if (minutesError) {
        return err(minutesError)
      }
    }

    return withResult(() => {
      // The reducer's snooze leaves the timeline alone, so this emits nothing.
      // TODO(spec): wire this into issue #8's check-in scheduler once it exists.
      applyTrackingEvent(dependencies, { type: 'snooze', now: Date.now() })
    })
  }

  registrar.handle(IpcInvokeChannel.trackingState, stateHandler)
  registrar.handle(IpcInvokeChannel.trackingStart, startHandler)
  registrar.handle(IpcInvokeChannel.trackingSwitch, switchHandler)
  registrar.handle(IpcInvokeChannel.trackingStop, stopHandler)
  registrar.handle(IpcInvokeChannel.trackingConfirm, confirmHandler)
  registrar.handle(IpcInvokeChannel.trackingSnooze, snoozeHandler)
}
