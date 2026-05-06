// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// TabGroup.prim.js — SDOA v4 Primitive
// version: 4.0.0 | layer: 2
//
// Generic tabbed interface. Renders a tab bar and swaps
// content panels. Used for Settings nav, right pane modes,
// ProjectManager tabs, etc.
//
// Usage:
//   const tabs = TabGroupPrim.create({
//     tabs: [
//       { id: "general", label: "General" },
//       { id: "api",     label: "API Keys", icon: "🔑" },
//     ],
//     activeTab: "general",
//     onTabChange: (tabId) => { ... },
//     renderTab: (tabId, container) => { ... },
//   });
// ============================================================

(function () {
    "use strict";

    const MANIFEST = {
        id: "TabGroup.prim", type: "primitive", layer: 2,
        runtime: "Browser", version: "4.0.0",
        requires: [], dataFiles: [], lifecycle: [],
        actions: {
            commands: { create: { description: "Create a tab group.", input: "TabGroupConfig", output: "HTMLElement" } },
            events: { "tab:changed": { payload: "{ tabId, prevTabId }" } },
            accepts: {}, slots: {},
        },
        backendDeps: [],
        docs: { description: "Generic tabbed interface. Renders tab bar and content panels, handles switching.", author: "ProtoAI team", sdoa: "4.0.0" }
    };

    /**
     * @param {Object}   config
     * @param {Array}    config.tabs         — [{ id, label, icon?, badge?, disabled? }]
     * @param {string}   [config.activeTab]  — Initial active tab id
     * @param {Function} [config.onTabChange] — Called with (tabId, prevTabId)
     * @param {Function} [config.renderTab]  — Called with (tabId, containerEl) to fill content
     * @param {string}   [config.variant]    — "horizontal"|"vertical" (default horizontal)
     * @param {string}   [config.size]       — "sm"|"md" (default md)
     * @param {string}   [config.id]         — DOM id
     */
    function create(config = {}) {
        const variant = config.variant || "horizontal";
        const size = config.size || "md";

        const wrapper = document.createElement("div");
        wrapper.className = `sdoa-tabgroup sdoa-tabgroup--${variant} sdoa-tabgroup--${size}`;
        if (config.id) wrapper.id = config.id;

        let activeTab = config.activeTab || config.tabs?.[0]?.id || null;
        const _contentCache = new Map();

        // ── Tab Bar ──────────────────────────────────────────
        const bar = document.createElement("div");
        bar.className = "sdoa-tabgroup__bar";
        bar.setAttribute("role", "tablist");

        for (const tab of (config.tabs || [])) {
            const btn = document.createElement("button");
            btn.className = "sdoa-tabgroup__tab";
            btn.setAttribute("role", "tab");
            btn.setAttribute("data-tab-id", tab.id);
            if (tab.disabled) btn.disabled = true;

            let html = "";
            if (tab.icon) html += `<span class="sdoa-tabgroup__tab-icon">${tab.icon}</span>`;
            html += `<span class="sdoa-tabgroup__tab-label">${tab.label}</span>`;
            if (tab.badge) html += `<span class="sdoa-tabgroup__tab-badge">${tab.badge}</span>`;
            btn.innerHTML = html;

            if (tab.id === activeTab) btn.classList.add("sdoa-tabgroup__tab--active");

            btn.addEventListener("click", () => {
                if (tab.disabled || tab.id === activeTab) return;
                _switchTab(wrapper, bar, content, tab.id, config);
            });

            bar.appendChild(btn);
        }

        wrapper.appendChild(bar);

        // ── Content Area ─────────────────────────────────────
        const content = document.createElement("div");
        content.className = "sdoa-tabgroup__content";
        content.setAttribute("role", "tabpanel");
        wrapper.appendChild(content);

        // Render initial tab
        if (activeTab && typeof config.renderTab === "function") {
            config.renderTab(activeTab, content);
        }

        // ── Switch logic ─────────────────────────────────────
        function _switchTab(wrapper, bar, contentEl, newTabId, cfg) {
            const prevTab = activeTab;
            activeTab = newTabId;

            // Update tab bar
            for (const btn of bar.querySelectorAll(".sdoa-tabgroup__tab")) {
                btn.classList.toggle("sdoa-tabgroup__tab--active", btn.dataset.tabId === newTabId);
            }

            // Clear and re-render content
            contentEl.innerHTML = "";
            if (typeof cfg.renderTab === "function") {
                cfg.renderTab(newTabId, contentEl);
            }

            if (typeof cfg.onTabChange === "function") {
                cfg.onTabChange(newTabId, prevTab);
            }
        }

        // ── Public API ───────────────────────────────────────
        wrapper._sdoaGetActiveTab = () => activeTab;
        wrapper._sdoaSetActiveTab = (id) => _switchTab(wrapper, bar, content, id, config);
        wrapper._sdoaContent = content;
        wrapper._sdoaBar = bar;

        return wrapper;
    }

    window.TabGroupPrim = { MANIFEST, create };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { create });
})();
