// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// Spinner.prim.js — SDOA v4 Primitive | v4.0.0 | layer 2
// Loading indicator.
// Usage: const el = SpinnerPrim.create({ size: "md", label: "Loading..." });
// ============================================================
(function () {
    "use strict";
    const MANIFEST = { id: "Spinner.prim", type: "primitive", layer: 2, runtime: "Browser", version: "4.0.0", requires: [], dataFiles: [], lifecycle: [], actions: { commands: { create: {} }, events: {}, accepts: {}, slots: {} }, backendDeps: [], docs: { description: "Loading spinner with optional label.", author: "ProtoAI team", sdoa: "4.0.0" } };

    function create(config = {}) {
        const size = config.size || "md";
        const wrapper = document.createElement("div");
        wrapper.className = `sdoa-spinner sdoa-spinner--${size}`;
        if (config.id) wrapper.id = config.id;
        wrapper.innerHTML = `<div class="sdoa-spinner__ring"></div>`;
        if (config.label) wrapper.innerHTML += `<span class="sdoa-spinner__label">${config.label}</span>`;
        return wrapper;
    }

    window.SpinnerPrim = { MANIFEST, create };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { create });
})();
