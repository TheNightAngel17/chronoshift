import type Database from 'better-sqlite3'
import type { CheckinRecord, CheckinResponse } from '../../../shared/types'
import { getDatabase } from '../connection'

type CheckinRow = {
  id: number
  segment_id: number | null
  prompted_at: number
  responded_at: number | null
  response: CheckinResponse | null
  created_at: number
}

function mapCheckinRow(row: CheckinRow): CheckinRecord {
  return {
    id: row.id,
    segmentId: row.segment_id,
    promptedAt: row.prompted_at,
    respondedAt: row.responded_at,
    response: row.response,
    createdAt: row.created_at
  }
}

function assertInteger(value: unknown, name: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`${name} must be an integer`)
  }
}

function getById(id: number, database: Database.Database): CheckinRecord {
  const row = database
    .prepare<[number], CheckinRow>(
      `
        SELECT id, segment_id, prompted_at, responded_at, response, created_at
        FROM checkins
        WHERE id = ?
      `
    )
    .get(id)

  if (!row) {
    throw new Error(`Unknown checkin id "${id}"`)
  }

  return mapCheckinRow(row)
}

export function create(
  segmentId: number | null,
  promptedAt: number,
  database: Database.Database = getDatabase()
): CheckinRecord {
  if (segmentId !== null) {
    assertInteger(segmentId, 'segmentId')
  }
  assertInteger(promptedAt, 'promptedAt')

  const createdAt = Date.now()
  const result = database
    .prepare(
      `
        INSERT INTO checkins (segment_id, prompted_at, created_at)
        VALUES (?, ?, ?)
      `
    )
    .run(segmentId, promptedAt, createdAt)

  return getById(Number(result.lastInsertRowid), database)
}

export function respond(
  id: number,
  respondedAt: number,
  response: CheckinResponse,
  database: Database.Database = getDatabase()
): CheckinRecord {
  assertInteger(id, 'id')
  assertInteger(respondedAt, 'respondedAt')

  const existing = getById(id, database)
  if (respondedAt < existing.promptedAt) {
    throw new Error('respondedAt must be greater than or equal to promptedAt')
  }

  const result = database
    .prepare(
      `
        UPDATE checkins
        SET responded_at = ?, response = ?
        WHERE id = ?
          AND responded_at IS NULL
      `
    )
    .run(respondedAt, response, id)

  if (result.changes === 0) {
    const existingRow = database
      .prepare<[number], { responded_at: number | null }>(
        `
          SELECT responded_at
          FROM checkins
          WHERE id = ?
        `
      )
      .get(id)

    if (!existingRow) {
      throw new Error(`Unknown checkin id "${id}"`)
    }

    throw new Error(`Checkin "${id}" already has a recorded response`)
  }

  return getById(id, database)
}

export function getRecent(
  limit: number,
  database: Database.Database = getDatabase()
): CheckinRecord[] {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('limit must be an integer >= 1')
  }

  return database
    .prepare<[number], CheckinRow>(
      `
        SELECT id, segment_id, prompted_at, responded_at, response, created_at
        FROM checkins
        ORDER BY prompted_at DESC, id DESC
        LIMIT ?
      `
    )
    .all(limit)
    .map(mapCheckinRow)
}
