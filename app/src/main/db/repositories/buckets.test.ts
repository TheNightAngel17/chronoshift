import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../connection'
import { runMigrations } from '../migrations'
import { BucketsRepository, deriveDeterministicBucketColor } from './buckets'

function withRepository(
  run: (repository: BucketsRepository, database: Database.Database) => void
): void {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'chronoshift-buckets-'))
  const databasePath = join(tempDirectory, 'test.db')
  const database = openDatabase(databasePath)

  try {
    runMigrations(database)
    run(new BucketsRepository(database), database)
  } finally {
    database.close()
    rmSync(tempDirectory, { recursive: true, force: true })
  }
}

describe('BucketsRepository', () => {
  it('creates work buckets with local provenance', () => {
    withRepository((repository) => {
      const bucket = repository.create(null, 'Client Work', '#112233')

      expect(bucket.parentId).toBeNull()
      expect(bucket.depth).toBe(0)
      expect(bucket.color).toBe('#112233')
      expect(bucket.source).toBe('local')
      expect(bucket.externalId).toBeNull()
      expect(bucket.externalType).toBeNull()
    })
  })

  it('rejects creating a depth-4 child bucket', () => {
    withRepository((repository) => {
      const depth0 = repository.create(null, 'Depth 0')
      const depth1 = repository.create(depth0.id, 'Depth 1')
      const depth2 = repository.create(depth1.id, 'Depth 2')
      const depth3 = repository.create(depth2.id, 'Depth 3')

      expect(() => repository.create(depth3.id, 'Too Deep')).toThrowError(
        'Buckets may be at most 4 levels deep.'
      )
    })
  })

  it('rejects moving a bucket into its own subtree', () => {
    withRepository((repository) => {
      const root = repository.create(null, 'Root')
      const child = repository.create(root.id, 'Child')
      const grandchild = repository.create(child.id, 'Grandchild')

      expect(() => repository.move(root.id, grandchild.id, 0)).toThrowError(
        'A bucket cannot be moved into its own subtree.'
      )
    })
  })

  it('rejects moving a subtree deeper than depth 3', () => {
    withRepository((repository) => {
      const root = repository.create(null, 'Root')
      const branch = repository.create(root.id, 'Branch')
      const leaf = repository.create(branch.id, 'Leaf')
      const depth0Target = repository.create(null, 'Target Root')
      const depth1Target = repository.create(depth0Target.id, 'Target 1')
      const depth2Target = repository.create(depth1Target.id, 'Target 2')

      expect(() => repository.move(branch.id, depth2Target.id, 0)).toThrowError(
        'Buckets may be at most 4 levels deep.'
      )

      expect(repository.getById(leaf.id)?.depth).toBe(2)
    })
  })

  it('moves a bucket subtree and updates depth and sort order', () => {
    withRepository((repository) => {
      const root = repository.create(null, 'Root')
      const branch = repository.create(root.id, 'Branch')
      const leaf = repository.create(branch.id, 'Leaf')
      const targetRoot = repository.create(null, 'Target Root')

      repository.move(branch.id, targetRoot.id, 7)

      expect(repository.getById(branch.id)).toMatchObject({
        parentId: targetRoot.id,
        depth: 1,
        sortOrder: 7
      })
      expect(repository.getById(leaf.id)?.depth).toBe(2)
    })
  })

  it('throws a clear delete error that names the referenced bucket', () => {
    withRepository((repository, database) => {
      const bucket = repository.create(null, 'Referenced Bucket')
      const now = Date.now()

      database
        .prepare(
          `
            INSERT INTO segments (bucket_id, started_at, ended_at, origin, created_at, updated_at)
            VALUES (?, ?, ?, 'manual', ?, ?)
          `
        )
        .run(bucket.id, now, now + 60_000, now, now)

      expect(() => repository.delete(bucket.id)).toThrowError(
        'Cannot delete bucket "Referenced Bucket" because 1 segment(s) still reference it.'
      )
    })
  })

  it('deletes an unused bucket', () => {
    withRepository((repository) => {
      const bucket = repository.create(null, 'Disposable')

      repository.delete(bucket.id)

      expect(repository.getById(bucket.id)).toBeNull()
    })
  })

  it('swaps sibling names inside an update', () => {
    withRepository((repository) => {
      const alpha = repository.create(null, 'Alpha')
      const beta = repository.create(null, 'Beta')

      const updatedAlpha = repository.update(alpha.id, { name: 'Beta' })

      expect(updatedAlpha.name).toBe('Beta')
      expect(repository.getById(beta.id)?.name).toBe('Alpha')
    })
  })

  it('archives and unarchives a bucket', () => {
    withRepository((repository) => {
      const bucket = repository.create(null, 'Archive Me')

      repository.archive(bucket.id, true)
      expect(repository.getById(bucket.id)?.isArchived).toBe(true)

      repository.archive(bucket.id, false)
      expect(repository.getById(bucket.id)?.isArchived).toBe(false)
    })
  })

  it('resolves color from the nearest colored ancestor or falls back deterministically', () => {
    withRepository((repository) => {
      const root = repository.create(null, 'Root')
      const coloredParent = repository.create(root.id, 'Colored Parent', '#abcdef')
      const child = repository.create(coloredParent.id, 'Child')

      expect(repository.resolveColor(child.id)).toBe('#abcdef')
      expect(repository.resolveColor(root.id)).toBe(deriveDeterministicBucketColor(root.id))
    })
  })

  it('returns distinct recents ordered by most recent segment first', () => {
    withRepository((repository, database) => {
      const first = repository.create(null, 'First')
      const second = repository.create(null, 'Second')
      const third = repository.create(null, 'Third')
      const now = Date.now()

      const insertSegment = database.prepare(
        `
          INSERT INTO segments (bucket_id, started_at, ended_at, origin, created_at, updated_at)
          VALUES (?, ?, ?, 'manual', ?, ?)
        `
      )

      insertSegment.run(first.id, now - 30_000, now - 20_000, now, now)
      insertSegment.run(second.id, now - 20_000, now - 10_000, now, now)
      insertSegment.run(first.id, now - 10_000, now - 5_000, now, now)
      insertSegment.run(third.id, now - 5_000, now - 1_000, now, now)

      expect(repository.recents(3).map((bucket) => bucket.id)).toEqual([
        third.id,
        first.id,
        second.id
      ])
    })
  })

  it('backfills recents past an archived bucket instead of returning fewer than the limit', () => {
    withRepository((repository, database) => {
      const archived = repository.create(null, 'Archived')
      const active = repository.create(null, 'Active')
      const now = Date.now()

      const insertSegment = database.prepare(
        `
          INSERT INTO segments (bucket_id, started_at, ended_at, origin, created_at, updated_at)
          VALUES (?, ?, ?, 'manual', ?, ?)
        `
      )

      insertSegment.run(active.id, now - 20_000, now - 10_000, now, now)
      insertSegment.run(archived.id, now - 10_000, now - 5_000, now, now)
      repository.archive(archived.id, true)

      expect(repository.recents(1).map((bucket) => bucket.id)).toEqual([active.id])
    })
  })
})
