import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openDatabase } from '../connection'
import { runMigrations } from './index'

function withTempDatabase(run: (databasePath: string) => void): void {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'chronoshift-migrations-'))
  const databasePath = join(tempDirectory, 'test.db')

  try {
    run(databasePath)
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true })
  }
}

describe('runMigrations', () => {
  it('is idempotent across restarts and keeps one schema_meta row', () => {
    withTempDatabase((databasePath) => {
      const firstConnection = openDatabase(databasePath)
      runMigrations(firstConnection)
      firstConnection.close()

      const secondConnection = openDatabase(databasePath)
      runMigrations(secondConnection)

      const schemaMetaCount = secondConnection
        .prepare('SELECT COUNT(*) AS count FROM schema_meta')
        .get() as { count: number } | undefined

      expect(schemaMetaCount?.count).toBe(1)

      const tables = secondConnection
        .prepare(
          `
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
          `
        )
        .all() as Array<{ name: string }>

      expect(tables.map((table) => table.name)).toEqual(
        expect.arrayContaining([
          'schema_meta',
          'buckets',
          'segments',
          'checkins',
          'idle_events',
          'settings',
          'app_state'
        ])
      )

      const breakBucketCount = secondConnection
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM buckets
            WHERE kind = 'break'
              AND is_system = 1
              AND depth = 0
              AND name = 'Break / Away'
          `
        )
        .get() as { count: number } | undefined
      expect(breakBucketCount?.count).toBe(1)

      const seededSettings = secondConnection
        .prepare(
          `
            SELECT key
            FROM settings
            ORDER BY key
          `
        )
        .all() as Array<{ key: string }>
      expect(seededSettings.map((setting) => setting.key)).toEqual([
        'auto_stop_after_hours',
        'autostart_begin_tracking',
        'autostart_enabled',
        'checkin_interval_minutes',
        'grid_end_hour',
        'grid_snap_minutes',
        'grid_start_hour',
        'idle_threshold_minutes',
        'prompt_sound',
        'prompt_steal_focus',
        'snooze_minutes',
        'theme',
        'week_start_day'
      ])

      const singleOpenIndexSql = secondConnection
        .prepare(
          `
            SELECT sql
            FROM sqlite_master
            WHERE type = 'index' AND name = 'idx_segments_single_open'
          `
        )
        .get() as { sql: string } | undefined
      expect(singleOpenIndexSql?.sql).toContain('CASE WHEN ended_at IS NULL THEN 1 END')

      const siblingNameIndexSql = secondConnection
        .prepare(
          `
            SELECT sql
            FROM sqlite_master
            WHERE type = 'index' AND name = 'idx_buckets_sibling_name'
          `
        )
        .get() as { sql: string } | undefined
      expect(siblingNameIndexSql?.sql).toContain('COALESCE(parent_id, -1)')

      secondConnection.close()
    })
  })

  it('surfaces each named CHECK constraint in the SQLite error message', () => {
    withTempDatabase((databasePath) => {
      const database = openDatabase(databasePath)
      runMigrations(database)

      const breakBucket = database
        .prepare(
          `
            SELECT id
            FROM buckets
            WHERE kind = 'break' AND is_system = 1 AND depth = 0 AND name = 'Break / Away'
            LIMIT 1
          `
        )
        .get() as { id: number } | undefined

      expect(breakBucket?.id).toBeTypeOf('number')
      const bucketId = breakBucket?.id

      expect(bucketId).toBeDefined()
      if (!bucketId) {
        database.close()
        return
      }

      const assertConstraintName = (
        statement: string,
        parameters: readonly unknown[],
        constraintName: string
      ): void => {
        expect(() => {
          database.prepare(statement).run(...parameters)
        }).toThrowError(new RegExp(constraintName))
      }

      const now = Date.now()

      assertConstraintName(
        'INSERT INTO buckets (name, depth, kind, is_system, is_archived, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['Too Deep', 4, 'work', 0, 0, 'local', now, now],
        'bucket_depth_in_range'
      )
      assertConstraintName(
        'INSERT INTO buckets (name, depth, kind, is_system, is_archived, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['Bad Kind', 0, 'focus', 0, 0, 'local', now, now],
        'bucket_kind_valid'
      )
      assertConstraintName(
        'INSERT INTO buckets (name, depth, kind, is_system, is_archived, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['Bad System Flag', 0, 'work', 2, 0, 'local', now, now],
        'bucket_is_system_boolean'
      )
      assertConstraintName(
        'INSERT INTO buckets (name, depth, kind, is_system, is_archived, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['Bad Archive Flag', 0, 'work', 0, 2, 'local', now, now],
        'bucket_is_archived_boolean'
      )
      assertConstraintName(
        'INSERT INTO buckets (name, depth, kind, is_system, is_archived, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['Bad Source', 0, 'work', 0, 0, 'remote', now, now],
        'bucket_source_valid'
      )

      assertConstraintName(
        'INSERT INTO segments (bucket_id, started_at, ended_at, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [bucketId, now, null, 'unknown', now, now],
        'segment_origin_valid'
      )
      assertConstraintName(
        'INSERT INTO segments (bucket_id, started_at, ended_at, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [bucketId, now, now, 'manual', now, now],
        'segment_ends_after_start'
      )

      assertConstraintName(
        'INSERT INTO checkins (segment_id, prompted_at, response, created_at) VALUES (?, ?, ?, ?)',
        [null, now, 'ignored', now],
        'checkin_response_valid'
      )

      assertConstraintName(
        'INSERT INTO idle_events (started_at, ended_at, cause, resolution, created_at) VALUES (?, ?, ?, ?, ?)',
        [now, now + 1, 'sleep', null, now],
        'idle_event_cause_valid'
      )
      assertConstraintName(
        'INSERT INTO idle_events (started_at, ended_at, cause, resolution, created_at) VALUES (?, ?, ?, ?, ?)',
        [now, now + 1, 'inactivity', 'deferred', now],
        'idle_event_resolution_valid'
      )

      database.close()
    })
  })
})
