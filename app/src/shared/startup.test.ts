import { describe, expect, it } from 'vitest'
import { hasHiddenLaunchFlag } from './startup'

describe('hasHiddenLaunchFlag', () => {
  it('returns true when the hidden flag is present', () => {
    expect(hasHiddenLaunchFlag(['chronoshift', '--hidden'])).toBe(true)
  })

  it('returns false when the hidden flag is absent', () => {
    expect(hasHiddenLaunchFlag(['chronoshift'])).toBe(false)
  })
})
