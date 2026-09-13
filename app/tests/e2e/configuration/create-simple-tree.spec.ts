import { test, expect } from '@playwright/test'
import { closeApp, cleanupApp, launchApp, readFinalDatabaseState } from '../support/electronApp'
import {
  addChildBucket,
  addTopLevelBucket,
  openConfigurationTab
} from '../support/bucketTreeEditorPage'

// BUILD_PLAN §10.2, §5.4. The empty state, then the simplest possible tree a
// new user builds: a couple of top-level buckets, one with a single child.
// (The 4-level tree and the depth-4 refusal are their own flow —
// create-complex-tree.spec.ts.)

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

test('building two top-level buckets, one with a child, persists the whole tree', async () => {
  const launched = await launchApp()

  try {
    await openConfigurationTab(launched.window)
    await addTopLevelBucket(launched.window, 'Acme')
    await addChildBucket(launched.window, 'Acme', 'Website')
    await addTopLevelBucket(launched.window, 'Personal')

    await closeApp(launched)

    const { rows, acmeId } = readFinalDatabaseState(launched, ({ database }) => {
      const rows = database
        .prepare(
          'SELECT name, depth, parent_id FROM buckets WHERE is_system = 0 ORDER BY depth, name'
        )
        .all() as Array<{ name: string; depth: number; parent_id: number | null }>
      const { id: acmeId } = database
        .prepare('SELECT id FROM buckets WHERE name = ?')
        .get('Acme') as {
        id: number
      }
      return { rows, acmeId }
    })

    expect(rows.map((row) => row.name)).toEqual(['Acme', 'Personal', 'Website'])
    expect(rows.find((row) => row.name === 'Acme')?.depth).toBe(0)
    expect(rows.find((row) => row.name === 'Personal')?.depth).toBe(0)

    const website = rows.find((row) => row.name === 'Website')
    expect(website?.depth).toBe(1)
    expect(website?.parent_id).toBe(acmeId)
  } finally {
    cleanupApp(launched)
  }
})
