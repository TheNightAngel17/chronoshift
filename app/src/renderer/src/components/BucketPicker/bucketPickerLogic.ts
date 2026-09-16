// Pure tree logic behind the shared bucket picker (BUILD_PLAN §10.3).
//
// Recents (`buckets:recents`) and the flattened tree (`buckets:tree`) both
// come from the main process already excluding/including archived rows per
// their own query, but the picker re-derives the archived exclusion itself
// rather than trusting either caller — cheap, and it keeps this file the one
// place "can this bucket ever appear in the picker" is answered.

import type { Bucket, BucketNode } from '../../../../shared/types'

/** One selectable node plus its root-first path, including itself. */
export interface BucketPathRow {
  node: BucketNode
  path: BucketNode[]
}

/**
 * Depth-first flatten of `tree` into search rows, dropping archived nodes and
 * everything below them — an archived folder can't be drilled into, so
 * nothing under it can be reached either.
 */
export function flattenSelectableBuckets(
  tree: BucketNode[],
  ancestors: BucketNode[] = []
): BucketPathRow[] {
  return tree
    .filter((node) => !node.isArchived)
    .flatMap((node) => {
      const path = [...ancestors, node]

      return [{ node, path }, ...flattenSelectableBuckets(node.children, path)]
    })
}

/** `Acme / Website / Build / Testing` — how a path renders in search results. */
export function formatBucketPath(path: BucketNode[]): string {
  return path.map((node) => node.name).join(' / ')
}

/** Buckets (e.g. the recents list) with any archived entries dropped. */
export function filterArchivedBuckets<T extends Pick<Bucket, 'isArchived'>>(buckets: T[]): T[] {
  return buckets.filter((bucket) => !bucket.isArchived)
}

/**
 * Whether `row` matches a typed `query`: substring match, case-insensitive,
 * against any segment of its path (§10.3 — "Acme / Website / Build / Testing"
 * matches on "web" or "test" alike). A blank query matches everything.
 */
export function matchesBucketQuery(row: BucketPathRow, query: string): boolean {
  const needle = query.trim().toLowerCase()

  if (needle.length === 0) {
    return true
  }

  return row.path.some((node) => node.name.toLowerCase().includes(needle))
}

/** `rows` filtered to those matching `query`, in their original order. */
export function filterBucketRows(rows: BucketPathRow[], query: string): BucketPathRow[] {
  return rows.filter((row) => matchesBucketQuery(row, query))
}

/**
 * The rows shown while drilling down (not typing): top-level buckets when
 * `breadcrumb` is empty, else the last breadcrumb node's direct children.
 * Archived children are excluded the same way `flattenSelectableBuckets` does.
 */
export function visibleChildren(tree: BucketNode[], breadcrumb: BucketNode[]): BucketNode[] {
  const parent = breadcrumb.at(-1)
  const siblings = parent === undefined ? tree : parent.children

  return siblings.filter((node) => !node.isArchived)
}

/** Whether `node` shows a chevron: it has at least one non-archived child to drill into. */
export function hasVisibleChildren(node: BucketNode): boolean {
  return node.children.some((child) => !child.isArchived)
}

/** Breadcrumb after drilling into `node` from the current `breadcrumb`. */
export function drillInto(breadcrumb: BucketNode[], node: BucketNode): BucketNode[] {
  return [...breadcrumb, node]
}

/** Breadcrumb after going up one level (Backspace); a no-op at the top. */
export function drillUp(breadcrumb: BucketNode[]): BucketNode[] {
  return breadcrumb.slice(0, -1)
}

/**
 * Next highlighted index for an arrow-key press over a list of `length` rows,
 * clamped to the ends rather than wrapping — `-1` (nothing highlighted yet)
 * plus a downward press lands on the first row.
 */
export function moveHighlight(index: number, delta: number, length: number): number {
  if (length === 0) {
    return -1
  }

  return Math.max(0, Math.min(length - 1, index + delta))
}

/**
 * The picker's root, before either typing or drilling in, offers two static
 * "folders": Recent (a flat shortcut list, one level deep) and All (the real
 * tree, fully drillable). Typing at any point overrides both with search.
 */
export type RootSection = 'root' | 'recent' | 'all'

/** Where the picker is, outside of search: which root section, and how deep into it. */
export interface PickerLocation {
  rootSection: RootSection
  breadcrumb: BucketNode[]
}

/**
 * One level up (Backspace, the back affordance, or ArrowLeft): within `All`,
 * pops the last drilled-into bucket, or falls out to the root chooser once
 * there's no bucket left to pop; `Recent` falls straight out to the root
 * chooser, having no levels of its own; `root` has nowhere left to go.
 */
export function navigateUp(location: PickerLocation): PickerLocation {
  if (location.rootSection === 'all') {
    if (location.breadcrumb.length > 0) {
      return { rootSection: 'all', breadcrumb: drillUp(location.breadcrumb) }
    }

    return { rootSection: 'root', breadcrumb: [] }
  }

  if (location.rootSection === 'recent') {
    return { rootSection: 'root', breadcrumb: [] }
  }

  return location
}
