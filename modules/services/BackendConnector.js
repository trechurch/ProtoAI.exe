// ============================================================
// BackendConnector — SDOA v3.1 Service
// ============================================================

const { Service } = require('../base/sdoa-base.js');

class BackendConnector extends Service {

    // ------------------------------------------------------------
    // SDOA v3.1 MANIFEST (embedded, authoritative)
    // ------------------------------------------------------------
    static MANIFEST = {
        id: "BackendConnector",
        type: "service",
        runtime: "JavaScript",
        version: "3.1.0",

        // v1.2 compatibility fields
        capabilities: [
            "runWorkflow",
            "backend-status",
            "tauri-ipc",
            "transport.reconnect"
        ],
        dependencies: [],

        // --------------------------------------------------------
        // v3.1 ACTION SURFACE
        // --------------------------------------------------------
        actions: {
            commands: {
                runWorkflow: {
                    description: "Execute a backend workflow via Tauri IPC.",
                    input: { workflow: "string", payload: "object?" },
                    output: "Promise<any>"
                },
                reconnect: {
                    description: "Attempt to reconnect the Tauri sidecar.",
                    input: {},
                    output: "boolean"
                },
                getBackendStatus: {
                    description: "Query backend engine status directly from Tauri.",
                    input: {},
                    output: "string"
                }
            },

            triggers: {
                backendCrashed: {
                    description: "Fires when the Tauri sidecar reports a crash."
                },
                backendRecovered: {
                    description: "Fires when the backend returns to ready state."
                }
            },

            emits: {
                statusChanged: {
                    description: "Emits backend status updates to UI surfaces.",
                    payload: { mode: "string", detail: "string?" }
                },
                workflowFailed: {
                    description: "Emits when a workflow fails due to transport or IPC error.",
                    payload: { workflow: "string", error: "string" }
                }
            },

            workflows: {
                runWorkflow: {
                    description: "Primary workflow execution entrypoint.",
                    input: { name: "string", payload: "object?" },
                    output: "Promise<any>"
                },
                getBackendStatus: {
                    description: "Workflow wrapper for engine_status.",
                    input: {},
                    output: "string"
                }
            }
        },

        // --------------------------------------------------------
        // v1.2 Docs (kept for backward compatibility)
        // --------------------------------------------------------
        docs: {
            description: "Handles all Tauri IPC communication, workflow routing, backend status, and reconnection logic.",
            input: { workflow: "string", payload: "object?" },
            output: "Promise<any>",
            author: "ProtoAI team",
            sdoa_compatibility: `
                SDOA Compatibility Contract:
                - v1.2 Manifest is minimum requirement (Name/Type/Version/Description/Capabilities/Dependencies/Docs).
                - v2.0 may also read sidecars, hot‑reload, version‑CLI.
                - v3.0+ may add actions.commands, actions.triggers, actions.emits, actions.workflows.
                - Lower versions MUST ignore unknown/unexpressed fields.
                - Higher versions MUST NOT change meaning of older fields.
                - All versions are backward and forward compatible.
            `
        }
    };

    // ------------------------------------------------------------
    // Constructor
    // ------------------------------------------------------------
    constructor() {
        super();
        this.TAURI_AVAILABLE = !!(window.__TAURI__?.core?.invoke);

        this.ENGINES = [
            "anthropic/claude-3.5-sonnet",
            "anthropic/claude-opus-4.1",
            "openai/gpt-4o-mini",
            "qwen/qwen-2-7b-instruct:free",
            "qwen/qwen3.6-plus:free"
        ];

        console.log(`[ProtoAI] Backend: ${this.TAURI_AVAILABLE ? "Tauri IPC" : "unavailable"}`);
    }

    // ------------------------------------------------------------
    // Backend Status UI Sync
    // ------------------------------------------------------------
    setBackendStatus(mode, detail = "") {
        const labels = {
            tauri: "Backend: Tauri IPC (sidecar active)",
            http: "Backend: initializing…",
            crashed: "Sidecar crashed (3/3). Use Reconnect.",
            unavailable: "Backend: sidecar initializing…",
            offline: "Backend: offline"
        };

        const text = labels[mode] ?? mode;

        const badge = document.getElementById("currentProfileName");
        if (badge) badge.title = detail ? `${text}\n${detail}` : text;

        const dot = document.getElementById("statusDot");
        const label = document.getElementById("sidebarStatusText");

        if (dot) dot.className = `status-dot ${mode}`;
        if (label) {
            const baseText = {
                tauri: "Tauri IPC",
                http: "Starting…",
                crashed: "Crashed",
                unavailable: "Starting…",
                offline: "Offline"
            }[mode] ?? mode;

            label.textContent = detail ? `${baseText} (${detail})` : baseText;
        }

        // v3.1 emit
        this.emit("statusChanged", { mode, detail });
    }

