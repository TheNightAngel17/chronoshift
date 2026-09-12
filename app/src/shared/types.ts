// Shared domain types for ChronoShift.
//
// This file must be importable from both the main process and the renderer:
// no Node APIs (fs, path, electron, ...) and no DOM APIs. See BUILD_PLAN §11.
//
// Field names are camelCase; the sqlite columns they mirror (BUILD_PLAN §6)
// are snake_case. Repositories are responsible for that translation.

/** Discriminated result returned by every IPC invoke handler (BUILD_PLAN §11). */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/** `buckets.kind` — a plain trackable bucket, or the reserved break bucket (§5.3). */
export type BucketKind = 'work' | 'break'

/** `buckets.source` — provenance column reserved for a future Workday sync (§5.4). */
export type BucketSource = 'local' | 'workday'

/** A node in the bucket tree, up to 4 levels deep (`depth` 0-3). See §5.4, §6. */
export interface Bucket {
  id: number
  parentId: number | null
  name: string
  depth: number
  sortOrder: number
  /** Nullable — when null, effective color is inherited (§5.4). */
  color: string | null
  kind: BucketKind
  isSystem: boolean
  isArchived: boolean
  source: BucketSource
  externalId: string | null
  externalType: string | null
  createdAt: number
  updatedAt: number
}

/** A `Bucket` with its children attached, as returned by `buckets:tree` (§11). */
export interface BucketNode extends Bucket {
  children: BucketNode[]
}

/** `segments.origin` — how a segment came to exist (§6). */
export type SegmentOrigin = 'manual' | 'checkin' | 'idle_resolution' | 'recovery' | 'edit' | 'split'

/**
 * A contiguous stretch of time attributed to exactly one bucket (§5.1).
 *
 * `endedAt` is `null` for the single open segment. `confirmedThrough` is the
 * confirmation watermark (§5.2): `null` or equal to `startedAt` means fully
 * presumed, `>= endedAt` (or `>= now` while open) means fully confirmed.
 */
export interface Segment {
  id: number
  bucketId: number
  startedAt: number
  endedAt: number | null
  confirmedThrough: number | null
  origin: SegmentOrigin
  note: string | null
  createdAt: number
  updatedAt: number
}

/**
 * Current tracking status, as returned by `tracking:state` and pushed via the
 * `tracking:changed` event (§11). Not tracking is represented by both fields
 * being `null`.
 */
export interface TrackingState {
  segment: Segment | null
  bucket: Bucket | null
}

/** `theme` setting values (§7). */
export type Theme = 'system' | 'light' | 'dark'

/** Application settings, one field per key in BUILD_PLAN §7. */
export interface Settings {
  checkinIntervalMinutes: number
  idleThresholdMinutes: number
  snoozeMinutes: number
  autoStopAfterHours: number
  /** 0 = Sunday … 6 = Saturday. */
  weekStartDay: number
  gridStartHour: number
  gridEndHour: number
  gridSnapMinutes: number
  promptStealFocus: boolean
  promptSound: boolean
  autostartEnabled: boolean
  autostartBeginTracking: boolean
  theme: Theme
}

/** `idle_events.cause` — how an idle event was detected (§8.4). */
export type IdleCause = 'inactivity' | 'lock' | 'suspend' | 'app_gone'

/** `idle_events.resolution` — how an idle event was resolved (§9.3). */
export type IdleResolution = 'kept' | 'break' | 'reassigned' | 'split' | 'unresolved'

/** A period of detected inactivity, resolved via `IdlePrompt` (§8.4, §9.3). */
export interface IdleEvent {
  id: number
  startedAt: number
  endedAt: number
  cause: IdleCause
  resolution: IdleResolution | null
  resolvedAt: number | null
  createdAt: number
}

/** `checkins.response` — the outcome of a single check-in prompt (§6, §9.2). */
export type CheckinResponse =
  'same' | 'switched' | 'stopped' | 'break' | 'snoozed' | 'dismissed' | 'timeout'

/** A logged check-in prompt and its eventual response, if any (§6). */
export interface CheckinRecord {
  id: number
  segmentId: number | null
  promptedAt: number
  respondedAt: number | null
  response: CheckinResponse | null
  createdAt: number
}

/** The choice offered by `RecoveryPrompt` on a crash/sleep recovery (§9.4). */
export type RecoveryChoice =
  'end_at_confirmed' | 'end_at_last_seen' | 'end_at_custom' | 'keep_running'

/**
 * Information surfaced by `recovery:pending` describing an open segment left
 * behind by an unclean shutdown, to be resolved via `RecoveryPrompt` (§8.5, §9.4).
 */
export interface RecoveryInfo {
  segment: Segment
  bucket: Bucket
  /** `app_state.last_seen_at` at the time recovery ran. */
  lastSeenAt: number
  /** The `idle_events` row created for the `app_gone` gap. */
  idleEventId: number
}
