// ============================================================
// Button.prim.js — SDOA v4 Primitive
// version: 4.0.0
// Last modified: 2026-05-04 03:11 UTC
// layer: 2 (primitive)
//
// Generic button primitive. Renders any clickable action.
// Configured via a config object — never subclassed.
//
// Usage:
//   const btn = Button.create({
//     label: "Save",
//     icon: "💾",
//     variant: "primary",
//     onClick: () => { ... },
//   });
//   container.appendChild(btn);
// ============================================================

(function () {
    "use strict";

    // ── SDOA v4 MANIFEST ─────────────────────────────────────
    const MANIFEST = {
        id:       "Button.prim",
        type:     "primitive",
        layer:    2,
        runtime:  "Browser",
        version:  "4.0.0",

        requires: [],
        dataFiles: [],

        lifecycle: [],

        actions: {
            commands: {
                create: {
                    description: "Create a button DOM element from config.",
                    input: { label: "string?", icon: "string?", variant: "string?", size: "string?", onClick: "fn?", disabled: "boolean?", tooltip: "string?", loading: "boolean?", id: "string?" },
                    output: "HTMLElement"
                },
            },
            events: {},
            accepts: {},
            slots: {},
        },

        backendDeps: [],

        docs: {
            description: "Generic button primitive. Supports primary, secondary, ghost, danger, icon-only variants. Handles loading states and tooltips.",
            author: "ProtoAI team",
            sdoa: "4.0.0"
        }
    };
    // ── end MANIFEST ─────────────────────────────────────────

    /**
     * Create a button element from a configuration object.
     *
     * @param {Object} config
     * @param {string}   [config.label]     — Button text
     * @param {string}   [config.icon]      — Emoji or icon character
     * @param {string}   [config.variant]   — "primary"|"secondary"|"ghost"|"danger"|"icon"
     * @param {string}   [config.size]      — "sm"|"md"|"lg"
     * @param {Function} [config.onClick]   — Click handler
     * @param {boolean}  [config.disabled]  — Disabled state
     * @param {string}   [config.tooltip]   — Title attribute
     * @param {boolean}  [config.loading]   — Show spinner + disable
     * @param {string}   [config.id]        — DOM id
     * @param {string}   [config.className] — Additional CSS class(es)
     * @returns {HTMLButtonElement}
     */
    function create(config = {}) {
        const btn = document.createElement("button");

        // ── Classes ──────────────────────────────────────────
        const variant = config.variant || "secondary";
        const size    = config.size    || "md";

        btn.className = `sdoa-button sdoa-button--${variant} sdoa-button--${size}`;
        if (config.className) btn.className += ` ${config.className}`;
        if (config.loading)   btn.classList.add("sdoa-button--loading");

        // ── Attributes ───────────────────────────────────────
        if (config.id)       btn.id = config.id;
        if (config.tooltip)  btn.title = config.tooltip;
        if (config.disabled || config.loading) btn.disabled = true;

        // ── Content ──────────────────────────────────────────
        _renderContent(btn, config);

        // ── Click handler ────────────────────────────────────
        if (typeof config.onClick === "function") {
            btn.addEventListener("click", (e) => {
                if (btn.disabled) return;
                config.onClick(e);
            });
        }

        // ── Update method (attached to the element) ──────────
        btn._sdoaUpdate = (newConfig) => {
            Object.assign(config, newConfig);

            btn.className = `sdoa-button sdoa-button--${newConfig.variant || variant} sdoa-button--${newConfig.size || size}`;
            if (newConfig.className) btn.className += ` ${newConfig.className}`;
            if (newConfig.loading)   btn.classList.add("sdoa-button--loading");

            btn.disabled = !!(newConfig.disabled || newConfig.loading);
            if (newConfig.tooltip) btn.title = newConfig.tooltip;

            _renderContent(btn, config);
        };

        return btn;
    }

    /**
     * Render button inner content (icon + label + spinner).
     */
    function _renderContent(btn, config) {
        let html = "";

        if (config.loading) {
            html += `<span class="sdoa-button__spinner"></span>`;
        }

        if (config.icon && !config.loading) {
            html += `<span class="sdoa-button__icon">${config.icon}</span>`;
        }

        if (config.label) {
            html += `<span class="sdoa-button__label">${config.label}</span>`;
        }

        btn.innerHTML = html;
    }

    // ── Export ────────────────────────────────────────────────
    window.ButtonPrim = { MANIFEST, create };

    // Register with ModuleLoader if available
    if (window.ModuleLoader) {
        window.ModuleLoader.register(MANIFEST, { create });
    }

})();
