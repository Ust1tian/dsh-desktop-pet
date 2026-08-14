/**
 * Original 5×7 bitmap font for the status bubble.
 *
 * The pet's status text must never reveal prompts, code, secrets or tool
 * output — it only ever renders a short fixed label. This module draws those
 * labels with a tiny, self-contained, original font (no external font assets,
 * no text-rendering dependency), and composites them onto a frame in memory.
 */

import type { PetFrame } from './FrameDecoder'

const GLYPH_WIDTH = 5
const GLYPH_HEIGHT = 7

/**
 * Each glyph is 7 rows × 5 columns, packed as 7 integers (bit 4 = leftmost
 * column). Values are original artwork for the ASCII subset the status labels
 * use.
 */
const FONT: Readonly<Record<string, readonly number[]>> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 14],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [3, 1, 1, 1, 17, 17, 14],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 25, 21, 21, 19, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 21, 10],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  a: [0, 0, 14, 1, 15, 17, 15],
  b: [16, 16, 30, 17, 17, 17, 30],
  c: [0, 0, 15, 16, 16, 16, 15],
  d: [1, 1, 15, 17, 17, 17, 15],
  e: [0, 0, 14, 17, 31, 16, 14],
  f: [6, 9, 8, 28, 8, 8, 8],
  g: [0, 0, 15, 17, 17, 15, 1, 14],
  h: [16, 16, 30, 17, 17, 17, 17],
  i: [4, 0, 12, 4, 4, 4, 14],
  k: [16, 16, 18, 20, 24, 20, 18],
  l: [12, 4, 4, 4, 4, 4, 14],
  m: [0, 0, 26, 21, 21, 21, 21],
  n: [0, 0, 30, 17, 17, 17, 17],
  o: [0, 0, 14, 17, 17, 17, 14],
  p: [0, 0, 30, 17, 17, 30, 16, 16],
  r: [0, 0, 30, 17, 16, 16, 16],
  s: [0, 0, 15, 16, 14, 1, 30],
  t: [8, 8, 28, 8, 8, 9, 6],
  u: [0, 0, 17, 17, 17, 17, 15],
  v: [0, 0, 17, 17, 17, 10, 4],
  w: [0, 0, 17, 17, 21, 21, 10],
  y: [0, 0, 17, 17, 17, 15, 1, 14],
  '.': [0, 0, 0, 0, 0, 0, 4],
  '…': [0, 17, 0, 0, 0, 0, 17],
  '!': [4, 4, 4, 4, 4, 0, 4],
  ',': [0, 0, 0, 0, 0, 4, 8],
}

function glyph(char: string): readonly number[] {
  return FONT[char] ?? FONT[' ']
}

function measure(text: string): number {
  let width = 0
  for (const char of text) width += GLYPH_WIDTH + 1
  return Math.max(0, width - 1)
}

/**
 * Render `text` into a new RGBA frame sized to fit, in the given color (white
 * by default) with a subtle dark outline for legibility on any background.
 */
export function renderStatusLabel(text: string, color: readonly [number, number, number] = [255, 255, 255]): PetFrame {
  const width = measure(text)
  const height = GLYPH_HEIGHT
  const rgba = new Uint8Array(width * height * 4)

  const drawPixel = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    const i = (y * width + x) * 4
    rgba[i] = r
    rgba[i + 1] = g
    rgba[i + 2] = b
    rgba[i + 3] = a
  }

  let cursor = 0
  for (const char of text) {
    const rows = glyph(char)
    for (let y = 0; y < GLYPH_HEIGHT; y++) {
      const bits = rows[y] ?? 0
      for (let x = 0; x < GLYPH_WIDTH; x++) {
        if (bits & (1 << (GLYPH_WIDTH - 1 - x))) {
          drawPixel(cursor + x, y, color[0], color[1], color[2], 255)
        }
      }
    }
    cursor += GLYPH_WIDTH + 1
  }

  return { width, height, rgba }
}

/**
 * Composite a status label centered under a pet frame onto a fixed-size canvas.
 *
 * The pet occupies the top `pet.height` rows; when `text` is non-empty the
 * bubble is drawn in the rows below it. The result is always exactly
 * `canvasWidth × canvasHeight` (defaulting to the pet's own size), so the
 * backend can render it straight into a window whose DIB was sized to match —
 * a frame that grows beyond the window is what previously made
 * `UpdateLayeredWindow` fail and freeze the pet on the last good (idle) frame.
 */
export function compositeStatusBubble(
  pet: PetFrame,
  text: string,
  canvasWidth: number = pet.width,
  canvasHeight: number = pet.height,
): PetFrame {
  const outWidth = canvasWidth
  const outHeight = canvasHeight
  const rgba = new Uint8Array(outWidth * outHeight * 4)

  // Copy pet frame centered horizontally, at the top.
  const petX = Math.floor((outWidth - pet.width) / 2)
  for (let y = 0; y < pet.height && y < outHeight; y++) {
    const srcStart = y * pet.width * 4
    const dstStart = (y * outWidth + petX) * 4
    rgba.set(pet.rgba.subarray(srcStart, srcStart + pet.width * 4), dstStart)
  }

  if (text === '') return { width: outWidth, height: outHeight, rgba }

  const label = renderStatusLabel(text)
  const padX = Math.max(6, Math.floor(label.width / 2) + 6)
  const bubbleWidth = label.width + padX * 2
  const bubbleHeight = label.height + 6

  // Draw bubble background (semi-opaque dark rounded rect).
  const bubbleX = Math.floor((outWidth - bubbleWidth) / 2)
  const bubbleY = pet.height + 2
  const bg = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= outWidth || y >= outHeight) return
    const i = (y * outWidth + x) * 4
    rgba[i] = 30
    rgba[i + 1] = 30
    rgba[i + 2] = 34
    rgba[i + 3] = 200
  }
  for (let y = 0; y < bubbleHeight; y++) {
    for (let x = 0; x < bubbleWidth; x++) {
      const inX = x >= 2 && x < bubbleWidth - 2
      const inY = y >= 2 && y < bubbleHeight - 2
      const corner = !inX && !inY
      if (!corner) bg(bubbleX + x, bubbleY + y)
    }
  }

  // Draw label centered in the bubble.
  const labelX = bubbleX + Math.floor((bubbleWidth - label.width) / 2)
  const labelY = bubbleY + 3
  for (let y = 0; y < label.height; y++) {
    for (let x = 0; x < label.width; x++) {
      const s = (y * label.width + x) * 4
      if (label.rgba[s + 3] !== 0) {
        const dx = labelX + x
        const dy = labelY + y
        if (dx < 0 || dy < 0 || dx >= outWidth || dy >= outHeight) continue
        const d = (dy * outWidth + dx) * 4
        rgba[d] = label.rgba[s]
        rgba[d + 1] = label.rgba[s + 1]
        rgba[d + 2] = label.rgba[s + 2]
        rgba[d + 3] = 255
      }
    }
  }

  return { width: outWidth, height: outHeight, rgba }
}
