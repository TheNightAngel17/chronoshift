import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {
    // The preload script runs under `sandbox: true` (BUILD_PLAN §11), where
    // Electron's restricted preload `require` can only resolve Node builtins
    // and `electron` itself — not arbitrary npm packages. electron-vite's
    // default externalize-deps behavior would otherwise leave
    // `@electron-toolkit/preload` as an unbundled `require(...)`, which
    // fails at runtime with "module not found" and silently leaves
    // `window.api` undefined.
    build: {
      externalizeDeps: { exclude: ['@electron-toolkit/preload'] }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
