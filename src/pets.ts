/**
 * Host-side pet catalog: maps a pet id (or a custom `petPath` directory) to a
 * decoded sprite atlas, and reports the ids the client UI may offer.
 */

import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { BUNDLED_PET_IDS, type PetId } from './config'
import { loadPet } from './renderer/codex-pet/PetLoader'
import type { LoadedPet } from './renderer/codex-pet/PetLoader'
import type { AtlasBuffer } from './renderer/FrameDecoder'

const ASSETS_DIR = fileURLToPath(new URL('../assets/pets/', import.meta.url))

/** The bundle-shipped pet ids (kept in one place for the client catalog). */
export const PET_CATALOG: ReadonlyArray<{ id: PetId; displayName: string }> = [
  { id: 'blob', displayName: 'Blob' },
  { id: 'coral', displayName: 'Coral' },
  { id: 'sky', displayName: 'Sky' },
  { id: 'text', displayName: 'Text (test)' },
]

function toAtlas(loaded: LoadedPet): AtlasBuffer {
  return { width: loaded.atlasWidth, height: loaded.atlasHeight, rgba: loaded.rgba }
}

/**
 * Resolve the directory a pet is loaded from: an explicit custom `petPath`
 * (hatch-pet output) wins; otherwise the bundled `assets/pets/<petId>`.
 */
export function resolvePetDirectory(petPath: string | null, petId: PetId): string {
  if (petPath) return petPath
  return join(ASSETS_DIR, petId)
}

/** Load a pet by id into an atlas. */
export async function loadPetAtlas(petId: PetId, petPath: string | null): Promise<AtlasBuffer> {
  const loaded = await loadPet({ directory: resolvePetDirectory(petPath, petId) })
  return toAtlas(loaded)
}

/** Whether a string is one of the bundled pet ids (used for settings validation). */
export function isBundledPetId(value: string): value is PetId {
  return (BUNDLED_PET_IDS as readonly string[]).includes(value)
}
