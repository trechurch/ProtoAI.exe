# SDOA v4 — Service-Oriented Dispatcher Architecture
## The Authoritative Specification

**Version:** 4.0.0  
**Author:** ProtoAI Team  
**Date:** 2026-05-03  
**Status:** Canonical — All ProtoAI code MUST conform to this spec.

---

## 1. Philosophy

SDOA v4 is a **component-primitive architecture** for building modular, composable applications across the full stack (Browser UI → IPC Transport → Node.js Backend).

### Core Principles

1. **Build Once, Use Everywhere** — Every UI element is a *configured instance* of a generic primitive. A `Panel` module makes all panels. A `Button` module makes all buttons. Zero one-off components.

2. **Data Lives Outside Code** — Large datasets, UI schemas, model inventories, and configuration presets are stored in external `.json` files. Modules load them at runtime. Code stays lean and logic-only.

3. **Three Strict Layers** — Every operation flows through exactly three layers. No shortcuts, no layer-skipping.

4. **Declare, Don't Hard-Wire** — Modules declare their capabilities and dependencies in manifests. The system auto-discovers and auto-routes. Manual switch statements and hard-coded registrations are prohibited.

5. **Lifecycle Discipline** — Every module follows a strict lifecycle contract: `init → mount → update → unmount → destroy`. No ad-hoc initialization.

---

## 2. The Three Layers

```
┌─────────────────────────────────────────────────────┐
│  LAYER 1 — FEATURES (Composition & Intent)          │
│                                                     │
│  Feature modules compose primitives with schemas.   │
│  They define WHAT the user sees and WHICH behavior  │
│  profile to use. They never touch the DOM directly  │
│  or call the backend.                               │
│                                                     │
│  Files: ui/features/**/*.feature.js                 │
│  Data:  ui/data/**/*.schema.json                    │
├─────────────────────────────────────────────────────┤
│  LAYER 2 — PRIMITIVES (Reusable Atoms)              │
│                                                     │
│  Generic, behavior-agnostic UI building blocks.     │
│  They receive their personality from Layer 1 via    │
│  configuration objects. They own their own CSS.     │
│  They emit events but never subscribe to backend    │
│  state directly.                                    │
│                                                     │
│  Files: ui/primitives/**/*.prim.js                  │
│  Styles: ui/primitives/**/*.prim.css                │
├─────────────────────────────────────────────────────┤
│  LAYER 3 — ADAPTERS (Backend Contracts)             │
│                                                     │
│  All IPC calls, data fetching, state management,    │
│  and side effects live here. Features request data  │
│  through adapters. Adapters respond with            │
│  standardized Result objects.                       │
│                                                     │
│  Files: ui/adapters/**/*.adapter.js                 │
│         server/**/*.workflow.js                     │
│         server/access/**/*.repository.js            │
└─────────────────────────────────────────────────────┘
```

### Layer Rules

| Rule | Description |
|------|-------------|
| **L1 → L2 only** | Features call primitives. Never Layer 3. |
| **L2 → Events only** | Primitives emit events. They never call adapters or features. |
| **L3 ← L1 only** | Only features call adapters. Primitives are unaware of the backend. |
| **No layer skipping** | L1 never calls L3 repositories directly. L2 never calls L1. |
| **No circular deps** | If A depends on B, B must not depend on A. |

---

## 3. Module Anatomy

### 3.1 The v4 Manifest

Every SDOA v4 module — frontend or backend — carries a manifest at the top of the file:

```js
static MANIFEST = {
  // ── Identity ────────────────────────────────
  id:       "Button.prim",           // Unique module ID
  type:     "primitive",             // primitive | feature | adapter | service | repository
  layer:    2,                       // 1 = feature, 2 = primitive, 3 = adapter
  runtime:  "Browser",              // Browser | NodeJS | Universal
  version:  "4.0.0",

  // ── Dependencies ────────────────────────────
  requires: [],                      // Module IDs this module depends on
  dataFiles: [],                     // Paths to external data files loaded at runtime

  // ── Lifecycle ───────────────────────────────
  lifecycle: ["init", "mount", "update", "unmount", "destroy"],

  // ── Actions Surface ─────────────────────────
  actions: {
    commands:  {},                   // Named commands this module exposes
    events:    {},                   // Events this module emits
    accepts:   {},                   // Events this module listens to
    slots:     {},                   // Named content insertion points (for composition)
  },

  // ── Backend Contract (adapters only) ────────
  backendDeps: [],                   // [{ action, via, params }]

  // ── Documentation ───────────────────────────
  docs: {
    description: "",
    author: "ProtoAI team",
    sdoa: "4.0.0"
  }
};
```

