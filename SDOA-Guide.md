# SDOA — Service-Oriented Dispatcher Architecture
## A Complete Guide to Building Modular, Composable Applications

**Version:** 4.0  
**Status:** General Reference — Framework-Agnostic

---

## What Is SDOA?

SDOA is a **component-primitive architecture** for building modular, composable full-stack applications. It provides a strict, opinionated structure that governs how code is organized, how modules communicate, and how the UI and backend connect to each other.

The core promise: any developer who knows SDOA can open any SDOA-compliant project, understand it immediately, and begin contributing without an orientation session. Every module looks the same. Every operation flows the same way. Every file is exactly where you'd expect it to be.

SDOA is applicable to any project that has a UI layer, a backend layer, and an IPC or API transport between them.

---

## Part I — The Five Core Principles

Before writing a single line of code, internalize these five rules. Every SDOA decision flows from them.

### 1. Build Once, Use Everywhere

Every UI element is a *configured instance* of a generic primitive. A `Panel` module makes all panels. A `Button` module makes all buttons. You never write a one-off component for a specific screen. If you find yourself creating a bespoke "SettingsPanel" that isn't just a configured `Panel.prim.js`, you're violating this principle.

**Why it matters:** When you fix a bug in `Button.prim.js`, it's fixed everywhere. When a designer updates button spacing, they change one file. Without this principle, you're maintaining dozens of slightly-different copies.

### 2. Data Lives Outside Code

Large datasets, UI schemas, configuration presets, and model inventories belong in external `.json` files. Modules load them at runtime. Code contains logic; JSON contains data.

**Why it matters:** Adding a new settings field should never require touching JavaScript. Adding a new option to a dropdown should be a JSON edit. If changing a user-visible label requires a code deployment, your data is in the wrong place.

### 3. Three Strict Layers — No Shortcuts

Every operation flows through exactly three layers in a defined direction. There is no such thing as an "urgent" feature that justifies skipping a layer.

**Why it matters:** Layer-skipping is how monoliths are born. Once one module reaches across layers, others do too, and within months you have a tightly coupled system that no one can safely modify.

### 4. Declare, Don't Hard-Wire

Modules declare their capabilities and dependencies in a **manifest**. The system auto-discovers and auto-routes based on those declarations. Manual switch statements and hard-coded registrations are prohibited.

**Why it matters:** When you add a new workflow by creating a file, it just works. No one needs to register it. No one needs to know about it. The system finds it automatically. This is the difference between a system that scales gracefully and one that becomes a bottleneck at every new addition.

### 5. Lifecycle Discipline

Every module follows a strict lifecycle contract: `init → mount → update → unmount → destroy`. You never initialize a module by calling a function directly from a random event handler. You never tear one down by removing its container element and hoping for the best.

**Why it matters:** Memory leaks and ghost listeners accumulate when lifecycle is ad-hoc. Predictable lifecycle means predictable memory behavior and predictable test setup/teardown.

---

## Part II — The Three Layers

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

### Layer Traffic Rules

| Rule | Description |
|------|-------------|
| **L1 → L2 only** | Features call primitives. Features never call Layer 3 directly. |
| **L2 → Events only** | Primitives emit events. They never call adapters or features. |
| **L3 ← L1 only** | Only features call adapters. Primitives are unaware of the backend. |
| **No layer skipping** | L1 never calls L3 repositories directly. L2 never calls L1. |
| **No circular deps** | If module A depends on B, B must not depend on A. |

### Deciding Which Layer a Module Belongs To

Ask yourself these questions in order:

1. Does it render pixels on screen and have no business logic? → **Layer 2 (Primitive)**
2. Does it compose primitives to build a complete screen or area? → **Layer 1 (Feature)**
3. Does it talk to a server, database, or external service? → **Layer 3 (Adapter/Workflow/Repository)**

If your module does two of these things, split it.

---

## Part III — The Module Manifest

