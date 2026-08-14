/**
 * Win32 layered-window backend (Windows 10/11).
 *
 * Creates a frameless, transparent, always-on-top overlay using
 * `CreateWindowExW(WS_EX_LAYERED | WS_EX_TOPMOST ...)` + `UpdateLayeredWindow`,
 * and draws finished RGBA frames through a 32-bit DIB section. Dragging is
 * implemented with a `WM_NCHITTEST → HTCAPTION` window procedure.
 *
 * koffi is imported lazily so a non-Windows process never loads it. All koffi
 * types (structs, prototypes) and the window class are registered exactly once
 * per process — recreating the window for a size/pet change reuses them, so a
 * second `create()` call never re-declares a named type or a class whose
 * previous window procedure has been unregistered.
 *
 * NOTE: this backend requires a real desktop session and has not been
 * exercised by the headless CI; it needs manual verification on Windows.
 */

import { rgbaToPremultipliedBgraInto, type PetFrame } from '../FrameDecoder'
import type { WindowBackend, WindowBackendOptions, WindowHandle } from './WindowBackend'

// --- Win32 constants --------------------------------------------------------

const WS_EX_LAYERED = 0x00080000
const WS_EX_TRANSPARENT = 0x00000020
const WS_EX_TOPMOST = 0x00000008
const WS_EX_TOOLWINDOW = 0x00000080
const WS_POPUP = 0x80000000

const ULW_ALPHA = 0x00000002
const DIB_RGB_COLORS = 0
const BI_RGB = 0

const WM_NCHITTEST = 0x0084
const WM_DESTROY = 0x0002
const WM_EXITSIZEMOVE = 0x0232
const WM_NCMOUSEMOVE = 0x00a0
const WM_NCMOUSELEAVE = 0x02a2
const WM_NCRBUTTONUP = 0x00a5
const HTCAPTION = 2

const TME_LEAVE = 0x00000002
const TME_NONCLIENT = 0x00000010

// Context-menu flags: return the selected item id instead of posting WM_COMMAND.
const TPM_RETURNCMD = 0x0100
const TPM_RIGHTBUTTON = 0x0002
const TPM_NONOTIFY = 0x0080
const MF_STRING = 0x0000
/** Menu item id for the single "close pet" entry. */
const MENU_ITEM_CLOSE = 1

const SW_SHOWNOACTIVATE = 4
const HWND_TOPMOST = -1
const HWND_NOTOPMOST = -2
const PM_REMOVE = 1

const CLASS_NAME = 'DshDesktopPet'

// --- koffi minimal type -----------------------------------------------------

interface KoffiLibrary {
  func(convention: string, name: string, result: string, args: string[]): (...args: any[]) => any
}
interface Koffi {
  load(path: string): KoffiLibrary
  struct(name: string, fields: Record<string, string>): any
  pointer(type: any): any
  proto(declaration: string): any
  register(fn: (...args: any[]) => any, type: any): any
  unregister(handle: any): void
  sizeof(type: any): number
  view(address: any, length: number): ArrayBuffer
  decode(address: any, type: any, ...rest: any[]): any
  alloc(type: any, count: number): any
  encode(address: any, type: any, value: any): void
}

/**
 * Everything declared once per process: the koffi instance, the DLLs, the named
 * struct/prototype types, and the single registered window class + window
 * procedure. `create()` only instantiates a window from these.
 */
interface Win32Bindings {
  koffi: Koffi
  POINT: any
  SIZE: any
  BLENDFUNCTION: any
  MSG: any
  RECT: any
  BITMAPINFOHEADER: any
  updateLayeredWindow: (...args: any[]) => number
  setWindowPos: (...args: any[]) => number
  showWindow: (...args: any[]) => number
  destroyWindow: (...args: any[]) => number
  deleteObject: (...args: any[]) => number
  deleteDC: (...args: any[]) => number
  peekMessage: (...args: any[]) => number
  translateMessage: (...args: any[]) => number
  dispatchMessage: (...args: any[]) => number
  getWindowRect: (...args: any[]) => number
  createDibSection: (...args: any[]) => any
  createCompatibleDC: (...args: any[]) => any
  selectObject: (...args: any[]) => any
  getDC: (...args: any[]) => any
  releaseDC: (...args: any[]) => number
  createWindowExW: (...args: any[]) => any
  trackMouseEvent: (...args: any[]) => number
  createPopupMenu: (...args: any[]) => any
  appendMenuW: (...args: any[]) => number
  trackPopupMenu: (...args: any[]) => number
  destroyMenu: (...args: any[]) => number
  getCursorPos: (...args: any[]) => number
  TRACKMOUSEEVENT: any
  wndProc: unknown
  /** Updated on each `create()` so the single wndProc reports drags to the current window. */
  currentOnDrag: ((x: number, y: number) => void) | undefined
  /** Updated on each `create()` so the single wndProc reports hover to the current window. */
  currentOnHover: (() => void) | undefined
  /** Updated on each `create()` so the single wndProc reports hover-leave to the current window. */
  currentOnUnhover: (() => void) | undefined
  /** Updated on each `create()` so the single wndProc reports the close choice. */
  currentOnClose: (() => void) | undefined
}

