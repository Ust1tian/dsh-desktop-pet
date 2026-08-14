/**
 * deepseek-harness desktop-pet plugin entry point.
 *
 * The `apply` function is the only surface Cordis calls. Everything here is
 * assembled through the compatibility boundary: the bridge (harness events)
 * feeds the state machine, which drives the renderer, which owns a native
 * overlay window. Any failure in the window/renderer path is contained so it
 * never propagates into harness execution.
 *
 * When the optional settings service exists, a `desktop-pet` namespace is
 * registered and the Web configuration page can change `enabled` (show/hide),
 * `petScale` (size), and `petId` (which bundled pet) at runtime.
 */

import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'

import { registerPetCommand } from './commands'
import { Config, type PetConfig } from './config'
import { PetStateMachine } from './core/PetStateMachine'
import type { NormalizedEvent, SemanticState } from './core/types'
import { createHarnessBridge, type HarnessBridge, type HarnessContext } from './integration/HarnessBridge'
import { loadPosition, savePosition } from './persistence'
import { loadPetAtlas } from './pets'
import { installPetSettings, type PetSettingsRegistrar, type PetSettingsSnapshot } from './settings'
import { PetWindow } from './renderer/PetWindow'
import { selectBackend } from './renderer/backend/selectBackend'

export const name = 'desktop-pet'
export const inject: string[] = []

export { Config }
export type { PetConfig }

/** A disposer may be sync or async; Cordis awaits async disposers on unload. */
type Disposer = () => void | Promise<void>

interface PetContext extends HarnessContext {
  effect(execute: () => Disposer, label?: string): Disposer
  inject(deps: string[], callback: (ctx: HarnessContext) => void): unknown
}

export function apply(ctx: Context, config: PetConfig): void {
  const petCtx = ctx as unknown as PetContext
  const log = petCtx.logger('desktop-pet')

  if (!config.enabled) {
    log.info('disabled by config; not starting')
    return
  }

  petCtx.effect(() => {
    // Shared teardown state, populated as setup completes.
    let disposed = false
    let bridge: HarnessBridge | undefined
    let window: PetWindow | undefined
    let machine: PetStateMachine | undefined
    let unsubscribe: (() => void) | undefined
    let unregisterCommand: (() => void) | undefined
    let debugState: SemanticState | undefined
    let disposeSettings: (() => void) | undefined

    let currentSettings: PetSettingsSnapshot = {
      enabled: config.enabled,
      petScale: config.petScale,
      petId: config.petId,
      hideWhenIdle: config.hideWhenIdle,
    }
    let loadedPetKey: string | null = null
    let reconcileSeq = 0

    /** Whether the window should be visible given the current state + settings. */
    function shouldBeVisible(state: SemanticState | undefined): boolean {
      if (!currentSettings.enabled) return false
      // Debug override keeps the pet visible so `/pet <state>` is inspectable.
      if (debugState !== undefined) return true
      // Auto-hide only once the machine reaches the definitively-idle sleep
      // state (a period of no activity), never during transient IDLE between
      // tool calls inside an active turn.
      if (currentSettings.hideWhenIdle && state === 'SLEEPING') return false
      return true
    }

    function applyVisibility(state: SemanticState | undefined): void {
      window?.setVisible(shouldBeVisible(state))
    }

    /** Apply a resolved settings snapshot to the window (idempotent). */
    async function reconcile(settings: PetSettingsSnapshot): Promise<void> {
      const seq = ++reconcileSeq
      const petKey = config.petPath ?? settings.petId

      if (window) {
        applyVisibility(machine?.state)
        await window.setScale(settings.petScale)
        if (petKey !== loadedPetKey) {
          loadedPetKey = petKey
          try {
            const atlas = await loadPetAtlas(settings.petId, config.petPath)
            if (disposed || seq !== reconcileSeq) return
            await window.loadPet(atlas)
          } catch (error) {
            log.warn('failed to switch pet; keeping current: %s', (error as Error)?.message ?? String(error))
          }
        }
        return
      }

      // Create the window with the current resolved settings.
      loadedPetKey = petKey
      let atlas
      try {
        atlas = await loadPetAtlas(settings.petId, config.petPath)
      } catch (error) {
        log.warn('failed to load pet assets; renderer disabled: %s', (error as Error)?.message ?? String(error))
        return
      }
      if (disposed || seq !== reconcileSeq) return

      const backend = selectBackend()
      if (!backend) {
        log.warn('no supported window backend on %s; renderer disabled', process.platform)
        return
      }

      try {
        window = new PetWindow({
          backend,
          atlas,
          scale: settings.petScale,
          alwaysOnTop: config.alwaysOnTop,
          showStatusBubble: config.showStatusBubble,
          animationEnabled: config.animationEnabled,
          idleFrequencySec: config.idleFrequencySec,
          clickThrough: config.clickThrough,
          position: loadPosition(),
          onDrag: (x, y) => savePosition({ x, y }),
          onHover: () => { window?.playJump() },
          onUnhover: () => { window?.endHover() },
        })
        await window.open()
        if (disposed) {
          await window.destroy()
          window = undefined
          return
        }
        const initialState: SemanticState = config.startSleeping ? 'SLEEPING' : 'IDLE'
        window.setState(initialState)
        applyVisibility(initialState)
        log.info('pet window created via %s backend (%s)', backend.name, petKey)
      } catch (error) {
        log.warn('failed to create pet window; renderer disabled: %s', (error as Error)?.message ?? String(error))
        window = undefined
      }
    }

    // Debug override plumbing (developer mode, /pet <state>).
    const debugHost = {
      setDebugState(state: SemanticState): void {
        debugState = state
        window?.setState(state)
        applyVisibility(state)
      },
      resetDebugState(): void {
        debugState = undefined
        if (machine) applyVisibility(machine.state)
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
        if (disposed) return
        if (debugState === undefined) {
          window?.setState(state)
        }
        // Auto-hide reacts to the machine's SLEEPING transitions.
        applyVisibility(state)
      },
    })
    unsubscribe = bridge.subscribe((event: NormalizedEvent) => {
      if (disposed) return
      machine?.onEvent(event)
    })

    // Register the optional /pet debug command.
    unregisterCommand = registerPetCommand({ commands: petCtx.get('commands') } as never, debugHost)

    // Optional settings integration: wait for the settings service, then
    // register the namespace and react to committed changes.
    petCtx.inject(['settings'], (sctx) => {
      const registrar = sctx.get('settings') as PetSettingsRegistrar | undefined
      disposeSettings = installPetSettings(registrar, currentSettings, (settings) => {
        if (disposed) return
        currentSettings = settings
        void reconcile(settings).catch((error) => {
          log.warn('settings reconcile failed: %s', (error as Error)?.message ?? String(error))
        })
      })
    })

    // Initial window creation (runs even when no settings service exists).
    void reconcile(currentSettings).catch((error) => {
      log.warn('desktop-pet startup failed: %s', (error as Error)?.message ?? String(error))
    })

    // Teardown (async so Cordis awaits window/native cleanup).
    return async () => {
      disposed = true
      disposeSettings?.()
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
