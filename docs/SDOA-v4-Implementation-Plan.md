# SDOA v4 Migration — Implementation Plan

## Goal

Rebuild ProtoAI's frontend and backend from v3's monolithic file structure to SDOA v4's primitive-based, schema-driven, auto-routing architecture. The app must remain functional after every phase.

> [!IMPORTANT]
> This is a **major architectural refactoring**. Each phase is designed to be independently deployable. We do NOT proceed to Phase N+1 until Phase N is verified working.

---

## Current State Analysis

### Files That Must Be Decomposed

| File | Lines | Problem |
|------|-------|---------|
| `styles.css` | 2,160 | Monolithic; no tokens, no scoping |
| `Settings.ui.js` | 965 | One-off modal + tabs + 9 form sections + save logic |
| `app.js` | 833 | God-object: init, chat, projects, scroll, profiles, keybinds |
| `ModelManager.ui.js` | 826 | Embeds entire archetype catalog + UI rendering + save logic |
| `index.html` | 645 | 400+ lines of hand-coded modal/form HTML |
| `PrimaryPanel.ui.js` | 631 | File upload + code editor + manifest panel + tab switching |
| `server-ipc.cjs` | 778 | Monolithic dispatcher with manual case statements |
| `FileList.ui.js` | 433 | Hand-coded list rendering + context menu + drag/drop |

### Repeated Patterns Found

| Pattern | Instances | v4 Primitive |
|---------|-----------|-------------|
| Tab switching | 4 (Settings, PrimaryPanel, ProjectManager, right pane) | `TabGroup.prim.js` |
| Form fields | ~30 (Settings, ProjectManager, FirstRun) | `Form.prim.js` + `Input.prim.js` |
| Modal overlays | 3 (Settings, ProjectManager, FirstRun) | `Modal.prim.js` |
| Scrollable lists | 5 (projects, files, models, history, processes) | `List.prim.js` |
| Status badges | 4 (profile, version, update dot, status dot) | `Badge.prim.js` |
| Empty states | 3 (chat, project, files) | `EmptyState.prim.js` |
| Action toolbars | 3 (header, chat input, file manager) | `Toolbar.prim.js` |
| Toast notifications | 1 (but used everywhere) | `Toast.prim.js` |

---

## Phase 0 — Skeleton & Foundation

**Goal:** Create the v4 directory structure and core infrastructure without breaking anything.

### Tasks

- [x] Write SDOA v4 Specification (`docs/SDOA-v4-Specification.md`)
- [ ] Create directory skeleton under `ui/primitives/`, `ui/features/`, `ui/adapters/`, `ui/services/`, `ui/data/`
- [ ] Create `ui/tokens.css` — extracted from `styles.css` (all `:root` variables)
- [ ] Create `StateStore.adapter.js` — centralized state (replaces all `window.*` globals)
- [ ] Create `ModuleLoader.service.js` — discovers and initializes v4 modules in lifecycle order

### Verification
- All existing v3 functionality continues to work unchanged
- New directories exist but are empty/inactive
- `tokens.css` is loaded but doesn't change any visual appearance

---

## Phase 1 — Core Primitives

**Goal:** Build the 6 most-reused primitives. These are the atoms everything else is made of.

### 1a. `Button.prim.js`

```
Config: { label, icon, variant, size, onClick, disabled, tooltip, loading }
Variants: primary, secondary, ghost, icon-only, danger
```

Replaces: Every hand-coded `<button>` in the app.

### 1b. `Input.prim.js`

```
Config: { type, label, placeholder, value, onChange, validate, hint, error }
Types: text, password, number, textarea, search
```

Replaces: Every `<input>`, `<textarea>`, `<select>` in Settings, ProjectManager, FirstRun.

### 1c. `Panel.prim.js`

```
Config: { title, collapsible, collapsed, actions, headerSlot, bodySlot }
```

Replaces: Sidebar sections, right pane sections, any bordered content area.

### 1d. `Modal.prim.js`

```
Config: { title, size, onClose, headerSlot, bodySlot, footerSlot }
Sizes: small (400px), medium (600px), large (800px), full
```

