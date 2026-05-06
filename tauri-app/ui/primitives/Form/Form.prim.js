// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// Form.prim.js — SDOA v4 Primitive
// version: 4.0.0 | layer: 2
//
// Schema-driven form renderer. Reads a JSON schema and
// renders the appropriate Input/Toggle/Select primitives.
//
// Usage:
//   const form = FormPrim.create({
//     fields: [
//       { id: "name", type: "text", label: "Name" },
//       { id: "debug", type: "toggle", label: "Debug" },
//       { id: "model", type: "select", label: "Model", options: [...] },
//     ],
//     values: { name: "ProtoAI", debug: false, model: "gpt-4" },
//     onSubmit: (values) => { ... },
//   });
// ============================================================

(function () {
    "use strict";

    const MANIFEST = {
        id: "Form.prim", type: "primitive", layer: 2,
        runtime: "Browser", version: "4.0.0",
        requires: ["Input.prim"], dataFiles: [], lifecycle: [],
        actions: {
            commands: { create: { description: "Create a form from a field schema.", input: "FormConfig", output: "HTMLElement" } },
            events: { "form:changed": { payload: "{ fieldId, value, allValues }" }, "form:submitted": { payload: "{ values }" } },
            accepts: {}, slots: {},
        },
        backendDeps: [],
        docs: { description: "Schema-driven form renderer. Creates Input/Toggle/Select primitives from a JSON field list. Handles validation and submission.", author: "ProtoAI team", sdoa: "4.0.0" }
    };

    /**
     * @param {Object}   config
     * @param {Array}    config.fields      — [{ id, type, label, placeholder, ... }]
     * @param {Object}   [config.values]    — Initial values { fieldId: value }
     * @param {Function} [config.onChange]   — (fieldId, value, allValues) => void
     * @param {Function} [config.onSubmit]  — (values) => void
     * @param {string}   [config.layout]    — "stack"|"grid" (default stack)
     * @param {string}   [config.submitLabel] — Submit button text
     * @param {string}   [config.id]        — DOM id
     */
    function create(config = {}) {
        const form = document.createElement("div");
        form.className = `sdoa-form sdoa-form--${config.layout || "stack"}`;
        if (config.id) form.id = config.id;
        form.setAttribute("role", "form");

        const values = { ...(config.values || {}) };
        const fieldRefs = new Map(); // fieldId → element

        // ── Render fields ────────────────────────────────────
        for (const field of (config.fields || [])) {
            const row = document.createElement("div");
            row.className = "sdoa-form__row";

            let el;

            switch (field.type) {
                case "toggle": {
                    el = _createToggle(field, values, config);
                    break;
                }
                case "select": {
                    el = _createSelect(field, values, config);
                    break;
                }
                case "separator": {
                    const sep = document.createElement("hr");
                    sep.className = "sdoa-form__separator";
                    row.appendChild(sep);
                    form.appendChild(row);
                    continue;
                }
                case "heading": {
                    const h = document.createElement("h3");
                    h.className = "sdoa-form__heading";
                    h.textContent = field.label || "";
                    row.appendChild(h);
                    form.appendChild(row);
                    continue;
                }
                default: {
                    // text, password, number, textarea, search
                    el = window.InputPrim
                        ? window.InputPrim.create({
                            type: field.type || "text",
                            label: field.label,
                            placeholder: field.placeholder,
                            value: values[field.id] ?? field.defaultValue ?? "",
                            id: field.id,
                            hint: field.hint,
                            disabled: field.disabled,
                            readOnly: field.readOnly,
                            min: field.min,
                            max: field.max,
                            rows: field.rows,
                            autocomplete: field.autocomplete || "off",
                            validate: field.validate,
                            onChange: (val) => {
                                values[field.id] = val;
                                if (typeof config.onChange === "function") {
                                    config.onChange(field.id, val, { ...values });
                                }
                            },
                        })
                        : _createFallbackInput(field, values, config);
                    break;
                }
            }

            if (el) {
                row.appendChild(el);
                fieldRefs.set(field.id, el);
            }
            form.appendChild(row);
        }

        // ── Submit button ────────────────────────────────────
        if (config.onSubmit && config.submitLabel !== false) {
            const submitRow = document.createElement("div");
            submitRow.className = "sdoa-form__submit-row";
            const submitBtn = window.ButtonPrim
                ? window.ButtonPrim.create({
                    label: config.submitLabel || "Save",
                    variant: "primary",
                    onClick: () => config.onSubmit({ ...values }),
                })
                : _createFallbackButton(config.submitLabel || "Save", () => config.onSubmit({ ...values }));
            submitRow.appendChild(submitBtn);
            form.appendChild(submitRow);
        }

        // ── Public API ───────────────────────────────────────
        form._sdoaGetValues = () => ({ ...values });
        form._sdoaSetValues = (newValues) => {
            Object.assign(values, newValues);
            // Update rendered fields
            for (const [id, el] of fieldRefs) {
                if (id in newValues && el._sdoaSetValue) {
                    el._sdoaSetValue(newValues[id]);
                }
            }
        };
        form._sdoaGetField = (id) => fieldRefs.get(id);

        return form;
    }

    // ── Toggle (checkbox switch) ─────────────────────────────
    function _createToggle(field, values, config) {
        const wrapper = document.createElement("div");
        wrapper.className = "sdoa-form__toggle-row";

        const label = document.createElement("label");
        label.className = "sdoa-form__toggle-label";
        label.textContent = field.label || "";

        const toggle = document.createElement("label");
        toggle.className = "sdoa-form__toggle-switch";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = !!values[field.id];
        if (field.id) checkbox.id = field.id;
        const slider = document.createElement("span");
        slider.className = "sdoa-form__toggle-slider";
        toggle.appendChild(checkbox);
        toggle.appendChild(slider);

        checkbox.addEventListener("change", () => {
            values[field.id] = checkbox.checked;
            if (typeof config.onChange === "function") {
                config.onChange(field.id, checkbox.checked, { ...values });
            }
        });

        wrapper.appendChild(label);
        wrapper.appendChild(toggle);
        wrapper._sdoaSetValue = (v) => { checkbox.checked = !!v; };
        return wrapper;
    }

    // ── Select (dropdown) ────────────────────────────────────
    function _createSelect(field, values, config) {
        const wrapper = document.createElement("div");
        wrapper.className = "sdoa-input-group";

        if (field.label) {
            const label = document.createElement("label");
            label.className = "sdoa-input__label";
            label.textContent = field.label;
            if (field.id) label.htmlFor = field.id;
            wrapper.appendChild(label);
        }

        const select = document.createElement("select");
        select.className = "sdoa-input sdoa-select";
        if (field.id) select.id = field.id;

        for (const opt of (field.options || [])) {
            const option = document.createElement("option");
            if (typeof opt === "object") {
                option.value = opt.value;
                option.textContent = opt.label || opt.value;
            } else {
                option.value = opt;
                option.textContent = opt;
            }
            select.appendChild(option);
        }

        select.value = values[field.id] ?? "";

        select.addEventListener("change", () => {
            values[field.id] = select.value;
            if (typeof config.onChange === "function") {
                config.onChange(field.id, select.value, { ...values });
            }
        });

        wrapper.appendChild(select);
        wrapper._sdoaSetValue = (v) => { select.value = v; };
        return wrapper;
    }

    // ── Fallbacks (if other primitives haven't loaded) ───────
    function _createFallbackInput(field, values, config) {
        const input = document.createElement("input");
        input.type = field.type || "text";
        input.value = values[field.id] ?? "";
        input.placeholder = field.placeholder || "";
        input.className = "sdoa-input";
        input.addEventListener("input", () => {
            values[field.id] = input.value;
            if (typeof config.onChange === "function") config.onChange(field.id, input.value, values);
        });
        return input;
    }

    function _createFallbackButton(label, onClick) {
        const btn = document.createElement("button");
        btn.className = "sdoa-button sdoa-button--primary sdoa-button--md";
        btn.textContent = label;
        btn.addEventListener("click", onClick);
        return btn;
    }

    window.FormPrim = { MANIFEST, create };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { create });
})();
