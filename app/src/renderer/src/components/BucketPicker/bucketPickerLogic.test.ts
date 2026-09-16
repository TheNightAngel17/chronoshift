import { describe, expect, it } from 'vitest'
import type { BucketNode } from '../../../../shared/types'
import {
  drillInto,
  drillUp,
  filterArchivedBuckets,
  filterBucketRows,
  flattenSelectableBuckets,
  formatBucketPath,
  hasVisibleChildren,
  matchesBucketQuery,
  moveHighlight,
  navigateUp,
  visibleChildren
} from './bucketPickerLogic'

interface NodeOverrides {
  parentId?: number | null
  depth?: number
  isArchived?: boolean
  children?: BucketNode[]
}

function node(id: number, name: string, overrides: NodeOverrides = {}): BucketNode {
  return {
    id,
    parentId: overrides.parentId ?? null,
    name,
    depth: overrides.depth ?? 0,
    sortOrder: 0,
    color: null,
    kind: 'work',
    isSystem: false,
    isArchived: overrides.isArchived ?? false,
    source: 'local',
    externalId: null,
    externalType: null,
    createdAt: 0,
    updatedAt: 0,
    children: overrides.children ?? []
  }
}

/** Acme / Website / Build / Testing, plus an archived sibling folder with its own child. */
function buildTree(): BucketNode[] {
  const testing = node(4, 'Testing', { parentId: 3, depth: 3 })
  const build = node(3, 'Build', { parentId: 2, depth: 2, children: [testing] })
  const website = node(2, 'Website', { parentId: 1, depth: 1, children: [build] })
  const acme = node(1, 'Acme', { depth: 0, children: [website] })

  const archivedChild = node(11, 'Old task', { parentId: 10, depth: 1 })
  const archivedFolder = node(10, 'Retired client', {
    depth: 0,
    isArchived: true,
    children: [archivedChild]
  })

  return [acme, archivedFolder]
}

describe('flattenSelectableBuckets', () => {
  it('flattens depth-first with root-first paths, dropping archived subtrees', () => {
    const rows = flattenSelectableBuckets(buildTree())

    expect(rows.map((row) => row.node.name)).toEqual(['Acme', 'Website', 'Build', 'Testing'])

    const testingRow = rows[3]
    expect(testingRow.path.map((node) => node.name)).toEqual([
      'Acme',
      'Website',
      'Build',
      'Testing'
    ])
  })
})

describe('formatBucketPath', () => {
  it('joins a path with " / "', () => {
    const rows = flattenSelectableBuckets(buildTree())
    const testingRow = rows.find((row) => row.node.name === 'Testing')!

    expect(formatBucketPath(testingRow.path)).toBe('Acme / Website / Build / Testing')
  })

  it('is just the name for a top-level node', () => {
    const rows = flattenSelectableBuckets(buildTree())
    const acmeRow = rows.find((row) => row.node.name === 'Acme')!

    expect(formatBucketPath(acmeRow.path)).toBe('Acme')
  })
})

describe('filterArchivedBuckets', () => {
  it('drops archived entries and keeps the rest', () => {
    const buckets = [
      node(1, 'Active'),
      node(2, 'Retired', { isArchived: true }),
      node(3, 'Also active')
    ]

    expect(filterArchivedBuckets(buckets).map((bucket) => bucket.name)).toEqual([
      'Active',
      'Also active'
    ])
  })
})

