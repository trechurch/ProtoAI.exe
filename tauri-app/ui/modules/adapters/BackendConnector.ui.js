// ============================================================
// BackendConnector.ui.js — UI Adapter (Browser-Safe)
// version: 3.2.3
// Last modified: 2026-05-04 03:11 UTC
// depends: tauri-utils.js (must load first)
// ============================================================

(function () {
    "use strict";

    class BackendConnector {

        constructor() {
            this.status          = "connecting";
            this.listeners       = [];
            // Safe check for Tauri core
            this.TAURI_AVAILABLE = !!(window.__TAURI__?.core?.invoke);

            console.log(`[BackendConnector.ui] Tauri IPC: ${this.TAURI_AVAILABLE ? "available" : "unavailable"}`);
            
            // Wait for DOM to ensure status elements are available before first update
            if (window.TauriUtils?.domReady) {
                window.TauriUtils.domReady(() => this._init());
            } else {
                // Fallback if TauriUtils missing or not yet loaded
                document.addEventListener("DOMContentLoaded", () => this._init());
            }
        }

        _init() {
            this._initStatusPolling();
        }

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

        setBackendStatus(mode, detail = "") {
            this.status = mode;

            const labels      = { 
                tauri: "Backend: Tauri IPC (sidecar active)", 
                initializing: "Backend: sidecar starting...",
                crashed: "Sidecar crashed. Click to reconnect.", 
                unavailable: "Backend: initializing...", 
                offline: "Backend: offline — click to reconnect" 
            };
            const shortLabels = { 
                tauri: "Tauri IPC", 
                initializing: "Starting...", 
                crashed: "Crashed", 
                unavailable: "Starting...", 
                offline: "Offline" 
            };

            const text      = labels[mode]      ?? mode;
            const shortText = shortLabels[mode] ?? mode;

            const dot   = document.getElementById("statusDot");
            const label = document.getElementById("sidebarStatusText");
            const row   = document.getElementById("statusRow");
            
            if (dot)   dot.className     = `status-dot ${mode}`;
            if (label) label.textContent = detail ? `${shortText} (${detail})` : shortText;

            const reconnectable = (mode === "offline" || mode === "crashed" || mode === "unavailable");
            if (row) {
                row.classList.toggle("status-row--reconnectable", reconnectable);
                if (reconnectable) {
                    if (!row._reconnectHandler) {
                        row._reconnectHandler = async () => {
                            if (this.isReconnecting) return;
                            this.isReconnecting = true;
                            
                            if (label) label.textContent = "Reconnecting...";
                            row.classList.add("status-row--busy");
                            
                            try {
                                await Promise.race([
                                    window.__TAURI__.core.invoke("engine_reconnect"),
                                    new Promise((_, reject) => setTimeout(() => reject(new Error("Reconnect timed out")), 10000))
                                ]);
                                this.setBackendStatus("tauri");
                                this.emit("backendRecovered", {});
                            } catch (err) {
                                this.setBackendStatus("offline", err.message || "Failed");
                                console.error("[BackendConnector.ui] Reconnect failed:", err);
                            } finally {
                                this.isReconnecting = false;
                                row.classList.remove("status-row--busy");
                            }
                        };
                        row.addEventListener("click", row._reconnectHandler);
                    }
                }
            }

            this.emit("statusChanged", { mode, detail });
        }

        async getBackendStatus() {
            if (!this.TAURI_AVAILABLE) return "offline";
            try { return await window.__TAURI__.core.invoke("engine_status"); }
            catch { return "offline"; }
        }

        async _initStatusPolling() {
            if (!this.TAURI_AVAILABLE) { this.setBackendStatus("offline"); return; }
            
            const poll = async () => {
                try {
                    const status = await this.getBackendStatus();
                    if (status === "ready") {
                        this.setBackendStatus("tauri");
                    } else if (status === "crashed") {
                        this.setBackendStatus("crashed");
                    } else {
                        this.setBackendStatus("initializing");
                    }
                } catch (err) {
                    this.setBackendStatus("offline");
                }
            };

            await poll();
            if (this.pollInterval) clearInterval(this.pollInterval);
            this.pollInterval = setInterval(() => {
                if (this.status !== "tauri") poll();
            }, 5000);
        }

        async invokeTauri(workflow, payload) {
            const inv = window.__TAURI__.core.invoke.bind(window.__TAURI__.core);

            switch (workflow) {
                case "get_status":        return inv("get_status");
                case "get_launch_flags":  return inv("get_launch_flags");
                case "engine_status":     return inv("engine_status");

                case "ListProjectsWorkflow":
                case "projects":
                    return inv("engine_ipc", { msgType: "projects", payload });

                case "LoadProjectHistoryWorkflow":
                case "history":
                    return inv("engine_ipc", { msgType: "history", payload });

                case "ListProfilesWorkflow":
                case "profiles":
                    return inv("engine_ipc", { msgType: "profiles", payload });

                case "SendMessageWorkflow":
                case "engine_chat":
                    return inv("engine_ipc", { msgType: "chat", payload });

                case "MultiModelSendWorkflow":
                case "engine_multi_chat":
                    return inv("engine_ipc", { msgType: "multi_model_send", payload });

                case "SendMessageStreamWorkflow":
                case "engine_chat_stream":
                    return inv("engine_ipc", { msgType: "chat", payload: { ...payload, stream: true } });

                case "UploadWorkflow":
                case "engine_upload":
                case "upload":
                    return inv("engine_ipc", { msgType: "upload", payload });

                case "IngestWorkflow":
                case "engine_ingest":
                case "ingest":
                    return inv("engine_ipc", { msgType: "ingest", payload });

                case "ImageGenWorkflow":
                case "engine_image_gen":
                    return inv("engine_ipc", { msgType: "image_gen", payload });

                case "DeepSearchWorkflow":
                case "engine_deep_search":
                    return inv("engine_ipc", { msgType: "deep_search", payload });

                case "qmd_search":
                case "engine_qmd_search":
                    return inv("engine_ipc", { msgType: "qmd_search", payload });

                case "qmd_index":
                case "engine_qmd_index":
                    return inv("engine_ipc", { msgType: "qmd_index", payload });

                case "get_settings":
                case "settings_get":
                    return inv("settings_get");

                case "update_settings":
                case "settings_set":
                    return inv("settings_set", { key: payload?.key || "", value: payload?.value ?? payload });

                case "settings_test_key":
                    return inv("settings_test_key", { provider: payload?.provider || "", key: payload?.key || "" });

                case "get_policy":
                    return inv("settings_get"); 

                case "update_policy":
                    return inv("settings_set", { key: "policy", value: payload });

                case "get_model_inventory":
                case "save_model_inventory":
                    return null;

                case "vfs_add":
                case "VfsAddWorkflow":
                    return inv("engine_ipc", { msgType: "vfs_add", payload });

                case "vfs_list":
                case "VfsListWorkflow":
                    return inv("engine_ipc", { msgType: "vfs_list", payload });
                
                case "vfs_manifest":
                case "VfsManifestWorkflow":
                    return inv("engine_ipc", { msgType: "vfs_manifest", payload });

                case "vfs_remove":
                case "VfsRemoveWorkflow":
                    return inv("engine_ipc", { msgType: "vfs_remove", payload });

                case "vfs_permissions":
                case "VfsUpdatePermissionsWorkflow":
                    return inv("engine_ipc", { msgType: "vfs_permissions", payload });

                case "auto_optimize":
                case "AutoOptimizeModelsWorkflow":
                    return inv("engine_ipc", { msgType: "auto_optimize", payload });

                case "google_drive":
                case "GoogleDriveWorkflow":
                    return inv("engine_ipc", { msgType: "google_drive", payload });

                case "get_project_dir":
                    return inv("get_project_dir", { project: payload?.project || "" });
                case "fs_read_file":
                    return inv("fs_read_file", { path: payload?.path || "" });
                case "fs_write_file":
                    return inv("fs_write_file", { path: payload?.path || "", content: payload?.content || "" });
                case "fs_list_dir":
                    return inv("fs_list_dir", { path: payload?.path || "" });

                default:
                    console.warn(`[BackendConnector.ui] Routing unknown workflow "${workflow}" through engine_ipc`);
                    return inv("engine_ipc", { msgType: workflow, payload });
            }
        }

        async runWorkflow(name, payload = {}) {
            console.log(`[BackendConnector] Running workflow: ${name}`, payload);
            if (!this.TAURI_AVAILABLE) throw new Error("Tauri IPC not available");
            try {
                const result = await this.invokeTauri(name, payload);
                console.log(`[BackendConnector] Workflow ${name} result:`, result);
                if (this.status !== "tauri") this.setBackendStatus("tauri");
                return result;
            } catch (err) {
                console.error(`[BackendConnector] Workflow "${name}" failed:`, err);
                
                // Auto-recovery: If the bridge is down, try to restart it once.
                if (err && String(err).includes("Engine bridge not initialized") && !payload?._isRetry) {
                    console.warn(`[BackendConnector] Bridge down. Attempting auto-reconnect for "${name}"...`);
                    try {
                        await this.invokeTauri("engine_reconnect");
                        // Small delay to let the sidecar boot
                        await new Promise(r => setTimeout(r, 1500));
                        return await this.runWorkflow(name, { ...payload, _isRetry: true });
                    } catch (reconnectErr) {
                        console.error("[BackendConnector] Auto-reconnect failed:", reconnectErr);
                    }
                }

                const status = await this.getBackendStatus();
                if (status === "crashed") this.setBackendStatus("crashed");
                throw err;
            }
        }
    }

    // Initialize immediately but delay DOM operations
    window.BackendConnector = BackendConnector;
    window.backendConnector = new BackendConnector();
    window.backend = window.backendConnector; 
})();
