/**
 * The renderer's orchestrator: owns a {@link WindowBackend} handle and an
 * {@link AnimationController}, maps semantic states to Codex poses, and feeds
 * finished frames (pet + optional status bubble) into the window.
 *
 * Idle "alive" behavior lives here: when idle, a low-frequency randomized
 * transient (a wave or hop) plays so the pet never looks frozen, without
 * driving aggressive continuous animation.
 *
 * Live settings changes (scale / pet atlas / visibility) rebuild the window
 * in place: the backend handle and animation controller are torn down and
 * recreated, while the current position is preserved.
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
  /** Invoked when the pointer hovers over the pet (backend rate-limits it). */
  onHover?: () => void
  /** Invoked when the pointer leaves the pet. */
  onUnhover?: () => void
}

const BASE_WIDTH = 192
const BASE_HEIGHT = 208
/** Extra vertical rows reserved for the status bubble, so the window DIB is
 *  tall enough for every rendered frame (a frame taller than the DIB made
 *  `UpdateLayeredWindow` fail and freeze the pet on the last good frame). */
const BUBBLE_RESERVE = 24
const DEFAULT_POSITION = { x: 40, y: 40 } as const
// `jumping` is reserved for pointer-hover; idle variations use only `waving`.
const IDLE_TRANSIENTS: readonly CodexPetState[] = ['waving']

export class PetWindow {
  private readonly backend: WindowBackend
  private readonly showStatusBubble: boolean
  private readonly animationEnabled: boolean
  private readonly idleFrequencySec: number
  private readonly clickThrough: boolean
  private readonly clock: AnimationClock
  private readonly random: () => number
  private readonly onDrag: ((x: number, y: number) => void) | undefined
  private readonly onHover: (() => void) | undefined
  private readonly onUnhover: (() => void) | undefined

  private atlas: AtlasBuffer
  private scale: number
  private currentX: number
  private currentY: number

  private handle: WindowHandle | undefined
  private controller: AnimationController | undefined
  private idleTimer: unknown | undefined
  private semantic: SemanticState = 'IDLE'
  private statusText = ''
  private visible = true
  private opened = false
  private destroyed = false
  private hovered = false

  constructor(options: PetWindowOptions) {
    this.backend = options.backend
    this.atlas = options.atlas
    this.scale = options.scale
    this.showStatusBubble = options.showStatusBubble
    this.animationEnabled = options.animationEnabled
    this.idleFrequencySec = options.idleFrequencySec
    this.clickThrough = options.clickThrough ?? false
    this.clock = options.clock ?? { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }
    this.random = options.random ?? Math.random
    this.onDrag = options.onDrag
    this.onHover = options.onHover
    this.onUnhover = options.onUnhover

    const position = options.position ?? DEFAULT_POSITION
    this.currentX = position.x
    this.currentY = position.y
  }

  /** Create the overlay window and start the animation loop. */
  async open(): Promise<void> {
    if (this.destroyed || this.opened) return
    this.opened = true

    const width = Math.max(1, Math.round(BASE_WIDTH * this.scale))
    // Reserve the bubble strip up front so the window DIB always fits the
    // composed frame (pet + optional status bubble).
    const height = Math.max(1, Math.round((BASE_HEIGHT + (this.showStatusBubble ? BUBBLE_RESERVE : 0)) * this.scale))

    const opts: WindowBackendOptions = {
      width,
      height,
      x: this.currentX,
      y: this.currentY,
      alwaysOnTop: true,
      clickThrough: this.clickThrough,
      onDrag: (x, y) => {
        this.currentX = x
        this.currentY = y
        this.onDrag?.(x, y)
      },
      onHover: () => {
        this.onHover?.()
      },
      onUnhover: () => {
        this.onUnhover?.()
      },
    }
    this.handle = await this.backend.create(opts)

    this.controller = new AnimationController({
      atlas: this.atlas,
      scale: this.scale,
      clock: this.clock,
      onFrame: (frame) => this.present(frame),
    })
    if (this.animationEnabled) this.controller.start()
    this.applyState(this.semantic)
    if (!this.visible) this.handle.hide()
  }

  /** Set the semantic state; the pose is derived, not caller-decided. */
  setState(state: SemanticState): void {
    this.semantic = state
    this.statusText = STATUS_BUBBLE[state] ?? ''
    if (!this.controller || this.destroyed) return
    this.applyState(state)
  }

  /** Show or hide the pet without disposing it. */
  setVisible(visible: boolean): void {
    this.visible = visible
    if (this.destroyed || !this.handle) return
    if (visible) this.handle.show()
    else this.handle.hide()
  }

  /** Resize the pet by rebuilding the window to the new scale. */
  async setScale(scale: number): Promise<void> {
    if (this.destroyed || scale === this.scale) return
    this.scale = scale
    await this.recreate()
  }

  /** Swap the sprite atlas (a different pet) by rebuilding the window. */
  async loadPet(atlas: AtlasBuffer): Promise<void> {
    if (this.destroyed || atlas === this.atlas) return
    this.atlas = atlas
    await this.recreate()
  }

  private async recreate(): Promise<void> {
    if (!this.opened || this.destroyed) return
    this.teardownWindow()
    this.opened = false
    await this.open()
  }

  private applyState(state: SemanticState): void {
    const pose = SEMANTIC_TO_CODEX[state] ?? 'idle'
    this.controller?.setState(pose)
    if (pose === 'idle') this.scheduleIdleVariation()
    else this.cancelIdleVariation()
  }

  /** Play the hover reaction (`jumping`) once, then return to the current state. */
  playJump(): void {
    if (this.destroyed || !this.controller) return
    // WM_NCMOUSEMOVE fires continuously while the pointer moves over the pet;
    // only react on the hover *edge*, otherwise the transient never completes.
    if (this.hovered) return
    this.hovered = true
    this.controller.playTransient('jumping', SEMANTIC_TO_CODEX[this.semantic] ?? 'idle')
  }

  /** End the hover reaction and return to the current semantic pose. */
  endHover(): void {
    if (this.destroyed || !this.controller) return
    this.hovered = false
    this.controller.setState(SEMANTIC_TO_CODEX[this.semantic] ?? 'idle')
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
    // The window is always created with the bubble strip reserved, so compose
    // into the full window size every frame (idle leaves the strip transparent;
    // active states draw the label into it). This keeps the frame dimensions
    // equal to the DIB dimensions, so UpdateLayeredWindow never fails.
    const windowWidth = Math.max(1, Math.round(BASE_WIDTH * this.scale))
    const windowHeight = Math.max(1, Math.round((BASE_HEIGHT + (this.showStatusBubble ? BUBBLE_RESERVE : 0)) * this.scale))
    const text = this.showStatusBubble ? this.statusText : ''
    const rendered = compositeStatusBubble(frame, text, windowWidth, windowHeight)
    try {
      this.handle.present(rendered)
    } catch {
      // A failed frame must not propagate into the harness. Swallow and keep
      // the loop; the next frame may succeed.
    }
  }

  show(): void {
    this.setVisible(true)
  }

  hide(): void {
    this.setVisible(false)
  }

  private teardownWindow(): void {
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

  async destroy(): Promise<void> {
    if (this.destroyed) return
    this.destroyed = true
    this.teardownWindow()
  }
}
