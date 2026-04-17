// ============================================================
// SendButton.ui.js — Split Send Button + Behavior Popover
// version: 1.0.0
// depends: tauri-utils.js, EventBus.ui.js, ChatBehavior.ui.js
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    // ── SendButton.ui ────────────────────────────────────────
    // Replaces the plain #sendBtn with a split button:
    //   Left side  → sends the message (existing behavior)
    //   Right side → opens behavior popover (chevron ▾)
    //
    // The popover contains:
    //   - Streaming toggle (stream / full)
    //   - Response mode (standard / continue / summarize / refine)
    //   - Visual style (comfortable / compact / focus)
    //   - VFS manifest mode (none / full / summary / reference)
    //   - History depth (full / 10 / 5 / none)
    //   - Spellcheck (local / engine / off)
    //
    // Session overrides are shown with a dot indicator on the
    // chevron so the user knows defaults have been changed.
    // ── end of SendButton.ui ─────────────────────────────────

    // ── SDOA v3 MANIFEST ─────────────────────────────────────
    const MANIFEST = {
        id:      "SendButton.ui",
        type:    "component",
        runtime: "Browser",
        version: "1.0.0",
        capabilities: [
            "send.trigger",
            "behavior.popover",
            "behavior.toggle",
            "session.override.indicator"
        ],
        dependencies: ["tauri-utils.js", "EventBus.ui.js", "ChatBehavior.ui.js"],
        docs: {
            description: "Split send button. Left sends, right opens behavior popover for session overrides. Indicates active overrides with a dot on the chevron.",
            author: "ProtoAI team",
            sdoa_compatibility: "All versions forward/backward compatible."
        },
        actions: {
            commands: {
                send:         { description: "Trigger send.",              input: {}, output: "void" },
                openPopover:  { description: "Open behavior popover.",     input: {}, output: "void" },
                closePopover: { description: "Close behavior popover.",    input: {}, output: "void" },
                setDisabled:  { description: "Enable/disable send button.",input: { disabled: "boolean" }, output: "void" },
            },
            triggers: {
                sendTriggered: { description: "Fires when send is clicked." },
            },
            emits: {
                "sendbutton:send":         { description: "Send triggered." },
                "sendbutton:popoverOpened": { description: "Popover opened." },
                "sendbutton:popoverClosed": { description: "Popover closed." },
            },
            workflows: {}
        }
    };
    // ── end of SDOA v3 MANIFEST ──────────────────────────────

    // ── behavior option definitions ───────────────────────────
    const OPTIONS = {
        streaming: {
            label: "Response delivery",
            type:  "toggle",
            values: [
                { value: "stream", label: "Stream", title: "Tokens appear as they arrive" },
                { value: "full",   label: "Wait",   title: "Wait for complete response" },
            ]
        },
        responseMode: {
            label: "Response mode",
            type:  "toggle",
            values: [
                { value: "standard",  label: "Standard",  title: "Normal response" },
                { value: "continue",  label: "Continue",  title: "Append to last response" },
                { value: "summarize", label: "Summarize", title: "Summarize conversation" },
                { value: "refine",    label: "Refine",    title: "Rewrite last response" },
            ]
        },
        historyDepth: {
            label: "History included",
            type:  "toggle",
            values: [
                { value: "full", label: "Full",    title: "All history" },
                { value: "10",   label: "10 turns", title: "Last 10 turns" },
                { value: "5",    label: "5 turns",  title: "Last 5 turns" },
                { value: "none", label: "None",     title: "Single turn only" },
            ]
        },
        vfsMode: {
            label: "File manifests",
            type:  "toggle",
            values: [
                { value: "none",      label: "None",      title: "Manifests not used in chat" },
                { value: "reference", label: "Reference", title: "Clickable tag, not sent to LLM" },
                { value: "summary",   label: "Summary",   title: "Condensed manifest" },
                { value: "full",      label: "Full",      title: "Complete manifest sent to LLM" },
            ]
        },
        visualStyle: {
            label: "Visual style",
            type:  "toggle",
            global: true, // affects #app class
            values: [
                { value: "comfortable", label: "Comfortable", title: "Default padded bubbles" },
                { value: "compact",     label: "Compact",     title: "Tight spacing" },
                { value: "focus",       label: "Focus",       title: "Full width, no sidebars" },
            ]
        },
        spellcheck: {
            label: "Spellcheck",
            type:  "toggle",
            values: [
                { value: "local",  label: "Local",  title: "Client-side spell check" },
                { value: "engine", label: "Engine", title: "LLM-powered spell check" },
                { value: "off",    label: "Off",    title: "No spell check" },
            ]
        },
    };
    // ── end of behavior option definitions ────────────────────

    // ── state ─────────────────────────────────────────────────
    let _popoverOpen = false;
    let _disabled    = false;
    let _sendFn      = null;   // set by app.js
    // ── end of state ─────────────────────────────────────────

    // ── _build ────────────────────────────────────────────────
    // Replaces the existing #sendBtn with the split button.
    // ── end of _build ────────────────────────────────────────

    function _build() {
        const existing = document.getElementById("sendBtn");
        if (!existing) return;

        // Create wrapper
        const wrapper = document.createElement("div");
        wrapper.id        = "sendBtnWrapper";
        wrapper.className = "send-btn-wrapper";

        // Main send button
        const sendBtn = document.createElement("button");
        sendBtn.id        = "sendBtn";
        sendBtn.className = "primary send-main";
        sendBtn.textContent = "Send";
        sendBtn.addEventListener("click", _onSend);

        // Chevron button
        const chevron = document.createElement("button");
        chevron.id        = "sendChevron";
        chevron.className = "primary send-chevron";
        chevron.innerHTML = `<span class="chevron-icon">▾</span><span class="override-dot hidden" id="overrideDot"></span>`;
        chevron.title     = "Chat behavior options";
        chevron.addEventListener("click", e => { e.stopPropagation(); _togglePopover(); });

        wrapper.appendChild(sendBtn);
        wrapper.appendChild(chevron);
        existing.replaceWith(wrapper);

        // Popover (appended to body to avoid clipping)
        const popover = document.createElement("div");
        popover.id        = "behaviorPopover";
        popover.className = "behavior-popover hidden";
        popover.addEventListener("click", e => e.stopPropagation());
        _buildPopoverContent(popover);
        document.body.appendChild(popover);

        // Close popover on outside click
        document.addEventListener("click", () => {
            if (_popoverOpen) _closePopover();
        });

        // Close on Escape
        document.addEventListener("keydown", e => {
            if (e.key === "Escape" && _popoverOpen) _closePopover();
        });

        // Update override dot when behavior changes
        window.EventBus?.on("behavior:changed", _updateOverrideDot);
        window.EventBus?.on("behavior:reset",   _updateOverrideDot);
    }

    // ── _buildPopoverContent ──────────────────────────────────

    function _buildPopoverContent(popover) {
        const behavior = window.ChatBehavior?.get() || {};

        popover.innerHTML = `
            <div class="popover-header">
                <span class="popover-title">Chat behavior</span>
                <div class="popover-actions">
                    <button class="popover-reset-btn" id="behaviorResetBtn" title="Reset to global defaults">Reset</button>
                    <button class="popover-settings-btn" id="behaviorSettingsBtn" title="Open full settings">⚙</button>
                </div>
            </div>
            <div class="popover-body" id="popoverBody"></div>
        `;

        const body = popover.querySelector("#popoverBody");
        Object.entries(OPTIONS).forEach(([key, opt]) => {
            body.appendChild(_buildOption(key, opt, behavior[key]));
        });

        // VFS summary sub-options (shown when vfsMode = summary)
        const summaryOpts = document.createElement("div");
        summaryOpts.id        = "vfsSummaryOpts";
        summaryOpts.className = `popover-sub-section ${behavior.vfsMode === "summary" ? "" : "hidden"}`;
        summaryOpts.innerHTML = `
            <div class="sub-section-title">Summary fields</div>
            ${_buildSummaryFields(behavior)}
        `;
        body.appendChild(summaryOpts);

        // Wire reset
        popover.querySelector("#behaviorResetBtn")?.addEventListener("click", () => {
            window.ChatBehavior?.resetSession();
            _rebuildPopoverContent();
        });

        // Wire settings link
        popover.querySelector("#behaviorSettingsBtn")?.addEventListener("click", () => {
            window.openSettingsPanel?.();
            _closePopover();
        });
    }

    function _buildOption(key, opt, currentValue) {
        const row = document.createElement("div");
        row.className = "popover-row";
        row.dataset.optKey = key;

        const label = document.createElement("div");
        label.className   = "popover-row-label";
        label.textContent = opt.label;

        const toggles = document.createElement("div");
        toggles.className = "popover-toggles";

        opt.values.forEach(v => {
            const btn = document.createElement("button");
            btn.className   = `popover-toggle-btn ${v.value === currentValue ? "active" : ""}`;
            btn.textContent = v.label;
            btn.title       = v.title;
            btn.dataset.key = key;
            btn.dataset.val = v.value;
            btn.addEventListener("click", () => _onOptionClick(key, v.value, opt.global));
            toggles.appendChild(btn);
        });

        row.appendChild(label);
        row.appendChild(toggles);
        return row;
    }

    function _buildSummaryFields(behavior) {
        const fields  = behavior.vfsSummaryFields  || {};
        const options = behavior.vfsSummaryOptions || {};
        const fieldLabels = {
            language: "Language", exports: "Exports", imports: "Imports",
            functions: "Functions", classes: "Classes", sdoa: "SDOA manifest",
            summary: "Summary", preview: "Preview", size: "File size", modified: "Modified date"
        };

        const checks = Object.entries(fieldLabels).map(([key, label]) => `
            <label class="summary-field-check">
                <input type="checkbox" data-field="${key}" ${fields[key] ? "checked" : ""} />
                ${label}
            </label>
        `).join("");

        return `
            <div class="summary-fields">${checks}</div>
            <div class="summary-options">
                <label class="summary-field-check">
                    <input type="checkbox" id="summaryToLlm" ${options.sendToLlm ? "checked" : ""} />
                    Send to LLM automatically
                </label>
                <label class="summary-field-check">
                    <input type="checkbox" id="summaryInChat" ${options.showInChat ? "checked" : ""} />
                    Show in chat bubble
                </label>
            </div>
        `;
    }

    function _onOptionClick(key, value, isGlobal) {
        const scope = isGlobal ? "global" : "session";
        window.ChatBehavior?.set({ [key]: value }, scope);

        // Update active state in popover
        document.querySelectorAll(`[data-key="${key}"]`).forEach(btn => {
            btn.classList.toggle("active", btn.dataset.val === value);
        });

        // Show/hide VFS summary sub-options
        if (key === "vfsMode") {
            const sub = document.getElementById("vfsSummaryOpts");
            if (sub) sub.classList.toggle("hidden", value !== "summary");
        }

        // Apply visual style immediately
        if (key === "visualStyle") {
            document.getElementById("app")?.classList.remove("style-comfortable", "style-compact", "style-focus");
            document.getElementById("app")?.classList.add(`style-${value}`);
        }
    }

    // ── popover open/close ────────────────────────────────────

    function _togglePopover() {
        _popoverOpen ? _closePopover() : _openPopover();
    }

    function _openPopover() {
        const popover = document.getElementById("behaviorPopover");
        const chevron = document.getElementById("sendChevron");
        if (!popover || !chevron) return;

        _rebuildPopoverContent();
        popover.classList.remove("hidden");
        _popoverOpen = true;

        // Position above the chevron button
        const rect   = chevron.getBoundingClientRect();
        const pw     = 320;
        const left   = Math.max(8, Math.min(rect.right - pw, window.innerWidth - pw - 8));
        popover.style.left   = `${left}px`;
        popover.style.bottom = `${window.innerHeight - rect.top + 6}px`;
        popover.style.width  = `${pw}px`;

        window.EventBus?.emit("sendbutton:popoverOpened", {});
    }

    function _closePopover() {
        document.getElementById("behaviorPopover")?.classList.add("hidden");
        _popoverOpen = false;
        window.EventBus?.emit("sendbutton:popoverClosed", {});
    }

    function _rebuildPopoverContent() {
        const popover = document.getElementById("behaviorPopover");
        if (popover) _buildPopoverContent(popover);
    }

    // ── _updateOverrideDot ────────────────────────────────────
    // Shows a dot on the chevron when session != global.
    // ── end of _updateOverrideDot ────────────────────────────

    function _updateOverrideDot() {
        const dot = document.getElementById("overrideDot");
        if (!dot || !window.ChatBehavior) return;
        // Check if any session overrides are active
        const behavior  = window.ChatBehavior.get();
        // Re-get defaults by resetting temporarily — too invasive.
        // Instead just check if EventBus has session overrides.
        // Simple heuristic: dot shows if vfsMode, streaming, responseMode, historyDepth are non-default
        const defaults  = { streaming: "stream", responseMode: "standard", historyDepth: "full", vfsMode: "reference" };
        const hasOverride = Object.entries(defaults).some(([k, v]) => behavior[k] !== v);
        dot.classList.toggle("hidden", !hasOverride);
    }

    // ── send ──────────────────────────────────────────────────

    function _onSend() {
        if (_disabled) return;
        window.EventBus?.emit("sendbutton:send", {});
        _sendFn?.();
    }

    function setDisabled(disabled) {
        _disabled = disabled;
        const btn = document.getElementById("sendBtn");
        if (btn) {
            btn.disabled    = disabled;
            btn.textContent = disabled ? "…" : "Send";
        }
        const chev = document.getElementById("sendChevron");
        if (chev) chev.disabled = disabled;
    }

    // ── window export ─────────────────────────────────────────
    window.SendButton = {
        MANIFEST,
        setDisabled,
        setSendFn: fn => { _sendFn = fn; },
        openPopover:  _openPopover,
        closePopover: _closePopover,
    };
    // ── end of window export ─────────────────────────────────

    // ── EventBus wiring ───────────────────────────────────────
    domReady(() => {
        _build();

        // Wire generate state to button disabled
        window.EventBus?.on("llmbridge:generateStarted",   () => setDisabled(true));
        window.EventBus?.on("llmbridge:generateCompleted", () => setDisabled(false));
        window.EventBus?.on("llmbridge:generateFailed",    () => setDisabled(false));

        // Register commands
        window.EventBus?.command("sendbutton", "setDisabled",  ({ disabled }) => setDisabled(disabled));
        window.EventBus?.command("sendbutton", "openPopover",  ()             => _openPopover());
        window.EventBus?.command("sendbutton", "closePopover", ()             => _closePopover());
    });
    // ── end of EventBus wiring ────────────────────────────────

})();
