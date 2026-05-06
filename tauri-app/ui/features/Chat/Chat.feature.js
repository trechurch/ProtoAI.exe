// ============================================================
// Last modified: 2026-05-04
// Chat.feature.js — SDOA v4 Feature | v4.0.1 | layer 1
// ============================================================

(function () {
    "use strict";

    const MANIFEST = {
        id: "Chat.feature", type: "feature", layer: 1,
        runtime: "Browser", version: "4.0.1",
        requires: ["Toast.prim", "Spinner.prim"],
        dataFiles: [],
        lifecycle: ["init", "mount"],
        actions: {
            commands: { sendMessage: {}, appendMessage: {}, clear: {}, loadHistory: {} },
            events: {},
            accepts: { "app:projectSelected": "loadHistory", "models:updated": "_populateSelects" },
            slots: ["pane-left"]
        },
        backendDeps: ["LoadProjectHistoryWorkflow"],
        docs: { description: "Main Chat Workspace Feature.", author: "ProtoAI team", sdoa: "4.0.0" }
    };

    let _container      = null;
    let _chatContainer  = null;
    let _scrollContainer = null;
    let _scrollMap      = null;
    let _viewport       = null;
    let _bottomBtn      = null;
    let _input          = null;

    async function init() {
        console.log("[Chat.feature] Initializing version 4.0.2...");
        if (window.EventBus) {
            window.EventBus.on("app:projectSelected", (payload) => {
                console.log("[Chat.feature] Project selected event received:", payload.project);
                loadHistory(payload.project);
            });
            // Re-populate selects after AutoOptimize runs
            window.EventBus.on("models:updated", () => {
                _populateSelects();
            });
        }
        console.log("[Chat.feature] Registration complete.");
    }

    async function mount(slotElement) {
        console.log("[Chat.feature] Mounting to:", slotElement || "default #pane-left");
        _container = slotElement || document.getElementById("pane-left");
        if (!_container) {
            console.error("[Chat.feature] Mount target not found!");
            return;
        }

        _container.style.display        = "flex";
        _container.style.flexDirection  = "column";
        _container.style.minHeight      = "100%";
        _container.style.background     = "transparent";

        _container.innerHTML = `
            <div id="chat-feature-main" style="display:flex; flex-direction:column; height:100%; width:100%; min-height: 500px; border: 1px solid rgba(255,255,255,0.05);">
            <div id="canvas" style="flex:1; min-height:0; overflow-y:auto; position:relative; padding: 20px;">
                <div id="chatContainer" style="max-width: 800px; margin: 0 auto; width: 100%;">
                    <div class="sdoa-chat-empty-state" id="chatEmptyState" style="text-align:center; padding: 100px 20px; opacity: 1 !important; visibility: visible !important;">
                        <h1 style="font-size: 32px; color: #fff; margin-bottom: 10px;">ProtoAI Chat</h1>
                        <p style="color: var(--text-muted);">Select a project and start chatting.</p>
                    </div>
                </div>

                <!-- Graduated scroll map -->
                <div id="chatScrollMap" title="Conversation map · click to jump">
                    <div id="chatScrollViewport"></div>
                </div>

                <!-- Scroll-to-bottom button -->
                <button id="scrollBottomBtn" class="scroll-bottom-btn hidden" title="Jump to latest">↓</button>
            </div>

            <section id="inputBar" style="display:block !important; visibility:visible !important; opacity:1 !important; background:var(--bg-elevated-2); border-top:1px solid var(--border-subtle); padding:16px;">
                <div id="inputTopRow" style="display:flex; gap:8px; margin-bottom:12px; align-items:center;">
                    <select id="profileSelect" class="sdoa-select sdoa-select--sm" style="flex:0 0 auto; min-width:120px;" title="Active profile"></select>
                    <select id="engineSelect"  class="sdoa-select sdoa-select--sm" style="flex:1;" title="Model to use for this message"></select>
                    <div style="display:flex; gap:4px;">
                        <button id="attachFileBtn" class="sdoa-button sdoa-button--ghost sdoa-button--sm" title="Attach file or folder">📎 Attach</button>
                        <button id="vfsImportBtn" class="sdoa-button sdoa-button--ghost sdoa-button--sm" title="Browse for folder to add to VFS">📂+VFS</button>
                        <button id="addSourceBtn" class="sdoa-button sdoa-button--ghost sdoa-button--sm" title="Add a source">➕ Source</button>
                        <button id="spellcheckToggle" class="sdoa-button sdoa-button--ghost sdoa-button--sm" title="Toggle spellcheck">ABC ✓</button>
                    </div>
                </div>
                <div id="inputMiddleRow" style="margin-bottom:12px; display:flex; flex-direction:column; gap:6px;">
                    <div id="attachmentStaging" style="display:none; flex-wrap:wrap; gap:6px; padding: 6px 8px; background:rgba(0,0,0,0.2); border:1px solid var(--border-subtle); border-radius:var(--radius);"></div>
                    <textarea id="messageInput" class="sdoa-input" rows="3" style="width:100%;" placeholder="Ask ProtoAI… (Shift+Enter for newline)"></textarea>
                </div>
                <div id="inputBottomRow" style="display:flex; justify-content:space-between; align-items:center;">
                    <div class="input-actions" style="display:flex; gap:8px;">
                        <button class="chip" data-action="image">🖼 Creator</button>
                        <button class="chip" data-action="image_gen">🖼️ Image</button>
                    </div>
                    <button id="sendBtn" class="sdoa-button sdoa-button--primary">
                        <span class="sdoa-button__icon">✈</span>
                    </button>
                </div>
                <input type="file" id="fileInput"   multiple           style="display:none;" />
                <input type="file" id="folderInput" webkitdirectory multiple style="display:none;" />
            </section>
            </div>
        `;

        _chatContainer   = _container.querySelector("#chatContainer");
        _scrollContainer = _container.querySelector("#canvas");
        _scrollMap       = _container.querySelector("#chatScrollMap");
        _viewport        = _container.querySelector("#chatScrollViewport");
        _bottomBtn       = _container.querySelector("#scrollBottomBtn");
        _input           = _container.querySelector("#messageInput");

        _wireEvents();
        _initChatScroll();

        // Populate dropdowns — deferred slightly so the DOM is settled
        setTimeout(() => _populateSelects(), 100);

        if (window.currentProject) loadHistory(window.currentProject);
    }

    // ── Select population ─────────────────────────────────────────

    async function _populateSelects() {
        try {
            // Fetch live settings from backend
            const raw = await window.backendConnector?.runWorkflow("get_settings").catch(() => null);
            const settings  = raw?.settings ?? raw?.data?.settings ?? raw ?? {};
            const defaults  = settings?.models?.defaults   || {};
            const failover  = settings?.models?.failoverList || [];

            // Build model options: deduplicated, picks labelled by role
            const pickedIds = new Set();
            const picks = [];
            for (const [role, id] of Object.entries(defaults)) {
                if (!id || pickedIds.has(id)) continue;
                pickedIds.add(id);
                picks.push({ id, label: `${id}  [${role}]` });
            }
            const pool = failover
                .filter(id => id && !pickedIds.has(id))
                .map(id => ({ id, label: id }));

            // Update every engine-select (chat bar + sidebar Quick Swap)
            const engineSelects = [
                _container?.querySelector("#engineSelect"),
                document.getElementById("otfmsEngineSelect"),
            ].filter(Boolean);

            for (const sel of engineSelects) {
                const prevVal = sel.value;
                sel.innerHTML = "";

                if (picks.length === 0 && pool.length === 0) {
                    sel.appendChild(new Option("Run 🪄 Optimize Models first", ""));
                } else {
                    if (picks.length > 0) {
                        const grp = document.createElement("optgroup");
                        grp.label = "Optimized picks";
                        picks.forEach(({ id, label }) => grp.appendChild(new Option(label, id)));
                        sel.appendChild(grp);
                    }
                    if (pool.length > 0) {
                        const grp = document.createElement("optgroup");
                        grp.label = "All available";
                        pool.forEach(({ id, label }) => grp.appendChild(new Option(label, id)));
                        sel.appendChild(grp);
                    }
                }

                // Restore previous selection if still valid
                if (prevVal && [...sel.options].some(o => o.value === prevVal)) sel.value = prevVal;
            }

            // Populate profile select
            await _populateProfileSelect(settings);

        } catch (err) {
            console.warn("[Chat.feature] _populateSelects failed:", err.message);
        }
    }

    async function _populateProfileSelect(settings) {
        const sel = _container?.querySelector("#profileSelect");
        if (!sel) return;

        // Try backend first, fall back to a static list
        let profiles = [
            { id: "default", name: "Default" },
            { id: "coding", name: "Coding" },
            { id: "research", name: "Research" },
            { id: "analysis", name: "Analysis" }
        ];

        try {
            const result = await window.backendConnector
                ?.runWorkflow("ListProfilesWorkflow").catch(() => null);
            const backendProfiles = result?.profiles ?? result?.data?.profiles;
            if (Array.isArray(backendProfiles) && backendProfiles.length > 0) {
                profiles = backendProfiles;
            }
        } catch (_) {}

        const prevVal = sel.value;
        sel.innerHTML = "";
        profiles.forEach(p => {
            const id = typeof p === "string" ? p : p.id;
            const name = typeof p === "string" ? p : (p.name || p.id);
            const label = name.charAt(0).toUpperCase() + name.slice(1);
            sel.appendChild(new Option(label, id));
        });

        const current = prevVal || window.currentProfile || "default";
        if ([...sel.options].some(o => o.value === current)) sel.value = current;

        // Keep window.currentProfile in sync
        sel.removeEventListener("change", _onProfileChange);
        sel.addEventListener("change", _onProfileChange);
    }

    function _onProfileChange(e) {
        window.currentProfile = e.target.value;
    }

    // ── Events ────────────────────────────────────────────────────

    function _wireEvents() {
        _container.querySelector("#sendBtn")?.addEventListener("click", () => handleSendMessage());

        _input?.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
        });

        _container.querySelectorAll(".chip").forEach(chip => {
            chip.addEventListener("click", (e) => {
                const action = e.target.dataset.action;
                if (window.ChatBehavior?.handleChipClick) {
                    window.ChatBehavior.handleChipClick(action, _input);
                } else if (_input) {
                    _input.value += `[/${action}] `;
                    _input.focus();
                }
            });
        });

        const fileInput = _container.querySelector("#fileInput");
        const folderInput = _container.querySelector("#folderInput");

        const handleFileSelect = (files) => {
            if (!files || files.length === 0) return;
            window._attachedFiles = window._attachedFiles || [];
            for (const f of files) {
                const path = f.path || f.name;
                if (!window._attachedFiles.some(af => af.path === path)) {
                    window._attachedFiles.push({ path, name: f.name, size: f.size });
                }
            }
            _renderAttachments();
        };

        fileInput?.addEventListener("change", (e) => handleFileSelect(e.target.files));
        folderInput?.addEventListener("change", (e) => handleFileSelect(e.target.files));

        _container.querySelector("#attachFileBtn")?.addEventListener("click", (e) => {
            if (e.ctrlKey) fileInput?.click();
            else           folderInput?.click();
        });

        _container.querySelector("#vfsImportBtn")?.addEventListener("click", async () => {
            try {
                const dialog = window.__TAURI__?.dialog || window.__TAURI__?.core?.dialog;
                let selected = null;
                if (dialog?.open) {
                    selected = await dialog.open({ directory: true, multiple: false, title: "Select folder to add to VFS" });
                } else {
                    selected = await window.__TAURI__.core.invoke("plugin:dialog|open", {
                        options: { directory: true, multiple: false, title: "Select folder to add to VFS" }
                    });
                }
                if (!selected) return;
                const folders = Array.isArray(selected) ? selected : [selected];
                
                let added = 0;
                for (const path of folders) {
                    try {
                        await window.backendConnector?.runWorkflow("vfs_add", {
                            project:   window.currentProject || "default",
                            realPath:  path,
                            recursive: true,
                        });
                        added++;
                    } catch(err) { console.warn(err); }
                }
                if (added > 0) {
                    window.EventBus?.emit("filemanager:vfsUpdated", { project: window.currentProject });
                    window.ToastPrim?.show("Folder added to VFS", "success");
                }
            } catch (err) {
                console.warn(err);
            }
        });

        _container.querySelector("#addSourceBtn")?.addEventListener("click", () => {
            window.ToastPrim?.show("Source integration coming soon", "info");
        });

        _container.querySelector("#spellcheckToggle")?.addEventListener("click", (e) => {
            const current = _input.getAttribute("spellcheck") === "true";
            _input.setAttribute("spellcheck", !current);
            window.ToastPrim?.show(`Spellcheck ${!current ? "ON" : "OFF"}`, "info");
            e.currentTarget.classList.toggle("sdoa-button--active", !current);
        });

        // Sidebar "Apply to Chat" button — copy Quick Swap selection into the chat engine select
        document.getElementById("applyEngineBtn")?.addEventListener("click", () => {
            const otfmsVal   = document.getElementById("otfmsEngineSelect")?.value;
            const engineSel  = _container?.querySelector("#engineSelect");
            if (!otfmsVal || !engineSel) return;
            if ([...engineSel.options].some(o => o.value === otfmsVal)) {
                engineSel.value = otfmsVal;
            }
            window.ToastPrim?.show(`Model switched to: ${otfmsVal}`, "success");
        });
    }

    // ── Send ──────────────────────────────────────────────────────

    async function handleSendMessage() {
        console.log("[Chat] handleSendMessage triggered");
        const messageInput = _container.querySelector("#messageInput");
        if (!messageInput) {
            console.error("[Chat] #messageInput not found in _container!");
            return;
        }
        const text = messageInput.value.trim();
        if (!text) {
            console.warn("[Chat] Empty message, ignoring.");
            return;
        }

        console.log("[Chat] Sending message:", text);
        messageInput.value = "";

        const behavior = window.ChatBehavior?.get() || {};
        let context = null;

        if (window.ChatBehavior) {
            context = await window.ChatBehavior.buildContext({
                message: text,
                project: window.currentProject || "default",
                attachedFiles: window._attachedFiles || [],
            }).catch(() => null);
        }

        console.log("[Chat] Appending user message...");
        appendMessage("user", text, window._attachedFiles);
        window._attachedFiles = [];
        _renderAttachments();
        console.log("[Chat] User message appended. Calling llmBridge...");

        try {
            _showThinking();
            if (!window.llmBridge) throw new Error("llmBridge not available");
            const response = await window.llmBridge.chat({
                project:       window.currentProject || "default",
                profile:       _container.querySelector("#profileSelect")?.value || window.currentProfile || "default",
                message:       text,
                engine:        _container.querySelector("#engineSelect")?.value || "",
                stream:        behavior.streaming === "stream",
                responseMode:  behavior.responseMode || "standard",
                historyDepth:  context?.historySlice ?? null,
                systemExtra:   (context?.systemAdditions || []).join("\n") || "",
                orchestrator:  context?.orchestrator?.enabled,
            });
            console.log("[Chat] Response received from llmBridge:", response);
            _hideThinking();
            appendMessage("assistant", response);
        } catch (err) {
            _hideThinking();
            const msg = err.message || String(err);
            appendMessage("error", `System Error: ${msg}`);

            if (msg.includes("402") || msg.toLowerCase().includes("quota")) {
                appendMessage("system", "💡 Tip: Economic fail-over triggered. Using local model.");
            } else if (msg.toLowerCase().includes("401") || msg.toLowerCase().includes("api key")) {
                appendMessage("system", "💡 Tip: Check your API key in Settings (Ctrl+Shift+S).");
            }
        }
    }

    // ── Messages ──────────────────────────────────────────────────

    function appendMessage(role, text, attachments) {
        if (!_chatContainer) return;

        const emptyState = _container.querySelector("#chatEmptyState");
        if (emptyState) emptyState.style.display = "none";

        const div = document.createElement("div");
        div.className = `sdoa-message sdoa-message--${role}`;

        const labels = { user: "You", assistant: "ProtoAI", error: "Error", system: "System" };
        const label  = document.createElement("div");
        label.className   = "sdoa-message__label";
        label.textContent = labels[role] || role;
        div.appendChild(label);

        const body = document.createElement("div");
        body.className = "sdoa-message__body";
        if (role === "assistant" && typeof window.marked !== "undefined") {
            body.innerHTML = window.marked.parse(String(text || ""));
        } else {
            body.textContent = String(text || "");
        }
        div.appendChild(body);

        if (attachments?.length) {
            const attRow = document.createElement("div");
            attRow.className = "message-attachments";
            attachments.forEach(att => attRow.appendChild(_buildManifestTag(att)));
            div.appendChild(attRow);
        }

        _chatContainer.appendChild(div);

        const isAtBottom = _scrollContainer.scrollHeight - _scrollContainer.scrollTop - _scrollContainer.clientHeight < 100;
        if (isAtBottom || role === "user") {
            _scrollContainer.scrollTop = _scrollContainer.scrollHeight;
        }

        _syncScrollMap();
    }

    function _buildManifestTag(att) {
        const icons = { code: "📄", document: "📃", data: "📊", image: "🖼", audio: "🎵", video: "🎬", generic: "📎" };
        const icon  = icons[att.manifest?.type] || "📎";

        const tag = document.createElement("div");
        tag.className = "manifest-tag";
        tag.innerHTML = `
            <span class="manifest-tag-icon">${icon}</span>
            <span class="manifest-tag-name">${att.name || "file"}</span>
            <span class="manifest-tag-type">${att.manifest?.type || "file"}</span>
            <span class="manifest-tag-expand">${att.showFull ? "▾" : "▸"}</span>
        `;

        if (att.mode === "full" || (att.mode === "summary" && att.showInChat)) {
            const expanded = document.createElement("div");
            expanded.className   = "manifest-expanded";
            expanded.textContent = att.mode === "summary"
                ? (att.summary || "")
                : JSON.stringify(att.manifest?.purpose || {}, null, 2);
            expanded.style.display = att.showFull ? "block" : "none";

            const actions = document.createElement("div");
            actions.className = "manifest-expanded-actions";
            actions.innerHTML = `
                <button class="goto-file-btn">Go to file →</button>
                <button class="include-llm-btn">Include in message</button>
            `;
            actions.querySelector(".goto-file-btn")?.addEventListener("click", () => {
                window.primaryPanel?.setSplitMode("vertical");
                window.primaryPanel?.setSecondaryMode("files");
                window.EventBus?.emit("filemanager:selectEntry", { id: att.id });
            });
            actions.querySelector(".include-llm-btn")?.addEventListener("click", () => {
                if (_input) _input.value += `\n[Include: ${att.name}]`;
            });

            tag.appendChild(expanded);
            tag.appendChild(actions);

            tag.addEventListener("click", () => {
                const isExpanded = expanded.style.display !== "none";
                expanded.style.display = isExpanded ? "none" : "block";
                tag.querySelector(".manifest-tag-expand").textContent = isExpanded ? "▸" : "▾";
            });

        } else if (att.mode === "reference") {
            tag.addEventListener("click", async () => {
                let expanded = tag.querySelector(".manifest-expanded");
                if (expanded) {
                    expanded.style.display = expanded.style.display === "none" ? "block" : "none";
                    return;
                }
                tag.querySelector(".manifest-tag-expand").textContent = "…";
                try {
                    const res = await window.backendConnector.runWorkflow("vfs_manifest", {
                        project: window.currentProject,
                        id:      att.id,
                    });
                    expanded = document.createElement("div");
                    expanded.className   = "manifest-expanded";
                    expanded.textContent = JSON.stringify(res?.manifest?.purpose || {}, null, 2);

                    const actions = document.createElement("div");
                    actions.className = "manifest-expanded-actions";
                    actions.innerHTML = `<button class="goto-file-btn">Go to file →</button>`;
                    actions.querySelector(".goto-file-btn")?.addEventListener("click", () => {
                        window.primaryPanel?.setSplitMode("vertical");
                        window.primaryPanel?.setSecondaryMode("files");
                        window.EventBus?.emit("filemanager:selectEntry", { id: att.id });
                    });

                    tag.appendChild(expanded);
                    tag.appendChild(actions);
                    tag.querySelector(".manifest-tag-expand").textContent = "▾";
                } catch {
                    tag.querySelector(".manifest-tag-expand").textContent = "✕";
                }
            });
        }

        return tag;
    }

    function _renderAttachments() {
        const staging = _container.querySelector("#attachmentStaging");
        if (!staging) return;
        const files = window._attachedFiles || [];
        if (files.length === 0) {
            staging.style.display = "none";
            staging.innerHTML = "";
            return;
        }
        staging.style.display = "flex";
        staging.innerHTML = "";
        files.forEach((f, idx) => {
            const chip = document.createElement("div");
            chip.className = "chip";
            chip.style.backgroundColor = "rgba(79, 140, 255, 0.1)";
            chip.style.borderColor = "var(--border-mid)";
            chip.innerHTML = `📎 ${f.name} <span class="remove-att" style="margin-left:6px; cursor:pointer; color:var(--color-error); font-weight:bold;" title="Remove">✕</span>`;
            chip.querySelector(".remove-att").addEventListener("click", () => {
                window._attachedFiles.splice(idx, 1);
                _renderAttachments();
            });
            staging.appendChild(chip);
        });
    }

    function _showThinking() {
        _hideThinking();
        if (!_chatContainer) return;
        const thinking = document.createElement("div");
        thinking.id = "chatThinking";
        thinking.className = "sdoa-message sdoa-message--assistant sdoa-message--thinking";
        thinking.style.opacity = "0.7";
        
        const body = document.createElement("div");
        body.className = "sdoa-message__body";
        const spinner = window.SpinnerPrim?.create({ size: "sm", label: "Thinking..." });
        if (spinner) {
            body.appendChild(spinner);
        } else {
            body.textContent = "Thinking...";
        }
        thinking.appendChild(body);
        _chatContainer.appendChild(thinking);
        _scrollContainer.scrollTop = _scrollContainer.scrollHeight;
    }

    function _hideThinking() {
        _container.querySelector("#chatThinking")?.remove();
    }

    // ── Helper ────────────────────────────────────────────────────

    function _initChatScroll() {
        if (!_scrollContainer) return;

        _scrollContainer.addEventListener("scroll", () => {
            const isAtBottom = _scrollContainer.scrollHeight - _scrollContainer.scrollTop - _scrollContainer.clientHeight < 100;
            if (_bottomBtn) _bottomBtn.classList.toggle("hidden", isAtBottom);
            _updateScrollViewport();
        });

        _bottomBtn?.addEventListener("click", () => {
            _scrollContainer.scrollTo({ top: _scrollContainer.scrollHeight, behavior: "smooth" });
        });

        _scrollMap?.addEventListener("click", (e) => {
            const rect    = _scrollMap.getBoundingClientRect();
            const percent = (e.clientY - rect.top) / rect.height;
            _scrollContainer.scrollTop = percent * _scrollContainer.scrollHeight - _scrollContainer.clientHeight / 2;
        });

        _syncScrollMap();
    }

    function _syncScrollMap() {
        if (!_scrollContainer || !_chatContainer || !_scrollMap) return;

        _scrollMap.querySelectorAll(".csm-seg").forEach(s => s.remove());

        const messages    = _chatContainer.querySelectorAll(".sdoa-message");
        const totalHeight = _scrollContainer.scrollHeight;

        messages.forEach(msg => {
            const roleClass = Array.from(msg.classList)
                .find(c => c.startsWith("sdoa-message--"))?.replace("sdoa-message--", "") || "user";
            const top    = (msg.offsetTop    / totalHeight) * 100;
            const height = (msg.offsetHeight / totalHeight) * 100;

            const seg = document.createElement("div");
            seg.className = `csm-seg ${roleClass}`;
            seg.style.top    = `${top}%`;
            seg.style.height = `${Math.max(1, height)}%`;
            _scrollMap.appendChild(seg);
        });

        _updateScrollViewport();
    }

    function _updateScrollViewport() {
        if (!_scrollContainer || !_viewport) return;
        const totalHeight = _scrollContainer.scrollHeight;
        const top         = (_scrollContainer.scrollTop    / totalHeight) * 100;
        const height      = (_scrollContainer.clientHeight / totalHeight) * 100;
        _viewport.style.top    = `${top}%`;
        _viewport.style.height = `${height}%`;
    }

    // ── History ───────────────────────────────────────────────────

    async function loadHistory(project) {
        try {
            if (!window.backendConnector) return;
            const result  = await window.backendConnector.runWorkflow("LoadProjectHistoryWorkflow", { project });
            const history = result?.history || result?.data?.history || [];

            if (!_chatContainer) return;
            _chatContainer.querySelectorAll(".sdoa-message").forEach(m => m.remove());
            history.forEach(entry => {
                if (entry.role && entry.message) appendMessage(entry.role, entry.message);
            });
        } catch (err) {
            console.warn("[Chat.feature.js] loadHistory failed:", err.message);
        }
    }

    window.ChatFeature = { MANIFEST, init, mount, handleSendMessage, appendMessage, loadHistory, populateSelects: _populateSelects };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { init, mount, handleSendMessage, appendMessage, loadHistory });

})();
