/**
 * Loads a Codex-style pet directory into a raw RGBA atlas.
 *
 * The loader only knows the on-disk contract (`pet.json` + a sprite sheet).
 * It returns an in-memory atlas plus the manifest; frame slicing is the
 * renderer's concern via {@link PetContract.frameRect}.
 *
 * `sharp` is imported lazily so this module can be required in tests (and on
 * systems where the pet renderer is disabled) without pulling in the native
 * codec until an image is actually decoded.
 */

import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { atlasSize, CELL_WIDTH, type PetManifest } from './PetContract'

/** Decodes an image file into a premultiplied-free raw RGBA buffer. */
export type AtlasDecoder = (path: string) => Promise<{ rgba: Uint8Array; width: number; height: number }>

export interface LoadedPet {
  manifest: PetManifest
  version: 1 | 2
  atlasWidth: number
  atlasHeight: number
  /** RGBA bytes, `atlasWidth * atlasHeight * 4` in length. */
  rgba: Uint8Array
}

export interface PetLoadOptions {
  /** Override the image decoder (injected for tests). Defaults to sharp. */
  decoder?: AtlasDecoder
  /** Directory containing `pet.json`; defaults to `process.cwd()`. */
  directory?: string
}

/** Default decoder backed by `sharp` (lazily imported). */
export const sharpDecoder: AtlasDecoder = async (path) => {
  const { default: sharp } = await import('sharp')
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { rgba: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height }
}

function parseManifest(raw: string): PetManifest {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new Error(`pet.json is not valid JSON: ${(error as Error).message}`)
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('pet.json must be a JSON object')
  }
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id.length === 0) {
    throw new Error('pet.json is missing a string "id" field')
  }
  if (typeof record.spritesheetPath !== 'string' || record.spritesheetPath.length === 0) {
    throw new Error('pet.json is missing a string "spritesheetPath" field')
  }
  const version = record.spriteVersionNumber === 2 ? 2 : 1
  return {
    id: record.id,
    displayName: typeof record.displayName === 'string' ? record.displayName : undefined,
    description: typeof record.description === 'string' ? record.description : undefined,
    spriteVersionNumber: version,
    spritesheetPath: record.spritesheetPath,
  }
}

/**
 * Load and decode a pet directory.
 *
 * @param options - loader options; `directory` is where `pet.json` lives.
 * @returns the decoded atlas plus its manifest.
 */
export async function loadPet(options: PetLoadOptions = {}): Promise<LoadedPet> {
  const directory = resolve(options.directory ?? process.cwd())
  const decoder = options.decoder ?? sharpDecoder
  const manifestRaw = await readFile(join(directory, 'pet.json'), 'utf8')
  const manifest = parseManifest(manifestRaw)
  const version = manifest.spriteVersionNumber ?? 1

  const sheetPath = resolve(directory, manifest.spritesheetPath)
  const { rgba, width, height } = await decoder(sheetPath)

  const expected = atlasSize(version)
  // The contract fixes cell and column geometry; width is the hard invariant.
  if (width !== expected.width) {
    throw new Error(
      `Sprite sheet width ${width} does not match the ${CELL_WIDTH}px × ${expected.width / CELL_WIDTH} column contract (expected ${expected.width})`,
    )
  }
  if (height < expected.height) {
    throw new Error(
      `Sprite sheet height ${height} is smaller than the v${version} contract height ${expected.height}`,
    )
  }

  return { manifest, version, atlasWidth: width, atlasHeight: height, rgba }
}
