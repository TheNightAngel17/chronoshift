import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../connection'
import { runMigrations } from '../migrations'
import type { SegmentPatch } from '../../../shared/ipc-contract'
import { createSegmentsRepository } from './segments'

function withTempDatabase(run: (database: Database.Database) => void): void {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'chronoshift-segments-'))
  const databasePath = join(tempDirectory, 'test.db')
  const database = openDatabase(databasePath)

  try {
    runMigrations(database)
    run(database)
  } finally {
    database.close()
    rmSync(tempDirectory, { recursive: true, force: true })
  }
}

function insertBucket(database: Database.Database, name: string): number {
  const now = Date.now()
  const result = database
    .prepare(
      `
        INSERT INTO buckets (name, depth, kind, is_system, is_archived, source, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(name, 0, 'work', 0, 0, 'local', now, now)

  return Number(result.lastInsertRowid)
}

function insertSegment(
  database: Database.Database,
  values: {
    bucketId: number
    startedAt: number
    endedAt: number | null
    confirmedThrough: number | null
    origin?: 'manual' | 'checkin' | 'idle_resolution' | 'recovery' | 'edit' | 'split'
    note?: string | null
  }
): number {
  const now = Date.now()
  const result = database
    .prepare(
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
    .run(
      values.bucketId,
      values.startedAt,
      values.endedAt,
      values.confirmedThrough,
      values.origin ?? 'manual',
      values.note ?? null,
      now,
      now
    )

  return Number(result.lastInsertRowid)
}

describe('segments repository', () => {
  it('returns the segments that overlap a requested range', () => {
    withTempDatabase((database) => {
      const bucketId = insertBucket(database, 'Week Grid')
      const repository = createSegmentsRepository(database)

      repository.create({ bucketId, startedAt: 0, endedAt: 10_000 })
      repository.create({ bucketId, startedAt: 10_000, endedAt: 20_000 })
      repository.create({ bucketId, startedAt: 30_000, endedAt: 40_000 })

      expect(repository.range(5_000, 15_000).map((segment) => segment.startedAt)).toEqual([
        0, 10_000
      ])
      expect(repository.range(15_000, 15_000).map((segment) => segment.startedAt)).toEqual([10_000])
    })
  })

  it('rejects zero-length and overlapping closed segments', () => {
    withTempDatabase((database) => {
      const bucketId = insertBucket(database, 'Overlap Guard')
      const repository = createSegmentsRepository(database)

      expect(() => repository.create({ bucketId, startedAt: 1_000, endedAt: 1_000 })).toThrow(
        /started_at < ended_at/
      )

      repository.create({ bucketId, startedAt: 1_000, endedAt: 2_000 })

      expect(() => repository.create({ bucketId, startedAt: 1_500, endedAt: 2_500 })).toThrow(
        /overlap/i
      )
    })
  })

  it('surfaces idx_segments_single_open and switches by closing before opening', () => {
    withTempDatabase((database) => {
      const firstBucketId = insertBucket(database, 'Alpha')
      const secondBucketId = insertBucket(database, 'Beta')
      const repository = createSegmentsRepository(database)

      repository.open({ bucketId: firstBucketId, startedAt: 1_000, confirmedThrough: 1_000 })

      expect(() =>
        repository.open({ bucketId: secondBucketId, startedAt: 2_000, confirmedThrough: 2_000 })
      ).toThrow(/idx_segments_single_open/)

      const [closed, opened] = repository.switch({
        bucketId: secondBucketId,
        atMs: 3_000,
        confirmedThrough: 3_500,
        origin: 'checkin'
      })

      expect(closed.endedAt).toBe(3_000)
      expect(closed.confirmedThrough).toBe(3_000)
      expect(opened.startedAt).toBe(3_000)
      expect(opened.endedAt).toBeNull()
      expect(opened.confirmedThrough).toBe(3_500)
      expect(opened.origin).toBe('checkin')
    })
  })

  it('rejects switching before the current confirmation watermark', () => {
    withTempDatabase((database) => {
      const firstBucketId = insertBucket(database, 'Gamma')
      const secondBucketId = insertBucket(database, 'Delta')
      const repository = createSegmentsRepository(database)

      repository.open({ bucketId: firstBucketId, startedAt: 1_000, confirmedThrough: 2_500 })

      expect(() =>
        repository.switch({ bucketId: secondBucketId, atMs: 2_000, confirmedThrough: 2_000 })
      ).toThrow(/confirmed_through watermark/)
    })
  })

  it('updates a segment and rejects invalid update invariants', () => {
    withTempDatabase((database) => {
      const bucketId = insertBucket(database, 'Editable')
      const repository = createSegmentsRepository(database)

      const first = repository.create({ bucketId, startedAt: 1_000, endedAt: 2_000 })
      const second = repository.create({ bucketId, startedAt: 3_000, endedAt: 4_000 })

      const updated = repository.update(second.id, {
        startedAt: 4_000,
        endedAt: 5_000,
        confirmedThrough: 4_500,
        note: 'moved'
      })

      expect(updated).toMatchObject({
        startedAt: 4_000,
        endedAt: 5_000,
        confirmedThrough: 4_500,
        note: 'moved'
      })

      expect(() =>
        repository.update(updated.id, {
          startedAt: 1_500,
          endedAt: 2_500,
          confirmedThrough: 2_000
        })
      ).toThrow(/overlap/i)

      expect(() =>
        repository.update(first.id, {
          confirmedThrough: 2_500
        })
      ).toThrow(/inside the segment range/)
    })
  })

  it('rejects unsupported update fields at the repository boundary', () => {
    withTempDatabase((database) => {
      const bucketId = insertBucket(database, 'Patch Boundary')
      const repository = createSegmentsRepository(database)
      const segment = repository.create({ bucketId, startedAt: 1_000, endedAt: 2_000 })

      expect(() =>
        repository.update(segment.id, { origin: 'split' } as unknown as SegmentPatch)
      ).toThrow(/Unsupported segment update field/)
    })
  })

  it('splits with the §10.1 formula branch where the watermark crosses the split, then merges back', () => {
    withTempDatabase((database) => {
      const bucketId = insertBucket(database, 'Worked Example')
      const repository = createSegmentsRepository(database)
      const originalId = insertSegment(database, {
        bucketId,
        startedAt: 100,
        endedAt: 200,
        confirmedThrough: 180,
        note: 'kept'
      })

      const [first, second] = repository.split(originalId, 150)

      expect(first).toMatchObject({
        startedAt: 100,
        endedAt: 150,
        confirmedThrough: 150,
        origin: 'split'
      })
      expect(second).toMatchObject({
        startedAt: 150,
        endedAt: 200,
        confirmedThrough: 180,
        origin: 'split'
      })

      const merged = repository.merge(second.id, first.id)

      expect(merged).toMatchObject({
        startedAt: 100,
        endedAt: 200,
        confirmedThrough: 180,
        origin: 'edit',
        note: 'kept'
      })
    })
  })

  it('splits with a null second watermark when the original confirmation does not cross the split', () => {
    withTempDatabase((database) => {
      const bucketId = insertBucket(database, 'Watermark Clamp')
      const repository = createSegmentsRepository(database)
      const originalId = insertSegment(database, {
        bucketId,
        startedAt: 100,
        endedAt: 200,
        confirmedThrough: 120
      })

      const [first, second] = repository.split(originalId, 150)

      expect(first.confirmedThrough).toBe(120)
      expect(second.confirmedThrough).toBeNull()
    })
  })

  it('rewrites mixed origins to edit when adjacent segments merge', () => {
    withTempDatabase((database) => {
      const bucketId = insertBucket(database, 'Merge Origins')
      const repository = createSegmentsRepository(database)
      const leftId = insertSegment(database, {
        bucketId,
        startedAt: 100,
        endedAt: 150,
        confirmedThrough: 150,
        origin: 'manual'
      })
      const rightId = insertSegment(database, {
        bucketId,
        startedAt: 150,
        endedAt: 200,
        confirmedThrough: 200,
        origin: 'checkin'
      })

      expect(repository.merge(leftId, rightId).origin).toBe('edit')
    })
  })

  it('rejects merging conflicting notes until the spec defines the behavior', () => {
    withTempDatabase((database) => {
      const bucketId = insertBucket(database, 'Conflicting Notes')
      const repository = createSegmentsRepository(database)
      const leftId = insertSegment(database, {
        bucketId,
        startedAt: 100,
        endedAt: 150,
        confirmedThrough: 150,
        note: 'left'
      })
      const rightId = insertSegment(database, {
        bucketId,
        startedAt: 150,
        endedAt: 200,
        confirmedThrough: 200,
        note: 'right'
      })

      expect(() => repository.merge(leftId, rightId)).toThrow(/conflicting notes/)
    })
  })

  it('finds segments needing review inside a range', () => {
    withTempDatabase((database) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'))

      try {
        const bucketId = insertBucket(database, 'Needs Review')
        const repository = createSegmentsRepository(database)

        repository.create({
          bucketId,
          startedAt: 1_000,
          endedAt: 2_000,
          confirmedThrough: 1_500
        })
        repository.create({
          bucketId,
          startedAt: 2_000,
          endedAt: 3_000,
          confirmedThrough: 3_000
        })

        expect(repository.needsReview(0, 4_000)).toHaveLength(1)
        expect(repository.needsReview(1_750, 1_750)).toHaveLength(1)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('does not flag a segment whose watermark already covers the queried window', () => {
    withTempDatabase((database) => {
      const bucketId = insertBucket(database, 'Covered')
      const repository = createSegmentsRepository(database)

      repository.create({
        bucketId,
        startedAt: 1_000,
        endedAt: 2_000,
        confirmedThrough: 1_500
      })

      expect(repository.needsReview(1_000, 1_500)).toHaveLength(0)
      expect(repository.needsReview(1_250, 1_250)).toHaveLength(0)
      expect(repository.needsReview(1_600, 1_800)).toHaveLength(1)
      expect(repository.needsReview(1_600, 1_600)).toHaveLength(1)
    })
  })

  it('preserves an explicit null confirmedThrough instead of defaulting it', () => {
    withTempDatabase((database) => {
      const bucketId = insertBucket(database, 'Presumed')
      const repository = createSegmentsRepository(database)

      const created = repository.create({
        bucketId,
        startedAt: 1_000,
        endedAt: 2_000,
        confirmedThrough: null
      })
      expect(created.confirmedThrough).toBeNull()

      const opened = repository.open({
        bucketId,
        startedAt: 2_000,
        confirmedThrough: null
      })
      expect(opened.confirmedThrough).toBeNull()

      const [, incoming] = repository.switch({
        bucketId,
        atMs: 3_000,
        confirmedThrough: null
      })
      expect(incoming.confirmedThrough).toBeNull()
    })
  })
})
