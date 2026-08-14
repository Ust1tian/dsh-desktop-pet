/**
 * Backend selection. The renderer asks for a backend without knowing the OS;
 * this module picks the first supported one and, if none exists, returns
 * `undefined` so the plugin can degrade gracefully (no window, still loaded).
 */

import { Win32Backend } from './Win32Backend'
import { X11Backend } from './X11Backend'
import type { WindowBackend } from './WindowBackend'

const BACKENDS: readonly WindowBackend[] = [new Win32Backend(), new X11Backend()]

export function selectBackend(): WindowBackend | undefined {
  return BACKENDS.find(backend => {
    try {
      return backend.isSupported()
    } catch {
      return false
    }
  })
}

export function listBackends(): ReadonlyArray<{ name: string; supported: boolean }> {
  return BACKENDS.map(backend => ({ name: backend.name, supported: backend.isSupported() }))
}
