/**
 * The window backend contract.
 *
 * A backend owns a single transparent, frameless, always-on-top overlay and
 * presents finished RGBA frames into it. Platform-specific implementations
 * (`Win32Backend`, `X11Backend`) keep every native detail behind this
 * interface; the renderer only knows {@link WindowBackend}.
 */

import type { PetFrame } from '../FrameDecoder'

export interface WindowBackendOptions {
  width: number
  height: number
  x: number
  y: number
  alwaysOnTop: boolean
  /** When true the window ignores pointer input (Windows only). */
  clickThrough?: boolean
  /** Invoked after the user drags the window to a new position. */
  onDrag?: (x: number, y: number) => void
  /** Invoked repeatedly during a drag with the horizontal direction. */
  onDragMove?: (direction: 'left' | 'right') => void
  /** Invoked when a drag ends. */
  onDragEnd?: () => void
  /** Invoked when the pointer hovers over the pet (rate-limited by the backend). */
  onHover?: () => void
  /** Invoked when the pointer leaves the pet. */
  onUnhover?: () => void
  /** Invoked when the user chooses the context menu's "close pet" item. */
  onClose?: () => void
}

export interface WindowHandle {
  /** Present a full-window RGBA frame (size must match the created window). */
  present(frame: PetFrame): void
  move(x: number, y: number): void
  setAlwaysOnTop(value: boolean): void
  show(): void
  hide(): void
  destroy(): void
}

export interface WindowBackend {
  /** Human-readable backend name for diagnostics. */
  readonly name: string
  /** Whether this backend can run in the current process/platform. */
  isSupported(): boolean
  /** Create and map the overlay window. Resolves once it is visible. */
  create(options: WindowBackendOptions): Promise<WindowHandle>
}

export type { PetFrame }
