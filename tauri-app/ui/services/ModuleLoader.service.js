// ============================================================
// ModuleLoader.service.js — SDOA v4 Module Discovery & Lifecycle
// version: 4.0.0
// Last modified: 2026-05-04 03:11 UTC
// layer: 3 (service)
//
// Discovers all v4 modules, validates manifests, and orchestrates
// the init → mount lifecycle in dependency order.
//
// Modules register themselves via ModuleLoader.register(manifest, instance).
// The loader resolves the dependency graph and calls lifecycle
// methods in the correct order.
// ============================================================

(function () {
    "use strict";

    // ── SDOA v4 MANIFEST ─────────────────────────────────────
    const MANIFEST = {
        id:       "ModuleLoader",
        type:     "service",
        layer:    3,
        runtime:  "Browser",
        version:  "4.0.0",

        requires: [],
        dataFiles: [],

        lifecycle: ["init"],

        actions: {
            commands: {
                register:   { description: "Register a module with its manifest and instance.",  input: { manifest: "object", instance: "object" }, output: "void" },
                initAll:    { description: "Initialize all registered modules in dependency order.", input: {}, output: "Promise<void>" },
                mountAll:   { description: "Mount all initialized modules.",                     input: { containers: "object" }, output: "Promise<void>" },
                getModule:  { description: "Get a registered module instance by ID.",            input: { id: "string" }, output: "object|null" },
                listAll:    { description: "List all registered module manifests.",               input: {}, output: "object[]" },
            },
            events: {
                "module:registered":  { payload: "{ id, type, layer }" },
                "module:initialized": { payload: "{ id }" },
                "module:mounted":     { payload: "{ id }" },
                "module:error":       { payload: "{ id, phase, error }" },
            },
            accepts: {},
            slots: {},
        },

        backendDeps: [],

        docs: {
            description: "Discovers, validates, and orchestrates the lifecycle of all SDOA v4 modules. Resolves dependency graphs and calls init/mount in order.",
            author: "ProtoAI team",
            sdoa: "4.0.0"
        }
    };
    // ── end MANIFEST ─────────────────────────────────────────

    // ── Internal registry ────────────────────────────────────
    const _modules = new Map();  // id → { manifest, instance, state }
    // state: "registered" | "initialized" | "mounted" | "error"

    // ── register ─────────────────────────────────────────────
    function register(manifest, instance) {
        if (!manifest?.id) {
            console.error("[ModuleLoader] Cannot register module without manifest.id");
            return;
        }

        if (_modules.has(manifest.id)) {
            console.warn(`[ModuleLoader] Module "${manifest.id}" already registered. Skipping.`);
            return;
        }

        // Validate required manifest fields
        const validated = {
            id:       manifest.id,
            type:     manifest.type     || "unknown",
            layer:    manifest.layer    || 0,
            version:  manifest.version  || "0.0.0",
            requires: manifest.requires || [],
            lifecycle: manifest.lifecycle || [],
            actions:  manifest.actions  || {},
            backendDeps: manifest.backendDeps || [],
        };

        _modules.set(manifest.id, {
            manifest: validated,
            instance,
            state: "registered",
        });

        if (window.EventBus) {
            window.EventBus.emit("module:registered", {
                id: validated.id,
                type: validated.type,
                layer: validated.layer,
            });
        }
    }

    // ── _resolveDependencyOrder ───────────────────────────────
    // Topological sort of modules based on `requires` field.
    function _resolveDependencyOrder() {
        const sorted   = [];
        const visited  = new Set();
        const visiting = new Set();

        function visit(id) {
            if (visited.has(id)) return;
            if (visiting.has(id)) {
                console.error(`[ModuleLoader] Circular dependency detected: ${id}`);
                return;
            }

            visiting.add(id);
            const mod = _modules.get(id);
            if (mod) {
                for (const dep of mod.manifest.requires) {
                    visit(dep);
                }
            }
            visiting.delete(id);
            visited.add(id);
            if (mod) sorted.push(id);
        }

        for (const id of _modules.keys()) {
            visit(id);
        }

        return sorted;
    }

    // ── initAll ──────────────────────────────────────────────
    async function initAll() {
        const order = _resolveDependencyOrder();
        console.log(`[ModuleLoader] Initializing ${order.length} modules in order:`, order);

        for (const id of order) {
            const mod = _modules.get(id);
            if (!mod || mod.state !== "registered") continue;

            try {
                if (typeof mod.instance.init === "function") {
                    await mod.instance.init();
                }
                mod.state = "initialized";

                if (window.EventBus) {
                    window.EventBus.emit("module:initialized", { id });
                }
            } catch (err) {
                mod.state = "error";
                console.error(`[ModuleLoader] Failed to init "${id}":`, err);

                if (window.EventBus) {
                    window.EventBus.emit("module:error", { id, phase: "init", error: err.message });
                }
            }
        }
    }

    // ── mountAll ─────────────────────────────────────────────
    // containers: { moduleId: HTMLElement, ... }
    async function mountAll(containers = {}) {
        for (const [id, mod] of _modules) {
            if (mod.state !== "initialized") continue;

            const container = containers[id] || null;

            try {
                if (typeof mod.instance.mount === "function") {
                    await mod.instance.mount(container);
                }
                mod.state = "mounted";

                if (window.EventBus) {
                    window.EventBus.emit("module:mounted", { id });
                }
            } catch (err) {
                mod.state = "error";
                console.error(`[ModuleLoader] Failed to mount "${id}":`, err);

                if (window.EventBus) {
                    window.EventBus.emit("module:error", { id, phase: "mount", error: err.message });
                }
            }
        }
    }

    // ── getModule ────────────────────────────────────────────
    function getModule(id) {
        return _modules.get(id)?.instance || null;
    }

    // ── listAll ──────────────────────────────────────────────
    function listAll() {
        return [..._modules.values()].map(m => ({
            id:    m.manifest.id,
            type:  m.manifest.type,
            layer: m.manifest.layer,
            state: m.state,
        }));
    }

    // ── collectBackendDeps ───────────────────────────────────
    // Aggregates all backendDeps from all registered modules.
    // Used by BackendConnector to auto-build its routing table.
    function collectBackendDeps() {
        const deps = [];
        for (const [id, mod] of _modules) {
            for (const dep of mod.manifest.backendDeps || []) {
                deps.push({ ...dep, sourceModule: id });
            }
        }
        return deps;
    }

    // ── Export ────────────────────────────────────────────────
    window.ModuleLoader = {
        MANIFEST,
        register,
        initAll,
        mountAll,
        getModule,
        listAll,
        collectBackendDeps,
    };

})();
