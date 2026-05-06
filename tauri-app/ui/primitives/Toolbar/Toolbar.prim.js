// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// Toolbar.prim.js — SDOA v4 Primitive | v4.0.0 | layer 2
// Horizontal action bar composed of buttons.
// Usage: ToolbarPrim.create({ items: [{ label: "Save", icon: "💾", onClick: fn }] });
// ============================================================
(function () {
    "use strict";
    const MANIFEST = { id: "Toolbar.prim", type: "primitive", layer: 2, runtime: "Browser", version: "4.0.0", requires: ["Button.prim"], dataFiles: [], lifecycle: [], actions: { commands: { create: {} }, events: {}, accepts: {}, slots: {} }, backendDeps: [], docs: { description: "Horizontal action toolbar composed of Button primitives.", author: "ProtoAI team", sdoa: "4.0.0" } };

    /**
     * @param {Object}  config
     * @param {Array}   config.items   — Array of Button configs
     * @param {string}  [config.align] — "left"|"center"|"right"|"space-between"
     * @param {string}  [config.id]
     */
    function create(config = {}) {
        const bar = document.createElement("div");
        bar.className = "sdoa-toolbar";
        const align = config.align || "left";
        bar.style.justifyContent = align === "left" ? "flex-start" : align === "right" ? "flex-end" : align === "center" ? "center" : "space-between";
        if (config.id) bar.id = config.id;

        for (const item of (config.items || [])) {
            if (item.separator) {
                const sep = document.createElement("div");
                sep.className = "sdoa-toolbar__separator";
                bar.appendChild(sep);
                continue;
            }
            const btn = window.ButtonPrim
                ? window.ButtonPrim.create({ variant: "ghost", size: "sm", ...item })
                : (() => { const b = document.createElement("button"); b.textContent = item.label || item.icon || ""; b.addEventListener("click", item.onClick); return b; })();
            bar.appendChild(btn);
        }

        return bar;
    }

    window.ToolbarPrim = { MANIFEST, create };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { create });
})();
