import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanPets } from '../src/pets'

function makePetDir(id: string, displayName?: string, manifestId = id) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-pets-'))
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  const manifest: Record<string, unknown> = { id: manifestId }
  if (displayName !== undefined) manifest.displayName = displayName
  writeFileSync(join(dir, 'pet.json'), JSON.stringify(manifest))
  return root
}

describe('scanPets', () => {
  it('returns the fallback text entry when the directory is empty', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-pets-'))
    const entries = scanPets(root)
    expect(entries).toEqual([{ id: 'text', displayName: 'Text (test)' }])
  })

  it('returns the fallback when the directory does not exist', () => {
    const entries = scanPets(join(tmpdir(), 'does-not-exist'))
    expect(entries).toEqual([{ id: 'text', displayName: 'Text (test)' }])
  })

  it('scans valid pet directories and reads their manifests', () => {
    const root = makePetDir('cat', 'Cat')
    mkdirSync(join(root, 'dog'))
    writeFileSync(join(root, 'dog', 'pet.json'), JSON.stringify({ id: 'dog', displayName: 'Dog' }))
    const entries = scanPets(root)
    expect(entries).toContainEqual({ id: 'cat', displayName: 'Cat' })
    expect(entries).toContainEqual({ id: 'dog', displayName: 'Dog' })
  })

  it('skips invalid directories', () => {
    const root = makePetDir('good', 'Good')
    // A directory without pet.json, and a directory with an id-less manifest.
    mkdirSync(join(root, 'empty'))
    mkdirSync(join(root, 'bad'))
    writeFileSync(join(root, 'bad', 'pet.json'), JSON.stringify({ displayName: 'No id' }))
    const entries = scanPets(root)
    expect(entries).toEqual([{ id: 'good', displayName: 'Good' }])
  })
})
