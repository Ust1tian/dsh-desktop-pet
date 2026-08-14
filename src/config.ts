/**
 * Plugin configuration.
 *
 * The entry `Config` schema is a Schemastery object (satisfying the Standard
 * Schema interface Cordis expects) so `cordis.yml` can provide overrides and
 * invalid values fail loudly at load time. The smaller {@link PetSettings}
 * schema is the user-editable subset registered as a settings namespace so the
 * Web configuration page can change it at runtime; the entry config fields
 * (`enabled`, `petScale`, `petId`) are that namespace's composition `base`.
 *
 * Position persistence lives in a private local file (not the harness config
 * service), so the pet works without any optional Harness storage service.
 */

import z from '@deepseek-ai/schemastery'

/** Bundled pet ids shipped under `assets/pets/<id>/`. */
export const BUNDLED_PET_IDS = ['blob', 'coral', 'sky', 'text'] as const
export type PetId = (typeof BUNDLED_PET_IDS)[number]

/** Settings namespace name (spelled identically in the client package). */
export const DESKTOP_PET_SETTINGS_NS = 'desktop-pet'

/** User-editable settings section exposed on the Web configuration page. */
export interface PetSettings {
  /** Show or hide the pet. */
  enabled: boolean
  /** Integer scale multiplier applied to the 192×208 atlas cells. */
  petScale: number
  /** Which bundled pet to display (ignored while `petPath` is set). */
  petId: PetId
  /** Hide the pet while no task is running; show it again on activity. */
  hideWhenIdle: boolean
}

export const PetSettingsSchema: z<PetSettings> = z.object({
  enabled: z.boolean().default(true),
  petScale: z.number().step(0.25).min(0.5).max(4).default(1),
  petId: z.union(BUNDLED_PET_IDS.map(id => z.const(id))).default('blob'),
  hideWhenIdle: z.boolean().default(false),
})

export interface PetConfig {
  /** Composition-level master switch; when false the plugin loads but shows nothing. */
  enabled: boolean
  /** Keep the pet above other windows. */
  alwaysOnTop: boolean
  /** Integer scale multiplier applied to the 192×208 atlas cells. */
  petScale: number
  /** Which bundled pet to display (ignored while `petPath` is set). */
  petId: PetId
  /** Hide the pet while no task is running; show it again on activity. */
  hideWhenIdle: boolean
  /** Run the frame animation. When false, a single static frame is shown. */
  animationEnabled: boolean
  /** Show the short status bubble under the pet. */
  showStatusBubble: boolean
  /** Seconds (>=8) between randomized idle variations. */
  idleFrequencySec: number
  /** Pass pointer events through the window (Windows only). */
  clickThrough: boolean
  /** Start in the sleeping state. */
  startSleeping: boolean
  /** Global animation speed multiplier. */
  animationSpeed: number
  /** Directory containing a `pet.json` + sprite sheet (hatch-pet output). */
  petPath: string | null
}

export const Config: z<PetConfig> = z.object({
  enabled: z.boolean().default(true),
  alwaysOnTop: z.boolean().default(true),
  petScale: z.number().step(0.25).min(0.5).max(4).default(1),
  petId: z.union(BUNDLED_PET_IDS.map(id => z.const(id))).default('blob'),
  hideWhenIdle: z.boolean().default(false),
  animationEnabled: z.boolean().default(true),
  showStatusBubble: z.boolean().default(true),
  idleFrequencySec: z.natural().min(8).default(20),
  clickThrough: z.boolean().default(false),
  startSleeping: z.boolean().default(false),
  animationSpeed: z.number().min(0.25).max(4).default(1),
  petPath: z.union([z.string(), z.const(null)]).default(null),
})

export const DEFAULT_CONFIG: PetConfig = {
  enabled: true,
  alwaysOnTop: true,
  petScale: 1,
  petId: 'blob',
  hideWhenIdle: false,
  animationEnabled: true,
  showStatusBubble: true,
  idleFrequencySec: 20,
  clickThrough: false,
  startSleeping: false,
  animationSpeed: 1,
  petPath: null,
}
