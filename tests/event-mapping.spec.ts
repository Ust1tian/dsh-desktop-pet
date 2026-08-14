import { describe, expect, it } from 'vitest'
import { mapAgentStatus, mapSessionEvent } from '../src/integration/event-mapping'

function session(id: string) {
  return { id }
}

describe('event-mapping: mapSessionEvent', () => {
  it('maps a completed turn to task.completed', () => {
    const event = { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }
    expect(mapSessionEvent(session('s1'), event, 100)).toEqual({ type: 'task.completed', timestamp: 100, sessionId: 's1' })
  })

  it('maps an errored turn to task.failed', () => {
    const event = { type: 'turn/end', data: { turn: 1, reason: { kind: 'error' } } }
    const result = mapSessionEvent(session('s1'), event, 200)
    expect(result?.type).toBe('task.failed')
    expect(result?.metadata).toEqual({ reason: 'error' })
  })

  it('ignores blocked/interrupted turn ends', () => {
    expect(mapSessionEvent(session('s1'), { type: 'turn/end', data: { reason: { kind: 'blocked' } } }, 1)).toBeNull()
    expect(mapSessionEvent(session('s1'), { type: 'turn/end', data: { reason: { kind: 'interrupted' } } }, 1)).toBeNull()
  })

  it('maps tool/call to tool.started with the tool name', () => {
    const result = mapSessionEvent(session('s1'), { type: 'tool/call', data: { name: 'bash' } }, 300)
    expect(result).toEqual({ type: 'tool.started', timestamp: 300, sessionId: 's1', metadata: { toolName: 'bash' } })
  })

  it('maps tool/result to tool.completed', () => {
    expect(mapSessionEvent(session('s1'), { type: 'tool/result', data: {} }, 400)?.type).toBe('tool.completed')
  })

  it('maps assistant chunks to agent.thinking', () => {
    for (const chunkType of ['text-delta', 'reasoning-delta', 'tool-call-delta']) {
      const result = mapSessionEvent(session('s1'), { type: 'assistant/chunk', data: { chunk: { type: chunkType } } }, 500)
      expect(result?.type).toBe('agent.thinking')
    }
  })

  it('ignores non-activity session events', () => {
    expect(mapSessionEvent(session('s1'), { type: 'user/message', data: {} }, 1)).toBeNull()
    expect(mapSessionEvent(session('s1'), { type: 'step/start', data: {} }, 1)).toBeNull()
  })

  it('maps approval/asked and approval/decided', () => {
    expect(mapSessionEvent(session('s1'), { type: 'approval/asked', data: {} }, 1)?.type).toBe('user_input.required')
    expect(mapSessionEvent(session('s1'), { type: 'approval/decided', data: {} }, 1)?.type).toBe('user_input.resolved')
  })
})

describe('event-mapping: mapAgentStatus', () => {
  it('maps agent idle to session.idle', () => {
    expect(mapAgentStatus({ agent: { id: 'a1' }, status: 'idle' }, 100)).toEqual({
      type: 'session.idle', timestamp: 100, sessionId: 'a1',
    })
  })

  it('ignores running status (activity is observed via chunks/tools)', () => {
    expect(mapAgentStatus({ agent: { id: 'a1' }, status: 'running' }, 100)).toBeNull()
  })
})
