import type Database from 'better-sqlite3'
import { getDatabase } from '../connection'

export type AppStateValueMap = {
  lastSeenAt: number
  lastBucketId: number | null
  cleanShutdown: boolean
}

type AppStateKey = keyof AppStateValueMap

type AppStateRow = {
  value: string
}

const APP_STATE_KEYS = {
  lastSeenAt: 'last_seen_at',
  lastBucketId: 'last_bucket_id',
  cleanShutdown: 'clean_shutdown'
} as const satisfies Record<AppStateKey, string>

function parseStoredValue(key: AppStateKey, value: string): AppStateValueMap[AppStateKey] | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new Error(`Invalid stored JSON for app state "${APP_STATE_KEYS[key]}"`, { cause: error })
  }

  switch (key) {
    case 'lastSeenAt':
      if (typeof parsed !== 'number' || !Number.isInteger(parsed)) {
        throw new Error('lastSeenAt must be stored as an integer epoch millisecond value')
      }
      return parsed
    case 'lastBucketId':
      if (parsed !== null && (typeof parsed !== 'number' || !Number.isInteger(parsed))) {
        throw new Error('lastBucketId must be stored as an integer bucket id or null')
      }
      return parsed
    case 'cleanShutdown':
      if (typeof parsed !== 'boolean') {
        throw new Error('cleanShutdown must be stored as a boolean')
      }
      return parsed
  }

  throw new Error(`Unknown app state key "${key}"`)
}

function getValue<K extends AppStateKey>(
  key: K,
  database: Database.Database
): AppStateValueMap[K] | null {
  const row = database
    .prepare<[string], AppStateRow>(
      `
        SELECT value
        FROM app_state
        WHERE key = ?
      `
    )
    .get(APP_STATE_KEYS[key])

  if (!row) {
    return null
  }

  return parseStoredValue(key, row.value) as AppStateValueMap[K] | null
}

function setValue<K extends AppStateKey>(
  key: K,
  value: AppStateValueMap[K],
  database: Database.Database
): AppStateValueMap[K] {
  database
    .prepare(
      `
        INSERT INTO app_state (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `
    )
    .run(APP_STATE_KEYS[key], JSON.stringify(value), Date.now())

  return value
}

export function getLastSeenAt(database: Database.Database = getDatabase()): number | null {
  return getValue('lastSeenAt', database)
}

export function setLastSeenAt(
  value: AppStateValueMap['lastSeenAt'],
  database: Database.Database = getDatabase()
): number {
  if (!Number.isInteger(value)) {
    throw new Error('lastSeenAt must be an integer epoch millisecond value')
  }

  return setValue('lastSeenAt', value, database)
}

export function getLastBucketId(database: Database.Database = getDatabase()): number | null {
  return getValue('lastBucketId', database)
}

export function setLastBucketId(
  value: AppStateValueMap['lastBucketId'],
  database: Database.Database = getDatabase()
): number | null {
  if (value !== null && !Number.isInteger(value)) {
    throw new Error('lastBucketId must be an integer bucket id or null')
  }

  return setValue('lastBucketId', value, database)
}

export function getCleanShutdown(database: Database.Database = getDatabase()): boolean | null {
  return getValue('cleanShutdown', database)
}

export function setCleanShutdown(
  value: AppStateValueMap['cleanShutdown'],
  database: Database.Database = getDatabase()
): boolean {
  if (typeof value !== 'boolean') {
    throw new Error('cleanShutdown must be a boolean')
  }

  return setValue('cleanShutdown', value, database)
}
