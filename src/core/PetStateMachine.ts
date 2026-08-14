/**
 * The pet's activity state machine.
 *
 * Responsibilities (all deterministic, all harness-independent):
 *   - fold per-task resolved states into one global state by priority;
 *   - suppress duplicate transitions;
 *   - hold the current state for a minimum duration unless a higher-priority
 *     state interrupts;
 *   - expire transient states (`SUCCESS` / `ERROR` / `STARTING` / `THINKING`);
 *   - fall back to `SLEEPING` after a long quiet period.
 *
 * The machine only exposes a getter and an `onEvent` input; it never touches
 * animation or rendering directly.
 */

import { resolveEvent } from './PetStateResolver'
import { STATE_PRIORITY, type TaskState } from './TaskStateRegistry'
import type { NormalizedEvent, SemanticState } from './types'

/** Injectable clock/scheduler so tests can drive time deterministically. */
export interface StateMachineClock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const realClock: StateMachineClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface StateMachineOptions {
  clock?: StateMachineClock
  /** Minimum hold time before a lower-priority state may replace the current. */
  minStateMs?: number
  /** How long `SUCCESS` / `ERROR` / `STARTING` persist before expiring. */
  flashMs?: number
  /** How long `THINKING` persists without a refresh before expiring. */
  thinkingMs?: number
  /** Quiet duration after which `IDLE` degrades to `SLEEPING`. */
  sleepAfterMs?: number
  /** Called whenever the resolved global state changes. */
  onChange?: (state: SemanticState) => void
}

/** Defaults tuned for an ambient indicator: responsive but not jittery. */
const DEFAULTS = {
  minStateMs: 250,
  flashMs: 2000,
  thinkingMs: 2000,
  sleepAfterMs: 60_000,
} as const

/**
 * Transient/terminal states a late `session.idle` must not overwrite: they
 * own their own expiry or are higher-priority facts the agent-status signal
 * is too coarse to revoke.
 */
const IDLE_PROTECTED_STATES: ReadonlySet<SemanticState> = new Set([
  'STARTING',
  'WAITING_FOR_USER',
  'SUCCESS',
  'ERROR',
])

export class PetStateMachine {
  private readonly clock: StateMachineClock
  private readonly minStateMs: number
  private readonly flashMs: number
  private readonly thinkingMs: number
  private readonly sleepAfterMs: number
  private readonly onChange: ((state: SemanticState) => void) | undefined

  private readonly tasks = new Map<string, TaskState>()
  private readonly expiryTimers = new Map<string, unknown>()

  private current: SemanticState = 'IDLE'
  private currentSince: number
  private lastActivityAt: number
  private recomputeTimer: unknown | undefined
  private sleepTimer: unknown | undefined
  private disposed = false

  constructor(options: StateMachineOptions = {}) {
    this.clock = options.clock ?? realClock
    this.minStateMs = options.minStateMs ?? DEFAULTS.minStateMs
    this.flashMs = options.flashMs ?? DEFAULTS.flashMs
    this.thinkingMs = options.thinkingMs ?? DEFAULTS.thinkingMs
    this.sleepAfterMs = options.sleepAfterMs ?? DEFAULTS.sleepAfterMs
    this.onChange = options.onChange

    const now = this.clock.now()
    this.currentSince = now
    this.lastActivityAt = now
    // Arm the quiet-period check so IDLE degrades to SLEEPING even with no
    // further events (the auto-hide feature depends on this firing).
    this.scheduleSleepCheck()
  }

  get state(): SemanticState {
    return this.current
  }

  /** The task id an event belongs to (for concurrent-agent isolation). */
  private taskIdOf(event: NormalizedEvent): string {
    return event.taskId ?? event.sessionId ?? 'default'
  }

  /**
   * Consume one normalized event. Resolution + expiry + priority collapse are
   * all handled here; the caller just forwards events.
   */
  onEvent(event: NormalizedEvent): void {
    if (this.disposed) return
    const { state, flash } = resolveEvent(event)
    const taskId = this.taskIdOf(event)
    const now = this.clock.now()

    const isActivity = state !== 'IDLE' && state !== 'SLEEPING'
    if (isActivity) this.lastActivityAt = now

    // An "idle" event (e.g. `agent/status` → idle firing right after a turn
    // ended) must not clobber a higher-priority transient that is still on
    // screen — SUCCESS/ERROR flashes, WAITING_FOR_USER, or STARTING. Those
    // states own their own expiry / terminal transition.
    const existing = this.tasks.get(taskId)
    if (state === 'IDLE' && existing !== undefined && IDLE_PROTECTED_STATES.has(existing.state)) {
      return
    }

    this.tasks.set(taskId, { state, updatedAt: now })
    this.clearExpiry(taskId)

    if (flash) {
      this.scheduleExpiry(taskId, this.flashMs)
    } else if (state === 'THINKING') {
      // Thinking has no natural "end" event; refresh on new chunks and expire
      // if the stream stops without a terminal event.
      this.scheduleExpiry(taskId, this.thinkingMs)
    }

    this.recompute()
  }

