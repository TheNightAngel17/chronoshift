/// <reference types="vite/client" />

import type { ChronoShiftApi } from '../../shared/ipc-contract'

declare global {
  interface Window {
    /** The `contextBridge` surface exposed by preload (BUILD_PLAN §11). */
    api: ChronoShiftApi
  }
}