Replaces: Settings overlay, ProjectManager overlay, FirstRun wizard overlay.

### 1e. `TabGroup.prim.js`

```
Config: { tabs: [{ id, label, icon, badge }], activeTab, onTabChange, renderTab }
```

Replaces: Settings nav, PrimaryPanel modes, ProjectManager tabs, right pane tabs.

### 1f. `List.prim.js`

```
Config: { items, renderItem, onSelect, onContextMenu, emptyState, searchable, virtualized }
```

Replaces: Project list, file list, model list, history list, process list.

### 1g. `Form.prim.js`

```
Config: { fields (from schema), values, onSubmit, onChange, layout }
```

Reads a schema JSON and renders the appropriate `Input`/`Toggle`/`Select` primitives.

### 1h. `Toast.prim.js`

```
Config: { message, type, duration, action }
Types: info, success, warning, error
```

Replaces: The `showToast()` function in app.js.

### Verification
- Each primitive has a visual test page (`ui/test/primitives.html`)
- Each primitive renders correctly in isolation with mock data
- No existing v3 code is changed yet

---

## Phase 2 — StateStore & BackendConnector v4

**Goal:** Replace scattered globals with centralized state. Replace manual switch routing with auto-discovery.

### 2a. `StateStore.adapter.js`

```js
// Migrated globals:
window.currentProject  → StateStore.get("currentProject")
window._attachedFiles  → StateStore.get("attachedFiles")
localStorage items     → StateStore auto-persists
```

### 2b. `BackendConnector.adapter.js` (v4)

- Reads `backendDeps` from all module manifests
- Auto-builds routing table
- Falls back to `engine_ipc` passthrough for unknown actions
- Includes status polling and reconnect logic from current v3.2

### 2c. EventBus upgrade

- Add lifecycle awareness (modules register/unregister on mount/unmount)
- Remove `setTimeout` auto-bridge hacks
- Add typed event declarations

### Verification
- All `window.*` global state access replaced with StateStore
- BackendConnector routes all existing workflows correctly
- Projects persist across refresh (the recurring bug is gone)

---

## Phase 3 — Settings Migration (Proof of Concept)

**Goal:** Migrate the largest, most complex UI surface to prove the v4 pattern works end-to-end.

### Tasks

- [ ] Create `ui/data/schemas/settings.schema.json` — defines all 9 tabs + fields
- [ ] Create `Settings.feature.js` — composes Modal + TabGroup + Form primitives from schema
- [ ] Remove all hand-coded Settings HTML from `index.html` (~200 lines)
- [ ] Remove `Settings.ui.js` (965 lines) — replaced by ~100 line feature + JSON schemas
- [ ] Verify: open settings, change API key, test key, save, reload — all works

### Expected Savings

| Before | After |
|--------|-------|
| `Settings.ui.js` — 965 lines | `Settings.feature.js` — ~100 lines |
| `index.html` Settings HTML — ~200 lines | 0 lines (schema-driven) |
| Total: ~1,165 lines | Total: ~100 lines + ~200 lines JSON |

---

## Phase 4 — Feature Migrations

**Goal:** Migrate remaining features one at a time.

### 4a. Chat Feature
- Extract from `app.js`: `handleSendMessage`, `appendMessage`, scroll logic, chat tabs
- Composes: Panel + List (messages) + Toolbar (input bar) + Markdown + ScrollMap

### 4b. FileExplorer Feature
- Merge: `FileManager.ui.js` + `FileTree.ui.js` + `FileList.ui.js` + `ManifestPanel.ui.js`
- Composes: Panel + Tree + List + TabGroup + ContextMenu

### 4c. ProjectManager Feature
- Extract from `app.js`: `loadProjects`, project CRUD, project settings modal
- Composes: List + Modal + Form + TabGroup

### 4d. ModelManager Feature
- Refactor `ModelManager.ui.js` (826 lines)
- Externalize archetype catalog to `archetypes.catalog.json`
- Composes: TabGroup + List + Form + Badge

### 4e. `app.js` Slim-Down
- After all features extracted, `app.js` becomes a thin shell (~80 lines):
  - Import and init StateStore
  - Discover and mount features
  - Wire keyboard shortcuts
  - Done.

