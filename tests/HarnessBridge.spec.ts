import { describe, expect, it } from 'vitest'
import { createHarnessBridge, type HarnessContext } from '../src/integration/HarnessBridge'
import type { NormalizedEvent } from '../src/core/types'

function makeContext(services: Record<string, unknown> = {}) {
  const listeners = new Map<string, Array<(...args: any[]) => any>>()
  const ctx: HarnessContext = {
    on: (name, listener) => {
      if (!listeners.has(name)) listeners.set(name, [])
      listeners.get(name)!.push(listener)
      return () => {
        const list = listeners.get(name) ?? []
        const i = list.indexOf(listener)
        if (i >= 0) list.splice(i, 1)
      }
    },
    get: (name) => services[name],
    logger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
  }
  return { ctx, listeners }
}

describe('HarnessBridge', () => {
  it('normalizes session/event into subscribed events', async () => {
    const { ctx, listeners } = makeContext()
    const bridge = createHarnessBridge(ctx)
    await bridge.start()

    const events: NormalizedEvent[] = []
    bridge.subscribe(e => events.push(e))

    const sessionListener = listeners.get('session/event')!
    expect(sessionListener).toBeDefined()
    sessionListener[0]({ id: 's1' }, { type: 'tool/call', data: { name: 'bash' } })

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('tool.started')
    expect(events[0].metadata?.toolName).toBe('bash')

    await bridge.stop()
  })

  it('normalizes agent/status idle into session.idle', async () => {
    const { ctx, listeners } = makeContext()
    const bridge = createHarnessBridge(ctx)
    await bridge.start()

    const events: NormalizedEvent[] = []
    bridge.subscribe(e => events.push(e))

    listeners.get('agent/status')![0]({ agent: { id: 'a1' }, status: 'idle' })

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('session.idle')

    await bridge.stop()
  })

  it('unsubscribes and stops cleanly', async () => {
    const { ctx, listeners } = makeContext()
    const bridge = createHarnessBridge(ctx)
    await bridge.start()

    const events: NormalizedEvent[] = []
    const dispose = bridge.subscribe(e => events.push(e))
    dispose()

    listeners.get('session/event')![0]({ id: 's1' }, { type: 'tool/result', data: {} })
    expect(events).toHaveLength(0)

    await bridge.stop()
    // After stop, listeners are removed from the context.
    expect(listeners.get('session/event')).toHaveLength(0)
  })

  it('detects optional capabilities', async () => {
    const { ctx } = makeContext({ commands: {}, agents: {} })
    const bridge = createHarnessBridge(ctx)
    expect(bridge.capabilities.commands).toBe(true)
    expect(bridge.capabilities.agents).toBe(true)
    expect(bridge.capabilities.approval).toBe(false)
  })
})
