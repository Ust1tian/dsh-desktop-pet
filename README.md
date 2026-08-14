# dsh-desktop-pet

An **optional desktop companion** for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness). It shows a small animated pet as an ambient status indicator: the pet relaxes when the harness is idle, "thinks" while the model reasons, "works" while tools run, waits when the harness needs input, and celebrates (or frowns) when a turn finishes.

It is **not** a second chat UI, a task manager, or a full desktop app. It is a status indicator.

- **Plugin-first**: it is a normal deepseek-harness plugin — no separately launched daemon, browser, or desktop app.
- **Zero network**: all assets ship with the plugin; no telemetry, CDN, or remote service.
- **Zero added LLM cost**: event → state resolution is fully deterministic.
- **Privacy-first**: it only ever renders short fixed labels (`Working…`, `Done`, …). It never shows prompts, code, secrets, tool output, or conversation content.
- **Codex-compatible asset format**: it reads the same `pet.json` + sprite-sheet format produced by the `hatch-pet` skill, so a generated pet can be dropped in directly.

---

## Installation

The plugin is a Cordis **bundle**: an npm package that contributes a `cordis.patch.yml` layer. Install it into a profile:

```sh
dsh plugin --profile <name> add ./dsh-desktop-pet
```

(Or `pnpm dsh plugin --profile <name> add ./dsh-desktop-pet` from a source checkout.) Then run:

```sh
dsh --profile <name>
```

For a quick local overlay without installing into a profile:

```sh
dsh web --patch ./cordis.patch.yml
```

> If you cloned the harness repo and are running from source, prefix `dsh` commands with `pnpm` (see the harness `README` run-from-source section).

### Enable / disable

Set the `enabled` config field to `false` in your profile's `cordis.patch.yml` (or via `--patch`):

```yaml
- insert:
    - id: desktop-pet
      name: dsh-desktop-pet
      config:
        enabled: false
```

The plugin still loads but does nothing. Removing the bundle entirely also leaves Harness fully functional.

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

All fields are optional and validated with a Schemastery schema (invalid values fail loudly at load).

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Master switch. |
| `alwaysOnTop` | `true` | Keep the pet above other windows. |
| `petScale` | `1` | Integer scale of the 192×208 cells. |
| `animationEnabled` | `true` | Run the frame animation (static frame when false). |
| `showStatusBubble` | `true` | Show the short status label under the pet. |
| `idleFrequencySec` | `20` | Seconds (≥8) between randomized idle variations. |
| `clickThrough` | `false` | Pass pointer events through (Windows only). |
| `startSleeping` | `false` | Start in the sleeping state. |
| `animationSpeed` | `1` | Global speed multiplier (0.25–4). |
| `petPath` | `null` | Directory containing a `pet.json` + sprite sheet (hatch-pet output). Defaults to the bundled placeholder. |

Example:

```yaml
- insert:
    - id: desktop-pet
      name: dsh-desktop-pet
      config:
        petScale: 1
        idleFrequencySec: 30
        showStatusBubble: true
        petPath: '/absolute/path/to/my-hatch-pet'
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
renderer/     AnimationController · PetWindow · StatusBubble
        ↓  finished RGBA frames
renderer/backend/  Win32Backend · X11Backend   (native overlays via koffi)
        ↑
renderer/codex-pet/  PetContract · PetLoader   (pet.json + sprite sheet)
```

- **`HarnessBridge`** is the only module that knows raw harness event names. Everything above it is harness-independent.
- **Pet core** (`core/`) is a standalone library: testable with no harness, no window, no network.
- **Backends** are platform-isolated behind `WindowBackend`; the renderer never sees Win32 or X11 details.

### Harness dependencies

Only the Cordis plugin lifecycle and these **core** services/events are used:

- Plugin entry: `apply(ctx, config)` + `name` / `inject` / `Config`.
- Lifecycle: `ctx.effect()`, `ctx.on()`, `ctx.logger(name)`.
- Activity observation: `session/event`, `agent/status`.
- Optional (detected, not required): `ctx.agents`, `ctx.sessions`, `ctx.approval`, `ctx.commands`.

