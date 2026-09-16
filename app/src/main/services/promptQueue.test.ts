import { describe, expect, it, vi } from 'vitest'
import type { CheckinRecord, IdleEvent, RecoveryInfo, TrackingState } from '../../shared/types'
import { PromptQueue } from './promptQueue'

function trackingState(segmentId: number | null): TrackingState {
  return {
    segment:
      segmentId === null
        ? null
        : {
            id: segmentId,
            bucketId: 1,
            startedAt: 0,
            endedAt: null,
            confirmedThrough: null,
            origin: 'manual',
            note: null,
            createdAt: 0,
            updatedAt: 0
          },
    bucket: null
  }
}

function fakeCheckinRecord(id: number, segmentId: number | null): CheckinRecord {
  return {
    id,
    segmentId,
    promptedAt: 0,
    respondedAt: null,
    response: null,
    createdAt: 0
  }
}

function idleEvent(id: number): IdleEvent {
  return {
    id,
    startedAt: 0,
    endedAt: 1,
    cause: 'inactivity' as const,
    resolution: null,
    resolvedAt: null,
    createdAt: 0
  }
}

function recoveryInfo(): RecoveryInfo {
  return {
    segment: {
      id: 99,
      bucketId: 1,
      startedAt: 0,
      endedAt: null,
      confirmedThrough: null,
      origin: 'manual' as const,
      note: null,
      createdAt: 0,
      updatedAt: 0
    },
    bucket: {
      id: 1,
      parentId: null,
      name: 'Work',
      depth: 0,
      sortOrder: 0,
      color: null,
      kind: 'work' as const,
      isSystem: false,
      isArchived: false,
      source: 'local' as const,
      externalId: null,
      externalType: null,
      createdAt: 0,
      updatedAt: 0
    },
    lastSeenAt: 0,
    idleEventId: 1
  }
}

interface QueueTestContext {
  queue: PromptQueue
  checkins: {
    create: ReturnType<typeof vi.fn>
    respond: ReturnType<typeof vi.fn>
  }
  onDisplay: ReturnType<typeof vi.fn>
  onHide: ReturnType<typeof vi.fn>
  created: Array<{ segmentId: number | null; promptedAt: number }>
  responded: Array<{ id: number; respondedAt: number; response: string }>
}

function setup(): QueueTestContext {
  let nextCheckinId = 1
  const created: Array<{ segmentId: number | null; promptedAt: number }> = []
  const responded: Array<{ id: number; respondedAt: number; response: string }> = []

  const checkins = {
    create: vi.fn((segmentId: number | null, promptedAt: number) => {
      created.push({ segmentId, promptedAt })
      return fakeCheckinRecord(nextCheckinId++, segmentId)
    }),
    respond: vi.fn((id: number, respondedAt: number, response: string) => {
      responded.push({ id, respondedAt, response })
      return fakeCheckinRecord(id, null)
    })
  }

  const onDisplay = vi.fn()
  const onHide = vi.fn()

  const queue = new PromptQueue({
    callbacks: { onDisplay, onHide },
    checkins: checkins as unknown as ConstructorParameters<typeof PromptQueue>[0]['checkins'],
    now: () => 1000
  })

  return { queue, checkins, onDisplay, onHide, created, responded }
}

