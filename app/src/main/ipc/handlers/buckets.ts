import { ipcMain } from 'electron'
import { IpcInvokeChannel, type BucketPatch } from '../../../shared/ipc-contract'
import { getDatabase } from '../../db/connection'
import { BucketsRepository } from '../../db/repositories/buckets'
import {
  err,
  isInteger,
  isRecord,
  validateIntegerArgument,
  validateNoArguments,
  validateNullableIntegerArgument,
  withResult,
  type InvokeHandler,
  type IpcRegistrar
} from './common'

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
  const patchKeys = Object.keys(patch)

  if (patchKeys.length === 0) {
    return 'patch must include at least one supported field.'
  }

  const unknownKeys = patchKeys.filter((key) => !allowedKeys.has(key))

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