No non-core plugin is required. If an optional service is absent, the pet degrades gracefully (coarser states, no `/pet` command).

### External dependencies

| Package | Purpose | Why it is needed | Runtime |
|---------|---------|------------------|---------|
| `koffi` | Win32 + X11 FFI for the overlay window | The harness ships no window abstraction; koffi is the smallest in-process native path (prebuilt, no compiler). It is already used by the harness repo for Win32 FFI. | Node ≥22 |
| `sharp` | Decode WebP/PNG sprite sheets to RGBA | Node has no built-in WebP decoder; hatch-pet output is WebP. `sharp` is already used by the harness repo (`attachment-local`) and ships prebuilt binaries. | Node ≥22 |
| `@deepseek-ai/schemastery` | Config schema validation | The standard schema dialect the harness already uses. | Node ≥22 |

Peer (type-only, not bundled): `@deepseek-ai/cordis`.

**Explicitly avoided**: Electron, Tauri, WebView2/webview, GLFW/SDL/raylib, game engines, GPU/OpenGL, Docker, databases, Redis, any external server, browser automation.

### Event → state mapping

| Normalized event (from harness) | Pet state (semantic → Codex pose) |
|----------------------------------|-----------------------------------|
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

### How to add a new animation

Animations are data-driven by the Codex contract (see `src/renderer/codex-pet/PetContract.ts`):

1. Provide a `pet.json` + sprite sheet (see the Codex pet format below).
2. Point `petPath` at that directory.
3. The nine fixed states and per-frame durations are already wired; no code change is required for a new pet.

To add a **new state**, extend `SemanticState` in `src/core/types.ts`, its resolver mapping in `src/core/PetStateResolver.ts`, and its renderer pose in `SEMANTIC_TO_CODEX`.

### How to add another window backend

Implement `WindowBackend` (`src/renderer/backend/WindowBackend.ts`) and register it in `src/renderer/backend/selectBackend.ts`. The renderer only talks to the interface; no other code changes.

### Codex pet format

`pet.json`:

```json
{
  "id": "my-pet",
  "displayName": "My Pet",
  "spriteVersionNumber": 1,
  "spritesheetPath": "spritesheet.webp"
}
```

Sprite sheet: `8` columns × `9` rows (v1) or `11` rows (v2), cell `192×208`, row-major. Animation rows are fixed, in order: `idle, running-right, running-left, waving, jumping, failed, waiting, running, review`. Lossless WebP (or PNG). Per-frame durations are baked into the renderer (see `PetContract.ANIMATION_ROWS`). This is the format produced by the `hatch-pet` skill; see the "compatibility note" below.

---

## Testing

```sh
npm test          # vitest unit tests (core + loader + integration)
npm run typecheck # tsc --noEmit
npm run build     # tsdown bundle
npm run gen:assets # regenerate the bundled placeholder pet
```

The pet core is tested without a harness or a display. The native overlay backends require a real desktop session and are **not** exercised by the headless test suite — they need manual verification on Windows/Linux.

---

## Known limitations

- **Linux transparency requires a compositor**; on Wayland the pet runs as an XWayland client (no native wlr-layer-shell).
- **macOS is not implemented**.
- **Codex compatibility note**: there is no official public spec for the Codex/hatch-pet format. The contract here (`pet.json` fields, 192×208 cells, 8×(9|11) grid, 9 state rows, per-frame durations) is cross-checked against several independent reimplementations. If a real hatch-pet artifact differs, `src/renderer/codex-pet/PetContract.ts` is the single place to adjust; the loader validates width and reports mismatches loudly.
- The bundled placeholder artwork is original programmatic geometry (a mint "blob"); it contains no OpenAI/Codex/DeepSeek character artwork or trademarks.
- Native window rendering (frameless/transparent/topmost/drag) has not been exercised by automated CI and needs a manual check on a real desktop.

---

## License

MIT.
