// Generates the bundled placeholder pet in the Codex sprite-sheet format
// (v1: 8 columns × 9 rows, 192×208 cells, lossless WebP) plus its pet.json.
//
// The artwork is original, programmatic geometry (a mint "blob" with eyes);
// it contains no OpenAI/Codex/DeepSeek character artwork or trademarks.
// Run: `pnpm gen:assets`.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const CELL_W = 192
const CELL_H = 208
const COLS = 8
const ROWS = 9

// Animation rows in Codex contract order; frame count per row.
const ROWS_SPEC = [
  { state: 'idle', frames: 6 },
  { state: 'running-right', frames: 8 },
  { state: 'running-left', frames: 8 },
  { state: 'waving', frames: 4 },
  { state: 'jumping', frames: 5 },
  { state: 'failed', frames: 8 },
  { state: 'waiting', frames: 6 },
  { state: 'running', frames: 6 },
  { state: 'review', frames: 6 },
]

const BODY = [52, 211, 153]
const OUTLINE = [6, 78, 59]
const EYE = [15, 23, 42]
const ACCENT = [254, 202, 202]

const atlas = new Uint8Array(CELL_W * COLS * CELL_H * ROWS * 4)

function put(x, y, [r, g, b], a = 255) {
  if (x < 0 || y < 0 || x >= CELL_W * COLS || y >= CELL_H * ROWS) return
  const i = (y * CELL_W * COLS + x) * 4
  // Alpha-over a transparent background; body pixels are opaque.
  atlas[i] = r
  atlas[i + 1] = g
  atlas[i + 2] = b
  atlas[i + 3] = a
}

function filledEllipse(cx, cy, rx, ry, color) {
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) put(cx + x, cy + y, color)
    }
  }
}

function ringEllipse(cx, cy, rx, ry, color, thickness = 2) {
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      const v = (x * x) / (rx * rx) + (y * y) / (ry * ry)
      if (v <= 1 && v >= ((rx - thickness) * (rx - thickness)) / (rx * rx) * 0.9) put(cx + x, cy + y, color)
    }
  }
}

function filledRect(x0, y0, x1, y1, color) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, color)
}

// Draw the base blob centered at (cx, cy). `eyes` picks eye style.
function blob(cx, cy, { rx = 56, ry = 64, bob = 0, squash = 0, eyes = 'open', lean = 0, arm = false } = {}) {
  const y = cy + bob
  filledEllipse(cx + lean, y, rx, ry - squash, BODY)
  ringEllipse(cx + lean, y, rx, ry - squash, OUTLINE, 3)

  // Eyes.
  const eyeY = y - 12
  const eyeDX = 20
  const eyeR = 7
  if (eyes === 'open') {
    filledEllipse(cx + lean - eyeDX, eyeY, eyeR, eyeR + 2, EYE)
    filledEllipse(cx + lean + eyeDX, eyeY, eyeR, eyeR + 2, EYE)
    filledEllipse(cx + lean - eyeDX - 2, eyeY - 3, 2, 2, [255, 255, 255])
    filledEllipse(cx + lean + eyeDX - 2, eyeY - 3, 2, 2, [255, 255, 255])
  } else if (eyes === 'blink') {
    filledRect(cx + lean - eyeDX - eyeR, eyeY, cx + lean - eyeDX + eyeR, eyeY + 2, EYE)
    filledRect(cx + lean + eyeDX - eyeR, eyeY, cx + lean + eyeDX + eyeR, eyeY + 2, EYE)
  } else if (eyes === 'x') {
    for (const d of [1, -1]) {
      for (const ex of [eyeDX, -eyeDX]) {
        for (let t = -eyeR; t <= eyeR; t++) put(cx + lean + ex + t, eyeY + d * t, EYE)
      }
    }
  } else if (eyes === 'up') {
    filledEllipse(cx + lean - eyeDX, eyeY - 5, eyeR, eyeR + 2, EYE)
    filledEllipse(cx + lean + eyeDX, eyeY - 5, eyeR, eyeR + 2, EYE)
  }

  // Cheeks.
  filledEllipse(cx + lean - eyeDX - 4, eyeY + 14, 6, 4, ACCENT)
  filledEllipse(cx + lean + eyeDX + 4, eyeY + 14, 6, 4, ACCENT)

  if (arm) {
    // A raised nub (the "wave").
    filledEllipse(cx + lean + rx - 6, y - ry + 10, 10, 10, BODY)
    ringEllipse(cx + lean + rx - 6, y - ry + 10, 10, 10, OUTLINE, 2)
  }
}

