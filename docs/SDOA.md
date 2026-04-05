# SDOA — Self-Describing Object Architecture

**Version:** 1.2.0
**Date:** March 2026

---

## 1. What is SDOA?

SDOA is an architectural pattern in which every object declares its own identity, dependencies, capabilities, documentation, and version directly inside its own definition.

The system (via a lightweight registry) automatically discovers, validates, and wires everything at startup. There are no central config files, no manual registration, and no hidden dependencies.

**SDOA is language-agnostic.** The core contract — MANIFEST + DOCS + version — is the same in every language. Each language provides its own mechanism for expressing it:

| Language | Mechanism |
|----------|-----------|
| Rust | `#[derive(SdoaEngine)]` macros + struct attributes |
| Node.js / JavaScript | Class static properties (`MANIFEST`, `DOCS`) |
| Python | Class-level attributes via metaclass injection |
| C/C++ | Macros or sidecar `.sdoa` manifest files |
| TypeScript | Decorators + class static properties |

The versioning engine adapts to whatever language the object is written in.

## 2. Core Philosophy

- Every object is self-describing.
- The code is the configuration and the documentation.
- Zero configuration drift, zero doc-code divergence.
- AI and humans can understand any module by reading only that single file.
- Adding or changing functionality requires touching only the affected file.
- **Languages are tools, not boundaries.** Rust, Node.js, Python, C++ — each is selected for what it does best, but all participate in the same registry, the same dependency graph, the same version report.

## 3. Supported Object Types

| Type | Purpose | Runtime | Typical Use Cases |
|------|---------|---------|-------------------|
| **Dashboard** | Full UI page or screen | Any (usually web-based) | Main screens, admin panels, orchestration views |
| **Service** | Shared business or data logic (no UI) | Any | Data access, calculators, connectors, orchestration |
| **Component** | Reusable UI building block | JS/TS (browser or server) | Cards, tables, charts, forms, modals |
| **Engine** | Complex stateless calculation logic | Rust/C++ (high perf), Node.js (general) | Pricing engines, recommendation engines, LLM routing |
| **Task** | Background, scheduled, or long-running work | Any | Batch jobs, report generators, sync workers |
| **Adapter** | Interface to external systems or formats | Any | File parsers, API clients, database drivers, IPC bridges |
| **Validator** | Self-describing validation rules & schemas | Any | Input validation, business rule enforcement, permission tiers |

**Language selection is not arbitrary** — it follows a tier model:
- **Rust** → Engine types (performance-critical, system-level, IPC commands)
- **Node.js** → Service and Task types (workflow orchestration, data transformation)
- **JavaScript/TypeScript** → Component types (browser UI, web rendering)
- **Python** → Engine/Service types (data science, ML, scripting)
- **C/C++** → Adapter types (hardware, legacy systems, low-level drivers)

## 4. Invisible Built-in Versioning

Versioning is automatic and language-specific:

Every SDOA object has `__version__` (or equivalent), plus `bump_patch()`, `bump_minor()`, `bump_major()` available through whatever mechanism the language provides:

- **Rust:** `impl Versioned for MyEngine { fn bump_patch(&mut self, note: &str) }`
- **Node.js:** Inherited from base class `SDOABase`
- **Python:** Injected via metaclass
- **C/C++:** Via the `V-CLI` tool that scans and rewrites source ASTs

The changelog synchronization with DOCS is automatic across all languages. A single `sdoa version report` produces a unified version table across the entire polyglot system.

## 5. Standard Structure for Every SDOA Object

### Rust
```rust
// SDOA v1.2 compliant — High-performance Engine
use sdoa_sdk::prelude::*;

#[derive(SdoaEngine)]
#[sdoa(
    name = "GlobalPriceEngine",
    version = "2.1.0",
    dependencies = ["CurrencyService"],
    docs = "Calculates real-time risk-adjusted pricing."
)]
pub struct PriceEngine;

impl PriceEngine {
    pub fn calculate(&self, base_price: f64) -> f64 {
        base_price * 1.15
    }
}
```

