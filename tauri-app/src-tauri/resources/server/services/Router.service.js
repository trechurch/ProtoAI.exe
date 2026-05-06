// Last modified: 2026-05-04 03:11 UTC
"use strict";

const ResponseFormatter = require("./ResponseFormatter.service");
const Middleware = require("./Middleware.service");

class Router {
    constructor(registry, dependencies) {
        this.registry = registry;
        this.deps = dependencies; // { projectRepo, profileRepo, settingsManager, paths, fs, path, triggerIngest }

        this._buffer = "";
        this._processing = false;
        this._queue = [];

        // Express lane: Fast read-only message types that never block
        this._EXPRESS_TYPES = new Set([
            "projects", "history", "profiles", "settings",
            "list_files", "search_history", "list_processes",
            "vfs_list", "vfs_manifest", "vfs_permissions",
            "qmd_search", "qmd_index",
        ]);
    }

    startListening() {
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", chunk => {
            this._buffer += chunk;
            let index;
            while ((index = this._buffer.indexOf("\n")) >= 0) {
                const line = this._buffer.slice(0, index).trim();
                this._buffer = this._buffer.slice(index + 1);
                if (!line) continue;

                const parsed = ResponseFormatter.safeJsonParse(line);
                if (!parsed.ok) {
                    Middleware.log("❌ Failed to parse IPC line:", line.slice(0, 200));
                    continue;
                }
                const msg = parsed.value;

                if (this._EXPRESS_TYPES.has(msg?.type)) {
                    this._dispatchExpress(msg);
                } else {
                    this._queue.push(msg);
                }
            }
            this._drainQueue();
        });

        process.stdin.on("end", () => {
            Middleware.log("📥 stdin closed — sidecar staying alive for 30s to finish tasks...");
            // Instead of immediate exit, we wait a bit to see if this was transient
            // or if we have pending async work (like LLM streaming).
            setTimeout(() => {
                if (this._queue.length === 0 && !this._processing) {
                    Middleware.log("📥 Shutting down due to closed stdin.");
                    process.exit(0);
                } else {
                    Middleware.log("📥 Stdin closed but processing continues.");
                }
            }, 30000);
        });
    }

    async _dispatchExpress(msg) {
        try {
            const response = await this.dispatchMessage(msg);
            ResponseFormatter.writeResponse(response);
        } catch (err) {
            Middleware.log("❌ IPC express error:", err.message);
            if (msg?.id) ResponseFormatter.writeError(msg.id, "IPC dispatch error", String(err));
        }
    }

    _drainQueue() {
        if (this._processing || this._queue.length === 0) return;
        this._processNext();
    }

    async _processNext() {
        if (this._queue.length === 0) { this._processing = false; return; }
        this._processing = true;

        const msg = this._queue.shift();
        try {
            const response = await this.dispatchMessage(msg);
            ResponseFormatter.writeResponse(response);
        } catch (err) {
            Middleware.log("❌ IPC dispatch error:", err.message);
            if (msg?.id) ResponseFormatter.writeError(msg.id, "IPC dispatch error", String(err));
        }

        setImmediate(() => this._processNext());
    }

    async dispatchMessage(msg) {
        const { id, type, payload } = msg;

        if (!id) {
            Middleware.log("❌ IPC message missing 'id' — cannot respond");
            return null;
        }
        if (!type) {
            return { id, ok: false, error: "Missing 'type' in IPC message" };
        }

        Middleware.log(`[dispatch] → ${type} (id=${id.slice(0,8)}…)`);
        let result;

        try {
            switch (type) {
                // ── Legacy inline handlers ─────────────────────────────────
                case "projects":
                    result = { projects: this.deps.projectRepo.listProjects() || [] };
                    break;
                case "history":
                    if (!payload?.project) return { ok: false, error: "Missing 'project'" };
                    result = { history: this.deps.projectRepo.getHistory(payload.project) || [] };
                    break;
                case "profiles":
                    result = { profiles: this.deps.profileRepo.listAllForUI() || {} };
                    break;
                case "upload":
                    result = this._handleUploadIPC(payload);
                    break;
                case "ingest":
                    result = this._handleIngestIPC(payload);
                    break;
                case "settings":
                    result = await this._handleSettingsIPC(payload);
                    break;
                case "chat":
                    result = await this._handleChatIPC(payload, id);
                    break;
                case "multi_model_send":
                    result = await this._handleMultiModelSendIPC(payload, id);
                    break;

                // ── Workflow Delegations ──────────────────────────────────
                case "image_gen":
                    if (!payload?.text) return { ok: false, error: "Missing 'text'" };
                    result = await this._runWorkflow("ImageGen.workflow", { text: payload.text, project: payload.project });
                    break;
                case "deep_search":
                    if (!payload?.query) return { ok: false, error: "Missing 'query'" };
                    result = await this._runWorkflow("DeepSearch.workflow", { query: payload.query });
                    break;
                case "qmd_index":
                    result = await this._runQmdIndexIPC(payload);
                    break;
                case "qmd_search":
                    result = await this._runQmdSearchIPC(payload);
                    break;
                case "vfs_add":
                    result = await this._runWorkflow("VfsAdd.workflow", payload, true);
                    break;
                case "vfs_list":
                    result = await this._runWorkflow("VfsList.workflow", payload, true);
                    break;
                case "vfs_manifest":
                    if (!payload?.project) return { ok: false, error: "Missing 'project'" };
                    result = await this._runWorkflow("VfsManifest.workflow", { project: payload.project, id: payload.id || payload.entryId, realPath: payload.realPath, regenerate: payload.regenerate }, true);
                    break;
                case "vfs_permissions":
                    if (!payload?.project || !payload?.id) return { ok: false, error: "Missing 'project' or 'id'" };
                    result = await this._runWorkflow("VfsUpdatePermissions.workflow", { project: payload.project, id: payload.id, permissions: payload.permissions }, true);
                    break;
                case "vfs_remove":
                    result = await this._handleVfsRemoveIPC(payload);
                    break;
                case "list_files":
                    result = await this._runWorkflow("ListFiles.workflow", { project: payload?.project, path: payload?.path, realPath: payload?.realPath }, true);
                    break;
                case "search_history":
                    if (!payload?.query) return { ok: false, error: "Missing 'query'" };
                    result = await this._runWorkflow("SearchHistory.workflow", payload, true);
                    break;
                case "list_processes":
                    result = await this._runWorkflow("ListProcesses.workflow", payload, true);
                    break;
                case "spawn_shell":
                    result = await this._runWorkflow("SpawnShell.workflow", { shell: payload?.shell || "powershell" }, true);
                    break;
                case "auto_optimize":
                    result = await this._handleAutoOptimizeIPC(payload);
                    break;
                case "google_drive":
                    result = await this._handleGoogleDriveIPC(payload);
                    break;
                default:
                    // SDOA v4 dynamic workflow routing
                    // If the frontend requests runWorkflow("get_model_inventory"), check if we have a workflow named "GetModelInventory.workflow"
                    const camelCaseType = type.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('');
                    const possibleWfId = `${camelCaseType}.workflow`;
                    
                    if (this.registry.has(possibleWfId)) {
                        result = await this._runWorkflow(possibleWfId, payload, true);
                    } else if (this.registry.has(type)) {
                        result = await this._runWorkflow(type, payload, true);
                    } else {
                        return { id, ok: false, error: `Unknown message type or workflow: ${type}` };
                    }
                    break;
            }
        } catch (err) {
            Middleware.log(`❌ Unhandled error in handler for type "${type}":`, err.message);
            return { id, ok: false, error: "Handler crashed", detail: String(err) };
        }

        if (result && result.ok === false) return { id, ...result };
        return { id, ok: true, data: result };
    }

    // ── Helper ───────────────────────────────────────────────────────────────
    
    async _runWorkflow(workflowId, args, unwrap = false) {
        const wf = this.registry.get(workflowId);
        if (!wf) return { ok: false, error: `${workflowId} not available` };
        const r = await wf.run(args);
        if (unwrap) {
            return r.status === 'ok' ? r.data : { ok: false, error: r.error };
        }
        return r;
    }

    // ── Legacy Handlers ──────────────────────────────────────────────────────
    
    _handleUploadIPC(payload) {
        const { project, filename, content, encoding } = payload || {};
        if (!project) return { ok: false, error: "Missing 'project'" };
        if (!filename) return { ok: false, error: "Missing 'filename'" };
        try {
            const projectDir = this.deps.paths.projectDir(project);
            const fullPath = this.deps.path.join(projectDir, filename);
            const parentDir = this.deps.path.dirname(fullPath);

            this.deps.fs.mkdirSync(parentDir, { recursive: true });
            
            if (encoding === "base64") {
                this.deps.fs.writeFileSync(fullPath, Buffer.from(content, "base64"));
            } else {
                this.deps.fs.writeFileSync(fullPath, content || "", "utf8");
            }
            
            if (this.deps.triggerIngest) this.deps.triggerIngest(project);
            return { status: "ok" };
        } catch (err) {
            return { ok: false, error: "Upload failed", detail: err.message };
        }
    }

    _handleIngestIPC(payload) {
        const { project, withContents } = payload || {};
        if (!project) return { ok: false, error: "Missing 'project'" };

        const projectDir = this.deps.paths.projectDir(project);
        if (!this.deps.fs.existsSync(projectDir)) return { files: [] };

        try {
            const files = this.deps.fs.readdirSync(projectDir).filter(f =>
                this.deps.fs.statSync(this.deps.path.join(projectDir, f)).isFile()
            );

            if (!withContents) return { files: files.map(f => ({ filename: f })) };

            const fileContents = [];
            const MAX_BYTES = 524288;
            let totalBytes = 0;

            for (const f of files) {
                if (totalBytes >= MAX_BYTES) {
                    fileContents.push({ filename: f, truncated: true, error: "Size limit reached" });
                    continue;
                }
                try {
                    const content = this.deps.fs.readFileSync(this.deps.path.join(projectDir, f), "utf8");
                    fileContents.push({ filename: f, content });
                    totalBytes += content.length;
                } catch (err) {
                    Middleware.log(`⚠ Could not read "${f}":`, err.message);
                    fileContents.push({ filename: f, error: err.message });
                }
            }

            return { files: fileContents, totalBytes, fileCount: files.length };
        } catch (err) {
            return { ok: false, error: "Ingest failed", detail: err.message };
        }
    }

    async _handleSettingsIPC(payload) {
        const { action, key, value, provider } = payload || {};
        try {
            if (action === "get") return { settings: this.deps.settingsManager.exportAll() };
            if (action === "set") {
                if (key && value !== undefined) this.deps.settingsManager.set(key, value);
                else if (value !== undefined) this.deps.settingsManager.importAll(value);
                return { settings: this.deps.settingsManager.exportAll() };
            }
            if (action === "testKey") {
                if (!provider) return { ok: false, error: "Missing 'provider'" };
                return await this.deps.settingsManager.validateApiKey(provider, value);
            }
            return { ok: false, error: `Unknown settings action: ${action}` };
        } catch (err) {
            return { ok: false, error: "Settings operation failed", detail: err.message };
        }
    }

    async _handleQmdIndexIPC(payload) {
        if (!this.registry.has("Ingest.workflow")) return { ok: false, error: "QMD not available" };
        const { project, deep_scan = false } = payload || {};
        if (!project) return { ok: false, error: "Missing 'project'" };
        return await this._runWorkflow("Ingest.workflow", { project, deep_scan });
    }

    async _handleQmdSearchIPC(payload) {
        if (!this.registry.has("Ingest.workflow")) return { ok: false, error: "QMD not available" };
        const { query, project, sql = false } = payload || {};
        if (!query) return { ok: false, error: "Missing 'query'" };
        const wf = this.registry.get("Ingest.workflow");
        return await wf.search({ query, project, sql });
    }

    async _handleVfsRemoveIPC(payload) {
        const { project, id, realPath } = payload || {};
        if (!project) return { ok: false, error: "Missing 'project'" };
        if (!id && !realPath) return { ok: false, error: "Missing 'id' or 'realPath'" };
        try {
            const FsVfsRepository = require('../access/fs/FsVfsRepository');
            const repo = new FsVfsRepository(project);
            if (id) {
                repo.removeEntry(id);
            } else {
                const entries = repo.listEntries().filter(e => e.realPath === realPath);
                entries.forEach(e => repo.removeEntry(e.id));
            }
            return { removed: true, project };
        } catch (err) {
            return { ok: false, error: 'VFS remove failed', detail: err.message };
        }
    }

    async _handleAutoOptimizeIPC(payload) {
        try {
            let finalKey = payload?.apiKey;
            if (!finalKey) {
                const settings = this.deps.settingsManager.exportAll();
                finalKey = settings.apiKeys?.openrouter;
            }
            return await this._runWorkflow("AutoOptimizeModels.workflow", { apiKey: finalKey }, true);
        } catch (err) {
            return { ok: false, error: 'Auto optimization failed', detail: err.message };
        }
    }

    async _handleGoogleDriveIPC(payload) {
        try {
            const r = await this._runWorkflow("GoogleDrive.workflow", payload, false);
            if (r.status === 'ok' && payload.action === 'download_file' && payload.params?.project) {
                if (this.deps.triggerIngest) this.deps.triggerIngest(payload.params.project);
            }
            return r.status === 'ok' ? r.data : { ok: false, error: r.error };
        } catch (err) {
            return { ok: false, error: 'Google Drive operation failed', detail: err.message };
        }
    }

    async _handleChatIPC(payload, requestId) {
        const { project, message, profile, engine, stream } = payload || {};
        if (!project || !message || !profile) return { ok: false, error: "Missing required fields" };

        let fullStreamedReply = "";
        const onChunk = stream ? (token) => {
            fullStreamedReply += token;
            ResponseFormatter.writeResponse({ id: requestId, ok: true, type: "stream", chunk: token });
        } : null;

        try {
            const workflow = this.registry.get("SendMessage.workflow");
            const result = await workflow.run({ project, message, profile, engine, onChunk });

            if (result.status === "error") return { ok: false, ...(result.data || { error: "Workflow error" }) };

            const reply = result.data?.streaming ? fullStreamedReply : result.data?.reply;

            if (stream && fullStreamedReply) {
                try {
                    this.deps.projectRepo.appendToHistory(project, { timestamp: Date.now(), role: "user", message });
                    this.deps.projectRepo.appendToHistory(project, { timestamp: Date.now(), role: "assistant", message: fullStreamedReply });
                } catch (err) { Middleware.log("⚠ History save failed:", err.message); }
            }

            return { response: reply || "" };
        } catch (err) {
            return { ok: false, error: "Chat workflow crashed", detail: String(err) };
        }
    }

    async _handleMultiModelSendIPC(payload, requestId) {
        const { project, message, profile, stream } = payload || {};
        if (!project || !message) return { ok: false, error: "Missing required fields" };

        let fullStreamedReply = "";
        const onChunk = stream ? (token) => {
            fullStreamedReply += token;
            ResponseFormatter.writeResponse({ id: requestId, ok: true, type: "stream", chunk: token });
        } : null;

        try {
            const workflow = this.registry.get("MultiModelSend.workflow");
            if (!workflow) throw new Error("MultiModelSendWorkflow not available");
            const result = await workflow.run({ project, message, profile, onChunk, stream });

            if (result.status === "error") return { ok: false, ...(result.data || { error: result.error || "Orchestrator error" }) };

            const reply = result.data?.streaming ? fullStreamedReply : result.data?.reply;

            if (fullStreamedReply || reply) {
                try {
                    this.deps.projectRepo.appendToHistory(project, { timestamp: Date.now(), role: "user", message });
                    this.deps.projectRepo.appendToHistory(project, { timestamp: Date.now(), role: "assistant", message: fullStreamedReply || reply });
                } catch (err) { Middleware.log("⚠ History save failed:", err.message); }
            }

            return { response: reply || "", orchestrator: result.data?.orchestrator };
        } catch (err) {
            return { ok: false, error: err.message };
        }
    }
}

module.exports = Router;
