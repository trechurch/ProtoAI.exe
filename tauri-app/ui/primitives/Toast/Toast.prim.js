// ============================================================
// Toast.prim.js — SDOA v4 Primitive
// version: 4.0.0
// Last modified: 2026-05-04 03:11 UTC
// layer: 2 (primitive)
//
// Notification toast primitive. Replaces showToast() in app.js.
//
// Usage:
//   Toast.show("Settings saved!", "success");
//   Toast.show("Upload failed", "error", 5000);
//   Toast.show("Processing...", "info", 0, { action: { label: "Cancel", onClick: fn } });
// ============================================================

(function () {
    "use strict";

    const MANIFEST = {
        id:       "Toast.prim",
        type:     "primitive",
        layer:    2,
        runtime:  "Browser",
        version:  "4.0.0",
        requires: [],
        dataFiles: [],
        lifecycle: ["mount"],
        actions: {
            commands: {
                show:    { description: "Show a toast notification.", input: { message: "string", type: "string?", duration: "number?", options: "object?" }, output: "void" },
                dismiss: { description: "Dismiss a toast by ID.",    input: { id: "string" }, output: "void" },
                clear:   { description: "Clear all active toasts.",  input: {}, output: "void" },
            },
            events: {},
            accepts: {},
            slots: {},
        },
        backendDeps: [],
        docs: {
            description: "Notification toast system. Supports info/success/warning/error types, auto-dismiss, and optional action buttons.",
            author: "ProtoAI team",
            sdoa: "4.0.0"
        }
    };

    // ── State ────────────────────────────────────────────────
    let _container = null;
    let _toastId   = 0;
    const _active  = new Map();  // id → { element, timer }

    const ICONS = {
        info:    "ℹ️",
        success: "✅",
        warning: "⚠️",
        error:   "❌",
    };

    const DEFAULT_DURATION = {
        info:    3000,
        success: 2500,
        warning: 4000,
        error:   5000,
    };

    // ── mount ────────────────────────────────────────────────
    function mount() {
        if (_container) return;
        _container = document.createElement("div");
        _container.className = "sdoa-toast-container";
        _container.setAttribute("role", "status");
        _container.setAttribute("aria-live", "polite");
        document.body.appendChild(_container);
    }

    // ── show ─────────────────────────────────────────────────
    function show(message, type = "info", duration, options = {}) {
        if (!_container) mount();

        const id = `toast-${++_toastId}`;
        const dur = duration ?? DEFAULT_DURATION[type] ?? 3000;

        const el = document.createElement("div");
        el.className = `sdoa-toast sdoa-toast--${type}`;
        el.setAttribute("data-toast-id", id);

        // Content
        let html = `<span class="sdoa-toast__icon">${ICONS[type] || ""}</span>`;
        html += `<span class="sdoa-toast__message">${_escapeHtml(message)}</span>`;

        if (options.action) {
            html += `<button class="sdoa-toast__action">${_escapeHtml(options.action.label || "Action")}</button>`;
        }

        html += `<button class="sdoa-toast__close" title="Dismiss">×</button>`;
        el.innerHTML = html;

        // Wire action button
        if (options.action?.onClick) {
            el.querySelector(".sdoa-toast__action")?.addEventListener("click", () => {
                options.action.onClick();
                dismiss(id);
            });
        }

        // Wire close button
        el.querySelector(".sdoa-toast__close")?.addEventListener("click", () => dismiss(id));

        // Insert at top
        _container.prepend(el);

        // Trigger enter animation
        requestAnimationFrame(() => el.classList.add("sdoa-toast--visible"));

        // Auto-dismiss
        let timer = null;
        if (dur > 0) {
            timer = setTimeout(() => dismiss(id), dur);
        }

        _active.set(id, { element: el, timer });

        // Cap at 5 visible toasts
        if (_active.size > 5) {
            const oldest = _active.keys().next().value;
            dismiss(oldest);
        }

        return id;
    }

    // ── dismiss ──────────────────────────────────────────────
    function dismiss(id) {
        const toast = _active.get(id);
        if (!toast) return;

        if (toast.timer) clearTimeout(toast.timer);

        toast.element.classList.remove("sdoa-toast--visible");
        toast.element.classList.add("sdoa-toast--exit");

        // Remove after animation
        setTimeout(() => {
            toast.element.remove();
            _active.delete(id);
        }, 300);
    }

    // ── clear ────────────────────────────────────────────────
    function clear() {
        for (const id of _active.keys()) {
            dismiss(id);
        }
    }

    // ── _escapeHtml ──────────────────────────────────────────
    function _escapeHtml(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Export ────────────────────────────────────────────────
    window.ToastPrim = { MANIFEST, mount, show, dismiss, clear };

    // Legacy compatibility: replace window.showToast if it exists
    window.showToast = function (msgOrObj, typeOrDuration) {
        let msg = "";
        let duration = 3000;
        let type = "info";

        if (typeof msgOrObj === "object" && msgOrObj !== null) {
            msg = msgOrObj.msg || "";
            duration = msgOrObj.duration || 3000;
        } else {
            msg = String(msgOrObj || "");
            if (typeof typeOrDuration === "number") {
                duration = typeOrDuration;
            } else if (typeof typeOrDuration === "string") {
                type = typeOrDuration;
            }
        }
        
        // Map common old messages to success/error
        if (msg.toLowerCase().includes("success") || msg.toLowerCase().includes("saved")) type = "success";
        if (msg.toLowerCase().includes("fail") || msg.toLowerCase().includes("error")) type = "error";

        show(msg, type, duration);
    };

    // Register with ModuleLoader if available
    if (window.ModuleLoader) {
        window.ModuleLoader.register(MANIFEST, { mount, show, dismiss, clear });
    }

})();
