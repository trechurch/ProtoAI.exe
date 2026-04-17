// ============================================================
// app.js — SDOA Surface Layer
// version: 1.2.0
// depends: all .ui.js modules (loaded before this file)
// ============================================================

// ── module instances ─────────────────────────────────────────
// All instances are created by their respective .ui.js modules
// via domReady() and exposed on window. Do NOT instantiate
// here — the modules own their lifecycle.
// ── end of module instances ──────────────────────────────────

// Convenience aliases — resolved after domReady
let backend     = null;
let fileManager = null;
let qmd         = null;
let policy      = null;
let ai          = null;

// ── app state ────────────────────────────────────────────────
let currentProfile  = "default";
let commandPalette  = null;
// ── end of app state ─────────────────────────────────────────

// ── _waitForBridge ───────────────────────────────────────────
// Polls engine_status until the Node sidecar is ready.
// Times out after maxAttempts and resolves false so the
// app degrades gracefully rather than hanging forever.
// ── end of _waitForBridge ────────────────────────────────────

async function _waitForBridge(maxAttempts = 20, intervalMs = 500) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const status = await window.__TAURI__.core.invoke("engine_status");
            if (status === "ready") return true;
        } catch { /* not ready yet */ }
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
}

// ── init ─────────────────────────────────────────────────────
// Main initialization. Waits for the Node sidecar bridge to
// be ready before making any engine calls.
// ── end of init ──────────────────────────────────────────────

async function init() {
    // Resolve window instances — set by .ui.js modules on domReady
    backend     = window.backendConnector;
    fileManager = window.fileManager;
    qmd         = window.qmdAdapter;
    policy      = window.llmPolicyEngine;
    ai          = window.llmBridge;

    const sidebarStatus = document.getElementById("sidebarStatusText");
    if (sidebarStatus) sidebarStatus.textContent = "Starting engine…";

    // Wait for Node sidecar to be ready before any engine calls
    const ready = await _waitForBridge();
    if (!ready) {
        console.warn("[app.js] Engine bridge timed out — continuing in degraded mode");
        backend?.setBackendStatus("unavailable", "Engine timed out");
    } else {
        backend?.setBackendStatus("tauri");
    }

    if (sidebarStatus) sidebarStatus.textContent = ready ? "Tauri IPC" : "Degraded";

    try {
        const flags = await backend.runWorkflow("get_launch_flags").catch(() => null);
        if (flags?.setupWizard) {
            if (typeof window.openFirstRunWizard === "function") {
                window.openFirstRunWizard();
            }
            return;
        }

        const treeContainer = document.getElementById("fileTreeContainer");
        if (treeContainer) await fileManager.render(treeContainer);

        if (ready) {
            const currentPolicy = await policy.getPolicy().catch(() => null);
            await updateProfileUI(currentPolicy?.activeProfile);

            // ── load projects + auto-select default ──────────
            await loadProjects();
            // ── end of load projects ─────────────────────────
        }

        backend.setBackendStatus("tauri");

    } catch (err) {
        console.error("[SDOA Init Error]", err);
        backend?.setBackendStatus("unavailable", err.message);
    }
}

// ── handleSendMessage ────────────────────────────────────────
// Reads the message input, appends user message, calls the
// LlmBridge, and appends the response.
// ── end of handleSendMessage ─────────────────────────────────

async function handleSendMessage() {
    const input = document.getElementById("messageInput");
    const text  = input?.value.trim();
    if (!text) return;

    input.value = "";

    // ── build context additions from ChatBehavior ─────────────
    const behavior = window.ChatBehavior?.get() || {};
    let   context  = null;

    if (window.ChatBehavior) {
        context = await window.ChatBehavior.buildContext({
            message:       text,
            project:       window.currentProject || "default",
            attachedFiles: window._attachedFiles || [],
        }).catch(() => null);
    }

    // ── append user message with any attachments ──────────────
    appendMessage("user", text, context?.attachments);
    window._attachedFiles = []; // clear after send

    try {
        const response = await ai.chat({
            project:      window.currentProject || "default",
            profile:      currentProfile,
            message:      text,
            engine:       document.getElementById("engineSelect")?.value || "",
            stream:       behavior.streaming === "stream",
            responseMode: behavior.responseMode || "standard",
            historyDepth: context?.historySlice ?? null,
            systemExtra:  (context?.systemAdditions || []).join("\n") || "",
        });
        appendMessage("assistant", response);

    } catch (err) {
        appendMessage("error", `System Error: ${err.message}`);
        if (err.message?.includes("402")) {
            appendMessage("system", "💡 Tip: Economic fail-over triggered. Using local model.");
        }
    }
}

