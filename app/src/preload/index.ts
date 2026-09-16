import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IpcEventChannel,
  IpcInvokeChannel,
  type ChronoShiftApi,
  type IpcEventChannelName,
  type IpcEventMap,
  type IpcInvokeChannelName,
  type IpcInvokeMap
} from '../shared/ipc-contract'

// Every renderer → main call goes through this one wrapper so the renderer
// never imports `ipcRenderer` itself (BUILD_PLAN §11). Each handler resolves a
// `Result<T>` rather than throwing across the boundary.
function invoke<Channel extends IpcInvokeChannelName>(
  channel: Channel,
  ...args: IpcInvokeMap[Channel]['params']
): Promise<IpcInvokeMap[Channel]['result']> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcInvokeMap[Channel]['result']>
}

// Every main → renderer event goes through this wrapper for the same reason.
// `ipcRenderer.removeListener` needs the exact function reference `.on` was
// given, so this hands the caller an unsubscribe closure over that reference
// rather than requiring them to track it themselves.
function subscribe<Channel extends IpcEventChannelName>(
  channel: Channel,
  listener: (payload: IpcEventMap[Channel]) => void
): () => void {
  const handler = (_event: IpcRendererEvent, payload: IpcEventMap[Channel]): void => {
    listener(payload)
  }

  ipcRenderer.on(channel, handler)

  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

// Custom APIs for renderer
const api: ChronoShiftApi = {
  buckets: {
    tree: () => invoke(IpcInvokeChannel.bucketsTree),
    create: (parentId, name, color) =>
      invoke(IpcInvokeChannel.bucketsCreate, parentId, name, color),
    update: (id, patch) => invoke(IpcInvokeChannel.bucketsUpdate, id, patch),
    move: (id, newParentId, sortOrder) =>
      invoke(IpcInvokeChannel.bucketsMove, id, newParentId, sortOrder),
    archive: (id, archived) => invoke(IpcInvokeChannel.bucketsArchive, id, archived),
    delete: (id) => invoke(IpcInvokeChannel.bucketsDelete, id),
    recents: (limit) => invoke(IpcInvokeChannel.bucketsRecents, limit)
  },
  tracking: {
    state: () => invoke(IpcInvokeChannel.trackingState),
    start: (bucketId, since) => invoke(IpcInvokeChannel.trackingStart, bucketId, since),
    switch: (bucketId, since) => invoke(IpcInvokeChannel.trackingSwitch, bucketId, since),
    stop: (since) => invoke(IpcInvokeChannel.trackingStop, since),
    confirm: (at) => invoke(IpcInvokeChannel.trackingConfirm, at),
    snooze: (minutes) => invoke(IpcInvokeChannel.trackingSnooze, minutes),
    onChanged: (listener) => subscribe(IpcEventChannel.trackingChanged, listener)
  },
  segments: {
    range: (fromMs, toMs) => invoke(IpcInvokeChannel.segmentsRange, fromMs, toMs),
    create: (bucketId, start, end, note) =>
      invoke(IpcInvokeChannel.segmentsCreate, bucketId, start, end, note),
    update: (id, patch) => invoke(IpcInvokeChannel.segmentsUpdate, id, patch),
    split: (id, atMs) => invoke(IpcInvokeChannel.segmentsSplit, id, atMs),
    merge: (idA, idB) => invoke(IpcInvokeChannel.segmentsMerge, idA, idB),
    delete: (id) => invoke(IpcInvokeChannel.segmentsDelete, id),
    needsReview: (fromMs, toMs) => invoke(IpcInvokeChannel.segmentsNeedsReview, fromMs, toMs),
    onChanged: (listener) => subscribe(IpcEventChannel.segmentsChanged, listener)
  },
  prompts: {
    onShow: (listener) => subscribe(IpcEventChannel.promptShow, listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
