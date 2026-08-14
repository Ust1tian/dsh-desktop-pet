/**
 * The renderer's orchestrator: owns a {@link WindowBackend} handle and an
 * {@link AnimationController}, maps semantic states to Codex poses, and feeds
 * finished frames into the window.
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
import { SEMANTIC_TO_CODEX } from '../core/types'
import { AnimationController, type AnimationClock } from './AnimationController'
import type { AtlasBuffer } from './FrameDecoder'
import type { WindowBackend, WindowBackendOptions, WindowHandle } from './backend/WindowBackend'

export interface PetWindowOptions {
  backend: WindowBackend
  atlas: AtlasBuffer
  scale: number
  alwaysOnTop: boolean
  animationEnabled: boolean
  /** Seconds between idle variations (transient wave/hop). */
  idleFrequencySec: number
  position?: { x: number; y: number } | null
  clickThrough?: boolean
  clock?: AnimationClock
  random?: () => number
  onDrag?: (x: number, y: number) => void
  /** Invoked repeatedly during a drag with the horizontal direction. */
  onDragMove?: (direction: 'left' | 'right') => void
  /** Invoked when a drag ends. */
  onDragEnd?: () => void
  /** Invoked when the pointer hovers over the pet (backend rate-limits it). */
  onHover?: () => void
  /** Invoked when the pointer leaves the pet. */
  onUnhover?: () => void
  /** Invoked when the user chooses the context menu's "close pet" item. */
  onClose?: () => void
}

const BASE_WIDTH = 192
const BASE_HEIGHT = 208
const DEFAULT_POSITION = { x: 40, y: 40 } as const
// `jumping` is reserved for pointer-hover; idle variations use only `waving`.
const IDLE_TRANSIENTS: readonly CodexPetState[] = ['waving']

export class PetWindow {
  private readonly backend: WindowBackend
  private readonly animationEnabled: boolean
  private readonly idleFrequencySec: number
  private readonly clickThrough: boolean
  private readonly clock: AnimationClock
  private readonly random: () => number
  private readonly onDrag: ((x: number, y: number) => void) | undefined
  private readonly onDragMove: ((direction: 'left' | 'right') => void) | undefined
  private readonly onDragEnd: (() => void) | undefined
  private readonly onHover: (() => void) | undefined
  private readonly onUnhover: (() => void) | undefined
  private readonly onClose: (() => void) | undefined

  private atlas: AtlasBuffer
  private scale: number
  private currentX: number
  private currentY: number

  private handle: WindowHandle | undefined
  private controller: AnimationController | undefined
  private idleTimer: unknown | undefined
  private semantic: SemanticState = 'IDLE'
  private visible = true
  private opened = false
  private destroyed = false
  private hovered = false
  private dragging = false

  constructor(options: PetWindowOptions) {
    this.backend = options.backend
    this.atlas = options.atlas
    this.scale = options.scale
    this.animationEnabled = options.animationEnabled
    this.idleFrequencySec = options.idleFrequencySec
    this.clickThrough = options.clickThrough ?? false
    this.clock = options.clock ?? { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }
    this.random = options.random ?? Math.random
    this.onDrag = options.onDrag
    this.onDragMove = options.onDragMove
    this.onDragEnd = options.onDragEnd
    this.onHover = options.onHover
    this.onUnhover = options.onUnhover
    this.onClose = options.onClose

    const position = options.position ?? DEFAULT_POSITION
    this.currentX = position.x
    this.currentY = position.y
  }

  /** Create the overlay window and start the animation loop. */
  async open(): Promise<void> {
    if (this.destroyed || this.opened) return
    this.opened = true

    const width = Math.max(1, Math.round(BASE_WIDTH * this.scale))
    const height = Math.max(1, Math.round(BASE_HEIGHT * this.scale))

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
      onDragMove: (direction) => {
        this.beginDrag(direction)
      },
      onDragEnd: () => {
        this.endDrag()
      },
      onHover: () => {
        this.onHover?.()
      },
      onUnhover: () => {
        this.onUnhover?.()
      },
      onClose: () => {
        this.onClose?.()
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

  /** The current renderer pose (for diagnostics/tests). */
  get currentPose(): CodexPetState | undefined {
    return this.controller?.currentState
  }

  /** Set the semantic state; the pose is derived, not caller-decided. */
  setState(state: SemanticState): void {
    this.semantic = state
    if (!this.controller || this.destroyed) return
    // While dragging, defer the pose switch so it does not interrupt the
    // direction animation; endDrag applies the latest semantic state.
    if (this.dragging) return
    this.applyState(state)
  }

  /** Enter the drag animation, playing the direction pose. */
  private beginDrag(direction: 'left' | 'right'): void {
    if (this.destroyed || !this.controller) return
    this.dragging = true
    this.cancelIdleVariation()
    this.controller.setState(direction === 'left' ? 'running-left' : 'running-right')
  }

  /** Exit the drag animation and return to the current semantic pose. */
  private endDrag(): void {
    if (this.destroyed || !this.controller) return
    this.dragging = false
    this.applyState(this.semantic)
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
    try {
      this.handle.present(frame)
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
