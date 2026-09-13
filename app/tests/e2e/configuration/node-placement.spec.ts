import { test, expect } from '@playwright/test'
import type Database from 'better-sqlite3'
import { closeApp, cleanupApp, launchApp, readFinalDatabaseState } from '../support/electronApp'
import {
  addChildBucket,
  addTopLevelBucket,
  moveBucketDown,
  openConfigurationTab,
  reparentBucket
} from '../support/bucketTreeEditorPage'

// BUILD_PLAN §5.4, §10.2: "reorder (sort_order), reparent". Where a node sits
// in the tree, not what it's named or colored — that's node-naming-and-color.

test('reparenting across branches updates parent_id, and reparenting to top level cascades depth to descendants', async () => {
  const launched = await launchApp()

  try {
    await openConfigurationTab(launched.window)
    await addTopLevelBucket(launched.window, 'Acme')
    await addChildBucket(launched.window, 'Acme', 'Website')
    await addChildBucket(launched.window, 'Website', 'Blog')
    await addTopLevelBucket(launched.window, 'Personal')

    // Cross-branch: Website (with its child Blog) moves out of Acme and into
    // Personal — a different top-level tree entirely, but the same depth.
    await reparentBucket(launched.window, 'Website', 'Personal')

    interface DepthAndParent {
      depth: number
      parent_id: number | null
    }

    function byName(database: Database.Database, name: string): DepthAndParent {
      return database
        .prepare('SELECT depth, parent_id FROM buckets WHERE name = ?')
        .get(name) as DepthAndParent
    }

    const afterCrossBranch = readFinalDatabaseState(launched, ({ database }) => {
      const { id: personalId } = database
        .prepare('SELECT id FROM buckets WHERE name = ?')
        .get('Personal') as {
        id: number
      }
      return {
        website: byName(database, 'Website'),
        blog: byName(database, 'Blog'),
        personalId
      }
    })

    expect(afterCrossBranch.website.parent_id).toBe(afterCrossBranch.personalId)
    expect(afterCrossBranch.website.depth).toBe(1)
    expect(afterCrossBranch.blog.depth).toBe(2)

    // To top level: Website's depth drops from 1 to 0, and Blog — never
    // touched directly — must cascade from 2 to 1 along with it.
    await reparentBucket(launched.window, 'Website', null)
    await closeApp(launched)

    const afterTopLevel = readFinalDatabaseState(launched, ({ database }) => {
      return { website: byName(database, 'Website'), blog: byName(database, 'Blog') }
    })

    expect(afterTopLevel.website.parent_id).toBeNull()
    expect(afterTopLevel.website.depth).toBe(0)
    expect(afterTopLevel.blog.depth).toBe(1)
  } finally {
    cleanupApp(launched)
  }
})

test('moving a bucket down persists the new sibling order', async () => {
  const launched = await launchApp()

  try {
    await openConfigurationTab(launched.window)
    // The repository's own create() always inserts at sort_order 0, but the
    // editor follows every create with a move() appending to the end of the
    // sibling group (see BucketTreeEditor.tsx's submitCreate) — so through
    // the UI, initial order tracks creation order, not name.
    await addTopLevelBucket(launched.window, 'Alpha')
    await addTopLevelBucket(launched.window, 'Bravo')
    await addTopLevelBucket(launched.window, 'Charlie')

    await moveBucketDown(launched.window, 'Alpha')
    await closeApp(launched)

    const order = readFinalDatabaseState(launched, ({ database }) => {
      return database
        .prepare('SELECT name FROM buckets WHERE is_system = 0 ORDER BY sort_order ASC')
        .all() as Array<{ name: string }>
    })

    expect(order.map((row) => row.name)).toEqual(['Bravo', 'Alpha', 'Charlie'])
  } finally {
    cleanupApp(launched)
  }
})
