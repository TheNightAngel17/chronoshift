import { test, expect } from '@playwright/test'
import { closeApp, cleanupApp, launchApp, readFinalDatabaseState } from '../support/electronApp'
import {
  addChildBucket,
  addTopLevelBucket,
  isRowButtonDisabled,
  openConfigurationTab
} from '../support/bucketTreeEditorPage'

// BUILD_PLAN §5.4, Phase 3 acceptance in §12: "a four-level tree can be
// built and rearranged in the UI; depth 4 is refused."

test('a four-level tree can be built, and a fifth level is refused', async () => {
  const launched = await launchApp()

  try {
    await openConfigurationTab(launched.window)
    await addTopLevelBucket(launched.window, 'Acme')
    await addChildBucket(launched.window, 'Acme', 'Website')
    await addChildBucket(launched.window, 'Website', 'Build')
    await addChildBucket(launched.window, 'Build', 'Testing')

    const depth3AddChildDisabled = await isRowButtonDisabled(
      launched.window,
      'Testing',
      'Add child'
    )
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
