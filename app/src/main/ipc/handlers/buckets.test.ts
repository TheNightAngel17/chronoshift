import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { IpcInvokeChannel, type IpcInvokeMap } from '../../../shared/ipc-contract'
import { openDatabase } from '../../db/connection'
import { runMigrations } from '../../db/migrations'
import { BucketsRepository } from '../../db/repositories/buckets'
import { registerBucketIpcHandlers } from './buckets'

type HandlerMap = {
  [Channel in keyof IpcInvokeMap]: (
    event: IpcMainInvokeEvent,
    ...args: IpcInvokeMap[Channel]['params']
  ) => IpcInvokeMap[Channel]['result'] | Promise<IpcInvokeMap[Channel]['result']>
}

async function withHandlers(
  run: (
    invoke: <Channel extends keyof IpcInvokeMap>(
      channel: Channel,
      ...args: IpcInvokeMap[Channel]['params']
    ) => Promise<IpcInvokeMap[Channel]['result']>,
    database: ReturnType<typeof openDatabase>
  ) => void | Promise<void>
): Promise<void> {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'chronoshift-ipc-buckets-'))
  const databasePath = join(tempDirectory, 'test.db')
  const database = openDatabase(databasePath)

  try {
    runMigrations(database)

    const handlers = new Map<keyof IpcInvokeMap, HandlerMap[keyof IpcInvokeMap]>()
    const registrar: Pick<IpcMain, 'handle'> = {
      handle(channel, listener) {
        handlers.set(channel as keyof IpcInvokeMap, listener as HandlerMap[keyof IpcInvokeMap])
        return this as unknown as IpcMain
      }
    }

    registerBucketIpcHandlers(registrar, new BucketsRepository(database))

    const invoke = async <Channel extends keyof IpcInvokeMap>(
      channel: Channel,
      ...args: IpcInvokeMap[Channel]['params']
    ): Promise<IpcInvokeMap[Channel]['result']> => {
      const handler = handlers.get(channel) as HandlerMap[Channel] | undefined

      if (!handler) {
        throw new Error(`No handler registered for ${channel}.`)
      }

      return await handler({} as IpcMainInvokeEvent, ...args)
    }

    await run(invoke, database)
  } finally {
    database.close()
    rmSync(tempDirectory, { recursive: true, force: true })
  }
}

