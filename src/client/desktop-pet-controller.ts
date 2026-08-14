/**
 * The desktop pet card's staged form over the `desktop-pet` settings namespace.
 *
 * Mirrors the plugin-configuration cards: the card stages the user's edits and
 * writes them only on save, so a slider drag or pet pick is previewed before
 * one durable, revision-fenced settings write. `enabled` is a toggle,
 * `petScale` a fractional size (0.5–4× in 0.25 steps), `petId` a picker, and
 * `hideWhenIdle` an auto-hide toggle.
 */

import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Settings namespace owned by the host-side desktop-pet plugin. */
export const DESKTOP_PET_NS = 'desktop-pet'

/** Minimum / maximum / step of the pet size, mirrored by the Host schema. */
export const PET_SCALE_MIN = 0.5
export const PET_SCALE_MAX = 4
export const PET_SCALE_STEP = 0.25

/** One pet entry in the runtime-scanned catalog the Host publishes. */
export interface AvailablePet {
  id: string
  displayName: string
}

/** Fallback entry shown when the Host publishes no catalog. */
const FALLBACK_PET: AvailablePet = { id: 'text', displayName: 'Text (test)' }

/** User-editable section the host namespace resolves. */
export interface DesktopPetSettings {
  enabled?: boolean
  petScale?: number
  petId?: string
  hideWhenIdle?: boolean
  availablePets?: AvailablePet[]
}

/** Form-level state every card field shares (mirrors CardShell). */
export interface DesktopPetCardShell {
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
}

/** One control's state: its staged value plus override flag. */
export interface DesktopPetFieldState<T> {
  value: T
  overridden: boolean
  invalid: boolean
}

/** The card's reactive snapshot. */
export interface DesktopPetCardState extends DesktopPetCardShell {
  enabled: DesktopPetFieldState<boolean>
  petScale: DesktopPetFieldState<number>
  petId: DesktopPetFieldState<string>
  hideWhenIdle: DesktopPetFieldState<boolean>
  availablePets: AvailablePet[]
}

/** The write actions the card's slot entry injects. */
export interface DesktopPetCardFace {
  edit: (field: FieldName, value: unknown) => void
  resetField: (field: FieldName) => void
  save: () => void
  discard: () => void
  hooks: {
    desktopPet: SnapshotStore<DesktopPetCardState>
  }
}

export type FieldName = 'enabled' | 'petScale' | 'petId' | 'hideWhenIdle'

/** The raw section shape stored on the wire. */
interface Section {
  enabled?: boolean
  petScale?: number
  petId?: string
  hideWhenIdle?: boolean
  availablePets?: AvailablePet[]
}

/** A section with every field defaulted to a concrete value. */
interface ResolvedSection {
  enabled: boolean
  petScale: number
  petId: string
  hideWhenIdle: boolean
  availablePets: AvailablePet[]
}

/** Guard a resolved section into the card's known-good shape. */
function effective(section: unknown): ResolvedSection {
  const value = (typeof section === 'object' && section !== null ? section : {}) as Section
  const petScale = typeof value.petScale === 'number' && Number.isFinite(value.petScale)
    ? value.petScale
    : 1
  const availablePets = Array.isArray(value.availablePets)
    ? value.availablePets.filter(p => p != null && typeof p.id === 'string' && typeof p.displayName === 'string')
    : []
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    petScale,
    petId: typeof value.petId === 'string' && value.petId.length > 0 ? value.petId : 'text',
    hideWhenIdle: typeof value.hideWhenIdle === 'boolean' ? value.hideWhenIdle : false,
    availablePets: availablePets.length > 0 ? availablePets : [FALLBACK_PET],
  }
}

/** Whether a draft's value is acceptable for its field. */
function valid(field: FieldName, value: unknown): boolean {
  switch (field) {
    case 'enabled': return typeof value === 'boolean'
    case 'petScale': return typeof value === 'number' && Number.isFinite(value)
      && value >= PET_SCALE_MIN && value <= PET_SCALE_MAX
    case 'petId': return typeof value === 'string' && value.length > 0
    case 'hideWhenIdle': return typeof value === 'boolean'
  }
}

