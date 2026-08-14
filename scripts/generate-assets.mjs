// Generates the bundled placeholder pets in the Codex sprite-sheet format
// (v1: 8 columns × 9 rows, 192×208 cells, lossless WebP) plus a pet.json each.
//
// The artwork is original, programmatic geometry (a "blob" with eyes) with
// three color schemes; it contains no OpenAI/Codex/DeepSeek character artwork
// or trademarks. Run: `pnpm gen:assets`.

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

// One palette per bundled pet: body, outline, eye, cheek accent.
const PETS = [
  { id: 'blob', displayName: 'Blob', body: [52, 211, 153], outline: [6, 78, 59], eye: [15, 23, 42], accent: [254, 202, 202] },
  { id: 'coral', displayName: 'Coral', body: [244, 114, 182], outline: [131, 24, 67], eye: [15, 23, 42], accent: [254, 226, 226] },
  { id: 'sky', displayName: 'Sky', body: [125, 211, 252], outline: [12, 74, 110], eye: [15, 23, 42], accent: [224, 242, 254] },
]

function renderPalette(palette) {
  const atlas = new Uint8Array(CELL_W * COLS * CELL_H * ROWS * 4)
  const BODY = palette.body
  const OUTLINE = palette.outline
  const EYE = palette.eye
  const ACCENT = palette.accent

  function put(x, y, [r, g, b], a = 255) {
    if (x < 0 || y < 0 || x >= CELL_W * COLS || y >= CELL_H * ROWS) return
    const i = (y * CELL_W * COLS + x) * 4
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

  function blob(cx, cy, { rx = 56, ry = 64, bob = 0, squash = 0, eyes = 'open', lean = 0, arm = false } = {}) {
    const y = cy + bob
    filledEllipse(cx + lean, y, rx, ry - squash, BODY)
    ringEllipse(cx + lean, y, rx, ry - squash, OUTLINE, 3)

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

    filledEllipse(cx + lean - eyeDX - 4, eyeY + 14, 6, 4, ACCENT)
    filledEllipse(cx + lean + eyeDX + 4, eyeY + 14, 6, 4, ACCENT)

    if (arm) {
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
          for (let d = 1; d <= 3; d++) {
            filledRect(cx - 70 - d * 6, cy - 20 + d * 14, cx - 70 - d * 6 + 8, cy - 20 + d * 14 + 3, OUTLINE)
          }
          blob(cx, cy, { bob: f % 2 ? 1 : 0, eyes: 'open' })
          break
        }
        case 'review': {
          const x0 = cx + 8
          const y0 = cy - 80
          for (let t = 0; t < 12; t++) put(x0 - t, y0 + t, OUTLINE)
          for (let t = 0; t < 16; t++) put(x0 - 12 + t, y0 + 12 + t, OUTLINE)
          blob(cx, cy, { eyes: 'open' })
          break
        }
      }
    }
  }

  for (let r = 0; r < ROWS_SPEC.length; r++) {
    drawRow(r, ROWS_SPEC[r].state, ROWS_SPEC[r].frames)
  }
  return atlas
}

const outDir = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(outDir, '..', 'assets', 'pets')

for (const pet of PETS) {
  const dir = join(assetsDir, pet.id)
  mkdirSync(dir, { recursive: true })
  const atlas = renderPalette(pet)
  const image = await sharp(atlas, { raw: { width: CELL_W * COLS, height: CELL_H * ROWS, channels: 4 } })
    .webp({ lossless: true })
    .toBuffer()
  writeFileSync(join(dir, 'spritesheet.webp'), image)

  const manifest = {
    id: `dsh-${pet.id}`,
    displayName: pet.displayName,
    description: `Original placeholder desktop pet for deepseek-harness (${pet.displayName.toLowerCase()} blob).`,
    spritesheetPath: 'spritesheet.webp',
  }
  writeFileSync(join(dir, 'pet.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`Wrote ${dir}/spritesheet.webp (${image.length} bytes) and pet.json`)
}

// The text test pet: each animation row is a solid colour with the renderer
// state name and a per-frame number, so state→appearance binding is obvious
// when driving real tasks. Original SVG-drawn text; no third-party artwork.
async function generateTextPet() {
  const dir = join(assetsDir, 'text')
  mkdirSync(dir, { recursive: true })

  const ROWS = ROWS_SPEC.map(r => r.state)
  const ROW_COLORS = {
    'idle': '#2e7d32',
    'running-right': '#1565c0',
    'running-left': '#1565c0',
    'waving': '#f9a825',
    'jumping': '#ef6c00',
    'failed': '#c62828',
    'waiting': '#6a1b9a',
    'running': '#00838f',
    'review': '#37474f',
  }
  const MAX_FRAMES = 8

  // Compose one big SVG with an 8-column grid per row, then slice per row.
  // Text is sized to fit the 192px cell width so librsvg does not widen the
  // 1536px canvas (the longest label, "running-right", must stay in-cell).
  let cells = ''
  for (let r = 0; r < ROWS.length; r++) {
    const state = ROWS[r]
    const frames = ROWS_SPEC[r].frames
    const color = ROW_COLORS[state]
    for (let f = 0; f < frames; f++) {
      const x = f * CELL_W
      const y = r * CELL_H
      cells += `<rect x="${x}" y="${y}" width="${CELL_W}" height="${CELL_H}" fill="${color}"/>`
      cells += `<text x="${x + CELL_W / 2}" y="${y + 92}" font-size="20" font-family="Arial, sans-serif" font-weight="bold" fill="#ffffff" text-anchor="middle">${state}</text>`
      cells += `<text x="${x + CELL_W / 2}" y="${y + 120}" font-size="16" font-family="Arial, sans-serif" fill="rgba(255,255,255,0.9)" text-anchor="middle">frame ${f + 1}/${frames}</text>`
    }
  }

  const svg = `<svg width="${CELL_W * COLS}" height="${CELL_H * ROWS}" viewBox="0 0 ${CELL_W * COLS} ${CELL_H * ROWS}" xmlns="http://www.w3.org/2000/svg">${cells}</svg>`
  const image = await sharp(Buffer.from(svg)).webp({ lossless: true }).toBuffer()
  writeFileSync(join(dir, 'spritesheet.webp'), image)

  const manifest = {
    id: 'dsh-text',
    displayName: 'Text (test)',
    description: 'Text test pet: each state renders a distinct label and colour for binding verification.',
    spritesheetPath: 'spritesheet.webp',
  }
  writeFileSync(join(dir, 'pet.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`Wrote ${dir}/spritesheet.webp (${image.length} bytes) and pet.json`)
}

await generateTextPet()
