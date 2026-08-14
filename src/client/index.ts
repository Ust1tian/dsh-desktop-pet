/**
 * Desktop pet settings card, browser half.
 *
 * Binds the host-side `desktop-pet` settings namespace through the settings
 * scope and registers one card into the Plugins configuration tab
 * (`settings.plugin.item`). The card offers immediate writes for show/hide,
 * size, and which bundled pet to display.
 */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: the settings shell's SlotMap merge (`settings.plugin.item`) and
// the ctx.settingsScope Context merge.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { DesktopPetCard } from './DesktopPetCard'
import { DesktopPetCardController, DESKTOP_PET_NS, type DesktopPetSettings } from './desktop-pet-controller'
import { en, zh, type DesktopPetKey } from './locales'

export type { DesktopPetCardProps } from './DesktopPetCard'
export type { AvailablePet, DesktopPetCardFace, DesktopPetCardState, DesktopPetSettings } from './desktop-pet-controller'
export type { DesktopPetKey } from './locales'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The desktop pet card's copy. */
    'settings.desktopPet': DesktopPetKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.desktopPet'

/** Services required by the Settings registration and Remote face. */
export const inject = ['slots', 'locale', 'settingsScope']

/**
 * Mount the desktop pet card into the Plugins settings section.
 * @param ctx - browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-desktop-pet: dictionaries')

  const scope = ctx.settingsScope.bind<DesktopPetSettings>({ namespace: DESKTOP_PET_NS })
  const controller = new DesktopPetCardController(scope)

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    id: 'desktop-pet',
    order: 30,
    locale: NS,
    inject: () => controller.inject(),
  }, DesktopPetCard))
}
