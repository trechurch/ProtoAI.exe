// ============================================================
// ChatBehavior.ui.js — Chat Behavior State Manager
// version: 1.0.0
// depends: tauri-utils.js, EventBus.ui.js
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    // ── ChatBehavior.ui ──────────────────────────────────────
    // Owns all per-session and global chat behavior settings:
    //
    // STREAMING
    //   stream    — tokens stream as they arrive (default)
    //   full      — wait for complete response
    //
    // RESPONSE MODE
    //   standard  — normal single response (default)
    //   continue  — append to last assistant message
    //   summarize — summarize conversation so far
    //   refine    — rewrite last response with new instruction
    //
    // VISUAL STYLE  (global, per-session override available)
    //   comfortable — default padded bubbles
    //   compact     — tight spacing, more messages visible
    //   focus       — full width, distraction-free
    //
    // VFS MANIFEST MODE
    //   none      — manifests never appear in chat
    //   full      — complete manifest injected to LLM + shown in chat
    //   summary   — condensed manifest, granular field control
    //   reference — clickable chip only, nothing sent unless expanded
    //
    // VFS SUMMARY FIELDS (granular, used when mode = summary)
    //   language, exports, imports, functions, classes, sdoa,
    //   summary, preview, size, modified
    //   sendToLlm — whether summary is auto-injected to LLM
    //   showInChat — whether summary appears visible in chat bubble
    //
    // HISTORY DEPTH
    //   full   — entire conversation history
    //   10     — last 10 turns
    //   5      — last 5 turns
    //   none   — no history (single-turn)
    //
    // SPELLCHECK
    //   local  — client-side typo-js (default)
    //   engine — LLM-powered spellcheck
    //   off    — disabled
    // ── end of ChatBehavior.ui ───────────────────────────────

    // ── SDOA v3 MANIFEST ─────────────────────────────────────
    const MANIFEST = {
        id:      "ChatBehavior.ui",
        type:    "component",
        runtime: "Browser",
        version: "1.0.0",
        capabilities: [
            "behavior.streaming",
            "behavior.responseMode",
            "behavior.visualStyle",
            "behavior.vfsManifest",
            "behavior.historyDepth",
            "behavior.spellcheck",
            "settings.persist",
            "settings.sessionOverride"
        ],
        dependencies: ["tauri-utils.js", "EventBus.ui.js"],
        docs: {
            description: "Manages all chat behavior toggles. Global defaults persist to settings. Per-session overrides are in-memory and reset on project change. Emits behavior:changed on any change.",
            author: "ProtoAI team",
            sdoa_compatibility: "All versions forward/backward compatible."
        },
        actions: {
            commands: {
                get:            { description: "Get current effective behavior state.", input: {}, output: "BehaviorState" },
                set:            { description: "Set one or more behavior values.",      input: { updates: "object" }, output: "void" },
                setGlobal:      { description: "Persist a behavior value globally.",    input: { key: "string", value: "any" }, output: "void" },
                resetSession:   { description: "Reset session overrides to globals.",   input: {}, output: "void" },
                buildContext:   { description: "Build LLM context additions from current behavior (VFS manifests, history).", input: { message: "string", project: "string", attachedFiles: "string[]?" }, output: "ContextAdditions" },
            },
            triggers: {},
            emits: {
                "behavior:changed": { description: "Fires when any behavior value changes.", payload: { key: "string", value: "any", scope: "string" } },
                "behavior:reset":   { description: "Fires when session is reset to globals.", payload: {} },
            },
            workflows: {}
        }
    };
    // ── end of SDOA v3 MANIFEST ──────────────────────────────

    // ── defaults ──────────────────────────────────────────────
    const DEFAULTS = {
        streaming:      "stream",        // stream | full
        responseMode:   "standard",      // standard | continue | summarize | refine
        visualStyle:    "comfortable",   // comfortable | compact | focus
        vfsMode:        "reference",     // none | full | summary | reference
        historyDepth:   "full",          // full | 10 | 5 | none
        spellcheck:     "local",         // local | engine | off
        vfsSummaryFields: {
            language:   true,
            exports:    true,
            imports:    false,
            functions:  true,
            classes:    true,
            sdoa:       true,
            summary:    true,
            preview:    true,
            size:       false,
            modified:   false,
        },
        vfsSummaryOptions: {
            sendToLlm:  true,
            showInChat: true,
        },
    };
    // ── end of defaults ───────────────────────────────────────

    // ── state ─────────────────────────────────────────────────
    let _global  = { ...DEFAULTS };   // persisted to settings
    let _session = {};                 // in-memory overrides, reset per project
    // ── end of state ─────────────────────────────────────────

    // ── get ───────────────────────────────────────────────────
    // Returns the effective behavior state — session overrides
    // win over global, global wins over defaults.
    // ── end of get ───────────────────────────────────────────

    function get() {
        return { ..._global, ..._session };
    }

    // ── set ───────────────────────────────────────────────────
    // Set behavior values. scope="session" (default) or "global".
    // ── end of set ───────────────────────────────────────────

    function set(updates, scope = "session") {
        if (scope === "global") {
            Object.assign(_global, updates);
            _persistGlobal();
        } else {
            Object.assign(_session, updates);
        }

        Object.entries(updates).forEach(([key, value]) => {
            window.EventBus?.emit("behavior:changed", { key, value, scope });
        });

        // Apply visual style immediately
        if (updates.visualStyle) _applyVisualStyle(updates.visualStyle);
    }

    function setGlobal(key, value) {
        set({ [key]: value }, "global");
    }

    // ── resetSession ─────────────────────────────────────────

    function resetSession() {
        _session = {};
        _applyVisualStyle(_global.visualStyle);
        window.EventBus?.emit("behavior:reset", {});
    }

    // ── _persistGlobal ────────────────────────────────────────
    // Saves global behavior to settings via BackendConnector.
    // ── end of _persistGlobal ────────────────────────────────

    function _persistGlobal() {
        window.backendConnector?.runWorkflow("update_settings", {
            key:   "chatBehavior",
            value: _global
        }).catch(() => {}); // non-fatal — best effort
    }

    // ── _loadGlobal ───────────────────────────────────────────
    // Loads persisted global behavior from settings.
    // ── end of _loadGlobal ────────────────────────────────────

    async function _loadGlobal() {
        try {
            const settings = await window.backendConnector?.runWorkflow("get_settings");
            const saved    = settings?.chatBehavior || settings?.settings?.chatBehavior;
            if (saved) {
                _global = { ...DEFAULTS, ...saved };
                // Deep merge nested objects
                if (saved.vfsSummaryFields) {
                    _global.vfsSummaryFields = { ...DEFAULTS.vfsSummaryFields, ...saved.vfsSummaryFields };
                }
                if (saved.vfsSummaryOptions) {
                    _global.vfsSummaryOptions = { ...DEFAULTS.vfsSummaryOptions, ...saved.vfsSummaryOptions };
                }
            }
        } catch { /* use defaults */ }
        _applyVisualStyle(_global.visualStyle);
    }

    // ── _applyVisualStyle ─────────────────────────────────────
    // Applies visual style CSS class to #app.
    // ── end of _applyVisualStyle ─────────────────────────────

    function _applyVisualStyle(style) {
        const app = document.getElementById("app");
        if (!app) return;
        app.classList.remove("style-comfortable", "style-compact", "style-focus");
        app.classList.add(`style-${style || "comfortable"}`);
    }

    // ── buildContext ──────────────────────────────────────────
    // Builds LLM context additions based on current behavior.
    // Returns { systemAdditions, userPrefix, attachments } where:
    //   systemAdditions — injected into system prompt
    //   userPrefix      — prepended to user message
    //   attachments     — reference tags to show in chat UI
    // ── end of buildContext ───────────────────────────────────

    async function buildContext({ message, project, attachedFiles = [] }) {
        const state = get();
        const result = {
            systemAdditions: [],
            userPrefix:      "",
            attachments:     [],  // { id, name, manifest, mode }
            historySlice:    null,
        };

        // ── history depth ─────────────────────────────────────
        if (state.historyDepth !== "full") {
            const limit = state.historyDepth === "none" ? 0 :
                          state.historyDepth === "5"    ? 5 :
                          state.historyDepth === "10"   ? 10 : null;
            result.historySlice = limit;
        }

        // ── VFS manifest injection ────────────────────────────
        if (state.vfsMode !== "none" && attachedFiles.length > 0) {
            for (const filePath of attachedFiles) {
                try {
                    const res = await window.backendConnector?.runWorkflow("vfs_manifest", {
                        project, realPath: filePath
                    });
                    const manifest = res?.manifest;
                    if (!manifest) continue;

                    if (state.vfsMode === "full") {
                        // Full manifest → inject to LLM + show in chat
                        result.systemAdditions.push(
                            `[File context: ${manifest.meta?.name}]\n${JSON.stringify(manifest.purpose, null, 2)}`
                        );
                        result.attachments.push({
                            id:       manifest.id,
                            name:     manifest.meta?.name,
                            manifest,
                            mode:     "full",
                            showFull: true,
                        });

                    } else if (state.vfsMode === "summary") {
                        const summary = _buildSummary(manifest, state.vfsSummaryFields);
                        if (state.vfsSummaryOptions.sendToLlm) {
                            result.systemAdditions.push(
                                `[File summary: ${manifest.meta?.name}]\n${summary}`
                            );
                        }
                        result.attachments.push({
                            id:       manifest.id,
                            name:     manifest.meta?.name,
                            manifest,
                            mode:     "summary",
                            summary,
                            showInChat: state.vfsSummaryOptions.showInChat,
                        });

                    } else if (state.vfsMode === "reference") {
                        // Reference tag only — nothing sent to LLM unless user expands
                        result.attachments.push({
                            id:       manifest.id,
                            name:     manifest.meta?.name,
                            manifest,
                            mode:     "reference",
                            showFull: false,
                        });
                    }
                } catch { /* skip this file */ }
            }
        }

        return result;
    }

    // ── _buildSummary ─────────────────────────────────────────
    // Builds a text summary from a manifest using selected fields.
    // ── end of _buildSummary ─────────────────────────────────

    function _buildSummary(manifest, fields) {
        const p = manifest.purpose || {};
        const lines = [];
        if (fields.language  && p.language)   lines.push(`Language: ${p.language}`);
        if (fields.summary   && p.summary)    lines.push(`Summary: ${p.summary}`);
        if (fields.exports   && p.exports?.length)   lines.push(`Exports: ${p.exports.join(", ")}`);
        if (fields.imports   && p.imports?.length)   lines.push(`Imports: ${p.imports.slice(0,8).join(", ")}`);
        if (fields.functions && p.functions?.length) lines.push(`Functions: ${p.functions.slice(0,10).join(", ")}`);
        if (fields.classes   && p.classes?.length)  lines.push(`Classes: ${p.classes.join(", ")}`);
        if (fields.sdoa      && p.sdoa)       lines.push(`SDOA: ${p.sdoa.id} v${p.sdoa.version}`);
        if (fields.preview   && p.preview)    lines.push(`Preview:\n${p.preview.slice(0,200)}`);
        if (fields.size      && manifest.meta?.size) lines.push(`Size: ${(manifest.meta.size/1024).toFixed(1)}KB`);
        if (fields.modified  && manifest.meta?.modified) lines.push(`Modified: ${manifest.meta.modified}`);
        return lines.join("\n");
    }

    // ── window export ─────────────────────────────────────────
    window.ChatBehavior = { MANIFEST, get, set, setGlobal, resetSession, buildContext };
    // ── end of window export ─────────────────────────────────

    // ── EventBus wiring ───────────────────────────────────────
    domReady(() => {
        // Load global settings after bridge is ready
        setTimeout(_loadGlobal, 200);

        // Reset session when project changes
        window.EventBus?.on("app:projectSelected", () => resetSession());

        // Register commands on EventBus
        window.EventBus?.command("chatbehavior", "get",          ()         => get());
        window.EventBus?.command("chatbehavior", "set",          (p)        => set(p.updates, p.scope));
        window.EventBus?.command("chatbehavior", "setGlobal",    ({ key, value }) => setGlobal(key, value));
        window.EventBus?.command("chatbehavior", "resetSession", ()         => resetSession());
        window.EventBus?.command("chatbehavior", "buildContext", (p)        => buildContext(p));
    });
    // ── end of EventBus wiring ────────────────────────────────

})();
