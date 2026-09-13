import { test, expect } from '@playwright/test'
import type { ChronoShiftApi } from '../../src/shared/ipc-contract'
import { closeApp, cleanupApp, launchApp, readFinalDatabaseState } from './support/electronApp'
import {
  addChildBucket,
  addTopLevelBucket,
  archiveBucket,
  isRowButtonDisabled,
  isRowColorInputDisabled,
  openConfigurationTab,
  renameBucket
} from './support/bucketTreeEditorPage'

// Issue #21 (BUILD_PLAN §10.2, §5.4, Phase 3 acceptance in §12): the
// Configuration tab's bucket tree editor. Each test seeds a database, drives
// the real built app through the UI (not just the pure helpers already
// covered by bucketTree.test.ts under Vitest), then reopens that same
// database file after the app closes to assert the rows it actually wrote —
// the round trip a unit test covering `bucketTree.ts` alone can't exercise.

test('creating, renaming, and archiving a bucket persists to the database', async () => {
  const launched = await launchApp()

  try {
    await openConfigurationTab(launched.window)
    await addTopLevelBucket(launched.window, 'Acme')
    await renameBucket(launched.window, 'Acme', 'Acme Corp')
    await archiveBucket(launched.window, 'Acme Corp')

    await closeApp(launched)

    const acme = readFinalDatabaseState(launched, ({ database }) => {
      return database
        .prepare('SELECT name, is_archived, depth, parent_id FROM buckets WHERE name = ?')
        .get('Acme Corp') as
        | { name: string; is_archived: number; depth: number; parent_id: number | null }
        | undefined
    })

    expect(acme).toBeDefined()
    expect(acme?.is_archived).toBe(1)
    expect(acme?.depth).toBe(0)
    expect(acme?.parent_id).toBeNull()
  } finally {
    cleanupApp(launched)
  }
})

test('a four-level tree can be built, and a fifth level is refused', async () => {
  const launched = await launchApp()

  try {
    await openConfigurationTab(launched.window)
    await addTopLevelBucket(launched.window, 'Acme')
    await addChildBucket(launched.window, 'Acme', 'Website')
    await addChildBucket(launched.window, 'Website', 'Build')
    await addChildBucket(launched.window, 'Build', 'Testing')

    const depth3AddChildDisabled = await isRowButtonDisabled(launched.window, 'Testing', 'Add child')
    expect(depth3AddChildDisabled).toBe(true)

    await closeApp(launched)

    const depths = readFinalDatabaseState(launched, ({ database }) => {
      return database
        .prepare('SELECT name, depth FROM buckets WHERE name IN (?, ?, ?, ?) ORDER BY depth')
        .all('Acme', 'Website', 'Build', 'Testing') as Array<{ name: string; depth: number }>
    })

    expect(depths).toEqual([
      { name: 'Acme', depth: 0 },
      { name: 'Website', depth: 1 },
      { name: 'Build', depth: 2 },
      { name: 'Testing', depth: 3 }
    ])
  } finally {
    cleanupApp(launched)
  }
})

test('the system break bucket resists edits beyond its color', async () => {
  const launched = await launchApp()

  try {
    await openConfigurationTab(launched.window)

    expect(await isRowButtonDisabled(launched.window, 'Break / Away', 'Rename')).toBe(true)
    expect(await isRowButtonDisabled(launched.window, 'Break / Away', 'Archive')).toBe(true)
    expect(await isRowButtonDisabled(launched.window, 'Break / Away', 'Delete')).toBe(true)
    expect(await isRowButtonDisabled(launched.window, 'Break / Away', 'Add child')).toBe(true)
    expect(await isRowColorInputDisabled(launched.window, 'Break / Away')).toBe(false)

    await closeApp(launched)

    const breakBucket = readFinalDatabaseState(launched, ({ database }) => {
      return database
        .prepare('SELECT name, is_system FROM buckets WHERE is_system = 1')
        .get() as { name: string; is_system: number }
    })

    expect(breakBucket.name).toBe('Break / Away')
  } finally {
    cleanupApp(launched)
  }
})

test('deleting a bucket that still has a child surfaces the repository message, not a generic error', async () => {
  const launched = await launchApp()

  try {
    await openConfigurationTab(launched.window)
    await addTopLevelBucket(launched.window, 'Acme')
    await addChildBucket(launched.window, 'Acme', 'Website')

    // No delete confirmation appears in the DOM at all when the repository
    // rejects the call — the editor surfaces the error text and never
    // reaches the two-step confirm UI, so assert via the IPC bridge (already
    // exercised through the UI's own call path) rather than scraping for an
    // error string whose exact DOM location is a presentation detail.
    const result = await launched.window.evaluate(async (): Promise<{ ok: boolean; error?: string }> => {
      const api = (window as unknown as { api: ChronoShiftApi }).api
      const tree = await api.buckets.tree()
      if (!tree.ok) return { ok: false, error: 'tree() itself failed' }
      const acme = tree.data.find((bucket) => bucket.name === 'Acme')
      if (!acme) return { ok: false, error: 'Acme not found' }
      return api.buckets.delete(acme.id)
    })

    expect(result.ok).toBe(false)
    expect(result.error).toBe('Cannot delete bucket "Acme" because it still has child buckets.')

    await closeApp(launched)

    const stillThere = readFinalDatabaseState(launched, ({ database }) => {
      return database.prepare('SELECT COUNT(*) AS count FROM buckets WHERE name = ?').get('Acme') as {
        count: number
      }
    })
    expect(stillThere.count).toBe(1)
  } finally {
    cleanupApp(launched)
  }
})

test('a fresh database shows the empty state with only the seeded break bucket', async () => {
  const launched = await launchApp()

  try {
    await openConfigurationTab(launched.window)

    await expect(
      launched.window.getByText('Only the system break bucket exists so far.')
    ).toBeVisible()

    await closeApp(launched)

    const bucketCount = readFinalDatabaseState(launched, ({ database }) => {
      return database.prepare('SELECT COUNT(*) AS count FROM buckets').get() as { count: number }
    })
    expect(bucketCount.count).toBe(1)
  } finally {
    cleanupApp(launched)
  }
})
