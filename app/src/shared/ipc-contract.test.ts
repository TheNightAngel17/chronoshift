import { describe, expect, it } from 'vitest'
import { IpcEventChannel, IpcInvokeChannel } from './ipc-contract'

describe('IpcInvokeChannel', () => {
  it('defines exactly the invoke channels listed in BUILD_PLAN §11', () => {
    expect(Object.values(IpcInvokeChannel).sort()).toEqual(
      [
        'buckets:tree',
        'buckets:create',
        'buckets:update',
        'buckets:move',
        'buckets:archive',
        'buckets:delete',
        'buckets:recents',
        'tracking:state',
        'tracking:start',
        'tracking:switch',
        'tracking:stop',
        'tracking:confirm',
        'tracking:snooze',
        'segments:range',
        'segments:create',
        'segments:update',
        'segments:split',
        'segments:merge',
        'segments:delete',
        'segments:needsReview',
        'settings:getAll',
        'settings:set',
        'idle:pending',
        'idle:resolve',
        'recovery:pending',
        'recovery:resolve',
        'app:openMainWindow',
        'app:revealDatabase'
      ].sort()
    )
  })

  it('has no duplicate channel names', () => {
    const values = Object.values(IpcInvokeChannel)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('IpcEventChannel', () => {
  it('defines exactly the events listed in BUILD_PLAN §11', () => {
    expect(Object.values(IpcEventChannel).sort()).toEqual(
      ['tracking:changed', 'segments:changed', 'settings:changed', 'prompt:show'].sort()
    )
  })

  it('has no duplicate channel names', () => {
    const values = Object.values(IpcEventChannel)
    expect(new Set(values).size).toBe(values.length)
  })
})
