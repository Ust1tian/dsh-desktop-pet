# dsh-desktop-pet

English | [中文](README.zh.md)

> **Fork 增强版**：本项目在 [sereinmono/dsh-desktop-pet](https://github.com/sereinmono/dsh-desktop-pet)
> 基础上增强：实时思考气泡（最多两行）、等待确认的高亮气泡提示、成功/出错/确认音效（WAV），
> 并预置 **DeepSeek娘（蓝发鲸鱼女仆）** 桌宠图集。

An **optional desktop companion** for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). It shows a small animated pet as an ambient status indicator: the pet relaxes when the harness is idle, "thinks" while the model reasons, "works" while tools run, waits when the harness needs input, and celebrates (or frowns) when a turn finishes.

It is **not** a second chat UI, a task manager, or a full desktop app. It is a status indicator.

- **Plugin-first**: a normal deepseek-harness plugin — no separately launched daemon, browser, or desktop app.
- **Zero network**: all assets ship with the plugin; no telemetry, CDN, or remote service.
- **Zero added LLM cost**: event → state resolution is fully deterministic.
- **Runtime-discovered pets**: pets under `assets/pets/` are discovered at startup, so adding a pet is dropping a folder in — no rebuild.

## Assets you need to fetch yourself

- **DeepSeek娘 图集**（`assets/pets/deepseek/`）：
  [xpy12367/codex-pet-DeepSeek-girl](https://github.com/xpy12367/codex-pet-DeepSeek-girl)
  （非官方同人，仓库未声明开源许可，故本仓库不随包分发）。下载后把根目录的
  `pet.json` + `spritesheet.webp` 放进 `assets/pets/deepseek/` 即可；没有图集时
  插件会自动回退到内置 `text` 测试宠。
- **音效**（`assets/sounds/`）：任意 PCM WAV，放入后在 `cordis.patch.yml` 的
  `soundSuccess` / `soundError` / `soundConfirm` 里填文件名即可（默认留空不播放）。

---

## Installation

The plugin is a Cordis **bundle** that ships both a host half (the pet window)
and a client half (the settings card). `dsh plugin add` installs it and, because
the manifest declares `dsh.bundle`, adds it to the profile's bundle list
automatically.

### From npm

```sh
dsh plugin --profile <name> add dsh-desktop-pet
```

### From a local directory

Install the plugin directly from its source directory (the profile keeps it as
a `link:` dependency):

```sh
dsh plugin --profile <name> add /path/to/dsh-desktop-pet
```

On Windows, for example:

```sh
dsh plugin --profile web add D:/deepseek-pet
```

You can also run `dsh plugin --profile <name> add .` from inside the plugin
directory.

### From a tarball

Pack the plugin, then install the tarball:

```sh
npm pack
dsh plugin --profile <name> add /path/to/dsh-desktop-pet-0.1.0.tgz
```

### From a Git repository

```sh
dsh plugin --profile <name> add github:sereinmono/dsh-desktop-pet
```

If the repository does not commit build artifacts, configure a `prepare`
script so `dsh plugin add` builds the plugin during install.

### Run

```sh
dsh --profile <name>
```

> If you are running Harness from a source checkout, prefix the commands above
> with `pnpm` — i.e. run `pnpm dsh plugin ...` and `pnpm dsh ...` from the
> Harness repository.

> The settings card requires Harness to expose the `desktop-pet` settings
> namespace (via its `WEB_SETTINGS_NAMESPACES` allowlist). The pet window itself
> does not depend on that allowlist.

### Enable / disable

Set `enabled: false` in the plugin's config, or remove the bundle from the
profile. The plugin then loads but shows nothing; removing it entirely leaves
Harness fully functional.

---

## Adding a pet

Pets are plain folders following a fixed sprite-sheet format. Three common ways
to obtain one are covered in the dedicated guide, each with a copy-paste prompt
and manual steps:

- **hatch-pet** — generate a pet with the skill, then drop its output folder into `assets/pets/`.
- **Import an existing folder** — copy a folder containing `pet.json` + `spritesheet.webp` into `assets/pets/`.
- **Petdex community** — download a community pet and copy it in.

See **[Adding a Pet](docs/adding-a-pet.md)** for the full walkthrough, and the
**[asset format reference](docs/adding-a-pet.md#asset-format-reference)** for the
exact `pet.json` and sprite-sheet layout.

---

## Supported platforms

| Platform | Status |
|----------|--------|
| Windows 11 | ✅ primary target (Win32 layered window via koffi) |
| Linux (X11 / XWayland) | ✅ (XCB ARGB overlay; **requires a compositor**) |
| macOS | ❌ not implemented (backend interface is reserved) |

Linux per-pixel transparency needs a running compositor (GNOME/KDE ship one by default; lightweight WMs need picom or similar). On Wayland the overlay runs through XWayland.

---

## Configuration

All fields are optional and validated with a Schemastery schema (invalid values fail loudly at load). The user-editable fields (`enabled`, `petScale`, `petId`, `hideWhenIdle`) are exposed on the Web settings card.

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Master switch. |
| `alwaysOnTop` | `true` | Keep the pet above other windows. |
| `petScale` | `1` | Pet size, 0.5–4× in 0.25 steps. |
| `petId` | `text` | Which pet to display (a directory name under `assets/pets/`). |
| `hideWhenIdle` | `false` | Automatically hide the pet when it sleeps (no task), and show it again on activity. |
| `animationEnabled` | `true` | Run the frame animation (static frame when false). |
| `idleFrequencySec` | `20` | Seconds (≥8) between randomized idle variations. |
| `clickThrough` | `false` | Pass pointer events through (Windows only). |
| `startSleeping` | `false` | Start in the sleeping state. |
| `animationSpeed` | `1` | Global speed multiplier (0.25–4). |

Example:

```yaml
- insert:
    - id: desktop-pet
      name: dsh-desktop-pet
      config:
        petScale: 1
        petId: text
        idleFrequencySec: 30
```

Window position is persisted privately under `~/.dsh/desktop-pet/position.json` (best-effort; failures are ignored). It does not depend on any Harness storage service.

### Developer mode

When the core `ctx.commands` service is present, the plugin registers a `/pet <state>` command to simulate states without any LLM:

```text
/pet thinking
/pet working
/pet waiting_for_user
/pet success
/pet error
/pet reset
```

Valid states: `STARTING IDLE THINKING WORKING CODING RUNNING_COMMAND WAITING_FOR_USER SUCCESS ERROR SLEEPING`.

---

## Architecture

```
harness events / lifecycle
        ↓  (the only harness-specific layer)
integration/  HarnessBridge · capability-detection · event-mapping
        ↓  NormalizedEvent
core/         PetStateResolver · PetStateMachine · TaskStateRegistry
        ↓  SemanticState
renderer/     AnimationController · PetWindow
        ↓  finished RGBA frames
renderer/backend/  Win32Backend · X11Backend   (native overlays via koffi)
        ↑
renderer/codex-pet/  PetContract · PetLoader   (pet.json + sprite sheet)
```

- **`HarnessBridge`** is the only module that knows raw harness event names. Everything above it is harness-independent.
- **Pet core** (`core/`) is a standalone library: testable with no harness, no window, no network.
- **Backends** are platform-isolated behind `WindowBackend`; the renderer never sees Win32 or X11 details.
- **Client half** (`src/client/`) is a separate browser bundle registered through the harness module loader; the host and client halves communicate through the settings namespace.

### Harness dependencies

Only the Cordis plugin lifecycle and these **core** services/events are used:

- Plugin entry: `apply(ctx, config)` + `name` / `inject` / `Config`.
- Lifecycle: `ctx.effect()`, `ctx.on()`, `ctx.logger(name)`.
- Activity observation: `session/event`, `agent/status`.
- Settings: the `desktop-pet` settings namespace (host-side), bound by the client card.
- Optional (detected, not required): `ctx.agents`, `ctx.sessions`, `ctx.approval`, `ctx.commands`.

No non-core plugin is required. If an optional service is absent, the pet degrades gracefully (coarser states, no `/pet` command).

### External dependencies

| Package | Purpose | Runtime |
|---------|---------|---------|
| `koffi` | Win32 + X11 FFI for the overlay window | Node ≥22 |
| `sharp` | Decode WebP/PNG sprite sheets to RGBA | Node ≥22 |
| `@deepseek-ai/schemastery` | Config schema validation | Node ≥22 |
| `clsx` | Class-name helper for the client card (inlined into the browser bundle) | build |

Peer (type-only, not bundled): `@deepseek-ai/cordis`.

The client bundle's `react` and `@deepseek-ai/dsh-client-*` imports are externalized:
they are provided at runtime by the harness module loader, so the plugin does not
ship them as runtime dependencies (they appear only as dev dependencies for type
checking and bundling).

**Explicitly avoided**: Electron, Tauri, WebView2/webview, GLFW/SDL/raylib, game engines, GPU/OpenGL, Docker, databases, Redis, any external server, browser automation.

### Event → state mapping

| Normalized event (from harness) | Pet state (semantic → animation) |
|----------------------------------|----------------------------------|
| startup | `STARTING` → `waving` |
| idle (`agent/status: idle`) | `IDLE` → `idle` |
| `assistant/chunk` (text/reasoning/tool-call delta) | `THINKING` → `running` |
| `tool/call` (editing tools) | `CODING` → `running` |
| `tool/call` (shell/command tools) | `RUNNING_COMMAND` → `running` |
| `tool/call` (other) | `WORKING` → `running` |
| `approval/asked` / waiting | `WAITING_FOR_USER` → `waiting` |
| `turn/end` reason `completed` | `SUCCESS` → `review` |
| `turn/end` reason `error`/`aborted` | `ERROR` → `failed` |
| long quiet period | `SLEEPING` → `idle` |

`SUCCESS` / `ERROR` / `STARTING` are transient (default 2s) then return to `IDLE`. Concurrent agents are tracked per session/task and folded by priority `WAITING_FOR_USER > ERROR > WORKING > THINKING > SUCCESS > IDLE`.

### Extending

- **Adding a pet** — see [Adding a Pet](docs/adding-a-pet.md); no code change is required.
- **Adding an animation state** — extend `SemanticState` in `src/core/types.ts`, its resolver mapping in `src/core/PetStateResolver.ts`, and its renderer pose in `SEMANTIC_TO_CODEX`.
- **Adding a window backend** — implement `WindowBackend` (`src/renderer/backend/WindowBackend.ts`) and register it in `src/renderer/backend/selectBackend.ts`.

---

## Speech bubbles & sounds

The pet shows a text bubble above the window (Windows only):

- **Thinking bubble**: while the model reasons / tools run, the live
  `assistant/chunk` text (reasoning or text deltas) streams into a bubble above
  the pet, throttled to 150 ms. The buffer keeps only the newest
  `bubbleMaxChars` characters.
- **Status bubbles**: on task success / error / waiting-for-user the bubble
  switches to a fixed message (`successBubbleText` / `errorBubbleText` /
  `confirmBubbleText`; the confirm bubble uses a highlighted blue style) and
  hides automatically after `bubbleSeconds`.

Sounds (optional) play through Windows' built-in `System.Media.SoundPlayer`
(PowerShell child process, no extra dependency, 400 ms anti-spam):

| Config | When | File location |
|---|---|---|
| `soundSuccess` | turn completed | `assets/sounds/` |
| `soundError` | turn errored/aborted | `assets/sounds/` |
| `soundConfirm` | approval asked | `assets/sounds/` |

Only **PCM WAV** is supported. Put `*.wav` files under `assets/sounds/` and set
the config key to the file name (empty string disables). See
`assets/sounds/README.md` for details.

---

## Testing

```sh
npm test               # vitest unit tests (core + loader + integration)
npm run typecheck      # tsc --noEmit (host half)
npm run typecheck:client # tsc -p tsconfig.client.json --noEmit (client half)
npm run build          # tsdown bundle (host + client)
npm run gen:assets     # regenerate the bundled text pet
```

The pet core is tested without a harness or a display. The native overlay backends require a real desktop session and are **not** exercised by the headless test suite — they need manual verification on Windows/Linux.

---

## Publishing

Publishing to npm is automated with GitHub Actions via **npm Trusted
Publishing** (OIDC): GitHub mints an id token and npm publishes on its behalf,
so the workflow needs no `NODE_AUTH_TOKEN` secret. A `v*` tag pushed to
`master` triggers `npm ci → typecheck → test → build → npm publish
--provenance`.

**One-time setup on npm** (do this before the first tag push):

1. The package must already exist on npm. Publish `0.1.0` once with a manual
   token (`npm publish --access public`) — Trusted Publishing is configured per
   package, so an npmjs package page must exist first.
2. On the npmjs package page, enable **Trusted Publishing** and authorize this
   repository: owner `sereinmono`, repository `dsh-desktop-pet`. Pin the
   workflow `publish.yml` and branch `master` if the form offers it.

**Release locally** — bump the version, tag, and push the tag:

```sh
npm version patch   # or minor / major; creates vX.Y.Z tag
git push origin master --tags
```

The workflow runs only when the tag's commit is on `master`; tags on other
branches are skipped. A manual backup entry is available at
Actions → Publish → Run workflow (the tag must still be on `master`).

---

## Known limitations

- **Linux transparency requires a compositor**; on Wayland the pet runs as an XWayland client (no native wlr-layer-shell).
- **macOS is not implemented**.
- The bundled placeholder is the `text` test pet only — original SVG-drawn text, with no OpenAI/Codex/DeepSeek character artwork or trademarks.
- Native window rendering (frameless/transparent/topmost/drag) has not been exercised by automated CI and needs a manual check on a real desktop.

---

## License

MIT.
