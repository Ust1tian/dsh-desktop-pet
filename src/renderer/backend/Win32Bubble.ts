/**
 * Win32 气泡窗口：显示在桌宠上方的文字气泡（实时思考过程 / 状态提示）。
 *
 * 实现要点：
 * - 独立 layered window（WS_EX_TRANSPARENT 点击穿透），复用 Win32Backend
 *   的进程级绑定与窗口类，不干扰宠物主窗口的渲染路径。
 * - 用 GDI（FillRgn/FrameRgn/TextOutW）绘制圆角矩形与文本；GDI 不写 alpha
 *   通道，所以在绘制完成后手动把"圆角矩形内"像素的 alpha 刷为 255、
 *   圆角外保持 0（透明），再经 UpdateLayeredWindow(AC_SRC_ALPHA) 呈现。
 * - 文本按像素宽度折行（GetTextExtentPoint32W 逐字测量），尺寸随文本变化，
 *   尺寸变化时销毁重建窗口（气泡更新频率低，开销可忽略）。
 */

import type { Win32Bindings } from './Win32Backend'

// --- Win32 常量（与 Win32Backend 同源，避免跨模块耦合故局部重列） ---------
const WS_EX_LAYERED = 0x00080000
const WS_EX_TRANSPARENT = 0x00000020
const WS_EX_TOPMOST = 0x00000008
const WS_EX_TOOLWINDOW = 0x00000080
const WS_POPUP = 0x80000000

const ULW_ALPHA = 0x00000002
const DIB_RGB_COLORS = 0
const BI_RGB = 0

const SW_SHOWNOACTIVATE = 4
const HWND_TOPMOST = -1

// --- 气泡样式 ---------------------------------------------------------------
const PADDING_X = 12
const PADDING_Y = 9
const LINE_HEIGHT = 22
const MAX_WIDTH = 240
const MIN_WIDTH = 64
const ROUND_RADIUS = 10
const BORDER_WIDTH = 1
/** 气泡最多显示的行数（超出部分折叠到末行并加省略号）。 */
const MAX_LINES = 2

// COLORREF = 0x00BBGGRR
const COLOR_BG = 0x00e8f9ff // 淡黄 #FFF9E8
const COLOR_BORDER = 0x00333333 // 深灰 #333333
const COLOR_TEXT = 0x00222222 // 近黑 #222222
const COLOR_CONFIRM_BG = 0x00e0f0ff // 淡蓝（等待确认时）
const COLOR_CONFIRM_BORDER = 0x000066cc // 亮蓝边框

export interface BubbleTextOptions {
  /** 气泡文本。 */
  text: string
  /** 提示类型：confirm 使用高亮配色。 */
  kind?: 'think' | 'confirm' | 'success' | 'error'
}

export class Win32Bubble {
  private destroyed = false
  private hwnd: any
  private hdcMem: any
  private hBitmap: any
  private dibView: Uint8Array
  private width = MIN_WIDTH
  private height = LINE_HEIGHT + PADDING_Y * 2
  private currentText: string | null = null
  private currentKind: NonNullable<BubbleTextOptions['kind']> = 'think'

  // 复用的原生句柄/缓冲。
  private readonly ptSrc: any
  private readonly sz: any
  private readonly bf: any
  private bgraBuf: Uint8Array

