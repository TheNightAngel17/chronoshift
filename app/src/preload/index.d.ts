import { ElectronAPI } from '@electron-toolkit/preload'
import type { ChronoShiftApi } from '../shared/ipc-contract'

declare global {
  interface Window {
    electron: ElectronAPI
    api: ChronoShiftApi
  }
}
