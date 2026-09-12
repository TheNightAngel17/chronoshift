import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const getPathMock = vi.fn<(name: string) => string>()

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock
  }
}))

type ConnectionModule = typeof import('./connection')

let connectionModule: ConnectionModule

beforeAll(async () => {
  connectionModule = await import('./connection')
})

afterEach(() => {
  connectionModule.resetDatabaseForTests()
  vi.clearAllMocks()
})

describe('openDatabase', () => {
  it('opens a temp-file database with the required pragmas', () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'chronoshift-db-'))
    const databasePath = join(tempDirectory, 'test.db')

    try {
      const database = connectionModule.openDatabase(databasePath)

      expect(database.pragma('journal_mode', { simple: true })).toBe('wal')
      expect(database.pragma('foreign_keys', { simple: true })).toBe(1)
      expect(database.pragma('busy_timeout', { simple: true })).toBe(5000)

      database.close()
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })

  it('returns a singleton at the userData timetracker path', () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'chronoshift-db-'))

    try {
      getPathMock.mockReturnValue(tempDirectory)

      const firstConnection = connectionModule.getDatabase()
      const secondConnection = connectionModule.getDatabase()

      expect(firstConnection).toBe(secondConnection)
      expect(firstConnection.name).toBe(join(tempDirectory, 'timetracker.db'))
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true })
    }
  })
})
