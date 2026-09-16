import { useEffect, useMemo, useState } from 'react'
import { clampBackdate } from '../../../../shared/clamp'
import styles from './SinceWhenInput.module.css'

const QUICK_MINUTES = [5, 10, 15, 30]

/** `datetime-local` inputs take/emit `YYYY-MM-DDTHH:mm` in the browser's local time. */
function toDatetimeLocalValue(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => value.toString().padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

/** `null` for a value the browser hasn't finished parsing yet (e.g. mid-edit). */
function fromDatetimeLocalValue(value: string): number | null {
  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime()
}

function formatClockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export interface SinceWhenInputProps {
  /** The segment being backdated into's `startedAt`, epoch ms — the §5.6 floor. */
  currentSegmentStartedAt: number
  /** The prior segment's `endedAt`, epoch ms, or `null` if there is none. */
  previousSegmentEndedAt: number | null
  /** Called with the clamped value — what will actually be used — whenever it changes. */
  onChange: (value: number) => void
}

/**
 * "Since when" backdating control (BUILD_PLAN §5.6): quick relative buttons,
 * an absolute entry field, defaulting to now. The candidate value is always
 * run through the same {@link clampBackdate} pipeline the main process
 * enforces authoritatively, so the note here is advisory feedback only — it
 * never lets an out-of-range value reach `onChange`.
 */
function SinceWhenInput({
  currentSegmentStartedAt,
  previousSegmentEndedAt,
  onChange
}: SinceWhenInputProps): React.JSX.Element {
  // `asOf` is the wall-clock time as of the last edit, captured in the event
  // handler that made it rather than read during render (§5.6 wants clamping
  // compared against live `now`, but React render must stay pure — see
  // `services/tracking.ts`, which takes the same approach for the same reason).
  const [candidate, setCandidate] = useState(() => Date.now())
  const [asOf, setAsOf] = useState(() => Date.now())

  const clamped = useMemo(
    () => clampBackdate(candidate, asOf, currentSegmentStartedAt, previousSegmentEndedAt),
    [candidate, asOf, currentSegmentStartedAt, previousSegmentEndedAt]
  )

  // Notifies the caller of the value that will actually be used — clamping
  // is enforced again, authoritatively, wherever this value is eventually
  // submitted, so this is a live preview of that outcome, not a substitute.
  useEffect(() => {
    onChange(clamped.value)
  }, [clamped.value, onChange])

  return (
    <div className={styles.container}>
      <div className={styles.quickButtons}>
        {QUICK_MINUTES.map((minutes) => (
          <button
            key={minutes}
            className={styles.quickButton}
            type="button"
            onClick={() => {
              const now = Date.now()
              setCandidate(now - minutes * 60_000)
              setAsOf(now)
            }}
          >
            {minutes} min ago
          </button>
        ))}
      </div>

      <label className={styles.field}>
        <span className={styles.visuallyHidden}>Since when</span>
        <input
          className={styles.input}
          type="datetime-local"
          value={toDatetimeLocalValue(candidate)}
          onChange={(event) => {
            const parsed = fromDatetimeLocalValue(event.target.value)

            if (parsed !== null) {
              setCandidate(parsed)
              setAsOf(Date.now())
            }
          }}
        />
      </label>

      {clamped.wasAdjusted && (
        <p className={styles.note} role="status">
          Adjusted to {formatClockTime(clamped.value)}.
        </p>
      )}
    </div>
  )
}

export default SinceWhenInput
