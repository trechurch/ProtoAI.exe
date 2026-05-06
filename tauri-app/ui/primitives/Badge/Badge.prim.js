// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// Badge.prim.js — SDOA v4 Primitive | v4.0.0 | layer 2
// Status indicators, tags, labels.
//
// Usage: const el = BadgePrim.create({ text: "Active", variant: "success" });
// ============================================================

(function () {
    "use strict";

    const MANIFEST = {
        id: "Badge.prim", type: "primitive", layer: 2,
        runtime: "Browser", version: "4.0.0",
        requires: [], dataFiles: [], lifecycle: [],
        actions: { commands: { create: { description: "Create a badge.", input: "BadgeConfig", output: "HTMLElement" } }, events: {}, accepts: {}, slots: {} },
        backendDeps: [],
        docs: { description: "Status badges, tags, and labels with variants.", author: "ProtoAI team", sdoa: "4.0.0" }
    };

    /**
     * @param {Object} config
     * @param {string} config.text      — Badge text
     * @param {string} [config.variant] — "default"|"success"|"warning"|"error"|"info"|"accent"
     * @param {string} [config.icon]    — Leading icon
     * @param {string} [config.size]    — "sm"|"md"
     * @param {boolean} [config.dot]    — Show as dot only (no text)
     * @param {string} [config.id]
     */
    function create(config = {}) {
        const el = document.createElement("span");
        const variant = config.variant || "default";
        const size = config.size || "sm";
        el.className = `sdoa-badge sdoa-badge--${variant} sdoa-badge--${size}`;
        if (config.dot) el.classList.add("sdoa-badge--dot");
        if (config.id) el.id = config.id;

        if (config.dot) return el;

        let html = "";
        if (config.icon) html += `<span class="sdoa-badge__icon">${config.icon}</span>`;
        html += config.text || "";
        el.innerHTML = html;

        el._sdoaUpdate = (newConfig) => {
            if (newConfig.text != null) el.innerHTML = newConfig.text;
            if (newConfig.variant) {
                el.className = `sdoa-badge sdoa-badge--${newConfig.variant} sdoa-badge--${size}`;
            }
        };

        return el;
    }

    window.BadgePrim = { MANIFEST, create };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { create });
})();