  constructor(
    private readonly bindings: Win32Bindings,
    private readonly x: number,
    private readonly y: number,
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
      AlphaFormat: 1, // AC_SRC_ALPHA（逐像素 alpha）
    })
    this.bgraBuf = new Uint8Array(4)
    this.dibView = new Uint8Array(4)

    // 初始创建一个小窗口（隐藏），首次 setText 时按内容重建尺寸。
    const exStyle = WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT
    this.hwnd = bindings.createWindowExW(
      exStyle, 'DshDesktopPet', '', WS_POPUP,
      x, y, this.width, this.height,
      null, null, null, null,
    )
    const { hdcMem, hBitmap, bitsPtr, bitsLength } = this.createSurface(this.width, this.height)
    this.hdcMem = hdcMem
    this.hBitmap = hBitmap
    this.dibView = new Uint8Array(bindings.koffi.view(bitsPtr, bitsLength))
    this.bgraBuf = new Uint8Array(bitsLength)
    this.hide()
  }

  get bubbleWidth(): number {
    return this.width
  }

  get bubbleHeight(): number {
    return this.height
  }

  /** 当前是否有正在显示的内容（供显隐联动判断）。 */
  get hasText(): boolean {
    return this.currentText !== null
  }

  /** 创建一个匹配尺寸的 DIB 表面（与宠物窗口同一套创建方式）。 */
  private createSurface(width: number, height: number): { hdcMem: any; hBitmap: any; bitsPtr: any; bitsLength: number } {
    const { koffi, createDibSection, createCompatibleDC, selectObject, getDC, releaseDC, BITMAPINFOHEADER } = this.bindings
    const header = koffi.alloc(BITMAPINFOHEADER, 1)
    koffi.encode(header, BITMAPINFOHEADER, {
      biSize: 40,
      biWidth: width,
      biHeight: -height, // top-down
      biPlanes: 1,
      biBitCount: 32,
      biCompression: BI_RGB,
      biSizeImage: width * height * 4,
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
    return { hdcMem, hBitmap, bitsPtr, bitsLength: width * height * 4 }
  }

  /**
   * 按像素宽度折行，返回行数组。最多 MAX_LINES 行：超出部分折叠到末行，
   * 并在末尾追加省略号（"…"），保证折叠后仍不超宽。
   */
  private wrapLines(text: string): string[] {
    const { koffi, getTextExtentPoint32W, SIZE } = this.bindings
    const size = koffi.alloc(SIZE, 1)
    const lines: string[] = []
    let current = ''
    for (const ch of text) {
      const probe = current + ch
      getTextExtentPoint32W(this.hdcMem, probe, probe.length, size)
      const w = koffi.decode(size, SIZE).cx
      if (current.length > 0 && w > MAX_WIDTH) {
        lines.push(current)
        if (lines.length === MAX_LINES) {
          // 已经满两行：剩余内容折叠进第二行（去掉超宽尾部，补省略号）。
          return this.foldTail(lines, text.slice(probe.length), size)
        }
        current = ch
      } else {
        current = probe
      }
    }
    if (current.length > 0 || lines.length === 0) lines.push(current)
    return lines
  }

  /** 把剩余文本折叠进末行：去掉放不下的尾部字符，追加省略号。 */
  private foldTail(lines: string[], tail: string, size: any): string[] {
    const { koffi, getTextExtentPoint32W, SIZE } = this.bindings
    let second = lines[MAX_LINES - 1]
    // 先把第二行恢复到能容纳一个省略号的宽度（若已超，删尾部字符）。
    for (;;) {
      const probe = second + '…'
      getTextExtentPoint32W(this.hdcMem, probe, probe.length, size)
      if (koffi.decode(size, SIZE).cx <= MAX_WIDTH || second.length === 0) break
      second = second.slice(0, -1)
    }
    // 再把 tail 的字符逐个往第二行塞（直到放不下）。
    for (const ch of tail) {
      const probe = second + ch + '…'
      getTextExtentPoint32W(this.hdcMem, probe, probe.length, size)
      if (koffi.decode(size, SIZE).cx > MAX_WIDTH) break
      second += ch
    }
    lines[MAX_LINES - 1] = second + '…'
    return lines.slice(0, MAX_LINES)
  }

  /** 计算给定文本所需的窗口尺寸。 */
  private measure(text: string): { width: number; height: number; lines: string[] } {
    const lines = this.wrapLines(text)
    let maxLineWidth = MIN_WIDTH
    const { koffi, getTextExtentPoint32W, SIZE } = this.bindings
    const size = koffi.alloc(SIZE, 1)
    for (const line of lines) {
      getTextExtentPoint32W(this.hdcMem, line, line.length, size)
      const w = koffi.decode(size, SIZE).cx
      if (w > maxLineWidth) maxLineWidth = w
    }
    const width = Math.min(Math.max(maxLineWidth + PADDING_X * 2, MIN_WIDTH), MAX_WIDTH + PADDING_X * 2)
    const height = lines.length * LINE_HEIGHT + PADDING_Y * 2
    return { width, height, lines }
  }

  /** 销毁旧表面并按新尺寸重建窗口。 */
  private rebuild(width: number, height: number): void {
    this.bindings.destroyWindow(this.hwnd)
    this.bindings.deleteObject(this.hBitmap)
    this.bindings.deleteDC(this.hdcMem)
    const { hdcMem, hBitmap, bitsPtr, bitsLength } = this.createSurface(width, height)
    this.hdcMem = hdcMem
    this.hBitmap = hBitmap
    this.dibView = new Uint8Array(this.bindings.koffi.view(bitsPtr, bitsLength))
    this.bgraBuf = new Uint8Array(bitsLength)
    this.width = width
    this.height = height
    const exStyle = WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT
    this.hwnd = this.bindings.createWindowExW(
      exStyle, 'DshDesktopPet', '', WS_POPUP,
      this.x, this.y, width, height,
      null, null, null, null,
    )
  }

  /** 判断像素是否位于圆角矩形内（四角按 ROUND_RADIUS 切圆）。 */
  private insideRoundedRect(px: number, py: number): boolean {
    const w = this.width
    const h = this.height
    const r = ROUND_RADIUS
    if (px < r && py < r) return (px - r) ** 2 + (py - r) ** 2 <= r * r
    if (px >= w - r && py < r) return (px - (w - r)) ** 2 + (py - r) ** 2 <= r * r
    if (px < r && py >= h - r) return (px - r) ** 2 + (py - (h - r)) ** 2 <= r * r
    if (px >= w - r && py >= h - r) return (px - (w - r)) ** 2 + (py - (h - r)) ** 2 <= r * r
    return true
  }

  /** 绘制：GDI 画背景圆角 + 文本，然后把圆角内像素 alpha 刷为 255。 */
  private draw(lines: string[], kind: NonNullable<BubbleTextOptions['kind']>): void {
    const { koffi, textOutW, setBkMode, setTextColor, createSolidBrush, fillRgn, frameRgn, createRoundRectRgn, deleteObject } = this.bindings

    // 1. 整窗初始化为透明黑（alpha=0），圆角外保持透明。
    const u32 = new Uint32Array(this.dibView.buffer, this.dibView.byteOffset, this.dibView.byteLength / 4)
    u32.fill(0)

    // 2. GDI 画圆角背景 + 边框。
    const bgColor = kind === 'confirm' ? COLOR_CONFIRM_BG : COLOR_BG
    const borderColor = kind === 'confirm' ? COLOR_CONFIRM_BORDER : COLOR_BORDER
    const rgn = createRoundRectRgn(0, 0, this.width, this.height, ROUND_RADIUS * 2, ROUND_RADIUS * 2)
    const bgBrush = createSolidBrush(bgColor)
    const borderBrush = createSolidBrush(borderColor)
    fillRgn(this.hdcMem, rgn, bgBrush)
    frameRgn(this.hdcMem, rgn, borderBrush, BORDER_WIDTH, BORDER_WIDTH)

    // 3. GDI 画文本（透明背景，逐行）。
    setBkMode(this.hdcMem, 1 /* TRANSPARENT */)
    setTextColor(this.hdcMem, COLOR_TEXT)
    this.bindings.selectObject(this.hdcMem, this.bindings.bubbleFont)
    lines.forEach((line, index) => {
      textOutW(this.hdcMem, PADDING_X, PADDING_Y + index * LINE_HEIGHT, line, line.length)
    })

    // 4. 圆角矩形内像素 alpha 刷为 255（覆盖 GDI 写入的 alpha=0）。
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.insideRoundedRect(x, y)) {
          const i = y * this.width + x
          u32[i] = (u32[i] & 0x00ffffff) | 0xff000000
        }
      }
    }

    // 5. 呈现。
    const { updateLayeredWindow } = this.bindings
    koffi.encode(this.sz, this.bindings.SIZE, { cx: this.width, cy: this.height })
    updateLayeredWindow(this.hwnd, 0, null, this.sz, this.hdcMem, this.ptSrc, 0, this.bf, ULW_ALPHA)

    deleteObject(rgn)
    deleteObject(bgBrush)
    deleteObject(borderBrush)
  }

  /** 更新气泡内容；尺寸变化时重建窗口。 */
  setText(options: BubbleTextOptions | null): void {
    if (this.destroyed) return
    if (!options || options.text.length === 0) {
      if (this.currentText !== null) {
        this.currentText = null
        this.hide()
      }
      return
    }
    const kind = options.kind ?? 'think'
    if (options.text === this.currentText && kind === this.currentKind) return

    const { width, height, lines } = this.measure(options.text)
    if (width !== this.width || height !== this.height) {
      this.rebuild(width, height)
    }
    this.currentText = options.text
    this.currentKind = kind
    this.draw(lines, kind)
    this.show()
  }

  /** 移动到屏幕坐标（x, y 为窗口左上角）。 */
  setPosition(x: number, y: number): void {
    if (this.destroyed) return
    this.bindings.setWindowPos(this.hwnd, HWND_TOPMOST, Math.round(x), Math.round(y), 0, 0, 0x0001 | 0x0010)
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
    try {
      this.bindings.destroyWindow(this.hwnd)
    } catch {
      // 尽力清理。
    }
    this.bindings.deleteObject(this.hBitmap)
    this.bindings.deleteDC(this.hdcMem)
  }
}
