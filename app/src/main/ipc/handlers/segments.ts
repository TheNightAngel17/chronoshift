// The `segments:*` IPC channels (BUILD_PLAN §11).
//
// Thin wrappers over `db/repositories/segments.ts`: the repository owns the
// §5.1 timeline invariants, so these handlers only validate their arguments,
// turn a throw into `Result.error`, and tell the renderer which slice of the
// timeline changed via `segments:changed`.
//
// Retrospective edit / split / merge are deliberately not tracking-machine
// transitions (issue #7) — they are stateless operations over closed rows,
// which is why they live here rather than in `tracking.ts`.

import { ipcMain } from 'electron'
import type Database from 'better-sqlite3'
import { IpcEventChannel, IpcInvokeChannel, type SegmentPatch } from '../../../shared/ipc-contract'
import type { Segment } from '../../../shared/types'
import { getDatabase } from '../../db/connection'
import { createSegmentsRepository, type SegmentsRepository } from '../../db/repositories/segments'
import {
  broadcastIpcEvent,
  err,
  isInteger,
  isRecord,
  validateIntegerArgument,
  validateOptionalStringArgument,
  withResult,
  type InvokeHandler,
  type IpcEventEmitter,
  type IpcRegistrar
} from './common'

const SEGMENT_PATCH_KEYS = new Set(['bucketId', 'startedAt', 'endedAt', 'confirmedThrough', 'note'])

/**
 * The time a segment occupies on the timeline. An open segment has no end, so
 * "up to now" is the widest range it can currently be said to affect.
 */
function segmentRange(segment: Segment, now: number): { fromMs: number; toMs: number } {
  return { fromMs: segment.startedAt, toMs: segment.endedAt ?? now }
}

function spanRanges(ranges: { fromMs: number; toMs: number }[]): { fromMs: number; toMs: number } {
  return {
    fromMs: Math.min(...ranges.map((range) => range.fromMs)),
    toMs: Math.max(...ranges.map((range) => range.toMs))
  }
}

/**
 * The segment with this id, or `null`. The repository exposes no `getById`, so
 * this scans the whole timeline — the same unbounded scan `segments.ts`'s own
 * invariant check already performs, and only needed to describe the affected
 * range of a mutation that is about to move or remove a row.
 */
function findSegmentById(segments: SegmentsRepository, id: number): Segment | null {
  return segments.range(0, Number.MAX_SAFE_INTEGER).find((segment) => segment.id === id) ?? null
}

function validatePatch(patch: unknown): string | null {
  if (!isRecord(patch)) {
    return 'patch must be an object.'
  }

  const patchKeys = Object.keys(patch)

  if (patchKeys.length === 0) {
    return 'patch must include at least one supported field.'
  }

  const unknownKeys = patchKeys.filter((key) => !SEGMENT_PATCH_KEYS.has(key))

  if (unknownKeys.length > 0) {
    return `patch contains unsupported field(s): ${unknownKeys.join(', ')}.`
  }

  if ('bucketId' in patch && !isInteger(patch.bucketId)) {
    return 'patch.bucketId must be an integer.'
  }

  if ('startedAt' in patch && !isInteger(patch.startedAt)) {
    return 'patch.startedAt must be an integer.'
  }

  if ('endedAt' in patch && patch.endedAt !== null && !isInteger(patch.endedAt)) {
    return 'patch.endedAt must be an integer or null.'
  }

  if (
    'confirmedThrough' in patch &&
    patch.confirmedThrough !== null &&
    !isInteger(patch.confirmedThrough)
  ) {
    return 'patch.confirmedThrough must be an integer or null.'
  }

  if ('note' in patch) {
    return validateOptionalStringArgument(patch.note, 'patch.note')
  }

  return null
}

function validateBounds(fromMs: unknown, toMs: unknown): string | null {
  return validateIntegerArgument(fromMs, 'fromMs') ?? validateIntegerArgument(toMs, 'toMs')
}