### 3.2 Module Types

| Type | Layer | Suffix | Description |
|------|-------|--------|-------------|
| `primitive` | 2 | `.prim.js` | Generic, reusable UI atom (Button, Panel, Modal, Input, List, etc.) |
| `feature` | 1 | `.feature.js` | Composes primitives with schemas to build a complete screen/area |
| `adapter` | 3 | `.adapter.js` | Backend IPC, state management, data fetching |
| `service` | 3 | `.service.js` | Cross-cutting concerns (EventBus, StateStore, Router) |
| `workflow` | 3 | `.workflow.js` | Backend Node.js operation (replaces WorkflowBase subclasses) |
| `repository` | 3 | `.repository.js` | Data persistence (file system, database) |

### 3.3 Lifecycle Contract

Every UI module (primitives and features) MUST implement:

```js
class MyModule {
  // Called once when the module is first loaded.
  // Register event listeners, load data files.
  async init(config) {}

  // Called when the module's DOM is attached to the page.
  // Render initial state. Receives the container element.
  async mount(container) {}

  // Called when state changes that affect this module.
  // Re-render only what changed.
  async update(newState) {}

  // Called when the module's DOM is removed from the page.
  // Remove event listeners, cancel pending requests.
  async unmount() {}

  // Called once when the module is permanently destroyed.
  // Final cleanup.
  async destroy() {}
}
```

Backend modules (workflows, repositories) implement only:

```js
class MyWorkflow {
  async init(registry) {}    // Called once at server startup
  async run(payload) {}      // Called per-request
  async dispose() {}         // Called at server shutdown
}
```

---

## 4. The Primitive Catalog

### 4.1 UI Primitives (Layer 2)

Every visual element in ProtoAI maps to exactly one primitive:

| Primitive | File | Renders | Configuration |
|-----------|------|---------|---------------|
| **Button** | `Button.prim.js` | Any clickable action | `{ label, icon, variant, onClick, disabled, tooltip }` |
| **Input** | `Input.prim.js` | Text, password, number, textarea | `{ type, label, placeholder, value, onChange, validate }` |
| **Toggle** | `Toggle.prim.js` | On/off switches | `{ label, checked, onChange }` |
| **Select** | `Select.prim.js` | Dropdowns | `{ label, options, value, onChange }` |
| **Panel** | `Panel.prim.js` | Any bordered content area | `{ title, collapsible, actions, slots }` |
| **Modal** | `Modal.prim.js` | Any overlay dialog | `{ title, size, onClose, slots }` |
| **TabGroup** | `TabGroup.prim.js` | Any tabbed interface | `{ tabs: [{ id, label, content }], activeTab }` |
| **List** | `List.prim.js` | Any scrollable list | `{ items, renderItem, onSelect, emptyState }` |
| **Tree** | `Tree.prim.js` | Any hierarchical tree | `{ nodes, onExpand, onSelect, renderNode }` |
| **Form** | `Form.prim.js` | Any collection of inputs | `{ schema, values, onSubmit, onChange }` |
| **Toast** | `Toast.prim.js` | Notifications | `{ message, type, duration }` |
| **Badge** | `Badge.prim.js` | Status indicators, tags | `{ text, variant, icon }` |
| **Toolbar** | `Toolbar.prim.js` | Action bars | `{ items: [Button configs] }` |
| **EmptyState** | `EmptyState.prim.js` | "Nothing here" placeholders | `{ icon, title, hint, action }` |
| **ScrollMap** | `ScrollMap.prim.js` | Minimap scrollbars | `{ container, renderDot }` |
| **CodeEditor** | `CodeEditor.prim.js` | Monaco wrapper | `{ language, value, onChange, readOnly }` |
| **ContextMenu** | `ContextMenu.prim.js` | Right-click menus | `{ items, position }` |
| **Spinner** | `Spinner.prim.js` | Loading indicators | `{ size, label }` |
| **Markdown** | `Markdown.prim.js` | Rendered markdown | `{ content, allowHtml }` |