---

## Phase 5 — Backend Decomposition

**Goal:** Replace `server-ipc.cjs` (778 lines) with auto-discovering Router.

### Tasks

- [ ] Create `Router.service.js` — auto-discovers `*.workflow.js` files
- [ ] Create `Middleware.service.js` — logging, error handling
- [ ] Create `ResponseFormatter.service.js` — standardized `{ ok, data, error }`
- [ ] Rename/restructure existing workflows to `*.workflow.js` with v4 manifests
- [ ] Add `messageType` to each workflow manifest (for auto-routing)
- [ ] Create `main.js` — new entry point (< 50 lines)
- [ ] Delete `server-ipc.cjs`

### Verification
- All IPC commands still work
- `server-ipc.log` shows clean routing
- Adding a new workflow = creating one file (no registration needed)

---

## Phase 6 — Data Externalization

**Goal:** Move all embedded datasets out of code into JSON files.

### Files to Create

| Data | Source | Target |
|------|--------|--------|
| Model catalog | Embedded in `ModelManager.ui.js` | `ui/data/catalogs/models.catalog.json` |
| Archetypes | Embedded in `ModelManager.ui.js` | `ui/data/catalogs/archetypes.catalog.json` |
| Supported extensions | Embedded in `Settings.ui.js` | `ui/data/catalogs/extensions.catalog.json` |
| Default settings | Embedded in `SettingsManager.js` | `ui/data/defaults/settings.defaults.json` |
| Default policy | Embedded in `LlmPolicyEngine.ui.js` | `ui/data/defaults/policy.defaults.json` |

---

## Phase 7 — CSS Extraction

**Goal:** Break `styles.css` (2,160 lines) into tokens + co-located primitive CSS.

### Tasks

- [ ] Extract `:root` variables → `ui/tokens.css`
- [ ] Extract button styles → `ui/primitives/Button/Button.prim.css`
- [ ] Extract input styles → `ui/primitives/Input/Input.prim.css`
- [ ] Extract modal styles → `ui/primitives/Modal/Modal.prim.css`
- [ ] Extract remaining layout/feature styles → `ui/features/{Feature}/Feature.css`
- [ ] Update `index.html` to load in order: tokens → primitives → features

---

## Phase 8 — Feature Roadmap (Prior Plans Integrated)

**Goal:** Map every prior plan and committed future feature into the v4 architecture. Each sub-phase is independently shippable.

> [!NOTE]
> These features were planned in prior sessions but never fully mapped to specific modules. This phase ensures nothing is lost during the v4 migration.

---

### 8a. Intelligence Expansion — Memory & User Profiling
*Source: `implementation_plan_intelligence.md` Phase 1*

**What it does:** ProtoAI learns from conversations. It extracts user observations, builds a persistent User Profile (preferences, style, traits), and compacts long histories into Knowledge Snippets so context windows don't overflow.

**Status:** `MemoryManager.js` (157 lines) already exists with `loadGlobal()`, `loadUserProfile()`, `record()`, and `distillProfile()`. `user-profile.json` exists in `data/`. Partially wired into `MultiModelOrchestrator.js`.

| v4 Module | Type | Layer | Description |
|-----------|------|-------|-------------|
| `Memory.workflow.js` | workflow | 3 | Refactor of `MemoryManager.js` — record facts, distill profile, compact history |
| `Memory.repository.js` | repository | 3 | Reads/writes `global-memory.json` and `user-profile.json` |
| `UserProfile.feature.js` | feature | 1 | UI to view/edit your extracted profile (name, traits, preferences) |
| `UserProfile.schema.json` | data | — | Schema for the profile viewer form |
| `user-profile.json` | data | — | Already exists at `data/user-profile.json` |

**Backend changes:**
- `Chat.workflow.js` calls `Memory.workflow.js` after each exchange to extract observations
- `FileContext.workflow.js` injects user profile into system prompt when relevant

---

### 8b. The "(Not So) Silent Partner" — Persona Dialogue
*Source: `implementation_plan_intelligence.md` Phase 2–3*

