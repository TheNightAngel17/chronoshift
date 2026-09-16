import { useEffect, useMemo, useRef, useState } from 'react'
import type { Bucket, BucketNode } from '../../../../shared/types'
import {
  drillInto,
  filterArchivedBuckets,
  filterBucketRows,
  flattenSelectableBuckets,
  formatBucketPath,
  hasVisibleChildren,
  moveHighlight,
  navigateUp,
  visibleChildren,
  type RootSection
} from './bucketPickerLogic'
import styles from './BucketPicker.module.css'

export interface BucketPickerProps {
  /** Called with the chosen bucket — a folder is as selectable as a leaf. */
  onSelect: (bucket: Bucket) => void
  /** Called on Escape, or when the caller wants to dismiss the picker. */
  onClose: () => void
}

type RowKind = 'root-recent' | 'root-all' | 'recent-bucket' | 'browse-bucket' | 'search-bucket'

/** One row as actually rendered, regardless of which mode produced it. */
interface DisplayRow {
  key: string
  label: string
  kind: RowKind
  /** `null` for the two root pseudo-rows — there is nothing to select there. */
  bucket: Bucket | null
  /** Present when a chevron should render: drilling in pushes this node. */
  drillTarget: BucketNode | null
}

function BucketPicker({ onSelect, onClose }: BucketPickerProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [rootSection, setRootSection] = useState<RootSection>('root')
  const [bucketBreadcrumb, setBucketBreadcrumb] = useState<BucketNode[]>([])
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [tree, setTree] = useState<BucketNode[] | null>(null)
  const [recents, setRecents] = useState<Bucket[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false

    void Promise.all([window.api.buckets.recents(8), window.api.buckets.tree()]).then(
      ([recentsResult, treeResult]) => {
        if (cancelled) {
          return
        }

        if (!recentsResult.ok) {
          setError(recentsResult.error)
          return
        }

        if (!treeResult.ok) {
          setError(treeResult.error)
          return
        }

        setRecents(recentsResult.data)
        setTree(treeResult.data)
      }
    )

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const isSearching = query.trim().length > 0

  const rows = useMemo<DisplayRow[]>(() => {
    if (isSearching) {
      return filterBucketRows(flattenSelectableBuckets(tree ?? []), query).map((row) => ({
        key: `search-${row.node.id.toString()}`,
        label: formatBucketPath(row.path),
        kind: 'search-bucket' as const,
        bucket: row.node,
        drillTarget: null // search results select only — drilling belongs to the unfiltered tree.
      }))
    }

    if (rootSection === 'root') {
      return [
        {
          key: 'root-recent',
          label: 'Recent',
          kind: 'root-recent' as const,
          bucket: null,
          drillTarget: null
        },
        {
          key: 'root-all',
          label: 'All',
          kind: 'root-all' as const,
          bucket: null,
          drillTarget: null
        }
      ]
    }

    if (rootSection === 'recent') {
      return filterArchivedBuckets(recents ?? []).map((bucket) => ({
        key: `recent-${bucket.id.toString()}`,
        label: bucket.name,
        kind: 'recent-bucket' as const,
        bucket,
        drillTarget: null // Recent is a flat shortcut list, one level deep.
      }))
    }

    return visibleChildren(tree ?? [], bucketBreadcrumb).map((node) => ({
      key: `folder-${node.id.toString()}`,
      label: node.name,
      kind: 'browse-bucket' as const,
      bucket: node,
      drillTarget: hasVisibleChildren(node) ? node : null
    }))
  }, [isSearching, query, tree, recents, rootSection, bucketBreadcrumb])

  // The row set changes shape under the highlighted index every time the
  // mode, query, or breadcrumb changes — start over rather than pointing at
  // a row that no longer means what it did. Adjusting during render (rather
  // than in an effect) avoids an extra commit just to clear the highlight.
  const rowsModeKey = `${isSearching ? 'search' : rootSection}:${query}:${bucketBreadcrumb
    .map((node) => node.id)
    .join('/')}`
  const [lastRowsModeKey, setLastRowsModeKey] = useState(rowsModeKey)

  if (rowsModeKey !== lastRowsModeKey) {
    setLastRowsModeKey(rowsModeKey)
    setHighlightedIndex(-1)
  }

  /** Enters the section a root pseudo-row stands for. */
  const enterRootSection = (kind: 'root-recent' | 'root-all'): void => {
    if (kind === 'root-recent') {
      setRootSection('recent')
    } else {
      setRootSection('all')
      setBucketBreadcrumb([])
    }
  }

  /** Primary action (Enter, or clicking the row's label): drill for a root row, select otherwise. */
  const activateRow = (row: DisplayRow): void => {
    if (row.kind === 'root-recent' || row.kind === 'root-all') {
      enterRootSection(row.kind)
      return
    }

    if (row.bucket !== null) {
      onSelect(row.bucket)
    }
  }

  /** Secondary action (the chevron, or ArrowRight): drill in, when there's somewhere to drill. */
  const drillRow = (row: DisplayRow): void => {
    if (row.kind === 'root-recent' || row.kind === 'root-all') {
      enterRootSection(row.kind)
      return
    }

    if (row.drillTarget !== null) {
      setBucketBreadcrumb((current) => drillInto(current, row.drillTarget!))
    }
  }

  const canDrill = (row: DisplayRow): boolean =>
    row.kind === 'root-recent' || row.kind === 'root-all' || row.drillTarget !== null

  /** Backspace / the back affordance / ArrowLeft: one level up, or out to the root chooser. */
  const goUp = (): void => {
    const next = navigateUp({ rootSection, breadcrumb: bucketBreadcrumb })
    setRootSection(next.rootSection)
    setBucketBreadcrumb(next.breadcrumb)
  }

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((index) =>
        moveHighlight(index, event.key === 'ArrowDown' ? 1 : -1, rows.length)
      )
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()

      if (highlightedIndex >= 0 && highlightedIndex < rows.length) {
        activateRow(rows[highlightedIndex])
      }

      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }

    if (event.key === 'ArrowRight' && query.length === 0) {
      const row = rows[highlightedIndex]

      if (row !== undefined && canDrill(row)) {
        event.preventDefault()
        drillRow(row)
      }

      return
    }

    if (
      (event.key === 'Backspace' || event.key === 'ArrowLeft') &&
      query.length === 0 &&
      rootSection !== 'root'
    ) {
      event.preventDefault()
      goUp()
    }
  }

  if (tree === null || recents === null) {
    return (
      <div className={styles.picker}>
        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <p className={styles.hint}>Loading buckets…</p>
      </div>
    )
  }

  const breadcrumbEntries: { label: string; onClick: () => void; disabled: boolean }[] =
    isSearching || rootSection === 'root'
      ? []
      : rootSection === 'recent'
        ? [{ label: 'Recent', onClick: () => {}, disabled: true }]
        : [
            {
              label: 'All',
              onClick: () => {
                setBucketBreadcrumb([])
              },
              disabled: bucketBreadcrumb.length === 0
            },
            ...bucketBreadcrumb.map((node, index) => ({
              label: node.name,
              onClick: () => {
                setBucketBreadcrumb(bucketBreadcrumb.slice(0, index + 1))
              },
              disabled: index === bucketBreadcrumb.length - 1
            }))
          ]

  return (
    <div className={styles.picker}>
      <input
        ref={inputRef}
        aria-label="Search buckets"
        className={styles.input}
        placeholder="Search buckets…"
        role="combobox"
        aria-expanded="true"
        aria-controls="bucket-picker-list"
        aria-activedescendant={highlightedIndex >= 0 ? rows[highlightedIndex]?.key : undefined}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
        }}
        onKeyDown={handleInputKeyDown}
      />

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {breadcrumbEntries.length > 0 && (
        <div className={styles.breadcrumb}>
          <button className={styles.backButton} type="button" onClick={goUp}>
            ‹ Back
          </button>
          {breadcrumbEntries.map((crumb) => (
            <button
              key={crumb.label}
              className={styles.crumb}
              type="button"
              disabled={crumb.disabled}
              onClick={crumb.onClick}
            >
              {crumb.label}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 && (
        <p className={styles.hint}>
          {isSearching
            ? 'No buckets match your search.'
            : rootSection === 'recent'
              ? 'No recent buckets yet.'
              : 'No buckets here.'}
        </p>
      )}

      <ul id="bucket-picker-list" className={styles.list} role="listbox" aria-label="Buckets">
        {rows.map((row, index) => (
          <li
            key={row.key}
            id={row.key}
            role="option"
            aria-selected={index === highlightedIndex}
            className={index === highlightedIndex ? styles.rowHighlighted : styles.row}
          >
            <button
              className={styles.rowLabel}
              type="button"
              onMouseEnter={() => {
                setHighlightedIndex(index)
              }}
              onClick={() => {
                activateRow(row)
              }}
            >
              {row.label}
            </button>

            {canDrill(row) && (
              <button
                aria-label={`Open ${row.label}`}
                className={styles.chevron}
                type="button"
                onClick={() => {
                  drillRow(row)
                }}
              >
                ›
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default BucketPicker