async function loadKoffi(): Promise<Koffi> {
  const mod = await import('koffi')
  return (mod.default ?? mod) as unknown as Koffi
}

let bindingsPromise: Promise<Win32Bindings> | undefined

/** Build (once) and cache the process-wide Win32 bindings. */
function getBindings(): Promise<Win32Bindings> {
  if (bindingsPromise !== undefined) return bindingsPromise
  bindingsPromise = (async () => {
    const koffi = await loadKoffi()
    const user32 = koffi.load('user32.dll')
    const gdi32 = koffi.load('gdi32.dll')
    const kernel32 = koffi.load('kernel32.dll')

    // --- Named types (declared exactly once) ------------------------------
    const POINT = koffi.struct('DshPt', { x: 'int32', y: 'int32' })
    const SIZE = koffi.struct('DshSize', { cx: 'int32', cy: 'int32' })
    const BLENDFUNCTION = koffi.struct('DshBlend', {
      BlendOp: 'uint8',
      BlendFlags: 'uint8',
      SourceConstantAlpha: 'uint8',
      AlphaFormat: 'uint8',
    })
    const RECT = koffi.struct('DshRect', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' })
    // MSG is a fixed 48-byte structure on 64-bit Windows; PeekMessageW writes
    // into this pre-allocated slot (never pass null).
    const MSG = koffi.struct('DshMsg', {
      hwnd: 'void *',
      message: 'uint32',
      wParam: 'uintptr',
      lParam: 'intptr',
      time: 'uint32',
      pt: POINT,
    })
    const BITMAPINFOHEADER = koffi.struct('DshBitmapInfoHeader', {
      biSize: 'uint32',
      biWidth: 'int32',
      biHeight: 'int32',
      biPlanes: 'uint16',
      biBitCount: 'uint16',
      biCompression: 'uint32',
      biSizeImage: 'uint32',
      biXPelsPerMeter: 'int32',
      biYPelsPerMeter: 'int32',
      biClrUsed: 'uint32',
      biClrImportant: 'uint32',
    })

    // --- Function bindings -------------------------------------------------
    const PVOID = koffi.pointer('void')
    const PPVOID = koffi.pointer(PVOID)

    const getModuleHandleW = kernel32.func('__stdcall', 'GetModuleHandleW', 'void *', ['str16'])
    const registerClassExW = user32.func('__stdcall', 'RegisterClassExW', 'uint16', ['void *'])
    const defWindowProcW = user32.func('__stdcall', 'DefWindowProcW', 'intptr', ['void *', 'uint32', 'uintptr', 'intptr'])
    const createWindowExW = user32.func('__stdcall', 'CreateWindowExW', 'void *', [
      'uint32', 'str16', 'str16', 'uint32', 'int32', 'int32', 'int32', 'int32',
      'void *', 'void *', 'void *', 'void *',
    ])
    const getDC = user32.func('__stdcall', 'GetDC', 'void *', ['void *'])
    const releaseDC = user32.func('__stdcall', 'ReleaseDC', 'int32', ['void *', 'void *'])
    const createDibSection = gdi32.func('__stdcall', 'CreateDIBSection', 'void *', [PVOID, 'void *', 'uint32', PPVOID, PVOID, 'uint32'])
    const createCompatibleDC = gdi32.func('__stdcall', 'CreateCompatibleDC', 'void *', ['void *'])
    const selectObject = gdi32.func('__stdcall', 'SelectObject', 'void *', ['void *', 'void *'])
    const deleteObject = gdi32.func('__stdcall', 'DeleteObject', 'int32', ['void *'])
    const deleteDC = gdi32.func('__stdcall', 'DeleteDC', 'int32', ['void *'])
    const updateLayeredWindow = user32.func('__stdcall', 'UpdateLayeredWindow', 'int32', [
      'void *', 'void *', 'void *', 'void *', 'void *', 'void *', 'uint32', 'void *', 'uint32',
    ])
    const setWindowPos = user32.func('__stdcall', 'SetWindowPos', 'int32', [
      'void *', 'void *', 'int32', 'int32', 'int32', 'int32', 'uint32',
    ])
    const showWindow = user32.func('__stdcall', 'ShowWindow', 'int32', ['void *', 'int32'])
    const destroyWindow = user32.func('__stdcall', 'DestroyWindow', 'int32', ['void *'])
    const peekMessageW = user32.func('__stdcall', 'PeekMessageW', 'int32', ['void *', 'void *', 'uint32', 'uint32', 'uint32'])
    const translateMessage = user32.func('__stdcall', 'TranslateMessage', 'int32', ['void *'])
    const dispatchMessageW = user32.func('__stdcall', 'DispatchMessageW', 'intptr', ['void *'])
    const getWindowRect = user32.func('__stdcall', 'GetWindowRect', 'int32', ['void *', 'void *'])
    const trackMouseEvent = user32.func('__stdcall', 'TrackMouseEvent', 'int32', ['void *'])
    const createPopupMenu = user32.func('__stdcall', 'CreatePopupMenu', 'void *', [])
    const appendMenuW = user32.func('__stdcall', 'AppendMenuW', 'int32', ['void *', 'uint32', 'uintptr', 'str16'])
    const trackPopupMenu = user32.func('__stdcall', 'TrackPopupMenu', 'int32', ['void *', 'uint32', 'int32', 'int32', 'int32', 'void *', 'void *'])
    const destroyMenu = user32.func('__stdcall', 'DestroyMenu', 'int32', ['void *'])
    const getCursorPos = user32.func('__stdcall', 'GetCursorPos', 'int32', ['void *'])

    const TRACKMOUSEEVENT = koffi.struct('DshTrackMouseEvent', {
      cbSize: 'uint32',
      dwFlags: 'uint32',
      hwndTrack: 'void *',
      dwHoverTime: 'uint32',
    })

    const bindings: Win32Bindings = {
      koffi,
      POINT, SIZE, BLENDFUNCTION, MSG, RECT, BITMAPINFOHEADER,
      updateLayeredWindow, setWindowPos, showWindow, destroyWindow, deleteObject, deleteDC,
      peekMessage: peekMessageW, translateMessage, dispatchMessage: dispatchMessageW, getWindowRect,
      createDibSection, createCompatibleDC, selectObject, getDC, releaseDC, createWindowExW,
      trackMouseEvent, createPopupMenu, appendMenuW, trackPopupMenu, destroyMenu, getCursorPos, TRACKMOUSEEVENT,
      wndProc: undefined,
      currentOnDrag: undefined,
      currentOnHover: undefined,
      currentOnUnhover: undefined,
      currentOnClose: undefined,
    }

    // Per-message scratch reused across all windows: the shared wndProc writes
    // into these instead of allocating on every mouse-move / drag-end.
    const tme = koffi.alloc(TRACKMOUSEEVENT, 1)
    const rect = koffi.alloc(RECT, 1)

    // --- Single window class + procedure (registered once) ----------------
    const wndProcType = koffi.proto('intptr __stdcall DshPetWndProc(void *hwnd, uint32 msg, uintptr wParam, intptr lParam)')
    const wndProc = koffi.register(
      (hwnd: any, msg: number, wParam: number, lParam: number) => {
        if (msg === WM_NCHITTEST) return HTCAPTION
        if (msg === WM_DESTROY) return 0
        if (msg === WM_NCMOUSEMOVE) {
          // Ask Windows to post WM_NCMOUSELEAVE when the cursor leaves, then
          // report the hover (rate-limiting happens in the pet core).
          koffi.encode(tme, TRACKMOUSEEVENT, {
            cbSize: koffi.sizeof(TRACKMOUSEEVENT),
            dwFlags: TME_LEAVE | TME_NONCLIENT,
            hwndTrack: hwnd,
            dwHoverTime: 0,
          })
          trackMouseEvent(tme)
          bindings.currentOnHover?.()
          return 0
        }
        if (msg === WM_NCMOUSELEAVE) {
          bindings.currentOnUnhover?.()
          return 0
        }
        if (msg === WM_NCRBUTTONUP) {
          // Show a one-item "close pet" context menu at the cursor. We use
          // TPM_RETURNCMD so no WM_COMMAND routing is needed, and MF_STRING with
          // a UTF-16 label. The menu is destroyed immediately after.
          const menu = createPopupMenu()
          if (menu === null) return 0
          const cursor = koffi.alloc(POINT, 1)
          getCursorPos(cursor)
          const p = koffi.decode(cursor, POINT)
          appendMenuW(menu, MF_STRING, MENU_ITEM_CLOSE, 'Close pet')
          const choice = trackPopupMenu(menu, TPM_RIGHTBUTTON | TPM_NONOTIFY | TPM_RETURNCMD, p.x, p.y, 0, hwnd, null)
          destroyMenu(menu)
          if (choice === MENU_ITEM_CLOSE) {
            bindings.currentOnClose?.()
          }
          return 0
        }
        if (msg === WM_EXITSIZEMOVE) {
          getWindowRect(hwnd, rect)
          const r = koffi.decode(rect, RECT)
          bindings.currentOnDrag?.(r.left, r.top)
          return 0
        }
        return defWindowProcW(hwnd, msg, wParam, lParam)
      },
      koffi.pointer(wndProcType),
    )
    bindings.wndProc = wndProc

    // lpszClassName / lpszMenuName are UTF-16 string pointers, encoded as
    // 'str16' so RegisterClassExW and CreateWindowExW agree on the class atom.
    const WNDCLASSEXW = koffi.struct('DshWndClassExW', {
      cbSize: 'uint32',
      style: 'uint32',
      lpfnWndProc: 'void *',
      cbClsExtra: 'int32',
      cbWndExtra: 'int32',
      hInstance: 'void *',
      hIcon: 'void *',
      hCursor: 'void *',
      hbrBackground: 'void *',
      lpszMenuName: 'str16',
      lpszClassName: 'str16',
      hIconSm: 'void *',
    })
    const hInstance = getModuleHandleW(null)
    const cls = koffi.alloc(WNDCLASSEXW, 1)
    koffi.encode(cls, WNDCLASSEXW, {
      cbSize: koffi.sizeof(WNDCLASSEXW),
      style: 0,
      lpfnWndProc: wndProc,
      cbClsExtra: 0,
      cbWndExtra: 0,
      hInstance,
      hIcon: null,
      hCursor: null,
      hbrBackground: null,
      lpszMenuName: null,
      lpszClassName: CLASS_NAME,
      hIconSm: null,
    })
    registerClassExW(cls)

    return bindings
  })()
  return bindingsPromise
}

/**
 * A window handle backed by Win32. The DIB memory is owned by GDI and released
 * with the bitmap on `destroy`; the shared window procedure lives as long as
 * the process (its class is registered once).
 */
class Win32Handle implements WindowHandle {
  private destroyed = false
  private pumpTimer: ReturnType<typeof setInterval> | undefined

  // Per-frame scratch, allocated once and reused so the hot render path does
  // zero native allocation and zero large JS allocation (koffi.alloc() has no
  // GC finalizer — allocating per frame leaks native heap and eventually stalls
  // the animation).
  private readonly ptSrc: any
  private readonly sz: any
  private readonly bf: any
  private readonly dibView: Uint8Array
  private readonly bgraBuf: Uint8Array

  constructor(
    private readonly bindings: Win32Bindings,
    private readonly hwnd: any,
    private readonly hdcMem: any,
    private readonly hBitmap: any,
    private readonly bitsPtr: any,
    private readonly bitsLength: number,
    private readonly msg: any,
  ) {
    const { koffi, POINT, SIZE, BLENDFUNCTION } = bindings
    this.ptSrc = koffi.alloc(POINT, 1)
    koffi.encode(this.ptSrc, POINT, { x: 0, y: 0 })
    this.sz = koffi.alloc(SIZE, 1)
    this.bf = koffi.alloc(BLENDFUNCTION, 1)
    koffi.encode(this.bf, BLENDFUNCTION, {
      BlendOp: 0, // AC_SRC_OVER
      BlendFlags: 0,
      SourceConstantAlpha: 255,
      AlphaFormat: 1, // AC_SRC_ALPHA
    })
    // A persistent view over the DIB's bit memory, and a scratch buffer for the
    // premultiplied-BGRA conversion. Both are written in place on every frame.
    this.dibView = new Uint8Array(koffi.view(bitsPtr, bitsLength))
    this.bgraBuf = new Uint8Array(bitsLength)
  }

  present(frame: PetFrame): void {
    if (this.destroyed) return
    // Convert straight RGBA → premultiplied BGRA directly into the scratch
    // buffer (no per-frame allocation), then copy into the DIB's bit memory.
    rgbaToPremultipliedBgraInto(frame, this.bgraBuf)
    this.dibView.set(this.bgraBuf.subarray(0, Math.min(this.bgraBuf.length, this.dibView.length)))

    const { koffi, SIZE, updateLayeredWindow } = this.bindings
    koffi.encode(this.sz, SIZE, { cx: frame.width, cy: frame.height })

    // pptDst must be NULL: a non-null pptDst repositions the layered window to
    // that screen point on every frame, which would snap a dragged pet back to
    // the top-left corner. NULL keeps the current (possibly user-dragged) position.
    updateLayeredWindow(this.hwnd, 0, null, this.sz, this.hdcMem, this.ptSrc, 0, this.bf, ULW_ALPHA)
  }

  move(x: number, y: number): void {
    if (this.destroyed) return
    this.bindings.setWindowPos(this.hwnd, HWND_TOPMOST, x, y, 0, 0, 0x0001 | 0x0010)
  }

  setAlwaysOnTop(value: boolean): void {
    if (this.destroyed) return
    this.bindings.setWindowPos(this.hwnd, value ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
  }

  show(): void {
    if (this.destroyed) return
    this.bindings.showWindow(this.hwnd, SW_SHOWNOACTIVATE)
  }

  hide(): void {
    if (this.destroyed) return
    this.bindings.showWindow(this.hwnd, 0)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.pumpTimer) clearInterval(this.pumpTimer)
    this.bindings.destroyWindow(this.hwnd)
    this.bindings.deleteObject(this.hBitmap)
    this.bindings.deleteDC(this.hdcMem)
  }

  /** Pump pending window messages (invoked on an interval while alive). */
  startPump(): void {
    if (this.pumpTimer || this.destroyed) return
    this.pumpTimer = setInterval(() => {
      if (this.destroyed) return
      const { peekMessage, translateMessage, dispatchMessage } = this.bindings
      // PeekMessageW is non-blocking and writes into the pre-allocated MSG.
      let guard = 0
      while (guard++ < 16 && peekMessage(this.msg, this.hwnd, 0, 0, PM_REMOVE)) {
        translateMessage(this.msg)
        dispatchMessage(this.msg)
      }
    }, 50)
  }
}

export class Win32Backend implements WindowBackend {
  readonly name = 'win32'

  isSupported(): boolean {
    return process.platform === 'win32'
  }

  async create(options: WindowBackendOptions): Promise<WindowHandle> {
    const b = await getBindings()
    const { koffi, createWindowExW, createDibSection, createCompatibleDC, selectObject, getDC, releaseDC, BITMAPINFOHEADER } = b

    b.currentOnDrag = options.onDrag
    b.currentOnHover = options.onHover
    b.currentOnUnhover = options.onUnhover
    b.currentOnClose = options.onClose

    const exStyle = WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | (options.clickThrough ? WS_EX_TRANSPARENT : 0)
    const hwnd = createWindowExW(
      exStyle, CLASS_NAME, '', WS_POPUP,
      options.x, options.y, options.width, options.height,
      null, null, null, null,
    )
    if (hwnd === null) {
      throw new Error('CreateWindowExW returned a null window handle (window class not registered?)')
    }

    // 32-bit top-down DIB section for the frame pixels.
    const header = koffi.alloc(BITMAPINFOHEADER, 1)
    koffi.encode(header, BITMAPINFOHEADER, {
      biSize: 40,
      biWidth: options.width,
      biHeight: -options.height, // top-down
      biPlanes: 1,
      biBitCount: 32,
      biCompression: BI_RGB,
      biSizeImage: options.width * options.height * 4,
      biXPelsPerMeter: 0,
      biYPelsPerMeter: 0,
      biClrUsed: 0,
      biClrImportant: 0,
    })

    const PVOID = koffi.pointer('void')
    const screenDC = getDC(null)
    const bitsSlot = koffi.alloc(PVOID, 1)
    const hBitmap = createDibSection(screenDC, header, DIB_RGB_COLORS, bitsSlot, null, 0)
    releaseDC(null, screenDC)
    const bitsPtr = koffi.decode(bitsSlot, PVOID)

    const hdcMem = createCompatibleDC(null)
    selectObject(hdcMem, hBitmap)

    const msg = koffi.alloc(b.MSG, 1)

    const handle = new Win32Handle(b, hwnd, hdcMem, hBitmap, bitsPtr, options.width * options.height * 4, msg)
    handle.show()
    handle.startPump()

    return handle
  }
}
