/**
 * Maps normalized harness events into semantic pet states.
 *
 * This is the deterministic "event → state" layer. It must never consult an
 * LLM or the network; it only looks at the normalized event type and its
 * optional metadata. `flash` states (`SUCCESS` / `ERROR`) are transient and
 * are later timed out by the state machine.
 */

import type { NormalizedEvent, SemanticState } from './types'

/**
 * Classify a tool name into a more specific semantic state when the harness
 * exposes it. The mapping is conservative and defaults to `WORKING`.
 */
export function classifyTool(name: string | undefined): SemanticState {
  if (!name) return 'WORKING'
  const lower = name.toLowerCase()
  if (/edit|write|patch|update-file|apply|replace/i.test(lower)) return 'CODING'
  if (/bash|shell|run|exec|command|terminal|python|node/i.test(lower)) return 'RUNNING_COMMAND'
  return 'WORKING'
}

export interface ResolveResult {
  state: SemanticState
  /** `true` for transient states that should expire back to IDLE. */
  flash: boolean
}

/**
 * Resolve a single normalized event into a state transition.
 */
export function resolveEvent(event: NormalizedEvent): ResolveResult {
  switch (event.type) {
    case 'session.started':
      return { state: 'STARTING', flash: true }

    case 'session.idle':
      return { state: 'IDLE', flash: false }

    case 'agent.thinking':
      return { state: 'THINKING', flash: false }

    case 'tool.started':
      return { state: classifyTool(String(event.metadata?.toolName ?? '')), flash: false }

    case 'tool.completed':
      // A completed tool is not itself a state; the machine falls back when
      // no further activity arrives.
      return { state: 'IDLE', flash: false }

    case 'user_input.required':
      return { state: 'WAITING_FOR_USER', flash: false }

    case 'user_input.resolved':
      return { state: 'IDLE', flash: false }

    case 'task.completed':
      return { state: 'SUCCESS', flash: true }

    case 'task.failed':
      return { state: 'ERROR', flash: true }

    default:
      return { state: 'IDLE', flash: false }
  }
}

/**
 * Whether a normalized event represents ongoing activity (keeps the pet out
 * of the sleep path).
 */
export function isActivityEvent(type: NormalizedEvent['type']): boolean {
  switch (type) {
    case 'session.started':
    case 'agent.thinking':
    case 'tool.started':
    case 'user_input.required':
      return true
    default:
      return false
  }
}
