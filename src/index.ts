/**
 * deepseek-harness desktop-pet plugin entry point.
 *
 * The `apply` function is the only surface Cordis calls. Everything here is
 * assembled through the compatibility boundary: the bridge (harness events)
 * feeds the state machine, which drives the renderer, which owns a native
 * overlay window. Any failure in the window/renderer path is contained so it
 * never propagates into harness execution.
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

import { registerPetCommand } from './commands'
import { Config, type PetConfig } from './config'
import { PetStateMachine } from './core/PetStateMachine'
import type { NormalizedEvent, SemanticState } from './core/types'
import { createHarnessBridge, type HarnessBridge, type HarnessContext } from './integration/HarnessBridge'
import { loadPosition, savePosition } from './persistence'
import { PetWindow } from './renderer/PetWindow'
import { loadPet } from './renderer/codex-pet/PetLoader'
import { selectBackend } from './renderer/backend/selectBackend'

export const name = 'desktop-pet'
export const inject: string[] = []

export { Config }
export type { PetConfig }

/** A disposer may be sync or async; Cordis awaits async disposers on unload. */
type Disposer = () => void | Promise<void>

interface PetContext extends HarnessContext {
  effect(execute: () => Disposer, label?: string): Disposer
  commands?: unknown
}

const DEFAULT_ASSETS_DIR = fileURLToPath(new URL('../assets/', import.meta.url))

/** Resolve the pet directory: explicit config wins, else bundled assets. */
function resolvePetDirectory(config: PetConfig): string {
  return config.petPath ?? DEFAULT_ASSETS_DIR
}

export function apply(ctx: Context, config: PetConfig): void {
  const petCtx = ctx as unknown as PetContext
  const log = petCtx.logger('desktop-pet')

  if (!config.enabled) {
    log.info('disabled by config; not starting')
    return
  }

  petCtx.effect(() => {
    // Shared teardown state, populated as async setup completes.
    let disposed = false
    let bridge: HarnessBridge | undefined
    let window: PetWindow | undefined
    let machine: PetStateMachine | undefined
    let unsubscribe: (() => void) | undefined
    let unregisterCommand: (() => void) | undefined
    let debugState: SemanticState | undefined

    // Debug override plumbing (developer mode, /pet <state>).
    const debugHost = {
      setDebugState(state: SemanticState): void {
        debugState = state
        window?.setState(state)
      },
      resetDebugState(): void {
        debugState = undefined
      },
    }

    // Sync: start the bridge (subscriptions are installed synchronously).
    bridge = createHarnessBridge(petCtx)
    void bridge.start().catch((error) => {
      log.warn('bridge start failed: %s', (error as Error)?.message ?? String(error))
    })

    // Sync: build the state machine and wire events → window.
    machine = new PetStateMachine({
      onChange: (state) => {
        if (disposed || debugState !== undefined) return
        window?.setState(state)
      },
    })
    unsubscribe = bridge.subscribe((event: NormalizedEvent) => {
      if (disposed) return
      machine?.onEvent(event)
    })

    // Register the optional /pet debug command.
    unregisterCommand = registerPetCommand({ commands: petCtx.commands } as never, debugHost)

    // Async: load assets and create the overlay window.
    void (async () => {
      let atlas
      try {
        atlas = await loadPet({ directory: resolvePetDirectory(config) })
      } catch (error) {
        log.warn('failed to load pet assets; renderer disabled: %s', (error as Error)?.message ?? String(error))
        return
      }
      if (disposed) return

      const backend = selectBackend()
      if (!backend) {
        log.warn('no supported window backend on %s; renderer disabled', process.platform)
        return
      }

      try {
        window = new PetWindow({
          backend,
          atlas: { width: atlas.atlasWidth, height: atlas.atlasHeight, rgba: atlas.rgba },
          scale: config.petScale * config.animationSpeed,
          alwaysOnTop: config.alwaysOnTop,
          showStatusBubble: config.showStatusBubble,
          animationEnabled: config.animationEnabled,
          idleFrequencySec: config.idleFrequencySec,
          clickThrough: config.clickThrough,
          position: loadPosition(),
          onDrag: (x, y) => savePosition({ x, y }),
        })
        await window.open()
        if (disposed) {
          await window.destroy()
          window = undefined
          return
        }
        window.setState(config.startSleeping ? 'SLEEPING' : 'IDLE')
        log.info('pet window created via %s backend', backend.name)
      } catch (error) {
        log.warn('failed to create pet window; renderer disabled: %s', (error as Error)?.message ?? String(error))
        window = undefined
      }
    })().catch((error) => {
      log.warn('desktop-pet async setup failed: %s', (error as Error)?.message ?? String(error))
    })

    // Teardown (async so Cordis awaits window/native cleanup).
    return async () => {
      disposed = true
      unsubscribe?.()
      unregisterCommand?.()
      machine?.dispose()
      await bridge?.stop().catch(() => {})
      await window?.destroy().catch(() => {})
      bridge = undefined
      window = undefined
      machine = undefined
    }
  })
}