### Node.js
```javascript
// SDOA v1.2 compliant — Workflow Service
const { Service } = require('../base/sdoa-base.js');

class ChatWorkflow extends Service {
    static MANIFEST = {
        type: "Service",
        id: "ChatWorkflow",
        runtime: "NodeJS",
        version: "1.0.0",
        dependencies: ["EngineBridge", "ProfileService"],
        capabilities: ["chat", "context-resolution"]
    };

    static DOCS = {
        description: "Routes chat messages through the selected engine with context resolution",
        input: { message: "string", project: "string?", engine: "string?" },
        output: { response: "string", context: "array" },
        author: "ProtoAI team"
    };

    async run(payload) { /* ... */ }
}
```

### Python
```python
# SDOA v1.2 compliant — Data Service
from base import Service

class DataPipeline(Service):
    MANIFEST = {
        "id": "DataPipeline",
        "runtime": "Python",
        "version": "1.0.0",
        "dependencies": [],
    }

    DOCS = {
        "description": "ETL pipeline for raw data ingestion",
    }

    def run(self, input_data):
        pass
```

### C/C++
```cpp
// SDOA v1.2 compliant — Hardware Adapter
#include "sdoa_base.hpp"

class SerialPortDriver : public sdoa::Adapter {
    SDOA_MANIFEST({
        {"id", "HardwareAlpha"},
        {"version", "1.0.2"},
        {"dependencies", []},
        {"docs", "Low-level serial communication driver."}
    })

    void sync() {
        this->bump_patch("Synchronized hardware clock");
    }
};
```

## 6. The Registry

The registry is the one system component that must understand all languages. It:

1. **Scans** folders for SDOA objects (by file extension, macro markers, or sidecar manifests)
2. **Validates** every MANIFEST for required fields
3. **Resolves** the cross-language dependency graph
4. **Instantiates** objects in the correct runtime (fork Node, load Rust lib, etc.)
5. **Maintains** a unified version report across all languages
6. **Rejects** objects with missing/invalid manifests at startup — no silent failures

The registry itself can be written in any language — Rust is preferred for production (single binary, fast startup), Node.js for development (hot reload, easy debugging).

## 7. Folder Structure

```
project/
├── registry          # Language-agnostic registry (Rust preferred)
├── base/             # SDOA base classes per language
├── engines/          # Rust/C++/Python — computation-heavy logic
│   ├── llm_router.rs
│   └── pricing.py
├── services/         # Node.js/Python — orchestration, data logic
│   ├── ChatWorkflow.js
│   └── IngestWorkflow.js
├── components/       # JavaScript/TypeScript — UI building blocks
│   ├── FilePreview.js
│   └── BrowserPanel.js
├── adapters/         # Any language — external system interfaces
│   ├── TauriIPC.js
│   └── db_driver.cpp
├── validators/       # Any language — rules, schemas, permissions
│   └── PermissionValidator.js
└── dashboards/       # Any language — full UI pages
    └── AdminView.py
```

**Objects are organized by type, not by language.** The registry determines the runtime from the file extension.

## 8. Creation Process

1. Choose the correct base type from the table above.
2. Choose the language that best fits the job.
3. Create the file in the appropriate folder.
4. Add the MANIFEST and DOCS using your language's syntax.
5. Implement the required methods.
6. Save the file → registry auto-discovers it.

## 9. Implementation Rules

- No cross-language coupling. Dependencies are declared in MANIFEST and resolved by the registry — objects never import from another language's module directly.
- No circular dependencies across language boundaries.
- Dependencies declared only in the MANIFEST.
- Treat DOCS as the single source of truth.
- Use the versioning methods on every meaningful change.
- Keep the top-level entry point (app.py, main.rs, server.js) extremely thin — it should only bootstrap the registry.

## 10. Path to v2.0

SDOA v2.0 adds:

- **`.sdoa` sidecar files** for languages that can't embed manifests in source (C/C++, configs)
- **gRPC bridge** for cross-language IPC with structured error propagation
- **Hot-reload** — the registry detects file changes and re-instantiates individual objects without restarting the system
- **Universal Version CLI (`sdoa` command)** — cross-language AST rewriter that handles version bumps in any language
- **System Map** — a single command that produces a dependency/capability graph of the entire polyglot system

The transition from v1.2 to v2.0 is additive — no breaking changes to existing SDOA objects.