Every SDOA module — frontend or backend — carries a manifest at the top of its file. The manifest is the module's contract with the rest of the system. It enables auto-discovery, auto-routing, and self-documentation.

```js
static MANIFEST = {
  // ── Identity ────────────────────────────────────────────
  id:       "Button.prim",           // Unique module ID — no two modules share this
  type:     "primitive",             // See Module Types table below
  layer:    2,                       // 1 = feature, 2 = primitive, 3 = adapter/service
  runtime:  "Browser",              // Browser | NodeJS | Universal
  version:  "1.0.0",               // Incremented on every change (see Versioning)

  // ── Dependencies ────────────────────────────────────────
  requires:  [],                    // Module IDs this module depends on
  dataFiles: [],                    // Paths to external .json files loaded at runtime

  // ── Lifecycle ───────────────────────────────────────────
  lifecycle: ["init", "mount", "update", "unmount", "destroy"],

  // ── Actions Surface ─────────────────────────────────────
  actions: {
    commands: {},                   // Named commands this module exposes
    events:   {},                   // Events this module emits
    accepts:  {},                   // Events this module listens for
    slots:    {},                   // Named content insertion points (for composition)
  },

  // ── Backend Contract (adapters only) ────────────────────
  backendDeps: [],                  // [{ action, via, params }]
                                    // Declares which backend actions this module needs

  // ── Documentation ───────────────────────────────────────
  docs: {
    description: "",
    author: "",
    sdoa: "4.0.0"
  }
};
```

### Module Types

| Type | Layer | File Suffix | Description |
|------|-------|-------------|-------------|
| `primitive` | 2 | `.prim.js` | Generic, reusable UI atom (Button, Panel, Modal, Input, List, etc.) |
| `feature` | 1 | `.feature.js` | Composes primitives with schemas to build a complete screen or area |
| `adapter` | 3 | `.adapter.js` | Frontend IPC, state management, data fetching |
| `service` | 3 | `.service.js` | Cross-cutting concerns (EventBus, StateStore, Router) |
| `workflow` | 3 | `.workflow.js` | Backend operation — one file per operation type |
| `repository` | 3 | `.repository.js` | Data persistence (file system, database) |

---

## Part IV — The Lifecycle Contract

### Frontend Modules (Primitives and Features)

Every UI module must implement all five lifecycle methods:

```js
class MyModule {
  // Called once when the module is first loaded.
  // Register event listeners, load data files.
  // Do NOT touch the DOM here.
  async init(config) {}

  // Called when the module's DOM is attached to the page.
  // Render initial state. Receives the container element.
  async mount(container) {}

  // Called when state changes that affect this module.
  // Re-render only what changed. Avoid full re-renders.
  async update(newState) {}

  // Called when the module's DOM is removed from the page.
  // Remove event listeners, cancel pending requests.
  // Must undo everything done in mount().
  async unmount() {}

  // Called once when the module is permanently destroyed.
  // Final cleanup — release memory, close connections.
  // Must undo everything done in init().
  async destroy() {}
}
```

### Backend Modules (Workflows and Repositories)

Backend modules implement a simpler three-method contract:

```js
class MyWorkflow {
  async init(registry) {}    // Called once at server startup — register self, load deps
  async run(payload) {}      // Called per-request — execute the operation
  async dispose() {}         // Called at server shutdown — cleanup
}
```

### Common Lifecycle Mistakes

- Calling `mount()` before `init()` — initialization order must be respected
- Forgetting to remove event listeners in `unmount()` — causes ghost listeners and memory leaks
- Doing DOM work in `init()` — the container doesn't exist yet
- Calling `destroy()` without first calling `unmount()` — skips cleanup

---

## Part V — Primitives: The Atom Library

### What Is a Primitive?

A primitive is the smallest self-contained UI building block. It has no knowledge of your application's domain, no direct backend connections, and no hardcoded content. It only knows its configuration object.

