import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BucketNode, Result } from '../../../../shared/types'
import {
  appendSortOrder,
  canAddChild,
  canMoveInto,
  canReorder,
  FIRST_SORT_ORDER,
  flattenBucketTree,
  isEmptyBucketTree,
  isSystemBucket,
  reorderSiblings,
  resolveEffectiveColor,
  toColorInputValue,
  type FlatBucketRow
} from './bucketTree'
import styles from './BucketTreeEditor.module.css'

const TOP_LEVEL_VALUE = 'top-level'

type CreateDraft = { parentId: number | null; name: string }
type RenameDraft = { id: number; name: string }

function BucketTreeEditor(): React.JSX.Element {
  const [tree, setTree] = useState<BucketNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null)
  const [renameDraft, setRenameDraft] = useState<RenameDraft | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null)

  const applyTreeResult = useCallback((result: Result<BucketNode[]>): void => {
    if (!result.ok) {
      setError(result.error)
      return
    }

    setError(null)
    setTree(result.data)
  }, [])

  useEffect(() => {
    let cancelled = false

    void window.api.buckets.tree().then((result) => {
      if (!cancelled) {
        applyTreeResult(result)
      }
    })

    return () => {
      cancelled = true
    }
  }, [applyTreeResult])

  /**
   * Runs one editing operation, then reloads the tree regardless of outcome —
   * an operation built from several IPC calls (e.g. `reorder`) can fail
   * partway through, and the UI must reflect whatever partial state actually
   * landed rather than the pre-operation tree. The reload's own error never
   * overwrites a genuine operation failure.
   */
  const run = useCallback(async (operation: () => Promise<Result<unknown>>): Promise<boolean> => {
    setBusy(true)

    try {
      const result = await operation()
      const refreshed = await window.api.buckets.tree()

      if (refreshed.ok) {
        setTree(refreshed.data)
      }

      if (!result.ok) {
        setError(result.error)
        return false
      }

      setError(refreshed.ok ? null : refreshed.error)
      return refreshed.ok
    } finally {
      setBusy(false)
    }
  }, [])

  const rows = useMemo(() => (tree === null ? [] : flattenBucketTree(tree)), [tree])
  const rootSiblings = tree ?? []

  const submitCreate = async (draft: CreateDraft): Promise<void> => {
    const name = draft.name.trim()

    if (name.length === 0) {
      setError('Enter a name for the new bucket.')
      return
    }

    // `buckets:create` always lands a new bucket at `sort_order = 0`, which
    // would put it ahead of any already-reordered sibling — append it to the
    // end of the group instead, the same way `reparent` does.
    const siblings =
      draft.parentId === null
        ? rootSiblings
        : (rows.find((candidate) => candidate.node.id === draft.parentId)?.node.children ?? [])

    const created = await run(async () => {
      const createdBucket = await window.api.buckets.create(draft.parentId, name)

      if (!createdBucket.ok) {
        return createdBucket
      }

      return window.api.buckets.move(
        createdBucket.data.id,
        draft.parentId,
        appendSortOrder(siblings)
      )
    })

    if (created) {
      setCreateDraft(null)
    }
  }

  const submitRename = async (draft: RenameDraft): Promise<void> => {
    const name = draft.name.trim()

    if (name.length === 0) {
      setError('A bucket name cannot be empty.')
      return
    }

    const renamed = await run(() => window.api.buckets.update(draft.id, { name }))

    if (renamed) {
      setRenameDraft(null)
    }
  }

  const reorder = async (row: FlatBucketRow, direction: -1 | 1): Promise<void> => {
    const reordered = reorderSiblings(row.siblings, row.node.id, direction)

    if (reordered === null) {
      return
    }

    // `buckets:move` sets one bucket's `sort_order` at a time, so renumber the
    // whole sibling group to make the new order unambiguous.
    await run(async () => {
      for (const [index, sibling] of reordered.entries()) {
        const result = await window.api.buckets.move(
          sibling.id,
          sibling.parentId,
          index + FIRST_SORT_ORDER
        )

        if (!result.ok) {
          return result
        }
      }

      return { ok: true, data: undefined }
    })
  }

  const reparent = async (row: FlatBucketRow, value: string): Promise<void> => {
    const newParentId = value === TOP_LEVEL_VALUE ? null : Number(value)
    const targetSiblings =
      newParentId === null
        ? rootSiblings
        : (rows.find((candidate) => candidate.node.id === newParentId)?.node.children ?? [])

    await run(() =>
      window.api.buckets.move(row.node.id, newParentId, appendSortOrder(targetSiblings))
    )
  }

  const confirmDelete = async (id: number): Promise<void> => {
    const deleted = await run(() => window.api.buckets.delete(id))

    if (deleted) {
      setPendingDeleteId(null)
    }
  }

  const renderRow = (row: FlatBucketRow): React.JSX.Element => {
    const { node } = row
    const locked = isSystemBucket(node)
    const renaming = renameDraft?.id === node.id
    const effectiveColor = resolveEffectiveColor(node, row.ancestors)
    const parentOptions = rows.filter((candidate) => canMoveInto(node, candidate.node))

    return (
      <li key={node.id} className={node.isArchived ? styles.archivedRow : styles.row}>
        <div className={styles.rowMain}>
          <span
            aria-hidden="true"
            className={styles.swatch}
            style={{ backgroundColor: effectiveColor }}
          />

          {renaming ? (
            <form
              className={styles.inlineForm}
              onSubmit={(event) => {
                event.preventDefault()
                void submitRename(renameDraft)
              }}
            >
              <input
                aria-label={`Rename ${node.name}`}
                autoFocus
                className={styles.input}
                value={renameDraft.name}
                onChange={(event) => {
                  setRenameDraft({ id: node.id, name: event.target.value })
                }}
              />
              <button className={styles.primaryButton} disabled={busy} type="submit">
                Save
              </button>
              <button
                className={styles.button}
                type="button"
                onClick={() => {
                  setRenameDraft(null)
                }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <span className={styles.name}>{node.name}</span>
          )}

          {locked && <span className={styles.badge}>System</span>}
          {node.isArchived && <span className={styles.badge}>Archived</span>}
        </div>

        <div className={styles.actions}>
          <label className={styles.colorControl}>
            <span className={styles.visuallyHidden}>{`Color for ${node.name}`}</span>
            <input
              type="color"
              value={toColorInputValue(node.color)}
              disabled={busy}
              onChange={(event) => {
                void run(() => window.api.buckets.update(node.id, { color: event.target.value }))
              }}
            />
          </label>

          <button
            className={styles.button}
            disabled={busy || node.color === null}
            title="Inherit this bucket's color from its nearest coloured ancestor"
            type="button"
            onClick={() => {
              void run(() => window.api.buckets.update(node.id, { color: null }))
            }}
          >
            Inherit color
          </button>

          <button
            className={styles.button}
            disabled={busy || !canAddChild(node)}
            title={
              canAddChild(node)
                ? undefined
                : locked
                  ? 'The system break bucket cannot have children.'
                  : 'Buckets may be at most 4 levels deep.'
            }
            type="button"
            onClick={() => {
              setCreateDraft({ parentId: node.id, name: '' })
            }}
          >
            Add child
          </button>

          <button
            className={styles.button}
            disabled={busy || locked || renaming}
            type="button"
            onClick={() => {
              setRenameDraft({ id: node.id, name: node.name })
            }}
          >
            Rename
          </button>

          <button
            aria-label={`Move ${node.name} up`}
            className={styles.button}
            disabled={busy || !canReorder(row.siblings, node.id, -1)}
            type="button"
            onClick={() => {
              void reorder(row, -1)
            }}
          >
            ↑
          </button>

          <button
            aria-label={`Move ${node.name} down`}
            className={styles.button}
            disabled={busy || !canReorder(row.siblings, node.id, 1)}
            type="button"
            onClick={() => {
              void reorder(row, 1)
            }}
          >
            ↓
          </button>

          <label className={styles.parentControl}>
            <span className={styles.visuallyHidden}>{`Parent of ${node.name}`}</span>
            <select
              disabled={busy || locked || parentOptions.length === 0}
              value={node.parentId === null ? TOP_LEVEL_VALUE : node.parentId.toString()}
              onChange={(event) => {
                void reparent(row, event.target.value)
              }}
            >
              <option value={TOP_LEVEL_VALUE} disabled={!canMoveInto(node, null)}>
                Top level
              </option>
              {rows.map((candidate) => (
                <option
                  key={candidate.node.id}
                  value={candidate.node.id.toString()}
                  disabled={
                    candidate.node.id !== node.parentId && !canMoveInto(node, candidate.node)
                  }
                >
                  {`${'— '.repeat(candidate.node.depth)}${candidate.node.name}`}
                </option>
              ))}
            </select>
          </label>

          <button
            className={styles.button}
            disabled={busy || locked}
            type="button"
            onClick={() => {
              void run(() => window.api.buckets.archive(node.id, !node.isArchived))
            }}
          >
            {node.isArchived ? 'Unarchive' : 'Archive'}
          </button>

          {pendingDeleteId === node.id ? (
            <>
              <button
                className={styles.dangerButton}
                disabled={busy}
                type="button"
                onClick={() => {
                  void confirmDelete(node.id)
                }}
              >
                Confirm delete
              </button>
              <button
                className={styles.button}
                type="button"
                onClick={() => {
                  setPendingDeleteId(null)
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              className={styles.button}
              disabled={busy || locked}
              type="button"
              onClick={() => {
                setPendingDeleteId(node.id)
              }}
            >
              Delete
            </button>
          )}
        </div>

        {createDraft?.parentId === node.id && renderCreateForm(createDraft)}

        {node.children.length > 0 && <ul className={styles.list}>{node.children.map(findRow)}</ul>}
      </li>
    )
  }

  // Rows are pre-flattened, so children look themselves up rather than being
  // re-derived while rendering.
  function findRow(child: BucketNode): React.JSX.Element {
    const row = rows.find((candidate) => candidate.node.id === child.id)

    return row === undefined ? <li key={child.id}>{child.name}</li> : renderRow(row)
  }

  function renderCreateForm(draft: CreateDraft): React.JSX.Element {
    return (
      <form
        className={styles.createForm}
        onSubmit={(event) => {
          event.preventDefault()
          void submitCreate(draft)
        }}
      >
        <input
          aria-label="New bucket name"
          autoFocus
          className={styles.input}
          placeholder="New bucket name"
          value={draft.name}
          onChange={(event) => {
            setCreateDraft({ parentId: draft.parentId, name: event.target.value })
          }}
        />
        <button className={styles.primaryButton} disabled={busy} type="submit">
          Create
        </button>
        <button
          className={styles.button}
          type="button"
          onClick={() => {
            setCreateDraft(null)
          }}
        >
          Cancel
        </button>
      </form>
    )
  }

  if (tree === null) {
    return (
      <div className={styles.editor}>
        {error !== null && <p className={styles.error}>{error}</p>}
        <p className={styles.hint}>Loading buckets…</p>
      </div>
    )
  }

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <button
          className={styles.primaryButton}
          disabled={busy}
          type="button"
          onClick={() => {
            setCreateDraft({ parentId: null, name: '' })
          }}
        >
          Add top-level bucket
        </button>
        <p className={styles.hint}>Buckets may be nested up to four levels deep.</p>
      </div>

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {createDraft?.parentId === null && renderCreateForm(createDraft)}

      {isEmptyBucketTree(tree) && (
        <p className={styles.hint}>
          Only the system break bucket exists so far. Add a top-level bucket to start tracking your
          own work.
        </p>
      )}

      <ul className={styles.list}>{tree.map(findRow)}</ul>
    </div>
  )
}

export default BucketTreeEditor
