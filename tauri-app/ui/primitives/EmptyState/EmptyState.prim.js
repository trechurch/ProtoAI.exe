// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// EmptyState.prim.js — SDOA v4 Primitive | v4.0.0 | layer 2
// "Nothing here" placeholder with icon, title, hint, and optional action button.
// Usage: const el = EmptyStatePrim.create({ icon: "📂", title: "No files", hint: "Upload some", action: { label: "Upload", onClick: fn } });
// ============================================================
(function () {
    "use strict";
    const MANIFEST = { id: "EmptyState.prim", type: "primitive", layer: 2, runtime: "Browser", version: "4.0.0", requires: [], dataFiles: [], lifecycle: [], actions: { commands: { create: {} }, events: {}, accepts: {}, slots: {} }, backendDeps: [], docs: { description: "Empty state placeholder with icon, title, hint, and action.", author: "ProtoAI team", sdoa: "4.0.0" } };

    function create(config = {}) {
        const el = document.createElement("div");
        el.className = "sdoa-empty-state";
        if (config.id) el.id = config.id;

        let html = "";
        if (config.icon)  html += `<div class="sdoa-empty-state__icon">${config.icon}</div>`;
        if (config.title) html += `<div class="sdoa-empty-state__title">${config.title}</div>`;
        if (config.hint)  html += `<div class="sdoa-empty-state__hint">${config.hint}</div>`;
        el.innerHTML = html;

        if (config.action) {
            const btn = window.ButtonPrim
                ? window.ButtonPrim.create({ label: config.action.label, variant: "secondary", size: "sm", onClick: config.action.onClick })
                : (() => { const b = document.createElement("button"); b.textContent = config.action.label; b.className = "sdoa-button sdoa-button--secondary sdoa-button--sm"; b.addEventListener("click", config.action.onClick); return b; })();
            el.appendChild(btn);
        }

        return el;
    }

    window.EmptyStatePrim = { MANIFEST, create };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { create });
})();