**What it does:** The Partner Ticker evolves from a log viewer into a multi-faceted AI persona channel. The local GGUF model generates side-channel commentary (Advisor, Comedian, Friend) in parallel with the prime LLM response.

| v4 Module | Type | Layer | Description |
|-----------|------|-------|-------------|
| `SilentPartner.feature.js` | feature | 1 | Composes Panel + List to show persona dialogue bubbles + thought stream |
| `SilentPartner.schema.json` | data | — | Persona definitions, dialogue styles |
| `Commentary.workflow.js` | workflow | 3 | Calls local model with persona prompt; emits `orchestrator:commentary` events |
| `personas.catalog.json` | data | — | Externalized persona configs (currently hardcoded in Orchestrator) |

**Frontend changes:**
- `SilentPartner.feature.js` replaces `PartnerTicker.ui.js` (318 lines)
- Listens for `orchestrator:commentary` events and renders as styled bubbles
- Persona switcher (Advisor / Comedian / Friend / Custom) via `Select.prim`

**Backend changes:**
- `MultiModelOrchestrator.js` → refactored into `Orchestrator.workflow.js`
- `generateCommentary()` becomes a standalone pipeline stage
- User Profile is injected so the Partner "knows" who it's talking to

---

### 8c. Google Drive Integration
*Source: `google_drive_plan.md`*

**What it does:** Browse, select, and import files from Google Drive directly into ProtoAI projects. OAuth2 flow, file picker, auto-ingestion after download.

**Status:** `GoogleDriveWorkflow.js` (136 lines) and `GoogleDriveConnector.ui.js` (162 lines) already exist. Partially functional.

| v4 Module | Type | Layer | Description |
|-----------|------|-------|-------------|
| `GoogleDrive.feature.js` | feature | 1 | Composes Modal + List + Button to show Drive file browser |
| `GoogleDrive.workflow.js` | workflow | 3 | Refactor of existing `GoogleDriveWorkflow.js` — OAuth, list, download |
| `GoogleDrive.adapter.js` | adapter | 3 | API client for Google Drive REST endpoints |
| `connectors.schema.json` | data | — | Schema for the connectors settings tab (Drive creds, status) |

**Data flow:**
1. User clicks "Connect Google Drive" in Settings → opens OAuth URL
2. User pastes auth code → `GoogleDrive.workflow.js` exchanges for token
3. `GoogleDrive.feature.js` renders file picker via `List.prim` + `Tree.prim`
4. On import → files saved to `data/projects/[project]/google_drive/`
5. Auto-triggers `Ingest.workflow.js` → files immediately available to AI

---

### 8d. VFS Tier System — Eager/Cached/Lazy Context Control
*Source: `analysis_results.md`, `handoff_report.md`*

**What it does:** Each file in a project gets a "tier" label controlling how aggressively it's included in the LLM's context window. Manages token budget vs. file importance.

| Tier | Behavior | Token Cost |
|------|----------|------------|
| **Eager** | Always included in every prompt | High |
| **Cached** | Loaded once, included until evicted | Medium |
| **Lazy** | Only loaded when explicitly referenced or semantically matched | Low |

| v4 Module | Type | Layer | Description |
|-----------|------|-------|-------------|
| `VfsTierDots.prim.js` | primitive | 2 | Renders colored tier indicators (🟢 Eager, 🟡 Cached, ⚪ Lazy) next to files |
| `VfsTier.workflow.js` | workflow | 3 | Manages tier assignments; reads/writes `.protoai-tiers.json` per project |
| `FileContext.workflow.js` | workflow | 3 | Already exists — update to respect tier priorities when selecting context |
| `TokenBudget.service.js` | service | 3 | Calculates remaining token budget based on model limits and tier allocations |

**Integration:**
- `FileExplorer.feature.js` renders `VfsTierDots.prim` next to each file in the tree/list
- Right-click context menu (via `ContextMenu.prim`) includes "Set Tier → Eager / Cached / Lazy"
- `FileContext.workflow.js` sorts files by tier before filling the context window

---

### 8e. Bun Runtime Provisioning
*Source: `SysProvisionBunWorkflow.js`, `SysCheckBinaryWorkflow.js`*

