import { describe, expect, it } from 'vitest'
import { loadPet } from '../src/renderer/codex-pet/PetLoader'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A decoder stub that returns a 1536×1872 atlas (v1) without sharp. */
function fakeDecoder(width: number, height: number) {
  return async () => ({ rgba: new Uint8Array(width * height * 4), width, height })
}

function makePetDir() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'pet.json'),
    JSON.stringify({ id: 'test', spritesheetPath: 'sheet.webp', spriteVersionNumber: 1 }),
  )
  return dir
}

describe('loadPet', () => {
  it('loads a v1 pet manifest and atlas', async () => {
    const dir = makePetDir()
    const loaded = await loadPet({ directory: dir, decoder: fakeDecoder(1536, 1872) })
    expect(loaded.manifest.id).toBe('test')
    expect(loaded.version).toBe(1)
    expect(loaded.atlasWidth).toBe(1536)
    expect(loaded.atlasHeight).toBe(1872)
    expect(loaded.rgba.length).toBe(1536 * 1872 * 4)
  })

  it('rejects a sprite sheet whose width breaks the contract', async () => {
    const dir = makePetDir()
    await expect(loadPet({ directory: dir, decoder: fakeDecoder(1000, 1872) })).rejects.toThrow(/width/)
  })

  it('rejects a manifest missing id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-'))
    writeFileSync(join(dir, 'pet.json'), JSON.stringify({ spritesheetPath: 'sheet.webp' }))
    await expect(loadPet({ directory: dir, decoder: fakeDecoder(1536, 1872) })).rejects.toThrow(/id/)
  })

  it('defaults spriteVersionNumber to 1 when absent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-pet-'))
    writeFileSync(join(dir, 'pet.json'), JSON.stringify({ id: 'v1', spritesheetPath: 'sheet.webp' }))
    const loaded = await loadPet({ directory: dir, decoder: fakeDecoder(1536, 1872) })
    expect(loaded.version).toBe(1)
  })
})
