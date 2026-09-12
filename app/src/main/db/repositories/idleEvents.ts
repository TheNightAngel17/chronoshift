import type Database from 'better-sqlite3'
import type { IdleCause, IdleEvent, IdleResolution } from '../../../shared/types'
import { getDatabase } from '../connection'

type IdleEventRow = {
  id: number
  started_at: number
  ended_at: number
  cause: IdleCause
  resolution: IdleResolution | null
  resolved_at: number | null
  created_at: number
}

function mapIdleEventRow(row: IdleEventRow): IdleEvent {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    cause: row.cause,
    resolution: row.resolution,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at
  }
}

function getById(id: number, database: Database.Database): IdleEvent {
  const row = database
    .prepare<[number], IdleEventRow>(
      `
        SELECT id, started_at, ended_at, cause, resolution, resolved_at, created_at
        FROM idle_events
        WHERE id = ?
      `
    )
    .get(id)

  if (!row) {
    throw new Error(`Unknown idle event id "${id}"`)
  }

  return mapIdleEventRow(row)
}

export function create(
  startedAt: number,
  endedAt: number,
  cause: IdleCause,
  database: Database.Database = getDatabase()
): IdleEvent {
  if (!Number.isInteger(startedAt) || !Number.isInteger(endedAt) || endedAt <= startedAt) {
    throw new Error('idle event endedAt must be greater than startedAt')
  }

  const createdAt = Date.now()
  const result = database
    .prepare(
      `
        INSERT INTO idle_events (started_at, ended_at, cause, created_at)
        VALUES (?, ?, ?, ?)
      `
    )
    .run(startedAt, endedAt, cause, createdAt)

  return getById(Number(result.lastInsertRowid), database)
}

export function resolve(
  id: number,
  resolution: IdleResolution,
  resolvedAt: number,
  database: Database.Database = getDatabase()
): IdleEvent {
  const result = database
    .prepare(
      `
        UPDATE idle_events
        SET resolution = ?, resolved_at = ?
        WHERE id = ?
      `
    )
    .run(resolution, resolvedAt, id)

  if (result.changes === 0) {
    throw new Error(`Unknown idle event id "${id}"`)
  }

  return getById(id, database)
}

export function getUnresolved(database: Database.Database = getDatabase()): IdleEvent | null {
  const row = database
    .prepare<[], IdleEventRow>(
      `
        SELECT id, started_at, ended_at, cause, resolution, resolved_at, created_at
        FROM idle_events
        WHERE resolved_at IS NULL
        ORDER BY started_at DESC, id DESC
        LIMIT 1
      `
    )
    .get()

  return row ? mapIdleEventRow(row) : null
}
