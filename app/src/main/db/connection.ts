import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'node:path'
import { runMigrations } from './migrations'

const DATABASE_FILENAME = 'timetracker.db'

let database: Database.Database | null = null

export function getDatabasePath(userDataPath = app.getPath('userData')): string {
  return join(userDataPath, DATABASE_FILENAME)
}

export function openDatabase(databasePath: string): Database.Database {
  const connection = new Database(databasePath)

  connection.pragma('journal_mode = WAL')
  connection.pragma('foreign_keys = ON')
  connection.pragma('busy_timeout = 5000')

  return connection
}

export function getDatabase(): Database.Database {
  if (database === null) {
    const connection = openDatabase(getDatabasePath())

    try {
      runMigrations(connection)
    } catch (error) {
      connection.close()
      throw error
    }

    database = connection
  }

  return database
}

export function resetDatabaseForTests(): void {
  if (database?.open) {
    database.close()
  }

  database = null
}