### 4.2 Backend Primitives (Layer 3)

| Primitive | File | Purpose |
|-----------|------|---------|
| **Router** | `Router.service.js` | Reads incoming IPC messages, dispatches to handlers |
| **WorkflowRunner** | `WorkflowRunner.service.js` | Executes workflows with middleware pipeline |
| **ResponseFormatter** | `ResponseFormatter.service.js` | Standardizes all response shapes |
| **Logger** | `Logger.service.js` | Structured logging with levels |

---

## 5. Declarative UI Schemas

### 5.1 Schema-Driven Rendering

Features do NOT hard-code their UI structure. Instead, they load a **schema file** that describes what to render, and feed it to the appropriate primitives.

Example — Settings feature:

```json
// ui/data/schemas/settings.schema.json
{
  "id": "settings",
  "primitive": "Modal",
  "config": {
    "title": "Settings",
    "size": "large"
  },
  "content": {
    "primitive": "TabGroup",
    "tabs": [
      {
        "id": "apiKeys",
        "label": "API Keys",
        "content": {
          "primitive": "Form",
          "schemaRef": "settings.apiKeys.form.json"
        }
      },
      {
        "id": "models",
        "label": "Models",
        "content": {
          "primitive": "Form",
          "schemaRef": "settings.models.form.json"
        }
      }
    ]
  }
}
```

```json
// ui/data/schemas/settings.apiKeys.form.json
{
  "fields": [
    {
      "id": "apiKey-anthropic",
      "primitive": "Input",
      "config": {
        "type": "password",
        "label": "Anthropic",
        "placeholder": "sk-ant-...",
        "testable": true,
        "testAction": "settings_test_key",
        "testParams": { "provider": "anthropic" }
      }
    },
    {
      "id": "apiKey-openrouter",
      "primitive": "Input",
      "config": {
        "type": "password",
        "label": "OpenRouter",
        "placeholder": "sk-or-...",
        "testable": true,
        "testAction": "settings_test_key",
        "testParams": { "provider": "openrouter" }
      }
    }
  ],
  "saveAction": "settings_set",
  "loadAction": "settings_get"
}
```

**Key benefit:** Adding a new API key provider = adding 10 lines of JSON. Zero JavaScript changes.

### 5.2 Data Files

All externalized data lives in the backend under `server/data/` and is fetched via SDOA workflows:

```text
src-tauri/resources/server/data/
  models.catalog.json        ← Model definitions and Archetypes
  settings.defaults.json     ← Global configuration defaults and extensions
  policy.defaults.json       ← LLM routing policy defaults
```

---

## 6. State Management

### 6.1 The StateStore

A single, centralized state store replaces all scattered `window.*` globals:

```js
// StateStore.adapter.js
class StateStore {
  static MANIFEST = {
    id: "StateStore",
    type: "service",
    layer: 3,
    ...
  };

  // State shape
  _state = {
    currentProject: "default",
    currentProfile: "default",
    backendStatus:  "connecting",
    attachedFiles:  [],
    settings:       {},
    policy:         {},
    projects:       [],
  };

  // Subscribe to changes on a specific key
  watch(key, handler) { ... }

  // Get current value
  get(key) { return this._state[key]; }

  // Update value — notifies all watchers
  set(key, value) {
    this._state[key] = value;
    this._notify(key, value);
    // Auto-persist to localStorage if configured
    if (this._persistKeys.has(key)) {
      localStorage.setItem(`protoai:${key}`, JSON.stringify(value));
    }
  }

  // Hydrate from localStorage on init
  async init() {
    for (const key of this._persistKeys) {
      const stored = localStorage.getItem(`protoai:${key}`);
      if (stored) this._state[key] = JSON.parse(stored);
    }
  }
}
```

### 6.2 State Flow

```
User action → Feature.handleX()
  → StateStore.set("currentProject", "myProject")
    → StateStore notifies all watchers
      → Feature A updates its primitives
      → Feature B updates its primitives
      → Adapter syncs to backend if needed
```

**No module ever reads `window.currentProject`.** All state access goes through `StateStore.get()` and `StateStore.watch()`.

---

## 7. Auto-Routing Backend Connector

### 7.1 Declaration-Based Routing

