import { describe, expect, it, vi } from 'vitest'
import { PetStateMachine } from '../src/core/PetStateMachine'
import type { NormalizedEvent } from '../src/core/types'
import { createFakeClock } from './helpers/fakeClock'

function evt(type: NormalizedEvent['type'], taskId?: string, timestamp = 0): NormalizedEvent {
  const e: NormalizedEvent = { type, timestamp }
  if (taskId) e.taskId = taskId
  return e
}

describe('PetStateMachine', () => {
  it('starts in IDLE', () => {
    const { clock } = createFakeClock()
    const machine = new PetStateMachine({ clock })
    expect(machine.state).toBe('IDLE')
  })

  it('transitions to WORKING on tool.started', () => {
    const { clock } = createFakeClock()
    const states: string[] = []
    const machine = new PetStateMachine({ clock, onChange: s => states.push(s) })
    machine.onEvent(evt('tool.started', 'a'))
    expect(machine.state).toBe('WORKING')
    expect(states).toContain('WORKING')
  })

  it('resolves multi-task states by priority (WAITING beats WORKING)', () => {
    const { clock } = createFakeClock()
    const machine = new PetStateMachine({ clock })
    machine.onEvent(evt('tool.started', 'a'))
    expect(machine.state).toBe('WORKING')
    machine.onEvent(evt('user_input.required', 'b'))
    expect(machine.state).toBe('WAITING_FOR_USER')
  })

  it('expires SUCCESS back to IDLE after flashMs', () => {
    const { clock, advance } = createFakeClock()
    const machine = new PetStateMachine({ clock, flashMs: 1000 })
    machine.onEvent(evt('task.completed', 'a'))
    expect(machine.state).toBe('SUCCESS')
    advance(1000)
    expect(machine.state).toBe('IDLE')
  })

  it('falls back to SLEEPING after sleepAfterMs of idleness', () => {
    const { clock, advance } = createFakeClock()
    const machine = new PetStateMachine({ clock, sleepAfterMs: 5000 })
    machine.onEvent(evt('session.idle', 'a'))
    expect(machine.state).toBe('IDLE')
    advance(5000)
    // The sleep timer fires on its own (no further event required).
    expect(machine.state).toBe('SLEEPING')
  })

  it('wakes from SLEEPING on activity', () => {
    const { clock, advance } = createFakeClock()
    const machine = new PetStateMachine({ clock, sleepAfterMs: 5000 })
    advance(5000)
    expect(machine.state).toBe('SLEEPING')
    machine.onEvent(evt('tool.started', 'a'))
    expect(machine.state).toBe('WORKING')
  })

  it('suppresses duplicate transitions (no onChange spam)', () => {
    const { clock } = createFakeClock()
    const onChange = vi.fn()
    const machine = new PetStateMachine({ clock, onChange })
    machine.onEvent(evt('tool.started', 'a'))
    machine.onEvent(evt('tool.started', 'a'))
    machine.onEvent(evt('tool.started', 'a'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