function drawRow(rowIdx, state, frames) {
  const cy = CELL_H / 2 + 14
  for (let f = 0; f < frames; f++) {
    const cx = f * CELL_W + CELL_W / 2
    switch (state) {
      case 'idle': {
        const bob = [0, 0, 1, 1, 0, 0][f % 6]
        blob(cx, cy, { bob, eyes: f === 2 || f === 5 ? 'blink' : 'open' })
        break
      }
      case 'running-right': {
        const lean = -10 + f * 2
        blob(cx, cy, { lean, bob: f % 2 ? 1 : 0, eyes: 'open' })
        break
      }
      case 'running-left': {
        const lean = 10 - f * 2
        blob(cx, cy, { lean, bob: f % 2 ? 1 : 0, eyes: 'open' })
        break
      }
      case 'waving':
        blob(cx, cy, { arm: true, bob: f === 1 ? -2 : 0, eyes: 'open' })
        break
      case 'jumping': {
        const bobs = [0, -6, -12, -6, 0]
        blob(cx, cy, { bob: bobs[f % 5], eyes: 'open' })
        break
      }
      case 'failed':
        blob(cx, cy, { squash: 10, eyes: 'x' })
        break
      case 'waiting':
        blob(cx, cy, { eyes: 'up', bob: f % 2 ? 0 : -1 })
        break
      case 'running': {
        // Motion dashes behind the body.
        for (let d = 1; d <= 3; d++) {
          filledRect(cx - 70 - d * 6, cy - 20 + d * 14, cx - 70 - d * 6 + 8, cy - 20 + d * 14 + 3, OUTLINE)
        }
        blob(cx, cy, { bob: f % 2 ? 1 : 0, eyes: 'open' })
        break
      }
      case 'review': {
        // A check mark above.
        const x0 = cx + 8
        const y0 = cy - 80
        for (let t = 0; t < 12; t++) put(x0 - t, y0 + t, [6, 78, 59])
        for (let t = 0; t < 16; t++) put(x0 - 12 + t, y0 + 12 + t, [6, 78, 59])
        blob(cx, cy, { eyes: 'open' })
        break
      }
    }
  }
}

for (let r = 0; r < ROWS_SPEC.length; r++) {
  drawRow(r, ROWS_SPEC[r].state, ROWS_SPEC[r].frames)
}

const outDir = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(outDir, '..', 'assets')
mkdirSync(assetsDir, { recursive: true })

const image = await sharp(atlas, { raw: { width: CELL_W * COLS, height: CELL_H * ROWS, channels: 4 } })
  .webp({ lossless: true })
  .toBuffer()
writeFileSync(join(assetsDir, 'spritesheet.webp'), image)

const manifest = {
  id: 'dsh-placeholder-blob',
  displayName: 'Blob',
  description: 'Original placeholder desktop pet for deepseek-harness (mint blob).',
  spriteVersionNumber: 1,
  spritesheetPath: 'spritesheet.webp',
}
writeFileSync(join(assetsDir, 'pet.json'), JSON.stringify(manifest, null, 2) + '\n')

console.log(`Wrote ${assetsDir}/spritesheet.webp (${image.length} bytes) and pet.json`)
