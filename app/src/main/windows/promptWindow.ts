// The single shared prompt window (BUILD_PLAN §9). All prompt kinds render
// through `prompt.html`, routed by `?kind=`; the actual content per kind
// (StartPrompt, CheckinPrompt, ...) is out of scope here — this just owns the
// one `BrowserWindow` instance, its chrome, positioning, and the Escape key.

import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IpcEventChannel, type PromptPayload } from '../../shared/ipc-contract'

const WINDOW_WIDTH = 420
const WINDOW_HEIGHT = 340
const EDGE_MARGIN = 16

function computeBottomRightPosition(): { x: number; y: number } {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { x: areaX, y: areaY, width, height } = display.workArea

  return {
    x: areaX + width - WINDOW_WIDTH - EDGE_MARGIN,
    y: areaY + height - WINDOW_HEIGHT - EDGE_MARGIN
  }
}

/**
 * Owns the single reusable prompt `BrowserWindow`. `show()` may be called
 * repeatedly with different payloads — the window itself is reused, but the
 * page is reloaded with the new `?kind=` each time so `prompt-app/App.tsx`
 * can route from a fresh mount rather than needing to tear down/rebuild
 * per-kind UI state in place.
 */
export class PromptWindow {
  private window: BrowserWindow | null = null
  private onDismiss: (() => void) | null = null

  constructor(private readonly shouldStealFocus: () => boolean) {}

  show(payload: PromptPayload, onDismiss: () => void): void {
    this.onDismiss = onDismiss
    const window = this.ensureWindow()
    const { x, y } = computeBottomRightPosition()
    window.setPosition(x, y)

    const query = { kind: payload.kind }
    const loaded =
      is.dev && process.env['ELECTRON_RENDERER_URL']
        ? window.loadURL(
            `${process.env['ELECTRON_RENDERER_URL']}/prompt.html?${new URLSearchParams(query).toString()}`
          )
        : window.loadFile(join(__dirname, '../renderer/prompt.html'), { query })

    void loaded.then(() => {
      window.webContents.send(IpcEventChannel.promptShow, payload)
      window.show()

      if (this.shouldStealFocus()) {
        window.focus()
      }
    })
  }

  hide(): void {
    this.window?.hide()
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
    }
    this.window = null
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      return this.window
    }

    const window = new BrowserWindow({
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true
      }
    })

    window.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        this.onDismiss?.()
      }
    })

    window.on('closed', () => {
      this.window = null
    })

    this.window = window
    return window
  }
}
