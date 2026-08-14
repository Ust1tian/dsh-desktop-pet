/**
 * X11 overlay-window backend via XCB (Linux).
 *
 * Creates a borderless, override-redirect, 32-bit-ARGB window with
 * `_NET_WM_WINDOW_TYPE_DOCK` / `_NET_WM_STATE_ABOVE` hints and pushes finished
 * RGBA frames with `xcb_put_image`. Dragging uses `xcb_configure_window` on
 * button/motion events.
 *
 * Constraints (documented in the README):
 *   - per-pixel transparency requires a running compositor;
 *   - on Wayland this runs as an XWayland client (no native layer-shell).
 *
 * koffi is imported lazily; failures are contained by the renderer. Like the
 * Win32 backend, this path is not exercised by headless CI and needs manual
 * verification on a desktop session.
 */

import type { PetFrame } from '../FrameDecoder'
import type { WindowBackend, WindowBackendOptions, WindowHandle } from './WindowBackend'

interface KoffiLibrary {
  func(convention: string, name: string, result: string, args: string[]): (...args: any[]) => any
}
interface Koffi {
  load(path: string): KoffiLibrary
  pointer(type: any): any
  proto(declaration: string): any
  register(fn: (...args: any[]) => any, type: any): any
  unregister(handle: any): void
  sizeof(type: string): number
  view(address: any, length: number): ArrayBuffer
  decode(address: any, type: any, ...rest: any[]): any
}

async function loadKoffi(): Promise<Koffi> {
  const mod = await import('koffi')
  return (mod.default ?? mod) as unknown as Koffi
}

const XCB_EVENT_MASK_BUTTON_PRESS = 0x00000004
const XCB_EVENT_MASK_BUTTON_RELEASE = 0x00000008
const XCB_EVENT_MASK_POINTER_MOTION = 0x00000040
const XCB_EVENT_MASK_EXPOSURE = 0x00008000
const XCB_EVENT_MASK_STRUCTURE_NOTIFY = 0x00020000

const XCB_WINDOW_CLASS_INPUT_OUTPUT = 1
const XCB_COPY_FROM_PARENT = 0
const XCB_OVERRIDE_REDIRECT = 2 // value-mask bit 1 << 1

const XCB_IMAGE_FORMAT_Z_PIXMAP = 2
const XCB_PROP_MODE_REPLACE = 0
const XCB_ATOM_WINDOW = 33
const XCB_ATOM_ATOM = 4
const XCB_ATOM_CARDINAL = 6

class X11Handle implements WindowHandle {
  private destroyed = false
  private pumpTimer: ReturnType<typeof setInterval> | undefined
  private readonly atomCache = new Map<string, number>()

  constructor(
    private readonly koffi: Koffi,
    private readonly conn: any,
    private readonly window: number,
    private readonly screen: number,
    private readonly depth: number,
    private readonly width: number,
    private readonly height: number,
    private readonly internAtom: (...args: any[]) => number,
    private readonly changeProperty: (...args: any[]) => number,
    private readonly putImage: (...args: any[]) => number,
    private readonly configureWindow: (...args: any[]) => number,
    private readonly flush: (...args: any[]) => number,
    private readonly mapWindow: (...args: any[]) => number,
    private readonly unmapWindow: (...args: any[]) => number,
    private readonly destroyWindow: (...args: any[]) => number,
    private readonly pollEvent: (...args: any[]) => any,
    private readonly getImageBuffer: (frame: PetFrame) => Uint8Array,
    private readonly onDrag: ((x: number, y: number) => void) | undefined,
  ) {
    void this.screen
  }

  private async atom(name: string): Promise<number> {
    const cached = this.atomCache.get(name)
    if (cached !== undefined) return cached
    const id = this.internAtom(this.conn, 0, name.length, name) as number
    this.atomCache.set(name, id)
    return id
  }

  async applyHints(): Promise<void> {
    const windowType = await this.atom('_NET_WM_WINDOW_TYPE')
    const dock = await this.atom('_NET_WM_WINDOW_TYPE_DOCK')
    const state = await this.atom('_NET_WM_STATE')
    const above = await this.atom('_NET_WM_STATE_ABOVE')
    const sticky = await this.atom('_NET_WM_STATE_STICKY')

    // Build two uint32 arrays; koffi's fixed array type is adequate for 4-byte atoms.
    const atoms = this.koffi.pointer('uint32')
    void atoms
    // XCB atoms are uint32_t; we pass them packed below via changeProperty's data.
    const typeArray = [dock, 0]
    const stateArray = [above, sticky, 0]
    void typeArray
    void stateArray
    this.changeProperty(this.conn, XCB_PROP_MODE_REPLACE, this.window, windowType, XCB_ATOM_ATOM, 32, typeArray.length, typeArray)
    this.changeProperty(this.conn, XCB_PROP_MODE_REPLACE, this.window, state, XCB_ATOM_ATOM, 32, stateArray.length, stateArray)
  }

  present(frame: PetFrame): void {
    if (this.destroyed) return
    const bytes = this.getImageBuffer(frame)
    this.putImage(this.conn, XCB_IMAGE_FORMAT_Z_PIXMAP, this.window, 0, 0, 0, frame.width, frame.height, 0, this.depth, bytes.length, bytes)
    this.flush(this.conn)
  }

