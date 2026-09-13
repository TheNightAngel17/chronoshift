import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { withTestDatabase, type TestDatabaseHandles } from './testDatabase'

const DATABASE_FILENAME = 'timetracker.db'
const APP_ROOT = join(__dirname, '..', '..', '..')

export interface LaunchedApp {
  app: ElectronApplication
  window: Page
  userDataDir: string
  databasePath: string
}

/**
 * Launches the real, built app (`npm run build` must have run first — this
 * points Electron at the same `out/main/index.js` a packaged app would use,
 * not the dev server) against a fresh, isolated `--user-data-dir`, optionally
 * seeded before launch via `seed`.
 *
 * `ELECTRON_RUN_AS_NODE` is stripped from the child's environment: if it
 * leaks in from the parent shell, Electron's own binary runs as plain Node
 * instead of actually launching the app, and this hangs until Playwright's
 * launch timeout with a confusing error.
 */
export async function launchApp(options?: {
  seed?: (handles: TestDatabaseHandles) => void
}): Promise<LaunchedApp> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'chronoshift-e2e-'))
  const databasePath = join(userDataDir, DATABASE_FILENAME)

  if (options?.seed) {
    withTestDatabase(databasePath, options.seed)
  }

  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined) {
      env[key] = value
    }
  }

  const app = await electron.launch({
    args: [APP_ROOT, `--user-data-dir=${userDataDir}`],
    env
  })

  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')

  return { app, window, userDataDir, databasePath }
}

/**
 * Closes the Electron process only — call `readFinalDatabaseState` after
 * this (the app must have released its own connection first) and
 * `cleanupApp` once assertions are done, typically from a `finally`.
 */
export async function closeApp(launched: LaunchedApp): Promise<void> {
  await launched.app.close()
}

/** Removes the temp `userData` dir (database included). */
export function cleanupApp(launched: LaunchedApp): void {
  rmSync(launched.userDataDir, { recursive: true, force: true })
}

/** Reopens the (now-closed app's) database file to assert its final state. */
export function readFinalDatabaseState<T>(
  launched: LaunchedApp,
  read: (handles: TestDatabaseHandles) => T
): T {
  return withTestDatabase(launched.databasePath, read)
}
