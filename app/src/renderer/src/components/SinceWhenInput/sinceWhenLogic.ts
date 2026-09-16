// Pure formatting/parsing behind the "since when" backdating control (BUILD_PLAN §5.6).
// The clamping rule itself lives in `shared/clamp.ts`; this file only converts
// between an epoch-ms value and what the `datetime-local` input and the
// adjustment note actually display.

/** `datetime-local` inputs take/emit `YYYY-MM-DDTHH:mm` in the browser's local time. */
export function toDatetimeLocalValue(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => value.toString().padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

/** `null` for a value the browser hasn't finished parsing yet (e.g. mid-edit). */
export function fromDatetimeLocalValue(value: string): number | null {
  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime()
}

/** `2:35 PM` — how the adjustment note displays the clamped time. */
export function formatClockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}
