import { describe, expect, it } from 'vitest'
import { resolveEvent, classifyTool, isActivityEvent } from '../src/core/PetStateResolver'
import type { NormalizedEvent } from '../src/core/types'

function evt(type: NormalizedEvent['type'], metadata?: Record<string, unknown>): NormalizedEvent {
  return { type, timestamp: 0, metadata }
}

describe('resolveEvent', () => {
  it('maps session.started → STARTING (flash)', () => {
    expect(resolveEvent(evt('session.started'))).toEqual({ state: 'STARTING', flash: true })
  })

  it('maps session.idle → IDLE', () => {
    expect(resolveEvent(evt('session.idle'))).toEqual({ state: 'IDLE', flash: false })
  })

  it('maps agent.thinking → THINKING', () => {
    expect(resolveEvent(evt('agent.thinking'))).toEqual({ state: 'THINKING', flash: false })
  })

  it('maps task.completed → SUCCESS (flash)', () => {
    expect(resolveEvent(evt('task.completed'))).toEqual({ state: 'SUCCESS', flash: true })
  })

  it('maps task.failed → ERROR (flash)', () => {
    expect(resolveEvent(evt('task.failed'))).toEqual({ state: 'ERROR', flash: true })
  })

  it('maps user_input.required → WAITING_FOR_USER', () => {
    expect(resolveEvent(evt('user_input.required'))).toEqual({ state: 'WAITING_FOR_USER', flash: false })
  })

  it('maps user_input.resolved → IDLE', () => {
    expect(resolveEvent(evt('user_input.resolved'))).toEqual({ state: 'IDLE', flash: false })
  })
})

describe('classifyTool', () => {
  it('classifies editing tools as CODING', () => {
    expect(classifyTool('edit_file')).toBe('CODING')
    expect(classifyTool('file-write')).toBe('CODING')
    expect(classifyTool('apply_patch')).toBe('CODING')
  })

  it('classifies shell/command tools as RUNNING_COMMAND', () => {
    expect(classifyTool('bash')).toBe('RUNNING_COMMAND')
    expect(classifyTool('run_command')).toBe('RUNNING_COMMAND')
    expect(classifyTool('terminal')).toBe('RUNNING_COMMAND')
  })

  it('defaults unknown tools to WORKING', () => {
    expect(classifyTool('web_fetch')).toBe('WORKING')
    expect(classifyTool(undefined)).toBe('WORKING')
  })
})

describe('isActivityEvent', () => {
  it('identifies activity events', () => {
    expect(isActivityEvent('agent.thinking')).toBe(true)
    expect(isActivityEvent('tool.started')).toBe(true)
    expect(isActivityEvent('user_input.required')).toBe(true)
    expect(isActivityEvent('session.idle')).toBe(false)
  })
})