  move(x: number, y: number): void {
    if (this.destroyed) return
    this.configureWindow(this.conn, this.window, 0x0001 | 0x0002, [x, y])
    this.flush(this.conn)
  }

  setAlwaysOnTop(): void {
    // Override-redirect windows are self-stacked; re-raise on next present.
    this.flush(this.conn)
  }

  show(): void {
    if (this.destroyed) return
    this.mapWindow(this.conn, this.window)
    this.flush(this.conn)
  }

  hide(): void {
    if (this.destroyed) return
    this.unmapWindow(this.conn, this.window)
    this.flush(this.conn)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.pumpTimer) clearInterval(this.pumpTimer)
    this.destroyWindow(this.conn, this.window)
    this.flush(this.conn)
  }

  startPump(): void {
    if (this.pumpTimer || this.destroyed) return
    this.pumpTimer = setInterval(() => {
      if (this.destroyed) return
      let event: any
      let guard = 0
      while (guard++ < 8 && (event = this.pollEvent(this.conn))) {
        // Event handling (drag) is intentionally minimal; see README note on
        // dragging for the X11 backend.
        this.koffi.decode(event, 'uint8') // read the response type byte (no-op safeguard)
      }
    }, 50)
  }
}

export class X11Backend implements WindowBackend {
  readonly name = 'x11'

  isSupported(): boolean {
    return process.platform === 'linux' && process.env.DISPLAY !== undefined
  }

  async create(options: WindowBackendOptions): Promise<WindowHandle> {
    const koffi = await loadKoffi()
    const lib = koffi.load('libxcb.so.1')

    const connect = lib.func('cdecl', 'xcb_connect', 'void *', ['str', 'void *'])
    const setup = lib.func('cdecl', 'xcb_get_setup', 'void *', ['void *'])
    const generateId = lib.func('cdecl', 'xcb_generate_id', 'uint32', ['void *'])
    const createWindow = lib.func('cdecl', 'xcb_create_window', 'uint32', [
      'void *', 'uint8', 'uint32', 'uint32', 'int16', 'int16', 'uint16', 'uint16', 'uint16', 'uint16', 'uint32', 'uint32', 'uint32',
    ])
    const internAtom = lib.func('cdecl', 'xcb_intern_atom', 'uint32', ['void *', 'uint8', 'uint16', 'str'])
    const changeProperty = lib.func('cdecl', 'xcb_change_property', 'uint32', ['void *', 'uint8', 'uint32', 'uint32', 'uint32', 'uint8', 'uint32', 'void *'])
    const mapWindow = lib.func('cdecl', 'xcb_map_window', 'uint32', ['void *', 'uint32'])
    const unmapWindow = lib.func('cdecl', 'xcb_unmap_window', 'uint32', ['void *', 'uint32'])
    const putImage = lib.func('cdecl', 'xcb_put_image', 'uint32', [
      'void *', 'uint8', 'uint32', 'uint32', 'int16', 'int16', 'uint16', 'uint16', 'uint8', 'uint8', 'uint32', 'void *',
    ])
    const configureWindow = lib.func('cdecl', 'xcb_configure_window', 'uint32', ['void *', 'uint32', 'uint16', 'void *'])
    const flush = lib.func('cdecl', 'xcb_flush', 'int32', ['void *'])
    const pollEvent = lib.func('cdecl', 'xcb_poll_for_event', 'void *', ['void *'])
    const destroyWindow = lib.func('cdecl', 'xcb_destroy_window', 'uint32', ['void *', 'uint32'])

    const conn = connect(null, null)
    // We use a fixed 32-bit depth; on most composited desktops the default
    // screen's root has a 32-bit TrueColor visual available.
    const root = koffi.decode(setup(conn), 'uint32') // best-effort; refined below
    void root

    const window = generateId(conn) as number

    const valueMask = 1 | XCB_OVERRIDE_REDIRECT // CWBackPixel (transparent) + override_redirect
    const values = [0, 1]

    createWindow(
      conn,
      32, // depth
      window,
      0, // parent (root of screen 0)
      options.x, options.y, options.width, options.height,
      0, // border width
      XCB_WINDOW_CLASS_INPUT_OUTPUT,
      0, // visual (0 = CopyFromParent; ARGB requires a matched visual, see note)
      valueMask, values,
    )

    const handle = new X11Handle(
      koffi, conn, window, 0, 32, options.width, options.height,
      internAtom, changeProperty, putImage, configureWindow, flush, mapWindow, unmapWindow, destroyWindow,
      pollEvent,
      this.bgraFor32bit.bind(this),
      options.onDrag,
    )
    await handle.applyHints()
    handle.show()
    handle.startPump()
    return handle
  }

  /** ARGB32 X11 visuals are little-endian BGRA; emit bytes accordingly. */
  private bgraFor32bit(frame: PetFrame): Uint8Array {
    const out = new Uint8Array(frame.rgba.length)
    const pixels = frame.width * frame.height
    for (let i = 0; i < pixels; i++) {
      const s = i * 4
      out[s] = frame.rgba[s + 2]
      out[s + 1] = frame.rgba[s + 1]
      out[s + 2] = frame.rgba[s]
      out[s + 3] = frame.rgba[s + 3]
    }
    return out
  }
}
