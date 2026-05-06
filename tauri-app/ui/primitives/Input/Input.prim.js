// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// Input.prim.js — SDOA v4 Primitive
// version: 4.0.0
// layer: 2 (primitive)
//
// Generic input primitive. Renders text, password, number,
// textarea, and search inputs from a config object.
//
// Usage:
//   const el = InputPrim.create({
//     type: "password", label: "API Key",
//     placeholder: "sk-...", onChange: (val) => { ... }
//   });
// ============================================================

(function () {
    "use strict";

    const MANIFEST = {
        id: "Input.prim", type: "primitive", layer: 2,
        runtime: "Browser", version: "4.0.0",
        requires: [], dataFiles: [], lifecycle: [],
        actions: {
            commands: {
                create: { description: "Create an input group from config.", input: "InputConfig", output: "HTMLElement" },
            },
            events: {}, accepts: {}, slots: {},
        },
        backendDeps: [],
        docs: { description: "Generic input primitive. Supports text, password, number, textarea, search types with labels, validation, hints, and error states.", author: "ProtoAI team", sdoa: "4.0.0" }
    };

    /**
     * @param {Object} config
     * @param {string}   [config.type]        — "text"|"password"|"number"|"textarea"|"search"
     * @param {string}   [config.label]       — Label text
     * @param {string}   [config.placeholder] — Placeholder text
     * @param {string}   [config.value]       — Initial value
     * @param {Function} [config.onChange]     — Called with (value, event)
     * @param {Function} [config.onSubmit]    — Called on Enter key
     * @param {Function} [config.validate]    — Returns error string or null
     * @param {string}   [config.hint]        — Help text below input
     * @param {string}   [config.error]       — Error message to display
     * @param {boolean}  [config.disabled]    — Disabled state
     * @param {boolean}  [config.readOnly]    — Read-only state
     * @param {string}   [config.id]          — DOM id for the input element
     * @param {number}   [config.min]         — Min value (number type)
     * @param {number}   [config.max]         — Max value (number type)
     * @param {number}   [config.rows]        — Rows (textarea type)
     * @param {string}   [config.autocomplete] — Autocomplete attribute
     */
    function create(config = {}) {
        const wrapper = document.createElement("div");
        wrapper.className = "sdoa-input-group";
        if (config.error) wrapper.classList.add("sdoa-input-group--error");

        // ── Label ────────────────────────────────────────────
        if (config.label) {
            const label = document.createElement("label");
            label.className = "sdoa-input__label";
            label.textContent = config.label;
            if (config.id) label.htmlFor = config.id;
            wrapper.appendChild(label);
        }

        // ── Input element ────────────────────────────────────
        const isTextarea = config.type === "textarea";
        const input = document.createElement(isTextarea ? "textarea" : "input");
        input.className = "sdoa-input";

        if (!isTextarea) {
            input.type = config.type || "text";
        }
        if (config.id)           input.id = config.id;
        if (config.placeholder)  input.placeholder = config.placeholder;
        if (config.value != null) input.value = config.value;
        if (config.disabled)     input.disabled = true;
        if (config.readOnly)     input.readOnly = true;
        if (config.autocomplete) input.autocomplete = config.autocomplete;

        if (config.type === "number") {
            if (config.min != null) input.min = config.min;
            if (config.max != null) input.max = config.max;
        }
        if (isTextarea && config.rows) {
            input.rows = config.rows;
        }

        // ── Events ───────────────────────────────────────────
        if (typeof config.onChange === "function") {
            input.addEventListener("input", (e) => {
                const val = config.type === "number" ? Number(e.target.value) : e.target.value;
                config.onChange(val, e);
                _validateAndUpdate(wrapper, input, config);
            });
        }

        if (typeof config.onSubmit === "function") {
            input.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    config.onSubmit(input.value, e);
                }
            });
        }

        wrapper.appendChild(input);

        // ── Hint / Error ─────────────────────────────────────
        const hint = document.createElement("div");
        hint.className = "sdoa-input__hint";
        hint.textContent = config.error || config.hint || "";
        if (config.error) hint.classList.add("sdoa-input__hint--error");
        wrapper.appendChild(hint);

        // ── Update method ────────────────────────────────────
        wrapper._sdoaUpdate = (newConfig) => {
            if ("value" in newConfig)       input.value = newConfig.value;
            if ("disabled" in newConfig)    input.disabled = newConfig.disabled;
            if ("error" in newConfig) {
                hint.textContent = newConfig.error || config.hint || "";
                hint.classList.toggle("sdoa-input__hint--error", !!newConfig.error);
                wrapper.classList.toggle("sdoa-input-group--error", !!newConfig.error);
            }
            Object.assign(config, newConfig);
        };

        // ── getValue / setValue ──────────────────────────────
        wrapper._sdoaGetValue = () => input.value;
        wrapper._sdoaSetValue = (v) => { input.value = v; };
        wrapper._sdoaInput = input;

        return wrapper;
    }

    function _validateAndUpdate(wrapper, input, config) {
        if (typeof config.validate !== "function") return;
        const error = config.validate(input.value);
        const hint = wrapper.querySelector(".sdoa-input__hint");
        if (error) {
            hint.textContent = error;
            hint.classList.add("sdoa-input__hint--error");
            wrapper.classList.add("sdoa-input-group--error");
        } else {
            hint.textContent = config.hint || "";
            hint.classList.remove("sdoa-input__hint--error");
            wrapper.classList.remove("sdoa-input-group--error");
        }
    }

    window.InputPrim = { MANIFEST, create };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { create });
})();
