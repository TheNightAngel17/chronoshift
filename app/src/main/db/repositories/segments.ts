import type Database from 'better-sqlite3'
import type { SegmentPatch } from '../../../shared/ipc-contract'
import type { Segment, SegmentOrigin } from '../../../shared/types'

type SegmentRow = {
  id: number
  bucket_id: number
  started_at: number
  ended_at: number | null
  confirmed_through: number | null
  origin: SegmentOrigin
  note: string | null
  created_at: number
  updated_at: number
}

const SEGMENT_PATCH_KEYS = new Set(['bucketId', 'startedAt', 'endedAt', 'confirmedThrough', 'note'])

export interface CreateSegmentInput {
  bucketId: number
  startedAt: number
  endedAt: number
  confirmedThrough?: number | null
  origin?: SegmentOrigin
  note?: string | null
}

export interface OpenSegmentInput {
  bucketId: number
  startedAt: number
  confirmedThrough?: number | null
  origin?: SegmentOrigin
  note?: string | null
}

export interface SwitchSegmentInput {
  bucketId: number
  atMs: number
  confirmedThrough?: number | null
  origin?: SegmentOrigin
  note?: string | null
}

export interface SegmentsRepository {
  range(fromMs: number, toMs: number): Segment[]
  create(input: CreateSegmentInput): Segment
  open(input: OpenSegmentInput): Segment
  switch(input: SwitchSegmentInput): [Segment, Segment]
  update(id: number, patch: SegmentPatch): Segment
  split(id: number, atMs: number): [Segment, Segment]
  merge(idA: number, idB: number): Segment
  delete(id: number): void
  needsReview(fromMs: number, toMs: number): Segment[]
}

