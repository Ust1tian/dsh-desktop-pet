/**
 * 音效支持：扫描 `assets/sounds/` 目录，播放 WAV 文件。
 *
 * 播放方式：调用 Windows 自带的 PowerShell `System.Media.SoundPlayer`
 * （仅支持 WAV），以异步子进程方式执行，不阻塞插件主线程，也不需要任何
 * 第三方依赖。找不到文件或播放失败时静默忽略，绝不影响桌宠本体。
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOUNDS_DIR = fileURLToPath(new URL('../assets/sounds/', import.meta.url))

/** 解析音效文件名到绝对路径（不做存在性检查）。 */
export function soundPath(fileName: string): string {
  return join(SOUNDS_DIR, fileName)
}

/** 音效连发限流（毫秒）：同一时刻只允许一个播放进程排队。 */
const PLAY_COOLDOWN_MS = 400
let lastPlayedAt = 0

/**
 * 异步播放一个 WAV 音效。fileName 为空、文件不存在或播放失败时静默返回。
 *
 * @param fileName - `assets/sounds/` 下的文件名（如 `success.wav`）。
 */
export function playSound(fileName: string | undefined | null): void {
  if (!fileName) return
  const file = soundPath(fileName)
  if (!existsSync(file)) return

  const now = Date.now()
  if (now - lastPlayedAt < PLAY_COOLDOWN_MS) return
  lastPlayedAt = now

  // PlaySync 阻塞的是 powershell 进程本身，Node 侧通过子进程异步接收；
  // stdio 用 ignore 避免管道句柄泄漏；windowsHide 不弹黑窗。
  const escaped = file.replace(/'/g, "''")
  const ps = spawn(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', `(New-Object System.Media.SoundPlayer '${escaped}').PlaySync()`],
    { stdio: 'ignore', windowsHide: true },
  )
  ps.on('error', () => {
    // 找不到 powershell 等极端情况：静默忽略。
  })
}
