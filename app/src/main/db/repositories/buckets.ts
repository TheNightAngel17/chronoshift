import type Database from 'better-sqlite3'
import type { BucketPatch } from '../../../shared/ipc-contract'
import type { Bucket, BucketNode } from '../../../shared/types'

type BucketRow = {
  id: number
  parent_id: number | null
  name: string
  depth: number
  sort_order: number
  color: string | null
  kind: Bucket['kind']
  is_system: number
  is_archived: number
  source: Bucket['source']
  external_id: string | null
  external_type: string | null
  created_at: number
  updated_at: number
}

const SELECT_BUCKET_COLUMNS = `
  SELECT
    id,
    parent_id,
    name,
    depth,
    sort_order,
    color,
    kind,
    is_system,
    is_archived,
    source,
    external_id,
    external_type,
    created_at,
    updated_at
  FROM buckets
`

export function deriveDeterministicBucketColor(id: number): string {
  const hue = Math.abs(Math.imul(id, 137)) % 360
  return `hsl(${hue} 60% 50%)`
}

function mapBucketRow(row: BucketRow): Bucket {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    depth: row.depth,
    sortOrder: row.sort_order,
    color: row.color,
    kind: row.kind,
    isSystem: row.is_system === 1,
    isArchived: row.is_archived === 1,
    source: row.source,
    externalId: row.external_id,
    externalType: row.external_type,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class BucketsRepository {
  constructor(private readonly database: Database.Database) {}

  getById(id: number): Bucket | null {
    const row = this.getBucketRow(id)
    return row ? mapBucketRow(row) : null
  }

  tree(): BucketNode[] {
    const rows = this.database
      .prepare(
        `
          ${SELECT_BUCKET_COLUMNS}
          ORDER BY depth ASC, sort_order ASC, name ASC, id ASC
        `
      )
      .all() as BucketRow[]

    const nodes = new Map<number, BucketNode>()
    const roots: BucketNode[] = []

    for (const row of rows) {
      nodes.set(row.id, { ...mapBucketRow(row), children: [] })
    }

    for (const row of rows) {
      const node = nodes.get(row.id)

      if (!node) {
        continue
      }

      if (row.parent_id === null) {
        roots.push(node)
        continue
      }

      nodes.get(row.parent_id)?.children.push(node)
    }

    return roots
  }

  create(parentId: number | null, name: string, color: string | null = null): Bucket {
    const runCreate = this.database.transaction(
      (resolvedParentId: number | null, bucketName: string, bucketColor: string | null) => {
        const parent = resolvedParentId === null ? null : this.getBucketOrThrow(resolvedParentId)
        const depth = parent === null ? 0 : parent.depth + 1

        if (depth > 3) {
          throw new Error('Buckets may be at most 4 levels deep.')
        }

        const now = Date.now()
        const result = this.database
          .prepare(
            `
              INSERT INTO buckets (
                parent_id,
                name,
                depth,
                sort_order,
                color,
                kind,
                is_system,
                is_archived,
                source,
                external_id,
                external_type,
                created_at,
                updated_at
              ) VALUES (?, ?, ?, ?, ?, 'work', 0, 0, 'local', NULL, NULL, ?, ?)
            `
          )
          .run(resolvedParentId, bucketName, depth, 0, bucketColor, now, now)

        return this.getBucketOrThrow(Number(result.lastInsertRowid))
      }
    )

    return mapBucketRow(runCreate(parentId, name, color))
  }

  update(id: number, patch: BucketPatch): Bucket {
    const runUpdate = this.database.transaction((bucketId: number, nextPatch: BucketPatch) => {
      const current = this.getBucketOrThrow(bucketId)
      const nextName = nextPatch.name ?? current.name
      const nextColor = nextPatch.color === undefined ? current.color : nextPatch.color

      this.assertSystemBucketMutationIsAllowed(current, nextPatch)

      if (current.name !== nextName) {
        const conflictingSibling =
          current.is_archived === 1
            ? null
            : this.findActiveSiblingByName(current.parent_id, nextName, current.id)

        if (conflictingSibling) {
          this.assertSystemBucketMutationIsAllowed(conflictingSibling, { name: current.name })
          this.swapSiblingNames(current, conflictingSibling)
        } else {
          this.database
            .prepare(
              `
                UPDATE buckets
                SET name = ?, updated_at = ?
                WHERE id = ?
              `
            )
            .run(nextName, Date.now(), current.id)
        }
      }

      if (current.color !== nextColor) {
        this.database
          .prepare(
            `
              UPDATE buckets
              SET color = ?, updated_at = ?
              WHERE id = ?
            `
          )
          .run(nextColor, Date.now(), current.id)
      }

      return this.getBucketOrThrow(bucketId)
    })

    return mapBucketRow(runUpdate(id, patch))
  }

  move(id: number, newParentId: number | null, sortOrder: number): void {
    const runMove = this.database.transaction(
      (bucketId: number, targetParentId: number | null, nextSortOrder: number) => {
        const bucket = this.getBucketOrThrow(bucketId)

        if (bucket.is_system === 1) {
          throw new Error(`Bucket "${bucket.name}" is system-managed and cannot be moved.`)
        }

        if (targetParentId === bucket.id) {
          throw new Error('A bucket cannot be moved into itself.')
        }

        const targetParent = targetParentId === null ? null : this.getBucketOrThrow(targetParentId)

        if (targetParentId !== null && this.isDescendantOf(bucket.id, targetParentId)) {
          throw new Error('A bucket cannot be moved into its own subtree.')
        }

        const nextDepth = targetParent === null ? 0 : targetParent.depth + 1
        const depthDelta = nextDepth - bucket.depth
        const subtreeMaxDepth = this.getSubtreeMaxDepth(bucket.id)

        if (subtreeMaxDepth + depthDelta > 3) {
          throw new Error('Buckets may be at most 4 levels deep.')
        }

        const now = Date.now()

        this.database
          .prepare(
            `
              UPDATE buckets
              SET parent_id = ?, depth = ?, sort_order = ?, updated_at = ?
              WHERE id = ?
            `
          )
          .run(targetParentId, nextDepth, nextSortOrder, now, bucket.id)

        this.database
          .prepare(
            `
              WITH RECURSIVE subtree(id) AS (
                SELECT id
                FROM buckets
                WHERE parent_id = ?

                UNION ALL

                SELECT child.id
                FROM buckets child
                INNER JOIN subtree ON child.parent_id = subtree.id
              )
              UPDATE buckets
              SET depth = depth + ?, updated_at = ?
              WHERE id IN (SELECT id FROM subtree)
            `
          )
          .run(bucket.id, depthDelta, now)
      }
    )

    runMove(id, newParentId, sortOrder)
  }

  archive(id: number, archived: boolean): void {
    const runArchive = this.database.transaction((bucketId: number, nextArchived: boolean) => {
      const bucket = this.getBucketOrThrow(bucketId)

      if (bucket.is_system === 1) {
        throw new Error(`Bucket "${bucket.name}" is system-managed and cannot be archived.`)
      }

      this.database
        .prepare(
          `
            UPDATE buckets
            SET is_archived = ?, updated_at = ?
            WHERE id = ?
          `
        )
        .run(nextArchived ? 1 : 0, Date.now(), bucketId)
    })

    runArchive(id, archived)
  }

  delete(id: number): void {
    const runDelete = this.database.transaction((bucketId: number) => {
      const bucket = this.getBucketOrThrow(bucketId)

      if (bucket.is_system === 1) {
        throw new Error(`Bucket "${bucket.name}" is system-managed and cannot be deleted.`)
      }

      const referencingSegmentCount = this.database
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM segments
            WHERE bucket_id = ?
          `
        )
        .get(bucketId) as { count: number } | undefined

      if ((referencingSegmentCount?.count ?? 0) > 0) {
        throw new Error(
          `Cannot delete bucket "${bucket.name}" because ${(referencingSegmentCount?.count ?? 0).toString()} segment(s) still reference it.`
        )
      }

      const childBucketCount = this.database
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM buckets
            WHERE parent_id = ?
          `
        )
        .get(bucketId) as { count: number } | undefined

      if ((childBucketCount?.count ?? 0) > 0) {
        throw new Error(`Cannot delete bucket "${bucket.name}" because it still has child buckets.`)
      }

      this.database
        .prepare(
          `
            DELETE FROM buckets
            WHERE id = ?
          `
        )
        .run(bucketId)
    })

    runDelete(id)
  }

  recents(limit: number): Bucket[] {
    if (limit <= 0) {
      return []
    }

    const rows = this.database
      .prepare(
        `
          SELECT bucket.*
          FROM buckets bucket
          INNER JOIN (
            SELECT segment.bucket_id, MAX(segment.started_at) AS last_started_at
            FROM segments segment
            INNER JOIN buckets active_bucket
              ON active_bucket.id = segment.bucket_id AND active_bucket.is_archived = 0
            GROUP BY segment.bucket_id
            ORDER BY last_started_at DESC, segment.bucket_id DESC
            LIMIT ?
          ) recent ON recent.bucket_id = bucket.id
          ORDER BY recent.last_started_at DESC, bucket.id DESC
        `
      )
      .all(limit) as BucketRow[]

    return rows.map(mapBucketRow)
  }

  resolveColor(id: number): string {
    let bucket = this.getBucketOrThrow(id)
    const visited = new Set<number>()

    while (bucket.color === null && bucket.parent_id !== null && !visited.has(bucket.id)) {
      visited.add(bucket.id)
      bucket = this.getBucketOrThrow(bucket.parent_id)
    }

    return bucket.color ?? deriveDeterministicBucketColor(id)
  }

  private getBucketRow(id: number): BucketRow | undefined {
    return this.database
      .prepare(
        `
          ${SELECT_BUCKET_COLUMNS}
          WHERE id = ?
        `
      )
      .get(id) as BucketRow | undefined
  }

  private getBucketOrThrow(id: number): BucketRow {
    const bucket = this.getBucketRow(id)

    if (!bucket) {
      throw new Error(`Bucket ${id.toString()} was not found.`)
    }

    return bucket
  }

  private findActiveSiblingByName(
    parentId: number | null,
    name: string,
    excludeId: number
  ): BucketRow | null {
    return (
      (this.database
        .prepare(
          `
            ${SELECT_BUCKET_COLUMNS}
            WHERE parent_id IS ?
              AND name = ?
              AND is_archived = 0
              AND id <> ?
            LIMIT 1
          `
        )
        .get(parentId, name, excludeId) as BucketRow | undefined) ?? null
    )
  }

  private swapSiblingNames(first: BucketRow, second: BucketRow): void {
    if (first.parent_id !== second.parent_id) {
      throw new Error('Only sibling bucket names may be swapped.')
    }

    const now = Date.now()
    const temporaryName = this.buildTemporarySwapName(first.parent_id, first.id)

    this.database
      .prepare(
        `
          UPDATE buckets
          SET name = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(temporaryName, now, first.id)

    this.database
      .prepare(
        `
          UPDATE buckets
          SET name = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(first.name, now, second.id)

    this.database
      .prepare(
        `
          UPDATE buckets
          SET name = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(second.name, now, first.id)
  }

  private buildTemporarySwapName(parentId: number | null, bucketId: number): string {
    const baseName = `__chronoshift_swap__${bucketId.toString()}__${Date.now().toString()}`
    let candidate = baseName
    let suffix = 0

    while (this.findActiveSiblingByName(parentId, candidate, bucketId)) {
      suffix += 1
      candidate = `${baseName}_${suffix.toString()}`
    }

    return candidate
  }

  private assertSystemBucketMutationIsAllowed(bucket: BucketRow, patch: BucketPatch): void {
    if (bucket.is_system !== 1) {
      return
    }

    const attemptedRename = patch.name !== undefined && patch.name !== bucket.name

    if (attemptedRename) {
      throw new Error(`Bucket "${bucket.name}" is system-managed and cannot be renamed.`)
    }
  }

  private isDescendantOf(rootId: number, candidateId: number): boolean {
    const match = this.database
      .prepare(
        `
          WITH RECURSIVE subtree(id) AS (
            SELECT id
            FROM buckets
            WHERE parent_id = ?

            UNION ALL

            SELECT child.id
            FROM buckets child
            INNER JOIN subtree ON child.parent_id = subtree.id
          )
          SELECT 1 AS found
          FROM subtree
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(rootId, candidateId) as { found: number } | undefined

    return match?.found === 1
  }

  private getSubtreeMaxDepth(rootId: number): number {
    const result = this.database
      .prepare(
        `
          WITH RECURSIVE subtree(id, depth) AS (
            SELECT id, depth
            FROM buckets
            WHERE id = ?

            UNION ALL

            SELECT child.id, child.depth
            FROM buckets child
            INNER JOIN subtree ON child.parent_id = subtree.id
          )
          SELECT MAX(depth) AS max_depth
          FROM subtree
        `
      )
      .get(rootId) as { max_depth: number } | undefined

    return result?.max_depth ?? 0
  }
}
