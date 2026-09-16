// Prompt arbitration (BUILD_PLAN §9, decision ticket #8).
//
// Three queue-worthy sources — Recovery, Idle, Checkin — compete for the one
// prompt window. Strict priority, forced preemption: a higher-priority
// arrival always closes whatever's on screen, writes its terminal status
// immediately, and shows itself. Modeled as one slot per source rather than
// an arbitrary-depth FIFO — at most one *pending* (not yet displayed) request
// per slot, replaced in place by a newer arrival for the same slot.
//
// This module is deliberately Electron-free: it takes a `checkins`
// repository and a display callback as injected dependencies (see
// `tray/menu.ts` for the same house style), so it's unit-testable without a
// `BrowserWindow`. `windows/promptWindow.ts` is what actually wires it to one.

import type { IdleEvent, RecoveryInfo, TrackingState } from '../../shared/types'
import type { PromptPayload } from '../../shared/ipc-contract'
import * as defaultCheckinsRepository from '../db/repositories/checkins'

type PromptSlot = 'recovery' | 'idle' | 'checkin'

// Recovery always runs before the tray exists, so nothing competes with it.
// Idle outranks Checkin because resolving idle first can pull a segment back
// under the auto-stop threshold before a check-in would need to nag about it.
const SLOT_PRIORITY: Record<PromptSlot, number> = {
  recovery: 0,
  idle: 1,
  checkin: 2
}

/** Ordered highest-priority-first; used when picking the next pending slot. */
const SLOTS_BY_PRIORITY: readonly PromptSlot[] = ['recovery', 'idle', 'checkin']

function isHigherPriority(a: PromptSlot, b: PromptSlot): boolean {
  return SLOT_PRIORITY[a] < SLOT_PRIORITY[b]
}

type CheckinsRepository = Pick<typeof defaultCheckinsRepository, 'create' | 'respond'>

export interface PromptQueueCallbacks {
  /** Called synchronously whenever a (new or replacement) prompt should be shown. */
  onDisplay: (payload: PromptPayload) => void
  /** Called when the queue has nothing left to show, so the window can hide. */
  onHide?: () => void
}

export interface PromptQueueOptions {
  callbacks: PromptQueueCallbacks
  /** Defaults to the real repository; tests inject a fake. */
  checkins?: CheckinsRepository
  /** Defaults to `Date.now`; tests inject a fixed clock. */
  now?: () => number
}

interface DisplayedPrompt {
  slot: PromptSlot
  payload: PromptPayload
  /** The `checkins` row id for a displayed Checkin, or `null` for the other two slots. */
  checkinId: number | null
}

/**
 * Holds the arbitration state for the shared prompt window: which slot (if
 * any) is on screen, and at most one pending request behind it per slot.
 */
export class PromptQueue {
  private readonly callbacks: PromptQueueCallbacks
  private readonly checkins: CheckinsRepository
  private readonly now: () => number

  private pending: Partial<Record<PromptSlot, PromptPayload>> = {}
  private displayed: DisplayedPrompt | null = null

  constructor(options: PromptQueueOptions) {
    this.callbacks = options.callbacks
    this.checkins = options.checkins ?? defaultCheckinsRepository
    this.now = options.now ?? Date.now
  }

  /** The payload currently on screen, if any. */
  get current(): PromptPayload | null {
    return this.displayed?.payload ?? null
  }

  requestRecovery(recoveryInfo: RecoveryInfo): void {
    this.submit('recovery', { kind: 'recovery', recoveryInfo })
  }

  // No idle monitor exists yet (that's a future issue); this just gives it a
  // slot to call into once it does, per #42's shape-not-scheduler scope.
  requestIdle(idleEvent: IdleEvent): void {
    this.submit('idle', { kind: 'idle', idleEvent })
  }

  requestCheckin(state: TrackingState): void {
    this.submit('checkin', { kind: 'checkin', state })
  }

  /** Escape on the currently displayed prompt: record it `dismissed`, then show whatever's next. */
  dismissCurrent(): void {
    if (!this.displayed) {
      return
    }

    this.closeDisplayed('dismissed')
    this.promoteNext()
  }

  private submit(slot: PromptSlot, payload: PromptPayload): void {
    if (this.displayed?.slot === slot) {
      // A fresh arrival for the slot already on screen (e.g. a second idle
      // event before the first was resolved) is still the highest-priority
      // request for its own slot — swap it in immediately.
      this.closeDisplayed('timeout')
      this.displayNow(slot, payload)
      return
    }

    if (this.displayed && isHigherPriority(this.displayed.slot, slot)) {
      // Something more important is on screen: this one waits, replacing
      // whatever was already waiting for the same slot (never two deep).
      this.pending[slot] = payload
      return
    }

    if (this.displayed) {
      // This arrival outranks what's on screen: forced preemption — close it
      // and write its terminal status before the new one displays.
      this.closeDisplayed('timeout')
    }

    // Superseding any stale pending request of the same slot with this
    // fresher, about-to-display one.
    delete this.pending[slot]
    this.displayNow(slot, payload)
  }

  private displayNow(slot: PromptSlot, payload: PromptPayload): void {
    const checkinId =
      slot === 'checkin' && payload.kind === 'checkin'
        ? this.checkins.create(payload.state.segment?.id ?? null, this.now()).id
        : null

    this.displayed = { slot, payload, checkinId }
    this.callbacks.onDisplay(payload)
  }

  private closeDisplayed(response: 'dismissed' | 'timeout'): void {
    if (!this.displayed) {
      return
    }

    if (this.displayed.checkinId !== null) {
      this.checkins.respond(this.displayed.checkinId, this.now(), response)
    }

    this.displayed = null
  }

  private promoteNext(): void {
    const nextSlot = SLOTS_BY_PRIORITY.find((slot) => this.pending[slot] !== undefined)

    if (!nextSlot) {
      this.callbacks.onHide?.()
      return
    }

    const payload = this.pending[nextSlot] as PromptPayload
    delete this.pending[nextSlot]
    this.displayNow(nextSlot, payload)
  }
}
