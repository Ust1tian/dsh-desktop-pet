/**
 * X11 overlay-window backend via XCB (Linux).
 *
 * Creates a borderless, override-redirect, 32-bit-ARGB window with
 * `_NET_WM_WINDOW_TYPE_DOCK` / `_NET_WM_STATE_ABOVE` hints and pushes finished
 * RGBA frames with `xcb_put_image`. Dragging uses `xcb_configure_window` driven
 * by button/motion events, reporting horizontal direction on the way.
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
  struct(name: string, fields: Record<string, string>): any
  alloc(type: any, count: number): any
  encode(address: any, type: any, value: any): void
  decode(address: any, type: any, ...rest: any[]): any
  sizeof(type: any): number
  view(address: any, length: number): ArrayBuffer
}

async function loadKoffi(): Promise<Koffi> {
  const mod = await import('koffi')
  return (mod.default ?? mod) as unknown as Koffi
}

// xcb_create_window value-mask bits (value_list order follows bit order).
const XCB_CW_BACK_PIXEL = 0x00000001 // 1 << 0
const XCB_CW_OVERRIDE_REDIRECT = 0x00000200 // 1 << 9
const XCB_CW_EVENT_MASK = 0x00000800 // 1 << 11

const XCB_EVENT_MASK_BUTTON_PRESS = 0x00000004
const XCB_EVENT_MASK_BUTTON_RELEASE = 0x00000008
const XCB_EVENT_MASK_POINTER_MOTION = 0x00000040
const XCB_POINTER_EVENT_MASK = XCB_EVENT_MASK_BUTTON_PRESS | XCB_EVENT_MASK_BUTTON_RELEASE | XCB_EVENT_MASK_POINTER_MOTION

const XCB_WINDOW_CLASS_INPUT_OUTPUT = 1

const XCB_IMAGE_FORMAT_Z_PIXMAP = 2
const XCB_PROP_MODE_REPLACE = 0
const XCB_ATOM_ATOM = 4

// xcb_configure_window value-mask bits for X/Y.
const XCB_CONFIG_WINDOW_X = 0x0001
const XCB_CONFIG_WINDOW_Y = 0x0002

// Core pointer-event response codes.
const XCB_BUTTON_PRESS = 4
const XCB_BUTTON_RELEASE = 5
const XCB_MOTION_NOTIFY = 6

/** Shared leading layout of button-press / button-release / motion-notify events. */
interface XcbPointerEvent {
  response_type: number
  detail: number
  sequence: number
  time: number
  root: number
  event: number
  child: number
  root_x: number
  root_y: number
  event_x: number
  event_y: number
  state: number
}

class X11Handle implements WindowHandle {
  private destroyed = false
  private pumpTimer: ReturnType<typeof setInterval> | undefined
  private readonly atomCache = new Map<string, number>()

  // Drag state: the window position is tracked in JS (started from the create
  // options), while root coordinates come from the pointer events.
  private winX: number
  private winY: number
  private dragging = false
  private dragStartRootX = 0
  private dragStartRootY = 0
  private dragStartWinX = 0
  private dragStartWinY = 0

  constructor(
    private readonly koffi: Koffi,
    private readonly conn: any,
    private readonly window: number,
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
    private readonly pointerEventType: any,
    private readonly onDrag: ((x: number, y: number) => void) | undefined,
    private readonly onDragMove: ((direction: 'left' | 'right') => void) | undefined,
    private readonly onDragEnd: (() => void) | undefined,
  ) {
    void this.width
    void this.height
    this.winX = 0
    this.winY = 0
  }

  setInitialPosition(x: number, y: number): void {
    this.winX = x
    this.winY = y
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

    const typeArray = [dock, 0]
    const stateArray = [above, sticky, 0]
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
    this.winX = x
    this.winY = y
    this.configureWindow(this.conn, this.window, XCB_CONFIG_WINDOW_X | XCB_CONFIG_WINDOW_Y, [x, y])
    this.flush(this.conn)
  }