// ── toggleCommandPalette ─────────────────────────────────────

function toggleCommandPalette() {
    if (commandPalette) return hideCommandPalette();

    commandPalette = document.createElement("div");
    commandPalette.id        = "commandPalette";
    commandPalette.className = "sdoa-palette-overlay";
    commandPalette.innerHTML = `
        <div class="palette-inner">
            <input type="text" id="paletteInput" placeholder="Semantic search (qmd)..." />
            <div id="paletteResults"></div>
        </div>
    `;
    document.body.appendChild(commandPalette);

    const paletteInput = document.getElementById("paletteInput");
    paletteInput.focus();

    paletteInput.addEventListener("input", async e => {
        if (e.target.value.length > 2) {
            const results = await qmd.search(e.target.value);
            renderPaletteResults(results);
        }
    });

    document.addEventListener("keydown", e => {
        if (e.key === "Escape") hideCommandPalette();
    }, { once: true });
}

function hideCommandPalette() {
    commandPalette?.remove();
    commandPalette = null;
}

function renderPaletteResults(results) {
    const container = document.getElementById("paletteResults");
    if (!container) return;
    container.innerHTML = "";
    if (!results?.length) {
        container.innerHTML = `<div style="padding:10px;color:var(--text-dim);">No results</div>`;
        return;
    }
    results.forEach(r => {
        const div = document.createElement("div");
        div.className   = "palette-result";
        div.textContent = r.title || r.path || r;
        container.appendChild(div);
    });
}

// ── updateProfileUI ──────────────────────────────────────────

async function updateProfileUI(name) {
    currentProfile = name || "default";

    try {
        await policy.updatePolicy({ activeProfile: currentProfile });
    } catch (e) {
        console.warn("[app.js] updateProfileUI policy sync failed:", e);
    }

    const badge = document.getElementById("currentProfileName");
    if (badge) {
        badge.textContent = currentProfile.charAt(0).toUpperCase() + currentProfile.slice(1);
    }
}

// ── appendMessage ────────────────────────────────────────────

