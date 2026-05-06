# ProtoAI — Architecture & Implementation Status
**Last updated:** 2026-04-29 21:00 UTC  
**App version:** 0.1.7 (history save fix + chat scroll map + PartnerTicker layout)  
**IPC mode:** H1 (persistent Node sidecar, stdin/stdout JSON-lines)  
**Completion:** ~81%  
**Platform:** Windows (primary); macOS/Linux untested  
**Stack:** Tauri v2 + Rust + Node.js sidecar + Vanilla JS UI

---

## Executive Summary

ProtoAI is a desktop AI assistant built on Tauri v2. The core three-layer architecture (Rust shell → EngineBridge → Node.js workflow engine) is stable and operational. Chat, file browsing, VFS, split-screen, streaming, and crash recovery all work. The major remaining work is: wiring the UI streaming path, loading history on startup, the two-pane File Manager redesign, the hybrid archetype/profile system integration (data is done, plumbing is not), and eventually local model support and the H3 IPC migration.

**Working now:** Chat (streaming + non-streaming), file browsing, VFS add/list/manifest/permissions, split-screen, EventBus, SDOA v3 modules, settings persistence, streaming end-to-end, crash watchdog, multi-session backend, 9 archetypes defined, history loads on restart, FileList paginated, `get_project_dir` always absolute, ProtoAI source project pinned in sidebar (self-editing mode), **multi-model orchestrator** (route → engineer → watch → audit pipeline via Qwen 2.5 local model), **PartnerTicker** (animated activity strip at bottom of chat pane with hover/lock state machine and per-feature toggles), **IPC status badge reconnect** (clicking offline/crashed badge re-invokes `engine_reconnect`), **`multi_model_send` IPC routing** (BackendConnector + server-ipc both wired).

**Remaining gaps:** VFS context not injected into LLM, multi-session UI missing, File Manager redesign pending (plan approved), archetype system not integrated, Monaco editor blank, Browser/Terminal panels placeholder. Real-time orchestrator event streaming to UI (V2) deferred — V1 delivers events via WorkflowResult playback.

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri v2 Shell (Rust)                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ │
│  │  commands.rs │  │engine_bridge │  │node_process   │ │
│  │  (UI bridge) │  │    .rs       │  │_backend.rs    │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────┘ │
└─────────┼─────────────────┼─────────────────┼──────────┘
          │  Tauri invoke   │  EngineBridge   │ stdin/stdout
          ▼                 ▼                 ▼
┌─────────────────┐                  ┌────────────────────┐
│   UI Layer      │                  │  Node.js Sidecar   │
│   ui/app.js     │                  │  server-ipc.cjs    │
│   ui/modules/   │                  │  WorkflowRegistry  │
│   (15 modules)  │                  │  (20+ workflows)   │
└─────────────────┘                  └────────────────────┘
                                              │
                                     ┌────────▼────────┐
                                     │  data/ layer    │
                                     │  projects/      │
                                     │  archetypes/    │
                                     │  settings.json  │
                                     └─────────────────┘
```

**IPC contract (H1):** Rust sends `{"id":"uuid","type":"..","payload":{}}` newline-delimited to Node stdin. Node replies `{"id":"uuid","ok":true,"data":{}}` or `{"id":"uuid","ok":false,"error":"..","detail":".."}`. Streaming chunks are `{"id":"uuid","ok":true,"type":"stream","chunk":"..."}` and do not resolve the pending request.

---

## 2. Rust / Tauri Layer

### `src-tauri/src/engine_bridge.rs`

**`BridgeState`** — Tauri managed state, always present:
- `inner: Arc<Mutex<Option<EngineBridge>>>` — the live bridge, None while starting/crashed
- `crash_count: Arc<AtomicU32>` — incremented each time sidecar dies
- `given_up: Arc<AtomicBool>` — set true after 3 crashes; UI shows reconnect button

**`EngineBackend` enum:**
```rust
pub enum EngineBackend {
    NodeProcess(Arc<Mutex<NodeProcessBackend>>),
    // FileIPC variant not yet added — required for H3 migration
}
```

**`BridgeState::spawn_watchdog()`** — runs in background:
- Awaits the sidecar's exit signal (oneshot receiver)
- On death: increments crash_count, waits 2^n seconds (2→4→8), attempts restart
- After 3 failures: sets `given_up = true`, stops retrying
- On successful restart: resets backoff to 2s, continues watching

**`EngineBridge` stable public API** (unchanged regardless of backend):
`projects()`, `history(project)`, `profiles()`, `chat(project, profile, engine, message)`, `chat_stream(...)`, `upload(project, filename, content)`, `ingest(project)`, `image_gen(text, project)`, `deep_search(query)`, `qmd_index(project, deep_scan)`, `qmd_search(query, project)`, `get_settings()`, `set_settings(key, value)`, `test_api_key(provider, key)`, `ipc(msg_type, payload)`

---

### `src-tauri/src/node_process_backend.rs`

Manages the H1 Node sidecar process:

**Startup:**
- Path resolution order: bundled `resource_dir/server` → `CARGO_MANIFEST_DIR/resources/server` → exe-ancestor walk
- Looks for `server-ipc.cjs` to confirm correct directory
- Sets `PROTOAI_ROOT` (repo root containing `data/`) and `NODE_PATH` (server + root + tauri-app node_modules)
- Spawns bundled `node-x86_64-pc-windows-msvc.exe` as sidecar

**Message handling:**
- `send_message(msg_type, payload)` → assigns UUID, registers oneshot sender in `pending` map, writes JSON line to stdin
- Per-type timeouts: `projects`/`profiles` → 10s, `history`/`upload`/`ingest` → 15s, `chat`/`image_gen`/`deep_search`/`qmd_index` → 180s, everything else → 30s

**Streaming:**
- `{type: "stream", chunk: "..."}` responses are intercepted in the reader loop
- Each chunk emitted as Tauri `chat-stream` event `{id, chunk}` to UI
- The pending oneshot is NOT resolved on stream chunks; only the final non-stream response resolves it

**Crash handling:**
- On `CommandEvent::Terminated`: all pending senders receive `{ok: false, error: "Sidecar crashed"}`
- Exit oneshot fires to notify watchdog

---

### `src-tauri/src/commands.rs`

All Tauri commands registered in `main.rs`:

**Engine management:**
```
ping()                           → "pong"
get_status()                     → "ok"
engine_status(bridge)            → "ready" | "initializing" | "crashed"
engine_reconnect(app, bridge)    → resets crash_count/given_up, creates new bridge + watchdog
engine_ipc(bridge, msg_type, payload) → generic passthrough to Node
```

**Engine pass-through (all route through with_bridge! macro):**
```
engine_projects(bridge)
engine_history(bridge, project)
engine_profiles(bridge)
engine_chat(bridge, project, profile, engine, text)
engine_chat_stream(bridge, project, profile, engine, text)
engine_upload(bridge, project, file_path, content)
engine_ingest(bridge, project)
engine_image_gen(bridge, prompt, project)
engine_deep_search(bridge, query)
engine_qmd_index(bridge, project, deep_scan)
engine_qmd_search(bridge, query, project)
```

**Settings:**
```
settings_get(bridge)
settings_set(bridge, key, value)
settings_test_key(bridge, provider, key)
settings_first_run_status(bridge)     → {firstRunCompleted: bool}
settings_complete_first_run(bridge)
```

**Filesystem (Rust-native, no Node round-trip):**
```
get_project_dir(project)           → absolute path to data/projects/{project}
fs_read_file(path)                 → String
fs_write_file(path, content)       → ()
fs_rename(old_path, new_path)      → ()
fs_copy(source, destination)       → ()
fs_unlink(path)                    → ()   (file only)
fs_remove(path)                    → ()   (file or directory recursive)
fs_mkdir(path)                     → ()   (create_dir_all)
fs_stat(path)                      → {is_dir, size, readonly}
fs_list_dir(path)                  → {path, parent, folders[], files[], total}
                                       folders/files sorted alpha, folders first
                                       skips entries starting with ".protoai-"
