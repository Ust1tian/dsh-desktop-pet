/**
 * Win32 layered-window backend (Windows 10/11).
 *
 * Creates a frameless, transparent, always-on-top overlay using
 * `CreateWindowExW(WS_EX_LAYERED | WS_EX_TOPMOST ...)` + `UpdateLayeredWindow`,
 * and draws finished RGBA frames through a 32-bit DIB section. Dragging is
 * implemented with a `WM_NCHITTEST → HTCAPTION` window procedure.
 *
 * koffi is imported lazily so a non-Windows process never loads it. Every
 * native call is wrapped by the renderer's failure isolation: if anything
 * here throws, the pet disables its window and Harness keeps running.
 *
 * NOTE: this backend requires a real desktop session and has not been
 * exercised by the headless CI; it needs manual verification on Windows.
 */

import { rgbaToPremultipliedBgra, type PetFrame } from '../FrameDecoder'
import type { WindowBackend, WindowBackendOptions, WindowHandle } from './WindowBackend'

// --- Win32 constants --------------------------------------------------------

const WS_EX_LAYERED = 0x00080000
const WS_EX_TRANSPARENT = 0x00000020
const WS_EX_TOPMOST = 0x00000008
const WS_EX_TOOLWINDOW = 0x00000080
const WS_POPUP = 0x80000000
const CW_USEDEFAULT = 0x80000000

const ULW_ALPHA = 0x00000002
const DIB_RGB_COLORS = 0
const BI_RGB = 0

const WM_NCHITTEST = 0x0084
const WM_DESTROY = 0x0002
const HTCAPTION = 2

const SWP_NOACTIVATE = 0x0010
const SW_SHOWNOACTIVATE = 4
const HWND_TOPMOST = -1
const HWND_NOTOPMOST = -2

const SM_CXSCREEN = 0
const SM_CYSCREEN = 1

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
  sizeof(type: string): number
  view(address: any, length: number): ArrayBuffer
  decode(address: any, type: any, ...rest: any[]): any
  address(value: any): any
}

async function loadKoffi(): Promise<Koffi> {
  const mod = await import('koffi')
  return (mod.default ?? mod) as unknown as Koffi
}

/**
 * A window handle backed by Win32. The window procedure callback is unregistered
 * on `destroy`; the DIB memory is owned by GDI and released with the bitmap.
 */
class Win32Handle implements WindowHandle {
  private destroyed = false
  private pumpTimer: ReturnType<typeof setInterval> | undefined
  private wndProcHandle: unknown

  constructor(
    private readonly koffi: Koffi,
    private readonly user32: KoffiLibrary,
    private readonly gdi32: KoffiLibrary,
    private readonly hwnd: number,
    private readonly hdcMem: number,
    private readonly hBitmap: number,
    private readonly bitsPtr: any,
    private readonly bitsLength: number,
    private readonly updateLayeredWindow: (...args: any[]) => number,
    private readonly setWindowPos: (...args: any[]) => number,
    private readonly showWindow: (...args: any[]) => number,
    private readonly destroyWindow: (...args: any[]) => number,
    private readonly deleteObject: (...args: any[]) => number,
    private readonly deleteDC: (...args: any[]) => number,
    private readonly getMessage: (...args: any[]) => number,
    private readonly translateMessage: (...args: any[]) => number,
    private readonly dispatchMessage: (...args: any[]) => number,
    private onDrag: ((x: number, y: number) => void) | undefined,
    wndProcHandle: unknown,
  ) {
    this.wndProcHandle = wndProcHandle
  }

  present(frame: PetFrame): void {
    if (this.destroyed) return
    const bgra = rgbaToPremultipliedBgra(frame)
    // Write the premultiplied BGRA pixels into the DIB's bit memory.
    const view = new Uint8Array(this.koffi.view(this.bitsPtr, this.bitsLength))
    view.set(bgra.subarray(0, Math.min(bgra.length, view.length)))

    const koffi = this.koffi
    const srcPt = koffi.struct('DshPt', { x: 'int32', y: 'int32' })
    const size = koffi.struct('DshSize', { cx: 'int32', cy: 'int32' })
    const blend = koffi.struct('DshBlend', {
      BlendOp: 'uint8',
      BlendFlags: 'uint8',
      SourceConstantAlpha: 'uint8',
      AlphaFormat: 'uint8',
    })
    const ptSrc = new srcPt()
    const ptDst = new srcPt()
    const sz = new size()
    sz.cx = frame.width
    sz.cy = frame.height
    const bf = new blend()
    bf.BlendOp = 0 // AC_SRC_OVER
    bf.BlendFlags = 0
    bf.SourceConstantAlpha = 255
    bf.AlphaFormat = 1 // AC_SRC_ALPHA

    this.updateLayeredWindow(this.hwnd, 0, ptDst, sz, this.hdcMem, ptSrc, 0, bf, ULW_ALPHA)
  }

  move(x: number, y: number): void {
    if (this.destroyed) return
    // SWP_NOSIZE | SWP_NOACTIVATE; topmost preserved by the HWND_TOPMOST flag.
    this.setWindowPos(this.hwnd, HWND_TOPMOST, x, y, 0, 0, 0x0001 | 0x0010)
  }