function appendMessage(role, text, attachments) {
    const container = document.getElementById("chatContainer");
    if (!container) return;

    const emptyState = document.getElementById("chatEmptyState");
    if (emptyState) emptyState.style.display = "none";

    const div = document.createElement("div");
    div.className = `message message-${role}`;

    // ── label ─────────────────────────────────────────────────
    const labels = { user: "You", assistant: "ProtoAI", error: "Error", system: "System" };
    const label  = document.createElement("div");
    label.className   = "message-label";
    label.textContent = labels[role] || role;
    div.appendChild(label);

    // ── body — render markdown for assistant messages ─────────
    const body = document.createElement("div");
    body.className = "message-body";
    if (role === "assistant" && typeof window.marked !== "undefined") {
        body.innerHTML = window.marked.parse(String(text || ""));
    } else {
        body.textContent = String(text || "");
    }
    div.appendChild(body);

    // ── manifest attachments ──────────────────────────────────
    if (attachments?.length) {
        const attRow = document.createElement("div");
        attRow.className = "message-attachments";
        attachments.forEach(att => attRow.appendChild(_buildManifestTag(att)));
        div.appendChild(attRow);
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// ── _buildManifestTag ────────────────────────────────────────
// Builds a clickable manifest reference tag for chat bubbles.
// ── end of _buildManifestTag ────────────────────────────────

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

    // Show inline content if mode is full or summary with showInChat
    if (att.mode === "full" || (att.mode === "summary" && att.showInChat)) {
        const expanded = document.createElement("div");
        expanded.className = "manifest-expanded";
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
            const input = document.getElementById("messageInput");
            if (input) input.value += `
[Include: ${att.name}]`;
        });

        tag.appendChild(expanded);
        tag.appendChild(actions);

        // Toggle expand on click
        tag.addEventListener("click", () => {
            const isExpanded = expanded.style.display !== "none";
            expanded.style.display = isExpanded ? "none" : "block";
            tag.querySelector(".manifest-tag-expand").textContent = isExpanded ? "▸" : "▾";
        });
    } else if (att.mode === "reference") {
        // Reference tag — click loads manifest then shows it
        tag.addEventListener("click", async () => {
            let expanded = tag.querySelector(".manifest-expanded");
            if (expanded) {
                expanded.style.display = expanded.style.display === "none" ? "block" : "none";
                return;
            }
            // Load manifest on first click
            tag.querySelector(".manifest-tag-expand").textContent = "…";
            try {
                const res = await backend.runWorkflow("vfs_manifest", {
                    project: window.currentProject,
                    id:      att.id,
                });
                expanded = document.createElement("div");
                expanded.className = "manifest-expanded";
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

// ── refreshFileManager ───────────────────────────────────────
// Called by FileManager.ui.js after drag/drop moves.

function refreshFileManager() {
    // Delegate to PrimaryPanel which owns the right pane
    window.EventBus?.emit("app:projectSelected", { project: window.currentProject });
}
window.refreshFileManager = refreshFileManager;

// ── handleFileSelection ──────────────────────────────────────
// Called by FileManager.ui.js on file row click.

function handleFileSelection(e, row, path) {
    document.querySelectorAll(".file-row").forEach(r => r.classList.remove("selected"));
    row.classList.add("selected");
}
window.handleFileSelection = handleFileSelection;

// ── activateCodeTab ──────────────────────────────────────────
// Called by FileManager.ui.js on file double-click.

function activateCodeTab() {
    const codeTab = document.querySelector('[data-mode="code"]');
    if (codeTab) codeTab.click();
}
window.activateCodeTab = activateCodeTab;

// ── keyboard shortcuts ───────────────────────────────────────

document.addEventListener("keydown", e => {
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key === "Enter")                 { e.preventDefault(); handleSendMessage(); }
    if (ctrl && e.key === "k")                     { e.preventDefault(); toggleCommandPalette(); }
    if (ctrl && e.shiftKey && e.key === "S")       { e.preventDefault(); window.openSettingsPanel?.(); }
    if (ctrl && e.shiftKey && e.key === "N")       { e.preventDefault(); document.getElementById("newProjectBtn")?.click(); }
    if (ctrl && e.shiftKey && e.key === "C")       { e.preventDefault(); document.getElementById("newChatBtn")?.click(); }
    if (ctrl && e.shiftKey && e.key === "M")       { e.preventDefault(); document.getElementById("otfmsEngineSelect")?.focus(); }
    if (ctrl && e.shiftKey && e.key === "F")       { e.preventDefault(); document.getElementById("fileInput")?.click(); }
    if (e.altKey && e.key === "f")                 { e.preventDefault(); document.getElementById("folderInput")?.click(); }
    if (e.key === "Escape")                        { window.closeSettingsPanel?.(); window.closeFirstRunWizard?.(); }
});

// ── send button ──────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
    // SendButton owns the send button — set the send function
    if (window.SendButton) {
        window.SendButton.setSendFn(handleSendMessage);
    } else {
        // Fallback if SendButton not loaded
        document.getElementById("sendBtn")?.addEventListener("click", handleSendMessage);
    }

    document.getElementById("messageInput")?.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
    });

    // Right pane tab switching
    document.querySelectorAll("#rightModeTabs .tab").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll("#rightModeTabs .tab").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
        });
    });

    // Settings button
    document.getElementById("openSettingsButton")?.addEventListener("click", () => {
        window.openSettingsPanel?.();
    });

    // Canvas collapse toggle
    document.getElementById("toggleCanvasBtn")?.addEventListener("click", () => {
        const canvas = document.getElementById("canvas");
        if (canvas) canvas.classList.toggle("collapsed");
    });
    // Split, tabs, and file routing owned by PrimaryPanel.ui.js

    // Start app
    init();
});

