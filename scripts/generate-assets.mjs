// Generates the bundled placeholder pet in the Codex sprite-sheet format
// (v1: 8 columns × 9 rows, 192×208 cells, lossless WebP) plus a pet.json.
//
// Only the "text" test pet is bundled: each animation row is a solid colour
// with the renderer state name and a per-frame number, so state→appearance
// binding is obvious when driving real tasks. Additional pets are added by
// dropping a directory into assets/pets/<id>/ (see docs/adding-a-pet.md), not
// by editing this script. The artwork is original SVG-drawn text; it contains
// no OpenAI/Codex/DeepSeek character artwork or trademarks. Run: `pnpm gen:assets`.

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

const outDir = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(outDir, '..', 'assets', 'pets')

async function generateTextPet() {
  const dir = join(assetsDir, 'text')
  mkdirSync(dir, { recursive: true })

  const ROWS = ROWS_SPEC.map(r => r.state)

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
    id: 'text',
    displayName: 'Text (test)',
    description: 'Text test pet: each state renders a distinct label and colour for binding verification.',
    spritesheetPath: 'spritesheet.webp',
  }
  writeFileSync(join(dir, 'pet.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`Wrote ${dir}/spritesheet.webp (${image.length} bytes) and pet.json`)
}

await generateTextPet()
