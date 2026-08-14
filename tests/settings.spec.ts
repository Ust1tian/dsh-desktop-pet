import { describe, expect, it, vi } from 'vitest'
import { installPetSettings } from '../src/settings'
import { PetSettingsSchema, type PetSettings } from '../src/config'

const base: PetSettings = { enabled: true, petScale: 1, petId: 'text', hideWhenIdle: false, availablePets: [] }

function makeRegistrar() {
  const watchers = new Set<(next: PetSettings, prev: PetSettings) => void>()
  let current: PetSettings = base
  const scope = {
    get: () => current,
    watch: (cb: (next: PetSettings, prev: PetSettings) => void) => {
      watchers.add(cb)
      return () => watchers.delete(cb)
    },
    update: vi.fn(async (patch: Partial<PetSettings>) => {
      current = { ...current, ...patch }
      const prev = { ...current }
      for (const cb of watchers) cb(current, prev)
    }),
  }
  const registrar = {
    register: vi.fn((_ns: string, schema: unknown, _opts: unknown) => scope),
    push(next: PetSettings) {
      const prev = current
      current = next
      for (const cb of watchers) cb(next, prev)
    },
  }
  return { registrar, scope, push: (n: PetSettings) => registrar.push(n) }
}

describe('installPetSettings', () => {
  it('applies the composition base when no registrar exists', () => {
    const onApply = vi.fn()
    const handle = installPetSettings(undefined, base, onApply)
    expect(onApply).toHaveBeenCalledWith(base)
    handle.dispose()
  })

  it('registers the namespace and applies resolved values on commit', () => {
    const { registrar } = makeRegistrar()
    const onApply = vi.fn()
    installPetSettings(registrar, base, onApply)
    expect(registrar.register).toHaveBeenCalledWith('desktop-pet', PetSettingsSchema, { base })
    expect(onApply).toHaveBeenCalledWith(base)
  })

  it('forwards committed changes through watch', () => {
    const { registrar, push } = makeRegistrar()
    const onApply = vi.fn()
    installPetSettings(registrar, base, onApply)
    onApply.mockClear()
    push({ enabled: false, petScale: 3, petId: 'text', hideWhenIdle: true, availablePets: [] })
    expect(onApply).toHaveBeenCalledWith({ enabled: false, petScale: 3, petId: 'text', hideWhenIdle: true, availablePets: [] })
  })

  it('update() writes a partial patch back through the scope', async () => {
    const { registrar, scope } = makeRegistrar()
    const handle = installPetSettings(registrar, base, vi.fn())
    await handle.update({ enabled: false })
    expect(scope.update).toHaveBeenCalledWith({ enabled: false })
  })

  it('update() is a no-op without a registrar', () => {
    const handle = installPetSettings(undefined, base, vi.fn())
    expect(() => handle.update({ enabled: false })).not.toThrow()
  })
})
