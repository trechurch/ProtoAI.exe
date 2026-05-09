/* ============================================================
   ModuleLoader.service.js — SDOA v4 System Conductor
   version: 4.1.0
   Last modified: 2026-05-09 04:02 UTC
   ============================================================ */

(function () {
    "use strict";

    const MANIFEST = {
        id:       "ModuleLoader",
        type:     "service",
        layer:    3,
        runtime:  "Browser",
        version:  "4.1.0",
        requires: [],
        lifecycle: ["init"],
        docs: {
            description: "Orchestrates the discovery, validation, and lifecycle of all SDOA modules. Acts as the system conductor for health and diagnostics.",
            author: "ProtoAI Team"
        }
    };

    // ── Internal Registry ────────────────────────────────────
    const _modules = new Map();  // id → { manifest, instance, state, health }
    // state: "registered" | "initialized" | "mounted" | "error"
    // health: "healthy" | "stalled" | "degraded" | "failed"

    // ── Registration ─────────────────────────────────────────
    function register(manifest, instance) {
        if (!manifest?.id) {
            console.error("[Conductor] Cannot register anonymous module.");
            return;
        }

        if (_modules.has(manifest.id)) {
            console.warn(`[Conductor] Module "${manifest.id}" already active. skipping.`);
            return;
        }

        const validated = {
            id:       manifest.id,
            type:     manifest.type     || "unknown",
            layer:    manifest.layer    || 0,
            version:  manifest.version  || "0.0.0",
            requires: manifest.requires || manifest.dependencies || [],
            lifecycle: manifest.lifecycle || [],
        };

        _modules.set(manifest.id, {
            manifest: validated,
            instance,
            state: "registered",
            health: "healthy"
        });

        window.EventBus?.emit("module:registered", { id: validated.id, layer: validated.layer });
    }

    // ── Boot Sequence ────────────────────────────────────────
    
    async function initAll() {
        const order = _resolveDependencyOrder();
        console.log(`[Conductor] Starting boot sequence for ${order.length} modules...`);

        for (const id of order) {
            const mod = _modules.get(id);
            if (!mod || mod.state !== "registered") continue;

            try {
                if (typeof mod.instance.init === "function") {
                    console.log(`[Conductor] Initializing Layer ${mod.manifest.layer} -> ${id}`);
                    await mod.instance.init();
                }
                mod.state = "initialized";
                window.EventBus?.emit("module:initialized", { id });
            } catch (err) {
                mod.state = "error";
                mod.health = "failed";
                console.error(`[Conductor] Initialization FAILED for "${id}":`, err);
                window.EventBus?.emit("module:error", { id, phase: "init", error: err.message });
            }
        }
    }

    async function mountAll(containers = {}) {
        console.log("[Conductor] Mounting UI features...");
        for (const [id, mod] of _modules) {
            if (mod.state !== "initialized") continue;

            const container = containers[id] || null;

            try {
                if (typeof mod.instance.mount === "function") {
                    await mod.instance.mount(container);
                }
                mod.state = "mounted";
                window.EventBus?.emit("module:mounted", { id });
            } catch (err) {
                mod.state = "error";
                mod.health = "degraded";
                console.error(`[Conductor] Mounting FAILED for "${id}":`, err);
                window.EventBus?.emit("module:error", { id, phase: "mount", error: err.message });
            }
        }
    }

    // ── Diagnostics ──────────────────────────────────────────

    function diagnose() {
        console.group("%c ProtoAI SDOA v4 System Diagnostic ", "background: #4f8cff; color: #fff; font-weight: bold; padding: 4px; border-radius: 4px;");
        
        const report = [];
        let healthyCount = 0;

        _modules.forEach((mod, id) => {
            const isHealthy = mod.state === "mounted" || (mod.state === "initialized" && mod.manifest.type === "service");
            if (isHealthy) healthyCount++;
            
            report.push({
                Module: id,
                Layer: mod.manifest.layer,
                State: mod.state.toUpperCase(),
                Health: isHealthy ? "✅ OK" : "❌ " + mod.health.toUpperCase(),
                Version: mod.manifest.version
            });
        });

        console.table(report);
        
        const status = healthyCount === _modules.size ? "SYSTEM STABLE" : "SYSTEM DEGRADED";
        const color  = healthyCount === _modules.size ? "#4caf50" : "#f97373";
        
        console.log(`%c ${status}: ${healthyCount}/${_modules.size} modules active `, `color: ${color}; font-weight: bold; border: 1px solid ${color}; padding: 2px;`);
        console.groupEnd();
        
        return {
            stable: healthyCount === _modules.size,
            activeCount: healthyCount,
            totalCount: _modules.size,
            report
        };
    }

    // ── Internal Helpers ─────────────────────────────────────

    function _resolveDependencyOrder() {
        const sorted   = [];
        const visited  = new Set();
        const visiting = new Set();

        function visit(id) {
            if (visited.has(id)) return;
            if (visiting.has(id)) throw new Error(`Circular dependency: ${id}`);

            visiting.add(id);
            const mod = _modules.get(id);
            if (mod) {
                const deps = mod.manifest.requires || [];
                for (const dep of deps) {
                    if (_modules.has(dep)) visit(dep);
                }
            }
            visiting.delete(id);
            visited.add(id);
            if (mod) sorted.push(id);
        }

        // Sort primarily by layer (0 -> 3), then by internal dependencies
        const allIds = Array.from(_modules.keys()).sort((a, b) => {
            return (_modules.get(a).manifest.layer || 0) - (_modules.get(b).manifest.layer || 0);
        });

        for (const id of allIds) {
            visit(id);
        }

        return sorted;
    }

    // ── Export ────────────────────────────────────────────────
    window.ModuleLoader = {
        MANIFEST,
        register,
        initAll,
        mountAll,
        getModule: (id) => _modules.get(id)?.instance || null,
        listAll: () => Array.from(_modules.values()).map(m => m.manifest),
        diagnose
    };

    // Global conductor alias
    window.ProtoAI = { diagnose };

})();