    // ------------------------------------------------------------
    // Reconnect Button (UI)
    // ------------------------------------------------------------
    showReconnectButton() {
        if (!this.TAURI_AVAILABLE) return;
        if (chatContainer?.querySelector(".reconnect-btn")) return;

        const btn = document.createElement("button");
        btn.textContent = "Reconnect Sidecar";
        btn.className = "secondary reconnect-btn";
        btn.style.cssText = "margin: 8px 0; display: block;";

        btn.onclick = async () => {
            btn.disabled = true;
            btn.textContent = "Reconnecting…";

            try {
                await window.__TAURI__.core.invoke("engine_reconnect");
                this.setBackendStatus("tauri");
                btn.remove();
                this.emit("backendRecovered", {});
            } catch (err) {
                btn.textContent = "Reconnect failed — try again";
                btn.disabled = false;
                showError(`Reconnect failed: ${err}`);
            }
        };

        chatContainer?.appendChild(btn);
    }

    // ------------------------------------------------------------
    // Direct backend status query (v3.1)
    // ------------------------------------------------------------
    async getBackendStatus() {
        if (!this.TAURI_AVAILABLE) return "offline";

        try {
            return await window.__TAURI__.core.invoke("engine_status");
        } catch (err) {
            return "offline";
        }
    }

    // ------------------------------------------------------------
    // Tauri IPC Workflow Routing
    // ------------------------------------------------------------
    async invokeTauri(workflow, payload) {
        const inv = window.__TAURI__.core.invoke;

        switch (workflow) {
            case "ListProjectsWorkflow":
                return inv("engine_projects");

            case "ListProfilesWorkflow":
                return inv("engine_profiles");

            case "LoadProjectHistoryWorkflow":
                return inv("engine_history", { project: payload.project });

            case "SendMessageWorkflow":
                return inv("engine_chat", {
                    project: payload.project,
                    profile: payload.profile || "",
                    engine: payload.engine || "",
                    message: payload.message
                });

            case "UploadWorkflow":
                return inv("engine_upload", {
                    project: payload.project,
                    filename: payload.filename,
                    content: payload.content || ""
                });

            case "IngestWorkflow":
                return inv("engine_ingest", { project: payload.project });

            case "ImageGenWorkflow":
                return inv("engine_image_gen", {
                    text: payload.text,
                    project: payload.project || ""
                });

            case "DeepSearchWorkflow":
                return inv("engine_deep_search", { query: payload.query });

            default:
                return inv("run_workflow", {
                    name: workflow,
                    payload: JSON.stringify(payload)
                }).then(raw => JSON.parse(raw));
        }
    }

    // ------------------------------------------------------------
    // Public Workflow API (v3.1 command surface)
    // ------------------------------------------------------------
    async runWorkflow(name, payload = {}) {
        if (!this.TAURI_AVAILABLE) {
            this.setBackendStatus("offline");
            this.emit("workflowFailed", { workflow: name, error: "Tauri IPC not available" });
            throw new Error("Tauri IPC not available");
        }

        try {
            const result = await this.invokeTauri(name, payload);
            this.setBackendStatus("tauri");
            return result;

        } catch (err) {
            const msg = String(err).toLowerCase();
            const isTransportError =
                msg.includes("crash") ||
                msg.includes("not ready") ||
                msg.includes("sidecar") ||
                msg.includes("timed out") ||
                msg.includes("write to sidecar") ||
                msg.includes("failed to fetch");

            // v3.1 emit
            this.emit("workflowFailed", { workflow: name, error: err.message });

            if (isTransportError) {
                console.warn(`[Workflow] Tauri transport failed: ${err.message}`);

                try {
                    const status = await window.__TAURI__.core.invoke("engine_status");
                    if (status === "crashed") {
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

module.exports = BackendConnector;
