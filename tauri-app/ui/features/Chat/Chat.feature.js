/* ============================================================
   Chat.feature.js — SDOA v4 Chat Interface
   version: 4.3.0
   Last modified: 2026-05-09
   Changes vs 4.2.0:
     - Streaming support: listens for Tauri chat-stream events,
       renders chunks live into a bubble, finalizes on resolve.
     - History loading: on app:projectSelected, fetches and
       renders the last 20 messages from engine_history.
     - settings:changed listener for hot-apply awareness.
   ============================================================ */

(function () {
    "use strict";

    const MANIFEST = {
        id:      "Chat.feature",
        type:    "feature",
        layer:   2,
        runtime: "Browser",
        version: "4.3.0",
        requires: ["BackendConnector.ui", "EventBus.ui"],
        docs: {
            description: "Primary user interaction surface. Handles messaging, streaming, and command processing.",
            author: "ProtoAI Team"
        }
    };

    let _chatContainer = null;
    let _chatInput     = null;
    let _isStreaming   = false;

    // Input history (up/down arrow nav)
    let _history    = [];
    let _historyIdx = -1;
    let _tempInput  = "";

    // ── Module Interface ──────────────────────────────────────

    async function init() {
        console.log(`[Chat.feature] Initializing v${MANIFEST.version}...`);
        try {
            _verifyDOM();
            _wireEvents();

            // Force reset: unlock input if a silent-partner watchdog fires
            window.EventBus?.on("app:force_reset", () => {
                console.log("[Chat.feature] Force reset triggered. Unlocking input.");
                _isStreaming = false;
                if (_chatInput) {
                    _chatInput.disabled = false;
                    _chatInput.focus();
                }
            });

            // Hot-apply settings toast
            window.EventBus?.on("settings:changed", () => {
                window.ToastPrim?.show("Settings applied. Model and API changes are live.", "info");
            });

            console.log("[Chat.feature] Ready.");
        } catch (err) {
            console.error("[Chat.feature] Init failed:", err);
            window.EventBus?.emit("module:error", { id: MANIFEST.id, phase: "init", error: err.message });
        }
    }

    async function mount(slotElement) {
        console.log("[Chat.feature] Mounting UI...");
        const target = slotElement || document.getElementById("pane-left");
        if (!target) {
            console.warn("[Chat.feature] No mount target found.");
            return;
        }

        target.innerHTML = `
            <div id="chat-feature-main" style="display:flex; flex-direction:column; height:100%; overflow:hidden;">
                <div id="chatMessages" style="flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:16px;">
                    <div class="chat-empty-state" style="text-align:center; padding-top:100px; color:var(--text-dim);">
                        <h2>ProtoAI Assistant</h2>
                        <p>Select a project to begin context-aware development.</p>
                    </div>
                </div>
                <div id="chatInputArea" style="padding:16px; background:var(--bg-elevated); border-top:1px solid var(--border-subtle);">
                    <div style="display:flex; gap:12px; margin-bottom:12px;">
                        <button class="chip" data-action="image">🖼 Creator</button>
                        <button class="chip" data-action="deepsearch">🔍 Research</button>
                    </div>
                    <div style="display:flex; gap:12px; align-items:flex-end;">
                        <textarea id="chatInput" class="sdoa-input" placeholder="Type a message... (Shift+Enter for newline)"
                                  style="flex:1; min-height:44px; max-height:200px; resize:none; padding:12px;"></textarea>
                        <button id="chatSendBtn" class="sdoa-button sdoa-button--primary" style="height:44px; width:44px; display:flex; align-items:center; justify-content:center; padding:0;">
                            ✈
                        </button>
                    </div>
                </div>
            </div>
        `;

        _chatContainer = document.getElementById("chatMessages");
        _chatInput     = document.getElementById("chatInput");

        _wireEvents();
    }

    function _verifyDOM() {
        console.log("[Chat.feature] DOM validation scheduled for mount.");
    }

    function _wireEvents() {
        const sendBtn = document.getElementById("chatSendBtn");
        const input   = document.getElementById("chatInput");

        if (!sendBtn || !input) return;

        sendBtn.addEventListener("click", () => _handleSend());

        // Right-click context menu for routing mode toggle
        sendBtn.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            if (window.ContextMenuPrim) {
                window.ContextMenuPrim.show({
                    items: [
                        { label: "Single Routing",  icon: "👤", onClick: () => _setOrchestrator(false) },
                        { label: "Multi Routing",   icon: "🌐", onClick: () => _setOrchestrator(true)  },
                        { separator: true },
                        { label: "Clear Chat history", icon: "🗑", onClick: () => _clearHistory() }
                    ],
                    position: { x: e.clientX, y: e.clientY }
                });
            } else {
                const mode = confirm("Switch to Multi-Model Routing?") ? "true" : "false";
                localStorage.setItem("protoai:orchestrator:enabled", mode);
                window.EventBus?.emit("app:force_reset");
            }
        });

        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                _handleSend();
                return;
            }
            if (e.key === "ArrowUp" && input.selectionStart === 0)      _navigateHistory(1);
            if (e.key === "ArrowDown" && input.selectionStart === input.value.length) _navigateHistory(-1);

            // Auto-resize
            input.style.height = "auto";
            input.style.height = input.scrollHeight + "px";
        });

        // System events
        window.EventBus?.on("chat:appendSystemMessage", (data) => _appendMessage("system", data.text));
        window.EventBus?.on("chat:promptOptimize",     (data) => _optimizePrompt(data.text));
        window.EventBus?.on("chat:deepSearch",         (data) => _runDeepSearch(data.query));

        // Project switch: show context banner then load history
        window.EventBus?.on("app:projectSelected", async (data) => {
            _appendMessage("system", `Context switched to: **${data.project}**`);
            await _loadHistory(data.project);
        });
    }

    function _setOrchestrator(enabled) {
        localStorage.setItem("protoai:orchestrator:enabled", enabled ? "true" : "false");
        window.ToastPrim?.show(`Routing: ${enabled ? "Multi-Model" : "Single"} mode`, "info");
    }

    // ── History Navigation ───────────────────────────────────

    function _navigateHistory(dir) {
        if (_history.length === 0) return;
        if (_historyIdx === -1) _tempInput = _chatInput.value;

        _historyIdx += dir;
        if (_historyIdx < -1) _historyIdx = -1;
        if (_historyIdx >= _history.length) _historyIdx = _history.length - 1;

        _chatInput.value = (_historyIdx === -1)
            ? _tempInput
            : _history[(_history.length - 1) - _historyIdx];
    }

    // ── Load persistent history on project select ────────────

    async function _loadHistory(project) {
        if (!project || !window.backendConnector) return;
        try {
            const res = await window.backendConnector.runWorkflow("history", { project });
            const msgs = res?.history || res?.data?.history || [];
            if (msgs.length === 0) return;

            // Render the most recent 20 messages so we don't flood the pane
            const recent = msgs.slice(-20);
            for (const msg of recent) {
                const role = msg.role === "user" ? "user" : "assistant";
                const text = msg.message || msg.content || "";
                if (text) _appendMessage(role, text);
            }
        } catch (err) {
            console.warn("[Chat.feature] History load failed:", err);
        }
    }

    // ── Send ─────────────────────────────────────────────────

    async function _handleSend() {
        if (_isStreaming) return;

        const input = document.getElementById("chatInput");
        const text  = input?.value.trim();
        if (!text) return;

        _history.push(text);
        if (_history.length > 50) _history.shift();
        _historyIdx = -1;

        input.value = "";
        input.style.height = "auto";
        _appendMessage("user", text);

        const project      = window.currentProject || "default";
        const orchestrator = localStorage.getItem("protoai:orchestrator:enabled") !== "false";
        const workflow     = orchestrator ? "multi_model_send" : "chat";

        let streamUnlisten = null;
        let streamEl       = null;

        try {
            _isStreaming      = true;
            input.disabled    = true;

            // Create the reply bubble immediately so chunks can flow in
            streamEl = _createStreamBubble();

            // Subscribe to Tauri streaming events before starting the request
            if (window.__TAURI__?.event?.listen) {
                streamUnlisten = await window.__TAURI__.event.listen("chat-stream", (event) => {
                    const chunk = event.payload?.chunk ?? event.payload;
                    if (typeof chunk === "string" && chunk) {
                        _appendToStream(streamEl, chunk);
                    }
                });
            }

            const res = await window.backendConnector?.runWorkflow(workflow, {
                message: text,
                project,
                stream:  true,
            });

            // Streaming: chunks already rendered; just finalize the bubble.
            // Non-streaming fallback: res.response holds the full reply.
            const reply = res?.response || res?.data?.response || "";
            const gotChunks = streamEl._content.textContent.trim().length > 0;

            if (gotChunks) {
                _finalizeStream(streamEl);
            } else {
                // Server ran non-streaming — render the complete reply
                _finalizeStream(streamEl, reply || "Model returned no text. Check your API keys and profile settings.");
            }

        } catch (err) {
            console.error("[Chat] Send failed:", err);
            const msg = (typeof err === "string") ? err : (err.message || "Unknown error");
            if (streamEl) {
                _finalizeStream(streamEl, `**Error:** ${msg}`);
            } else {
                _appendMessage("system", `**Error:** ${msg}`);
            }
            window.ToastPrim?.show("Message delivery failed", "error");
        } finally {
            _isStreaming   = false;
            input.disabled = false;
            input.focus();
            if (streamUnlisten) streamUnlisten();
        }
    }

    // ── Streaming bubble helpers ─────────────────────────────

    function _createStreamBubble() {
        const msgList = document.getElementById("chatMessages");
        if (!msgList) return null;

        const empty = msgList.querySelector(".chat-empty-state");
        if (empty) empty.style.display = "none";

        const el = document.createElement("div");
        el.className = "chat-message chat-message--assistant chat-message--streaming";
        el.style.cssText = "display:flex; gap:12px; padding:12px; border-radius:8px;";

        const content = document.createElement("div");
        content.className = "content";
        content.style.cssText = "flex:1; line-height:1.5; font-size:14px; overflow-wrap:anywhere;";

        const cursor = document.createElement("span");
        cursor.className = "stream-cursor";
        cursor.style.cssText = "display:inline-block; width:8px; height:14px; background:currentColor; margin-left:2px; animation:blink 1s step-end infinite; vertical-align:text-bottom;";

        el.innerHTML = `
            <div class="avatar" style="width:32px; height:32px; border-radius:16px; background:var(--accent); display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; font-size:12px; flex-shrink:0;">AI</div>
        `;
        el.appendChild(content);
        content.appendChild(cursor);

        // Stash references for later mutation
        el._content = content;
        el._cursor  = cursor;

        msgList.appendChild(el);
        msgList.scrollTop = msgList.scrollHeight;
        return el;
    }

    function _appendToStream(el, chunk) {
        if (!el || !el._content) return;
        // Insert raw text before the cursor
        const text = document.createTextNode(chunk);
        el._content.insertBefore(text, el._cursor);
        const msgList = document.getElementById("chatMessages");
        if (msgList) msgList.scrollTop = msgList.scrollHeight;
    }

    function _finalizeStream(el, fallbackText) {
        if (!el) return;
        // Remove the blinking cursor
        el._cursor?.remove();
        el.classList.remove("chat-message--streaming");

        if (fallbackText !== undefined) {
            // Non-streamed path — render markdown-ish HTML into the content div
            if (el._content) {
                el._content.innerHTML = _renderMarkdown(fallbackText);
            }
        } else {
            // Streamed path — content is already plain text nodes; leave as-is
            // (markdown rendering would require a re-pass but keeps things simple)
        }

        const msgList = document.getElementById("chatMessages");
        if (msgList) msgList.scrollTop = msgList.scrollHeight;

        const fullText = el._content?.textContent || "";
        window.EventBus?.emit("chat:appendMessage", { role: "assistant", text: fullText });
    }

    // ── Prompt optimization & deep search ───────────────────

    async function _optimizePrompt(text) {
        window.ToastPrim?.show("Optimizing prompt...", "info");
        try {
            const res = await window.backendConnector?.runWorkflow("Engineer.workflow", { message: text });
            const optimized = res?.data?.prompt || res?.prompt;
            const input = document.getElementById("chatInput");
            if (optimized && input) {
                input.value = optimized;
                input.focus();
                window.ToastPrim?.show("Prompt enhanced!", "success");
            }
        } catch (err) {
            window.ToastPrim?.show("Optimization failed", "error");
        }
    }

    async function _runDeepSearch(query) {
        _appendMessage("system", `Starting DeepSearch for: *${query}*`);
        try {
            const res = await window.backendConnector?.runWorkflow("deep_search", { query });
            const summary = res?.data?.summary || res?.summary;
            if (summary) _appendMessage("assistant", summary);
        } catch (err) {
            _appendMessage("system", "DeepSearch failed: " + err.message);
        }
    }

    // ── UI helpers ───────────────────────────────────────────

    function _clearHistory() {
        if (!_chatContainer) return;
        _chatContainer.innerHTML = `
            <div class="chat-empty-state" style="text-align:center; padding-top:100px; color:var(--text-dim);">
                <h2>ProtoAI Assistant</h2>
                <p>Chat history cleared. Context is now fresh.</p>
            </div>
        `;
        _history    = [];
        _historyIdx = -1;
        window.ToastPrim?.show("Chat history cleared.", "info");
    }

    function _appendMessage(role, text) {
        const msgList = document.getElementById("chatMessages");
        if (!msgList) return;

        const empty = msgList.querySelector(".chat-empty-state");
        if (empty) empty.style.display = "none";

        const msg = document.createElement("div");
        msg.className = `chat-message chat-message--${role}`;
        msg.style.cssText = `display:flex; gap:12px; padding:12px; border-radius:8px; background:${role === "user" ? "rgba(255,255,255,0.03)" : "transparent"};`;

        const label = role === "user" ? "U" : (role === "system" ? "⚙" : "AI");
        msg.innerHTML = `
            <div class="avatar" style="width:32px; height:32px; border-radius:16px; background:var(--accent); display:flex; align-items:center; justify-content:center; color:white; font-weight:bold; font-size:12px; flex-shrink:0;">${label}</div>
            <div class="content" style="flex:1; line-height:1.5; font-size:14px; overflow-wrap:anywhere;">${_renderMarkdown(text)}</div>
        `;

        msgList.appendChild(msg);
        msgList.scrollTop = msgList.scrollHeight;

        window.EventBus?.emit("chat:appendMessage", { role, text });
    }

    function _renderMarkdown(text) {
        return String(text || "")
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
            .replace(/\*(.*?)\*/g, "<em>$1</em>")
            .replace(/`([^`]+)`/g, "<code style='background:rgba(255,255,255,0.08);padding:1px 4px;border-radius:3px;'>$1</code>")
            .replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" style="max-width:100%; border-radius:8px; margin-top:8px; display:block;">')
            .replace(/\n/g, "<br>");
    }

    // ── Exports ───────────────────────────────────────────────

    const feature = { MANIFEST, init, mount, appendMessage: _appendMessage };
    window.ChatFeature = feature;
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, feature);

})();
