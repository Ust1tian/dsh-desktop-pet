/**
 * Tracks per-task/per-agent activity so the resolver can fold concurrent
 * work into a single global pet state.
 *
 * Concurrent agents and subagents are supported by keying activity under a
 * task id; a global state is then chosen by priority in {@link PetStateResolver}.
 */

import type { SemanticState } from './types'

/** Priority used to collapse many task states into one global state. */
export const STATE_PRIORITY: Readonly<Record<SemanticState, number>> = {
  WAITING_FOR_USER: 60,
  ERROR: 50,
  WORKING: 40,
  CODING: 40,
  RUNNING_COMMAND: 40,
  THINKING: 30,
  SUCCESS: 20,
  STARTING: 10,
  IDLE: 0,
  SLEEPING: -10,
}

export interface TaskState {
  state: SemanticState
  /** Epoch ms of the last transition for this task. */
  updatedAt: number
}

export class TaskStateRegistry {
  private readonly tasks = new Map<string, TaskState>()

  set(taskId: string, state: SemanticState, now = Date.now()): void {
    this.tasks.set(taskId, { state, updatedAt: now })
  }

  get(taskId: string): TaskState | undefined {
    return this.tasks.get(taskId)
  }

  delete(taskId: string): boolean {
    return this.tasks.delete(taskId)
  }

  clear(): void {
    this.tasks.clear()
  }

  get size(): number {
    return this.tasks.size
  }

  /** The highest-priority state across all tracked tasks, or `IDLE` if none. */
  globalState(): SemanticState {
    let best: SemanticState = 'IDLE'
    let bestPriority = STATE_PRIORITY.IDLE
    for (const task of this.tasks.values()) {
      const priority = STATE_PRIORITY[task.state]
      if (priority > bestPriority) {
        best = task.state
        bestPriority = priority
      }
    }
    return best
  }
}