  setAlwaysOnTop(value: boolean): void {
    if (this.destroyed) return
    this.setWindowPos(this.hwnd, value ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
  }

  show(): void {
    if (this.destroyed) return
    this.showWindow(this.hwnd, SW_SHOWNOACTIVATE)
  }

  hide(): void {
    if (this.destroyed) return
    this.showWindow(this.hwnd, 0)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    if (this.pumpTimer) clearInterval(this.pumpTimer)
    this.destroyWindow(this.hwnd)
    this.deleteObject(this.hBitmap)
    this.deleteDC(this.hdcMem)
    if (this.wndProcHandle) {
      try {
        this.koffi.unregister(this.wndProcHandle)
      } catch {
        /* already unregistered */
      }
    }
    this.onDrag = undefined
  }

  /** Pump pending window messages (invoked on an interval while alive). */
  startPump(): void {
    if (this.pumpTimer || this.destroyed) return
    // Layered windows we draw ourselves only need hit-test and destroy
    // handling; a slow poll is plenty and keeps idle CPU near zero.
    this.pumpTimer = setInterval(() => {
      if (this.destroyed) return
      // Peek-and-dispatch loop bound to available messages.
      let guard = 0
      while (guard++ < 16 && this.getMessage(null, this.hwnd, 0, 0)) {
        this.translateMessage(null)
        this.dispatchMessage(null)
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
    const koffi = await loadKoffi()
    const user32 = koffi.load('user32.dll')
    const gdi32 = koffi.load('gdi32.dll')

    const registerClassExW = user32.func('__stdcall', 'RegisterClassExW', 'uint16', ['void *'])
    const createWindowExW = user32.func('__stdcall', 'CreateWindowExW', 'void *', [
      'uint32', 'str16', 'str16', 'uint32', 'int32', 'int32', 'int32', 'int32',
      'void *', 'void *', 'void *', 'void *',
    ])
    const defWindowProcW = user32.func('__stdcall', 'DefWindowProcW', 'intptr', ['void *', 'uint32', 'uintptr', 'intptr'])
    const getSystemMetrics = user32.func('__stdcall', 'GetSystemMetrics', 'int32', ['int32'])
    const getDC = user32.func('__stdcall', 'GetDC', 'void *', ['void *'])
    const releaseDC = user32.func('__stdcall', 'ReleaseDC', 'int32', ['void *', 'void *'])
    const createDibSection = gdi32.func('__stdcall', 'CreateDIBSection', 'void *', ['void *', 'void *', 'uint32', 'void *', 'void *', 'uint32'])
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
    const getMessageW = user32.func('__stdcall', 'GetMessageW', 'int32', ['void *', 'void *', 'uint32', 'uint32'])
    const translateMessage = user32.func('__stdcall', 'TranslateMessage', 'int32', ['void *'])
    const dispatchMessageW = user32.func('__stdcall', 'DispatchMessageW', 'intptr', ['void *'])

    const className = 'DshDesktopPet'
    const wndProcType = koffi.proto('intptr __stdcall DshPetWndProc(void *hwnd, uint32 msg, uintptr wParam, intptr lParam)')

    const wndProc = koffi.register(
      (hwnd: any, msg: number, _wParam: number, _lParam: number) => {
        if (msg === WM_NCHITTEST) return HTCAPTION
        if (msg === WM_DESTROY) return 0
        return defWindowProcW(hwnd, msg, _wParam, _lParam)
      },
      wndProcType,
    )

    const wcx = koffi.struct('DshWndClassExW', {
      cbSize: 'uint32',
      style: 'uint32',
      lpfnWndProc: 'void *',
      cbClsExtra: 'int32',
      cbWndExtra: 'int32',
      hInstance: 'void *',
      hIcon: 'void *',
      hCursor: 'void *',
      hbrBackground: 'void *',
      lpszMenuName: 'void *',
      lpszClassName: 'void *',
      hIconSm: 'void *',
    })
    const cls = new wcx()
    cls.cbSize = koffi.sizeof('void *') * 10 // approximate; sizeof(WNDCLASSEXW)
    cls.lpfnWndProc = wndProc
    cls.lpszClassName = className

    registerClassExW(cls)

    const exStyle = WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | (options.clickThrough ? WS_EX_TRANSPARENT : 0)
    const hwnd = createWindowExW(
      exStyle, className, '', WS_POPUP,
      options.x, options.y, options.width, options.height,
      null, null, null, null,
    ) as number

    // 32-bit top-down DIB section for the frame pixels.
    const bmi = koffi.struct('DshBitmapInfoHeader', {
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
    const header = new bmi()
    header.biSize = 40
    header.biWidth = options.width
    header.biHeight = -options.height // top-down
    header.biPlanes = 1
    header.biBitCount = 32
    header.biCompression = BI_RGB
    header.biSizeImage = options.width * options.height * 4

    const screenDC = getDC(null)
    const bitsPtr = koffi.pointer('void *')
    const hBitmap = createDibSection(screenDC, header, DIB_RGB_COLORS, bitsPtr, null, 0) as number
    releaseDC(null, screenDC)

    const hdcMem = createCompatibleDC(null) as number
    selectObject(hdcMem, hBitmap)

    const handle = new Win32Handle(
      koffi, user32, gdi32, hwnd, hdcMem, hBitmap, bitsPtr, options.width * options.height * 4,
      updateLayeredWindow, setWindowPos, showWindow, destroyWindow, deleteObject, deleteDC,
      getMessageW, translateMessage, dispatchMessageW, options.onDrag, wndProc,
    )
    handle.show()
    handle.startPump()

    void getSystemMetrics(SM_CXSCREEN) // warm the binding; result unused

    return handle
  }
}
