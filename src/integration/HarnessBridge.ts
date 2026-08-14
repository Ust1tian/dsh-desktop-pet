/**
 * The compatibility boundary between deepseek-harness and the pet core.
 *
 * Everything harness-specific lives here (or in `capability-detection.ts` /
 * `event-mapping.ts`): which events are subscribed, how services are probed,
 * and how raw payloads become {@link NormalizedEvent}s. Nothing above this
 * layer ever imports a harness package or sees a raw harness object.
 */

import type { NormalizedEvent } from '../core/types'
import { detectCapabilities } from './capability-detection'
import { mapAgentStatus, mapSessionEvent } from './event-mapping'

/** The minimal structural shape the bridge needs from a Cordis context. */
export interface HarnessLogger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

/** A disposer returned by `ctx.on`-style registrations. */
export type Disposable = () => void

export interface HarnessContext {
  on(name: string, listener: (...args: any[]) => any, options?: { prepend?: boolean; global?: boolean }): Disposable
  get(name: string): unknown
  logger(name?: string): HarnessLogger
}

export interface HarnessBridge {
  start(): Promise<void>
  stop(): Promise<void>
  subscribe(callback: (event: NormalizedEvent) => void): Disposable
  /** Capabilities detected at start time; consumers degrade on absence. */
  readonly capabilities: Readonly<Record<string, boolean>>
}

type Listener = (event: NormalizedEvent) => void

/**
 * Build a bridge over a live Cordis context.
 *
 * The bridge subscribes to the stable `session/event` and `agent/status`
 * events (both are part of the core Harness surface) and normalizes them.
 * Optional richer signals (`approval/*` session events, tool names) are read
 * defensively when present.
 */
export function createHarnessBridge(ctx: HarnessContext): HarnessBridge {
  const log = ctx.logger('desktop-pet')
  const capabilities = detectCapabilities(ctx)
  const listeners = new Set<Listener>()
  const disposers: Disposable[] = []
  let started = false

  function dispatch(event: NormalizedEvent): void {
    for (const listener of listeners) {
      // Isolate the pet from a misbehaving consumer of its own events.
      try {
        listener(event)
      } catch (error) {
        log.warn('pet event listener threw: %s', (error as Error)?.message ?? String(error))
      }
    }
  }

  function start(): Promise<void> {
    if (started) return Promise.resolve()
    started = true

    // Primary activity stream. `session/event` is dispatched with a
    // `Scoped<Session>` carrier and context-filtered; `{ global: true }` opts
    // this listener out of that filter so the (unscoped) pet still receives
    // every session's events.
    disposers.push(
      ctx.on('session/event', (session: unknown, event: unknown) => {
        const normalized = mapSessionEvent(session, event)
        if (normalized) dispatch(normalized)
      }, { global: true }),
    )

    // Idle detection via agent status changes. Same scoping note as above:
    // `agent/status` is dispatched per-agent; a global listener sees all agents.
    disposers.push(
      ctx.on('agent/status', (payload: unknown) => {
        const normalized = mapAgentStatus(payload)
        if (normalized) dispatch(normalized)
      }, { global: true }),
    )

    log.debug('bridge started (%s)', Object.keys(capabilities).filter(k => capabilities[k]).join(', ') || 'no optional capabilities')
    return Promise.resolve()
  }

  async function stop(): Promise<void> {
    if (!started) return
    started = false
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch (error) {
        log.debug('dispose during stop failed: %s', (error as Error)?.message ?? String(error))
      }
    }
    listeners.clear()
    log.debug('bridge stopped')
  }

  function subscribe(callback: Listener): Disposable {
    listeners.add(callback)
    let active = true
    return () => {
      if (!active) return
      active = false
      listeners.delete(callback)
    }
  }

  return { start, stop, subscribe, capabilities }
}