**What it does:** Auto-downloads and installs the Bun runtime for local GGUF model inference when `node-llama-cpp` isn't available.

**Status:** Both workflows exist and are functional. No v4 changes needed beyond renaming.

| v4 Module | Type | Layer | Description |
|-----------|------|-------|-------------|
| `SysProvisionBun.workflow.js` | workflow | 3 | Rename of existing file; add v4 manifest with `messageType: "sys_provision_bun"` |
| `SysCheckBinary.workflow.js` | workflow | 3 | Rename of existing file; add v4 manifest |
| `SystemHealth.feature.js` | feature | 1 | Settings tab showing runtime status (Node version, Bun status, GPU availability) |

---

### 8f. Multi-Session Chat UI
*Source: `handoff_report.md`, `analysis_results.md`*

**What it does:** Users can create, switch between, and manage multiple chat sessions within a project. Backend `ChatSessionWorkflow.js` already supports this — the UI is missing.

| v4 Module | Type | Layer | Description |
|-----------|------|-------|-------------|
| `ChatSessions.feature.js` | feature | 1 | Sidebar section showing chat tabs; composes List + Button primitives |
| `ChatSession.workflow.js` | workflow | 3 | Refactor of existing `ChatSessionWorkflow.js` — CRUD for sessions |
| `sessions.schema.json` | data | — | Session metadata shape (id, title, created, lastMessage preview) |

**Integration:**
- Sidebar "Chats" section becomes a `List.prim` of sessions
- "New Chat" button → `ChatSession.workflow.js` creates a new session
- Selecting a session → `StateStore.set("activeSession", id)` → Chat feature re-renders

---

### 8g. Browser & Terminal Tabs
*Source: `handoff_report.md`*

**What it does:** Two new tabs in the right pane — a sandboxed web browser (via Tauri webview) and an interactive terminal (via Xterm.js + Node PTY).

| v4 Module | Type | Layer | Description |
|-----------|------|-------|-------------|
| `Browser.feature.js` | feature | 1 | Wraps a Tauri `<webview>` with URL bar, back/forward, security sandbox |
| `Terminal.feature.js` | feature | 1 | Wraps Xterm.js with connection to a Node PTY stream |
| `SpawnShell.workflow.js` | workflow | 3 | Already exists — refactor to stream PTY output via IPC events |
| `ListProcesses.workflow.js` | workflow | 3 | Already exists — shows running background processes |

**Primitives needed:** These features primarily use existing primitives (Panel, Toolbar, Button) plus two specialized wrappers that are too domain-specific to be generic primitives.

---

### 8h. Archetype & Hybrid Profile System
*Source: `analysis_results.md`, `handoff_report.md`*

**What it does:** A 3-tier inheritance chain for AI behavior: `Archetype` (system default) → `Profile` (user preference) → `Project Settings` (specific override). 9 archetypes already exist as JSON files in `data/archetypes/`.

| v4 Module | Type | Layer | Description |
|-----------|------|-------|-------------|
| `ProfileResolver.service.js` | service | 3 | Resolves final config by merging: archetype → profile → project settings |
| `archetypes.catalog.json` | data | — | Move from `data/archetypes/*.json` to a single catalog (or keep as individual files with a manifest index) |
| `ProfileManager.feature.js` | feature | 1 | Settings tab for creating/editing profiles and selecting archetypes |
| `profiles.schema.json` | data | — | Schema for the profile editor form |

**Existing archetypes (9):**
`artistic-savant`, `coding-super-hero`, `data-oracle`, `deep-thinking-research-assistant`, `empathetic-therapist`, `girl-next-door-naughty-neighbor-devils-advocate`, `meme-lord-chaos-agent`, `perfect-poet-coo`, `ruthless-strategist`

**Integration:**
- `Chat.workflow.js` calls `ProfileResolver.service.js` to get merged config before sending to LLM
- Project Manager modal includes archetype selector
- `ModelManager.feature.js` shows archetype → model mapping

---

### 8i. QMD Semantic Search & Indexing
*Source: `QmdAdapter.js`, `IngestWorkflow.js`, `QmdAdapter.ui.js`*

