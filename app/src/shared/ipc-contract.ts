// Shared IPC contract for ChronoShift (BUILD_PLAN §11).
//
// Channel names and payload types are defined exactly once, here, and
// imported on both the main and preload/renderer sides so that a rename
// breaks the build rather than failing silently at runtime.
//
// This file must be importable from both the main process and the renderer:
// no Node APIs (fs, path, electron, ...) and no DOM APIs.

import type {
  Bucket,
  BucketNode,
  IdleEvent,
  IdleResolution,
  RecoveryChoice,
  RecoveryInfo,
  Result,
  Segment,
  Settings,
  TrackingState
} from './types'
import type { MainTabId } from './tabs'

/** Fields that may be changed on an existing bucket via `buckets:update`. */
export type BucketPatch = Partial<Pick<Bucket, 'name' | 'color'>>

/** Fields that may be changed on an existing segment via `segments:update`. */
export type SegmentPatch = Partial<
  Pick<Segment, 'bucketId' | 'startedAt' | 'endedAt' | 'confirmedThrough' | 'note'>
>

/** One `(key, value)` pair accepted by `settings:set`, typed per-key. */
export type SettingsSetParams = {
  [K in keyof Settings]: [key: K, value: Settings[K]]
}[keyof Settings]

/** Extra data required by `idle:resolve` for resolutions that need it. */
export interface IdleResolutionPayload {
  /** Required when `resolution` is `'reassigned'`; the bucket to attribute the gap to. */
  bucketId?: number
}

/** Extra data required by `recovery:resolve` for choices that need it. */
export interface RecoveryResolutionPayload {
  /** Required when `choice` is `'end_at_custom'`. */
  at?: number
}

/** The kind of prompt window a `prompt:show` event is asking the renderer to display. */
export type PromptKind = 'start' | 'checkin' | 'idle' | 'recovery'

/** Payload carried by the `prompt:show` event, discriminated on `kind` (§9). */
export type PromptPayload =
  | { kind: 'start' }
  | { kind: 'checkin'; state: TrackingState }
  | { kind: 'idle'; idleEvent: IdleEvent }
  | { kind: 'recovery'; recoveryInfo: RecoveryInfo }

/**
 * Channel names for renderer → main invokes (BUILD_PLAN §11). Import and use
 * these constants rather than writing the string literals inline.
 */
export const IpcInvokeChannel = {
  bucketsTree: 'buckets:tree',
  bucketsCreate: 'buckets:create',
  bucketsUpdate: 'buckets:update',
  bucketsMove: 'buckets:move',
  bucketsArchive: 'buckets:archive',
  bucketsDelete: 'buckets:delete',
  bucketsRecents: 'buckets:recents',

  trackingState: 'tracking:state',
  trackingStart: 'tracking:start',
  trackingSwitch: 'tracking:switch',
  trackingStop: 'tracking:stop',
  trackingConfirm: 'tracking:confirm',
  trackingSnooze: 'tracking:snooze',

  segmentsRange: 'segments:range',
  segmentsCreate: 'segments:create',
  segmentsUpdate: 'segments:update',
  segmentsSplit: 'segments:split',
  segmentsMerge: 'segments:merge',
  segmentsDelete: 'segments:delete',
  segmentsNeedsReview: 'segments:needsReview',

  settingsGetAll: 'settings:getAll',
  settingsSet: 'settings:set',

  idlePending: 'idle:pending',
  idleResolve: 'idle:resolve',

  recoveryPending: 'recovery:pending',
  recoveryResolve: 'recovery:resolve',

  appOpenMainWindow: 'app:openMainWindow',
  appRevealDatabase: 'app:revealDatabase'
} as const

/**
 * Channel names for main → renderer events (BUILD_PLAN §11). Import and use
 * these constants rather than writing the string literals inline.
 */
export const IpcEventChannel = {
  trackingChanged: 'tracking:changed',
  segmentsChanged: 'segments:changed',
  settingsChanged: 'settings:changed',
  promptShow: 'prompt:show'
} as const

/** Per-channel `(params, result)` signatures, keyed like `IpcInvokeChannel`. */
interface IpcInvokeSignatures {
  bucketsTree: { params: []; result: BucketNode[] }
  bucketsCreate: {
    params: [parentId: number | null, name: string, color?: string | null]
    result: Bucket
  }
  bucketsUpdate: { params: [id: number, patch: BucketPatch]; result: Bucket }
  bucketsMove: {
    params: [id: number, newParentId: number | null, sortOrder: number]
    result: void
  }
  bucketsArchive: { params: [id: number, archived: boolean]; result: void }
  // Throws / resolves with `{ ok: false }` if the bucket is still referenced by segments.
  bucketsDelete: { params: [id: number]; result: void }
  bucketsRecents: { params: [limit: number]; result: Bucket[] }

