import { ipcMain, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import { IpcInvokeChannel, type BucketPatch, type IpcInvokeMap } from '../../../shared/ipc-contract'
import type { Result } from '../../../shared/types'
import { getDatabase } from '../../db/connection'
import { BucketsRepository } from '../../db/repositories/buckets'

type IpcRegistrar = Pick<IpcMain, 'handle'>
type InvokeHandler<Channel extends keyof IpcInvokeMap> = (
  event: IpcMainInvokeEvent,
  ...args: IpcInvokeMap[Channel]['params']
) => IpcInvokeMap[Channel]['result']

function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

function err<T>(error: string): Result<T> {
  return { ok: false, error }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }

  return 'Unexpected IPC handler failure.'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function validateIntegerArgument(value: unknown, name: string): string | null {
  if (!isInteger(value)) {
    return `${name} must be an integer.`
  }

  return null
}

function validateNullableIntegerArgument(value: unknown, name: string): string | null {
  if (value === null) {
    return null
  }

  return validateIntegerArgument(value, name)
}

function validateName(name: unknown): string | null {
  if (typeof name !== 'string' || name.trim().length === 0) {
    return 'name must be a non-empty string.'
  }

  return null
}

function validateColor(color: unknown, name: string): string | null {
  if (color === undefined || color === null || typeof color === 'string') {
    return null
  }

  return `${name} must be a string or null.`
}

function validatePatch(patch: unknown): string | null {
  if (!isRecord(patch)) {
    return 'patch must be an object.'
  }

  const allowedKeys = new Set(['name', 'color'])
  const unknownKeys = Object.keys(patch).filter((key) => !allowedKeys.has(key))

  if (unknownKeys.length > 0) {
    return `patch contains unsupported field(s): ${unknownKeys.join(', ')}.`
  }

  if ('name' in patch) {
    const nameError = validateName(patch.name)

    if (nameError) {
      return nameError
    }
  }

  if ('color' in patch) {
    const colorError = validateColor(patch.color, 'patch.color')

    if (colorError) {
      return colorError
    }
  }

  return null
}

function validateNoArguments(args: unknown[]): string | null {
  if (args.length > 0) {
    return 'This channel does not accept arguments.'
  }

  return null
}

function validateBooleanArgument(value: unknown, name: string): string | null {
  if (typeof value !== 'boolean') {
    return `${name} must be a boolean.`
  }

  return null
}

function validateLimit(limit: unknown): string | null {
  if (!isInteger(limit) || limit < 0) {
    return 'limit must be an integer greater than or equal to 0.'
  }

  return null
}

function validateSortOrder(sortOrder: unknown): string | null {
  if (!isInteger(sortOrder) || sortOrder < 0) {
    return 'sortOrder must be an integer greater than or equal to 0.'
  }

  return null
}

function withResult<T>(run: () => T): Result<T> {
  try {
    return ok(run())
  } catch (error) {
    return err(toErrorMessage(error))
  }
}

export function registerBucketIpcHandlers(
  registrar: IpcRegistrar = ipcMain,
  repository = new BucketsRepository(getDatabase())
): void {
  const treeHandler: InvokeHandler<typeof IpcInvokeChannel.bucketsTree> = (_event, ...args) => {
    const argsError = validateNoArguments(args)

    if (argsError) {
      return err(argsError)
    }

    return withResult(() => repository.tree())
  }

  const createHandler: InvokeHandler<typeof IpcInvokeChannel.bucketsCreate> = (
    _event,
    parentId,
    name,
    color
  ) => {
    const parentError = validateNullableIntegerArgument(parentId, 'parentId')

    if (parentError) {
      return err(parentError)
    }

    const nameError = validateName(name)

    if (nameError) {
      return err(nameError)
    }

    const colorError = validateColor(color, 'color')

    if (colorError) {
      return err(colorError)
    }

    return withResult(() => repository.create(parentId, name, color ?? null))
  }

  const updateHandler: InvokeHandler<typeof IpcInvokeChannel.bucketsUpdate> = (
    _event,
    id,
    patch
  ) => {
    const idError = validateIntegerArgument(id, 'id')

    if (idError) {
      return err(idError)
    }

    const patchError = validatePatch(patch)

    if (patchError) {
      return err(patchError)
    }

    return withResult(() => repository.update(id, patch as BucketPatch))
  }

  const moveHandler: InvokeHandler<typeof IpcInvokeChannel.bucketsMove> = (
    _event,
    id,
    newParentId,
    sortOrder
  ) => {
    const idError = validateIntegerArgument(id, 'id')

    if (idError) {
      return err(idError)
    }

    const parentError = validateNullableIntegerArgument(newParentId, 'newParentId')

    if (parentError) {
      return err(parentError)
    }

    const sortOrderError = validateSortOrder(sortOrder)

    if (sortOrderError) {
      return err(sortOrderError)
    }

    return withResult(() => {
      repository.move(id, newParentId, sortOrder)
    })
  }

  const archiveHandler: InvokeHandler<typeof IpcInvokeChannel.bucketsArchive> = (
    _event,
    id,
    archived
  ) => {
    const idError = validateIntegerArgument(id, 'id')

    if (idError) {
      return err(idError)
    }

    const archivedError = validateBooleanArgument(archived, 'archived')

    if (archivedError) {
      return err(archivedError)
    }

    return withResult(() => {
      repository.archive(id, archived)
    })
  }

  const deleteHandler: InvokeHandler<typeof IpcInvokeChannel.bucketsDelete> = (_event, id) => {
    const idError = validateIntegerArgument(id, 'id')

    if (idError) {
      return err(idError)
    }

    return withResult(() => {
      repository.delete(id)
    })
  }

  const recentsHandler: InvokeHandler<typeof IpcInvokeChannel.bucketsRecents> = (_event, limit) => {
    const limitError = validateLimit(limit)

    if (limitError) {
      return err(limitError)
    }

    return withResult(() => repository.recents(limit))
  }

  registrar.handle(IpcInvokeChannel.bucketsTree, treeHandler)
  registrar.handle(IpcInvokeChannel.bucketsCreate, createHandler)
  registrar.handle(IpcInvokeChannel.bucketsUpdate, updateHandler)
  registrar.handle(IpcInvokeChannel.bucketsMove, moveHandler)
  registrar.handle(IpcInvokeChannel.bucketsArchive, archiveHandler)
  registrar.handle(IpcInvokeChannel.bucketsDelete, deleteHandler)
  registrar.handle(IpcInvokeChannel.bucketsRecents, recentsHandler)
}