**What it does:** Uses `@tobilu/qmd` to build semantic indexes of project files. Enables natural-language file search and intelligent context selection.

**Status:** Optional dependency — gracefully degrades if missing. `IngestWorkflow.js` (83 lines) and `QmdAdapter.js` (109 lines) exist. `QmdAdapter.ui.js` (188 lines) provides frontend.

| v4 Module | Type | Layer | Description |
|-----------|------|-------|-------------|
| `QmdIndex.workflow.js` | workflow | 3 | Refactor of `IngestWorkflow.js` + `QmdAdapter.js` |
| `QmdSearch.adapter.js` | adapter | 3 | Refactor of `QmdAdapter.ui.js` — frontend search interface |
| `SemanticSearch.feature.js` | feature | 1 | Command palette (Ctrl+K) for semantic file search; composes Modal + Input + List |

**Integration:**
- `FileContext.workflow.js` uses QMD results to select the most relevant files for context
- Command palette shows ranked results with relevance scores
- Auto-indexes on file upload (already wired via `triggerIngest()`)

---

### 8j. Response Caching
*Source: `analysis_results.md`*

**What it does:** Caches LLM responses for repeated/similar queries to reduce API costs and latency.

| v4 Module | Type | Layer | Description |
|-----------|------|-------|-------------|
| `ResponseCache.service.js` | service | 3 | LRU cache keyed on (model + prompt hash); configurable TTL |
| `cache.settings.schema.json` | data | — | Settings for cache size, TTL, enable/disable per model |

**Integration:**
- `Chat.workflow.js` checks cache before calling LLM
- Cache hit → returns instantly with a `[cached]` badge in the UI
- Settings feature includes cache management (clear, size, TTL)

---

### 8k. System Prompt Injection (Project Rules)
*Source: `handoff_report.md`*

**What it does:** Project-specific "Rules & Standards" (set via Project Manager) are injected into the LLM's system prompt for every message in that project.

**Status:** The Project Manager UI already has a "Rules & Standards" tab with checkboxes and custom instructions textarea. The backend doesn't read them.

| v4 Module | Type | Layer | Description |
|-----------|------|-------|-------------|
| `ProjectRules.repository.js` | repository | 3 | Reads project-specific rules from `data/projects/[project]/.protoai-rules.json` |

**Integration:**
- `Chat.workflow.js` calls `ProjectRules.repository.js` and appends rules to `systemExtra`
- `ProjectManager.feature.js` writes rules via the repository
- Rules persist per-project and are immediately effective (no restart needed)

---

## Phase 9 — Infrastructure & Quality of Life

**Goal:** Cross-cutting improvements that benefit all features.

### 9a. Error Mapping & Actionable Traces
- Replace generic `IPC error: ...` messages with structured error objects
- Frontend shows actionable hints ("Check API key", "Model unavailable, try failover")
- `ResponseFormatter.service.js` standardizes all error shapes

### 9b. Token Usage Monitoring
- Track token consumption per model per session
- Display in sidebar or settings: "Used 12,340 / ∞ tokens today (free tier)"
- Warn when approaching rate limits

### 9c. History Compaction
- When conversation exceeds N messages, auto-summarize older messages
- Keeps recent messages verbatim, older ones as "Knowledge Snippets"
- Reduces API costs on long conversations

### 9d. Encrypted Vault for API Keys
- Migrate from plaintext `settings.json` to Tauri-native secret storage
- Keys encrypted at rest, decrypted only when needed for API calls

---

## Prior Plans Cross-Reference