// ── showToast ────────────────────────────────────────────────
// Simple toast notification. Referenced by settings.ui.js,
// ModelManager.ui.js, and updater.ui.js.
// ── end of showToast ─────────────────────────────────────────

function showToast(msg, durationMs = 3000) {
    const existing = document.getElementById("protoai-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.id = "protoai-toast";
    toast.textContent = msg;
    toast.style.cssText = [
        "position:fixed",
        "bottom:24px",
        "left:50%",
        "transform:translateX(-50%)",
        "background:var(--bg-elevated-2,#252540)",
        "color:var(--text,#eee)",
        "border:1px solid var(--border-subtle,#333)",
        "border-radius:8px",
        "padding:10px 20px",
        "font-size:13px",
        "z-index:99999",
        "pointer-events:none",
        "transition:opacity 0.3s",
        "opacity:1"
    ].join(";");

    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 300);
    }, durationMs);
}
window.showToast = showToast;

// ── loadProjects ─────────────────────────────────────────────
// Fetches project list from backend, populates the sidebar,
// and auto-selects "default" (creating it if needed).
// ── end of loadProjects ──────────────────────────────────────

async function loadProjects() {
    try {
        const result = await backend.runWorkflow("ListProjectsWorkflow");
        const projects = result?.projects || result?.data?.projects || [];

        const list = document.getElementById("projectList");
        if (list) {
            list.innerHTML = "";
            projects.forEach(p => {
                const name = typeof p === "string" ? p : (p.name || p.id || String(p));
                const li = document.createElement("li");
                li.className   = "project-item";
                li.textContent = name;
                li.dataset.project = name;
                li.addEventListener("click", () => selectProject(name));
                list.appendChild(li);
            });
        }

        // Auto-select default or first available project
        const names = projects.map(p => typeof p === "string" ? p : (p.name || p.id));
        if (names.includes("default")) {
            selectProject("default");
        } else if (names.length > 0) {
            selectProject(names[0]);
        } else {
            // No projects exist — select default anyway, server will create it
            selectProject("default");
        }

    } catch (err) {
        console.warn("[app.js] loadProjects failed:", err.message);
        // Fall back to default so chat still works
        selectProject("default");
    }
}

// ── selectProject ────────────────────────────────────────────

function selectProject(name) {
    window.currentProject = name;

    const nameEl = document.getElementById("currentProjectName");
    if (nameEl) nameEl.textContent = name;

    // Highlight in sidebar
    document.querySelectorAll(".project-item").forEach(li => {
        li.classList.toggle("active", li.dataset.project === name);
    });

    // Clear chat empty state
    const emptyState = document.getElementById("chatEmptyState");
    if (emptyState) emptyState.style.display = "none";

    // Emit to EventBus for PrimaryPanel and FileManager
    window.EventBus?.emit("app:projectSelected", { project: name });

    // Load history for this project
    loadHistory(name).catch(() => {});
}
window.selectProject = selectProject;

// ── loadHistory ──────────────────────────────────────────────

async function loadHistory(project) {
    try {
        const result = await backend.runWorkflow("LoadProjectHistoryWorkflow", { project });
        const history = result?.history || result?.data?.history || [];

        const container = document.getElementById("chatContainer");
        if (!container) return;

        // Clear existing messages (keep empty state hidden)
        container.querySelectorAll(".message").forEach(m => m.remove());

        history.forEach(entry => {
            if (entry.role && entry.message) {
                appendMessage(entry.role, entry.message);
            }
        });
    } catch (err) {
        console.warn("[app.js] loadHistory failed:", err.message);
    }
}
