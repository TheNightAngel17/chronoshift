import type { MenuItemConstructorOptions } from 'electron'

export function buildTrayMenuTemplate(
  onOpenMainWindow: () => void,
  onQuit: () => void
): MenuItemConstructorOptions[] {
  return [
    {
      label: 'Open ChronoShift',
      click: onOpenMainWindow
    },
    {
      type: 'separator'
    },
    {
      label: 'Quit ChronoShift',
      click: onQuit
    }
  ]
}
