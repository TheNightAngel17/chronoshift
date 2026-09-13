// Pure tree logic behind the bucket tree editor (BUILD_PLAN §5.4, §10.2).
//
// The main process is the real boundary — `BucketsRepository` enforces the
// depth limit, the cycle rule and the system-bucket guards, and returns a
// message when it rejects something. Everything here exists so the UI can
// *disable* the affordance up front; the component still surfaces the server's
// message verbatim whenever a call is rejected anyway.

import { deriveDeterministicBucketColor } from '../../../../shared/colors'
import type { Bucket, BucketNode } from '../../../../shared/types'

/** Deepest allowed `depth` value — 4 levels, 0-3 (§5.4). */
export const MAX_BUCKET_DEPTH = 3

/** One bucket plus the ancestry the editor needs to render and reparent it. */
export interface FlatBucketRow {
  node: BucketNode
  /** Root-first ancestor chain, excluding the node itself. */
  ancestors: BucketNode[]
  /** Siblings under the same parent, in tree order, including the node itself. */
  siblings: BucketNode[]
}

/**
 * The reserved "Break / Away" bucket (§5.3). It is flagged `is_system` in the
 * schema and seeded with `kind = 'break'`; only its color may be edited.
 */
export function isSystemBucket(bucket: Bucket): boolean {
  return bucket.isSystem
}

/** Depth-first walk, yielding every node with its ancestry and sibling group. */
export function flattenBucketTree(
  nodes: BucketNode[],
  ancestors: BucketNode[] = []
): FlatBucketRow[] {
  return nodes.flatMap((node) => [
    { node, ancestors, siblings: nodes },
    ...flattenBucketTree(node.children, [...ancestors, node])
  ])
}

/** How many levels of descendants hang below `node` (0 for a leaf). */
export function subtreeHeight(node: BucketNode): number {
  if (node.children.length === 0) {
    return 0
  }

  return 1 + Math.max(...node.children.map(subtreeHeight))
}

/** Every id in `node`'s subtree, excluding `node` itself. */
export function collectDescendantIds(node: BucketNode): Set<number> {
  const ids = new Set<number>()

  const visit = (current: BucketNode): void => {
    for (const child of current.children) {
      ids.add(child.id)
      visit(child)
    }
  }

  visit(node)

  return ids
}

/**
 * Whether "Add child" should be enabled: a child would sit one level deeper
 * than `node`, and the system bucket takes no children at all (§10.2).
 */
export function canAddChild(node: BucketNode): boolean {
  return !isSystemBucket(node) && node.depth + 1 <= MAX_BUCKET_DEPTH
}

/**
 * Whether `node` may be reparented under `target` (`null` = top level). Mirrors
 * the repository's system / cycle / depth rules so the option can be hidden.
 */
export function canMoveInto(node: BucketNode, target: BucketNode | null): boolean {
  if (isSystemBucket(node)) {
    return false
  }

  if (target === null) {
    return node.parentId !== null
  }

  if (
    isSystemBucket(target) ||
    target.id === node.id ||
    collectDescendantIds(node).has(target.id)
  ) {
    return false
  }

  return target.depth + 1 + subtreeHeight(node) <= MAX_BUCKET_DEPTH
}

/**
 * The siblings that participate in reordering. The system bucket is pinned:
 * the repository refuses to move it, so it keeps its seeded `sort_order` and
 * the rest are renumbered above it.
 */
export function reorderableSiblings(siblings: BucketNode[]): BucketNode[] {
  return siblings.filter((sibling) => !isSystemBucket(sibling))
}

/**
 * The sibling group reordered by one position, or `null` when the node cannot
 * move that way (it is the system bucket, or already at the end it is headed).
 */
export function reorderSiblings(
  siblings: BucketNode[],
  id: number,
  direction: -1 | 1
): BucketNode[] | null {
  const ordered = reorderableSiblings(siblings)
  const index = ordered.findIndex((sibling) => sibling.id === id)
  const targetIndex = index + direction

  if (index === -1 || targetIndex < 0 || targetIndex >= ordered.length) {
    return null
  }

  const next = [...ordered]
  const [moved] = next.splice(index, 1)
  next.splice(targetIndex, 0, moved)

  return next
}

/** Whether the reorder button in `direction` should be enabled. */
export function canReorder(siblings: BucketNode[], id: number, direction: -1 | 1): boolean {
  return reorderSiblings(siblings, id, direction) !== null
}

/**
 * `sort_order` to hand `buckets:move` for a node joining `siblings`. Reordered
 * siblings are numbered from 1 so the pinned system bucket (seeded at 0) stays
 * first in its group.
 */
export const FIRST_SORT_ORDER = 1

/** The `sort_order` that appends a node to the end of `siblings`. */
export function appendSortOrder(siblings: BucketNode[]): number {
  return reorderableSiblings(siblings).length + FIRST_SORT_ORDER
}

/**
 * Effective color: the node's own color, else the nearest ancestor's, else a
 * deterministic color derived from the id (§5.4).
 */
export function resolveEffectiveColor(node: Bucket, ancestors: Bucket[]): string {
  if (node.color !== null) {
    return node.color
  }

  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestorColor = ancestors[index].color

    if (ancestorColor !== null) {
      return ancestorColor
    }
  }

  return deriveDeterministicBucketColor(node.id)
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

/**
 * `<input type="color">` only accepts `#rrggbb`. Inherited and deterministic
 * colors may be any CSS color, so fall back to a neutral swatch value for them
 * rather than letting the control silently snap to black.
 */
export function toColorInputValue(color: string | null): string {
  return color !== null && HEX_COLOR.test(color) ? color.toLowerCase() : '#808080'
}

/** True when nothing but the seeded system bucket exists yet (§10.2 empty state). */
export function isEmptyBucketTree(tree: BucketNode[]): boolean {
  return flattenBucketTree(tree).every((row) => isSystemBucket(row.node))
}
