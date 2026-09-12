import type Database from 'better-sqlite3'
import { applyInitialMigration } from './001_initial'

type Migration = {
  readonly version: number
  readonly apply: (database: Database.Database) => void
}

const MIGRATIONS: ReadonlyArray<Migration> = [
  {
    version: 1,
    apply: applyInitialMigration
  }
]

function getCurrentVersion(database: Database.Database): number {
  const schemaMetaTableExists = database
    .prepare(
      `
        SELECT 1
        FROM sqlite_master
        WHERE type = 'table' AND name = 'schema_meta'
      `
    )
    .get()

  if (!schemaMetaTableExists) {
    return 0
  }

  const latestVersion = database
    .prepare(
      `
        SELECT version
        FROM schema_meta
        ORDER BY version DESC
        LIMIT 1
      `
    )
    .get() as { version: number } | undefined

  return latestVersion?.version ?? 0
}

export function runMigrations(database: Database.Database): void {
  let currentVersion = getCurrentVersion(database)

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) {
      continue
    }

    const applyMigration = database.transaction(() => {
      migration.apply(database)
      database.prepare('DELETE FROM schema_meta').run()
      database
        .prepare(
          `
            INSERT INTO schema_meta (version, applied_at)
            VALUES (?, ?)
          `
        )
        .run(migration.version, Date.now())
    })

    applyMigration()
    currentVersion = migration.version
  }
}
