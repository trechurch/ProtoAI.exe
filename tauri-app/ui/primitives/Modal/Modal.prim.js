// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// Modal.prim.js — SDOA v4 Primitive
// version: 4.0.0 | layer: 2
//
// Generic overlay dialog. Replaces all hand-coded modals
// (Settings, ProjectManager, FirstRun).
//
// Usage:
//   const modal = ModalPrim.create({
//     title: "Settings", size: "large",
//     onClose: () => modal.remove(),
//   });
//   modal._sdoaBody.appendChild(myContent);
//   document.body.appendChild(modal);
// ============================================================

(function () {
    "use strict";

    const MANIFEST = {
        id: "Modal.prim", type: "primitive", layer: 2,
        runtime: "Browser", version: "4.0.0",
        requires: [], dataFiles: [], lifecycle: [],
        actions: {
            commands: {
                create: { description: "Create a modal overlay.", input: "ModalConfig", output: "HTMLElement" },
                open:   { description: "Show a modal.", input: "{ modal }", output: "void" },
                close:  { description: "Close and remove a modal.", input: "{ modal }", output: "void" },
            },
            events: { "modal:opened": {}, "modal:closed": {} },
            accepts: {}, slots: { header: "Custom header content", body: "Main content", footer: "Footer buttons" },
        },
        backendDeps: [],
        docs: { description: "Generic modal overlay with sizes, close button, Escape key, backdrop click, and animated transitions.", author: "ProtoAI team", sdoa: "4.0.0" }
    };

    /**
     * @param {Object}   config
     * @param {string}   [config.title]     — Modal title
     * @param {string}   [config.size]      — "sm"|"md"|"lg"|"xl"|"full"
     * @param {Function} [config.onClose]   — Called when modal is closed
     * @param {boolean}  [config.closable]  — Show close button (default true)
     * @param {boolean}  [config.backdrop]  — Close on backdrop click (default true)
     * @param {string}   [config.id]        — DOM id
     */
    function create(config = {}) {
        const closable = config.closable !== false;
        const backdrop = config.backdrop !== false;
        const size = config.size || "md";

        // ── Overlay ──────────────────────────────────────────
        const overlay = document.createElement("div");
        overlay.className = "sdoa-modal-overlay";
        if (config.id) overlay.id = config.id;

        // ── Dialog ───────────────────────────────────────────
        const dialog = document.createElement("div");
        dialog.className = `sdoa-modal sdoa-modal--${size}`;
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");

        // ── Header ───────────────────────────────────────────
        const header = document.createElement("div");
        header.className = "sdoa-modal__header";

        if (config.title) {
            const title = document.createElement("h2");
            title.className = "sdoa-modal__title";
            title.textContent = config.title;
            header.appendChild(title);
        }

        if (closable) {
            const closeBtn = document.createElement("button");
            closeBtn.className = "sdoa-modal__close";
            closeBtn.innerHTML = "×";
            closeBtn.title = "Close";
            closeBtn.addEventListener("click", () => close(overlay, config));
            header.appendChild(closeBtn);
        }

        dialog.appendChild(header);

        // ── Body ─────────────────────────────────────────────
        const body = document.createElement("div");
        body.className = "sdoa-modal__body";
        dialog.appendChild(body);

        // ── Footer ───────────────────────────────────────────
        const footer = document.createElement("div");
        footer.className = "sdoa-modal__footer";
        footer.style.display = "none"; // hidden until content added
        dialog.appendChild(footer);

        overlay.appendChild(dialog);

        // ── Backdrop click ───────────────────────────────────
        if (backdrop && closable) {
            overlay.addEventListener("click", (e) => {
                if (e.target === overlay) close(overlay, config);
            });
        }

        // ── Escape key ───────────────────────────────────────
        if (closable) {
            const escHandler = (e) => {
                if (e.key === "Escape") {
                    close(overlay, config);
                    document.removeEventListener("keydown", escHandler);
                }
            };
            overlay._sdoaEscHandler = escHandler;
        }

        // ── Public refs ──────────────────────────────────────
        overlay._sdoaBody = body;
        overlay._sdoaFooter = footer;
        overlay._sdoaHeader = header;
        overlay._sdoaDialog = dialog;

        // Show footer helper
        overlay._sdoaShowFooter = () => { footer.style.display = ""; };

        return overlay;
    }

    function open(modal) {
        document.body.appendChild(modal);
        // Trigger enter animation
        requestAnimationFrame(() => {
            modal.classList.add("sdoa-modal-overlay--visible");
        });
        // Bind escape
        if (modal._sdoaEscHandler) {
            document.addEventListener("keydown", modal._sdoaEscHandler);
        }
        // Trap focus
        const focusable = modal.querySelector("input, button, select, textarea, [tabindex]");
        if (focusable) focusable.focus();
    }

    function close(modal, config = {}) {
        modal.classList.remove("sdoa-modal-overlay--visible");
        modal.classList.add("sdoa-modal-overlay--exit");
        // Unbind escape
        if (modal._sdoaEscHandler) {
            document.removeEventListener("keydown", modal._sdoaEscHandler);
        }
        // Remove after animation
        setTimeout(() => {
            modal.remove();
            if (typeof config.onClose === "function") config.onClose();
        }, 200);
    }

    window.ModalPrim = { MANIFEST, create, open, close };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { create, open, close });
})();
