/**
 * Private local persistence for the pet's window position.
 *
 * Deliberately independent of any Harness storage service: the pet reads and
 * writes a single JSON file under the user's home directory so it works
 * without optional plugins. All I/O is best-effort — failures are ignored so
 * a missing/readonly path can never break the pet or Harness.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface PersistedPosition {
  x: number
  y: number
}

const DIR = join(homedir(), '.dsh', 'desktop-pet')
const FILE = join(DIR, 'position.json')

function safeDir(): void {
  try {
    mkdirSync(DIR, { recursive: true })
  } catch {
    /* ignore */
  }
}

export function loadPosition(): PersistedPosition | null {
  try {
    const raw = readFileSync(FILE, 'utf8')
    const value = JSON.parse(raw) as Partial<PersistedPosition>
    if (typeof value.x === 'number' && typeof value.y === 'number') {
      return { x: value.x, y: value.y }
    }
    return null
  } catch {
    return null
  }
}

export function savePosition(position: PersistedPosition): void {
  try {
    safeDir()
    writeFileSync(FILE, JSON.stringify(position), 'utf8')
  } catch {
    /* ignore — persistence is best-effort */
  }
}

export const positionFile = FILE
export function positionDir(): string {
  return dirname(FILE)
}