The `BackendConnector` adapter no longer uses a manual switch statement. Instead, it reads backend dependency declarations from all loaded modules and auto-generates its routing table:

```js
// BackendConnector.adapter.js
class BackendConnector {
  _routes = new Map();

  // Called during init — scans all module manifests
  buildRoutes(modules) {
    for (const mod of modules) {
      for (const dep of mod.MANIFEST.backendDeps || []) {
        this._routes.set(dep.action, {
          via: dep.via,             // Tauri command name
          params: dep.params || [],
          module: mod.MANIFEST.id
        });
      }
    }
  }

  // Universal dispatch — no switch needed
  async dispatch(action, payload) {
    const route = this._routes.get(action);
    if (!route) {
      // Fallback: try engine_ipc passthrough
      return this._invoke("engine_ipc", { msgType: action, payload });
    }
    return this._invoke(route.via, this._mapParams(route, payload));
  }
}
```

### 7.2 Backend Auto-Discovery

On the server side, `Router.service.js` consumes JSON-lines over `stdin` to drive dynamic workflow dispatching:

```js
// server/services/Router.service.js
const fs = require("fs");
const path = require("path");
const ResponseFormatter = require("./ResponseFormatter.service");
const Middleware = require("./Middleware.service");

class Router {
  constructor(registry, deps) {
    this.registry = registry;
    this.deps = deps;
    this._queue = [];
    
    // Express lane: Fast read-only message types that never block
    this._EXPRESS_TYPES = new Set([
        "projects", "history", "profiles", "settings",
        "list_files", "search_history", "list_processes",
        "vfs_list", "vfs_manifest", "vfs_permissions",
        "qmd_search", "qmd_index",
    ]);
  }

  startListening() {
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => {
        // Parse JSON lines and push to queue or express lane
        // ...
        this._drainQueue();
    });
  }

  async dispatchMessage(msg) {
    // 1. Fallback wrapper handlers for legacy IPC
    // 2. SDOA v4 dynamic workflow routing:
    const camelCaseType = msg.type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('');
    const possibleWfId = `${camelCaseType}.workflow`;
    
    if (this.registry.has(possibleWfId)) {
        return await this._runWorkflow(possibleWfId, msg.payload, true);
    }
  }
}
```

**Adding a new workflow = creating one file.** Dynamic routing automatically delegates. No manual switch statements required.

---

## 8. CSS Architecture

### 8.1 Co-Located Styles

Each primitive owns its own CSS file. Styles are scoped using a mandatory class prefix:

```css
/* Button.prim.css */
.sdoa-button { ... }
.sdoa-button--primary { ... }
.sdoa-button--ghost { ... }
.sdoa-button--icon { ... }
.sdoa-button:disabled { ... }
```

### 8.2 Design Tokens

A single `tokens.css` file defines all design tokens. Primitives reference tokens, never raw values:

```css
/* ui/tokens.css */
:root {
  /* Colors */
  --color-bg-base:       #0d0d0d;
  --color-bg-surface:    #1a1a2e;
  --color-bg-elevated:   #252540;
  --color-accent:        #7c3aed;
  --color-accent-dim:    rgba(124, 58, 237, 0.15);
  --color-text-primary:  #e0e0e0;
  --color-text-muted:    #888;
  --color-success:       #22c55e;
  --color-warning:       #eab308;
  --color-error:         #ef4444;

  /* Spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;

  /* Typography */
  --font-sans:  'Inter', system-ui, sans-serif;
  --font-mono:  'JetBrains Mono', monospace;
  --text-xs:    11px;
  --text-sm:    13px;
  --text-base:  14px;
  --text-lg:    16px;

  /* Borders & Radii */
  --radius-sm:  4px;
  --radius-md:  8px;
  --radius-lg:  12px;
  --border:     1px solid rgba(255,255,255,0.06);

  /* Shadows */
  --shadow-sm:  0 1px 3px rgba(0,0,0,0.3);
  --shadow-md:  0 4px 12px rgba(0,0,0,0.4);
  --shadow-lg:  0 8px 24px rgba(0,0,0,0.5);

  /* Transitions */
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-fast: 150ms;
  --duration-normal: 250ms;
}
```

### 8.3 Build Order