A well-designed primitive is:
- **Generic** — works in any context with different configs
- **Self-contained** — owns its HTML, CSS, and behavior
- **Dumb** — receives data in, emits events out, never fetches its own data
- **Slim** — under 150 lines of code (if it's longer, split it)

### Designing Your Primitive Catalog

Every visual element in your application should map to exactly one primitive. Before writing any feature code, audit your application for repeated visual patterns and build a primitive for each one.

Common primitives that apply to almost any application:

| Primitive | Renders | Configuration Surface |
|-----------|---------|----------------------|
| **Button** | Any clickable action | `{ label, icon, variant, onClick, disabled, tooltip }` |
| **Input** | Text, password, number, textarea | `{ type, label, placeholder, value, onChange, validate }` |
| **Toggle** | On/off switches | `{ label, checked, onChange }` |
| **Select** | Dropdowns | `{ label, options, value, onChange }` |
| **Panel** | Any bordered content area | `{ title, collapsible, actions, slots }` |
| **Modal** | Any overlay dialog | `{ title, size, onClose, slots }` |
| **TabGroup** | Any tabbed interface | `{ tabs: [{ id, label, content }], activeTab }` |
| **List** | Any scrollable list | `{ items, renderItem, onSelect, emptyState }` |
| **Form** | Any collection of inputs | `{ schema, values, onSubmit, onChange }` |
| **Toast** | Notifications | `{ message, type, duration }` |
| **Badge** | Status indicators, tags | `{ text, variant, icon }` |
| **Toolbar** | Action bars | `{ items: [Button configs] }` |
| **EmptyState** | "Nothing here" placeholders | `{ icon, title, hint, action }` |
| **Spinner** | Loading indicators | `{ size, label }` |

This list is a starting point. Build primitives that reflect *your* application's visual vocabulary.

### A Minimal Primitive Example

```js
// ui/primitives/Button/Button.prim.js

class Button {
  static MANIFEST = {
    id:      "Button.prim",
    type:    "primitive",
    layer:   2,
    runtime: "Browser",
    version: "1.0.0",
    lifecycle: ["init", "mount", "update", "unmount", "destroy"],
    actions: {
      events: { click: "Fired when the button is clicked" }
    },
    docs: { description: "Generic clickable action element" }
  };

  // ── Lifecycle ────────────────────────────────────────────

  async init(config) {
    this._config = config;
    this._el = null;
  }

  async mount(container) {
    this._el = document.createElement("button");
    this._el.className = `sdoa-button sdoa-button--${this._config.variant || "primary"}`;
    this._el.textContent = this._config.label || "";
    this._el.disabled = !!this._config.disabled;
    this._el.addEventListener("click", this._handleClick.bind(this));
    container.appendChild(this._el);
  }

  async update(newConfig) {
    Object.assign(this._config, newConfig);
    if (this._el) {
      this._el.textContent = this._config.label;
      this._el.disabled = !!this._config.disabled;
    }
  }

  async unmount() {
    if (this._el) {
      this._el.removeEventListener("click", this._handleClick);
      this._el.remove();
      this._el = null;
    }
  }

  async destroy() {
    this._config = null;
  }

  // ── Private ──────────────────────────────────────────────

  _handleClick(e) {
    if (this._config.onClick) this._config.onClick(e);
  }
}
```

---

## Part VI — Features: Composing Primitives

A feature is a complete screen area or UI surface built by composing primitives with configuration and schema data. Features contain application logic; primitives do not.

### What a Feature Does

- Loads a schema from a `.json` file
- Creates and configures primitive instances from that schema
- Mounts primitives into its container element
- Subscribes to state changes and calls `primitive.update()` as needed
- Handles high-level user intent (e.g., "save settings") by calling adapters

### What a Feature Does NOT Do

- Directly create DOM elements (that's a primitive's job)
- Call backend endpoints or IPC (that's an adapter's job)
- Hard-code UI structure (that belongs in a schema file)
- Exceed 200 lines of code (if it does, extract a sub-feature or move logic to an adapter)

### A Minimal Feature Example

```js
// ui/features/UserSettings/UserSettings.feature.js

class UserSettings {
  static MANIFEST = {
    id:      "UserSettings.feature",
    type:    "feature",
    layer:   1,
    runtime: "Browser",
    version: "1.0.0",
    requires:  ["Modal.prim", "TabGroup.prim", "Form.prim"],
    dataFiles: ["data/schemas/user-settings.schema.json"],
    lifecycle: ["init", "mount", "update", "unmount", "destroy"],
    docs: { description: "User settings modal — composed from schema" }
  };

  async init(config) {
    this._schema = await fetch(this.MANIFEST.dataFiles[0]).then(r => r.json());
    this._modal = new Modal();
    this._tabs  = new TabGroup();
    await this._modal.init({ title: this._schema.title, size: "large" });
    await this._tabs.init({ tabs: this._schema.tabs });
  }

  async mount(container) {
    await this._modal.mount(container);
    await this._tabs.mount(this._modal.bodySlot);
  }

  async unmount() {
    await this._tabs.unmount();
    await this._modal.unmount();
  }

  async destroy() {
    await this._tabs.destroy();
    await this._modal.destroy();
  }
}
```

---

## Part VII — Declarative UI Schemas

### The Principle

Features do not hard-code their UI structure. Instead, they load a schema file that describes what to render, and feed it to the appropriate primitives. The schema is the single source of truth for a screen's structure.

### Schema Structure

```json
// ui/data/schemas/user-settings.schema.json
{
  "id": "user-settings",
  "primitive": "Modal",
  "config": {
    "title": "Settings",
    "size": "large"
  },
  "content": {
    "primitive": "TabGroup",
    "tabs": [
      {
        "id": "account",
        "label": "Account",
        "content": {
          "primitive": "Form",
          "schemaRef": "user-settings.account.form.json"
        }
      },
      {
        "id": "notifications",
        "label": "Notifications",
        "content": {
          "primitive": "Form",
          "schemaRef": "user-settings.notifications.form.json"
        }
      }
    ]
  }
}
```

```json
// ui/data/schemas/user-settings.account.form.json
{
  "fields": [
    {
      "id": "display-name",
      "primitive": "Input",
      "config": {
        "type": "text",
        "label": "Display Name",
        "placeholder": "Your name"
      }
    },
    {
      "id": "email",
      "primitive": "Input",
      "config": {
        "type": "email",
        "label": "Email Address"
      }
    }
  ],
  "saveAction": "user_update_account",
  "loadAction": "user_get_account"
}
```

**Key benefit:** Adding a new field to a form = adding one object to a JSON file. Zero JavaScript changes.

### When to Use Schema Files

Use a schema file whenever the UI structure is data, not logic. If someone could reasonably want to change the field order, add a field, or rename a label without touching application code, it belongs in a schema.

---

## Part VIII — State Management

### The StateStore

Replace all scattered global variables with a single, centralized state store. Nothing reads from or writes to global variables. All state access goes through `StateStore`.

```js
// ui/adapters/StateStore.adapter.js

class StateStore {
  static MANIFEST = {
    id:   "StateStore",
    type: "service",
    layer: 3,
    docs: { description: "Centralized application state with reactive subscriptions" }
  };

  _state = {};
  _watchers = new Map();
  _persistKeys = new Set();

  // Get current value for a key
  get(key) {
    return this._state[key];
  }

  // Set a value and notify all watchers
  set(key, value) {
    this._state[key] = value;
    this._notify(key, value);
    if (this._persistKeys.has(key)) {
      localStorage.setItem(`app:${key}`, JSON.stringify(value));
    }
  }

  // Subscribe to changes on a specific key
  watch(key, handler) {
    if (!this._watchers.has(key)) this._watchers.set(key, new Set());
    this._watchers.get(key).add(handler);
    return () => this._watchers.get(key).delete(handler); // returns unsubscribe fn
  }

  _notify(key, value) {
    (this._watchers.get(key) || []).forEach(fn => fn(value));
  }
}
```

### State Flow

```
User action → Feature.handleX()
  → StateStore.set("someKey", newValue)
    → StateStore notifies all watchers
      → Feature A calls primitive.update()
      → Feature B calls primitive.update()
      → Adapter syncs to backend if needed
```

### State Rules

- **Never use `window.*` as state.** Use `StateStore.set()` and `StateStore.get()`.
- **Modules subscribe in `init()`, unsubscribe in `destroy()`.** If you watch in init, you must unwatch in destroy or you'll leak.
- **StateStore does not call primitives directly.** Features watch state and call their own primitives.

---

## Part IX — The Backend Architecture

### Workflow Modules

Every backend operation is a standalone workflow module. There is no central dispatcher file with a switch statement. There is no registration step. Create the file, and the router finds it.

```js
// server/workflows/CreateItem.workflow.js

class CreateItemWorkflow {
  static MANIFEST = {
    id:          "CreateItem.workflow",
    type:        "workflow",
    layer:       3,
    runtime:     "NodeJS",
    version:     "1.0.0",
    messageType: "create_item",         // ← This is how the Router finds it
    docs: { description: "Creates a new item in the database" }
  };

  async init(registry) {
    this._repo = registry.get("Item.repository");
  }

  async run(payload) {
    const { name, type } = payload;
    if (!name) return { ok: false, error: "name is required" };
    const item = await this._repo.create({ name, type });
    return { ok: true, data: item };
  }

  async dispose() {}
}
```

### Auto-Discovering Router

The Router reads all `*.workflow.js` files, extracts their `MANIFEST.messageType`, and builds its routing table automatically:

```js
// server/Router.service.js

class Router {
  async init(workflowsDir) {
    const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith(".workflow.js"));
    for (const file of files) {
      const WorkflowClass = require(path.join(workflowsDir, file));
      const instance = new WorkflowClass();
      await instance.init(this._registry);
      this._routes.set(WorkflowClass.MANIFEST.messageType, instance);
    }
  }

  async dispatch(msgType, payload) {
    const workflow = this._routes.get(msgType);
    if (!workflow) return { ok: false, error: `Unknown message type: ${msgType}` };
    return workflow.run(payload);
  }
}
```

**Adding a new backend operation:** Create one file. Done.

### Standardized Responses

Every backend response uses the same shape. Clients never need to guess whether a response succeeded:

```js
// Every workflow returns this shape:
{ ok: true,  data: { ... } }      // Success
{ ok: false, error: "message" }   // Failure
```

### Repository Modules

Repositories handle data persistence. Workflows call repositories; workflows never touch the file system or database directly.

```js
// server/repositories/Item.repository.js

class ItemRepository {
  static MANIFEST = {
    id:      "Item.repository",
    type:    "repository",
    layer:   3,
    runtime: "NodeJS",
    version: "1.0.0",
    docs: { description: "Persists items to disk" }
  };

  async init() {
    this._dataPath = path.join(DATA_DIR, "items.json");
  }

  async create(item) {
    const items = await this._load();
    items.push({ id: uuid(), ...item, createdAt: new Date().toISOString() });
    await this._save(items);
    return items[items.length - 1];
  }

  async findAll() {
    return this._load();
  }

  async _load() {
    try { return JSON.parse(fs.readFileSync(this._dataPath, "utf8")); }
    catch { return []; }
  }

  async _save(items) {
    fs.writeFileSync(this._dataPath, JSON.stringify(items, null, 2));
  }
}
```

---

## Part X — CSS Architecture

### Co-Located Styles

Each primitive owns its own CSS file. The CSS lives in the same directory as the primitive's JavaScript. Styles are scoped using a mandatory `sdoa-{primitive}` class prefix.

```
ui/primitives/Button/
  Button.prim.js
  Button.prim.css    ← owns all button styles
```

```css
/* Button.prim.css */
.sdoa-button { ... }
.sdoa-button--primary { ... }
.sdoa-button--secondary { ... }
.sdoa-button--danger { ... }
.sdoa-button:disabled { ... }
```

**Why scoping matters:** Without the `sdoa-` prefix, any file in the codebase could accidentally style your primitive. The prefix creates a namespace that makes ownership clear.

### Design Tokens

A single `tokens.css` file defines all design tokens. Every primitive references tokens — never raw values.

```css
/* ui/tokens.css */
:root {
  /* Colors */
  --color-bg-base:      #ffffff;
  --color-bg-surface:   #f5f5f5;
  --color-accent:       #3b82f6;
  --color-text-primary: #111827;
  --color-text-muted:   #6b7280;
  --color-success:      #22c55e;
  --color-warning:      #eab308;
  --color-error:        #ef4444;

  /* Spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;

  /* Typography */
  --font-sans:  system-ui, sans-serif;
  --font-mono:  monospace;
  --text-sm:    13px;
  --text-base:  14px;
  --text-lg:    16px;

  /* Borders & Radii */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  /* Transitions */
  --duration-fast:   150ms;
  --duration-normal: 250ms;
  --ease-default:    cubic-bezier(0.4, 0, 0.2, 1);
}
```

A button never says `background: #3b82f6`. It says `background: var(--color-accent)`. When the designer changes the accent color, they change one line in `tokens.css` and every primitive updates.

### Load Order

```html
<!-- Always: tokens first, then primitives, then feature overrides -->
<link rel="stylesheet" href="/tokens.css" />
<link rel="stylesheet" href="/primitives/primitives.bundle.css" />
<link rel="stylesheet" href="/features/features.bundle.css" />
```

---

## Part XI — File Structure

```
project/
  ui/
    index.html                     ← Minimal shell (containers + script tags only)
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
      [one folder per primitive]

    features/                      ← Layer 1: Composed screens
      Dashboard/
        Dashboard.feature.js
      Settings/
        Settings.feature.js
      [one folder per screen/area]

    adapters/                      ← Layer 3: Backend contracts
      BackendConnector.adapter.js
      StateStore.adapter.js

    services/                      ← Cross-cutting frontend services
      EventBus.service.js

    data/                          ← Externalized data
      schemas/                     ← UI structure definitions
      catalogs/                    ← Reference data (options, types, models)
      defaults/                    ← Default configuration values

  server/
    main.js                        ← Entry point (< 50 lines)
    Router.service.js              ← Auto-discovering message dispatcher
    Middleware.service.js          ← Logging, auth, rate limiting
    ResponseFormatter.service.js   ← Standardized response shapes

    workflows/                     ← Auto-discovered operations
      [one file per operation]

    repositories/                  ← Data persistence
      [one file per entity]

    data/                          ← Runtime data directory
      [json files, user data, logs]
```

---

## Part XII — Naming Conventions

Consistent naming is how SDOA stays navigable at scale. These are not suggestions.

| Item | Convention | Example |
|------|-----------|---------|
| Primitive files | `PascalCase.prim.js` | `Button.prim.js` |
| Feature files | `PascalCase.feature.js` | `UserSettings.feature.js` |
| Adapter files | `PascalCase.adapter.js` | `BackendConnector.adapter.js` |
| Workflow files | `PascalCase.workflow.js` | `CreateItem.workflow.js` |
| Repository files | `PascalCase.repository.js` | `Item.repository.js` |
| Service files | `PascalCase.service.js` | `EventBus.service.js` |
| Schema files | `kebab-case.schema.json` | `user-settings.schema.json` |
| CSS class prefix | `sdoa-{primitive}` | `sdoa-button`, `sdoa-modal` |
| Event names | `module:action` | `backend:statusChanged` |
| State keys | `camelCase` | `currentUser`, `isLoading` |
| Module IDs | `Name.type` | `Button.prim`, `Settings.feature` |

---

## Part XIII — File Size Limits

File size is an objective measure of how well a module respects the principle of single responsibility. These limits are enforced, not guidelines.

| Module Type | Maximum Lines | Action if Exceeded |
|-------------|--------------|-------------------|
| Primitive | 150 | Split into sub-primitives |
| Feature | 200 | Extract logic into adapters or sub-features |
| Adapter | 200 | Split by concern |
| Workflow | 200 | Extract helpers into repositories |
| Repository | 150 | Split by entity type |
| Schema file | 100 fields | Split into sub-schemas with `$ref` |
| `app.js` | 100 | Extract to features and services |
| `main.js` (server) | 50 | Extract to Router and services |

If a file is growing beyond its limit, it's doing too many things. Split it first — don't raise the limit.

---

## Part XIV — The Implementation Protocol

The Implementation Protocol governs how SDOA work is done in practice — not just how the code is structured, but how collaboration with an AI system or teammate should operate.

### Gate 1 — Pending State for Ambiguous Input

When files are provided without accompanying instructions, do not act on them immediately. Enter a **Pending** state and wait for an explicit instruction signal (e.g., the `~` character). This prevents wasted work on assumptions that turn out to be wrong.

### Gate 2 — Atomic File Delivery

All code modifications must be delivered as **complete source files**. Partial snippets are prohibited. The reasoning: in an architecture where everything declares its dependencies and the system auto-discovers modules, a partial file can break discovery. A complete file is always safe to drop in.

### Gate 3 — Temporal Metadata Headers

Every file must begin with a standardized header:

```js
// ──────────────────────────────────────────────────────────────────
// File:    Button.prim.js
// Version: 1.0.05
// Updated: 2026-05-04T14:32:00Z
// Changes: Added `loading` variant; fixed disabled state cursor
// ──────────────────────────────────────────────────────────────────
```

This header is the audit trail. Anyone reading the file immediately knows whether it's current, what changed, and when.

### Gate 4 — Micro-Incrementation

Every alteration to a file requires a version increment. Use a three-part version with fine granularity: `major.minor.patch` where patch increments on every change (e.g., `1.0.04 → 1.0.05`). This creates a dense audit trail that helps trace when a regression was introduced.

### Gate 5 — Declarative Compliance

Before writing any code, verify the architectural placement. Ask: does this module comply with its layer rules? Does it declare all its dependencies? Does it follow the lifecycle contract? If the answer to any of these is "no," fix the architecture first — then write the code.

---

## Part XV — Adopting SDOA on an Existing Project

Migrating an existing codebase to SDOA should be done incrementally. The application must remain functional after every phase.

### The Migration Sequence

**Phase 0 — Audit and Foundation**
Create the directory skeleton. Write `tokens.css`. Write `StateStore`. Do not change any existing code. Verify nothing is broken.

**Phase 1 — Build Primitives**
Audit the existing UI for repeated patterns (forms, buttons, modals, lists). Build a primitive for each. Test each primitive in isolation with a `test/primitives.html` page. Still no changes to existing features.

**Phase 2 — Replace State Globals**
Migrate all `window.*` global state access to `StateStore`. Replace all localStorage direct access with StateStore's auto-persist mechanism. Verify application behavior is unchanged.

**Phase 3 — Migrate One Feature (Proof of Concept)**
Pick the most complex, most painful UI surface — typically a settings modal or dashboard. Migrate it fully to SDOA: feature file + schema files + primitives. This is your proof that the pattern works end-to-end. Don't proceed until this feature is fully working.

**Phase 4 — Migrate Remaining Features**
Migrate features one at a time. Slim down the main `app.js` as logic moves into feature modules. The goal is for `app.js` to eventually be a 100-line orchestrator that discovers and mounts features.

**Phase 5 — Backend Decomposition**
If you have a monolithic dispatcher (a large switch statement), replace it with the auto-discovering Router. Convert existing handlers into individual `*.workflow.js` files with manifests.

**Phase 6 — Data Externalization**
Move embedded datasets (option lists, catalogs, default configs) out of JavaScript into JSON files under `server/data/` or `ui/data/`.

**Phase 7 — CSS Extraction**
Extract the design tokens from your monolithic CSS into `tokens.css`. Co-locate each primitive's CSS with its JavaScript. Update load order.

### Compatibility During Migration

- New SDOA v4 modules can coexist with legacy modules during migration. Don't force a big-bang rewrite.
- Legacy modules remain functional alongside SDOA modules. Migrate incrementally.
- The EventBus pattern works identically in legacy and SDOA modules — use it to bridge the two during transition.

---

## Part XVI — Anti-Patterns Reference

Study this table. These are the mistakes SDOA was designed to prevent.

| ❌ Anti-Pattern | ✅ SDOA Replacement |
|----------------|---------------------|
| `window.currentUser = ...` | `StateStore.set("currentUser", ...)` |
| Manual switch/case in a dispatcher | Auto-routing from `MANIFEST.messageType` |
| Hard-coded HTML in app shell | Schema-driven rendering via Form/Panel/Modal primitives |
| Files over 200–300 lines | Split into primitive + feature + adapter by concern |
| CSS in one giant file | Co-located `.prim.css` per primitive + `tokens.css` tokens |
| `document.createElement` throughout features | Primitive's `mount(container)` lifecycle method |
| Direct API calls from UI components | `BackendConnector.dispatch(action, payload)` |
| Hardcoded option lists in JavaScript | External `.catalog.json` loaded at runtime |
| `setTimeout(init, 500)` hacks | Proper `async init()` with `await` and lifecycle ordering |
| One-off bespoke components per screen | Configured instances of generic primitives |
| State in local component variables | `StateStore.get()` / `.set()` / `.watch()` |
| Event listeners never removed | `unmount()` cleans up everything `mount()` did |

---

## Part XVII — Quick Reference

```
Need a button?            → Button.prim.js + config object
Need a form?              → Form.prim.js + schema.json
Need a modal?             → Modal.prim.js + schema.json
Need a new screen?        → NewScreen.feature.js composing primitives
Need to call the backend? → Adapter.adapter.js with backendDeps in MANIFEST
Need a new operation?     → NewOperation.workflow.js (auto-discovered)
Need to share state?      → StateStore.get() / .set() / .watch()
Need cross-module comms?  → EventBus.emit() / .on()
Need to add a form field? → Add JSON to schema file — no JS changes
Need to add a data option? → Add to the relevant .catalog.json file
```

### Module Decision Tree

```
Does it render pixels?
  └─ No → Backend module (Layer 3)
       ├─ Handles one IPC message type → Workflow
       ├─ Reads/writes persistent data → Repository
       └─ Cross-cutting server concern → Service

  └─ Yes → Frontend module
       ├─ Generic, reusable, behavior-agnostic → Primitive (Layer 2)
       └─ Specific screen/area, composes primitives → Feature (Layer 1)
```

---

## Summary

SDOA works because it makes the right way the easy way. When the pattern is clear, developers stop debating where code should go — they just follow the layer rules, write the manifest, and implement the lifecycle methods. The system auto-discovers everything. New workflows appear without registration. New form fields appear without JavaScript. New primitives compose into new features without touching existing code.

The discipline SDOA requires — strict layers, file size limits, declarative manifests, co-located styles, externalized data — pays compound returns over time. The codebase doesn't degrade as it grows. Every new module makes the system more capable without making it harder to understand.

That is the goal: a codebase where adding the hundredth feature is just as clean as adding the first.