/** Round a pet scale to the nearest allowed step. */
export function quantizeScale(value: number): number {
  const steps = Math.round((value - PET_SCALE_MIN) / PET_SCALE_STEP)
  const clamped = Math.min(PET_SCALE_MAX, Math.max(PET_SCALE_MIN, PET_SCALE_MIN + steps * PET_SCALE_STEP))
  // Guard floating-point noise (e.g. 0.5 + 1*0.25 == 0.75 exactly).
  return Math.round(clamped * 100) / 100
}

/**
 * Bridges the `desktop-pet` scope onto the card's staged form.
 */
export class DesktopPetCardController {
  private readonly store: SnapshotStore<DesktopPetCardState>
  private staged = new Map<FieldName, unknown>()
  private saving = false
  private failed = false

  /** @param scope - the bound settings scope for the `desktop-pet` namespace. */
  constructor(private readonly scope: SettingsScope<DesktopPetSettings>) {
    this.store = createSnapshotStore(this.projection())
    scope.subscribe(() => { this.store.set(this.projection()) })
  }

  private userLayer(): Partial<Section> | undefined {
    const user = this.scope.getSnapshot().user
    return typeof user === 'object' && user !== null ? (user as Partial<Section>) : undefined
  }

  private stored(field: FieldName): boolean {
    return this.userLayer()?.[field] !== undefined
  }

  private draftOf(field: FieldName): unknown | undefined {
    return this.staged.get(field)
  }

  private fieldState<T>(field: FieldName, effectiveValue: T): DesktopPetFieldState<T> {
    const draft = this.draftOf(field)
    if (draft === undefined) {
      return { value: effectiveValue, overridden: this.stored(field), invalid: false }
    }
    return { value: draft as T, overridden: true, invalid: !valid(field, draft) }
  }

  private projection(): DesktopPetCardState {
    const snapshot = this.scope.getSnapshot()
    const section = effective(snapshot.value)
    const dirty = this.staged.size > 0
    const invalid = [...this.staged.entries()].some(([field, value]) => !valid(field as FieldName, value))
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty,
      invalid,
      saving: this.saving,
      failed: this.failed,
      enabled: this.fieldState<boolean>('enabled', section.enabled),
      petScale: this.fieldState<number>('petScale', quantizeScale(section.petScale)),
      petId: this.fieldState<string>('petId', section.petId),
      hideWhenIdle: this.fieldState<boolean>('hideWhenIdle', section.hideWhenIdle),
      availablePets: section.availablePets,
    }
  }

  /** Build the face the card's slot registration injects. */
  inject(): DesktopPetCardFace {
    return {
      edit: (field, value) => {
        this.staged.set(field, value)
        this.failed = false
        this.store.set(this.projection())
      },
      resetField: (field) => {
        this.staged.delete(field)
        this.failed = false
        this.store.set(this.projection())
      },
      discard: () => {
        if (this.staged.size === 0 && !this.failed) return
        this.staged.clear()
        this.failed = false
        this.store.set(this.projection())
      },
      save: () => { void this.save() },
      hooks: { desktopPet: this.store },
    }
  }

  private async save(): Promise<void> {
    if (this.staged.size === 0 || this.saving) return
    const writes = [...this.staged.entries()].map(([field, value]) => ({
      field: field as FieldName,
      valid: valid(field as FieldName, value),
      value,
    }))
    if (writes.some(w => !w.valid)) return

    this.saving = true
    this.failed = false
    this.store.set(this.projection())

    let landed = true
    for (const write of writes) {
      try {
        await this.scope.set(write.field, write.value)
      } catch {
        landed = false
      }
    }
    if (landed) this.staged.clear()

    this.saving = false
    this.failed = !landed
    this.store.set(this.projection())
  }
}
