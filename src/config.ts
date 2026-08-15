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

/** One entry in the runtime-scanned pet catalog. */
export interface PetCatalogEntry {
  /** Directory name under `assets/pets/<id>/` (also the pet id). */
  id: string
  /** Human label shown in the settings picker. */
  displayName: string
}

/** Settings namespace name (spelled identically in the client package). */
export const DESKTOP_PET_SETTINGS_NS = 'desktop-pet'

/** User-editable settings section exposed on the Web configuration page. */
export interface PetSettings {
  /** Show or hide the pet. */
  enabled: boolean
  /** Integer scale multiplier applied to the 192×208 atlas cells. */
  petScale: number
  /** Which pet to display (a directory name under `assets/pets/`). */
  petId: string
  /** Hide the pet while no task is running; show it again on activity. */
  hideWhenIdle: boolean
  /**
   * The pets discovered under `assets/pets/` at startup. Read-only from the
   * client's perspective: the host always replaces it with its own scan, so a
   * user-layer value cannot shadow the directory facts.
   */
  availablePets: PetCatalogEntry[]
}

export const PetSettingsSchema: z<PetSettings> = z.object({
  enabled: z.boolean().default(true),
  petScale: z.number().step(0.25).min(0.5).max(4).default(1),
  petId: z.string().default('text'),
  hideWhenIdle: z.boolean().default(false),
  availablePets: z.array(z.object({
    id: z.string(),
    displayName: z.string(),
  })).default([]),
})

export interface PetConfig {
  /** Composition-level master switch; when false the plugin loads but shows nothing. */
  enabled: boolean
  /** Keep the pet above other windows. */
  alwaysOnTop: boolean
  /** Integer scale multiplier applied to the 192×208 atlas cells. */
  petScale: number
  /** Which pet to display (a directory name under `assets/pets/`). */
  petId: string
  /** Hide the pet while no task is running; show it again on activity. */
  hideWhenIdle: boolean
  /** Run the frame animation. When false, a single static frame is shown. */
  animationEnabled: boolean
  /** Seconds (>=8) between randomized idle variations. */
  idleFrequencySec: number
  /** Pass pointer events through the window (Windows only). */
  clickThrough: boolean
  /** Start in the sleeping state. */
  startSleeping: boolean
  /** Global animation speed multiplier. */
  animationSpeed: number
  /** 气泡总开关：关闭后不显示任何文字气泡。 */
  bubbleEnabled: boolean
  /** 思考过程气泡最多保留的字符数（超出截断，保留最新内容）。 */
  bubbleMaxChars: number
  /** 结果类气泡（成功/出错/等待确认）自动隐藏前的显示秒数。 */
  bubbleSeconds: number
  /** 等待用户确认时气泡显示的文本。 */
  confirmBubbleText: string
  /** 任务完成时气泡显示的文本。 */
  successBubbleText: string
  /** 任务出错时气泡显示的文本。 */
  errorBubbleText: string
  /** 任务完成音效文件名（放在 assets/sounds/ 下，WAV 格式；留空表示不播放）。 */
  soundSuccess: string
  /** 任务出错音效文件名（放在 assets/sounds/ 下，WAV 格式；留空表示不播放）。 */
  soundError: string
  /** 需要用户确认时音效文件名（放在 assets/sounds/ 下，WAV 格式；留空表示不播放）。 */
  soundConfirm: string
}

export const Config: z<PetConfig> = z.object({
  enabled: z.boolean().default(true),
  alwaysOnTop: z.boolean().default(true),
  petScale: z.number().step(0.25).min(0.5).max(4).default(1),
  petId: z.string().default('text'),
  hideWhenIdle: z.boolean().default(false),
  animationEnabled: z.boolean().default(true),
  idleFrequencySec: z.natural().min(8).default(20),
  clickThrough: z.boolean().default(false),
  startSleeping: z.boolean().default(false),
  animationSpeed: z.number().min(0.25).max(4).default(1),
  bubbleEnabled: z.boolean().default(true),
  bubbleMaxChars: z.natural().min(10).max(500).default(80),
  bubbleSeconds: z.number().min(1).max(60).default(6),
  confirmBubbleText: z.string().default('⚠ 需要你的确认'),
  successBubbleText: z.string().default('✓ 完成！'),
  errorBubbleText: z.string().default('✗ 出错了'),
  soundSuccess: z.string().default(''),
  soundError: z.string().default(''),
  soundConfirm: z.string().default(''),
})

export const DEFAULT_CONFIG: PetConfig = {
  enabled: true,
  alwaysOnTop: true,
  petScale: 1,
  petId: 'text',
  hideWhenIdle: false,
  animationEnabled: true,
  idleFrequencySec: 20,
  clickThrough: false,
  startSleeping: false,
  animationSpeed: 1,
  bubbleEnabled: true,
  bubbleMaxChars: 80,
  bubbleSeconds: 6,
  confirmBubbleText: '⚠ 需要你的确认',
  successBubbleText: '✓ 完成！',
  errorBubbleText: '✗ 出错了',
  soundSuccess: '',
  soundError: '',
  soundConfirm: '',
}