function mapSegment(row: SegmentRow): Segment {
  return {
    id: row.id,
    bucketId: row.bucket_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    confirmedThrough: row.confirmed_through,
    origin: row.origin,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function assertClosedRange(startedAt: number, endedAt: number): void {
  if (startedAt >= endedAt) {
    throw new Error('Segments must satisfy started_at < ended_at.')
  }
}

function assertConfirmedThroughInRange(
  startedAt: number,
  endedAt: number | null,
  confirmedThrough: number | null,
  now: number
): void {
  if (confirmedThrough === null) {
    return
  }

  if (confirmedThrough < startedAt) {
    throw new Error('confirmed_through must be at or after started_at.')
  }

  const upperBound = endedAt ?? now

  if (confirmedThrough > upperBound) {
    throw new Error('confirmed_through must be inside the segment range.')
  }
}

function getLaterConfirmation(a: number | null, b: number | null): number | null {
  if (a === null) {
    return b
  }

  if (b === null) {
    return a
  }

  return Math.max(a, b)
}

function getMergedNote(leftNote: string | null, rightNote: string | null): string | null {
  if (leftNote !== null && rightNote !== null && leftNote !== rightNote) {
    throw new Error('Cannot merge segments with conflicting notes until the spec defines the rule.')
  }

  return leftNote ?? rightNote ?? null
}

export function createSegmentsRepository(database: Database.Database): SegmentsRepository {
  const selectById = database.prepare(
    `
      SELECT
        id,
        bucket_id,
        started_at,
        ended_at,
        confirmed_through,
        origin,
        note,
        created_at,
        updated_at
      FROM segments
      WHERE id = ?
    `
  )

  const selectTimeline = database.prepare(
    `
      SELECT
        id,
        bucket_id,
        started_at,
        ended_at,
        confirmed_through,
        origin,
        note,
        created_at,
        updated_at
      FROM segments
      ORDER BY started_at ASC, id ASC
    `
  )

  const selectRange = database.prepare(
    `
      SELECT
        id,
        bucket_id,
        started_at,
        ended_at,
        confirmed_through,
        origin,
        note,
        created_at,
        updated_at
      FROM segments
      WHERE started_at < ?
        AND (ended_at IS NULL OR ended_at > ?)
      ORDER BY started_at ASC, id ASC
    `
  )

  const selectNeedsReview = database.prepare(
    `
      SELECT
        id,
        bucket_id,
        started_at,
        ended_at,
        confirmed_through,
        origin,
        note,
        created_at,
        updated_at
      FROM segments
      WHERE started_at < ?
        AND (ended_at IS NULL OR ended_at > ?)
        AND (
          confirmed_through IS NULL
          OR confirmed_through < CASE
            WHEN ended_at IS NULL THEN ?
            ELSE ended_at
          END
        )
      ORDER BY started_at ASC, id ASC
    `
  )

  const selectOpenSegment = database.prepare(
    `
      SELECT
        id,
        bucket_id,
        started_at,
        ended_at,
        confirmed_through,
        origin,
        note,
        created_at,
        updated_at
      FROM segments
      WHERE ended_at IS NULL
      LIMIT 1
    `
  )

  const insertSegment = database.prepare(
    `
      INSERT INTO segments (
        bucket_id,
        started_at,
        ended_at,
        confirmed_through,
        origin,
        note,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  )

  const updateSegment = database.prepare(
    `
      UPDATE segments
      SET bucket_id = ?,
          started_at = ?,
          ended_at = ?,
          confirmed_through = ?,
          origin = ?,
          note = ?,
          updated_at = ?
      WHERE id = ?
    `
  )

  const deleteSegment = database.prepare('DELETE FROM segments WHERE id = ?')

  const getSegmentOrThrow = (id: number): SegmentRow => {
    const row = selectById.get(id) as SegmentRow | undefined

    if (!row) {
      throw new Error(`Segment ${id} was not found.`)
    }

    return row
  }

  const assertTimelineInvariants = (now = Date.now()): void => {
    const rows = selectTimeline.all() as SegmentRow[]
    let previous: SegmentRow | null = null
    let openSegments = 0

    for (const row of rows) {
      if (row.ended_at !== null) {
        assertClosedRange(row.started_at, row.ended_at)
      }

      assertConfirmedThroughInRange(row.started_at, row.ended_at, row.confirmed_through, now)

      if (row.ended_at === null) {
        openSegments += 1
      }

      if (previous !== null) {
        const previousEnd = previous.ended_at ?? Number.POSITIVE_INFINITY

        if (previousEnd > row.started_at) {
          throw new Error(
            `Segments ${previous.id} and ${row.id} overlap; timeline segments must remain non-overlapping.`
          )
        }
      }

      previous = row
    }

    if (openSegments > 1) {
      throw new Error('idx_segments_single_open')
    }
  }

  const create = database.transaction((input: CreateSegmentInput): Segment => {
    const now = Date.now()
    const confirmedThrough = input.confirmedThrough ?? input.endedAt
    const origin = input.origin ?? 'manual'

    assertClosedRange(input.startedAt, input.endedAt)
    assertConfirmedThroughInRange(input.startedAt, input.endedAt, confirmedThrough, now)

    const result = insertSegment.run(
      input.bucketId,
      input.startedAt,
      input.endedAt,
      confirmedThrough,
      origin,
      input.note ?? null,
      now,
      now
    )

    assertTimelineInvariants(now)

    return mapSegment(getSegmentOrThrow(Number(result.lastInsertRowid)))
  })

  const open = database.transaction((input: OpenSegmentInput): Segment => {
    const now = Date.now()
    const confirmedThrough = input.confirmedThrough ?? input.startedAt
    const origin = input.origin ?? 'manual'

    assertConfirmedThroughInRange(input.startedAt, null, confirmedThrough, now)

    const result = insertSegment.run(
      input.bucketId,
      input.startedAt,
      null,
      confirmedThrough,
      origin,
      input.note ?? null,
      now,
      now
    )

    assertTimelineInvariants(now)

    return mapSegment(getSegmentOrThrow(Number(result.lastInsertRowid)))
  })

  const switchSegment = database.transaction((input: SwitchSegmentInput): [Segment, Segment] => {
    const now = Date.now()
    const incomingConfirmedThrough = input.confirmedThrough ?? input.atMs
    const incomingOrigin = input.origin ?? 'manual'
    const outgoing = selectOpenSegment.get() as SegmentRow | undefined

    if (!outgoing) {
      throw new Error('Cannot switch buckets without an open segment.')
    }

    assertClosedRange(outgoing.started_at, input.atMs)

    if (outgoing.confirmed_through !== null && input.atMs < outgoing.confirmed_through) {
      throw new Error("Cannot switch before the current segment's confirmed_through watermark.")
    }

    assertConfirmedThroughInRange(input.atMs, null, incomingConfirmedThrough, now)

    updateSegment.run(
      outgoing.bucket_id,
      outgoing.started_at,
      input.atMs,
      input.atMs,
      outgoing.origin,
      outgoing.note,
      now,
      outgoing.id
    )

    const inserted = insertSegment.run(
      input.bucketId,
      input.atMs,
      null,
      incomingConfirmedThrough,
      incomingOrigin,
      input.note ?? null,
      now,
      now
    )

    assertTimelineInvariants(now)

    return [
      mapSegment(getSegmentOrThrow(outgoing.id)),
      mapSegment(getSegmentOrThrow(Number(inserted.lastInsertRowid)))
    ]
  })

  const update = database.transaction((id: number, patch: SegmentPatch): Segment => {
    const existing = getSegmentOrThrow(id)

    const unsupportedKeys = Object.keys(patch).filter((key) => !SEGMENT_PATCH_KEYS.has(key))

    if (unsupportedKeys.length > 0) {
      throw new Error(`Unsupported segment update field(s): ${unsupportedKeys.join(', ')}.`)
    }

    if (Object.keys(patch).length === 0) {
      return mapSegment(existing)
    }

    const now = Date.now()
    const nextStartedAt = patch.startedAt ?? existing.started_at
    const nextEndedAt = patch.endedAt === undefined ? existing.ended_at : patch.endedAt
    const nextConfirmedThrough =
      patch.confirmedThrough === undefined ? existing.confirmed_through : patch.confirmedThrough
    const nextBucketId = patch.bucketId ?? existing.bucket_id
    const nextNote = patch.note === undefined ? existing.note : patch.note

    if (nextEndedAt !== null) {
      assertClosedRange(nextStartedAt, nextEndedAt)
    }

    assertConfirmedThroughInRange(nextStartedAt, nextEndedAt, nextConfirmedThrough, now)

    updateSegment.run(
      nextBucketId,
      nextStartedAt,
      nextEndedAt,
      nextConfirmedThrough,
      existing.origin,
      nextNote ?? null,
      now,
      id
    )

    assertTimelineInvariants(now)

    return mapSegment(getSegmentOrThrow(id))
  })

  const split = database.transaction((id: number, atMs: number): [Segment, Segment] => {
    const original = getSegmentOrThrow(id)

    if (original.ended_at === null) {
      throw new Error('Only closed segments can be split.')
    }

    if (atMs <= original.started_at || atMs >= original.ended_at) {
      throw new Error('Split points must fall strictly inside the segment.')
    }

    const now = Date.now()
    const firstConfirmedThrough =
      original.confirmed_through === null ? null : Math.min(original.confirmed_through, atMs)
    const secondConfirmedThrough =
      original.confirmed_through !== null && original.confirmed_through > atMs
        ? original.confirmed_through
        : null

    updateSegment.run(
      original.bucket_id,
      original.started_at,
      atMs,
      firstConfirmedThrough,
      'split',
      original.note,
      now,
      original.id
    )

    const inserted = insertSegment.run(
      original.bucket_id,
      atMs,
      original.ended_at,
      secondConfirmedThrough,
      'split',
      original.note,
      now,
      now
    )

    assertTimelineInvariants(now)

    return [
      mapSegment(getSegmentOrThrow(original.id)),
      mapSegment(getSegmentOrThrow(Number(inserted.lastInsertRowid)))
    ]
  })

  const merge = database.transaction((idA: number, idB: number): Segment => {
    if (idA === idB) {
      throw new Error('Merge requires two distinct segments.')
    }

    const first = getSegmentOrThrow(idA)
    const second = getSegmentOrThrow(idB)
    const [left, right] = first.started_at <= second.started_at ? [first, second] : [second, first]

    if (left.ended_at === null || right.ended_at === null) {
      throw new Error('Only closed segments can be merged.')
    }

    if (left.bucket_id !== right.bucket_id) {
      throw new Error('Only adjacent segments with the same bucket can be merged.')
    }

    if (left.ended_at !== right.started_at) {
      throw new Error('Only adjacent segments can be merged.')
    }

    const now = Date.now()
    const mergedConfirmedThrough = getLaterConfirmation(
      left.confirmed_through,
      right.confirmed_through
    )
    // TODO(spec): Define whether conflicting notes should be combined once the review modal lands.
    const mergedNote = getMergedNote(left.note, right.note)

    updateSegment.run(
      left.bucket_id,
      left.started_at,
      right.ended_at,
      mergedConfirmedThrough,
      // BUILD_PLAN §10.1 makes merge provenance explicit: the merged row is an edit.
      'edit',
      mergedNote,
      now,
      left.id
    )
    deleteSegment.run(right.id)

    assertTimelineInvariants(now)

    return mapSegment(getSegmentOrThrow(left.id))
  })

  const remove = database.transaction((id: number): void => {
    const result = deleteSegment.run(id)

    if (result.changes === 0) {
      throw new Error(`Segment ${id} was not found.`)
    }

    assertTimelineInvariants()
  })

  return {
    range(fromMs, toMs) {
      if (toMs <= fromMs) {
        return []
      }

      return (selectRange.all(toMs, fromMs) as SegmentRow[]).map(mapSegment)
    },
    create,
    open,
    switch: switchSegment,
    update,
    split,
    merge,
    delete: remove,
    needsReview(fromMs, toMs) {
      if (toMs <= fromMs) {
        return []
      }

      const now = Date.now()

      return (selectNeedsReview.all(toMs, fromMs, now) as SegmentRow[]).map(mapSegment)
    }
  }
}

export default createSegmentsRepository
