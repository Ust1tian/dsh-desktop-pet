/**
 * The Codex Pet sprite-sheet contract.
 *
 * This encodes the externally-observed format produced by the `hatch-pet`
 * skill: a single `pet.json` manifest plus a sprite-sheet image whose animation
 * rows are fixed by convention. There is no official OpenAI spec; these
 * constants are cross-checked against several independent reimplementations
 * and are kept in one place so a discrepancy is a single-point fix.
 *
 * This module is deliberately free of I/O and rendering: it only describes
 * the format. `PetLoader` turns it into loadable frame tables.
 */

import type { CodexPetState } from '../../core/types'

/** Fixed cell dimensions of every animation frame, in pixels. */
export const CELL_WIDTH = 192
export const CELL_HEIGHT = 208

/** Number of sprite columns (identical for v1 and v2). */
export const COLUMNS = 8

/** v1 atlas has 9 rows (8 activity rows + 1 unused); v2 has 11 (9 + 2 look rows). */
export const ROWS_V1 = 9
export const ROWS_V2 = 11

/** The manifest fields `pet.json` is expected to declare. */
export interface PetManifest {
  id: string
  displayName?: string
  description?: string
  /** 1 selects the 8×9 layout, 2 the 8×11 layout. Absent defaults to 1. */
  spriteVersionNumber?: 1 | 2
  spritesheetPath: string
}

/**
 * One animation row: the renderer state it represents plus its per-frame
 * durations. Look-direction rows (v2) carry no timings and are excluded.
 */
export interface AnimationRow {
  state: CodexPetState
  /** Per-frame display duration in milliseconds. */
  durations: number[]
}

/**
 * Per-frame durations baked into the Codex renderer. Rows are indexed in
 * sprite-sheet row order (row 0 = `idle` … row 8 = `review`).
 */
export const ANIMATION_ROWS: readonly AnimationRow[] = [
  { state: 'idle', durations: [280, 110, 110, 140, 140, 320] },
  { state: 'running-right', durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  { state: 'running-left', durations: [120, 120, 120, 120, 120, 120, 120, 220] },
  { state: 'waving', durations: [140, 140, 140, 280] },
  { state: 'jumping', durations: [140, 140, 140, 140, 280] },
  { state: 'failed', durations: [140, 140, 140, 140, 140, 140, 140, 240] },
  { state: 'waiting', durations: [150, 150, 150, 150, 150, 260] },
  { state: 'running', durations: [120, 120, 120, 120, 120, 220] },
  { state: 'review', durations: [150, 150, 150, 150, 150, 280] },
]

/** Map from a renderer state to its animation row definition. */
export function animationRowFor(state: CodexPetState): AnimationRow | undefined {
  return ANIMATION_ROWS.find(row => row.state === state)
}

/**
 * Derive the pixel rectangle of frame `index` for a given state row.
 * Frames are laid out row-major, left-to-right: frame `i` occupies
 * `(i * CELL_WIDTH, rowIndex * CELL_HEIGHT)`.
 */
export function frameRect(state: CodexPetState, index: number): { x: number; y: number; width: number; height: number } {
  const row = animationRowFor(state)
  if (!row) throw new Error(`Unknown Codex pet state: ${state}`)
  const rowIndex = ANIMATION_ROWS.indexOf(row)
  const frameCount = row.durations.length
  const i = ((index % frameCount) + frameCount) % frameCount
  return { x: i * CELL_WIDTH, y: rowIndex * CELL_HEIGHT, width: CELL_WIDTH, height: CELL_HEIGHT }
}

/** Expected atlas dimensions for a given sprite version. */
export function atlasSize(version: 1 | 2): { width: number; height: number } {
  const rows = version === 2 ? ROWS_V2 : ROWS_V1
  return { width: COLUMNS * CELL_WIDTH, height: rows * CELL_HEIGHT }
}
