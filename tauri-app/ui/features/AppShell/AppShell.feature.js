/* ============================================================
   AppShell.feature.js — SDOA v4 Feature Core
   version: 4.1.0
   Last modified: 2026-05-09 03:57 UTC
   ============================================================ */

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    const MANIFEST = {
        id:      "AppShell.feature",
        type:    "feature",
        layer:   1,
        runtime: "Browser",
        version: "4.1.0",
        requires: [],
        docs: {
            description: "Core UI orchestrator for resizing, global shortcuts, project switching, and system status.",
            author: "ProtoAI Team"
        }
    };

    let _sidebarCollapsed = false;

    // ── Module Interface ──────────────────────────────────────

    async function init() {
        console.log("[AppShell.feature] Initializing v4.1.0...");
        try {
            _verifyDOM();
            _wireResizers();
            _wireShortcuts();
            _wireUI();
            _wireSendModeToggle();
            
            await loadProjects();
            updateProfileUI();

            // Listen for project selection from elsewhere
            window.EventBus?.on("app:projectSelected", (payload) => {
                window.currentProject = payload.project;
                _updateActiveProjectUI();
            });

            console.log("[AppShell.feature] Boot sequence finalized.");
        } catch (err) {
            console.error("[AppShell.feature] Boot failed:", err);
            window.EventBus?.emit("module:error", { id: MANIFEST.id, phase: "init", error: err.message });
        }
    }

    /**
     * Verifies that critical DOM elements exist before attempting to wire them.
     * Prevents the "one fix breaks another" cycle caused by missing IDs.
     */
    function _verifyDOM() {
        const required = [
            "sidebar-left", "resizer-left", "main", "projectList", 
            "currentProjectName", "currentProfileName"
        ];
        const missing = required.filter(id => !document.getElementById(id));
        if (missing.length > 0) {
            throw new Error(`Critical DOM elements missing: ${missing.join(", ")}`);
        }
    }

    // ── Interaction Wiring ────────────────────────────────────

    function _wireResizers() {
        const resizer = document.getElementById("resizer-left");
        const sidebar = document.getElementById("sidebar-left");
        if (!resizer || !sidebar) {
            console.warn("[AppShell] Skipping resizers — elements not found.");
            return;
        }

        let isResizing = false;
        resizer.addEventListener("mousedown", (e) => {
            isResizing = true;
            document.body.style.cursor = "col-resize";
            document.body.classList.add("is-resizing");
        });

        document.addEventListener("mousemove", (e) => {
            if (!isResizing) return;
            const width = Math.max(200, Math.min(600, e.clientX));
            sidebar.style.width = `${width}px`;
        });

        document.addEventListener("mouseup", () => {
            if (!isResizing) return;
            isResizing = false;
            document.body.style.cursor = "default";
            document.body.classList.remove("is-resizing");
        });
    }

    function _wireShortcuts() {
        window.addEventListener("keydown", (e) => {
            // Cmd/Ctrl + B to toggle sidebar
            if ((e.metaKey || e.ctrlKey) && e.key === "b") {
                e.preventDefault();
                _toggleSidebar();
            }
            // Cmd/Ctrl + , for settings
            if ((e.metaKey || e.ctrlKey) && e.key === ",") {
                e.preventDefault();
                window.openSettingsPanel?.();
            }
        });
    }

    function _toggleSidebar() {
        const sidebar = document.getElementById("sidebar-left");
        _sidebarCollapsed = !_sidebarCollapsed;
        sidebar?.classList.toggle("collapsed", _sidebarCollapsed);
    }

    function _wireUI() {
        // Essential Buttons
        document.getElementById("refreshProjectsBtn")?.addEventListener("click", () => loadProjects());
        document.getElementById("openSettingsButton")?.addEventListener("click", () => window.openSettingsPanel?.());
        document.getElementById("newProjectBtn")?.addEventListener("click", () => _openNewProjectModal());
        
        document.getElementById("npCloseBtn")?.addEventListener("click", () => _closeNewProjectModal());
        document.getElementById("npCancelBtn")?.addEventListener("click", () => _closeNewProjectModal());

        document.getElementById("sidebarReloadUI")?.addEventListener("click", () => {
            window.ToastPrim?.show("Refreshing Interface...", "info");
            setTimeout(() => location.reload(), 500);
        });

        document.getElementById("sidebarRestartBackend")?.addEventListener("click", async () => {
            console.log("[AppShell] Triggering Sidecar Reboot...");
            window.ToastPrim?.show("Restarting sidecar engine...", "warning");
            try {
                await window.backendConnector?.runWorkflow("restart_engine");
                setTimeout(() => location.reload(), 2000);
            } catch (err) {
                window.ToastPrim?.show("Sidecar reboot failed: " + err.message, "error");
            }
        });

        console.log("[AppShell] Wiring click delegate for global [data-action] chips...");
        // Chip delegates — Use event delegation to handle dynamically added chips (e.g. in Chat)
        window.addEventListener("click", async (e) => {
            const btn = e.target.closest("[data-action]");
            if (!btn) return;

            const action = btn.dataset.action;
            const project = window.currentProject || "default";

            console.log(`[AppShell] Quick Action: ${action} [Project: ${project}]`);

            switch (action) {
                case "image":
                    _handlePromptCreator();
                    break;
                case "image_gen":
                    _handleImageGen();
                    break;
                case "deepsearch":
                    _handleDeepSearch();
                    break;
                case "gdrive":
                    window.backendConnector?.runWorkflow("GoogleDrive.workflow", { action: "open", project });
                    break;
                case "connectors":
                    window.ToastPrim?.show("Connectors panel coming soon! Use Google Drive for now.", "info");
                    break;
                default:
                    console.log(`[AppShell] No handler for action: ${action}`);
            }
        });
    }

    function _wireSendModeToggle() {
        const modeSingle = document.getElementById("sidebarModeSingle");
        const modeMulti  = document.getElementById("sidebarModeMulti");

        console.log("[AppShell] Initializing send-mode toggle state...");

        const updateModeUI = () => {
            const enabled = localStorage.getItem("protoai:orchestrator:enabled") !== "false";
            console.log(`[AppShell] Orchestrator Status: ${enabled ? "MULTI" : "SINGLE"}`);
            
            if (modeSingle) {
                modeSingle.classList.toggle("active", !enabled);
                modeSingle.style.background = !enabled ? "var(--bg-active)" : "transparent";
            }
            if (modeMulti) {
                modeMulti.classList.toggle("active", enabled);
                modeMulti.style.background  = enabled ? "var(--bg-active)" : "transparent";
            }
        };

        modeSingle?.addEventListener("click", () => {
            localStorage.setItem("protoai:orchestrator:enabled", "false");
            updateModeUI();
            window.EventBus?.emit("orchestrator:modeChanged", { enabled: false });
            window.EventBus?.emit("app:force_reset"); // Recovery trigger
        });

        modeMulti?.addEventListener("click", () => {
            localStorage.setItem("protoai:orchestrator:enabled", "true");
            updateModeUI();
            window.EventBus?.emit("orchestrator:modeChanged", { enabled: true });
            window.EventBus?.emit("app:force_reset"); // Recovery trigger
        });

        updateModeUI();
    }

    // ── Handlers ──────────────────────────────────────────────

    async function _handleAutoOptimize() {
        console.log("[AppShell] Requesting model optimization...");
        window.ToastPrim?.show("Analyzing local model weights...", "info");
        try {
            const res = await window.backendConnector?.runWorkflow("AutoOptimizeModels.workflow");
            window.ToastPrim?.show(res?.data?.message || "Optimization complete.", "success");
        } catch (err) {
            window.ToastPrim?.show("Optimization failed: " + err.message, "error");
        }
    }

    function _handlePromptCreator() {
        const input = document.getElementById("chatInput");
        if (!input || !input.value.trim()) {
            window.ToastPrim?.show("Type a basic prompt first!", "info");
            return;
        }
        window.EventBus?.emit("chat:promptOptimize", { text: input.value });
    }

    async function _handleImageGen() {
        const input = document.getElementById("chatInput");
        const promptText = input?.value || "A futuristic AI laboratory";
        
        window.ToastPrim?.show("Generating image...", "info");
        try {
            const res = await window.backendConnector?.runWorkflow("ImageGenWorkflow", { prompt: promptText });
            const url = res?.data?.url || res?.url || res?.data?.path || res?.path;
            if (url) {
                window.EventBus?.emit("chat:appendSystemMessage", { text: `Generated: ![Image](${url})` });
            }
        } catch (err) {
            window.ToastPrim?.show("Image generation failed: " + err.message, "error");
        }
    }

    function _handleDeepSearch() {
        const input = document.getElementById("chatInput");
        if (!input || !input.value.trim()) {
            window.ToastPrim?.show("Enter a research topic first.", "info");
            return;
        }
        window.EventBus?.emit("chat:deepSearch", { query: input.value });
    }

    // ── Project Management ────────────────────────────────────

    function _openNewProjectModal() {
        document.getElementById("newProjectOverlay")?.classList.remove("hidden");
    }

    function _closeNewProjectModal() {
        document.getElementById("newProjectOverlay")?.classList.add("hidden");
    }

    async function loadProjects() {
        const list = document.getElementById("projectList");
        if (!list) return;

        try {
            console.log("[AppShell] Syncing projects with backend...");
            const res = await window.backendConnector?.runWorkflow("projects");
            const projects = res?.projects || res?.data?.projects || [];
            
            list.innerHTML = projects.map(p => {
                const name = typeof p === "string" ? p : (p.name || "Unknown");
                const isSelf = name.toLowerCase() === "protoai";
                return `
                    <li class="project-item ${window.currentProject === name ? "active" : ""}" data-project="${name}" 
                        style="display:flex; align-items:center; gap:8px; padding:8px; border-radius:6px; cursor:pointer; list-style:none; margin-bottom:2px;">
                        <span class="icon">${isSelf ? "🤖" : "📁"}</span>
                        <span class="name" style="flex:1;">${name}</span>
                        ${isSelf ? '<span class="sdoa-badge" style="font-size:9px; background:var(--accent); color:white;">SELF</span>' : ""}
                    </li>
                `;
            }).join("");

            list.querySelectorAll(".project-item").forEach(item => {
                item.addEventListener("click", () => {
                    const p = item.dataset.project;
                    selectProject(p);
                });
            });

            const countEl = document.getElementById("projectCount");
            if (countEl) countEl.textContent = projects.length;

            _updateActiveProjectUI();
        } catch (err) {
            console.error("[AppShell] Failed to load projects:", err);
            window.ToastPrim?.show("Project list unavailable", "error");
        }
    }

    function selectProject(project) {
        console.log(`[AppShell] Context Switch: ${project}`);
        window.currentProject = project;
        
        if (window.StateStore) {
            window.StateStore.set("currentProject", project);
        }
        
        window.EventBus?.emit("app:projectSelected", { project });
        _updateActiveProjectUI();
    }

    function _updateActiveProjectUI() {
        document.querySelectorAll(".project-item").forEach(item => {
            item.classList.toggle("active", item.dataset.project === window.currentProject);
        });
        const status = document.getElementById("currentProjectName");
        if (status) status.textContent = window.currentProject || "No project selected";
    }

    function updateProfileUI() {
        const currentProfile = localStorage.getItem("protoai:profile:active") || "default";
        const badge = document.getElementById("profileBadge");
        if (badge) badge.textContent = currentProfile.charAt(0).toUpperCase();
        
        const text = document.getElementById("currentProfileName");
        if (text) text.textContent = currentProfile;
    }

    // ── Exports ───────────────────────────────────────────────

    const feature = { MANIFEST, init, loadProjects, selectProject, updateProfileUI };
    window.AppShellFeature = feature;
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, feature);

})();
