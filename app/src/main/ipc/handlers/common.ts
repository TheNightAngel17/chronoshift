// Shared plumbing for every `ipcMain.handle` handler (BUILD_PLAN §11).
//
// The house rules these helpers encode: a handler never throws across the
// process boundary (it resolves a `Result<T>`), it validates its arguments
// before touching a repository, and it takes its registrar / repositories /
// event emitter as injectable parameters so the integration tier can drive it
// with a temp-file sqlite database and no Electron.

import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcEventChannelName, IpcEventMap, IpcInvokeMap } from '../../../shared/ipc-contract'
import type { Result } from '../../../shared/types'

/** The slice of `ipcMain` a handler module needs — small enough for a test fake. */
export type IpcRegistrar = Pick<IpcMain, 'handle'>

/** The signature `registrar.handle` expects for one typed invoke channel. */
export type InvokeHandler<Channel extends keyof IpcInvokeMap> = (
  event: IpcMainInvokeEvent,
  ...args: IpcInvokeMap[Channel]['params']
) => IpcInvokeMap[Channel]['result']

/** How a handler module pushes a main → renderer event (§11). */
export type IpcEventEmitter = <Channel extends IpcEventChannelName>(
  channel: Channel,
  payload: IpcEventMap[Channel]
) => void

/**
 * The production emitter: every open window hears every change event. Handlers
 * take this as an injectable dependency so tests can pass a spy rather than
 * needing real `BrowserWindow`s.
 */
export const broadcastIpcEvent: IpcEventEmitter = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(channel, payload)
  }
}

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function err<T>(error: string): Result<T> {
  return { ok: false, error }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return 'Unexpected IPC handler failure.'
}

/** Runs a repository call, turning any throw into `Result.error` (§11). */
export function withResult<T>(run: () => T): Result<T> {
  try {
    return ok(run())
  } catch (error) {
    return err(toErrorMessage(error))
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

export function validateIntegerArgument(value: unknown, name: string): string | null {
  if (!isInteger(value)) {
    return `${name} must be an integer.`
  }

  return null
}

export function validateNullableIntegerArgument(value: unknown, name: string): string | null {
  if (value === null) {
    return null
  }

  return validateIntegerArgument(value, name)
}

/** For a trailing optional timestamp-style argument: absent is fine, present must be an integer. */
export function validateOptionalIntegerArgument(value: unknown, name: string): string | null {
  if (value === undefined) {
    return null
  }

  return validateIntegerArgument(value, name)
}

export function validatePositiveIntegerArgument(value: unknown, name: string): string | null {
  if (!isInteger(value) || value <= 0) {
    return `${name} must be an integer greater than 0.`
  }

  return null
}

export function validateOptionalStringArgument(value: unknown, name: string): string | null {
  if (value === undefined || value === null || typeof value === 'string') {
    return null
  }

  return `${name} must be a string or null.`
}

export function validateNoArguments(args: unknown[]): string | null {
  if (args.length > 0) {
    return 'This channel does not accept arguments.'
  }

  return null
}
