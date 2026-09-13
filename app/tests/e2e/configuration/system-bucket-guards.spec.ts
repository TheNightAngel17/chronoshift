import { test, expect } from '@playwright/test'
import { closeApp, cleanupApp, launchApp, readFinalDatabaseState } from '../support/electronApp'
import {
  isRowButtonDisabled,
  isRowColorInputDisabled,
  openConfigurationTab
} from '../support/bucketTreeEditorPage'

// BUILD_PLAN §5.3, §10.2: "Never permit editing the system break bucket
// beyond its color." The repository already enforces this server-side
// (buckets.test.ts); this checks the UI actually disables the affordances
// rather than relying on the server to reject a click that should never
// have been possible.

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
      return database.prepare('SELECT name, is_system FROM buckets WHERE is_system = 1').get() as {
        name: string
        is_system: number
      }
    })

    expect(breakBucket.name).toBe('Break / Away')
  } finally {
    cleanupApp(launched)
  }
})