  /** Remove a task (e.g. when its session ends) and re-resolve. */
  removeTask(taskId: string): void {
    this.clearExpiry(taskId)
    this.tasks.delete(taskId)
    this.recompute()
  }

  private clearExpiry(taskId: string): void {
    const timer = this.expiryTimers.get(taskId)
    if (timer !== undefined) {
      this.clock.clearTimeout(timer)
      this.expiryTimers.delete(taskId)
    }
  }

  private scheduleExpiry(taskId: string, ms: number): void {
    const timer = this.clock.setTimeout(() => {
      this.expiryTimers.delete(taskId)
      const task = this.tasks.get(taskId)
      // Only downgrade if the task is still in the transient state we set.
      if (task && (task.state === 'SUCCESS' || task.state === 'ERROR' || task.state === 'STARTING' || task.state === 'THINKING')) {
        this.tasks.set(taskId, { state: 'IDLE', updatedAt: this.clock.now() })
        this.recompute()
      }
    }, ms)
    this.expiryTimers.set(taskId, timer)
  }

  private targetState(): SemanticState {
    let best: SemanticState = 'IDLE'
    let bestPriority = STATE_PRIORITY.IDLE
    for (const task of this.tasks.values()) {
      const priority = STATE_PRIORITY[task.state]
      if (priority > bestPriority) {
        best = task.state
        bestPriority = priority
      }
    }
    // Sleeping only applies to an already-quiet pet.
    if (best === 'IDLE' && this.clock.now() - this.lastActivityAt >= this.sleepAfterMs) {
      return 'SLEEPING'
    }
    return best
  }

  /** Re-evaluate the quiet → SLEEPING fallback after the idle window elapses. */
  private scheduleSleepCheck(): void {
    if (this.sleepTimer !== undefined) this.clock.clearTimeout(this.sleepTimer)
    this.sleepTimer = undefined
    // Only the IDLE state degrades to SLEEPING. Re-arming during an active
    // state (WORKING etc.) would busy-loop once lastActivityAt is stale, so
    // active states never arm the sleep timer.
    if (this.current !== 'IDLE') return
    const remaining = this.sleepAfterMs - (this.clock.now() - this.lastActivityAt)
    this.sleepTimer = this.clock.setTimeout(() => {
      this.sleepTimer = undefined
      if (this.disposed) return
      this.recompute()
    }, Math.max(0, remaining))
  }

  private recompute(): void {
    if (this.disposed) return
    const target = this.targetState()
    const now = this.clock.now()

    if (target === this.current) {
      // Duplicate suppression: nothing to change, nothing to schedule.
      if (this.recomputeTimer !== undefined) {
        this.clock.clearTimeout(this.recomputeTimer)
        this.recomputeTimer = undefined
      }
      this.scheduleSleepCheck()
      return
    }

    const targetPriority = STATE_PRIORITY[target]
    const currentPriority = STATE_PRIORITY[this.current]

    const higherOrEqual = targetPriority >= currentPriority
    const heldLongEnough = now - this.currentSince >= this.minStateMs

    if (higherOrEqual || heldLongEnough) {
      this.commit(target)
      this.scheduleSleepCheck()
      return
    }

    // A lower-priority downgrade arrived before the minimum hold elapsed:
    // defer it until the hold expires (coalescing bursts of quiet events).
    if (this.recomputeTimer !== undefined) return
    const remaining = this.minStateMs - (now - this.currentSince)
    this.recomputeTimer = this.clock.setTimeout(() => {
      this.recomputeTimer = undefined
      this.recompute()
    }, Math.max(0, remaining))
  }

  private commit(state: SemanticState): void {
    this.current = state
    this.currentSince = this.clock.now()
    this.onChange?.(state)
  }

  dispose(): void {
    this.disposed = true
    if (this.recomputeTimer !== undefined) {
      this.clock.clearTimeout(this.recomputeTimer)
      this.recomputeTimer = undefined
    }
    if (this.sleepTimer !== undefined) {
      this.clock.clearTimeout(this.sleepTimer)
      this.sleepTimer = undefined
    }
    for (const timer of this.expiryTimers.values()) this.clock.clearTimeout(timer)
    this.expiryTimers.clear()
    this.tasks.clear()
  }
}
