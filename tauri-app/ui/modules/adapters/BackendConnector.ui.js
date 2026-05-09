/* ============================================================
   BackendConnector.ui.js — UI Adapter (Browser-Safe)
   version: 4.0.0 (SDOA v4)
   Last modified: 2026-05-09 03:59 UTC
   ============================================================ */

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    const MANIFEST = {
        id:      "BackendConnector.ui",
        type:    "adapter",
        layer:   2,
        runtime: "Browser",
        version: "4.0.0",
        requires: ["tauri-utils.js"],
        docs: {
            description: "Primary bridge between the UI and the Rust sidecar. Handles IPC routing, status polling, and auto-reconnection.",
            author: "ProtoAI Team"
        }
    };

    class BackendConnector {

        constructor() {
            this.status          = "connecting";
            this.listeners       = [];
            this.isReconnecting  = false;
            
            // Safe check for Tauri core
            this.TAURI_AVAILABLE = !!(window.__TAURI__?.core?.invoke);

            console.log(`[BackendConnector.ui] v4.0.0 | Tauri IPC: ${this.TAURI_AVAILABLE ? "CONNECTED" : "OFFLINE"}`);
            
            if (domReady) {
                domReady(() => this._init());
            } else {
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
                tauri:        "Engine Online", 
                initializing: "Waking Sidecar...",
                crashed:      "Engine Halted (Click to Reboot)", 
                unavailable:  "Bridge Offline", 
                offline:      "Offline" 
            };
            const shortLabels = { 
                tauri:        "Online", 
                initializing: "Starting...", 
                crashed:      "Halted", 
                unavailable:  "Disconnected", 
                offline:      "Offline" 
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
                if (reconnectable && !row._reconnectHandler) {
                    row._reconnectHandler = () => this.reconnect();
                    row.addEventListener("click", row._reconnectHandler);
                }
            }

            this.emit("statusChanged", { mode, detail });
        }

        async reconnect() {
            if (this.isReconnecting) return;
            this.isReconnecting = true;
            
            const label = document.getElementById("sidebarStatusText");
            const row   = document.getElementById("statusRow");
            
            if (label) label.textContent = "Rebooting Engine...";
            if (row)   row.classList.add("status-row--busy");
            
            try {
                await Promise.race([
                    window.__TAURI__.core.invoke("engine_reconnect"),
                    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout during reboot")), 15000))
                ]);
                this.setBackendStatus("tauri");
                this.emit("backendRecovered", {});
                window.ToastPrim?.show("Sidecar engine rebooted successfully.", "success");
            } catch (err) {
                this.setBackendStatus("offline", "Reboot Failed");
                console.error("[BackendConnector.ui] Reconnect failed:", err);
                window.ToastPrim?.show("Engine reboot failed: " + err.message, "error");
            } finally {
                this.isReconnecting = false;
                if (row) row.classList.remove("status-row--busy");
            }
        }

        async getBackendStatus() {
            if (!this.TAURI_AVAILABLE) return "offline";
            try { return await window.__TAURI__.core.invoke("engine_status"); }
            catch { return "offline"; }
        }

        async _initStatusPolling() {
            if (!this.TAURI_AVAILABLE) { this.setBackendStatus("offline"); return; }
            
            const poll = async () => {
                if (this.isReconnecting) return;
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
            }, 10000); // 10s polling for health
        }

        async invokeTauri(workflow, payload) {
            const inv = window.__TAURI__.core.invoke.bind(window.__TAURI__.core);

            // Standard SDOA v4 IPC Mapping
            const mapping = {
                "get_status":           "get_status",
                "get_launch_flags":     "get_launch_flags",
                "engine_status":        "engine_status",
                "projects":             "projects",
                "history":              "history",
                "profiles":             "profiles",
                "chat":                 "chat",
                "multi_model_send":     "multi_model_send",
                "upload":               "upload",
                "ingest":               "ingest",
                "image_gen":            "image_gen",
                "deep_search":          "deep_search",
                "qmd_search":           "qmd_search",
                "qmd_index":            "qmd_index",
                "settings_get":         "settings_get",
                "settings_set":         "settings_set",
                "vfs_add":              "vfs_add",
                "vfs_list":             "vfs_list",
                "vfs_manifest":         "vfs_manifest",
                "vfs_remove":           "vfs_remove",
                "vfs_permissions":      "vfs_permissions",
                "auto_optimize":        "auto_optimize",
                "google_drive":         "google_drive",
                "get_project_dir":      "get_project_dir",
                "fs_read_file":         "fs_read_file",
                "fs_write_file":        "fs_write_file",
                "fs_list_dir":          "fs_list_dir",
                "restart_engine":       "engine_reconnect"
            };

            const msgType = mapping[workflow] || workflow;

            // Workflows that map to native Tauri commands (non-sidecar)
            const nativeCommands = ["get_status", "get_launch_flags", "engine_status", "settings_get", "settings_set", "engine_reconnect", "get_project_dir", "fs_read_file", "fs_write_file", "fs_list_dir"];

            if (nativeCommands.includes(msgType)) {
                return inv(msgType, payload);
            }

            // Standard Sidecar IPC routing
            return inv("engine_ipc", { msgType, payload });
        }

        async runWorkflow(name, payload = {}) {
            console.log(`[BackendConnector] EXEC: ${name}`, payload);
            if (!this.TAURI_AVAILABLE) throw new Error("Tauri IPC bridge not available");
            
            try {
                const result = await this.invokeTauri(name, payload);
                console.log(`[BackendConnector] DONE: ${name} ->`, result);
                
                // If we got a result, the sidecar is alive
                if (this.status !== "tauri") this.setBackendStatus("tauri");
                
                return result;
            } catch (err) {
                console.error(`[BackendConnector] FAIL: "${name}" ->`, err);
                
                // Detection of Bridge collapse
                if (err && String(err).includes("Engine bridge not initialized") && !payload?._isRetry) {
                    console.warn(`[BackendConnector] Bridge collapsed. Auto-recovering for "${name}"...`);
                    try {
                        await this.reconnect();
                        return await this.runWorkflow(name, { ...payload, _isRetry: true });
                    } catch (reconnectErr) {
                        console.error("[BackendConnector] Recovery failed.");
                    }
                }

                throw err;
            }
        }
    }

    // Initialize Global
    window.backendConnector = new BackendConnector();
    window.backend = window.backendConnector; 

})();
