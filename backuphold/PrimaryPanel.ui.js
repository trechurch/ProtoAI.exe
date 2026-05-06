// ============================================================
// PrimaryPanel.ui.js — Right Pane & Split View Manager
// version: 1.1.0
// Last modified: 2026-05-02 10:00 UTC
// depends: tauri-utils.js, EventBus.ui.js
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    // ── PrimaryPanel.ui ──────────────────────────────────────
    // Owns the right pane and all its tab modes:
    //   files    — file tree (delegated to FileManager.ui.js)
    //   code     — Monaco editor (lazy-loaded)
    //   browser  — embedded URL / local file viewer
    //   terminal — lightweight command runner via Tauri IPC
    //   search   — chat & file history search
    //
    // Split-view button cycles: none → vertical → horizontal → none
    //   vertical   = left | right  (side-by-side, vertical divider)
    //   horizontal = top  / bottom (stacked,      horizontal divider)
    //
    // All layout is driven by inline styles so it works
    // regardless of what styles.css defines.
    // ── end of PrimaryPanel.ui ───────────────────────────────

    // ── SDOA v3 MANIFEST ─────────────────────────────────────
    const MANIFEST = {
        id:      "PrimaryPanel.ui",
        type:    "component",
        runtime: "Browser",
        version: "1.1.0",
        capabilities: [
            "panel.split",
            "panel.tabs",
            "panel.browser",
            "panel.code",
            "panel.files",
            "panel.terminal",
            "panel.search",
            "file.attach",
        ],
        dependencies: ["tauri-utils.js", "EventBus.ui.js"],
        docs: {
            description: "Manages the right pane, split view, and tab content. Split cycles none → vertical → horizontal → none. All layout uses inline styles.",
            author: "ProtoAI team",
            sdoa_compatibility: "All versions forward/backward compatible."
        },
        actions: {
            commands: {
                setSplitMode:     { description: "Set split layout (none | vertical | horizontal).", input: { mode: "string" }, output: "void" },
                setActiveMode:    { description: "Activate a tab mode.",                             input: { mode: "string" }, output: "void" },
                setSecondaryMode: { description: "Alias for setActiveMode.",                         input: { mode: "string" }, output: "void" },
                openUrl:          { description: "Open a URL in the browser tab.",                   input: { url: "string"  }, output: "void" },
                openFile:         { description: "Open a file in the code editor tab.",              input: { path: "string" }, output: "void" },
                openInChat:       { description: "Attach a file path to the next chat message.",     input: { path: "string" }, output: "void" },
            },
            triggers: {},
            emits: {
                "primarypanel:splitChanged":  { description: "Split mode changed.",    payload: { mode: "string" } },
                "primarypanel:modeChanged":   { description: "Active tab changed.",    payload: { mode: "string" } },
                "primarypanel:fileAttached":  { description: "File attached to chat.", payload: { path: "string" } },
            },
            workflows: {}
        }
    };
    // ── end of SDOA v3 MANIFEST ──────────────────────────────

    // ── state ─────────────────────────────────────────────────
    let _splitMode   = "none";    // none | vertical | horizontal
    let _activeMode  = "files";   // files | code | browser | terminal | search
    let _currentPath = null;
    let _pendingUrl  = null;
    // ── end of state ─────────────────────────────────────────

    // ── SPLIT CYCLE ───────────────────────────────────────────
    // none → vertical (side-by-side) → horizontal (stacked) → none
    const SPLIT_CYCLE = { none: "vertical", vertical: "horizontal", horizontal: "none" };

    const SPLIT_BTN_TITLES = {
        none:       "Split view: side by side  (⧉)",
        vertical:   "Split view: stacked  (⧉)",
        horizontal: "Close split  (⧉)",
    };
    // ── end of SPLIT CYCLE ────────────────────────────────────

    // ── setSplitMode ──────────────────────────────────────────
    // Applies layout via inline styles so the split works
    // regardless of what styles.css defines for these classes.
    // ── end of setSplitMode ───────────────────────────────────

    function setSplitMode(mode) {
        _splitMode = mode || "none";

        const workspace = document.getElementById("workspace");
        const paneLeft  = document.getElementById("pane-left");
        const paneRight = document.getElementById("pane-right");
        const splitBtn  = document.getElementById("splitToggleBtn");

        // Remove both CSS classes — we drive layout with inline styles
        workspace?.classList.remove("split-vertical", "split-horizontal");

        if (_splitMode === "none") {
            // ── single-pane ───────────────────────────────────
            if (workspace) workspace.style.flexDirection = "row";
            if (paneLeft) {
                paneLeft.style.flex    = "1";
                paneLeft.style.minWidth = "0";
                paneLeft.style.height  = "100%";
            }
            if (paneRight) {
                paneRight.style.display = "none";
            }

        } else if (_splitMode === "vertical") {
            // ── left | right  (vertical divider) ─────────────
            if (workspace) {
                workspace.style.flexDirection = "row";
                workspace.classList.add("split-vertical");
            }
            if (paneLeft) {
                paneLeft.style.flex     = "1";
                paneLeft.style.minWidth = "0";
                paneLeft.style.height   = "100%";
            }
            _showRightPane(paneRight, { flex: "1", width: "auto", height: "100%", minWidth: "0" });
            _renderActiveMode();

        } else if (_splitMode === "horizontal") {
            // ── top / bottom  (horizontal divider) ───────────
            if (workspace) {
                workspace.style.flexDirection = "column";
                workspace.classList.add("split-horizontal");
            }
            if (paneLeft) {
                paneLeft.style.flex      = "1";
                paneLeft.style.minHeight = "0";
                paneLeft.style.width     = "100%";
            }
            _showRightPane(paneRight, { flex: "1", width: "100%", height: "auto", minHeight: "0" });
            _renderActiveMode();
        }

        // Update button tooltip
        if (splitBtn) splitBtn.title = SPLIT_BTN_TITLES[_splitMode];

        window.EventBus?.emit("primarypanel:splitChanged", { mode: _splitMode });
    }

    // ── _showRightPane ────────────────────────────────────────
    // Makes the right pane visible and applies sizing + flex
    // layout so the tab bar + content area fill it properly.
    // ── end of _showRightPane ────────────────────────────────

    function _showRightPane(paneRight, sizing) {
        if (!paneRight) return;
        paneRight.style.display       = "flex";
        paneRight.style.flexDirection = "column";
        paneRight.style.overflow      = "hidden";
        paneRight.style.flex          = sizing.flex      || "1";
        paneRight.style.width         = sizing.width     || "auto";
        paneRight.style.height        = sizing.height    || "100%";
        paneRight.style.minWidth      = sizing.minWidth  || "";
        paneRight.style.minHeight     = sizing.minHeight || "";

        // Tab bar — fixed height, never shrinks
        const tabBar = paneRight.querySelector("#rightModeTabs");
        if (tabBar) {
            tabBar.style.flexShrink = "0";
        }

        // Content area — takes all remaining space
        const content = document.getElementById("rightPaneContent");
        if (content) {
            content.style.flex          = "1";
            content.style.minHeight     = "0";
            content.style.minWidth      = "0";
            content.style.overflow      = "hidden";
            content.style.display       = "flex";
            content.style.flexDirection = "column";
        }
    }

    // ── setActiveMode ─────────────────────────────────────────

    function setActiveMode(mode) {
        _activeMode = mode || "files";

        // Sync tab button highlight
        document.querySelectorAll("#rightModeTabs .tab").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.mode === _activeMode);
        });

        // Ensure the right pane is open
        if (_splitMode === "none") setSplitMode("vertical");

        _renderActiveMode();
        window.EventBus?.emit("primarypanel:modeChanged", { mode: _activeMode });
    }

    // Alias used by app.js
    function setSecondaryMode(mode) { setActiveMode(mode); }

    // ── _renderActiveMode ─────────────────────────────────────

    function _renderActiveMode() {
        const content = document.getElementById("rightPaneContent");
        if (!content) return;

        // Re-apply content-area styles in case DOM was mutated
        content.style.flex          = "1";
        content.style.minHeight     = "0";
        content.style.minWidth      = "0";
        content.style.overflow      = "hidden";
        content.style.display       = "flex";
        content.style.flexDirection = "column";

        switch (_activeMode) {
            case "files":    _renderFilesTab(content);    break;
            case "code":     _renderCodeTab(content);     break;
            case "browser":  _renderBrowserTab(content);  break;
            case "terminal": _renderTerminalTab(content); break;
            case "search":   _renderSearchTab(content);   break;
        }
    }

    function _renderFilesTab(container) {
        if (container.dataset.mode === "files") return; // already mounted
        container.dataset.mode = "files";
        container.innerHTML = "";

        const feature = window.ModuleLoader?.getModule("FileExplorer.feature");
        if (feature?.mount) {
            feature.mount(container).catch(err => {
                container.innerHTML = `<div style="\${_emptyStyle()}">
                    File manager error: \${err?.message || err}
                </div>`;
            });
        } else {
            container.innerHTML = `<div style="\${_emptyStyle()}">
                📁 File Explorer not loaded yet.<br>
                <span style="font-size:11px;color:#666;">Select a project to populate the file tree.</span>
            </div>`;
        }
    }

    // ── _renderCodeTab ────────────────────────────────────────

    function _renderCodeTab(container) {
        if (container.dataset.mode === "code") return;
        container.dataset.mode = "code";
        container.innerHTML = `<div id="monacoContainer" style="flex:1;width:100%;min-height:0;"></div>`;
        _initMonaco();
    }

    function _initMonaco(attempt = 0) {
        const monacoContainer = document.getElementById("monacoContainer");
        if (!monacoContainer) return;

        if (window.monaco) {
            // Monaco already loaded — create editor
            if (!window._monacoEditor) {
                window._monacoEditor = window.monaco.editor.create(monacoContainer, {
                    value:           "// Select a file to open it here",
                    language:        "javascript",
                    theme:           "vs-dark",
                    automaticLayout: true,
                    minimap:         { enabled: false },
                    fontSize:        13,
                    wordWrap:        "on",
                });
            }
        } else if (typeof window.require === "function" && typeof window.require.config === "function") {
            // AMD loader (loader.js) is present — configure and load Monaco
            window.require.config({ paths: { vs: "/lib/monaco/vs" } });
            window.require(["vs/editor/editor.main"], () => _initMonaco());
        } else {
            // Neither ready yet — retry (loader.js loads last in index.html)
            if (attempt < 20) {
                monacoContainer.innerHTML = `<div style="${_emptyStyle()}">
                    Code editor loading…<br>
                    <span style="font-size:11px;color:#666;">Waiting for Monaco editor (attempt ${attempt + 1})</span>
                </div>`;
                setTimeout(() => _initMonaco(attempt + 1), 500);
            } else {
                monacoContainer.innerHTML = `<div style="${_emptyStyle()}">
                    Monaco editor failed to load.<br>
                    <span style="font-size:11px;color:#666;">Check that /lib/monaco/vs/loader.js is accessible.</span>
                </div>`;
            }
        }
    }

    // ── _renderBrowserTab ─────────────────────────────────────

    function _renderBrowserTab(container) {
        if (container.dataset.mode === "browser") {
            if (_pendingUrl) { _renderBrowserUrl(_pendingUrl); _pendingUrl = null; }
            return;
        }
        container.dataset.mode = "browser";
        container.innerHTML = `
            <div style="flex-shrink:0;display:flex;gap:6px;padding:6px 10px;
                        background:var(--bg-elevated-1,#1a1a1a);
                        border-bottom:1px solid var(--border-subtle,#333);">
                <input id="browserAddress" type="text" placeholder="Enter URL or file path…"
                       style="flex:1;padding:4px 8px;font-size:12px;
                              background:var(--bg-deep,#111);
                              color:var(--text,#eee);
                              border:1px solid var(--border-subtle,#333);
                              border-radius:4px;outline:none;" />
                <button id="browserGoBtn"
                        style="padding:4px 10px;font-size:12px;
                               background:var(--accent,#6366f1);
                               color:#fff;border:none;border-radius:4px;cursor:pointer;">Go</button>
            </div>
            <div id="browserContent"
                 style="flex:1;min-height:0;overflow:auto;
                        background:var(--bg-deep,#0d0d0d);"></div>
        `;

        document.getElementById("browserGoBtn")?.addEventListener("click", () => {
            const url = document.getElementById("browserAddress")?.value?.trim();
            if (url) _renderBrowserUrl(url);
        });

        document.getElementById("browserAddress")?.addEventListener("keydown", e => {
            if (e.key === "Enter") {
                const url = e.target.value.trim();
                if (url) _renderBrowserUrl(url);
            }
        });

        if (_pendingUrl) { _renderBrowserUrl(_pendingUrl); _pendingUrl = null; }
    }

    // ── _renderTerminalTab ────────────────────────────────────

    function _renderTerminalTab(container) {
        if (container.dataset.mode === "terminal") return;
        container.dataset.mode = "terminal";
        container.innerHTML = `
            <div id="terminalOutput"
                 style="flex:1;min-height:0;overflow:auto;padding:12px;
                        background:#0d0d0d;color:#4ade80;font-size:12px;
                        white-space:pre-wrap;font-family:var(--font-mono,'Courier New'),monospace;"></div>
            <div style="flex-shrink:0;display:flex;gap:6px;padding:6px 10px;
                        background:var(--bg-elevated-1,#1a1a1a);border-top:1px solid #333;">
                <span style="color:#4ade80;font-size:12px;line-height:28px;font-family:monospace;">$</span>
                <input id="terminalInput" type="text" placeholder="Enter command…"
                       style="flex:1;padding:4px 8px;font-size:12px;background:#111;color:#4ade80;
                              border:1px solid #333;border-radius:4px;
                              font-family:var(--font-mono,'Courier New'),monospace;outline:none;" />
                <button id="terminalRunBtn"
                        style="padding:4px 10px;font-size:12px;background:#6366f1;
                               color:#fff;border:none;border-radius:4px;cursor:pointer;">Run</button>
            </div>
        `;

        async function runCmd() {
            const input = document.getElementById("terminalInput");
            const out   = document.getElementById("terminalOutput");
            const cmd   = input?.value?.trim();
            if (!cmd || !out) return;
            input.value = "";
            out.textContent += `$ ${cmd}\n`;
            try {
                const result = await window.__TAURI__?.core?.invoke("run_command", { cmd });
                out.textContent += (result || "(no output)") + "\n\n";
            } catch (e) {
                out.textContent += `Error: ${e.message || e}\n\n`;
            }
            out.scrollTop = out.scrollHeight;
        }

        document.getElementById("terminalRunBtn")?.addEventListener("click", runCmd);
        document.getElementById("terminalInput")?.addEventListener("keydown", e => {
            if (e.key === "Enter") runCmd();
        });
    }

    // ── _renderSearchTab ──────────────────────────────────────

    function _renderSearchTab(container) {
        if (container.dataset.mode === "search") return;
        container.dataset.mode = "search";
        container.innerHTML = "";
        if (window.SearchHistory?.render) {
            window.SearchHistory.render(container);
        } else {
            container.innerHTML = `<div style="${_emptyStyle()}">Search loading…</div>`;
        }
    }

    // ── _emptyStyle ───────────────────────────────────────────
    // Shared style string for placeholder/empty states.

    function _emptyStyle() {
        return "padding:20px;color:var(--text-muted,#888);font-size:13px;" +
               "text-align:center;line-height:1.8;";
    }

    // ── _renderBrowserUrl ─────────────────────────────────────
    // Renders a local file or remote URL inside #browserContent.
    // ── end of _renderBrowserUrl ─────────────────────────────

    function _renderBrowserUrl(url) {
        const browserContent = document.getElementById("browserContent");
        if (!browserContent) return;

        const addressInput = document.getElementById("browserAddress");
        if (addressInput) addressInput.value = url;

        const ext         = url.split(".").pop()?.toLowerCase();
        const isLocalFile = url.startsWith("asset://") || url.startsWith("file://") || !url.includes("://");

        if (isLocalFile) {
            const filePath  = url.replace(/^asset:\/\/localhost\//, "").replace(/^file:\/\//, "");
            const localPath = filePath.replace(/\//g, "\\");
            const cleanPath = filePath.replace(/\\/g, "/");

            if (ext === "html" || ext === "htm") {
                browserContent.innerHTML = `<iframe src="asset://localhost/${cleanPath}"
                    style="width:100%;height:100%;border:none;"
                    sandbox="allow-scripts allow-same-origin"></iframe>`;

            } else if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext)) {
                browserContent.innerHTML = `
                    <div style="padding:16px;text-align:center;">
                        <img src="asset://localhost/${cleanPath}"
                             style="max-width:100%;max-height:calc(100vh - 120px);object-fit:contain;">
                    </div>`;

            } else if (["mp4", "webm"].includes(ext)) {
                browserContent.innerHTML = `
                    <div style="padding:16px;">
                        <video controls style="max-width:100%;max-height:calc(100vh - 160px);">
                            <source src="asset://localhost/${cleanPath}">
                        </video>
                    </div>`;

            } else if (["mp3", "wav", "ogg", "flac"].includes(ext)) {
                browserContent.innerHTML = `
                    <div style="padding:16px;">
                        <audio controls style="width:100%;">
                            <source src="asset://localhost/${cleanPath}">
                        </audio>
                        <div style="margin-top:8px;color:var(--text-muted);font-size:12px;">
                            ${filePath.split(/[\\/]/).pop()}
                        </div>
                    </div>`;

            } else {
                window.backendConnector?.runWorkflow("fs_read_file", { path: localPath })
                    .then(content => {
                        if (typeof content === "string") {
                            const lines = content.split("\n").slice(0, 500);
                            browserContent.innerHTML = `<pre style="
                                padding:12px;font-family:var(--font-mono);font-size:12px;
                                color:var(--text);margin:0;background:var(--bg-deep);
                                flex:1;overflow:auto;">${_escapeHtml(lines.join("\n"))}</pre>`;
                        }
                    })
                    .catch(() => {
                        browserContent.innerHTML = `
                            <div style="${_emptyStyle()}">
                                Cannot preview — ${filePath.split(/[\\/]/).pop()}<br>
                                <span style="font-size:11px;color:var(--text-dim);">(${ext} file)</span>
                            </div>`;
                    });
            }

        } else {
            browserContent.innerHTML = `<iframe src="${url}"
                style="width:100%;height:100%;border:none;"
                sandbox="allow-scripts allow-same-origin"></iframe>`;
        }
    }

    // ── _escapeHtml ───────────────────────────────────────────

    function _escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    // ── openUrl ───────────────────────────────────────────────

    function openUrl(url) {
        _pendingUrl = url;
        setActiveMode("browser");
        if (document.getElementById("browserContent")) {
            _renderBrowserUrl(url);
            _pendingUrl = null;
        }
    }

    // ── openFile ──────────────────────────────────────────────

    function openFile(path) {
        _currentPath = path;
        setActiveMode("code");

        window.backendConnector?.runWorkflow("fs_read_file", { path })
            .then(content => {
                const editor = window._monacoEditor;
                if (!editor || typeof content !== "string") return;
                const ext  = path.split(".").pop()?.toLowerCase();
                if (window.monaco) {
                    window.monaco.editor.setModelLanguage(editor.getModel(), _langFromExt(ext));
                }
                editor.setValue(content);
            })
            .catch(() => {});
    }

    function _langFromExt(ext) {
        const map = {
            js: "javascript", ts: "typescript", jsx: "javascript", tsx: "typescript",
            py: "python",     rs: "rust",       go: "go",         java: "java",
            cs: "csharp",     html: "html",     css: "css",       scss: "css",
            json: "json",     md: "markdown",   sh: "shell",      bash: "shell",
            yaml: "yaml",     yml: "yaml",      toml: "toml",     xml: "xml",
            sql: "sql",       cpp: "cpp",       c: "c",           h: "c",
        };
        return map[ext] || "plaintext";
    }

    // ── _openInChat ───────────────────────────────────────────

    function _openInChat(filePath) {
        if (!filePath) return;

        if (!Array.isArray(window._attachedFiles)) window._attachedFiles = [];
        if (!window._attachedFiles.includes(filePath)) {
            window._attachedFiles.push(filePath);
        }

        _updateFileListUI();

        const input     = document.getElementById("messageInput");
        const shortName = filePath.split(/[\\/]/).pop();
        if (input) input.placeholder = `Attached: ${shortName} — Ask ProtoAI…`;

        window.EventBus?.emit("primarypanel:fileAttached", { path: filePath });
    }

    // ── _updateFileListUI ─────────────────────────────────────

    function _updateFileListUI() {
        const list  = document.getElementById("fileList");
        const empty = document.getElementById("fileListEmpty");
        const count = document.getElementById("fileCount");
        const files = window._attachedFiles || [];

        if (count) count.textContent = files.length;

        if (files.length === 0) {
            if (empty) empty.style.display = "";
            if (list)  list.innerHTML      = "";
            const input = document.getElementById("messageInput");
            if (input) input.placeholder   = "Ask ProtoAI… (Shift+Enter for newline)";
            return;
        }

        if (empty) empty.style.display = "none";
        if (!list) return;

        list.innerHTML = "";
        files.forEach((f, i) => {
            const li   = document.createElement("li");
            li.style.cssText = "display:flex;align-items:center;justify-content:space-between;" +
                               "padding:4px 0;font-size:12px;color:var(--text,#ccc);";
            const name = f.split(/[\\/]/).pop();
            li.innerHTML = `
                <span title="${f}"
                      style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">
                    📄 ${name}
                </span>
                <button data-idx="${i}"
                        style="background:none;border:none;color:#888;cursor:pointer;
                               font-size:14px;padding:0 4px;"
                        title="Remove">✕</button>
            `;
            li.querySelector("button").addEventListener("click", () => {
                window._attachedFiles.splice(i, 1);
                _updateFileListUI();
            });
            list.appendChild(li);
        });
    }

    // ── _wireTabs ─────────────────────────────────────────────

    function _wireTabs() {
        document.querySelectorAll("#rightModeTabs .tab").forEach(btn => {
            btn.addEventListener("click", () => setActiveMode(btn.dataset.mode));
        });
    }

    // ── _wireSplitToggle ──────────────────────────────────────
    // Cycles: none → vertical → horizontal → none

    function _wireSplitToggle() {
        const btn = document.getElementById("splitToggleBtn");
        if (!btn) return;
        btn.title = SPLIT_BTN_TITLES.none;
        btn.addEventListener("click", () => {
            setSplitMode(SPLIT_CYCLE[_splitMode] || "vertical");
        });
    }

    // ── _wireFileAttach ───────────────────────────────────────

    function _wireFileAttach() {
        const attachBtn   = document.getElementById("attachFileBtn");
        const fileInput   = document.getElementById("fileInput");
        const folderInput = document.getElementById("folderInput");

        attachBtn?.addEventListener("click", e => {
            if (e.ctrlKey || e.metaKey) fileInput?.click();
            else                         folderInput?.click();
        });

        async function uploadFiles(files) {
            const project = window.currentProject || "default";
            let uploaded = 0;

            const binaryExtensions = [".pdf", ".docx", ".zip", ".png", ".jpg", ".jpeg", ".gif", ".exe", ".bin"];

            for (const f of Array.from(files)) {
                const filename = f.webkitRelativePath || f.name;
                const isBinary = binaryExtensions.some(ext => filename.toLowerCase().endsWith(ext));

                const reader = new FileReader();
                const contentData = await new Promise((resolve) => {
                    reader.onload = (e) => resolve(e.target.result);
                    if (isBinary) {
                        reader.readAsDataURL(f);
                    } else {
                        reader.readAsText(f);
                    }
                });

                let content = contentData;
                let encoding = "utf8";

                if (isBinary) {
                    // Extract base64 part from Data URL (data:*/*;base64,...)
                    content = contentData.split(",")[1];
                    encoding = "base64";
                }

                try {
                    await window.backendConnector?.runWorkflow("upload", {
                        project,
                        filename,
                        content,
                        encoding
                    });
                    uploaded++;
                    _openInChat(filename);
                    
                    // Small delay to prevent IPC congestion
                    await new Promise(r => setTimeout(r, 50));
                } catch (err) {
                    console.error("Upload failed for", filename, err);
                }
            }

            if (uploaded > 0) {
                window.showToast?.(`Uploaded ${uploaded} file(s) to project "${project}"`);
                // Trigger refresh of file tree
                window.refreshFileManager?.();
            }
        }

        fileInput?.addEventListener("change", () => {
            uploadFiles(fileInput.files);
            fileInput.value = "";
        });

        folderInput?.addEventListener("change", () => {
            uploadFiles(folderInput.files);
            folderInput.value = "";
        });
    }

    // ── window export ─────────────────────────────────────────
    window.primaryPanel = {
        MANIFEST,
        setSplitMode,
        setActiveMode,
        setSecondaryMode,
        openUrl,
        openFile,
        openInChat: _openInChat,
    };
    // ── end of window export ─────────────────────────────────

    // ── EventBus wiring ───────────────────────────────────────
    domReady(() => {
        _wireTabs();
        _wireSplitToggle();
        _wireFileAttach();

        window.EventBus?.on("filemanager:fileOpened",  ({ path }) => openFile(path));
        window.EventBus?.on("browser:navigate",        ({ url })  => openUrl(url));

        window.EventBus?.on("filemanager:selectEntry", () => {
            if (_splitMode === "none") setSplitMode("vertical");
            setActiveMode("files");
        });

        window.EventBus?.on("app:projectSelected", () => {
            const content = document.getElementById("rightPaneContent");
            if (content && content.dataset.mode === "files") {
                content.dataset.mode = ""; // invalidate so it re-mounts
                if (_splitMode !== "none") _renderFilesTab(content);
            }
        });

        window.EventBus?.command("primarypanel", "setSplitMode",     ({ mode }) => setSplitMode(mode));
        window.EventBus?.command("primarypanel", "setActiveMode",    ({ mode }) => setActiveMode(mode));
        window.EventBus?.command("primarypanel", "setSecondaryMode", ({ mode }) => setSecondaryMode(mode));
        window.EventBus?.command("primarypanel", "openUrl",          ({ url })  => openUrl(url));
        window.EventBus?.command("primarypanel", "openFile",         ({ path }) => openFile(path));
        window.EventBus?.command("primarypanel", "openInChat",       ({ path }) => _openInChat(path));
    });
    // ── end of EventBus wiring ──

})();
