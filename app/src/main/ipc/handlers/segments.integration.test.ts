import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { IpcEventChannel, IpcInvokeChannel, type IpcInvokeMap } from '../../../shared/ipc-contract'
import { openDatabase } from '../../db/connection'
import { runMigrations } from '../../db/migrations'
import { BucketsRepository } from '../../db/repositories/buckets'
import { createSegmentsRepository } from '../../db/repositories/segments'
import { registerSegmentsIpcHandlers } from './segments'
import type { IpcEventEmitter } from './common'

type HandlerMap = {
  [Channel in keyof IpcInvokeMap]: (
    event: IpcMainInvokeEvent,
    ...args: IpcInvokeMap[Channel]['params']
  ) => IpcInvokeMap[Channel]['result'] | Promise<IpcInvokeMap[Channel]['result']>
}

type Invoke = <Channel extends keyof IpcInvokeMap>(
  channel: Channel,
  ...args: IpcInvokeMap[Channel]['params']
) => Promise<IpcInvokeMap[Channel]['result']>

interface EmittedEvent {
  channel: string
  payload: unknown
}

async function withHandlers(
  run: (context: {
    invoke: Invoke
    database: Database.Database
    emitted: EmittedEvent[]
    bucketId: (name: string) => number
  }) => void | Promise<void>
): Promise<void> {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'chronoshift-ipc-segments-'))
  const database = openDatabase(join(tempDirectory, 'test.db'))

  try {
    runMigrations(database)

    const handlers = new Map<keyof IpcInvokeMap, HandlerMap[keyof IpcInvokeMap]>()
    const registrar: Pick<IpcMain, 'handle'> = {
      handle(channel, listener) {
        handlers.set(channel as keyof IpcInvokeMap, listener as HandlerMap[keyof IpcInvokeMap])
        return this as unknown as IpcMain
      }
    }

    const emitted: EmittedEvent[] = []
    const emit: IpcEventEmitter = (channel, payload) => {
      emitted.push({ channel, payload })
    }

    registerSegmentsIpcHandlers(registrar, database, emit, createSegmentsRepository(database))

    const invoke: Invoke = async (channel, ...args) => {
      const handler = handlers.get(channel) as HandlerMap[typeof channel] | undefined

      if (!handler) {
        throw new Error(`No handler registered for ${channel}.`)
      }

      return await handler({} as IpcMainInvokeEvent, ...args)
    }

    const buckets = new BucketsRepository(database)
    const bucketId = (name: string): number => buckets.create(null, name, null).id

    await run({ invoke, database, emitted, bucketId })
  } finally {
    database.close()
    rmSync(tempDirectory, { recursive: true, force: true })
  }
}

function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) {
    throw new Error(`Expected an ok Result, got: ${result.error}`)
  }

  return result.data
}