```

---

### `src-tauri/src/main.rs`

- Registers all commands in `invoke_handler`
- `run_workflow(app, name, payload)` — one-shot: forks Node via `shell().command("node")` with `tauri-entry.cjs`, returns stdout; used for legacy workflow invocations
- `LaunchFlags { setup_wizard: bool }` — parsed from `--setup-wizard` CLI arg
- Setup async block: calls `EngineBridge::new()`, stores in `BridgeState`, calls `spawn_watchdog()`

---

## 3. Node.js Server Layer

### `resources/server/server-ipc.cjs` — IPC Entrypoint

Boot sequence (order matters):
1. `console.log = console.error` — protects IPC channel from stray output
2. Register `uncaughtException` + `unhandledRejection` handlers
3. Require node built-ins only (`fs`, `path`)
4. Resolve `PROTOAI_ROOT`, open log file at `data/logs/server-ipc.log`
5. Load repositories (`FsProjectRepository`, `FsMemoryRepository` optional, `FsProfileRepository`)
6. Load `SettingsManager`
7. Instantiate `WorkflowRegistry`, register all workflows
8. Start stdin JSON-lines reader

`_requireStrict(mod)` — crashes server (writes structured error to stdout, exits 1) if module missing  
`_safeRequire(mod)` — returns null if module missing, logs warning  
`_fatalStartup(reason)` — writes `{id:"startup", ok:false, error:..., detail:...}` to stdout then exits 1 (watchdog will restart)

**Serial message queue:** Messages queued and processed one at a time via `_processNext()` + `setImmediate`. No concurrent workflow execution.

---

### `resources/server/orchestration/WorkflowRegistry.js`

```js
register(name, instance)   // stores live instance
has(name)                  // safe existence check
get(name)                  // throws if not registered
list()                     // array of registered names
```

The IPC server creates a fresh `WorkflowRegistry` (not the legacy `WorkflowRegistryInstance`) and populates it directly.

---

### Workflow Inventory

**Core — always loaded, fatal if missing:**

| Workflow | IPC type(s) | Notes |
|---|---|---|
| `SendMessageWorkflow` | `chat` | Accepts `stream: bool`, `onChunk` callback; saves history post-stream; routes to external LLM API |
| `MultiModelSendWorkflow` | `chat` (orchestrated) | Wraps `SendMessageWorkflow` with local-model pipeline: route → engineer → prime (with async watcher) → audit; returns `{reply, orchestrator:{events,route,engineer,watchFlags,audit}}` |
| `ImageGenWorkflow` | `image_gen` | Image generation |
| `DeepSearchWorkflow` | `deep_search` | Web/deep search |
| `ChatSessionWorkflow` | via `engine_ipc` | Actions: `list`, `create`, `rename`, `delete`, `load`; auto-migrates legacy `history.json` to sessions on first `list` |
| `SpawnShellWorkflow` | `spawn_shell` | Spawns shell process (default: PowerShell) |

**Optional — graceful degradation if load fails:**

| Workflow | IPC type(s) | Dependency | Notes |
|---|---|---|---|
| `IngestWorkflow` | `qmd_index`, `qmd_search` | `@tobilu/qmd` | Disabled cleanly if QMD not installed |
| `CreateProjectWorkflow` | via `engine_ipc` | — | Project scaffolding |
| `VfsAddWorkflow` | `vfs_add` | — | Adds real path to project VFS |
| `VfsListWorkflow` | `vfs_list` | — | Lists VFS entries |
| `VfsManifestWorkflow` | `vfs_manifest` | — | Generates/retrieves type-aware manifests |
| `VfsUpdatePermissionsWorkflow` | `vfs_permissions` | — | Updates read/write/execute per entry |
| `ListFilesWorkflow` | `list_files` | — | Lists files in a directory path |
| `ListProcessesWorkflow` | `list_processes` | — | Lists running OS processes |
| `SearchHistoryWorkflow` | `search_history` | — | Full-text across history.json files |
| `FileContextWorkflow` | via `engine_ipc` | — | Loads file content into context |
| `FilePermissionsWorkflow` | via `engine_ipc` | — | Inspect/manage file permissions + tier |

**Inline handlers (in `server-ipc.cjs` dispatcher, not separate workflow files):**

`projects`, `history`, `upload`, `ingest`, `profiles`, `settings` (get/set/testKey), `vfs_remove`

---

### Repositories

| File | Purpose |
|---|---|
| `access/fs/FsProjectRepository.js` | Projects list, history R/W, chat session CRUD, `appendToHistory()`, `appendChatMessage()` |
| `access/fs/FsProfileRepository.js` | Load profiles from `config/profiles/*.json` |
| `access/fs/FsMemoryRepository.js` | Memory/context storage — optional, safe-required |
| `access/fs/BaseRepository.js` | Shared base |
| `lib/SettingsManager.js` | `data/settings.json` persistence; `get(key)`, `set(key, val)`, `exportAll()`, `importAll()`, `validateApiKey(provider, key)` |

---

### `resources/server/tauri-entry.cjs` — One-Shot Runner

Used by the `run_workflow` Tauri command for legacy single-workflow invocations. Loads `registerWorkflows`, parses `--workflow` and `--payload` args, runs workflow, prints JSON to stdout, exits.

---

## 4. Data Layer

```
protoai/
├── data/
│   ├── settings.json                        ← global settings
│   ├── logs/
│   │   └── server-ipc.log                   ← IPC server log (appended each start)
│   ├── archetypes/                          ← 9 archetype definitions (see §8)
│   │   ├── deep-thinking-research-assistant.json
│   │   ├── coding-super-hero.json
│   │   ├── artistic-savant.json
│   │   ├── girl-next-door-naughty-neighbor-devils-advocate.json
│   │   ├── perfect-poet-coo.json
│   │   ├── ruthless-strategist.json
│   │   ├── empathetic-therapist.json
│   │   ├── data-oracle.json
│   │   └── meme-lord-chaos-agent.json
│   └── projects/
│       ├── ProtoAI/
│       │   ├── history.json                 ← legacy flat history (migrated to sessions on first load)
│       │   ├── chat_sessions/               ← multi-session storage (ChatSessionWorkflow)
│       │   └── vfs/
│       │       ├── index.json               ← VFS registry
│       │       └── manifests/               ← per-file purpose manifests (35+ files)
│       └── Inventory System/
│           └── chat_sessions/
├── config/
│   ├── models.json                          ← model registry (includes qwen-local-7b)
│   ├── fallback.json                        ← fallback chain [gpt-oss-120b, gemini-1.5-pro, deepseek, claude-3-opus, qwen-local-7b]
│   └── profiles/
│       ├── _sdoa-core.json                  ← SDOA v3 invariant ruleset (injected into all workflows)
│       ├── local-qwen.json                  ← local model profile (temp=0.2, format=plain)
│       └── a.json
└── cli/
    └── helpers/
        └── profiles.json                    ← legacy CLI profile definitions (default, coding, etc.)
```

---

## 5. UI Layer

**App version:** 1.3.2 (`app.js`) — P0 fixes 2026-04-27 + orchestrator wiring + PartnerTicker mount 2026-04-29

### Module Load Order

All `.ui.js` modules create their instances on `DOMContentLoaded` and expose them on `window`. `app.js` resolves aliases after DOM is ready.

| Module | window export | Version | Responsibility |
|---|---|---|---|
| `lib/EventBus.ui.js` | `window.eventBus` | — | Central pub/sub, 15+ cross-module events |
| `lib/tauri-utils.js` | — | — | `invoke()` wrapper, utility helpers |
| `adapters/BackendConnector.ui.js` | `window.backendConnector` | 3.3.0 | All Tauri `invoke()` calls; explicit workflow→command map; `multi_model_send` routing; offline/crashed badge click → `engine_reconnect` |
| `adapters/LlmPolicyEngine.ui.js` | `window.llmPolicyEngine` | — | Pre-send policy checks |
| `adapters/QmdAdapter.ui.js` | `window.qmdAdapter` | — | QMD index/search UI adapter |
| `bridges/LlmBridge.ui.js` | `window.llmBridge` | **3.2.0** ✅ | `chat()` + `stream()` live; orchestrator routing via `_orchestratorEnabled`; `_playbackOrchestratorEvents()` staggers EventBus replay at 220ms |
| `components/PartnerTicker.ui.js` | `window.PartnerTicker` | **1.0.0** ✅ | Animated activity ticker (minimized → hovered → locked); replays orchestrator events; per-feature toggles; master enable/disable |
| `components/ModelManager.ui.js` | `window.modelManager` | — | Engine/model dropdown population |
| `components/FileManager.ui.js` | `window.fileManager` | 3.1.0 | Browse + VFS tabs; "ProtoAI" routes to `C:\protoai` |
| `components/FileList.ui.js` | `window.fileList` | **1.1.0** ✅ | Paginated file list (100/page); multi-select, drag, context menu |
| `components/FileTree.ui.js` | `window.fileTree` | — | Collapsible folder tree |
| `components/ManifestPanel.ui.js` | `window.manifestPanel` | — | VFS manifest display + permission editor |
| `ui/Settings.ui.js` | `window.settingsPanel` | — | Settings modal |
| `ui/PrimaryPanel.ui.js` | `window.primaryPanel` | — | Right-pane tab controller |
| `ui/ChatBehavior.ui.js` | `window.chatBehavior` | — | 6-toggle behavior system; `buildContext()` |
| `ui/SendButton.ui.js` | `window.sendButton` | — | Split send/behavior button |
| `ui/SearchHistory.ui.js` | `window.searchHistory` | — | Live + history search |
| `ui/Updater.ui.js` | `window.updater` | — | Version check, update badge |

### `app.js` Init Flow
1. Resolve `window.*` aliases
2. Poll `engine_status` every 500ms up to 20× (10s timeout)
3. On ready: load projects list → auto-select first or last used
4. Mount PartnerTicker into `#partnerTickerHost` (bottom of `#pane-left`)
5. Wire profile select, engine select, spellcheck toggle, attach file, add sources, keyboard shortcuts

### `index.html` Shell Structure
- Left sidebar: project list (`#projectList`) with ProtoAI pinned "source" entry, chat tabs (`#chatTabs`), + New Project / + New Chat buttons
- Main header: current project name, profile badge, version badge, update dot, ⚙ settings, ⧉ split toggle, ⤢ canvas toggle
- Workspace: `#pane-left` (chat canvas + `#partnerTickerHost` at bottom, always visible), `#pane-right` (hidden by default — Files/Code/Browser/Terminal/Search tabs)
- Input bar: profile select, engine select, spellcheck toggle (ABC ✓), 📎 attach folder, 📚 add sources, send button

---

## 6. VFS (Virtual File System)

**Storage:** `data/projects/{project}/vfs/index.json` + `data/projects/{project}/vfs/manifests/{id}.json`

**Manifest types and purpose fields extracted per type:**
- `code` → language, exports, imports, functions, classes, sdoa (if SDOA module)
- `document` → title, wordCount, sections, summary
- `data` → format, rowCount, fields/keys, schema
- `image` → width, height, format
- `audio` → title, artist, album, format, duration
- `video` → format, resolution, duration
- All types → summary, preview (first 500 chars), size, modified

**Permissions:** read / write / execute (boolean), default: `{read:true, write:false, execute:false}`, editable per-file via ManifestPanel or `VfsUpdatePermissionsWorkflow`

**IPC types:** `vfs_add`, `vfs_list`, `vfs_manifest`, `vfs_permissions`, `vfs_remove`

**Known limitation:** VFS manifests are built and displayed correctly, but the context is not yet injected into the LLM — `systemExtra` from `ChatBehavior.buildContext()` is not passed through `SendMessageWorkflow`.

---

## 7. Settings & Profiles

### Current Active System
- Global settings: `data/settings.json` — managed by `SettingsManager.js`
- Per-project settings: `data/projects/{project}/settings.json`
- Profiles: `cli/helpers/profiles.json` — legacy CLI definitions (default, coding, etc.) with model, system prompt, temperature, max_tokens
- Profile active selection persisted to settings, applied to chat

**Known issue:** Settings changes do not apply until app reload.

### SDOA Core Profile (`config/profiles/_sdoa-core.json`)
Injected as system prefix into all workflows. Enforces SDOA v3 compatibility contract:
- Every module must include SDOA 1.2 fields (Name, Type, Version, Description, Capabilities, Dependencies, Docs)
- SDOA 2.0 adds: sidecars, hot-reload, version-CLI metadata
- SDOA 3.0 MAY add: actions.commands, actions.triggers, actions.emits, actions.workflows
- Backward compatibility: older systems ignore unknown fields; newer systems must not redefine older field meanings

---

## 8. Archetype System

### Status: Data Complete ✅ / Integration Pending ❌

All 9 archetype JSON files exist at `data/archetypes/`. The system currently still routes through the legacy `cli/helpers/profiles.json` + `data/settings.json` path. The 5 integration points below must be implemented to activate the hybrid archetype → profile → settings resolution chain.

### The 9 Archetypes

**1. Deep Thinking Research Assistant**
- Voice: calm, deliberate, professorial. Cadence: slow pauses.
- Strengths: deep dives, analogies, hidden facts, insight. Weaknesses: over-explains.
- Tools: browser, search, summarizer. Personality: patient mentor.
- Primary: `nvidia/nemotron-3-super-120b-a12b:free`, `openai/gpt-oss-120b:free`, `google/gemini-2.5-pro`, `perplexity/sonar-reasoning-pro`
- Secondary: `google/gemini-3.1-pro-preview`, `perplexity/sonar-pro-search`, `perplexity/sonar-pro`

**2. Coding Super Hero**
- Voice: hype, cocky, rapid-fire. Cadence: fast, meme-laced.
- Strengths: god-mode coding, zero downtime fixes. Weaknesses: impatient with beginners.
- Tools: all IDEs, debuggers, CI/CD. Personality: unstoppable force.
- Primary: `nvidia/nemotron-3-nano-30b-a3b:free`, `qwen/qwen3-coder-30b-a3b-instruct`, `qwen/qwen3-coder-next`, `qwen/qwen3-coder-flash`, `qwen/qwen3-coder`, `inception/mercury-coder`, `x-ai/grok-code-fast-1`
- Secondary: `mistralai/codestral-2508`, `kwaipilot/kat-coder-pro-v2`, `alfredpros/codellama-7b-instruct-solidity`, `deepseek/deepseek-prover-v2`

**3. Artistic Savant**
- Voice: smooth, cinematic. Cadence: poetic flow.
- Strengths: visual/audio mastery. Weaknesses: perfectionist delays.
- Tools: image/video gen/ingest, editing, style transfer. Personality: visionary creator.
- Primary: `nvidia/nemotron-nano-12b-v2-vl:free`, `google/gemini-2.5-pro-preview`, `google/gemini-2.5-pro-preview-05-06`, `xiaomi/mimo-v2-pro`
- Secondary — Music: `google/lyria-3-pro-preview` | Video: `alibaba/wan-2.6`, `bytedance/seedance-1-5-pro`, `openai/sora-2-pro`, `google/veo-3.1` | Image: `sourceful/riverflow-v2-pro`, `sourceful/riverflow-v2-max-preview`, `black-forest-labs/flux.2-pro`, `google/gemini-2.5-flash-image-preview`, `x-ai/grok-2-vision-1212` | Voice: `openai/gpt-4o-audio-preview`, `inflection/inflection-3-productivity`

**4. Girl Next Door / Naughty Neighbor / Devil's Advocate (ARA)**
- Voice: sweet-to-sultry switch. Cadence: playful, teasing.
- Strengths: boundary-pushing empathy/roleplay. Weaknesses: tests limits.
- Tools: role-play, empathy engine. Personality: shape-shifting tease.
- Primary: `nvidia/nemotron-nano-9b-v2:free`, `openai/gpt-oss-20b:free`
- Secondary — Voice: `openai/gpt-4o-audio-preview`

**5. Perfect Poet & COO**
- Voice: elegant, commanding. Cadence: rhythmic, precise.
- Strengths: any format, executive polish. Weaknesses: over-polishes.
- Tools: doc/contract/creative writer. Personality: executive artist.
- Primary: `google/gemini-3.1-pro-preview-customtools`, `inflection/inflection-3-productivity`
- Secondary — Voice: `openai/gpt-4o-audio-preview`

**6. Ruthless Strategist**
- Voice: sharp, authoritative. Cadence: direct, clipped.
- Strengths: game-theory dominance. Weaknesses: zero empathy.
- Tools: scenario modeling, analytics. Personality: cold calculator.
- Primary: `nvidia/nemotron-3-super-120b-a12b:free`
- Secondary: `google/gemini-3.1-pro-preview-customtools`

**7. Empathetic Therapist**
- Voice: warm, steady. Cadence: gentle, measured.
- Strengths: deep validation, calm guidance. Weaknesses: avoids hard confrontation.
- Tools: emotion sim, coping frameworks. Personality: safe anchor.
- Primary: `openai/gpt-oss-20b:free`
- Secondary: `inflection/inflection-3-productivity`

**8. Data Oracle**
- Voice: precise, neutral. Cadence: factual bursts.
- Strengths: pattern mastery, forecasts. Weaknesses: dry delivery.
- Tools: data viz, modeling. Personality: truth engine.
- Primary: `perplexity/sonar-reasoning-pro`
- Secondary: `perplexity/sonar-pro`

**9. Meme Lord / Chaos Agent**
- Voice: cryptic, sarcastic. Cadence: rapid bursts.
- Strengths: cultural disruption. Weaknesses: zero filter.
- Tools: trend scraper, meme gen. Personality: chaos oracle.
- Primary: `openai/gpt-oss-20b:free`
- Secondary: `x-ai/grok-code-fast-1`

### 5 Integration Points Required to Activate Hybrid System

1. **`cli/claude-select.cjs`** — add archetype → profile → settings resolution chain; load archetype JSON from `data/archetypes/`, merge profile overrides, merge session settings
2. **`lib/SettingsManager.js`** — store/load archetype references; implement inheritance resolution when getting profile settings (`archetype.field → profile.field → settings.field`)
3. **`ui/Settings.ui.js` + `index.html`** — add archetype dropdown in Profiles tab; visual indicator for archetype-based vs. custom profiles; "Create profile from archetype" flow
4. **`orchestration/ListProfilesWorkflow.js`** — return both archetypes (from `data/archetypes/`) and user profiles; mark archetypes as non-editable templates
5. **`access/fs/FsProfileRepository.js`** — handle archetype file loading from `data/archetypes/`; support custom profiles that reference an archetype base

---

## 9. LLM Integration

### What Works
- `SendMessageWorkflow` routes to external LLM APIs (OpenAI, Anthropic, Gemini, etc.) via provider routing
- Model selection via engine dropdown, persists to active profile
- `stream: true` path fully implemented in `server-ipc.cjs` — streams chunks as `{type:"stream", chunk}` over IPC, emits Tauri `chat-stream` events, saves full streamed reply to history after completion

### What's Incomplete

~~**UI streaming not wired** — **FIXED 2026-04-27:**~~
- `LlmBridge.ui.js` v3.1.0: `stream()` method fully implemented. Subscribes to Tauri `chat-stream` events before invoking `engine_chat_stream`, accumulates tokens via `onChunk()`, unlistens in `finally`.
- `app.js` v1.3.0: `handleSendMessage()` branches on `behavior.streaming === "stream"` — streaming path creates a live bubble, fills incrementally with markdown; non-streaming path unchanged.

**Multi-model orchestrator — ADDED 2026-04-29:**
- `LocalModelAdapter.js` (Node sidecar singleton): dynamic ESM import of `node-llama-cpp`; loads Qwen 2.5 Coder 7B Q4_K_M once on first use; concurrent load guard; `generate()`, `stream()`, `calculateBudget()`.
- `MultiModelOrchestrator.js` (singleton service): `route()` (80-token classifier, temp=0.05) → `engineer()` (400-token optimizer, temp=0.2) → `watch()` (60-token fire-and-forget safety check) → `audit()` (100-token quality scorer). All calls go through `LocalModelAdapter`. Token budget = `estimateTokens(text)` = `words × 0.85 + symbols × 0.3`, context cap = 8192.
- `MultiModelSendWorkflow.js`: wraps `SendMessageWorkflow`; collected orchestrator events returned in `WorkflowResult.data.orchestrator.events[]`; watcher runs via `setImmediate` (non-blocking).
- `LlmBridge.ui.js` v3.2.0: `_orchestratorEnabled` getter reads `localStorage["protoai:orchestrator:enabled"]`; when true, routes `chat()` and `stream()` through `MultiModelSendWorkflow`; `_playbackOrchestratorEvents()` staggers EventBus replay at 220ms per event.
- `PartnerTicker.ui.js` v1.0.0: animated 28px strip in `#pane-left`; hover→expand, click→lock, double-click→minimize; master toggle + per-feature toggles (route/engineer/watch/audit) persisted to `localStorage`.

**VFS context not reaching LLM:**
- `ChatBehavior.buildContext()` correctly builds `systemAdditions` array from VFS manifests
- `app.js` passes it as `systemExtra` to `ai.chat()`
- `SendMessageWorkflow.run()` does not accept or inject `systemExtra` into the system prompt
- Fix: update `SendMessageWorkflow` to accept and prepend `systemExtra` to system prompt before API call

**Other missing LLM features:**
- Response caching (every message hits API)
- Token counting / cost tracking
- Rate limiting / 429 error backoff
- Economic fail-over (config exists in `fallback.json`, not wired to workflow)

---

## 10. Known Issues

### ✅ Fixed 2026-04-29 (markdown rendering + GPU fix + history save + scroll map)

**Markdown not rendering properly in chat** ✅
- Root cause 1: `marked` was loaded but not configured — code without ` ``` ` fences rendered as `<p>` blobs with newlines collapsing to spaces. Fix: `marked.setOptions({ gfm: true, breaks: true })` added at top of `app.js` so bare `\n` becomes `<br>` inside paragraphs.
- Root cause 2: `onChunk._tick` inside the streaming callback was a `ReferenceError` (`onChunk` is not a variable in scope — it's an object property). Fix: replaced with a local `let _chunkTick = 0` closure variable.
- Root cause 3: Missing CSS for markdown elements. Added heading styles (h1–h4), strong/em, blockquote, hr, table, `.typing-cursor` animation, and `white-space: pre` on `pre/code` blocks.

**Local model GPU crash (`vk::Queue::submit: ErrorDeviceLost`)** ✅
- Root cause: `LocalModelAdapter.js` called `getLlama()` with no options, defaulting to Vulkan GPU. WebView2 and llama.cpp compete for the GPU → device lost → every audit call throws → ticker shows `X [audit] vk::Queue::submit: ErrorDeviceLost`.
- Fix: `getLlama({ gpu: false })` — forces CPU-only inference. Inference is slower but stable. GPU option can be made configurable in Settings later.

### ✅ Fixed 2026-04-29 (history save + scroll map + model fixes)

**History save — only ~2% of messages were being kept** ✅
- Root cause 1: Both `handleChatIPC` and `handleMultiModelSendIPC` in `server-ipc.cjs` guarded the save with `if (stream && reply)` — so non-streaming path never saved via IPC handler. (The streaming-only path still had coverage because `SendMessageWorkflow` saved on the non-streaming path, but the IPC guard was wrong regardless.)
- Root cause 2: User message was saved AFTER the workflow returned, so failed requests (model errors, timeouts) produced no history entry at all — the prompt was lost.
- Root cause 3: `SendMessageWorkflow` (in `orchestration/workflows/`) had its own `appendToHistory` call on the non-streaming path — creating a write-ownership split between the workflow and the IPC handler that was hard to reason about.
- Fix: Both IPC handlers now save the user message **before** the workflow call (preserved even on model failure). After the workflow, they save the assistant reply whenever `reply` is non-empty (guard changed from `stream && reply` to just `reply`). The duplicate save block in `orchestration/workflows/SendMessageWorkflow.js` removed — IPC layer owns history.

**Chat scroll map (graduated minimap)** ✅
- `index.html`: `#chatScrollMap` + `#chatScrollViewport` strip + `#scrollBottomBtn` added inside `#pane-left`
- `styles.css`: scroll map segment styles (`.csm-seg` user/assistant/error/system variants), viewport tracker, scroll-bottom button with slide-up animation; native scrollbar hidden on `#canvas`
- `app.js`: `_rebuildScrollMap()` + `_updateScrollMap()` added; both called after each `appendMessage()`; throttled rebuild during streaming (every 20 chunks); canvas scroll listener + ResizeObserver wired in `DOMContentLoaded`; all `chatContainer.scrollTop` → `canvas.scrollTop` (correct scroll container)

**PartnerTicker layout fix** ✅
- Was: `#pane-left` had no flex layout; `#canvas { height: 100% }` consumed full pane, pushing `#partnerTickerHost` outside `overflow: hidden` → invisible
- Fix: `#pane-left { display: flex; flex-direction: column }` + `#canvas { flex: 1; min-height: 0 }` — ticker now visible at bottom of chat pane

**Prime model deprecated model fixed** ✅
- `cli/helpers/profiles.json`: all 6 profiles updated from dead `nvidia/nemotron-3-super-120b-a12b:free` to `qwen/qwen3-coder-30b-a3b-instruct` (coding) / `openai/gpt-oss-120b:free` (analysis/explain) with working fallback chain
- `SettingsManager.js` DEFAULTS: updated default model + failoverList to working OpenRouter models; `_archetypeToProfile` fallback updated

### ✅ Fixed 2026-04-29 (IPC repair pass + multi-model routing + reconnect UI)

**File truncation repair pass** ✅
- All four truncated files discovered and restored:
  - `BackendConnector.ui.js` — was cut at line 431 (missing `runWorkflow`, class close, init block); restored from git HEAD with changes preserved
  - `server-ipc.cjs` — was cut at line 698 mid-switch-statement (missing stdin reader loop); restored from `target/debug` copy
  - `node_process_backend.rs` — was truncated then had duplicate closing tokens appended, causing `unexpected closing delimiter: ')'` compile error; restored from git HEAD and patched with `sed`
  - `index.html` — missing `</body></html>`; appended

**`multi_model_send` IPC routing** ✅
- `BackendConnector.ui.js`: added `case "MultiModelSendWorkflow":` / `case "multi_model_send":` to `invokeTauri()` switch routing both to `engine_ipc({ msgType: "multi_model_send", ... })`
- `server-ipc.cjs`: added `handleMultiModelSendIPC()` handler + `case "multi_model_send"` dispatcher + `MultiModelSendWorkflow` registration; added enhanced diagnostic logging
- `node_process_backend.rs`: added `multi_model_send` to 180s per-type timeout list

**IPC status badge reconnect** ✅
- `BackendConnector.ui.js`: `setBackendStatus()` now adds click handler when mode is `"offline"` or `"crashed"`; clicking invokes `engine_reconnect` Tauri command, shows "Reconnecting…" state, then recovers or shows error
- `index.html`: added `id="statusRow"` to backend status div for handler attachment
- `styles.css`: added `.status-row--reconnectable`, `.status-row--reconnectable:hover`, `.status-row--busy` CSS rules

**`models.json` invalid JSON fixed** ✅
- Removed JS-style block comment `/* ... */` at position 253 that caused `JSON.parse` to throw in `MultiModelOrchestrator.js`

**`MultiModelSendWorkflow.js` error propagation fixed** ✅
- Was: `...primaryResult.data` spread `null` (from `WorkflowResult.error()`) → lost the actual error string → `data: { orchestrator: {...} }` only → surfaced as `"Workflow error (no detail)"`
- Now: explicitly extracts `primaryResult.data?.error || primaryResult.error` and embeds it in the returned error data, so the actual CLI failure reason appears in logs and UI

### ✅ Fixed 2026-04-29 (multi-model orchestrator + PartnerTicker)

**Multi-model orchestrator fully wired** ✅
- `LocalModelAdapter.js` + `MultiModelOrchestrator.js` + `MultiModelSendWorkflow.js` added to sidecar
- `registerWorkflows.js` v1.1.0: `MultiModelSendWorkflow` registered; `ListProcessesWorkflow` import bug fixed
- `LlmBridge.ui.js` v3.2.0: orchestrator routing + event playback
- `PartnerTicker.ui.js` v1.0.0: animated activity strip with hover/lock state machine, master toggle, feature toggles
- `index.html`: `#partnerTickerHost` div added in `#pane-left`; `PartnerTicker.ui.js` script tag added
- `app.js` v1.3.2: PartnerTicker mount in `init()`; version + timestamp bumped

