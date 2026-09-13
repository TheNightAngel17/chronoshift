import { describe, expect, it } from 'vitest'
import { deriveDeterministicBucketColor } from '../../../../shared/colors'
import type { BucketNode } from '../../../../shared/types'
import {
  appendSortOrder,
  canAddChild,
  canMoveInto,
  canReorder,
  collectDescendantIds,
  flattenBucketTree,
  isEmptyBucketTree,
  isSystemBucket,
  MAX_BUCKET_DEPTH,
  reorderableSiblings,
  reorderSiblings,
  resolveEffectiveColor,
  subtreeHeight,
  toColorInputValue
} from './bucketTree'

interface NodeOverrides {
  parentId?: number | null
  depth?: number
  color?: string | null
  isSystem?: boolean
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
    color: overrides.color ?? null,
    kind: overrides.isSystem === true ? 'break' : 'work',
    isSystem: overrides.isSystem ?? false,
    isArchived: overrides.isArchived ?? false,
    source: 'local',
    externalId: null,
    externalType: null,
    createdAt: 0,
    updatedAt: 0,
    children: overrides.children ?? []
  }
}

/** Break / Away, plus a 4-level chain: Client → Project → Task → Subtask. */
function buildTree(): BucketNode[] {
  const subtask = node(5, 'Subtask', { parentId: 4, depth: 3 })
  const task = node(4, 'Task', { parentId: 3, depth: 2, children: [subtask] })
  const project = node(3, 'Project', { parentId: 2, depth: 1, children: [task] })
  const client = node(2, 'Client', { depth: 0, color: '#3366FF', children: [project] })
  const breakBucket = node(1, 'Break / Away', { depth: 0, isSystem: true })

  return [breakBucket, client]
}

describe('flattenBucketTree', () => {
  it('yields every node depth-first with its ancestry and sibling group', () => {
    const rows = flattenBucketTree(buildTree())

    expect(rows.map((row) => row.node.name)).toEqual([
      'Break / Away',
      'Client',
      'Project',
      'Task',
      'Subtask'
    ])

    const subtaskRow = rows[4]
    expect(subtaskRow.ancestors.map((ancestor) => ancestor.name)).toEqual([
      'Client',
      'Project',
      'Task'
    ])
    expect(subtaskRow.siblings.map((sibling) => sibling.name)).toEqual(['Subtask'])
  })
})

describe('subtreeHeight and collectDescendantIds', () => {
  it('measures how far a subtree reaches below its root', () => {
    const [, client] = buildTree()

    expect(subtreeHeight(client)).toBe(3)
    expect(subtreeHeight(client.children[0].children[0].children[0])).toBe(0)
    expect([...collectDescendantIds(client)]).toEqual([3, 4, 5])
  })
})

describe('canAddChild', () => {
  it('allows children until the deepest level is reached', () => {
    const rows = flattenBucketTree(buildTree())
    const byName = (name: string): BucketNode => rows.find((row) => row.node.name === name)!.node

    expect(canAddChild(byName('Client'))).toBe(true)
    expect(canAddChild(byName('Task'))).toBe(true)
    expect(byName('Subtask').depth).toBe(MAX_BUCKET_DEPTH)
    expect(canAddChild(byName('Subtask'))).toBe(false)
  })

  it('never allows children under the system break bucket', () => {
    const [breakBucket] = buildTree()

    expect(isSystemBucket(breakBucket)).toBe(true)
    expect(canAddChild(breakBucket)).toBe(false)
  })
})

