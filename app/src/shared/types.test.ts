import { describe, expect, it } from 'vitest'
import type { Bucket, BucketNode, Result, Segment, Settings, TrackingState } from './types'

function okResult<T>(data: T): Result<T> {
  return { ok: true, data }
}

function errResult<T>(error: string): Result<T> {
  return { ok: false, error }
}

describe('Result<T>', () => {
  it('discriminates on ok', () => {
    const success = okResult(42)
    const failure = errResult<number>('boom')

    expect(success.ok).toBe(true)
    expect(failure.ok).toBe(false)
    if (success.ok) {
      expect(success.data).toBe(42)
    }
    if (!failure.ok) {
      expect(failure.error).toBe('boom')
    }
  })
})

describe('domain shapes', () => {
  it('accepts a well-formed Bucket / BucketNode', () => {
    const bucket: Bucket = {
      id: 1,
      parentId: null,
      name: 'Break / Away',
      depth: 0,
      sortOrder: 0,
      color: null,
      kind: 'break',
      isSystem: true,
      isArchived: false,
      source: 'local',
      externalId: null,
      externalType: null,
      createdAt: 0,
      updatedAt: 0
    }
    const node: BucketNode = { ...bucket, children: [] }

    expect(node.children).toEqual([])
    expect(bucket.kind).toBe('break')
  })

  it('accepts a well-formed Segment and TrackingState', () => {
    const segment: Segment = {
      id: 1,
      bucketId: 1,
      startedAt: 1000,
      endedAt: null,
      confirmedThrough: 1000,
      origin: 'manual',
      note: null,
      createdAt: 1000,
      updatedAt: 1000
    }
    const notTracking: TrackingState = { segment: null, bucket: null }
    const tracking: TrackingState = { segment, bucket: null }

    expect(notTracking.segment).toBeNull()
    expect(tracking.segment).toBe(segment)
  })

  it('accepts a well-formed Settings object', () => {
    const settings: Settings = {
      checkinIntervalMinutes: 15,
      idleThresholdMinutes: 5,
      snoozeMinutes: 5,
      autoStopAfterHours: 12,
      weekStartDay: 1,
      gridStartHour: 6,
      gridEndHour: 20,
      gridSnapMinutes: 5,
      promptStealFocus: true,
      promptSound: false,
      autostartEnabled: true,
      autostartBeginTracking: false,
      theme: 'system'
    }

    expect(settings.theme).toBe('system')
  })
})
