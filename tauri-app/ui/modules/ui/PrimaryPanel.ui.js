// ============================================================
// PrimaryPanel.ui.js — Primary Split Panel Manager
// version: 1.0.0
// depends: tauri-utils.js, EventBus.ui.js
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    // ── PrimaryPanel.ui ──────────────────────────────────────
    // Manages the primary split screen and panel rotation.
    //
    // PRIMARY MODES (left/main pane):
    //   chat        — chat interface (default)
    //
    // SECONDARY MODES (right/bottom pane, shown on split):
    //   files       — file manager (VFS tree + file list)
    //   code        — Monaco editor / coding canvas
    //   browser     — web browser / preview
    //   terminal    — terminal / console output
    //
    // SPLIT STATES:
    //   none        — single pane (chat only)
    //   vertical    — left=chat, right=secondary (1.2fr / 0.8fr)
    //   horizontal  — top=chat, bottom=secondary
    //
    // Double-click routing behavior:
    //   auto        — routes by file type (code→editor, html→browser, etc.)
    //   active      — routes to whatever secondary mode is currently showing
    //
    // The panel listens to the EventBus for:
    //   filemanager:fileOpened → routes file to correct panel
    //   modelmanager:archetypeActivated → updates profile badge
    //   backend:statusChanged  → updates status dot
    //   llmbridge:generateStarted/Completed/Failed → send button state
    // ── end of PrimaryPanel.ui ───────────────────────────────

    // ── SDOA v3 MANIFEST ─────────────────────────────────────
    const MANIFEST = {
        id:      "PrimaryPanel.ui",
        type:    "component",
        runtime: "Browser",
        version: "1.0.0",
        capabilities: [
            "split.manage",
            "panel.rotate",
            "file.route",
            "mode.set",
            "sendbutton.state"
        ],
        dependencies: ["tauri-utils.js", "EventBus.ui.js"],
        docs: {
            description: "Manages the primary split screen, secondary panel mode rotation, and file routing. Listens to the EventBus to coordinate UI state across modules.",
            author: "ProtoAI team",
            sdoa_compatibility: "All versions forward/backward compatible."
        },
        actions: {
            commands: {
                setSplitMode:     { description: "Set split mode (none/vertical/horizontal).", input: { mode: "string" }, output: "void" },
                setSecondaryMode: { description: "Set secondary panel mode.",                  input: { mode: "string" }, output: "void" },
                openFile:         { description: "Open a file in the appropriate panel.",      input: { path: "string", targetMode: "string?" }, output: "void" },
                setRouting:       { description: "Set double-click routing (auto/active).",    input: { mode: "string" }, output: "void" },
            },
            triggers: {
                splitChanged:     { description: "Fires when split mode changes.",     payload: { mode: "string" } },
                secondaryChanged: { description: "Fires when secondary mode changes.", payload: { mode: "string" } },
                fileRouted:       { description: "Fires when a file is routed.",       payload: { path: "string", targetMode: "string" } },
            },
            emits: {
                "panel:splitChanged":     { description: "Split mode changed.",     payload: { mode: "string" } },
                "panel:secondaryChanged": { description: "Secondary mode changed.", payload: { mode: "string" } },
                "panel:fileRouted":       { description: "File routed to panel.",   payload: { path: "string", targetMode: "string" } },
            },
            workflows: {}
        }
    };
    // ── end of SDOA v3 MANIFEST ──────────────────────────────

    // ── file type routing map ─────────────────────────────────
    const FILE_TYPE_ROUTES = {
        // code → editor
        js: "code", ts: "code", jsx: "code", tsx: "code", py: "code",
        rs: "code", go: "code", java: "code", cpp: "code", c: "code",
        cs: "code", rb: "code", sh: "code", css: "code", scss: "code",
        json: "code", yaml: "code", yml: "code", toml: "code", md: "code",
        // web → browser
        html: "browser", htm: "browser", svg: "browser",
        // media → browser
        jpg: "browser", jpeg: "browser", png: "browser", gif: "browser", webp: "browser",
        mp4: "browser", mp3: "browser", wav: "browser",
        pdf: "browser",
        // chat — paste manifest/content into chat
        txt: "chat", csv: "chat", log: "terminal",
        // terminal
        sh: "terminal", bash: "terminal", cmd: "terminal", ps1: "terminal",
    };
    // ── end of file type routing map ─────────────────────────

    // ── state ─────────────────────────────────────────────────
    let _splitMode     = "none";       // none | vertical | horizontal
    let _secondaryMode = "files";      // files | code | browser | terminal
    let _routing       = "auto";       // auto | active
    let _generating    = false;        // LLM in flight
    // ── end of state ─────────────────────────────────────────

    // ── DOM refs (resolved in domReady) ──────────────────────
    let _workspace, _paneRight, _splitBtn, _rightContent, _rightTabs;
    let _sendBtn, _profileBadge, _statusDot, _statusLabel;
    // ── end of DOM refs ───────────────────────────────────────

    // ── setSplitMode ─────────────────────────────────────────

    function setSplitMode(mode) {
        if (!_workspace) return;
        _splitMode = mode;
        _workspace.classList.remove("split-vertical", "split-horizontal");

        if (mode === "vertical") {
            _workspace.classList.add("split-vertical");
            if (_paneRight) _paneRight.style.display = "flex";
            _renderSecondary();
        } else if (mode === "horizontal") {
            _workspace.classList.add("split-horizontal");
            if (_paneRight) _paneRight.style.display = "flex";
            _renderSecondary();
        } else {
            if (_paneRight) _paneRight.style.display = "none";
        }

        window.EventBus?.emit("panel:splitChanged", { mode });
    }

    // ── setSecondaryMode ─────────────────────────────────────

    function setSecondaryMode(mode) {
        _secondaryMode = mode;

        // Update tab active state
        _rightTabs?.querySelectorAll(".tab").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.mode === mode);
        });

        if (_splitMode !== "none") _renderSecondary();
        window.EventBus?.emit("panel:secondaryChanged", { mode });
    }

    // ── setRouting ───────────────────────────────────────────

    function setRouting(mode) {
        _routing = mode; // "auto" | "active"
    }

    // ── openFile ─────────────────────────────────────────────
    // Routes a file to the correct panel.
    // targetMode overrides routing setting if provided.
    // ── end of openFile ──────────────────────────────────────

    function openFile(filePath, targetMode) {
        let mode = targetMode;

        if (!mode) {
            if (_routing === "active") {
                mode = _secondaryMode;
            } else {
                // Auto routing by file type
                const ext = filePath.split(".").pop()?.toLowerCase() || "";
                mode = FILE_TYPE_ROUTES[ext] || "code";
            }
        }

        // Ensure split is open and showing the right mode
        if (_splitMode === "none") setSplitMode("vertical");
        setSecondaryMode(mode);

        // Route to the panel
        switch (mode) {
            case "code":     _openInEditor(filePath);   break;
            case "browser":  _openInBrowser(filePath);  break;
            case "terminal": _openInTerminal(filePath); break;
            case "chat":     _openInChat(filePath);     break;
            default:         _openInEditor(filePath);
        }

        window.EventBus?.emit("panel:fileRouted", { path: filePath, targetMode: mode });
    }

    // ── panel-specific open handlers ─────────────────────────

    function _openInEditor(filePath) {
        _renderSecondary("code");
        // Request file content and load into Monaco
        window.backendConnector?.runWorkflow("fs_read_file", { path: filePath })
            .then(content => {
                if (typeof content === "string" && window.monaco) {
                    const container = document.getElementById("monacoContainer");
                    if (container && window._monacoEditor) {
                        window._monacoEditor.setValue(content);
                        window._monacoEditor._currentPath = filePath;
                    }
                }
            }).catch(() => {});
    }

    function _openInBrowser(filePath) {
        _renderSecondary("browser");
        const content = document.getElementById("rightPaneContent");
        if (!content) return;
        const ext = filePath.split(".").pop()?.toLowerCase();
        if (["jpg","jpeg","png","gif","webp","svg"].includes(ext)) {
            // Use Tauri asset protocol for local images
            content.innerHTML = `<div style="padding:16px;text-align:center;">
                <img src="asset://localhost/${filePath.replace(/\\/g,'/')}"
                     style="max-width:100%;max-height:calc(100vh - 120px);object-fit:contain;"
                     onerror="this.style.display='none';this.nextSibling.style.display='block'"/>
                <div style="display:none;color:var(--text-muted);font-size:12px;padding-top:8px;">
                    Preview unavailable — ${filePath.split(/[\\/]/).pop()}
                </div>
            </div>`;
        } else if (ext === "html" || ext === "htm") {
            content.innerHTML = `<iframe src="asset://localhost/${filePath.replace(/\\/g,'/')}"
                style="width:100%;height:100%;border:none;" sandbox="allow-scripts allow-same-origin"></iframe>`;
        } else if (["mp4","webm"].includes(ext)) {
            content.innerHTML = `<div style="padding:16px;">
                <video controls style="max-width:100%;max-height:calc(100vh-160px);">
                    <source src="asset://localhost/${filePath.replace(/\\/g,'/')}">
                </video></div>`;
        } else if (["mp3","wav","ogg","flac"].includes(ext)) {
            content.innerHTML = `<div style="padding:16px;">
                <audio controls style="width:100%;">
                    <source src="asset://localhost/${filePath.replace(/\\/g,'/')}">
                </audio>
                <div style="margin-top:8px;color:var(--text-muted);font-size:12px;">${filePath.split(/[\\/]/).pop()}</div>
            </div>`;
        } else {
            content.innerHTML = `<div style="padding:16px;color:var(--text-muted);font-size:12px;">
                Cannot preview this file type in browser — ${filePath.split(/[\\/]/).pop()}
            </div>`;
        }
    }

    function _openInTerminal(filePath) {
        _renderSecondary("terminal");
        // Read first 500 lines and display in terminal-style view
        window.backendConnector?.runWorkflow("fs_read_file", { path: filePath })
            .then(content => {
                if (typeof content !== "string") return;
                const container = document.getElementById("rightPaneContent");
                if (!container) return;
                const lines = content.split("\n").slice(0, 500);
                container.innerHTML = `<pre style="
                    padding:12px;font-family:var(--font-mono);font-size:12px;
                    color:var(--text);line-height:1.5;overflow:auto;height:100%;
                    margin:0;background:var(--bg-deep);">${_escapeHtml(lines.join("\n"))}</pre>`;
            }).catch(() => {});
    }

    function _openInChat(filePath) {
        // Load manifest or content into chat input as context
        window.backendConnector?.runWorkflow("vfs_manifest", {
            project: window.currentProject,
            realPath: filePath
        }).then(result => {
            const manifest  = result?.manifest;
            const input     = document.getElementById("messageInput");
            if (!input) return;
            if (manifest?.purpose?.preview) {
                input.value = `[Context: ${filePath.split(/[\\/]/).pop()}]\n\n${manifest.purpose.preview}`;
            } else {
                input.value = `[File: ${filePath}]`;
            }
            input.focus();
        }).catch(() => {
            const input = document.getElementById("messageInput");
            if (input) { input.value = `[File: ${filePath}]`; input.focus(); }
        });
    }

    // ── _renderSecondary ─────────────────────────────────────
    // Renders content for the given or current secondary mode.
    // ── end of _renderSecondary ──────────────────────────────

    function _renderSecondary(forceMode) {
        const mode    = forceMode || _secondaryMode;
        const content = document.getElementById("rightPaneContent");
        if (!content) return;

        // Update tab state
        if (forceMode) setSecondaryMode(forceMode);

        switch (mode) {
            case "files": {
                if (!content.dataset.fmRendered || content.dataset.fmProject !== window.currentProject) {
                    content.dataset.fmRendered = "1";
                    content.dataset.fmProject  = window.currentProject || "";
                    content.id = "fileTreeContainer";
                    if (window.fileManager) {
                        // Only render when backend is ready
                        const status = await window.backendConnector?.getBackendStatus().catch(() => "offline");
                        if (status === "ready" || status === "tauri") {
                            window.fileManager.render(content).catch(console.error);
                        } else {
                            content.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-dim);font-size:12px;">Waiting for engine…</div>`;
                            // Retry when backend comes online
                            const unsub = window.EventBus?.on("backend:statusChanged", ({ mode }) => {
                                if (mode === "tauri") {
                                    unsub?.();
                                    delete content.dataset.fmRendered;
                                    _renderSecondary("files");
                                }
                            });
                        }
                    }
                }
                break;
            }
            case "search": {
                if (!content.dataset.searchRendered) {
                    content.dataset.searchRendered = "1";
                    if (window.SearchHistory) {
                        window.SearchHistory.render(content);
                    }
                }
                break;
            }
            case "code": {
                if (!document.getElementById("monacoContainer")) {
                    content.innerHTML = '<div id="monacoContainer" style="height:100%;"></div>';
                    _initMonaco();
                }
                break;
            }
            case "browser": {
                if (!content.querySelector("iframe, img, video, audio")) {
                    content.innerHTML = `<div style="padding:20px;color:var(--text-muted);font-size:13px;text-align:center;">
                        Open a file to preview it here
                    </div>`;
                }
                break;
            }
            case "terminal": {
                if (!content.querySelector("pre")) {
                    content.innerHTML = `<pre style="
                        padding:12px;font-family:var(--font-mono);font-size:12px;
                        color:var(--text);margin:0;background:var(--bg-deep);
                        height:100%;overflow:auto;">Open a log or script file to view it here</pre>`;
                }
                break;
            }
        }
    }

    // ── _initMonaco ───────────────────────────────────────────
    // Lazy-init Monaco editor when code pane first opens.
    // ── end of _initMonaco ───────────────────────────────────

    function _initMonaco() {
        if (!window.require || window._monacoEditor) return;
        window.require.config({ paths: { vs: "/lib/monaco/vs" } });
        window.require(["vs/editor/editor.main"], () => {
            const container = document.getElementById("monacoContainer");
            if (!container) return;
            window._monacoEditor = window.monaco.editor.create(container, {
                value:     "// Open a file to edit it here",
                language:  "javascript",
                theme:     "vs-dark",
                fontSize:  13,
                minimap:   { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
            });
        });
    }

    // ── _wireEventBus ─────────────────────────────────────────
    // Subscribe to cross-module events via EventBus.
    // ── end of _wireEventBus ─────────────────────────────────

    function _wireEventBus() {
        const bus = window.EventBus;
        if (!bus) return;

        // ── file opened → route to panel ──────────────────────
        bus.on("filemanager:fileOpened", ({ path }) => {
            openFile(path);
        });

        // ── archetype activated → update profile badge ────────
        bus.on("modelmanager:archetypeActivated", ({ name, id }) => {
            if (_profileBadge) _profileBadge.textContent = name || id;
            const sel = document.getElementById("profileSelect");
            if (sel) sel.value = id;
        });

        // ── backend status changed → update dot ───────────────
        bus.on("backend:statusChanged", ({ mode, detail }) => {
            if (_statusDot) {
                _statusDot.className = `status-dot ${mode}`;
            }
            if (_statusLabel) {
                const labels = { tauri: "Tauri IPC", crashed: "Crashed", unavailable: "Starting…", offline: "Offline", initializing: "Starting…" };
                _statusLabel.textContent = detail ? `${labels[mode] || mode} (${detail})` : (labels[mode] || mode);
            }
        });

        // ── LLM generating → disable send button ─────────────
        bus.on("llmbridge:generateStarted", () => {
            _generating = true;
            if (_sendBtn) { _sendBtn.disabled = true; _sendBtn.textContent = "…"; }
        });

        bus.on("llmbridge:generateCompleted", () => {
            _generating = false;
            if (_sendBtn) { _sendBtn.disabled = false; _sendBtn.textContent = "Send"; }
        });

        bus.on("llmbridge:generateFailed", () => {
            _generating = false;
            if (_sendBtn) { _sendBtn.disabled = false; _sendBtn.textContent = "Send"; }
        });

        // ── project changed → re-render file manager ──────────
        bus.on("app:projectSelected", ({ project }) => {
            const content = document.getElementById("rightPaneContent") || document.getElementById("fileTreeContainer");
            if (content) {
                delete content.dataset.fmRendered;
                if (_splitMode !== "none" && _secondaryMode === "files") {
                    _renderSecondary("files");
                }
            }
        });

        // Register commands so app.js can dispatch to us
        bus.command("panel", "setSplitMode",     ({ mode })   => setSplitMode(mode));
        bus.command("panel", "setSecondaryMode", ({ mode })   => setSecondaryMode(mode));
        bus.command("panel", "openFile",         ({ path, targetMode }) => openFile(path, targetMode));
        bus.command("panel", "setRouting",       ({ mode })   => setRouting(mode));
    }

    // ── _escapeHtml ───────────────────────────────────────────
    function _escapeHtml(str) {
        return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    }

    // ── _wireSplitButton ─────────────────────────────────────

    function _wireSplitButton() {
        if (!_splitBtn) return;
        _splitBtn.addEventListener("click", () => {
            const cycle = { none: "vertical", vertical: "horizontal", horizontal: "none" };
            setSplitMode(cycle[_splitMode] || "vertical");
        });

        // Update tooltip to show current state
        const titles = { none: "Split vertical (Ctrl+/)", vertical: "Split horizontal (Ctrl+/)", horizontal: "Close split (Ctrl+/)" };
        const update = () => { _splitBtn.title = titles[_splitMode] || "Toggle split"; };
        window.EventBus?.on("panel:splitChanged", update);
        update();
    }

    // ── _wireTabBar ───────────────────────────────────────────

    function _wireTabBar() {
        if (!_rightTabs) return;
        _rightTabs.querySelectorAll(".tab").forEach(btn => {
            btn.addEventListener("click", () => {
                setSecondaryMode(btn.dataset.mode || "files");
            });
        });
    }

    // ── window export ─────────────────────────────────────────
    window.primaryPanel = {
        MANIFEST, setSplitMode, setSecondaryMode, setRouting,
        openFile, getMode: () => _splitMode, getSecondaryMode: () => _secondaryMode
    };
    // ── end of window export ─────────────────────────────────

    // ── auto-init ─────────────────────────────────────────────
    domReady(() => {
        _workspace    = document.getElementById("workspace");
        _paneRight    = document.getElementById("pane-right");
        _splitBtn     = document.getElementById("splitToggleBtn");
        _rightContent = document.getElementById("rightPaneContent");
        _rightTabs    = document.getElementById("rightModeTabs");
        _sendBtn      = document.getElementById("sendBtn");
        _profileBadge = document.getElementById("currentProfileName");
        _statusDot    = document.getElementById("statusDot");
        _statusLabel  = document.getElementById("sidebarStatusText");

        _wireSplitButton();
        _wireTabBar();

        // Wire EventBus after a tick to ensure all modules are bridged
        setTimeout(_wireEventBus, 150);
    });
    // ── end of auto-init ─────────────────────────────────────

})();
