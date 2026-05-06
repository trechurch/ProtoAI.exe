// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// List.prim.js — SDOA v4 Primitive
// version: 4.0.0 | layer: 2
//
// Generic scrollable list. Replaces project list, file list,
// model list, history list, and process list.
//
// Usage:
//   const list = ListPrim.create({
//     items: [{ id: "1", label: "Project A" }],
//     renderItem: (item) => { ... returns HTMLElement ... },
//     onSelect: (item) => { ... },
//     emptyState: { icon: "📂", title: "No items", hint: "Create one" },
//   });
// ============================================================

(function () {
    "use strict";

    const MANIFEST = {
        id: "List.prim", type: "primitive", layer: 2,
        runtime: "Browser", version: "4.0.0",
        requires: [], dataFiles: [], lifecycle: [],
        actions: {
            commands: { create: { description: "Create a list element.", input: "ListConfig", output: "HTMLElement" } },
            events: { "list:selected": { payload: "item" }, "list:contextmenu": { payload: "{ item, event }" } },
            accepts: {}, slots: {},
        },
        backendDeps: [],
        docs: { description: "Generic scrollable list with selection, search, context menu, empty state, and custom item rendering.", author: "ProtoAI team", sdoa: "4.0.0" }
    };

    /**
     * @param {Object}   config
     * @param {Array}    [config.items]        — Array of item objects (must have .id)
     * @param {Function} [config.renderItem]   — (item, isSelected) => HTMLElement
     * @param {Function} [config.onSelect]     — (item, event) => void
     * @param {Function} [config.onContextMenu] — (item, event) => void
     * @param {Function} [config.onDoubleClick] — (item, event) => void
     * @param {Object}   [config.emptyState]   — { icon, title, hint }
     * @param {boolean}  [config.searchable]   — Show search filter bar
     * @param {string}   [config.searchKey]    — Property to filter on (default "label")
     * @param {boolean}  [config.multiSelect]  — Allow multi-selection
     * @param {string}   [config.id]           — DOM id
     */
    function create(config = {}) {
        const wrapper = document.createElement("div");
        wrapper.className = "sdoa-list";
        if (config.id) wrapper.id = config.id;

        let items = config.items || [];
        let filteredItems = items;
        let selectedIds = new Set();
        let filterText = "";

        // ── Search bar ───────────────────────────────────────
        let searchInput = null;
        if (config.searchable) {
            const searchBar = document.createElement("div");
            searchBar.className = "sdoa-list__search";
            searchInput = document.createElement("input");
            searchInput.type = "text";
            searchInput.className = "sdoa-list__search-input";
            searchInput.placeholder = "Filter...";
            searchInput.addEventListener("input", () => {
                filterText = searchInput.value.toLowerCase();
                _render();
            });
            searchBar.appendChild(searchInput);
            wrapper.appendChild(searchBar);
        }

        // ── Items container ──────────────────────────────────
        const listEl = document.createElement("div");
        listEl.className = "sdoa-list__items";
        listEl.setAttribute("role", "listbox");
        wrapper.appendChild(listEl);

        // ── Render ───────────────────────────────────────────
        function _render() {
            listEl.innerHTML = "";
            const searchKey = config.searchKey || "label";

            filteredItems = filterText
                ? items.filter(item => {
                    const val = item[searchKey] || item.id || "";
                    return val.toLowerCase().includes(filterText);
                })
                : items;

            if (filteredItems.length === 0) {
                _renderEmpty(listEl, config.emptyState);
                return;
            }

            for (const item of filteredItems) {
                const isSelected = selectedIds.has(item.id);
                let row;

                if (typeof config.renderItem === "function") {
                    row = config.renderItem(item, isSelected);
                } else {
                    row = _defaultRenderItem(item, isSelected);
                }

                row.className += " sdoa-list__item";
                row.setAttribute("data-item-id", item.id);
                if (isSelected) row.classList.add("sdoa-list__item--selected");

                // Click → select
                row.addEventListener("click", (e) => {
                    if (config.multiSelect && (e.ctrlKey || e.metaKey)) {
                        if (selectedIds.has(item.id)) selectedIds.delete(item.id);
                        else selectedIds.add(item.id);
                    } else {
                        selectedIds.clear();
                        selectedIds.add(item.id);
                    }
                    _render();
                    if (typeof config.onSelect === "function") config.onSelect(item, e);
                });

                // Double click
                if (typeof config.onDoubleClick === "function") {
                    row.addEventListener("dblclick", (e) => config.onDoubleClick(item, e));
                }

                // Context menu
                if (typeof config.onContextMenu === "function") {
                    row.addEventListener("contextmenu", (e) => {
                        e.preventDefault();
                        config.onContextMenu(item, e);
                    });
                }

                listEl.appendChild(row);
            }
        }

        function _defaultRenderItem(item, isSelected) {
            const row = document.createElement("div");
            row.className = "sdoa-list__item-default";

            if (item.icon) {
                const icon = document.createElement("span");
                icon.className = "sdoa-list__item-icon";
                icon.textContent = item.icon;
                row.appendChild(icon);
            }

            const label = document.createElement("span");
            label.className = "sdoa-list__item-label";
            label.textContent = item.label || item.id;
            row.appendChild(label);

            if (item.badge) {
                const badge = document.createElement("span");
                badge.className = "sdoa-list__item-badge";
                badge.textContent = item.badge;
                row.appendChild(badge);
            }

            return row;
        }

        function _renderEmpty(container, emptyState) {
            const empty = document.createElement("div");
            empty.className = "sdoa-list__empty";
            if (emptyState?.icon)  empty.innerHTML += `<div class="sdoa-list__empty-icon">${emptyState.icon}</div>`;
            if (emptyState?.title) empty.innerHTML += `<div class="sdoa-list__empty-title">${emptyState.title}</div>`;
            if (emptyState?.hint)  empty.innerHTML += `<div class="sdoa-list__empty-hint">${emptyState.hint}</div>`;
            if (!emptyState) empty.innerHTML = `<div class="sdoa-list__empty-title">No items</div>`;
            container.appendChild(empty);
        }

        // Initial render
        _render();

        // ── Public API ───────────────────────────────────────
        wrapper._sdoaUpdate = (newConfig) => {
            if (newConfig.items) { items = newConfig.items; }
            Object.assign(config, newConfig);
            _render();
        };
        wrapper._sdoaSetItems = (newItems) => { items = newItems; _render(); };
        wrapper._sdoaGetSelected = () => filteredItems.filter(i => selectedIds.has(i.id));
        wrapper._sdoaClearSelection = () => { selectedIds.clear(); _render(); };
        wrapper._sdoaItems = listEl;

        return wrapper;
    }

    window.ListPrim = { MANIFEST, create };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { create });
})();
