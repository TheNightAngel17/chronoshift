import { describe, expect, it } from 'vitest'
import { clampBackdate } from './clamp'

describe('clampBackdate', () => {
  const now = new Date('2024-06-15T12:00:00.000Z').getTime()
  const currentSegmentStartedAt = new Date('2024-06-15T09:00:00.000Z').getTime()
  const previousSegmentEndedAt = new Date('2024-06-15T08:00:00.000Z').getTime()

  it('leaves an in-range value untouched', () => {
    const value = new Date('2024-06-15T10:00:00.000Z').getTime()

    const result = clampBackdate(value, now, currentSegmentStartedAt, previousSegmentEndedAt)

    expect(result).toEqual({ value, wasAdjusted: false })
  })

  it('clamps a future value to now (step 1)', () => {
    const future = now + 60_000

    const result = clampBackdate(future, now, currentSegmentStartedAt, previousSegmentEndedAt)

    expect(result).toEqual({ value: now, wasAdjusted: true })
  })

  it('floors a value before the previous segment’s endedAt (step 2, previous-segment side)', () => {
    const beforePrevious = previousSegmentEndedAt - 60_000

    const result = clampBackdate(
      beforePrevious,
      now,
      currentSegmentStartedAt,
      previousSegmentEndedAt
    )

    expect(result).toEqual({ value: currentSegmentStartedAt, wasAdjusted: true })
  })

  it('floors a value before the current segment’s startedAt (step 2, current-segment side)', () => {
    // No previous segment here, so the floor is currentSegmentStartedAt alone;
    // pick a value before startedAt but after any previous-segment floor would
    // matter by using a currentSegmentStartedAt that is the larger of the two.
    const laterStart = new Date('2024-06-15T09:30:00.000Z').getTime() // after previousSegmentEndedAt
    const beforeStart = laterStart - 60_000

    const result = clampBackdate(beforeStart, now, laterStart, previousSegmentEndedAt)

    expect(result).toEqual({ value: laterStart, wasAdjusted: true })
  })

  it('treats a missing previous segment as no floor from that side (first segment ever)', () => {
    const beforeStart = currentSegmentStartedAt - 60_000

    const result = clampBackdate(beforeStart, now, currentSegmentStartedAt, null)

    expect(result).toEqual({ value: currentSegmentStartedAt, wasAdjusted: true })
  })

  it('snaps to now when step 2’s floor lands exactly on now (compounding zero-length case)', () => {
    // previousSegmentEndedAt happens to equal now, so flooring produces
    // exactly `now` — step 3 must still catch this even though it isn't
    // strictly greater than now.
    const value = new Date('2024-06-15T10:00:00.000Z').getTime()

    const result = clampBackdate(value, now, currentSegmentStartedAt, now)

    expect(result).toEqual({ value: now, wasAdjusted: true })
  })

  it('snaps to now when step 2’s floor lands past now (compounding past-now case)', () => {
    // previousSegmentEndedAt is after now (e.g. a backward clock change),
    // pushing the floor itself past now — step 3's `>= now` check (not just
    // `> now`) must still normalize this.
    const pastNow = now + 5 * 60_000
    const value = new Date('2024-06-15T10:00:00.000Z').getTime()

    const result = clampBackdate(value, now, currentSegmentStartedAt, pastNow)

    expect(result).toEqual({ value: now, wasAdjusted: true })
  })
})
