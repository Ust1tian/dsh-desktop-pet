# 音效目录（Sound Assets）

把音效文件放到本目录（`assets/sounds/`），然后在 `cordis.patch.yml` 的
`desktop-pet` 配置里把对应项填成文件名即可。

## 支持的格式

- **WAV（PCM）**：唯一受支持格式。通过 Windows 自带的
  `System.Media.SoundPlayer` 播放，无需任何额外依赖。

## 配置项（在插件 bundle 配置或 profile 的 cordis.patch.yml 里）

| 配置项 | 触发时机 | 说明 |
|---|---|---|
| `soundSuccess` | 任务完成（turn/end → completed） | 成功音效文件名，如 `success.wav` |
| `soundError` | 任务出错（turn/end → error/aborted） | 出错音效文件名，如 `error.wav` |
| `soundConfirm` | 需要用户确认（approval/asked） | 确认提示音效，如 `confirm.wav` |

留空（`''`）表示不播放对应音效。

## 注意事项

- 文件名就是 `assets/sounds/` 下的相对文件名（支持子目录，如
  `done/success.wav`，斜杠分隔）。
- 音效有 400ms 连发限流，避免连续事件时爆音。
- 播放失败（文件不存在等）会被静默忽略，不影响桌宠本体。
- 音量为音频文件自身的音量；如需调小，请先用音频工具处理文件。
