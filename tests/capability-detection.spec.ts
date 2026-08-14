import { describe, expect, it } from 'vitest'
import { detectCapabilities } from '../src/integration/capability-detection'
import type { HarnessContext } from '../src/integration/HarnessBridge'

describe('capability detection', () => {
  it('reports services present via ctx.get', () => {
    const ctx: HarnessContext = {
      on: () => () => {},
      get: (name) => (name === 'commands' ? {} : undefined),
      logger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
    }
    const caps = detectCapabilities(ctx)
    expect(caps.commands).toBe(true)
    expect(caps.agents).toBe(false)
  })

  it('reports no capabilities when ctx.get returns undefined', () => {
    const ctx: HarnessContext = {
      on: () => () => {},
      get: () => undefined,
      logger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
    }
    const caps = detectCapabilities(ctx)
    expect(caps).toEqual({ commands: false, agents: false, approval: false, sessions: false })
  })
})
