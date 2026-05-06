// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// ContextMenu.prim.js — SDOA v4 Primitive | v4.0.0 | layer 2
// Right-click context menu.
// Usage: ContextMenuPrim.show({ items: [...], position: { x, y } });
// ============================================================
(function () {
    "use strict";
    const MANIFEST = { id: "ContextMenu.prim", type: "primitive", layer: 2, runtime: "Browser", version: "4.0.0", requires: [], dataFiles: [], lifecycle: ["mount"], actions: { commands: { show: {}, hide: {} }, events: {}, accepts: {}, slots: {} }, backendDeps: [], docs: { description: "Context menu with nested items, separators, and keyboard navigation.", author: "ProtoAI team", sdoa: "4.0.0" } };

    let _activeMenu = null;

    function mount() {
        document.addEventListener("click", () => hide());
        document.addEventListener("contextmenu", () => hide());
    }

    /**
     * @param {Object} config
     * @param {Array}  config.items    — [{ label, icon?, onClick?, disabled?, separator?, children? }]
     * @param {Object} config.position — { x, y }
     */
    function show(config = {}) {
        hide();
        const menu = document.createElement("div");
        menu.className = "sdoa-context-menu";
        menu.style.left = config.position?.x + "px";
        menu.style.top = config.position?.y + "px";

        for (const item of (config.items || [])) {
            if (item.separator) {
                const sep = document.createElement("div");
                sep.className = "sdoa-context-menu__separator";
                menu.appendChild(sep);
                continue;
            }
            const row = document.createElement("div");
            row.className = "sdoa-context-menu__item";
            if (item.disabled) row.classList.add("sdoa-context-menu__item--disabled");
            if (item.danger) row.classList.add("sdoa-context-menu__item--danger");

            let html = "";
            if (item.icon) html += `<span class="sdoa-context-menu__icon">${item.icon}</span>`;
            html += `<span class="sdoa-context-menu__label">${item.label || ""}</span>`;
            if (item.shortcut) html += `<span class="sdoa-context-menu__shortcut">${item.shortcut}</span>`;
            row.innerHTML = html;

            if (!item.disabled && typeof item.onClick === "function") {
                row.addEventListener("click", (e) => { e.stopPropagation(); hide(); item.onClick(e); });
            }
            menu.appendChild(row);
        }

        document.body.appendChild(menu);

        // Adjust if overflowing viewport
        requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + "px";
            if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + "px";
            menu.classList.add("sdoa-context-menu--visible");
        });

        _activeMenu = menu;
    }

    function hide() {
        if (_activeMenu) { _activeMenu.remove(); _activeMenu = null; }
    }

    // Auto-mount on load
    if (document.readyState !== "loading") mount();
    else document.addEventListener("DOMContentLoaded", mount);

    window.ContextMenuPrim = { MANIFEST, show, hide, mount };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { show, hide, mount });
})();
