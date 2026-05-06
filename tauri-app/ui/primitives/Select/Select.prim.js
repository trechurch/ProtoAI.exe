// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// Select.prim.js — SDOA v4 Primitive | v4.0.0 | layer 2
// Standalone select/dropdown.
// Usage: SelectPrim.create({ label: "Engine", options: [{value,label}], onChange: fn });
// ============================================================
(function () {
    "use strict";
    const MANIFEST = { id: "Select.prim", type: "primitive", layer: 2, runtime: "Browser", version: "4.0.0", requires: [], dataFiles: [], lifecycle: [], actions: { commands: { create: {} }, events: {}, accepts: {}, slots: {} }, backendDeps: [], docs: { description: "Standalone dropdown select.", author: "ProtoAI team", sdoa: "4.0.0" } };

    function create(config = {}) {
        const wrapper = document.createElement("div");
        wrapper.className = "sdoa-input-group";
        if (config.id) wrapper.id = config.id;

        if (config.label) {
            const label = document.createElement("label");
            label.className = "sdoa-input__label";
            label.textContent = config.label;
            wrapper.appendChild(label);
        }

        const select = document.createElement("select");
        select.className = "sdoa-input sdoa-select";
        if (config.disabled) select.disabled = true;

        for (const opt of (config.options || [])) {
            const option = document.createElement("option");
            option.value = typeof opt === "object" ? opt.value : opt;
            option.textContent = typeof opt === "object" ? (opt.label || opt.value) : opt;
            if (opt.disabled) option.disabled = true;
            select.appendChild(option);
        }

        if (config.value != null) select.value = config.value;

        select.addEventListener("change", () => {
            if (typeof config.onChange === "function") config.onChange(select.value);
        });

        wrapper.appendChild(select);

        wrapper._sdoaUpdate = (newConfig) => {
            if ("value" in newConfig) select.value = newConfig.value;
            if ("options" in newConfig) {
                select.innerHTML = "";
                for (const opt of newConfig.options) {
                    const o = document.createElement("option");
                    o.value = typeof opt === "object" ? opt.value : opt;
                    o.textContent = typeof opt === "object" ? (opt.label || opt.value) : opt;
                    select.appendChild(o);
                }
            }
            if ("disabled" in newConfig) select.disabled = newConfig.disabled;
        };
        wrapper._sdoaGetValue = () => select.value;
        wrapper._sdoaSetValue = (v) => { select.value = v; };

        return wrapper;
    }

    window.SelectPrim = { MANIFEST, create };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { create });
})();
