/**
 * Optional host settings integration.
 *
 * Registers the user-editable `desktop-pet` namespace against the Harness
 * settings service when one exists, and applies the resolved section (schema
 * defaults → composition base → user layer) to the pet through an `onApply`
 * callback. When no settings service is present, it applies the composition
 * entry once and returns a no-op disposer, so the pet still works without the
 * optional settings seam.
 *
 * The namespace name and field schema are spelled here rather than importing
 * `@deepseek-ai/dsh-settings`, so this independent plugin carries no runtime
 * dependency on a Harness workspace package: a settings namespace is an
 * ordinary lowercase-kebab string on the wire.
 */

import { DESKTOP_PET_SETTINGS_NS, PetSettingsSchema, type PetSettings } from './config'

/** The resolved, user-editable settings surface the pet reacts to. */
export type PetSettingsSnapshot = PetSettings

/** The narrow settings-owner scope shape this plugin consumes. */
export interface PetSettingsScope {
  get(): PetSettingsSnapshot
  watch(callback: (next: PetSettingsSnapshot, prev: PetSettingsSnapshot) => void | Promise<void>): () => void
}

/** The narrow settings-provider shape this plugin consumes. */
export interface PetSettingsRegistrar {
  register(
    namespace: string,
    schema: unknown,
    options?: { base?: PetSettingsSnapshot; applies?: 'live' | 'restart' },
  ): PetSettingsScope
}

/**
 * Install the settings wiring.
 *
 * @param registrar - the settings service (already resolved), or undefined.
 * @param base - the composition entry config, used as the namespace base layer.
 * @param onApply - invoked with each resolved settings snapshot.
 * @returns a disposer that stops reacting (namespace ownership follows the provider).
 */
export function installPetSettings(
  registrar: PetSettingsRegistrar | undefined,
  base: PetSettingsSnapshot,
  onApply: (settings: PetSettingsSnapshot) => void,
): () => void {
  if (!registrar) {
    onApply(base)
    return () => {}
  }
  const scope = registrar.register(DESKTOP_PET_SETTINGS_NS, PetSettingsSchema, { base })
  onApply(scope.get())
  // The registrar's watch passes (next, prev); onApply only cares about the
  // resolved next value, so narrow it to keep the callback signature stable.
  return scope.watch((next) => onApply(next))
}
