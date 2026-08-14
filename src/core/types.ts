/**
 * Harness-independent type vocabulary shared across the pet core.
 *
 * Nothing in this file imports from deepseek-harness or Cordis. Keeping these
 * types in one place is what lets the pet's behavioral logic be tested as a
 * standalone library.
 */

/** The semantic activity states the pet reasons about. */
export type SemanticState =
  | 'STARTING'
  | 'IDLE'
  | 'THINKING'
  | 'WORKING'
  | 'CODING'
  | 'RUNNING_COMMAND'
  | 'WAITING_FOR_USER'
  | 'SUCCESS'
  | 'ERROR'
  | 'SLEEPING'

/**
 * The nine renderer states defined by the Codex Pet sprite-sheet contract.
 * `running-left` / `running-right` are drag-direction poses; the rest are
 * activity poses. Look directions (v2 rows 9–10) are intentionally not part
 * of the activity vocabulary.
 */
export type CodexPetState =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'

/**
 * A normalized activity event produced by the Harness bridge. It carries no
 * raw Harness payloads — only a semantic type plus safe scalar metadata.
 */
export type NormalizedEventType =
  | 'session.started'
  | 'session.idle'
  | 'agent.thinking'
  | 'tool.started'
  | 'tool.completed'
  | 'user_input.required'
  | 'user_input.resolved'
  | 'task.completed'
  | 'task.failed'

export interface NormalizedEvent {
  type: NormalizedEventType
  /** Epoch milliseconds. */
  timestamp: number
  sessionId?: string
  taskId?: string
  metadata?: Record<string, unknown>
}

/** The mapping from a semantic state to the Codex renderer pose. */
export const SEMANTIC_TO_CODEX: Readonly<Record<SemanticState, CodexPetState>> = {
  STARTING: 'waving',
  IDLE: 'idle',
  THINKING: 'running',
  WORKING: 'running',
  CODING: 'running',
  RUNNING_COMMAND: 'running',
  WAITING_FOR_USER: 'waiting',
  SUCCESS: 'review',
  ERROR: 'failed',
  SLEEPING: 'idle',
}

/** A short, privacy-safe status label for each semantic state. */
export const STATUS_BUBBLE: Readonly<Record<SemanticState, string>> = {
  STARTING: 'Waking up…',
  IDLE: '',
  THINKING: 'Thinking…',
  WORKING: 'Working…',
  CODING: 'Coding…',
  RUNNING_COMMAND: 'Running…',
  WAITING_FOR_USER: 'Waiting for you…',
  SUCCESS: 'Done',
  ERROR: 'Error',
  SLEEPING: 'Sleeping…',
}
