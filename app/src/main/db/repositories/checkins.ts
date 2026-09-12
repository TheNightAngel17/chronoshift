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
    const existing = database
      .prepare<[number], { responded_at: number | null }>(
        `
          SELECT responded_at
          FROM checkins
          WHERE id = ?
        `
      )
      .get(id)

    if (!existing) {
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
