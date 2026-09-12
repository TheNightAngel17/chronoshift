import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { hasHiddenLaunchFlag } from '../shared/startup'
import { registerIpcHandlers } from './ipc'
import { createTray } from './tray'

let mainWindow: BrowserWindow | null = null
let isQuitting = false

const startHidden = hasHiddenLaunchFlag(process.argv)

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

function showMainWindow(): void {
  if (!mainWindow) {
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.show()
  mainWindow.focus()
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 900,
    height: 670,
    minWidth: 800,
    minHeight: 520,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true
    }
  })

  window.on('ready-to-show', () => {
    if (!startHidden) {
      showMainWindow()
    }
  })

  window.on('close', (event) => {
    if (isQuitting) {
      return
    }

    event.preventDefault()
    window.hide()
  })

  window.on('closed', () => {
    mainWindow = null
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

app.on('second-instance', () => {
  showMainWindow()
})

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.mitchell.chronoshift')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()
  mainWindow = createWindow()
  createTray({
    iconPath: icon,
    onOpenMainWindow: showMainWindow,
    onQuit: () => {
      isQuitting = true
      app.quit()
    }
  })

  app.on('activate', () => {
    if (mainWindow === null) {
      mainWindow = createWindow()
      return
    }

    showMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})
