import { test, expect } from '@playwright/test'
import type { ChronoShiftApi } from '../../../src/shared/ipc-contract'
import { closeApp, cleanupApp, launchApp, readFinalDatabaseState } from '../support/electronApp'
import {
  addTopLevelBucket,
  openConfigurationTab,
  renameBucket,
  setBucketColor
} from '../support/bucketTreeEditorPage'

// BUILD_PLAN §5.4, §10.2: rename, set color, and the repository's
// name-swap-on-conflict behavior (`update()`'s `swapSiblingNames`) — silent
// and easy to regress, and only observable end to end since it depends on
// what the UI actually sends the repository, not just the repository's own
// unit-tested behavior in isolation.

test('renaming and setting an explicit color both persist', async () => {
  const launched = await launchApp()

  try {
    await openConfigurationTab(launched.window)
    await addTopLevelBucket(launched.window, 'Acme')
    await renameBucket(launched.window, 'Acme', 'Acme Corp')
    await setBucketColor(launched.window, 'Acme Corp', '#ff8800')

    await closeApp(launched)

    const bucket = readFinalDatabaseState(launched, ({ database }) => {
      return database
        .prepare('SELECT name, color FROM buckets WHERE name = ?')
        .get('Acme Corp') as {
        name: string
        color: string | null
      }
    })

    expect(bucket).toBeDefined()
    // The picker commits lowercase hex; the repository stores whatever it's given.
    expect(bucket.color?.toLowerCase()).toBe('#ff8800')
  } finally {
    cleanupApp(launched)
  }
})

test("renaming a bucket to a sibling's name swaps the two names instead of erroring", async () => {
  const launched = await launchApp()

  try {
    await openConfigurationTab(launched.window)
    await addTopLevelBucket(launched.window, 'Alpha')
    await addTopLevelBucket(launched.window, 'Beta')

    const idsByName = await launched.window.evaluate(async () => {
      const api = (window as unknown as { api: ChronoShiftApi }).api
      const tree = await api.buckets.tree()
      if (!tree.ok) throw new Error('tree() failed')
      return Object.fromEntries(tree.data.map((bucket) => [bucket.name, bucket.id]))
    })

    // BucketsRepository.update(): renaming into an active sibling's name
    // swaps the two names in one transaction rather than rejecting the call
    // — assert by id, not just "both names still exist somewhere", so this
    // actually distinguishes a swap from the rename silently no-op'ing.
    await renameBucket(launched.window, 'Alpha', 'Beta')
    await closeApp(launched)

    const namesById = readFinalDatabaseState(launched, ({ database }) => {
      function nameOf(id: number): string {
        return (
          database.prepare('SELECT name FROM buckets WHERE id = ?').get(id) as { name: string }
        ).name
      }
      return { formerlyAlpha: nameOf(idsByName.Alpha), formerlyBeta: nameOf(idsByName.Beta) }
    })

    expect(namesById.formerlyAlpha).toBe('Beta')
    expect(namesById.formerlyBeta).toBe('Alpha')
  } finally {
    cleanupApp(launched)
  }
})