describe('bucket IPC handlers', () => {
  it('invokes each buckets handler against a migrated temp database', async () => {
    await withHandlers(async (invoke, database) => {
      const createRoot = await invoke(IpcInvokeChannel.bucketsCreate, null, 'Client', '#112233')
      expect(createRoot.ok).toBe(true)

      if (!createRoot.ok) {
        return
      }

      const createChild = await invoke(
        IpcInvokeChannel.bucketsCreate,
        createRoot.data.id,
        'Project',
        null
      )
      expect(createChild.ok).toBe(true)

      if (!createChild.ok) {
        return
      }

      const tree = await invoke(IpcInvokeChannel.bucketsTree)
      expect(tree.ok).toBe(true)
      if (tree.ok) {
        expect(tree.data.some((node) => node.id === createRoot.data.id)).toBe(true)
      }

      const updated = await invoke(IpcInvokeChannel.bucketsUpdate, createRoot.data.id, {
        name: 'Client Renamed',
        color: '#445566'
      })
      expect(updated).toEqual({
        ok: true,
        data: expect.objectContaining({ name: 'Client Renamed', color: '#445566' })
      })

      const move = await invoke(IpcInvokeChannel.bucketsMove, createChild.data.id, null, 5)
      expect(move).toEqual({ ok: true, data: undefined })

      const archive = await invoke(IpcInvokeChannel.bucketsArchive, createChild.data.id, true)
      expect(archive).toEqual({ ok: true, data: undefined })

      const now = Date.now()
      const insertSegment = database
        .prepare(
          `
            INSERT INTO segments (bucket_id, started_at, ended_at, origin, created_at, updated_at)
            VALUES (?, ?, ?, 'manual', ?, ?)
          `
        )
        .run(createRoot.data.id, now - 5_000, now - 1_000, now, now)
      expect(insertSegment.changes).toBe(1)

      const recents = await invoke(IpcInvokeChannel.bucketsRecents, 5)
      expect(recents).toEqual({
        ok: true,
        data: [expect.objectContaining({ id: createRoot.data.id })]
      })

      const disposable = await invoke(IpcInvokeChannel.bucketsCreate, null, 'Disposable', null)
      expect(disposable.ok).toBe(true)

      if (!disposable.ok) {
        return
      }

      const deleted = await invoke(IpcInvokeChannel.bucketsDelete, disposable.data.id)
      expect(deleted).toEqual({ ok: true, data: undefined })
    })
  })

  it('returns clear Result.error values for argument and repository rejections', async () => {
    await withHandlers(async (invoke, database) => {
      const treeArgs = await (invoke as (...args: unknown[]) => Promise<unknown>)(
        IpcInvokeChannel.bucketsTree,
        'unexpected'
      )
      expect(treeArgs).toEqual({ ok: false, error: 'This channel does not accept arguments.' })

      const badCreate = await invoke(IpcInvokeChannel.bucketsCreate, 'x' as never, 'Bad', null)
      expect(badCreate).toEqual({ ok: false, error: 'parentId must be an integer.' })

      const root = await invoke(IpcInvokeChannel.bucketsCreate, null, 'Root')
      const child = await invoke(
        IpcInvokeChannel.bucketsCreate,
        root.ok ? root.data.id : null,
        'Child'
      )
      const grandchild = await invoke(
        IpcInvokeChannel.bucketsCreate,
        child.ok ? child.data.id : null,
        'Grandchild'
      )
      const depth3 = await invoke(
        IpcInvokeChannel.bucketsCreate,
        grandchild.ok ? grandchild.data.id : null,
        'Depth3'
      )
      const tooDeep = await invoke(
        IpcInvokeChannel.bucketsCreate,
        depth3.ok ? depth3.data.id : null,
        'Depth4'
      )
      expect(tooDeep).toEqual({ ok: false, error: 'Buckets may be at most 4 levels deep.' })

      if (root.ok && grandchild.ok) {
        const cycleMove = await invoke(
          IpcInvokeChannel.bucketsMove,
          root.data.id,
          grandchild.data.id,
          0
        )
        expect(cycleMove).toEqual({
          ok: false,
          error: 'A bucket cannot be moved into its own subtree.'
        })
      }

      if (root.ok) {
        const now = Date.now()
        database
          .prepare(
            `
              INSERT INTO segments (bucket_id, started_at, ended_at, origin, created_at, updated_at)
              VALUES (?, ?, ?, 'manual', ?, ?)
            `
          )
          .run(root.data.id, now - 10_000, now - 5_000, now, now)

        const referencedDelete = await invoke(IpcInvokeChannel.bucketsDelete, root.data.id)
        expect(referencedDelete).toEqual({
          ok: false,
          error: 'Cannot delete bucket "Root" because 1 segment(s) still reference it.'
        })
      }

      const badUpdate = await invoke(IpcInvokeChannel.bucketsUpdate, 1, {
        notAllowed: true
      } as never)
      expect(badUpdate).toEqual({
        ok: false,
        error: 'patch contains unsupported field(s): notAllowed.'
      })

      const emptyPatch = await invoke(IpcInvokeChannel.bucketsUpdate, 1, {})
      expect(emptyPatch).toEqual({
        ok: false,
        error: 'patch must include at least one supported field.'
      })

      const badMove = await invoke(IpcInvokeChannel.bucketsMove, 1, null, -1)
      expect(badMove).toEqual({
        ok: false,
        error: 'sortOrder must be an integer greater than or equal to 0.'
      })

      const badArchive = await invoke(IpcInvokeChannel.bucketsArchive, 1, 'yes' as never)
      expect(badArchive).toEqual({ ok: false, error: 'archived must be a boolean.' })

      const badDelete = await invoke(IpcInvokeChannel.bucketsDelete, 1.5 as never)
      expect(badDelete).toEqual({ ok: false, error: 'id must be an integer.' })

      const badRecents = await invoke(IpcInvokeChannel.bucketsRecents, -2)
      expect(badRecents).toEqual({
        ok: false,
        error: 'limit must be an integer greater than or equal to 0.'
      })
    })
  })
})