| Prior Plan Document | Status | v4 Phase |
|---|---|---|
| `implementation_plan.md` — File Manager Redesign | ✅ Implemented (drag-drop, responsive) | Phase 4b (FileExplorer refactor) |
| `implementation_plan_intelligence.md` — Memory & Profiling | 🟡 Partially built (MemoryManager exists) | Phase 8a + 8b |
| `implementation_plan_intelligence.md` — Silent Partner Personas | 🔴 Not started | Phase 8b |
| `implementation_plan_intelligence.md` — Tools & Real-time Data | 🟡 DeepSearch exists | Phase 8 (covered by workflow refactors) |
| `google_drive_plan.md` — Google Drive Integration | 🟡 Partially built (workflow + UI exist) | Phase 8c |
| `analysis_results.md` — VFS Tier System | 🔴 Not started | Phase 8d |
| `analysis_results.md` — Archetype & Hybrid Profiles | 🟡 Archetypes exist as JSON, no resolution chain | Phase 8h |
| `analysis_results.md` — Response Caching | 🔴 Not started | Phase 8j |
| `handoff_report.md` — Multi-Session Chat UI | 🟡 Backend exists, UI missing | Phase 8f |
| `handoff_report.md` — Browser & Terminal Tabs | 🔴 Not started | Phase 8g |
| `handoff_report.md` — System Prompt Injection | 🔴 Not started (UI exists, backend doesn't read it) | Phase 8k |
| `handoff_report.md` — Sidebar Filtering (archived projects) | 🔴 Not started | Phase 4c (ProjectManager feature) |
| `SysProvisionBunWorkflow.js` — Bun Runtime | ✅ Implemented | Phase 8e (rename only) |
| `QmdAdapter.js` / `IngestWorkflow.js` — Semantic Search | 🟡 Built but optional/fragile | Phase 8i |

---

## Open Questions

> [!IMPORTANT]
> **Q1: Build step or runtime loading?**
> Do we add a simple concatenation build step for CSS/JS, or keep loading individual `<script>` tags? Runtime loading is simpler but means more HTTP requests during dev. A build step adds complexity but gives us a single bundle.

> [!IMPORTANT]
> **Q2: Schema validation?**
> Should we validate schemas at runtime (catches errors early but adds overhead) or trust them (faster but silent failures)?

> [!WARNING]
> **Q3: Migration order — frontend or backend first?**
> The plan currently does frontend first (Phases 1-4), then backend (Phase 5). An alternative is to do backend first since it's a single file and would immediately stabilize the IPC layer. Your preference?

> [!IMPORTANT]
> **Q4: Phase 8 priority order?**
> Phase 8 has 11 sub-features (8a–8k). Which ones should be tackled first? Recommended priority based on user impact:
> 1. **8h** Archetypes (foundation for personality)
> 2. **8a** Memory & Profiling (core intelligence)
> 3. **8f** Multi-Session Chat (most-requested UI gap)
> 4. **8d** VFS Tiers (context quality improvement)
> 5. **8k** System Prompt Injection (project rules)
> 6. **8b** Silent Partner Personas
> 7. **8c** Google Drive (already partially built)
> 8. **8i** QMD Semantic Search (already partially built)
> 9. **8j** Response Caching
> 10. **8g** Browser & Terminal
> 11. **8e** Bun (rename only)

---

## Verification Plan

### After Each Phase
1. Launch the app — no console errors on startup
2. Projects list loads and persists across refresh
3. Chat send/receive works
4. Settings open, edit, save, reload works
5. File upload via folder attach works
6. All previous phases still pass

### After Phase 8 (per sub-feature)
- **8a**: Chat about a topic → restart → Partner references it
- **8b**: Set Partner to "Comedian" → ticker shows jokes during response
- **8c**: Connect Drive → browse → import file → AI can reference it
- **8d**: Set file to Eager → always in context; set to Lazy → only when referenced
- **8f**: Create 3 sessions → switch between them → history is independent
- **8g**: Open Browser tab → navigate URL; Open Terminal tab → run command
- **8h**: Select archetype → chat style changes accordingly
- **8i**: Ctrl+K → type query → semantic results appear ranked
- **8j**: Ask same question twice → second response is instant with `[cached]` badge
- **8k**: Set project rule "Always respond in Spanish" → AI complies

### Final Acceptance
- `app.js` is under 100 lines
- No file exceeds 200 lines (except third-party libs)
- All state access goes through StateStore
- All backend calls go through auto-routing BackendConnector
- Adding a new settings field = adding JSON, zero JS
- Adding a new workflow = creating one `.workflow.js` file
- All 14 prior plan items from the cross-reference table are either ✅ Implemented or mapped to a specific v4 module
