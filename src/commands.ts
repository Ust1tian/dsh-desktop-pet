/**
 * Developer/debug command: `/pet <state>`.
 *
 * Registered only when the optional `ctx.commands` service is present. It
 * simulates a semantic state without invoking any LLM, so developers can
 * verify the animation mapping by hand.
 */

import type { SemanticState } from './core/types'

const VALID_STATES: readonly SemanticState[] = [
  'STARTING',
  'IDLE',
  'THINKING',
  'WORKING',
  'CODING',
  'RUNNING_COMMAND',
  'WAITING_FOR_USER',
  'SUCCESS',
  'ERROR',
  'SLEEPING',
]

export interface CommandContext {
  commands: {
    register(definition: CommandDefinition): unknown
  }
}

/** Minimal structural shape of a `CommandDefinition`. */
interface CommandDefinition {
  name: string
  description: string
  input?: { type: string }
  handler: (invocation: { rawInput: string; agent?: unknown; signal?: unknown }) => { kind: 'success' | 'error'; text: string } | Promise<{ kind: 'success' | 'error'; text: string }>
}

export interface PetDebugHost {
  setDebugState(state: SemanticState): void
  resetDebugState(): void
}

/**
 * Register the `/pet` command if the context exposes `commands`.
 * Returns a disposer (no-op if the capability is absent).
 */
export function registerPetCommand(ctx: CommandContext, host: PetDebugHost): () => void {
  if (!ctx.commands || typeof ctx.commands.register !== 'function') return () => {}

  ctx.commands.register({
    name: 'pet',
    description: 'Simulate a desktop-pet state for manual verification.',
    input: { type: 'string' },
    handler: async (invocation) => {
      const arg = (invocation.rawInput ?? '').trim().toUpperCase()
      if (arg === '' || arg === 'RESET' || arg === 'CLEAR') {
        host.resetDebugState()
        return { kind: 'success', text: 'Pet debug state reset.' }
      }
      if (!(VALID_STATES as string[]).includes(arg)) {
        return { kind: 'error', text: `Unknown state "${arg}". Valid states: ${VALID_STATES.join(', ')}` }
      }
      host.setDebugState(arg as SemanticState)
      return { kind: 'success', text: `Pet debug state set to ${arg}.` }
    },
  })

  return () => {
    // Command registrations are fiber-owned in Cordis; no manual disposal needed.
  }
}
