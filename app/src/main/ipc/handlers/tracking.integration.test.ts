import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { IpcEventChannel, IpcInvokeChannel, type IpcInvokeMap } from '../../../shared/ipc-contract'
import type { Segment } from '../../../shared/types'
import { openDatabase } from '../../db/connection'
import { runMigrations } from '../../db/migrations'
import { BucketsRepository } from '../../db/repositories/buckets'
import { createSegmentsRepository } from '../../db/repositories/segments'
import { registerTrackingIpcHandlers } from './tracking'
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
  const tempDirectory = mkdtempSync(join(tmpdir(), 'chronoshift-ipc-tracking-'))
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

    registerTrackingIpcHandlers(
      registrar,
      database,
      emit,
      createSegmentsRepository(database),
      new BucketsRepository(database)
    )

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

function allSegments(database: Database.Database): Segment[] {
  return createSegmentsRepository(database).range(0, Number.MAX_SAFE_INTEGER)
}

/** Waits for the wall clock to actually move, since these handlers read `Date.now()`. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2))
}

function unwrap<T>(result: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!result.ok) {
    throw new Error(`Expected an ok Result, got: ${result.error}`)
  }

  return result.data
}

describe('tracking IPC handlers', () => {
  it('reports not tracking on an empty database', async () => {
    await withHandlers(async ({ invoke, emitted }) => {
      const state = await invoke(IpcInvokeChannel.trackingState)

      expect(state).toEqual({ ok: true, data: { segment: null, bucket: null } })
      expect(emitted).toEqual([])
    })
  })

  it('starts, confirms, switches and stops end to end against the repository', async () => {
    await withHandlers(async ({ invoke, database, emitted, bucketId }) => {
      const writing = bucketId('Writing')
      const reviewing = bucketId('Reviewing')
      const startedAt = Date.now() - 60_000

      const started = unwrap(await invoke(IpcInvokeChannel.trackingStart, writing, startedAt))
      expect(started.segment?.bucketId).toBe(writing)
      expect(started.segment?.startedAt).toBe(startedAt)
      expect(started.segment?.endedAt).toBeNull()
      expect(started.bucket?.id).toBe(writing)
      expect(emitted.at(-1)).toEqual({
        channel: IpcEventChannel.trackingChanged,
        payload: started
      })

      // `tracking:state` reconstructs the same machine from the database alone.
      const reread = unwrap(await invoke(IpcInvokeChannel.trackingState))
      expect(reread.segment?.id).toBe(started.segment?.id)

      // Confirming moves the §5.2 watermark forward without closing anything.
      const confirmAt = Date.now()
      const confirmed = unwrap(await invoke(IpcInvokeChannel.trackingConfirm, confirmAt))
      expect(confirmed.segment?.id).toBe(started.segment?.id)
      expect(confirmed.segment?.confirmedThrough).toBe(confirmAt)
      expect(confirmed.segment?.endedAt).toBeNull()

      const switched = unwrap(await invoke(IpcInvokeChannel.trackingSwitch, reviewing))
      expect(switched.segment?.bucketId).toBe(reviewing)
      expect(switched.bucket?.id).toBe(reviewing)
      expect(emitted.at(-1)).toEqual({
        channel: IpcEventChannel.trackingChanged,
        payload: switched
      })

      // Let the clock advance so the stop is not zero-length against the switch
      // instant (§5.1.4 would legitimately discard the row in that case).
      await tick()

      const stopped = unwrap(await invoke(IpcInvokeChannel.trackingStop))
      expect(stopped).toEqual({ segment: null, bucket: null })

      const timeline = allSegments(database)
      expect(timeline.map((segment) => segment.bucketId)).toEqual([writing, reviewing])
      expect(timeline.every((segment) => segment.endedAt !== null)).toBe(true)
    })
  })

  it('keeps the §5.1 invariants across a switch: the old segment closes before the new one opens', async () => {
    await withHandlers(async ({ invoke, database, bucketId }) => {
      const first = bucketId('First')
      const second = bucketId('Second')
      const start = Date.now() - 60_000

      unwrap(await invoke(IpcInvokeChannel.trackingStart, first, start))
      const switchAt = Date.now() - 30_000
      unwrap(await invoke(IpcInvokeChannel.trackingSwitch, second, switchAt))

      const timeline = allSegments(database)
      expect(timeline).toHaveLength(2)

      const [outgoing, incoming] = timeline
      expect(outgoing.bucketId).toBe(first)
      expect(outgoing.endedAt).toBe(switchAt)
      expect(incoming.bucketId).toBe(second)
      expect(incoming.startedAt).toBe(switchAt)
      // Meeting exactly, never overlapping, and exactly one segment still open.
      expect(outgoing.endedAt).toBe(incoming.startedAt)
      expect(timeline.filter((segment) => segment.endedAt === null)).toHaveLength(1)
    })
  })

  it('backdates a start no further than the previous segment, and discards a zero-length close', async () => {
    await withHandlers(async ({ invoke, database, bucketId }) => {
      const first = bucketId('First')
      const second = bucketId('Second')
      const start = Date.now() - 60_000

      unwrap(await invoke(IpcInvokeChannel.trackingStart, first, start))
      unwrap(await invoke(IpcInvokeChannel.trackingStop, Date.now() - 30_000))

      // A start backdated behind the previous segment's end is floored to it (§5.6).
      const restarted = unwrap(await invoke(IpcInvokeChannel.trackingStart, second, start))
      expect(restarted.segment?.startedAt).toBe(allSegments(database)[0].endedAt)

      // Stopping at the segment's own start would be zero-length (§5.1.4), so
      // the row is discarded rather than written.
      unwrap(await invoke(IpcInvokeChannel.trackingStop, restarted.segment?.startedAt))
      expect(allSegments(database)).toHaveLength(1)
    })
  })

  it('treats snooze as a no-op that emits nothing', async () => {
    await withHandlers(async ({ invoke, database, emitted, bucketId }) => {
      unwrap(await invoke(IpcInvokeChannel.trackingStart, bucketId('Writing')))
      const before = allSegments(database)
      emitted.length = 0

      const snoozed = await invoke(IpcInvokeChannel.trackingSnooze, 5)
      expect(snoozed).toEqual({ ok: true, data: undefined })
      expect(emitted).toEqual([])
      expect(allSegments(database)).toEqual(before)
    })
  })

  it('does not emit when a transition changes nothing', async () => {
    await withHandlers(async ({ invoke, emitted, bucketId }) => {
      // Starting while already tracking is not applicable (`canApply`), so the
      // reducer returns no writes and nobody needs telling.
      unwrap(await invoke(IpcInvokeChannel.trackingStart, bucketId('Writing')))
      emitted.length = 0

      unwrap(await invoke(IpcInvokeChannel.trackingStart, bucketId('Other')))
      expect(emitted).toEqual([])

      // Stopping while not tracking is likewise a no-op.
      unwrap(await invoke(IpcInvokeChannel.trackingStop))
      emitted.length = 0
      unwrap(await invoke(IpcInvokeChannel.trackingStop))
      expect(emitted).toEqual([])
    })
  })

  it('returns clear Result.error values for bad arguments', async () => {
    await withHandlers(async ({ invoke }) => {
      const badState = await (invoke as (...args: unknown[]) => Promise<unknown>)(
        IpcInvokeChannel.trackingState,
        'unexpected'
      )
      expect(badState).toEqual({ ok: false, error: 'This channel does not accept arguments.' })

      expect(await invoke(IpcInvokeChannel.trackingStart, 'x' as never)).toEqual({
        ok: false,
        error: 'bucketId must be an integer.'
      })

      expect(await invoke(IpcInvokeChannel.trackingSwitch, 1, 1.5)).toEqual({
        ok: false,
        error: 'since must be an integer.'
      })

      expect(await invoke(IpcInvokeChannel.trackingStop, 'now' as never)).toEqual({
        ok: false,
        error: 'since must be an integer.'
      })

      expect(await invoke(IpcInvokeChannel.trackingConfirm, 'now' as never)).toEqual({
        ok: false,
        error: 'at must be an integer.'
      })

      expect(await invoke(IpcInvokeChannel.trackingSnooze, 0)).toEqual({
        ok: false,
        error: 'minutes must be an integer greater than 0.'
      })
    })
  })
})