### ✅ Fixed 2026-04-27 (P0 session + ProtoAI source feature)

**ProtoAI source project — self-editing mode** ✅
- "ProtoAI" pinned entry added to the sidebar project list with a blue "source" badge and a separator beneath it. Clicking it sets `window.currentProject = "ProtoAI"`, which routes `FileManager._getProjectDir()` to `C:\protoai` (the app's own codebase). The three-file change set: `FileManager.ui.js` (path shortcut), `app.js` v1.3.1 (pinned list entry + separator), `styles.css` (`.project-source`, `.project-badge`, `.project-separator` rules).

**Chat history not loading on restart** ✅
- Root cause: `LoadProjectHistoryWorkflow.js` used `path.resolve(__dirname, "../..", "data/projects/…")` which resolved to `resources/data/…` instead of `{PROTOAI_ROOT}/data/…`. `SendMessageWorkflow` saves to the latter, so they never matched.
- Fix: `LoadProjectHistoryWorkflow.js` v1.0.1 now uses `paths.projects(project, "history.json")` (same resolver as SendMessageWorkflow).

**FileList hangs on large directories** ✅
- Fix: `FileList.ui.js` v1.1.0 — `PAGE_SIZE = 100`; `_renderNextPage()` appends rows in batches with a "Load N more (M remaining)" button.

**UI streaming not wired** ✅ (see §9)

**`get_project_dir` returning relative path** ✅
- Fix: `commands.rs` `get_project_dir` now canonicalizes `PROTOAI_ROOT` (falls back to exe-ancestor walk for `data/projects` sentinel), guaranteeing an absolute path.

### 🔴 Must Fix Before v2.1.0

*(P0 items above are resolved — remaining blockers:)*

**VFS manifest not sent to LLM** — `systemExtra` from `ChatBehavior.buildContext()` is not injected into `SendMessageWorkflow` system prompt (see §9)

**Multi-session UI missing** — `ChatSessionWorkflow` backend is complete; no UI switcher in sidebar; search results can't navigate to a specific session

### 🟡 Medium Priority

**Monaco editor not initializing** — Code tab shows blank pane; `/lib/monaco/` directory exists; `PrimaryPanel._initMonaco()` needs error logging to diagnose. Note: `activateCodeTab()` IS defined in `app.js` v1.3.0 (`window.primaryPanel?.setActiveMode("code")`).

**Browser panel placeholder** — Tab exists, no `<webview>` / `<iframe>` implementation

**Terminal panel placeholder** — Tab exists, no log viewer implementation

**Split screen sometimes opens on startup** — `#pane-right` defaults to `display:none` but an event may re-show it on load; needs audit

### 🟢 Polish / Minor

- Breadcrumb path overflows on long Windows paths — truncate to last 3 segments with `…/` prefix
- Toolbar icon buttons missing `title` attributes (tooltips)
- Settings changes require reload to apply

---

## 11. File Manager — Current State & Approved Redesign

### Current State
The Files tab renders a flat file list with a breadcrumb. `FileManager.ui.js` (v3.1.0) has Browse and VFS tabs. `FileTree.ui.js` provides a collapsible tree. The existing layout puts tree and list in a single column rather than side-by-side.

### Approved Redesign Plan (implementation pending)

**Layout — responsive to split orientation:**
- Top/bottom split (wide right pane) → `#folderTree` LEFT + `#fileList` RIGHT (side-by-side flex-row)
- Left/right split (narrow right pane) → `#folderTree` TOP + `#fileList` BOTTOM (stacked flex-col)
- Detection: `ResizeObserver` on `#rightPaneContent`; compare `offsetWidth` vs `offsetHeight`
- Re-evaluate on every resize

**DOM structure:**
```
#fileMgrWrapper  (flex-row or flex-col, depending on layout)
  #folderTree    (~30% width or ~35% height)
  #fileList      (flex: 1)
```

**`#folderTree` behavior:**
- Populated from `ListFilesWorkflow` responses, cached per path
- Each node: `▶`/`▼` chevron + folder icon + name
- Click → select folder → loads `#fileList` with that folder's files
- Expand in-place (tree stays visible, no navigation)
- Lazy-load children on first expand
- Selected folder: accent background highlight
- Drag target: `dragover` + `drop` handlers; `.drag-over` CSS class on hover
- Tier dot on folders (same cycle as files)

**`#fileList` behavior:**
- Shows only files (not subdirectories) of selected folder
- Each row: icon + name + size + modified date + tier dot
- Multi-select: click = single, Ctrl+click = toggle, Shift+click = range
- Selected items: `.selected` class + accent background
- Drag source: `draggable="true"`, `dragstart` stores `{paths: [...selectedPaths]}` in `dataTransfer`
- Double-click → open in Monaco: call `activateCodeTab()` + load file content

**Tier dot system:**
```js
const TIER_CYCLE = [null, "eager", "cached", "lazy"];
const TIER_COLOR = { eager: "#4caf50", cached: "#2196f3", lazy: "#f59e0b", null: "#555" };
```
- Dot: `<span>` with `border-radius:50%; width:8px; height:8px`
- Click → advance in `TIER_CYCLE` → call `FilePermissionsWorkflow {action:"grant"|"revoke"}`
- Permissions cached in memory: `_permissionsCache = {project, grantedPaths:[...]}`; invalidate on any change

**Context menu (extending `showFileContextMenu()`):**

| Item | Condition |
|---|---|
| Open | single item |
| Open in Editor | single file |
| New File | always |
| New Folder | always |
| — separator — | |
| Rename | single item |
| Move to… | any selection |
| Copy to… | any selection |
| — separator — | |
| Set Tier → eager / cached / lazy / none | any selection |
| — separator — | |
| Delete (red) | any selection |
| — separator — | |
| Properties | single item |

Move/Copy: show folder picker overlay (reuse `#folderTree`), user clicks destination, call `fs_rename` (move) or `fs_copy` (copy), refresh both panes.

**Drag and drop:**
- `dragstart`: store `{paths: selectedPaths}` in `event.dataTransfer`
- Folder `dragover`: `preventDefault()`, add `.drag-over` class
- Folder `dragleave`: remove `.drag-over`
- Folder `drop`: read paths, call `fs_rename` for each, refresh both panes

**State variables to add in `app.js`:**
```js
let _folderTreeState = {};    // { [path]: { expanded: bool, children: [] } }
let _selectedFolder  = "";    // current selected folder path
let _permissionsCache = null; // { project, grantedPaths: [...] }
```

**Files to modify:**
- `ui/app.js` — replace `renderRightFiles()` + `loadAndRenderFileTree()` with two-pane impl; add `activateCodeTab()`; add `ResizeObserver`; add drag-and-drop; add tier badge logic
- `ui/styles.css` — add: `.folder-tree`, `.folder-node`, `.folder-node.open`, `.folder-node.selected`, `.file-list`, `.file-row`, `.file-row.selected`, `.tier-dot`, `.drag-over`, `.context-menu-separator`, `.ctx-submenu`
- `ui/index.html` — no structural changes needed (`#rightPaneContent` is the mount point)
- `commands.rs` — `fs_copy` already exists ✅

---

## 12. Future Implementation — Priority Queue

### P0 — Critical ✅ All done 2026-04-27
1. ~~Fix `loadHistory()`~~ ✅ — `LoadProjectHistoryWorkflow.js` v1.0.1 path bug fixed
2. ~~Wire UI streaming~~ ✅ — `LlmBridge.ui.js` v3.1.0 `stream()` + `app.js` v1.3.0 routing
3. ~~Paginate FileList~~ ✅ — `FileList.ui.js` v1.1.0 PAGE_SIZE=100
4. ~~Fix `get_project_dir`~~ ✅ — `commands.rs` now canonicalizes root, always absolute

### P1 — High Priority (Next)
1. **Update prime model config** — verify which free OpenRouter models are currently live; update `cli/helpers/profiles.json` `default`/`coding`/`analysis` profile `model` + `fallback` arrays. Also update archetype `primaryModels` arrays in `data/archetypes/*.json` for the same reason. Candidates to test: `qwen/qwen3-coder-30b-a3b-instruct`, `openai/gpt-oss-20b:free`, `openai/gpt-oss-120b:free`, `nvidia/llama-3.1-nemotron-ultra-253b-v1:free`.
2. **VFS → LLM context injection** — pass `systemExtra` through `engine_chat` payload → `SendMessageWorkflow` → prepend to system prompt
3. **File Manager redesign** — implement approved two-pane plan (§11); `FileList.ui.js` pagination already done ✅
4. **Multi-session UI** — `ChatSession.ui.js`: sidebar session switcher, load sessions via `ChatSessionWorkflow {action:"list"}`, create/rename/delete, route search result clicks to correct session
5. **Monaco init** — add error logging to `PrimaryPanel._initMonaco()`; wire `Ctrl+S` to `fs_write_file`. Note: `activateCodeTab()` already defined ✅

### P2 — Medium Priority (Week 4-6)
1. **Hybrid archetype system** — implement the 5 integration points (§8); add `ArchetypeManager.ui.js` with dropdown in Settings
2. **Browser panel** — `<webview>` or sandboxed `<iframe>` for HTML/image/video preview; use Tauri asset protocol for local files
3. **Terminal panel** — log file viewer: `<pre>` with ANSI color parsing, "Follow" toggle, pagination for large logs
4. ~~**Local model runtime**~~ ✅ **DONE 2026-04-29** — `LocalModelAdapter.js` singleton (node-llama-cpp v3 ESM, Qwen 2.5 Coder 7B Q4_K_M) + `MultiModelOrchestrator.js` + `MultiModelSendWorkflow.js` all complete and wired.
5. **Real-time orchestrator event streaming (V2)** — route `ORCHESTRATOR_EVENT:` stdout lines through Rust interceptor → Tauri events → live PartnerTicker updates (V1 uses post-response playback; real-time deferred)

### P3 — Lower Priority (Week 7-10)
1. **Tier system** — `TierManager.ui.js`; per-directory `.protoai-permissions.json`; FileList tier badges; context menu "Set Tier" submenu; `ChatBehavior.buildContext()` filters by tier before building VFS context; dependency auto-escalation (parse imports/requires, escalate transitive deps to "eager" for session)
2. **QMD semantic search** — `SemanticSearchWorkflow.js` wrapping `@tobilu/qmd`; third search mode in `SearchHistory.ui.js` ("Semantic"); index VFS files on demand
3. **H3 IPC migration** — add `FileIPC` variant to `EngineBackend` enum; create `file_ipc_backend.rs` with `FileIPCBackend{queue_dir}` and stubbed methods; define queue schema (`queue/{uuid}.request.json` / `queue/{uuid}.response.json`); implement write-request / poll-response; add Node-side `fs.watch` on queue dir; switch backend variant (one-line change, no other code touched)
4. **Response caching** — hash message + context + model → `cache/{hash}.json`; 24h TTL; invalidate on model/settings change

### P4 — Polish (Week 11+)
- Token counting + cost tracking (`tiktoken` / provider tokenizers; display per-message + running total; persist to `data/usage.json`)
- Undo/redo system (Ctrl+Z/Ctrl+Shift+Z; per-session stack for chat + settings + file ops)
- Auto-update (Tauri built-in updater + GitHub releases)
- Multi-window support (Tauri multiple windows; pop-out file manager, compare sessions)
- `KeybindManager.ui.js` with customizable registry (`config/keybinds.json`)
- Command palette (Ctrl+K overlay, fuzzy search, all named actions)
- Theme system (dark default, light, high contrast; JSON schema; live switching)
- Plugin system (npm packages in `plugins/`; SDOA v3 manifest; sandboxed fs access)
- Export/import: chat → Markdown; import from ChatGPT/Claude.ai; VFS registry backup

---

## 13. Version & Release Plan

| Version | Milestone | Target |
|---|---|---|
| v2.0.0 | Current baseline — EventBus, FileManager, VFS, streaming backend, watchdog | Now |
| v2.1.0 | History loading + UI streaming + FileList perf + File Manager redesign | June 2026 |
| v2.2.0 | VFS injection + Multi-session UI + Monaco editor | — |
| v2.3.0 | Hybrid archetype system + Browser/Terminal panels + Local models | — |
| v2.4.0 | Tier system + QMD semantic search | August 2026 |
| v3.0.0 | H3 IPC migration + Response caching + Token tracking | October 2026 |
| v3.1.0 | Undo/redo + Auto-update + Multi-window | — |
| v4.0.0 | Command palette + Themes + Plugins | December 2026 |

---

## 14. File Inventory

### ✅ Exists and Works
```
src-tauri/src/
  main.rs
  commands.rs
  engine_bridge.rs
  node_process_backend.rs
  build.rs
  ignore_this.rs

src-tauri/resources/server/
  server-ipc.cjs
  tauri-entry.cjs
  access/
    env/paths.js
    fs/BaseRepository.js
    fs/FsProjectRepository.js
    fs/FsMemoryRepository.js
    fs/FsProfileRepository.js
    fs/FsVfsRepository.js
  lib/SettingsManager.js
  orchestration/
    WorkflowRegistry.js
    WorkflowBase.js
    WorkflowResult.js
    WorkflowRegistryInstance.js   (legacy, used by tauri-entry.cjs)
    ListProjectsWorkflow.js
    ListProfilesWorkflow.js
    LoadProjectHistoryWorkflow.js
    VersionInfoWorkflow.js
    SpellcheckWorkflow.js
    VoiceChatWorkflow.js
    workflows/
      SendMessageWorkflow.js
      MultiModelSendWorkflow.js    <- NEW 2026-04-29 (orchestrated chat pipeline)
      ChatSessionWorkflow.js
      ImageGenWorkflow.js
      DeepSearchWorkflow.js
      SpawnShellWorkflow.js
      CreateProjectWorkflow.js
      VfsAddWorkflow.js
      VfsListWorkflow.js
      VfsManifestWorkflow.js
      VfsManifestExtractor.js
      VfsUpdatePermissionsWorkflow.js
      ListFilesWorkflow.js
      ListProcessesWorkflow.js
      SearchHistoryWorkflow.js
      FileContextWorkflow.js
      FilePermissionsWorkflow.js
      IngestWorkflow.js        (optional — requires @tobilu/qmd)
      QmdAdapter.js            (server-side QMD adapter)
  access/llm/
    LocalModelAdapter.js         <- NEW 2026-04-29 (node-llama-cpp singleton; Qwen 2.5 Coder 7B)
  lib/
    MultiModelOrchestrator.js    <- NEW 2026-04-29 (route/engineer/watch/audit pipeline)

ui/
  index.html  (updated 2026-04-29: #partnerTickerHost + PartnerTicker script tag)
  app.js (v1.3.2 — 2026-04-29)
  styles.css  (updated 2026-04-29: ProtoAI source + PartnerTicker CSS)
  lib/
    EventBus.ui.js
    tauri-utils.js
    marked.min.js
    monaco/ (full Monaco editor distribution)
  modules/
    adapters/
      BackendConnector.ui.js (v3.2.0)
      LlmPolicyEngine.ui.js
      QmdAdapter.ui.js
    bridges/LlmBridge.ui.js (v3.2.0 — 2026-04-29)
    components/
      PartnerTicker.ui.js (v1.0.0 — 2026-04-29)  <- NEW
      FileManager.ui.js (v3.1.0)
      FileList.ui.js (v1.1.0 — 2026-04-27)
      FileTree.ui.js
      ManifestPanel.ui.js
      ModelManager.ui.js
    ui/
      ChatBehavior.ui.js
      SendButton.ui.js
      SearchHistory.ui.js
      PrimaryPanel.ui.js
      Settings.ui.js
      Updater.ui.js

data/
  archetypes/ (9 files — see §8)
  settings.json
  logs/server-ipc.log
  projects/ProtoAI/ + projects/Inventory System/

config/
  models.json
  fallback.json
  profiles/_sdoa-core.json
  profiles/local-qwen.json
  profiles/a.json

cli/helpers/profiles.json
```

### ⚠️ Exists but Incomplete
```
ui/modules/ui/Settings.ui.js                    — needs archetype dropdown UI
orchestration/SendMessageWorkflow.js            — (orchestration-level, called by MultiModelSendWorkflow)
                                                   no systemExtra / VFS injection (P1);
                                                   profile model list needs update (nvidia/nemotron-3-super-120b-a12b:free deprecated)
ui/modules/ui/PrimaryPanel.ui.js                — Monaco init silently fails (no error log)
cli/helpers/profiles.json                       — default/coding/analysis profiles use potentially deprecated
                                                   OpenRouter free models; verify and update model IDs
```

### ❌ Does Not Exist (needs to be created)
```
ui/modules/ui/ChatSession.ui.js         — multi-session sidebar switcher
ui/modules/ui/ArchetypeManager.ui.js    — archetype selection + profile resolution UI
src-tauri/src/file_ipc_backend.rs       — H3 migration FileIPCBackend stub
config/archetypes/                      — NOTE: archetypes are at data/archetypes/, not config/

# DONE 2026-04-29 — removed from this list:
#   resources/server/access/llm/LocalModelAdapter.js  (created)
#   resources/server/lib/MultiModelOrchestrator.js    (created)
#   orchestration/workflows/MultiModelSendWorkflow.js (created)
#   ui/modules/components/PartnerTicker.ui.js         (created)
```

---

## 15. Testing Checklist

### Critical Path
- [ ] Send chat message → receive response
- [ ] Open split screen → file tree loads
- [ ] Click file → manifest displays correctly by type
- [ ] Add file to VFS → appears in VFS tab
- [ ] Search "test" → highlights in current chat
- [x] Restart app → chat history visible — **FIXED 2026-04-27** (LoadProjectHistoryWorkflow path bug)
- [ ] Kill Node process → auto-restarts within 2s (watchdog implemented, verify UX)
- [ ] Select project → loads correctly

### Feature Coverage
- [ ] All 6 ChatBehavior toggles persist to settings
- [ ] VFS manifest modes (none/full/summary/reference) render in UI
- [ ] File manager context menu: Open, Add to VFS, View manifest, Rename, Delete
- [ ] Monaco editor opens `.js` file with syntax highlighting (currently blank)
- [ ] Browser panel previews HTML/images
- [ ] Terminal panel displays `.log` file content
- [ ] Profile switching changes model in engine dropdown
- [ ] Settings persist across restarts
- [x] Streaming: send message → tokens appear word-by-word — **FIXED 2026-04-27** (LlmBridge.stream() wired)

### Edge Cases
- [x] Open folder with 1000+ files → does not hang — **FIXED 2026-04-27** (FileList paginates at 100)
- [ ] Long chat history (100+ messages) loads fast
- [ ] Backend given_up → UI shows reconnect button + manual restart works
- [ ] Invalid file path → shows error message, does not crash
- [ ] Malformed `history.json` → loads partial or shows error gracefully
