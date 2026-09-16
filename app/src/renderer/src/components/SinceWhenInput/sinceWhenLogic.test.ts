import { describe, expect, it } from 'vitest'
import { formatClockTime, fromDatetimeLocalValue, toDatetimeLocalValue } from './sinceWhenLogic'

describe('toDatetimeLocalValue', () => {
  it('formats an epoch-ms value as local YYYY-MM-DDTHH:mm', () => {
    const date = new Date(2026, 2, 5, 9, 7, 30) // 2026-03-05 09:07:30 local

    expect(toDatetimeLocalValue(date.getTime())).toBe('2026-03-05T09:07')
  })

  it('pads single-digit month, day, hour, and minute', () => {
    const date = new Date(2026, 0, 1, 0, 5, 0) // 2026-01-01 00:05 local

    expect(toDatetimeLocalValue(date.getTime())).toBe('2026-01-01T00:05')
  })
})

describe('fromDatetimeLocalValue', () => {
  it('round-trips a value produced by toDatetimeLocalValue', () => {
    const date = new Date(2026, 5, 15, 14, 30, 0)
    const formatted = toDatetimeLocalValue(date.getTime())

    expect(fromDatetimeLocalValue(formatted)).toBe(date.getTime())
  })

  it('is null for a value the browser has not finished parsing yet', () => {
    expect(fromDatetimeLocalValue('')).toBeNull()
    expect(fromDatetimeLocalValue('2026-03-05T')).toBeNull()
  })
})

describe('formatClockTime', () => {
  it('formats a time without seconds', () => {
    const date = new Date(2026, 2, 5, 14, 5, 0)

    expect(formatClockTime(date.getTime())).not.toMatch(/:\d{2}:\d{2}/)
    expect(formatClockTime(date.getTime())).toMatch(/2:05/)
  })
})
