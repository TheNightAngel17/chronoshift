import { format } from 'date-fns'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { endOfDayMs, endOfWeekMs, startOfDayMs, startOfWeekMs } from './time'

describe('day boundary helpers', () => {
  const originalTz = process.env.TZ

  beforeAll(() => {
    process.env.TZ = 'America/New_York'
  })

  afterAll(() => {
    process.env.TZ = originalTz
  })

  it('returns local midnight as the start of day', () => {
    const noon = new Date('2024-06-15T16:00:00.000Z').getTime() // 2024-06-15 12:00 EDT
    expect(format(startOfDayMs(noon), 'yyyy-MM-dd HH:mm:ss.SSS')).toBe('2024-06-15 00:00:00.000')
  })

  it('returns the last local millisecond as the end of day', () => {
    const noon = new Date('2024-06-15T16:00:00.000Z').getTime()
    expect(format(endOfDayMs(noon), 'yyyy-MM-dd HH:mm:ss.SSS')).toBe('2024-06-15 23:59:59.999')
  })
})

describe('week boundary helpers', () => {
  const originalTz = process.env.TZ

  beforeAll(() => {
    process.env.TZ = 'America/New_York'
  })

  afterAll(() => {
    process.env.TZ = originalTz
  })

  it('honors a configurable week_start_day', () => {
    // 2024-06-12 is a Wednesday.
    const wednesday = new Date('2024-06-12T16:00:00.000Z').getTime()

    // week_start_day = 0 (Sunday)
    expect(format(startOfWeekMs(wednesday, 0), 'yyyy-MM-dd EEEE')).toBe('2024-06-09 Sunday')
    expect(format(endOfWeekMs(wednesday, 0), 'yyyy-MM-dd EEEE HH:mm:ss.SSS')).toBe(
      '2024-06-15 Saturday 23:59:59.999'
    )

    // week_start_day = 1 (Monday), the app's default
    expect(format(startOfWeekMs(wednesday, 1), 'yyyy-MM-dd EEEE')).toBe('2024-06-10 Monday')
    expect(format(endOfWeekMs(wednesday, 1), 'yyyy-MM-dd EEEE HH:mm:ss.SSS')).toBe(
      '2024-06-16 Sunday 23:59:59.999'
    )
  })

  it('produces correct local boundaries for a week that crosses a DST transition', () => {
    // America/New_York springs forward on 2024-03-10 (02:00 -> 03:00 EST -> EDT),
    // inside the Sunday-Saturday week containing 2024-03-12.
    const tuesday = new Date('2024-03-12T16:00:00.000Z').getTime() // 12:00 EDT

    const weekStart = startOfWeekMs(tuesday, 0)
    const weekEnd = endOfWeekMs(tuesday, 0)

    // No hand-rolled DST arithmetic here — date-fns/Date resolve these purely
    // from the local calendar, so the boundaries land on local midnight and
    // 23:59:59.999 despite the transition in between.
    expect(format(weekStart, 'yyyy-MM-dd HH:mm:ss.SSS xxx')).toBe('2024-03-10 00:00:00.000 -05:00')
    expect(format(weekEnd, 'yyyy-MM-dd HH:mm:ss.SSS xxx')).toBe('2024-03-16 23:59:59.999 -04:00')

    // The wall-clock week is a full 7 * 24h, but because a DST hour was
    // skipped, the elapsed epoch-ms duration is one hour short of that.
    const elapsedMs = weekEnd - weekStart + 1
    expect(elapsedMs).toBe(7 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000)
  })
})
