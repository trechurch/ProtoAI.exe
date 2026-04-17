// ============================================================
// BackendConnector.ui.js — UI Adapter (Browser-Safe)
// version: 3.2.0
// depends: tauri-utils.js (must load first)
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    // ── BackendConnector.ui ───────────────────────────────────
    // Browser-safe UI adapter for Tauri IPC.
    // All workflow names are mapped to their exact Rust command
    // as registered in commands.rs. There is no generic
    // run_workflow command — every call must be explicit.
    // ── end of BackendConnector.ui ───────────────────────────

    class BackendConnector {

        // ── SDOA v3.2 MANIFEST ───────────────────────────────
        static MANIFEST = {
            id:          "BackendConnector.ui",
            type:        "adapter",
            runtime:     "Browser",
            version:     "3.2.0",
            capabilities: [
                "runWorkflow",
                "backend-status",
                "tauri-ipc",
                "transport.reconnect",
                "event.emit"
            ],
            dependencies: ["tauri-utils.js"],
            docs: {
                description: "Browser-safe Tauri IPC adapter. Maps all workflow names to registered Rust commands in commands.rs. No generic run_workflow — every command is explicit.",
                input:  { workflow: "string", payload: "object?" },
                output: "Promise<any>",
                author: "ProtoAI team",
                sdoa_compatibility: `
                    SDOA Compatibility Contract:
                    - v1.2 Manifest is minimum requirement.
                    - v3.x adds actions surface additively.
                    - Lower versions ignore unknown fields.
                    - Higher versions preserve old semantics.
                    - All versions forward/backward compatible.
                `
            },
            actions: {
                commands: {
                    runWorkflow:      { description: "Execute a backend workflow via Tauri IPC.", input: { workflow: "string", payload: "object?" }, output: "Promise<any>" },
                    reconnect:        { description: "Attempt to reconnect the Tauri sidecar.",  input: {}, output: "boolean" },
                    getBackendStatus: { description: "Query backend engine status.",              input: {}, output: "string" }
                },
                triggers: {
                    backendCrashed:   { description: "Fires when the Tauri sidecar reports a crash." },
                    backendRecovered: { description: "Fires when the backend returns to ready state." }
                },
                emits: {
                    statusChanged:  { description: "Emits backend status updates.", payload: { mode: "string", detail: "string?" } },
                    workflowFailed: { description: "Emits when a workflow fails.",  payload: { workflow: "string", error: "string" } }
                },
                workflows: {
                    runWorkflow:      { description: "Primary workflow execution entrypoint.", input: { name: "string", payload: "object?" }, output: "Promise<any>" },
                    getBackendStatus: { description: "Wrapper for engine_status.",             input: {}, output: "string" }
                }
            }
        };
        // ── end of SDOA v3.2 MANIFEST ────────────────────────

        constructor() {
            this.status          = "connecting";
            this.listeners       = [];
            this.TAURI_AVAILABLE = !!(window.__TAURI__?.core?.invoke);

            console.log(`[BackendConnector.ui] Tauri IPC: ${this.TAURI_AVAILABLE ? "available" : "unavailable"}`);
            this._initStatusPolling();
        }

        // ── event emitter ────────────────────────────────────

        on(event, handler)  { this.listeners.push({ event, handler }); }

        off(event, handler) {
            this.listeners = this.listeners.filter(
                l => !(l.event === event && l.handler === handler)
            );
        }

        emit(event, data) {
            for (const l of this.listeners) {
                if (l.event === event) {
                    try { l.handler(data); } catch (e) {
                        console.error(`[BackendConnector.ui] Listener error (${event}):`, e);
                    }
                }
            }
        }

        // ── end of event emitter ─────────────────────────────

        // ── setBackendStatus ─────────────────────────────────

        setBackendStatus(mode, detail = "") {
            this.status = mode;

            const labels      = { tauri: "Backend: Tauri IPC (sidecar active)", http: "Backend: initializing…", crashed: "Sidecar crashed. Use Reconnect.", unavailable: "Backend: sidecar initializing…", offline: "Backend: offline" };
            const shortLabels = { tauri: "Tauri IPC", http: "Starting…", crashed: "Crashed", unavailable: "Starting…", offline: "Offline" };

            const text      = labels[mode]      ?? mode;
            const shortText = shortLabels[mode] ?? mode;

            const badge = document.getElementById("currentProfileName");
            if (badge) badge.title = detail ? `${text}\n${detail}` : text;

            const dot   = document.getElementById("statusDot");
            const label = document.getElementById("sidebarStatusText");
            if (dot)   dot.className    = `status-dot ${mode}`;
            if (label) label.textContent = detail ? `${shortText} (${detail})` : shortText;

            this.emit("statusChanged", { mode, detail });
        }

        // ── getBackendStatus ─────────────────────────────────

        async getBackendStatus() {
            if (!this.TAURI_AVAILABLE) return "offline";
            try { return await window.__TAURI__.core.invoke("engine_status"); }
            catch { return "offline"; }
        }

        // ── _initStatusPolling ───────────────────────────────

        async _initStatusPolling() {
            if (!this.TAURI_AVAILABLE) { this.setBackendStatus("unavailable"); return; }
            try {
                const status = await this.getBackendStatus();
                this.setBackendStatus(status === "ready" ? "tauri" : "unavailable");
            } catch {
                this.setBackendStatus("unavailable");
            }
        }

        // ── showReconnectButton ──────────────────────────────

        showReconnectButton() {
            if (!this.TAURI_AVAILABLE) return;
            const container = document.getElementById("chatContainer");
            if (!container || container.querySelector(".reconnect-btn")) return;

            const btn = document.createElement("button");
            btn.textContent   = "Reconnect Sidecar";
            btn.className     = "secondary reconnect-btn";
            btn.style.cssText = "margin:8px 0;display:block;";

            btn.onclick = async () => {
                btn.disabled = true; btn.textContent = "Reconnecting…";
                try {
                    await window.__TAURI__.core.invoke("engine_reconnect");
                    this.setBackendStatus("tauri");
                    btn.remove();
                    this.emit("backendRecovered", {});
                } catch (err) {
                    btn.textContent = "Reconnect failed — try again";
                    btn.disabled    = false;
                    console.error("[BackendConnector.ui] Reconnect failed:", err);
                }
            };
            container.appendChild(btn);
        }

        // ── invokeTauri ──────────────────────────────────────
        // Maps workflow names to the exact Rust commands in
        // commands.rs. No generic run_workflow exists.
        // Unregistered workflows return null with a warning.
        // ── end of invokeTauri ───────────────────────────────

        async invokeTauri(workflow, payload) {
            const inv = window.__TAURI__.core.invoke.bind(window.__TAURI__.core);

            switch (workflow) {

                // ── engine status ─────────────────────────────
                case "health_check":
                case "get_status":
                    return inv("get_status");

                // ── projects ──────────────────────────────────
                case "ListProjectsWorkflow":
                case "engine_projects":
                    return inv("engine_projects");

                // ── profiles ──────────────────────────────────
                case "ListProfilesWorkflow":
                case "engine_profiles":
                    return inv("engine_profiles");

                // ── history ───────────────────────────────────
                case "LoadProjectHistoryWorkflow":
                case "engine_history":
                    return inv("engine_history", {
                        project: payload?.project || ""
                    });

                // ── chat ──────────────────────────────────────
                case "SendMessageWorkflow":
                case "engine_chat":
                    return inv("engine_chat", {
                        project: payload?.project || "",
                        profile: payload?.profile || "",
                        engine:  payload?.engine  || "",
                        text:    payload?.message || payload?.text || ""
                    });

                case "SendMessageStreamWorkflow":
                case "engine_chat_stream":
                    return inv("engine_chat_stream", {
                        project: payload?.project || "",
                        profile: payload?.profile || "",
                        engine:  payload?.engine  || "",
                        text:    payload?.message || payload?.text || ""
                    });

                // ── upload ────────────────────────────────────
                case "UploadWorkflow":
                case "engine_upload":
                    return inv("engine_upload", {
                        project:   payload?.project   || "",
                        file_path: payload?.file_path || payload?.filename || "",
                        content:   payload?.content   || ""
                    });

                // ── ingest ────────────────────────────────────
                case "IngestWorkflow":
                case "engine_ingest":
                    return inv("engine_ingest", {
                        project: payload?.project || ""
                    });

                // ── image gen ─────────────────────────────────
                case "ImageGenWorkflow":
                case "engine_image_gen":
                    return inv("engine_image_gen", {
                        prompt:  payload?.text    || payload?.prompt || "",
                        project: payload?.project || ""
                    });

                // ── deep search ───────────────────────────────
                case "DeepSearchWorkflow":
                case "engine_deep_search":
                    return inv("engine_deep_search", {
                        query: payload?.query || ""
                    });

                // ── qmd ───────────────────────────────────────
                case "qmd_search":
                case "engine_qmd_search":
                    return inv("engine_qmd_search", {
                        query:   payload?.query   || "",
                        project: payload?.project || ""
                    });

                case "qmd_index":
                case "engine_qmd_index":
                    return inv("engine_qmd_index", {
                        project:   payload?.project   || "",
                        deep_scan: payload?.deep_scan ?? false
                    });

                // ── settings ──────────────────────────────────
                case "get_settings":
                case "settings_get":
                    return inv("settings_get");

                case "update_settings":
                case "settings_set":
                    return inv("settings_set", {
                        key:   payload?.key   || "",
                        value: payload?.value ?? payload
                    });

                case "settings_test_key":
                    return inv("settings_test_key", {
                        provider: payload?.provider || "",
                        key:      payload?.key      || ""
                    });

                case "settings_first_run_status":
                    return inv("settings_first_run_status");

                case "settings_complete_first_run":
                    return inv("settings_complete_first_run");

                // ── policy (maps to settings) ─────────────────
                case "get_policy":
                    return inv("settings_get");

                case "update_policy":
                    return inv("settings_set", {
                        key:   "policy",
                        value: payload
                    });

                // ── filesystem ────────────────────────────────
                case "get_project_dir":
                    return inv("get_project_dir", {
                        project: payload?.project || ""
                    });

                case "fs_read_file":
                    return inv("fs_read_file", { path: payload?.path || "" });

                case "fs_write_file":
                    return inv("fs_write_file", { path: payload?.path || "", content: payload?.content || "" });

                case "fs_rename":
                    return inv("fs_rename", { old_path: payload?.old_path || "", new_path: payload?.new_path || "" });

                case "fs_unlink":
                    return inv("fs_unlink", { path: payload?.path || "" });

                case "fs_mkdir":
                    return inv("fs_mkdir", { path: payload?.path || "" });

                case "fs_copy":
                    return inv("fs_copy", { source: payload?.source || "", destination: payload?.destination || "" });

                case "fs_remove":
                    return inv("fs_remove", { path: payload?.path || "" });

                case "fs_stat":
                    return inv("fs_stat", { path: payload?.path || "" });

                // ── VFS workflows (routed through engine_ipc) ───────────────
                case "vfs_add":
                    return inv("engine_chat", { project: payload?.project || "", profile: "_vfs_", engine: "", text: JSON.stringify({ __vfs_type: "vfs_add", ...payload }) });
                case "vfs_list":
                case "vfs_manifest":
                case "vfs_remove":
                    // These go through run_workflow fallback path via server-ipc
                    // until a dedicated Rust command is added
                    console.warn(`[BackendConnector.ui] VFS workflow "${workflow}" needs Rust command — using IPC passthrough`);
                    return null;

                // ── file listing ─────────────────────────────
                // realPath → use fast Rust fs_list_dir
                // project-relative → route through IPC server (returns null, falls to IPC)
                case "ListFilesWorkflow":
                case "list_files":
                    if (payload?.realPath) {
                        return inv("fs_list_dir", { path: payload.realPath });
                    }
                    return null; // IPC server handles project-relative listing

                case "FilePermissionsWorkflow":
                case "engine_file_permissions":
                    return null; // IPC server handles permissions

                // ── search history ───────────────────────────────────
                case "search_history":
                    return inv("engine_ipc", { msg_type: "search_history", payload });

                // ── VFS — route through engine_ipc generic passthrough ──
                case "vfs_add":
                case "VfsAddWorkflow":
                    return inv("engine_ipc", { msg_type: "vfs_add", payload });
                case "vfs_list":
                case "VfsListWorkflow":
                    return inv("engine_ipc", { msg_type: "vfs_list", payload });
                case "vfs_manifest":
                case "VfsManifestWorkflow":
                    return inv("engine_ipc", { msg_type: "vfs_manifest", payload });
                case "vfs_permissions":
                case "VfsUpdatePermissionsWorkflow":
                    return inv("engine_ipc", { msg_type: "vfs_permissions", payload });
                case "list_files":
                case "ListFilesWorkflow":
                    if (payload?.realPath) {
                        return inv("fs_list_dir", { path: payload.realPath });
                    }
                    return inv("engine_ipc", { msg_type: "list_files", payload });

                // ── not registered — return null gracefully ───
                case "get_launch_flags":
                case "save_model_inventory":
                case "get_model_inventory":
                case "llm_generate":
                case "file_read_config":
                case "file_write_config":
                    return null;

                // ── unknown ───────────────────────────────────
                default:
                    console.warn(`[BackendConnector.ui] Unknown workflow: "${workflow}" — no matching Rust command`);
                    return null;
            }
        }

        // ── runWorkflow ──────────────────────────────────────
        // Primary public API. All UI modules call this.
        // ── end of runWorkflow ───────────────────────────────

        async runWorkflow(name, payload = {}) {
            if (!this.TAURI_AVAILABLE) {
                this.setBackendStatus("offline");
                this.emit("workflowFailed", { workflow: name, error: "Tauri IPC not available" });
                throw new Error("[BackendConnector.ui] Tauri IPC not available");
            }

            try {
                const result = await this.invokeTauri(name, payload);
                this.setBackendStatus("tauri");
                return result;

            } catch (err) {
                const msg = String(err).toLowerCase();
                const isTransportError =
                    msg.includes("crash")           ||
                    msg.includes("not ready")        ||
                    msg.includes("sidecar")          ||
                    msg.includes("timed out")        ||
                    msg.includes("write to sidecar") ||
                    msg.includes("failed to fetch");

                this.emit("workflowFailed", { workflow: name, error: err.message });

                if (isTransportError) {
                    console.warn(`[BackendConnector.ui] Transport failure on "${name}":`, err?.message || String(err));
                    try {
                        const engineStatus = await window.__TAURI__.core.invoke("engine_status");
                        if (engineStatus === "crashed") {
                            this.setBackendStatus("crashed");
                            this.emit("backendCrashed", {});
                            this.showReconnectButton();
                        }
                    } catch (_) {}
                }

                this.setBackendStatus("offline");
                throw err;
            }
        }

    }
    // ── end of class BackendConnector ────────────────────────

    domReady(() => {
        window.backendConnector = new BackendConnector();
    });

})();
