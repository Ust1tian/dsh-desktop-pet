/**
 * Plugin configuration.
 *
 * The schema is a Schemastery object (satisfying the Standard Schema interface
 * Cordis expects) so `cordis.yml` can provide overrides and invalid values
 * fail loudly at load time. Position persistence lives in a private local file
 * (not the harness config service), so the pet works without any optional
 * Harness storage service.
 */

import z from '@deepseek-ai/schemastery'

export interface PetConfig {
  /** Master switch; when false the plugin loads but shows nothing. */
  enabled: boolean
  /** Keep the pet above other windows. */
  alwaysOnTop: boolean
  /** Integer scale multiplier applied to the 192×208 atlas cells. */
  petScale: number
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
  petScale: z.natural().min(1).default(1),
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
  animationEnabled: true,
  showStatusBubble: true,
  idleFrequencySec: 20,
  clickThrough: false,
  startSleeping: false,
  animationSpeed: 1,
  petPath: null,
}
