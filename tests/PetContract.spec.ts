import { describe, expect, it } from 'vitest'
import {
  animationRowFor,
  atlasSize,
  frameRect,
  ANIMATION_ROWS,
  CELL_HEIGHT,
  CELL_WIDTH,
} from '../src/renderer/codex-pet/PetContract'

describe('PetContract', () => {
  it('has the nine Codex animation rows in order', () => {
    expect(ANIMATION_ROWS.map(r => r.state)).toEqual([
      'idle',
      'running-right',
      'running-left',
      'waving',
      'jumping',
      'failed',
      'waiting',
      'running',
      'review',
    ])
  })

  it('reports v1 and v2 atlas sizes', () => {
    expect(atlasSize(1)).toEqual({ width: 8 * 192, height: 9 * 208 })
    expect(atlasSize(2)).toEqual({ width: 8 * 192, height: 11 * 208 })
  })

  it('computes frame rects row-major', () => {
    const idle = animationRowFor('idle')!
    expect(idle.durations.length).toBe(6)
    // Frame 0 of idle = row 0, col 0.
    expect(frameRect('idle', 0)).toEqual({ x: 0, y: 0, width: CELL_WIDTH, height: CELL_HEIGHT })
    // Frame 1 of idle = row 0, col 1.
    expect(frameRect('idle', 1)).toEqual({ x: CELL_WIDTH, y: 0, width: CELL_WIDTH, height: CELL_HEIGHT })
    // Waving is row 3.
    expect(frameRect('waving', 0)).toEqual({ x: 0, y: 3 * CELL_HEIGHT, width: CELL_WIDTH, height: CELL_HEIGHT })
  })

  it('wraps frame indices', () => {
    expect(frameRect('waving', 4)).toEqual({ x: 0, y: 3 * CELL_HEIGHT, width: CELL_WIDTH, height: CELL_HEIGHT })
  })

  it('throws for unknown states', () => {
    expect(() => frameRect('bogus' as never, 0)).toThrow()
  })
})
