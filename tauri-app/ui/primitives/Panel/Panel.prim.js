// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// Panel.prim.js — SDOA v4 Primitive
// version: 4.0.0 | layer: 2
//
// Generic bordered content area with optional title bar,
// collapse, and action buttons. Used for sidebar sections,
// right-pane sections, any grouped content.
//
// Usage:
//   const panel = PanelPrim.create({
//     title: "Files", collapsible: true,
//     actions: [{ icon: "🔄", tooltip: "Refresh", onClick: fn }],
//   });
//   panel._sdoaBody.appendChild(myContent);
// ============================================================

(function () {
    "use strict";

    const MANIFEST = {
        id: "Panel.prim", type: "primitive", layer: 2,
        runtime: "Browser", version: "4.0.0",
        requires: [], dataFiles: [], lifecycle: [],
        actions: {
            commands: { create: { description: "Create a panel element.", input: "PanelConfig", output: "HTMLElement" } },
            events: { "panel:toggled": { payload: "{ collapsed: boolean }" } },
            accepts: {}, slots: { header: "Content for the header area", body: "Main content area" },
        },
        backendDeps: [],
        docs: { description: "Generic panel primitive with optional title, collapse toggle, and action buttons.", author: "ProtoAI team", sdoa: "4.0.0" }
    };

    /**
     * @param {Object}   config
     * @param {string}   [config.title]       — Panel title
     * @param {boolean}  [config.collapsible]  — Show collapse toggle
     * @param {boolean}  [config.collapsed]    — Start collapsed
     * @param {Array}    [config.actions]      — [{icon, label, tooltip, onClick}]
     * @param {string}   [config.id]           — DOM id
     * @param {string}   [config.className]    — Additional class
     * @param {boolean}  [config.noPad]        — Remove body padding
     */
    function create(config = {}) {
        const panel = document.createElement("div");
        panel.className = "sdoa-panel";
        if (config.className) panel.className += ` ${config.className}`;
        if (config.id) panel.id = config.id;

        let collapsed = !!config.collapsed;

        // ── Header ───────────────────────────────────────────
        if (config.title || config.actions?.length) {
            const header = document.createElement("div");
            header.className = "sdoa-panel__header";

            // Collapse toggle + title
            const titleArea = document.createElement("div");
            titleArea.className = "sdoa-panel__title-area";

            if (config.collapsible) {
                const chevron = document.createElement("span");
                chevron.className = "sdoa-panel__chevron";
                chevron.textContent = "▸";
                titleArea.appendChild(chevron);
            }

            if (config.title) {
                const titleEl = document.createElement("span");
                titleEl.className = "sdoa-panel__title";
                titleEl.textContent = config.title;
                titleArea.appendChild(titleEl);
            }

            header.appendChild(titleArea);

            // Actions
            if (config.actions?.length) {
                const actionsBar = document.createElement("div");
                actionsBar.className = "sdoa-panel__actions";
                for (const action of config.actions) {
                    const btn = document.createElement("button");
                    btn.className = "sdoa-panel__action-btn";
                    btn.textContent = action.icon || action.label || "•";
                    if (action.tooltip) btn.title = action.tooltip;
                    if (typeof action.onClick === "function") {
                        btn.addEventListener("click", (e) => { e.stopPropagation(); action.onClick(e); });
                    }
                    actionsBar.appendChild(btn);
                }
                header.appendChild(actionsBar);
            }

            // Collapse click
            if (config.collapsible) {
                header.style.cursor = "pointer";
                header.addEventListener("click", () => {
                    collapsed = !collapsed;
                    _applyCollapse(panel, collapsed);
                });
            }

            panel.appendChild(header);
        }

        // ── Body ─────────────────────────────────────────────
        const body = document.createElement("div");
        body.className = "sdoa-panel__body";
        if (config.noPad) body.classList.add("sdoa-panel__body--no-pad");
        panel.appendChild(body);

        // Apply initial collapse
        if (collapsed) _applyCollapse(panel, true);

        // Public references
        panel._sdoaBody = body;
        panel._sdoaUpdate = (newConfig) => {
            if ("collapsed" in newConfig) {
                collapsed = newConfig.collapsed;
                _applyCollapse(panel, collapsed);
            }
        };

        return panel;
    }

    function _applyCollapse(panel, collapsed) {
        panel.classList.toggle("sdoa-panel--collapsed", collapsed);
        const chevron = panel.querySelector(".sdoa-panel__chevron");
        if (chevron) chevron.textContent = collapsed ? "▸" : "▾";
    }

    window.PanelPrim = { MANIFEST, create };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { create });
})();