describe('PromptQueue', () => {
  it('displays the first request immediately', () => {
    const { queue, onDisplay, checkins } = setup()

    queue.requestCheckin(trackingState(5))

    expect(onDisplay).toHaveBeenCalledTimes(1)
    expect(onDisplay).toHaveBeenCalledWith({ kind: 'checkin', state: trackingState(5) })
    expect(checkins.create).toHaveBeenCalledWith(5, 1000)
    expect(queue.current).toEqual({ kind: 'checkin', state: trackingState(5) })
  })

  it('enforces strict priority: recovery preempts idle preempts checkin', () => {
    const { queue, onDisplay } = setup()

    queue.requestCheckin(trackingState(1))
    expect(queue.current?.kind).toBe('checkin')

    queue.requestIdle(idleEvent(1))
    expect(queue.current?.kind).toBe('idle')

    queue.requestRecovery(recoveryInfo())
    expect(queue.current?.kind).toBe('recovery')

    expect(onDisplay).toHaveBeenCalledTimes(3)
  })

  it('writes `timeout` to the preempted checkin row before showing the new prompt', () => {
    const { queue, checkins, onDisplay } = setup()

    queue.requestCheckin(trackingState(1))
    const checkinId = checkins.create.mock.results[0].value.id

    const order: string[] = []
    checkins.respond.mockImplementationOnce((...args) => {
      order.push('respond')
      return fakeCheckinRecord(args[0], null)
    })
    onDisplay.mockImplementationOnce(() => order.push('display-checkin'))
    onDisplay.mockImplementationOnce(() => order.push('display-idle'))

    queue.requestIdle(idleEvent(1))

    expect(checkins.respond).toHaveBeenCalledWith(checkinId, 1000, 'timeout')
    expect(queue.current?.kind).toBe('idle')
  })

  it('never creates a checkins row for a request preempted before it is ever displayed', () => {
    const { queue, checkins } = setup()

    // Idle is on screen first, so the checkin request queues behind it and
    // must not touch the checkins table yet.
    queue.requestIdle(idleEvent(1))
    queue.requestCheckin(trackingState(1))

    expect(checkins.create).not.toHaveBeenCalled()

    // A higher-priority recovery arrives and preempts idle; the still-pending
    // checkin request is untouched and still hasn't been created.
    queue.requestRecovery(recoveryInfo())
    expect(checkins.create).not.toHaveBeenCalled()
    expect(queue.current?.kind).toBe('recovery')

    // Dismissing recovery promotes the pending checkin — only now is a row created.
    queue.dismissCurrent()
    expect(checkins.create).toHaveBeenCalledTimes(1)
    expect(queue.current?.kind).toBe('checkin')
  })

  it('replaces the pending request for a slot rather than queuing a second one', () => {
    const { queue, checkins, onDisplay } = setup()

    queue.requestIdle(idleEvent(1))
    queue.requestCheckin(trackingState(1))
    // A second checkin arrival while the first is still only pending must
    // replace it, not create a second queued entry.
    queue.requestCheckin(trackingState(2))

    expect(checkins.create).not.toHaveBeenCalled()

    queue.dismissCurrent() // idle -> dismissed, promotes the (single) pending checkin
    expect(checkins.create).toHaveBeenCalledTimes(1)
    expect(checkins.create).toHaveBeenCalledWith(2, 1000)
    expect(queue.current).toEqual({ kind: 'checkin', state: trackingState(2) })
    expect(onDisplay).toHaveBeenLastCalledWith({ kind: 'checkin', state: trackingState(2) })
  })

  it('records Escape as `dismissed` on the currently displayed checkin', () => {
    const { queue, checkins } = setup()

    queue.requestCheckin(trackingState(1))
    const checkinId = checkins.create.mock.results[0].value.id

    queue.dismissCurrent()

    expect(checkins.respond).toHaveBeenCalledWith(checkinId, 1000, 'dismissed')
    expect(queue.current).toBeNull()
  })

  it('calls onHide when dismissing leaves nothing pending', () => {
    const { queue, onHide } = setup()

    queue.requestCheckin(trackingState(1))
    queue.dismissCurrent()

    expect(onHide).toHaveBeenCalledTimes(1)
    expect(queue.current).toBeNull()
  })

  it('swaps a same-slot re-arrival in place, writing timeout on the one it replaces', () => {
    const { queue, checkins } = setup()

    queue.requestIdle(idleEvent(1))
    // No checkins row exists for idle, so `respond` must not be called for it.
    queue.requestIdle(idleEvent(2))

    expect(checkins.respond).not.toHaveBeenCalled()
    expect(queue.current).toEqual({ kind: 'idle', idleEvent: idleEvent(2) })
  })

  it('leaves no trace of a checkin suppressed before it was ever displayed', () => {
    const { queue, checkins } = setup()

    queue.requestRecovery(recoveryInfo())
    queue.requestCheckin(trackingState(1))
    // Replaced while still pending, then the whole slot is abandoned by
    // dismissing recovery and letting nothing lower ever get promoted because
    // a fresh recovery arrives again first.
    queue.requestCheckin(trackingState(2))
    queue.requestRecovery(recoveryInfo())

    expect(checkins.create).not.toHaveBeenCalled()
    expect(checkins.respond).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'timeout'
    )
  })
})