```html
<!-- tokens first, then primitives, then feature overrides -->
<link rel="stylesheet" href="/tokens.css" />
<link rel="stylesheet" href="/primitives/primitives.bundle.css" />
<link rel="stylesheet" href="/features/features.bundle.css" />
```

---

## 9. File Structure

### 9.1 Frontend

```
ui/
  index.html                     ← Minimal shell (just containers + script tags)
  tokens.css                     ← Design tokens only
  app.js                         ← Thin orchestrator (< 100 lines)

  primitives/                    ← Layer 2: Generic atoms
    Button/
      Button.prim.js
      Button.prim.css
    Input/
      Input.prim.js
      Input.prim.css
    Modal/
      Modal.prim.js
      Modal.prim.css
    Panel/
      Panel.prim.js
      Panel.prim.css
    TabGroup/
      TabGroup.prim.js
      TabGroup.prim.css
    List/
      List.prim.js
      List.prim.css
    Tree/
      Tree.prim.js
      Tree.prim.css
    Form/
      Form.prim.js
      Form.prim.css
    Toast/
      Toast.prim.js
      Toast.prim.css
    Badge/
      Badge.prim.js
      Badge.prim.css
    Toolbar/
      Toolbar.prim.js
      Toolbar.prim.css
    EmptyState/
      EmptyState.prim.js
      EmptyState.prim.css
    ScrollMap/
      ScrollMap.prim.js
      ScrollMap.prim.css
    ContextMenu/
      ContextMenu.prim.js
      ContextMenu.prim.css
    Spinner/
      Spinner.prim.js
      Spinner.prim.css
    Markdown/
      Markdown.prim.js
      Markdown.prim.css
    CodeEditor/
      CodeEditor.prim.js
      CodeEditor.prim.css

  features/                      ← Layer 1: Composed screens
    Chat/
      Chat.feature.js
    Settings/
      Settings.feature.js
    ProjectManager/
      ProjectManager.feature.js
    FileExplorer/
      FileExplorer.feature.js
    ModelManager/
      ModelManager.feature.js
    FirstRunWizard/
      FirstRunWizard.feature.js

  adapters/                      ← Layer 3: Backend contracts
    BackendConnector.adapter.js
    StateStore.adapter.js

  services/                      ← Cross-cutting
    EventBus.service.js
    Router.service.js

  data/                          ← Externalized data
    schemas/
    catalogs/
    defaults/

  lib/                           ← Third-party (Monaco, marked, etc.)
```

### 9.2 Backend

```
server/
  main.js                        ← Entry point (< 50 lines)
  Router.service.js              ← Auto-discovering message dispatcher
  Middleware.service.js           ← Logging, auth, rate limiting
  ResponseFormatter.service.js   ← Standardized response shapes

  workflows/                     ← Auto-discovered operations
    Chat.workflow.js
    Upload.workflow.js
    Ingest.workflow.js
    Projects.workflow.js
    History.workflow.js
    Profiles.workflow.js
    Settings.workflow.js
    GoogleDrive.workflow.js
    DeepSearch.workflow.js
    ImageGen.workflow.js
    AutoOptimize.workflow.js
    FileContext.workflow.js

  repositories/                  ← Data persistence
    Project.repository.js
    Profile.repository.js
    Memory.repository.js
    Vfs.repository.js
    Settings.repository.js

  access/                        ← External service adapters
    llm/
      OpenRouterAdapter.js
      LocalModelAdapter.js
    env/
      Paths.js

  data/                          ← Runtime data directory
    settings.json
    user-profile.json
    projects/
    logs/
```

### 9.3 Rust Layer (Unchanged)

The Rust layer (`src-tauri/src/`) remains a thin transport:
- `main.rs` — Tauri app setup
- `commands.rs` — Registered Tauri commands (auto-generated from manifests in future)
- `engine_bridge.rs` — Spawns and manages the Node sidecar
- `node_process_backend.rs` — JSON-line IPC protocol

---

## 10. Migration Strategy

### 10.1 Phased Approach

SDOA v4 is adopted incrementally. The app must remain functional after every phase.

