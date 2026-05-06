// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// Toggle.prim.js — SDOA v4 Primitive | v4.0.0 | layer 2
// Standalone on/off toggle switch.
// Usage: TogglePrim.create({ label: "Dark Mode", checked: true, onChange: fn });
// ============================================================
(function () {
    "use strict";
    const MANIFEST = { id: "Toggle.prim", type: "primitive", layer: 2, runtime: "Browser", version: "4.0.0", requires: [], dataFiles: [], lifecycle: [], actions: { commands: { create: {} }, events: {}, accepts: {}, slots: {} }, backendDeps: [], docs: { description: "On/off toggle switch.", author: "ProtoAI team", sdoa: "4.0.0" } };

    function create(config = {}) {
        const wrapper = document.createElement("div");
        wrapper.className = "sdoa-toggle";
        if (config.id) wrapper.id = config.id;

        const label = document.createElement("span");
        label.className = "sdoa-toggle__label";
        label.textContent = config.label || "";

        const toggle = document.createElement("label");
        toggle.className = "sdoa-form__toggle-switch"; // reuse Form toggle styles
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = !!config.checked;
        if (config.disabled) checkbox.disabled = true;
        const slider = document.createElement("span");
        slider.className = "sdoa-form__toggle-slider";
        toggle.appendChild(checkbox);
        toggle.appendChild(slider);

        checkbox.addEventListener("change", () => {
            if (typeof config.onChange === "function") config.onChange(checkbox.checked);
        });

        wrapper.appendChild(label);
        wrapper.appendChild(toggle);

        wrapper._sdoaUpdate = (newConfig) => {
            if ("checked" in newConfig) checkbox.checked = newConfig.checked;
            if ("label" in newConfig) label.textContent = newConfig.label;
            if ("disabled" in newConfig) checkbox.disabled = newConfig.disabled;
        };
        wrapper._sdoaGetValue = () => checkbox.checked;

        return wrapper;
    }

    window.TogglePrim = { MANIFEST, create };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { create });
})();
