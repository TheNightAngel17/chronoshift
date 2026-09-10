import { Menu, Tray } from 'electron'
import { buildTrayMenuTemplate } from './menu'

type CreateTrayOptions = {
  iconPath: string
  onOpenMainWindow: () => void
  onQuit: () => void
}

let tray: Tray | null = null

export function createTray(options: CreateTrayOptions): Tray {
  if (tray) {
    return tray
  }

  tray = new Tray(options.iconPath)
  tray.setToolTip('ChronoShift')
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate(options.onOpenMainWindow, options.onQuit)))
  tray.on('click', options.onOpenMainWindow)

  return tray
}
