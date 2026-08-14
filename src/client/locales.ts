/** `settings.desktopPet` namespace dictionaries (the desktop pet card's copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'desktopPet.title': '桌面宠物',
  'desktopPet.description': '控制桌面宠物的外观与可见性。',
  'desktopPet.enabled': '显示宠物',
  'desktopPet.enabledHint': '在桌面上显示或隐藏宠物。',
  'desktopPet.hideWhenIdle': '无任务时自动隐藏',
  'desktopPet.hideWhenIdleHint': '宠物进入睡眠（无任务）状态时自动隐藏，有任务时重新显示。',
  'desktopPet.scale': '宠物大小',
  'desktopPet.scaleHint': '调整宠物的大小（0.5–4 倍，步长 0.25）。',
  'desktopPet.pet': '宠物',
  'desktopPet.petHint': '选择要显示的宠物。',
  'desktopPet.addPetLink': '如何添加宠物',
  'overridden': '已覆盖',
  'reset': '恢复默认',
  'readOnly': '本部署的设置为只读。',
  'expand': '展开设置',
  'collapse': '收起设置',
  'save': '保存',
  'saving': '保存中…',
  'discard': '放弃修改',
  'unsaved': '未保存',
  'saveFailed': '本部署没有接受这些值，已保留供你修改。',
} satisfies Record<string, string>

/** The settings.desktopPet namespace key union. */
export type DesktopPetKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'desktopPet.title': 'Desktop pet',
  'desktopPet.description': 'Control the desktop pet\'s appearance and visibility.',
  'desktopPet.enabled': 'Show pet',
  'desktopPet.enabledHint': 'Show or hide the pet on the desktop.',
  'desktopPet.hideWhenIdle': 'Hide when idle',
  'desktopPet.hideWhenIdleHint': 'Automatically hide the pet when it sleeps (no task), and show it again on activity.',
  'desktopPet.scale': 'Pet size',
  'desktopPet.scaleHint': 'Adjust the pet size (0.5–4×, in 0.25 steps).',
  'desktopPet.pet': 'Pet',
  'desktopPet.petHint': 'Choose which pet to display.',
  'desktopPet.addPetLink': 'How to add a pet',
  'overridden': 'Overridden',
  'reset': 'Reset to default',
  'readOnly': 'This deployment stores settings read-only.',
  'expand': 'Show settings',
  'collapse': 'Hide settings',
  'save': 'Save',
  'saving': 'Saving…',
  'discard': 'Discard',
  'unsaved': 'Unsaved',
  'saveFailed': 'The deployment did not accept these values; they were left for you to correct.',
} satisfies Record<DesktopPetKey, string>