describe('matchesBucketQuery and filterBucketRows', () => {
  const rows = flattenSelectableBuckets(buildTree())

  it('matches a blank query against everything', () => {
    expect(filterBucketRows(rows, '')).toHaveLength(rows.length)
    expect(filterBucketRows(rows, '   ')).toHaveLength(rows.length)
  })

  it('matches a substring of any path segment, case-insensitively', () => {
    expect(filterBucketRows(rows, 'web').map((row) => row.node.name)).toEqual([
      'Website',
      'Build',
      'Testing'
    ])
    expect(filterBucketRows(rows, 'TEST').map((row) => row.node.name)).toEqual(['Testing'])
  })

  it('matches on an ancestor segment even when the node itself does not contain it', () => {
    const testingRow = rows.find((row) => row.node.name === 'Testing')!

    expect(matchesBucketQuery(testingRow, 'acme')).toBe(true)
    expect(matchesBucketQuery(testingRow, 'nonexistent')).toBe(false)
  })

  it('never surfaces archived nodes, since they are excluded before filtering', () => {
    expect(filterBucketRows(rows, 'retired')).toHaveLength(0)
    expect(filterBucketRows(rows, 'old task')).toHaveLength(0)
  })
})

describe('visibleChildren and hasVisibleChildren', () => {
  it('returns top-level buckets for an empty breadcrumb, excluding archived ones', () => {
    const tree = buildTree()

    expect(visibleChildren(tree, []).map((node) => node.name)).toEqual(['Acme'])
  })

  it('returns the drilled-into node’s children', () => {
    const tree = buildTree()
    const acme = tree[0]
    const website = acme.children[0]

    expect(visibleChildren(tree, [acme]).map((node) => node.name)).toEqual(['Website'])
    expect(visibleChildren(tree, [acme, website]).map((node) => node.name)).toEqual(['Build'])
  })

  it('reports whether a node has anything left to drill into', () => {
    const tree = buildTree()
    const [acme] = tree
    const testing = acme.children[0].children[0].children[0]

    expect(hasVisibleChildren(acme)).toBe(true)
    expect(hasVisibleChildren(testing)).toBe(false)
  })
})

describe('drillInto and drillUp', () => {
  it('pushes and pops breadcrumb levels', () => {
    const tree = buildTree()
    const acme = tree[0]
    const website = acme.children[0]

    const oneLevel = drillInto([], acme)
    expect(oneLevel.map((node) => node.name)).toEqual(['Acme'])

    const twoLevels = drillInto(oneLevel, website)
    expect(twoLevels.map((node) => node.name)).toEqual(['Acme', 'Website'])

    expect(drillUp(twoLevels).map((node) => node.name)).toEqual(['Acme'])
    expect(drillUp([])).toEqual([])
  })
})

describe('moveHighlight', () => {
  it('starts from nothing highlighted and lands on the first row going down', () => {
    expect(moveHighlight(-1, 1, 3)).toBe(0)
  })

  it('clamps at both ends instead of wrapping', () => {
    expect(moveHighlight(0, -1, 3)).toBe(0)
    expect(moveHighlight(2, 1, 3)).toBe(2)
  })

  it('moves by one in either direction within bounds', () => {
    expect(moveHighlight(1, 1, 3)).toBe(2)
    expect(moveHighlight(1, -1, 3)).toBe(0)
  })

  it('has nothing to highlight in an empty list', () => {
    expect(moveHighlight(-1, 1, 0)).toBe(-1)
  })
})

describe('navigateUp', () => {
  it('is a no-op at the root chooser', () => {
    expect(navigateUp({ rootSection: 'root', breadcrumb: [] })).toEqual({
      rootSection: 'root',
      breadcrumb: []
    })
  })

  it('falls out of Recent straight to the root chooser, having no levels of its own', () => {
    expect(navigateUp({ rootSection: 'recent', breadcrumb: [] })).toEqual({
      rootSection: 'root',
      breadcrumb: []
    })
  })

  it('pops one drilled-into bucket while browsing All', () => {
    const tree = buildTree()
    const acme = tree[0]
    const website = acme.children[0]

    expect(navigateUp({ rootSection: 'all', breadcrumb: [acme, website] })).toEqual({
      rootSection: 'all',
      breadcrumb: [acme]
    })
  })

  it('falls out of All to the root chooser once there is nothing left to pop', () => {
    expect(navigateUp({ rootSection: 'all', breadcrumb: [] })).toEqual({
      rootSection: 'root',
      breadcrumb: []
    })
  })
})
