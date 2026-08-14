/**
 * The renderer's orchestrator: owns a {@link WindowBackend} handle and an
 * {@link AnimationController}, maps semantic states to Codex poses, and feeds
 * finished frames (pet + optional status bubble) into the window.
 *
 * Idle "alive" behavior lives here: when idle, a low-frequency randomized
 * transient (a wave or hop) plays so the pet never looks frozen, without
 * driving aggressive continuous animation.
 */

import type { CodexPetState, SemanticState } from '../core/types'
import { SEMANTIC_TO_CODEX, STATUS_BUBBLE } from '../core/types'
import { AnimationController, type AnimationClock } from './AnimationController'
import { compositeStatusBubble } from './StatusBubble'
import type { AtlasBuffer } from './FrameDecoder'
import type { WindowBackend, WindowBackendOptions, WindowHandle } from './backend/WindowBackend'

export interface PetWindowOptions {
  backend: WindowBackend
  atlas: AtlasBuffer
  scale: number
  alwaysOnTop: boolean
  showStatusBubble: boolean
  animationEnabled: boolean
  /** Seconds between idle variations (transient wave/hop). */
  idleFrequencySec: number
  position?: { x: number; y: number } | null
  clickThrough?: boolean
  clock?: AnimationClock
  random?: () => number
  onDrag?: (x: number, y: number) => void
}

const BASE_WIDTH = 192
const BASE_HEIGHT = 208
const IDLE_TRANSIENTS: readonly CodexPetState[] = ['waving', 'jumping']

export class PetWindow {
  private readonly backend: WindowBackend
  private readonly atlas: AtlasBuffer
  private readonly scale: number
  private readonly showStatusBubble: boolean
  private readonly animationEnabled: boolean
  private readonly idleFrequencySec: number
  private readonly clickThrough: boolean
  private readonly position: { x: number; y: number } | null | undefined
  private readonly clock: AnimationClock
  private readonly random: () => number
  private readonly onDrag: ((x: number, y: number) => void) | undefined

  private handle: WindowHandle | undefined
  private controller: AnimationController | undefined
  private idleTimer: unknown | undefined
  private semantic: SemanticState = 'IDLE'
  private statusText = ''
  private destroyed = false

  constructor(options: PetWindowOptions) {
    this.backend = options.backend
    this.atlas = options.atlas
    this.scale = options.scale
    this.showStatusBubble = options.showStatusBubble
    this.animationEnabled = options.animationEnabled
    this.idleFrequencySec = options.idleFrequencySec
    this.clickThrough = options.clickThrough ?? false
    this.position = options.position
    this.clock = options.clock ?? { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }
    this.random = options.random ?? Math.random
    this.onDrag = options.onDrag
  }

  /** Create the overlay window and start the animation loop. */
  async open(): Promise<void> {
    if (this.destroyed) return

    const width = Math.max(1, Math.round(BASE_WIDTH * (this.scale ?? 1)))
    const height = Math.max(1, Math.round(BASE_HEIGHT * (this.scale ?? 1)))
    const position = this.defaultPosition(width, height)

    const opts: WindowBackendOptions = {
      width,
      height,
      x: position.x,
      y: position.y,
      alwaysOnTop: true,
      clickThrough: this.clickThrough,
      onDrag: this.onDrag,
    }
    this.handle = await this.backend.create(opts)

    this.controller = new AnimationController({
      atlas: this.atlas,
      scale: this.scale ?? 1,
      clock: this.clock,
      onFrame: (frame) => this.present(frame),
    })
    if (this.animationEnabled) this.controller.start()
    this.applyState(this.semantic)
  }

  private defaultPosition(width: number, height: number): { x: number; y: number } {
    if (this.position) return { x: this.position.x, y: this.position.y }
    return { x: 40, y: 40 }
  }

  /** Set the semantic state; the pose is derived, not caller-decided. */
  setState(state: SemanticState): void {
    this.semantic = state
    this.statusText = STATUS_BUBBLE[state] ?? ''
    if (!this.controller || this.destroyed) return
    this.applyState(state)
  }

  private applyState(state: SemanticState): void {
    const pose = SEMANTIC_TO_CODEX[state] ?? 'idle'
    this.controller?.setState(pose)
    if (pose === 'idle') this.scheduleIdleVariation()
    else this.cancelIdleVariation()
  }

  private scheduleIdleVariation(): void {
    this.cancelIdleVariation()
    const ms = Math.max(8, this.idleFrequencySec) * 1000 * (0.7 + this.random() * 0.6)
    this.idleTimer = this.clock.setTimeout(() => {
      this.idleTimer = undefined
      if (this.destroyed || !this.controller) return
      const transient = IDLE_TRANSIENTS[Math.floor(this.random() * IDLE_TRANSIENTS.length)]
      this.controller.playTransient(transient, 'idle')
      // Re-arm the next idle variation once the transient settles.
      this.idleTimer = this.clock.setTimeout(() => {
        this.idleTimer = undefined
        if (this.semantic === 'IDLE') this.scheduleIdleVariation()
      }, 1500)
    }, ms)
  }

  private cancelIdleVariation(): void {
    if (this.idleTimer !== undefined) {
      this.clock.clearTimeout(this.idleTimer)
      this.idleTimer = undefined
    }
  }

  private present(frame: import('./FrameDecoder').PetFrame): void {
    if (this.destroyed || !this.handle) return
    const rendered = this.showStatusBubble && this.statusText !== '' ? compositeStatusBubble(frame, this.statusText) : frame
    try {
      this.handle.present(rendered)
    } catch {
      // A failed frame must not propagate into the harness. Swallow and keep
      // the loop; the next frame may succeed.
    }
  }

  show(): void {
    this.handle?.show()
  }

  hide(): void {
    this.handle?.hide()
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return
    this.destroyed = true
    this.cancelIdleVariation()
    this.controller?.dispose()
    this.controller = undefined
    try {
      this.handle?.destroy()
    } catch {
      // Best-effort native teardown.
    }
    this.handle = undefined
  }
}
