import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const getPathMock = vi.fn<(name: string) => string>()

vi.mock('electron', () => ({
  app: {
    getPath: getPathMock
  }
}))

type ConnectionModule = typeof import('../connection')
type MigrationsModule = typeof import('../migrations')
type SettingsModule = typeof import('./settings')
type CheckinsModule = typeof import('./checkins')
type IdleEventsModule = typeof import('./idleEvents')
type AppStateModule = typeof import('./appState')

let connectionModule: ConnectionModule
let migrationsModule: MigrationsModule
let settingsModule: SettingsModule
let checkinsModule: CheckinsModule
let idleEventsModule: IdleEventsModule
let appStateModule: AppStateModule

beforeAll(async () => {
  ;[
    connectionModule,
    migrationsModule,
    settingsModule,
    checkinsModule,
    idleEventsModule,
    appStateModule
  ] = await Promise.all([
    import('../connection'),
    import('../migrations'),
    import('./settings'),
    import('./checkins'),
    import('./idleEvents'),
    import('./appState')
  ])
})

function withTempDatabase(run: (databasePath: string) => void): void {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'chronoshift-repositories-'))
  const databasePath = join(tempDirectory, 'test.db')

  try {
    run(databasePath)
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true })
  }
}

describe('settings repository', () => {
  it('round-trips seeded settings and validates updates', () => {
    withTempDatabase((databasePath) => {
      const database = connectionModule.openDatabase(databasePath)

      try {
        migrationsModule.runMigrations(database)
        const settings = settingsModule.getAll(database)
        expect(settings).toMatchObject({
          checkinIntervalMinutes: 15,
          idleThresholdMinutes: 5,
          snoozeMinutes: 5,
          autoStopAfterHours: 12,
          weekStartDay: 1,
          gridStartHour: 6,
          gridEndHour: 20,
          gridSnapMinutes: 5,
          promptStealFocus: true,
          promptSound: false,
          autostartEnabled: true,
          autostartBeginTracking: false,
          theme: 'system'
        })

        const updated = settingsModule.set('theme', 'dark', database)
        expect(updated.theme).toBe('dark')
        expect(settingsModule.getAll(database).theme).toBe('dark')

        expect(() => {
          settingsModule.set('weekStartDay', 7, database)
        }).toThrowError(/weekStartDay/)
      } finally {
        database.close()
      }
    })
  })
})

describe('checkins repository', () => {
  it('creates, responds to, and queries recent checkins', () => {
    withTempDatabase((databasePath) => {
      const database = connectionModule.openDatabase(databasePath)

      try {
        migrationsModule.runMigrations(database)
        const created = checkinsModule.create(null, 1_000, database)
        expect(created.segmentId).toBeNull()
        expect(created.promptedAt).toBe(1_000)
        expect(created.respondedAt).toBeNull()
        expect(created.response).toBeNull()
        expect(() => {
          checkinsModule.create(1.5, 1_000, database)
        }).toThrowError(/segmentId must be an integer/)
        expect(() => {
          checkinsModule.create(null, 1_000.5, database)
        }).toThrowError(/promptedAt must be an integer/)

        const responded = checkinsModule.respond(created.id, 1_250, 'timeout', database)
        expect(responded.respondedAt).toBe(1_250)
        expect(responded.response).toBe('timeout')
        expect(() => {
          checkinsModule.respond(created.id, 999, 'same', database)
        }).toThrowError(/respondedAt must be greater than or equal to promptedAt/)
        expect(() => {
          checkinsModule.respond(created.id, 1_300, 'same', database)
        }).toThrowError(/already has a recorded response/)

        expect(checkinsModule.getRecent(1, database)).toEqual([responded])
      } finally {
        database.close()
      }
    })
  })
})

describe('idleEvents repository', () => {
  it('creates, resolves, and queries the unresolved idle event', () => {
    withTempDatabase((databasePath) => {
      const database = connectionModule.openDatabase(databasePath)

      try {
        migrationsModule.runMigrations(database)
        const created = idleEventsModule.create(2_000, 2_600, 'lock', database)
        expect(created.cause).toBe('lock')
        expect(created.resolution).toBeNull()
        expect(created.resolvedAt).toBeNull()
        expect(idleEventsModule.getUnresolved(database)).toEqual(created)
        expect(() => {
          idleEventsModule.create(4_000, 4_600, 'bad-cause' as never, database)
        }).toThrowError(/idle_event_cause_valid/)

        const resolved = idleEventsModule.resolve(created.id, 'break', 2_700, database)
        expect(resolved.resolution).toBe('break')
        expect(resolved.resolvedAt).toBe(2_700)
        const pending = idleEventsModule.create(3_000, 3_600, 'suspend', database)
        expect(() => {
          idleEventsModule.resolve(pending.id, 'kept', 3_500, database)
        }).toThrowError(/resolvedAt must be greater than or equal to endedAt/)
        idleEventsModule.resolve(pending.id, 'kept', 3_700, database)
        const anotherPending = idleEventsModule.create(5_000, 5_600, 'inactivity', database)
        expect(() => {
          idleEventsModule.resolve(anotherPending.id, 'bad-resolution' as never, 5_700, database)
        }).toThrowError(/idle_event_resolution_valid/)
        idleEventsModule.resolve(anotherPending.id, 'split', 5_700, database)
        expect(() => {
          idleEventsModule.resolve(created.id, 'kept', 2_800, database)
        }).toThrowError(/already resolved/)
        expect(idleEventsModule.getUnresolved(database)).toBeNull()
      } finally {
        database.close()
      }
    })
  })
})

describe('appState repository', () => {
  it('round-trips the typed app state keys in use', () => {
    withTempDatabase((databasePath) => {
      const database = connectionModule.openDatabase(databasePath)

      try {
        migrationsModule.runMigrations(database)
        expect(appStateModule.getLastSeenAt(database)).toBeNull()
        expect(appStateModule.getLastBucketId(database)).toBeNull()
        expect(appStateModule.getCleanShutdown(database)).toBeNull()

        appStateModule.setLastSeenAt(3_000, database)
        appStateModule.setLastBucketId(9, database)
        appStateModule.setCleanShutdown(true, database)

        expect(appStateModule.getLastSeenAt(database)).toBe(3_000)
        expect(appStateModule.getLastBucketId(database)).toBe(9)
        expect(appStateModule.getCleanShutdown(database)).toBe(true)

        appStateModule.setLastBucketId(null, database)
        expect(appStateModule.getLastBucketId(database)).toBeNull()

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
          .run('clean_shutdown', 'not-json', Date.now())
        expect(() => {
          appStateModule.getCleanShutdown(database)
        }).toThrowError(/Invalid stored JSON/)

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
          .run('last_seen_at', JSON.stringify('oops'), Date.now())
        expect(() => {
          appStateModule.getLastSeenAt(database)
        }).toThrowError(/integer epoch millisecond value/)
      } finally {
        database.close()
      }
    })
  })
})
