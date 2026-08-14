/**
 * A deterministic clock + timer for driving the state machine and animation
 * controller in unit tests without real time.
 */

import type { StateMachineClock } from '../../src/core/PetStateMachine'
import type { AnimationClock } from '../../src/renderer/AnimationController'

interface Scheduled {
  id: number
  at: number
  fn: () => void
}

export function createFakeClock(startMs = 0) {
  let now = startMs
  let nextId = 1
  const scheduled = new Map<number, Scheduled>()

  const clock: StateMachineClock & AnimationClock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      const id = nextId++
      scheduled.set(id, { id, at: now + ms, fn })
      return id
    },
    clearTimeout: (handle) => {
      scheduled.delete(handle as number)
    },
  }

  return {
    clock,
    now: () => now,
    /** Advance time by `ms`, firing timers whose deadline passes. */
    advance(ms: number): void {
      const target = now + ms
      // Fire in deadline order; a timer's callback may schedule more timers.
      for (;;) {
        let next: Scheduled | undefined
        for (const s of scheduled.values()) {
          if (s.at <= target && (!next || s.at < next.at)) next = s
        }
        if (!next) break
        scheduled.delete(next.id)
        now = next.at
        next.fn()
      }
      now = target
    },
    pendingCount: () => scheduled.size,
  }
}