  trackingState: { params: []; result: TrackingState }
  trackingStart: { params: [bucketId: number, since?: number]; result: TrackingState }
  trackingSwitch: { params: [bucketId: number, since?: number]; result: TrackingState }
  trackingStop: { params: [since?: number]; result: TrackingState }
  trackingConfirm: { params: [at?: number]; result: TrackingState }
  trackingSnooze: { params: [minutes?: number]; result: void }

  segmentsRange: { params: [fromMs: number, toMs: number]; result: Segment[] }
  segmentsCreate: {
    params: [bucketId: number, start: number, end: number, note?: string]
    result: Segment
  }
  segmentsUpdate: { params: [id: number, patch: SegmentPatch]; result: Segment }
  segmentsSplit: { params: [id: number, atMs: number]; result: [Segment, Segment] }
  segmentsMerge: { params: [idA: number, idB: number]; result: Segment }
  segmentsDelete: { params: [id: number]; result: void }
  segmentsNeedsReview: { params: [fromMs: number, toMs: number]; result: Segment[] }

  settingsGetAll: { params: []; result: Settings }
  settingsSet: { params: SettingsSetParams; result: Settings }

  idlePending: { params: []; result: IdleEvent | null }
  idleResolve: {
    params: [id: number, resolution: IdleResolution, payload: IdleResolutionPayload]
    result: void
  }

  recoveryPending: { params: []; result: RecoveryInfo | null }
  recoveryResolve: {
    params: [choice: RecoveryChoice, payload: RecoveryResolutionPayload]
    result: void
  }

  appOpenMainWindow: { params: [tab?: MainTabId]; result: void }
  appRevealDatabase: { params: []; result: void }
}

/**
 * Maps each invoke channel name to its `(params, result)` signature. Every
 * handler validates its arguments and resolves with a `Result<T>` rather than
 * throwing across the process boundary (§11).
 */
export type IpcInvokeMap = {
  [K in keyof typeof IpcInvokeChannel as (typeof IpcInvokeChannel)[K]]: {
    params: IpcInvokeSignatures[K]['params']
    result: Result<IpcInvokeSignatures[K]['result']>
  }
}

/** Per-channel payload types, keyed like `IpcEventChannel`. */
interface IpcEventPayloads {
  trackingChanged: TrackingState
  segmentsChanged: { fromMs: number; toMs: number }
  settingsChanged: Settings
  promptShow: PromptPayload
}

/** Maps each event channel name to the payload it is emitted with. */
export type IpcEventMap = {
  [K in keyof typeof IpcEventChannel as (typeof IpcEventChannel)[K]]: IpcEventPayloads[K]
}

/** Union of every renderer → main invoke channel name. */
export type IpcInvokeChannelName = (typeof IpcInvokeChannel)[keyof typeof IpcInvokeChannel]

/** The renderer-facing signature of a single invoke channel, as bridged by preload. */
export type IpcInvoker<Channel extends IpcInvokeChannelName> = (
  ...args: IpcInvokeMap[Channel]['params']
) => Promise<IpcInvokeMap[Channel]['result']>

/** The `buckets:*` slice of the preload bridge (§5.4, §11). */
export interface BucketsApi {
  tree: IpcInvoker<typeof IpcInvokeChannel.bucketsTree>
  create: IpcInvoker<typeof IpcInvokeChannel.bucketsCreate>
  update: IpcInvoker<typeof IpcInvokeChannel.bucketsUpdate>
  move: IpcInvoker<typeof IpcInvokeChannel.bucketsMove>
  archive: IpcInvoker<typeof IpcInvokeChannel.bucketsArchive>
  delete: IpcInvoker<typeof IpcInvokeChannel.bucketsDelete>
  recents: IpcInvoker<typeof IpcInvokeChannel.bucketsRecents>
}

/**
 * The `window.api` surface exposed by preload via `contextBridge` (§11). The
 * renderer never touches `ipcRenderer` directly; it goes through this.
 */
export interface ChronoShiftApi {
  buckets: BucketsApi
}

/** Union of every main → renderer event channel name. */
export type IpcEventChannelName = (typeof IpcEventChannel)[keyof typeof IpcEventChannel]