  setAlwaysOnTop(): void {
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

  private handleEvent(event: any): void {
    const evt = this.koffi.decode(event, this.pointerEventType) as XcbPointerEvent
    switch (evt.response_type) {
      case XCB_BUTTON_PRESS: {
        this.dragging = true
        this.dragStartRootX = evt.root_x
        this.dragStartRootY = evt.root_y
        this.dragStartWinX = this.winX
        this.dragStartWinY = this.winY
        break
      }
      case XCB_MOTION_NOTIFY: {
        if (!this.dragging) break
        const dx = evt.root_x - this.dragStartRootX
        const dy = evt.root_y - this.dragStartRootY
        if (dx === 0 && dy === 0) break
        const x = this.dragStartWinX + dx
        const y = this.dragStartWinY + dy
        this.winX = x
        this.winY = y
        this.configureWindow(this.conn, this.window, XCB_CONFIG_WINDOW_X | XCB_CONFIG_WINDOW_Y, [x, y])
        this.flush(this.conn)
        if (dx !== 0) this.onDragMove?.(dx < 0 ? 'left' : 'right')
        break
      }
      case XCB_BUTTON_RELEASE: {
        if (!this.dragging) break
        this.dragging = false
        this.onDragEnd?.()
        this.onDrag?.(this.winX, this.winY)
        break
      }
    }
  }

  startPump(): void {
    if (this.pumpTimer || this.destroyed) return
    this.pumpTimer = setInterval(() => {
      if (this.destroyed) return
      let event: any
      let guard = 0
      while (guard++ < 8 && (event = this.pollEvent(this.conn))) {
        this.handleEvent(event)
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
    const generateId = lib.func('cdecl', 'xcb_generate_id', 'uint32', ['void *'])
    const createWindow = lib.func('cdecl', 'xcb_create_window', 'uint32', [
      'void *', 'uint8', 'uint32', 'uint32', 'int16', 'int16', 'uint16', 'uint16', 'uint16', 'uint16', 'uint32', 'uint32', 'void *',
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

    const pointerEventType = koffi.struct('DshXcbPointerEvent', {
      response_type: 'uint8',
      detail: 'uint8',
      sequence: 'uint16',
      time: 'uint32',
      root: 'uint32',
      event: 'uint32',
      child: 'uint32',
      root_x: 'int16',
      root_y: 'int16',
      event_x: 'int16',
      event_y: 'int16',
      state: 'uint16',
      same_screen: 'uint8',
      pad0: 'uint8',
    })

    const conn = connect(null, null)
    const window = generateId(conn) as number

    // value_list order follows the value-mask bit order: back_pixel, then
    // override_redirect, then event_mask.
    const valueMask = XCB_CW_BACK_PIXEL | XCB_CW_OVERRIDE_REDIRECT | XCB_CW_EVENT_MASK
    const values = koffi.alloc('uint32', 3)
    koffi.encode(values, koffi.pointer('uint32'), [0, 1, XCB_POINTER_EVENT_MASK])

    createWindow(
      conn,
      32, // depth
      window,
      0, // parent (root of screen 0)
      options.x, options.y, options.width, options.height,
      0, // border width
      XCB_WINDOW_CLASS_INPUT_OUTPUT,
      0, // visual (0 = CopyFromParent; ARGB needs a matched 32-bit visual)
      valueMask, values,
    )

    const handle = new X11Handle(
      koffi, conn, window, 32, options.width, options.height,
      internAtom, changeProperty, putImage, configureWindow, flush, mapWindow, unmapWindow, destroyWindow,
      pollEvent,
      this.bgraFor32bit.bind(this),
      pointerEventType,
      options.onDrag,
      options.onDragMove,
      options.onDragEnd,
    )
    handle.setInitialPosition(options.x, options.y)
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
