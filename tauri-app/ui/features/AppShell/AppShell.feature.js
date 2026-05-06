// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// AppShell.feature.js — SDOA v4 Feature | v4.0.0 | layer 1
// Migrated from legacy app.js orchestrator leftovers.
// Handles global layouts, sidebars, shortcuts, and command palette.
// ============================================================

(function () {
    "use strict";

    const MANIFEST = {
        id: "AppShell.feature", type: "feature", layer: 1,
        runtime: "Browser", version: "4.0.0",
        requires: ["Toast.prim", "ProjectManager.feature"],
        dataFiles: [],
        lifecycle: ["init"],
        actions: { 
            commands: {
                loadProjects: {},
                selectProject: {},
                updateProfileUI: {}
            }, 
            events: {}, 
            accepts: {}, 
            slots: [] 
        },
        backendDeps: [
            "ListProjectsWorkflow", 
            "CreateProjectWorkflow",
            "AutoOptimizeModelsWorkflow"
        ],
        docs: { description: "Global application shell orchestrator.", author: "ProtoAI team", sdoa: "4.0.0" }
    };

    let _commandPalette = null;
    let _currentProfile = "default";

    async function init() {
        _wireResizers();
        _wireShortcuts();
        _wireUI();
        _wireSendModeToggle();
        
        // Export global aliases needed by legacy components
        window.primaryPanel = {
            setSplitMode: (mode) => {
                const ws = document.getElementById("workspace");
                if (!ws) return;
                ws.classList.remove("split-vertical", "split-horizontal");
                if (mode !== "none") ws.classList.add(`split-${mode}`);
            },
            toggleSplit: () => {
                const ws = document.getElementById("workspace");
                const isSplit = ws?.classList.toggle("split-vertical");
                console.log("[AppShell] Split toggle:", isSplit ? "ON" : "OFF");
            }
        };

        window.refreshFileManager = () => { window.EventBus?.emit("app:projectSelected", { project: window.currentProject }); };
        window.handleFileSelection = (e, row) => {
            document.querySelectorAll(".file-row").forEach(r => r.classList.remove("selected"));
            row.classList.add("selected");
        };
        window.activateCodeTab = () => { window.primaryPanel?.setActiveMode("code"); };
        window.openNewProjectModal = _openNewProjectModal;
        window.closeNewProjectModal = _closeNewProjectModal;
        window.selectProject = selectProject;
        window.loadProjects = loadProjects;

        await loadProjects();

        // Backend recovery
        setTimeout(() => {
            window.backendConnector?.on("backendRecovered", async () => {
                await loadProjects();
                const pol = await window.llmPolicyEngine?.getPolicy().catch(() => null);
                if (pol?.activeProfile) {
                    await updateProfileUI(pol.activeProfile);
                }
            });
        }, 0);
    }

    // ── Command Palette ──────────────────────────────────────────

    function _toggleCommandPalette() {
        if (_commandPalette) return _hideCommandPalette();

        _commandPalette = document.createElement("div");
        _commandPalette.id = "commandPalette";
        _commandPalette.className = "sdoa-palette-overlay";
        _commandPalette.innerHTML = `
            <div class="palette-inner">
                <input type="text" id="paletteInput" placeholder="Semantic search (qmd)..." />
                <div id="paletteResults"></div>
            </div>
        `;
        document.body.appendChild(_commandPalette);

        const paletteInput = document.getElementById("paletteInput");
        paletteInput.focus();

        paletteInput.addEventListener("input", async e => {
            if (e.target.value.length > 2 && window.qmdAdapter) {
                const results = await window.qmdAdapter.search(e.target.value);
                _renderPaletteResults(results);
            }
        });

        document.addEventListener("keydown", e => {
            if (e.key === "Escape") _hideCommandPalette();
        }, { once: true });
    }

    function _hideCommandPalette() {
        _commandPalette?.remove();
        _commandPalette = null;
    }

    function _renderPaletteResults(results) {
        const container = document.getElementById("paletteResults");
        if (!container) return;
        container.innerHTML = "";
        if (!results?.length) {
            container.innerHTML = `<div style="padding:10px;color:var(--text-dim);">No results</div>`;
            return;
        }
        results.forEach(r => {
            const div = document.createElement("div");
            div.className = "palette-result";
            div.textContent = r.title || r.path || r;
            container.appendChild(div);
        });
    }

    // ── Shortcuts ────────────────────────────────────────────────

    function _wireShortcuts() {
        document.addEventListener("keydown", e => {
            const ctrl = e.ctrlKey || e.metaKey;

            if (ctrl && e.key === "Enter")               { e.preventDefault(); window.ChatFeature?.handleSendMessage?.(); }
            if (ctrl && e.key === "k")                   { e.preventDefault(); _toggleCommandPalette(); }
            if (ctrl && e.shiftKey && e.key === "S")     { e.preventDefault(); window.openSettingsPanel?.(); }
            if (ctrl && e.shiftKey && e.key === "N")     { e.preventDefault(); document.getElementById("newProjectBtn")?.click(); }
            if (ctrl && e.shiftKey && e.key === "C")     { e.preventDefault(); document.getElementById("newChatBtn")?.click(); }
            if (ctrl && e.shiftKey && e.key === "M")     { e.preventDefault(); document.getElementById("otfmsEngineSelect")?.focus(); }
            if (ctrl && e.shiftKey && e.key === "F")     { e.preventDefault(); document.getElementById("fileInput")?.click(); }
            if (e.altKey && e.key === "f")               { e.preventDefault(); document.getElementById("folderInput")?.click(); }
            if (e.key === "Escape")                      { window.closeSettingsPanel?.(); window.closeFirstRunWizard?.(); }
        });
    }

    // ── Profiles ─────────────────────────────────────────────────

    async function updateProfileUI(name) {
        _currentProfile = name || "default";

        try {
            if (window.llmPolicyEngine) {
                await window.llmPolicyEngine.updatePolicy({ activeProfile: _currentProfile });
            }
        } catch (e) {
            console.warn("[AppShell] updateProfileUI policy sync failed:", e);
        }

        const badge = document.getElementById("currentProfileName");
        if (badge) {
            badge.textContent = _currentProfile.charAt(0).toUpperCase() + _currentProfile.slice(1);
        }
    }

    // ── Projects ─────────────────────────────────────────────────

    async function loadProjects() {
        const list = document.getElementById("projectList");
        const empty = document.getElementById("projectListEmpty");
        const count = document.getElementById("projectCount");
        if (!list) return;

        try {
            window.ToastPrim?.show("Refreshing projects...", "info");
            const result = await window.backendConnector?.runWorkflow("ListProjectsWorkflow").catch(() => null);
            
            let projects = [];
            if (result && result.projects) {
                projects = result.projects;
            } else if (result && result.data && result.data.projects) {
                projects = result.data.projects;
            }
            
            if (!projects || projects.length === 0) {
                projects = ["default"];
            }

            if (projects.length > 0) {
                if (empty) empty.classList.add("hidden");
                if (count) count.textContent = projects.length;
                list.innerHTML = "";
                projects.forEach(p => {
                    const name = typeof p === "string" ? p : (p.name || p.id || String(p));
                    const li = document.createElement("li");
                    li.className = "sdoa-list__item sdoa-list__item-default";
                    li.dataset.project = name;
                    if (name === "ProtoAI") {
                        li.innerHTML =
                            `<span style="display:flex;align-items:center;gap:5px;">` +
                            `<span style="font-size:10px;padding:1px 4px;border-radius:3px;` +
                            `background:var(--accent,#3b3bff);color:#fff;opacity:0.85;` +
                            `letter-spacing:0.03em;">&lt;/&gt;</span>${name}</span>`;
                        li.title = "Self-edit mode — file tree opens the ProtoAI source root";
                    } else {
                        li.textContent = name;
                    }
                    li.addEventListener("click", () => selectProject(name));
                    list.appendChild(li);
                });
            } else {
                if (empty) empty.classList.remove("hidden");
                if (count) count.textContent = "0";
            }

            const names = projects.map(p => typeof p === "string" ? p : (p.name || p.id));
            if (names.includes("default")) {
                selectProject("default");
            } else if (names.length > 0) {
                selectProject(names[0]);
            } else {
                selectProject("default");
            }

        } catch (err) {
            console.error("[AppShell] loadProjects failed:", err);
            list.innerHTML = '<li class="sdoa-list__item sdoa-list__item-default sdoa-list__item--selected" data-project="default">default</li>';
            selectProject("default");
        }
    }

    function selectProject(name) {
        window.currentProject = name;

        const nameEl = document.getElementById("currentProjectName");
        if (nameEl) nameEl.textContent = name;

        document.querySelectorAll(".sdoa-list__item").forEach(li => {
            li.classList.toggle("sdoa-list__item--selected", li.dataset.project === name);
        });

        window.EventBus?.emit("app:projectSelected", { project: name });
    }

    function _openNewProjectModal() {
        const overlay = document.getElementById("newProjectOverlay");
        if (overlay) overlay.classList.remove("hidden");
    }

    function _closeNewProjectModal() {
        const overlay = document.getElementById("newProjectOverlay");
        if (overlay) overlay.classList.add("hidden");
    }

    // ── Resizers ─────────────────────────────────────────────────

    function _wireResizers() {
        const resizerL = document.getElementById("resizer-left");
        const resizerR = document.getElementById("resizer-right");
        const app      = document.getElementById("app");
        if (!app) return;

        const savedL = localStorage.getItem("protoai:sidebar-left-width");
        const savedR = localStorage.getItem("protoai:sidebar-right-width");
        if (savedL) app.style.setProperty("--sidebar-left-width", savedL);
        if (savedR) app.style.setProperty("--sidebar-right-width", savedR);

        const startResize = (e, side) => {
            const startX = e.clientX;
            const startW = side === "left" 
                ? document.getElementById("sidebar-left").offsetWidth 
                : document.getElementById("sidebar-right").offsetWidth;

            document.body.classList.add("resizing");

            const onMouseMove = (moveEvent) => {
                let newW;
                if (side === "left") {
                    newW = startW + (moveEvent.clientX - startX);
                    if (newW < 180) newW = 180;
                    if (newW > 600) newW = 600;
                    app.style.setProperty("--sidebar-left-width", `${newW}px`);
                    localStorage.setItem("protoai:sidebar-left-width", `${newW}px`);
                } else {
                    newW = startW - (moveEvent.clientX - startX);
                    if (newW < 160) newW = 160;
                    if (newW > 500) newW = 500;
                    app.style.setProperty("--sidebar-right-width", `${newW}px`);
                    localStorage.setItem("protoai:sidebar-right-width", `${newW}px`);
                }
            };

            const onMouseUp = () => {
                document.body.classList.remove("resizing");
                window.removeEventListener("mousemove", onMouseMove);
                window.removeEventListener("mouseup", onMouseUp);
            };

            window.addEventListener("mousemove", onMouseMove);
            window.addEventListener("mouseup", onMouseUp);
        };

        resizerL?.addEventListener("mousedown", (e) => startResize(e, "left"));
        resizerR?.addEventListener("mousedown", (e) => startResize(e, "right"));
    }

    // ── Mode & Auto-Optimize ─────────────────────────────────────

    function _wireSendModeToggle() {
        const modeSingle = document.getElementById("sidebarModeSingle");
        const modeMulti  = document.getElementById("sidebarModeMulti");
        const modeHint   = document.getElementById("sidebarModeHint");

        function updateModeUI() {
            const isMulti = localStorage.getItem("protoai:orchestrator:enabled") === "true";
            if (modeSingle) {
                modeSingle.style.background = isMulti ? "var(--bg-elevated)" : "var(--accent-dim)";
                modeSingle.style.color = isMulti ? "var(--text-muted)" : "var(--text-primary)";
            }
            if (modeMulti) {
                modeMulti.style.background = isMulti ? "var(--accent-dim)" : "var(--bg-elevated)";
                modeMulti.style.color = isMulti ? "var(--text-primary)" : "var(--text-muted)";
            }
            if (modeHint) {
                modeHint.textContent = isMulti ? "Orchestrator: ACTIVE (High Fidelity)" : "Orchestrator: OFF (Direct Chat)";
            }
        }

        modeSingle?.addEventListener("click", () => {
            localStorage.setItem("protoai:orchestrator:enabled", "false");
            updateModeUI();
        });

        modeMulti?.addEventListener("click", () => {
            localStorage.setItem("protoai:orchestrator:enabled", "true");
            updateModeUI();
        });

        updateModeUI();
    }

    function _wireUI() {
        document.getElementById("refreshProjectsBtn")?.addEventListener("click", () => loadProjects());
        document.getElementById("openSettingsButton")?.addEventListener("click", () => window.openSettingsPanel?.());
        document.getElementById("newProjectBtn")?.addEventListener("click", () => _openNewProjectModal());
        
        document.getElementById("npCloseBtn")?.addEventListener("click", () => _closeNewProjectModal());
        document.getElementById("npCancelBtn")?.addEventListener("click", () => _closeNewProjectModal());

        document.getElementById("sidebarReloadUI")?.addEventListener("click", () => {
            window.ToastPrim?.show("Reloading UI...", "info");
            setTimeout(() => location.reload(), 500);
        });

        document.getElementById("sidebarRestartBackend")?.addEventListener("click", async () => {
            try {
                window.ToastPrim?.show("Restarting sidecar engine...", "info");
                const btn = document.getElementById("sidebarRestartBackend");
                if (btn) btn.disabled = true;
                
                await window.__TAURI__.core.invoke("engine_reconnect");
                
                window.ToastPrim?.show("Sidecar engine reconnected.", "success");
                await loadProjects();
            } catch (err) {
                window.ToastPrim?.show("Restart failed: " + err.message, "error");
            } finally {
                const btn = document.getElementById("sidebarRestartBackend");
                if (btn) btn.disabled = false;
            }
        });

        document.getElementById("npCreateBtn")?.addEventListener("click", async () => {
            const name = document.getElementById("npName")?.value.trim();
            if (!name) return window.ToastPrim?.show("Project name is required.");
            try {
                await window.backendConnector?.runWorkflow("CreateProjectWorkflow", { project: name });
                window.ToastPrim?.show(`Project "${name}" created.`);
                _closeNewProjectModal();
                loadProjects();
                selectProject(name);
            } catch (err) {
                window.ToastPrim?.show(`Creation failed: ${err.message}`);
            }
        });

        document.getElementById("toggleCanvasBtn")?.addEventListener("click", () => {
            document.getElementById("canvas")?.classList.toggle("collapsed");
        });

        document.getElementById("splitToggleBtn")?.addEventListener("click", () => {
            window.primaryPanel?.toggleSplit();
        });

        document.getElementById("autoOptimizeBtn")?.addEventListener("click", _handleAutoOptimize);

        // Chip delegates
        document.querySelectorAll("[data-action]").forEach(btn => {
            btn.addEventListener("click", () => {
                const action = btn.dataset.action;
                const project = window.currentProject || "default";
                switch (action) {
                    case "image":
                        window.ToastPrim?.show("Prompt Creator coming soon!", "info");
                        break;
                    case "image_gen":
                        window.ToastPrim?.show("Image Generator coming soon!", "info");
                        break;
                    case "deepsearch":
                        window.ToastPrim?.show("Research Assistant coming soon!", "info");
                        break;
                    case "gdrive":
                        window.googleDriveConnector?.open(project);
                        break;
                    case "connectors":
                        window.ToastPrim?.show("Connectors panel coming soon! Use Google Drive for now.", "info");
                        break;
                }
            });
        });

        // Split mode tabs
        document.querySelectorAll("#rightModeTabs .tab").forEach(btn => {
            btn.addEventListener("click", () => {
                document.querySelectorAll("#rightModeTabs .tab").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
            });
        });
    }

    async function _handleAutoOptimize() {
        const btn = document.getElementById("autoOptimizeBtn");
        if (!btn) return;
        const originalText = btn.innerHTML;
        
        try {
            btn.disabled = true;
            btn.innerHTML = "🪄 Optimizing...";
            
            window.ToastPrim?.show("Fetching best free models from OpenRouter...", "info");
            
            const result = await window.backendConnector?.runWorkflow("AutoOptimizeModelsWorkflow");
            
            if (result && result.selection) {
                const s = result.selection;
                window.ToastPrim?.show("Success! Selected best free models for your tasks.", "success");

                // Refresh all model dropdowns in Chat and sidebar
                window.EventBus?.emit("models:updated", { selection: s });

                if (window.Settings) {
                    await window.Settings.load();
                    await window.Settings.render();
                }
            } else {
                throw new Error(result?.error || "Optimization failed");
            }
        } catch (err) {
            window.ToastPrim?.show("Optimization failed: " + err.message, "error");
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }

    window.AppShellFeature = { MANIFEST, init, loadProjects, selectProject, updateProfileUI };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { init, loadProjects, selectProject, updateProfileUI });

})();
