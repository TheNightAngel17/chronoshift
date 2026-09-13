import type Database from 'better-sqlite3'
import { openDatabase } from '../../../src/main/db/connection'
import { runMigrations } from '../../../src/main/db/migrations'
import { BucketsRepository } from '../../../src/main/db/repositories/buckets'

/**
 * Repositories/handles exposed to a seed or assertion callback. Only buckets
 * has a convenience wrapper so far — other repositories are free functions
 * that take an explicit `Database.Database` (see e.g. `settings.ts`,
 * `idleEvents.ts`), so a test can just import them and pass `database`
 * through directly as more e2e coverage is added.
 */
export interface TestDatabaseHandles {
  database: Database.Database
  buckets: BucketsRepository
}

/**
 * Opens the sqlite file at `databasePath`, running migrations if it's new,
 * and hands it to `run` for either seeding (before the app launches) or
 * assertions (after the app closes) — never both in the same connection as
 * the running app, which would violate the single-writer assumption
 * `busy_timeout` is there to paper over, not eliminate.
 */
export function withTestDatabase<T>(
  databasePath: string,
  run: (handles: TestDatabaseHandles) => T
): T {
  const database = openDatabase(databasePath)

  try {
    runMigrations(database)
    return run({ database, buckets: new BucketsRepository(database) })
  } finally {
    database.close()
  }
}