| Phase | Scope | Risk |
|-------|-------|------|
| **Phase 0** | Write spec (this document). Create file structure skeleton. | None |
| **Phase 1** | Build core primitives: Button, Input, Panel, Modal, TabGroup, List, Form, Toast. | Low |
| **Phase 2** | Build StateStore + refactored BackendConnector with auto-routing. | Medium |
| **Phase 3** | Migrate Settings feature (largest, most complex UI). Proves the pattern works. | Medium |
| **Phase 4** | Migrate Chat, FileExplorer, ProjectManager features. | Medium |
| **Phase 5** | Decompose `server-ipc.cjs` into Router + auto-discovered workflows. | High |
| **Phase 6** | Externalize data (model catalogs, archetypes, extension lists). | Low |
| **Phase 7** | Extract `tokens.css` from `styles.css`. Co-locate primitive CSS. | Low |

### 10.2 Compatibility Rules

- v4 modules MUST be able to coexist with v3 modules during migration.
- v4 primitives expose themselves on `window.*` just like v3 modules (no breaking change).
- v3 `static MANIFEST` blocks are valid v4 manifests with missing fields defaulting to safe values.
- The `EventBus` bridge mechanism works identically in both versions.

---

## 11. Conventions & Standards

### 11.1 Naming

| Item | Convention | Example |
|------|-----------|---------|
| Primitive files | `PascalCase.prim.js` | `Button.prim.js` |
| Feature files | `PascalCase.feature.js` | `Settings.feature.js` |
| Adapter files | `PascalCase.adapter.js` | `BackendConnector.adapter.js` |
| Schema files | `kebab-case.schema.json` | `settings-api-keys.schema.json` |
| CSS class prefix | `sdoa-{primitive}` | `sdoa-button`, `sdoa-modal` |
| Event names | `module:action` | `backend:statusChanged` |
| State keys | `camelCase` | `currentProject`, `backendStatus` |

### 11.2 File Size Limits

| Type | Max Lines | Action if Exceeded |
|------|-----------|-------------------|
| Primitive | 150 | Split into sub-primitives |
| Feature | 200 | Extract logic into adapters or sub-features |
| Adapter | 200 | Split by concern |
| Workflow | 200 | Extract helpers into repositories |
| Schema | 100 fields | Split into sub-schemas with `$ref` |

### 11.3 Documentation

Every module file must include:
1. The v4 MANIFEST at the top
2. JSDoc on every public method
3. `// ── section name ──` comment blocks for logical sections

---

## 12. Version History

| Version | Date | Key Changes |
|---------|------|-------------|
| v1.0 | 2026-03 | Initial SDOA — WorkflowBase, WorkflowResult, WorkflowRegistry |
| v2.0 | 2026-04 | Added EventBus, module bridges, MANIFEST blocks |
| v3.0 | 2026-04 | Formalized 3-layer architecture, action surfaces, Tauri IPC mapping |
| v3.2 | 2026-05 | Added BackendConnector explicit routing, reconnect logic |
| **v4.0** | **2026-05** | **Primitive catalog, declarative schemas, StateStore, auto-routing, lifecycle contracts, CSS tokens, data externalization** |

---

## Appendix A: Quick Reference Card

```
Need a button?     → Button.prim.js + config object
Need a form?       → Form.prim.js + schema.json
Need a modal?      → Modal.prim.js + schema.json
Need a new screen? → Feature.feature.js composing primitives
Need backend data? → Adapter.adapter.js declaring backendDeps
Need new workflow? → Workflow.workflow.js (auto-discovered)
Need to share state? → StateStore.get() / .set() / .watch()
Need cross-module comms? → EventBus.emit() / .on()
```

## Appendix B: Anti-Patterns (PROHIBITED in v4)

| ❌ Anti-Pattern | ✅ v4 Replacement |
|----------------|-------------------|
| `window.currentProject = ...` | `StateStore.set("currentProject", ...)` |
| Manual switch in BackendConnector | Auto-routing from MANIFEST.backendDeps |
| Hand-coded HTML in index.html | Schema-driven rendering via Form/Panel primitives |
| 700+ line files | Split into primitive + feature + adapter |
| CSS in one giant file | Co-located `.prim.css` per primitive + `tokens.css` |
| `document.createElement` everywhere | Primitive's `mount(container)` lifecycle |
| Direct `window.__TAURI__.invoke()` | `BackendConnector.dispatch(action, payload)` |
| Hardcoded model lists in JS | `models.catalog.json` loaded at runtime |
| `setTimeout(_autoBridge, 500)` hacks | Lifecycle `init()` with proper async ordering |