describe('segment IPC handlers', () => {
  it('creates, reads, updates, splits, merges and deletes segments', async () => {
    await withHandlers(async ({ invoke, emitted, bucketId }) => {
      const writing = bucketId('Writing')
      const base = 1_700_000_000_000

      const created = unwrap(
        await invoke(IpcInvokeChannel.segmentsCreate, writing, base, base + 60_000, 'Draft')
      )
      expect(created).toEqual(
        expect.objectContaining({ bucketId: writing, startedAt: base, endedAt: base + 60_000 })
      )
      expect(emitted.at(-1)).toEqual({
        channel: IpcEventChannel.segmentsChanged,
        payload: { fromMs: base, toMs: base + 60_000 }
      })

      const listed = unwrap(await invoke(IpcInvokeChannel.segmentsRange, base, base + 60_000))
      expect(listed.map((segment) => segment.id)).toEqual([created.id])

      const updated = unwrap(
        await invoke(IpcInvokeChannel.segmentsUpdate, created.id, { note: 'Final draft' })
      )
      expect(updated.note).toBe('Final draft')
      expect(emitted.at(-1)).toEqual({
        channel: IpcEventChannel.segmentsChanged,
        payload: { fromMs: base, toMs: base + 60_000 }
      })

      const halves = unwrap(await invoke(IpcInvokeChannel.segmentsSplit, created.id, base + 30_000))
      expect(halves.map((half) => [half.startedAt, half.endedAt])).toEqual([
        [base, base + 30_000],
        [base + 30_000, base + 60_000]
      ])
      expect(emitted.at(-1)).toEqual({
        channel: IpcEventChannel.segmentsChanged,
        payload: { fromMs: base, toMs: base + 60_000 }
      })

      const merged = unwrap(
        await invoke(IpcInvokeChannel.segmentsMerge, halves[0].id, halves[1].id)
      )
      expect([merged.startedAt, merged.endedAt]).toEqual([base, base + 60_000])

      const deleted = await invoke(IpcInvokeChannel.segmentsDelete, merged.id)
      expect(deleted).toEqual({ ok: true, data: undefined })
      expect(emitted.at(-1)).toEqual({
        channel: IpcEventChannel.segmentsChanged,
        payload: { fromMs: base, toMs: base + 60_000 }
      })
      expect(unwrap(await invoke(IpcInvokeChannel.segmentsRange, base, base + 60_000))).toEqual([])
    })
  })

  it('emits the range a moved segment left as well as the one it landed in', async () => {
    await withHandlers(async ({ invoke, emitted, bucketId }) => {
      const writing = bucketId('Writing')
      const base = 1_700_000_000_000

      const created = unwrap(
        await invoke(IpcInvokeChannel.segmentsCreate, writing, base, base + 60_000)
      )
      emitted.length = 0

      unwrap(
        await invoke(IpcInvokeChannel.segmentsUpdate, created.id, {
          startedAt: base + 120_000,
          endedAt: base + 180_000,
          confirmedThrough: base + 180_000
        })
      )
      expect(emitted).toEqual([
        {
          channel: IpcEventChannel.segmentsChanged,
          payload: { fromMs: base, toMs: base + 180_000 }
        }
      ])
    })
  })

  it('reports segments that still need review', async () => {
    await withHandlers(async ({ invoke, database, bucketId }) => {
      const writing = bucketId('Writing')
      const base = 1_700_000_000_000
      const repository = createSegmentsRepository(database)

      const confirmed = repository.create({
        bucketId: writing,
        startedAt: base,
        endedAt: base + 60_000,
        confirmedThrough: base + 60_000
      })
      const presumed = repository.create({
        bucketId: writing,
        startedAt: base + 60_000,
        endedAt: base + 120_000,
        confirmedThrough: base + 60_000
      })

      const review = unwrap(
        await invoke(IpcInvokeChannel.segmentsNeedsReview, base, base + 120_000)
      )
      expect(review.map((segment) => segment.id)).toEqual([presumed.id])
      expect(review.map((segment) => segment.id)).not.toContain(confirmed.id)
    })
  })

  it('does not emit for read-only channels', async () => {
    await withHandlers(async ({ invoke, emitted }) => {
      unwrap(await invoke(IpcInvokeChannel.segmentsRange, 0, 1_000))
      unwrap(await invoke(IpcInvokeChannel.segmentsNeedsReview, 0, 1_000))

      expect(emitted).toEqual([])
    })
  })

  it('returns clear Result.error values for bad arguments and repository rejections', async () => {
    await withHandlers(async ({ invoke, bucketId }) => {
      expect(await invoke(IpcInvokeChannel.segmentsRange, 'x' as never, 10)).toEqual({
        ok: false,
        error: 'fromMs must be an integer.'
      })

      expect(await invoke(IpcInvokeChannel.segmentsCreate, 1, 0, 1.5)).toEqual({
        ok: false,
        error: 'end must be an integer.'
      })

      expect(await invoke(IpcInvokeChannel.segmentsUpdate, 1, {})).toEqual({
        ok: false,
        error: 'patch must include at least one supported field.'
      })

      expect(await invoke(IpcInvokeChannel.segmentsUpdate, 1, { origin: 'edit' } as never)).toEqual(
        { ok: false, error: 'patch contains unsupported field(s): origin.' }
      )

      expect(await invoke(IpcInvokeChannel.segmentsSplit, 1, 'x' as never)).toEqual({
        ok: false,
        error: 'atMs must be an integer.'
      })

      expect(await invoke(IpcInvokeChannel.segmentsMerge, 1, 'x' as never)).toEqual({
        ok: false,
        error: 'idB must be an integer.'
      })

      expect(await invoke(IpcInvokeChannel.segmentsDelete, 1.5 as never)).toEqual({
        ok: false,
        error: 'id must be an integer.'
      })

      // Repository-level rejections surface as `Result.error`, never as a throw
      // across the process boundary (§11).
      const writing = bucketId('Writing')
      expect(await invoke(IpcInvokeChannel.segmentsCreate, writing, 1_000, 1_000)).toEqual({
        ok: false,
        error: 'Segments must satisfy started_at < ended_at.'
      })
      expect(await invoke(IpcInvokeChannel.segmentsDelete, 4_242)).toEqual({
        ok: false,
        error: 'Segment 4242 was not found.'
      })
    })
  })
})