describe('canMoveInto', () => {
  const rows = flattenBucketTree(buildTree())
  const byName = (name: string): BucketNode => rows.find((row) => row.node.name === name)!.node

  it('refuses to move the system break bucket anywhere', () => {
    expect(canMoveInto(byName('Break / Away'), null)).toBe(false)
    expect(canMoveInto(byName('Break / Away'), byName('Client'))).toBe(false)
  })

  it('refuses to reparent anything under the system break bucket', () => {
    expect(canMoveInto(byName('Subtask'), byName('Break / Away'))).toBe(false)
  })

  it('refuses a move into the node itself or its own subtree', () => {
    expect(canMoveInto(byName('Project'), byName('Project'))).toBe(false)
    expect(canMoveInto(byName('Project'), byName('Task'))).toBe(false)
    expect(canMoveInto(byName('Project'), byName('Subtask'))).toBe(false)
  })

  it('refuses a move that would push the subtree past four levels', () => {
    const project = byName('Project')
    const depthOne = node(10, 'Depth one', { parentId: 9, depth: 1 })
    const depthTwo = node(11, 'Depth two', { parentId: 10, depth: 2 })

    // Project carries two levels below it, so depth 0 is the deepest parent
    // that still leaves room for its whole subtree.
    expect(subtreeHeight(project)).toBe(2)
    expect(canMoveInto(project, null)).toBe(true)
    expect(canMoveInto(project, depthOne)).toBe(false)
    expect(canMoveInto(project, depthTwo)).toBe(false)

    // Subtask is a leaf, so it fits anywhere down to depth 3.
    expect(canMoveInto(byName('Subtask'), depthOne)).toBe(true)
    expect(canMoveInto(byName('Subtask'), depthTwo)).toBe(true)
  })

  it('refuses a pointless move of a top-level bucket to the top level', () => {
    expect(canMoveInto(byName('Client'), null)).toBe(false)
  })
})

describe('sibling reordering', () => {
  const siblings = [
    node(1, 'Break / Away', { isSystem: true }),
    node(2, 'Alpha'),
    node(3, 'Beta'),
    node(4, 'Gamma')
  ]

  it('pins the system bucket out of the reorderable group', () => {
    expect(reorderableSiblings(siblings).map((sibling) => sibling.name)).toEqual([
      'Alpha',
      'Beta',
      'Gamma'
    ])
    expect(reorderSiblings(siblings, 1, 1)).toBeNull()
    expect(canReorder(siblings, 1, -1)).toBe(false)
  })

  it('swaps a bucket with its neighbour', () => {
    expect(reorderSiblings(siblings, 3, -1)?.map((sibling) => sibling.name)).toEqual([
      'Beta',
      'Alpha',
      'Gamma'
    ])
    expect(reorderSiblings(siblings, 3, 1)?.map((sibling) => sibling.name)).toEqual([
      'Alpha',
      'Gamma',
      'Beta'
    ])
  })

  it('refuses to move past either end of the group', () => {
    expect(canReorder(siblings, 2, -1)).toBe(false)
    expect(canReorder(siblings, 4, 1)).toBe(false)
    expect(canReorder(siblings, 2, 1)).toBe(true)
  })

  it('appends after the reorderable siblings, leaving room for the pinned bucket', () => {
    expect(appendSortOrder(siblings)).toBe(4)
    expect(appendSortOrder([])).toBe(1)
  })
})

describe('resolveEffectiveColor', () => {
  it('prefers the bucket’s own color', () => {
    expect(resolveEffectiveColor(node(9, 'Own', { color: '#ff0000' }), [])).toBe('#ff0000')
  })

  it('inherits from the nearest colored ancestor', () => {
    const ancestors = [
      node(1, 'Root', { color: '#111111' }),
      node(2, 'Middle', { color: '#222222' }),
      node(3, 'Near')
    ]

    expect(resolveEffectiveColor(node(9, 'Leaf'), ancestors)).toBe('#222222')
  })

  it('falls back to a deterministic color when nothing is set', () => {
    expect(resolveEffectiveColor(node(9, 'Leaf'), [node(1, 'Root')])).toBe(
      deriveDeterministicBucketColor(9)
    )
  })
})

describe('toColorInputValue', () => {
  it('passes hex colors through and neutralises anything else', () => {
    expect(toColorInputValue('#AABBCC')).toBe('#aabbcc')
    expect(toColorInputValue('hsl(120 60% 50%)')).toBe('#808080')
    expect(toColorInputValue(null)).toBe('#808080')
  })
})

describe('isEmptyBucketTree', () => {
  it('is true when only the seeded break bucket exists', () => {
    expect(isEmptyBucketTree([node(1, 'Break / Away', { isSystem: true })])).toBe(true)
    expect(isEmptyBucketTree([])).toBe(true)
    expect(isEmptyBucketTree(buildTree())).toBe(false)
  })
})
