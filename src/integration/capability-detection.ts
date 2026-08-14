/**
 * Runtime capability detection.
 *
 * The pet must load even when optional Harness services are absent. Detection
 * only probes a context via `ctx.get(...)` and returns booleans; consumers
 * degrade instead of failing. No capability here is required for the pet to
 * show and animate — only the richer states depend on them.
 */

import type { HarnessContext } from './HarnessBridge'

/** Service names whose presence gates optional behaviors. */
export interface Capabilities {
  /** `ctx.commands` — enables the `/pet` developer/debug command. */
  commands: boolean
  /** `ctx.agents` — enables per-agent task tracking. */
  agents: boolean
  /** `ctx.approval` — enables WAITING_FOR_USER via approval requests. */
  approval: boolean
  /** `ctx.sessions` — enables session id capture. */
  sessions: boolean
}

export type CapabilityName = keyof Capabilities

const PROBES: Readonly<Record<CapabilityName, string>> = {
  commands: 'commands',
  agents: 'agents',
  approval: 'approval',
  sessions: 'sessions',
}

/**
 * Probe a context for optional services. `ctx.get` returns `undefined` for an
 * unprovided service, so a boolean presence check is sufficient.
 */
export function detectCapabilities(ctx: HarnessContext): Readonly<Record<string, boolean>> {
  const result: Record<string, boolean> = {}
  for (const [name, service] of Object.entries(PROBES) as [CapabilityName, string][]) {
    let present = false
    try {
      present = ctx.get(service) !== undefined
    } catch {
      present = false
    }
    result[name] = present
  }
  return result
}

/**
 * Interpret a capabilities record into the concrete {@link Capabilities}
 * shape (missing keys default to `false`).
 */
export function capabilitiesFrom(record: Readonly<Record<string, boolean>>): Capabilities {
  return {
    commands: record.commands === true,
    agents: record.agents === true,
    approval: record.approval === true,
    sessions: record.sessions === true,
  }
}
