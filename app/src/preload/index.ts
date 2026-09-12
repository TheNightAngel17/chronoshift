import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IpcInvokeChannel,
  type ChronoShiftApi,
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

// Custom APIs for renderer
const api: ChronoShiftApi = {
  invoke,
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
