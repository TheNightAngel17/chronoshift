import { describe, expect, it, vi } from 'vitest'
import { buildTrayMenuTemplate } from './menu'

describe('buildTrayMenuTemplate', () => {
  it('builds the expected open and quit actions', () => {
    const onOpenMainWindow = vi.fn()
    const onQuit = vi.fn()

    const template = buildTrayMenuTemplate(onOpenMainWindow, onQuit)

    expect(template).toHaveLength(3)
    expect(template[0]).toMatchObject({ label: 'Open ChronoShift' })
    expect(template[2]).toMatchObject({ label: 'Quit ChronoShift' })
  })
})