export function registerSegmentsIpcHandlers(
  registrar: IpcRegistrar = ipcMain,
  database: Database.Database = getDatabase(),
  emit: IpcEventEmitter = broadcastIpcEvent,
  segments: SegmentsRepository = createSegmentsRepository(database)
): void {
  const emitChanged = (range: { fromMs: number; toMs: number }): void => {
    emit(IpcEventChannel.segmentsChanged, range)
  }

  const rangeHandler: InvokeHandler<typeof IpcInvokeChannel.segmentsRange> = (
    _event,
    fromMs,
    toMs
  ) => {
    const boundsError = validateBounds(fromMs, toMs)

    if (boundsError) {
      return err(boundsError)
    }

    return withResult(() => segments.range(fromMs, toMs))
  }

  const createHandler: InvokeHandler<typeof IpcInvokeChannel.segmentsCreate> = (
    _event,
    bucketId,
    start,
    end,
    note
  ) => {
    const bucketError = validateIntegerArgument(bucketId, 'bucketId')

    if (bucketError) {
      return err(bucketError)
    }

    const startError =
      validateIntegerArgument(start, 'start') ?? validateIntegerArgument(end, 'end')

    if (startError) {
      return err(startError)
    }

    const noteError = validateOptionalStringArgument(note, 'note')

    if (noteError) {
      return err(noteError)
    }

    return withResult(() => {
      const created = segments.create({
        bucketId,
        startedAt: start,
        endedAt: end,
        note: note ?? null
      })

      emitChanged(segmentRange(created, Date.now()))

      return created
    })
  }

  const updateHandler: InvokeHandler<typeof IpcInvokeChannel.segmentsUpdate> = (
    _event,
    id,
    patch
  ) => {
    const idError = validateIntegerArgument(id, 'id')

    if (idError) {
      return err(idError)
    }

    const patchError = validatePatch(patch)

    if (patchError) {
      return err(patchError)
    }

    return withResult(() => {
      const now = Date.now()
      // An edit can move a segment, so the affected range spans where it was and
      // where it ended up, not just its new position.
      const before = findSegmentById(segments, id)
      const updated = segments.update(id, patch as SegmentPatch)
      const ranges = [segmentRange(updated, now)]

      if (before !== null) {
        ranges.push(segmentRange(before, now))
      }

      emitChanged(spanRanges(ranges))

      return updated
    })
  }

  const splitHandler: InvokeHandler<typeof IpcInvokeChannel.segmentsSplit> = (_event, id, atMs) => {
    const idError = validateIntegerArgument(id, 'id') ?? validateIntegerArgument(atMs, 'atMs')

    if (idError) {
      return err(idError)
    }

    return withResult(() => {
      const halves = segments.split(id, atMs)
      const now = Date.now()

      emitChanged(spanRanges(halves.map((half) => segmentRange(half, now))))

      return halves
    })
  }

  const mergeHandler: InvokeHandler<typeof IpcInvokeChannel.segmentsMerge> = (_event, idA, idB) => {
    const idError = validateIntegerArgument(idA, 'idA') ?? validateIntegerArgument(idB, 'idB')

    if (idError) {
      return err(idError)
    }

    return withResult(() => {
      const merged = segments.merge(idA, idB)

      emitChanged(segmentRange(merged, Date.now()))

      return merged
    })
  }

  const deleteHandler: InvokeHandler<typeof IpcInvokeChannel.segmentsDelete> = (_event, id) => {
    const idError = validateIntegerArgument(id, 'id')

    if (idError) {
      return err(idError)
    }

    return withResult(() => {
      // Read the row before it is gone; afterwards there is nothing left to
      // describe the range that changed.
      const doomed = findSegmentById(segments, id)
      const now = Date.now()

      segments.delete(id)

      emitChanged(doomed === null ? { fromMs: now, toMs: now } : segmentRange(doomed, now))
    })
  }

  const needsReviewHandler: InvokeHandler<typeof IpcInvokeChannel.segmentsNeedsReview> = (
    _event,
    fromMs,
    toMs
  ) => {
    const boundsError = validateBounds(fromMs, toMs)

    if (boundsError) {
      return err(boundsError)
    }

    return withResult(() => segments.needsReview(fromMs, toMs))
  }

  registrar.handle(IpcInvokeChannel.segmentsRange, rangeHandler)
  registrar.handle(IpcInvokeChannel.segmentsCreate, createHandler)
  registrar.handle(IpcInvokeChannel.segmentsUpdate, updateHandler)
  registrar.handle(IpcInvokeChannel.segmentsSplit, splitHandler)
  registrar.handle(IpcInvokeChannel.segmentsMerge, mergeHandler)
  registrar.handle(IpcInvokeChannel.segmentsDelete, deleteHandler)
  registrar.handle(IpcInvokeChannel.segmentsNeedsReview, needsReviewHandler)
}
