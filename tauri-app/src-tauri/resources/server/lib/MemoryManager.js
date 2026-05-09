// ============================================================
// MemoryManager.js — SDOA v4.0 Service (NodeJS)
// version: 2.1.0
// Last modified: 2026-05-06 06:40 UTC
// depends: fs-extra, LocalModelAdapter, paths, crypto
// ============================================================

const fs = require("fs-extra");
const path = require("path");
const crypto = require("crypto");
const paths = require("../access/env/paths");
let local = null; // Lazy-loaded
const Middleware = require("../services/Middleware.service");

// Fallback for randomUUID if on older Node.js
const uuid = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    return crypto.randomBytes(16).toString("hex");
};

class MemoryManager {
    static MANIFEST = {
        id: "MemoryManager",
        type: "service",
        runtime: "NodeJS",
        version: "2.1.0",
        capabilities: [
            "memory.load",
            "memory.record",
            "memory.distill",
            "memory.audit"
        ],
        docs: {
            description: "Deterministic memory distillation and cognitive hierarchy management (Identity, Knowledge, Wisdom).",
            author: "ProtoAI team",
        }
    };

    constructor() {
        this.STABILITY_THRESHOLD = 3;
        this.PROJECT_LIMIT = 50;
        this.WORKFLOW_LIMIT = 20;
    }

    // ── Storage Access ────────────────────────────────────────

    loadIdentity() {
        const raw = this._safeRead(paths.identityMemory(), {
            id: uuid(),
            type: "identity",
            source: "user",
            content: { name: "User", preferences: [], background: "", constraints: [], tags: [] }
        });

        // Robustness: ensure we return a structure that has .content if possible, 
        // or map flat structure to nested if that's what we found.
        if (!raw.content && raw.name) {
            return {
                ...raw,
                content: {
                    name: raw.name || "User",
                    preferences: Array.isArray(raw.preferences) ? raw.preferences : [],
                    background: raw.background || "",
                    constraints: raw.constraints || [],
                    tags: raw.traits || raw.tags || []
                }
            };
        }
        return raw;
    }

    loadProjectMemory(project) {
        return this._safeRead(paths.projectMemory(project), {
            id: uuid(),
            type: "project",
            source: "system",
            content: { summary: "", verbatim: [], constraints: [], tags: [] }
        });
    }

    loadWisdom() {
        return this._safeRead(paths.wisdomMemory(), []);
    }

    /**
     * Compatibility helper for Orchestrator
     */
    loadUserProfile() {
        const identity = this.loadIdentity();
        const c = identity.content || {};
        return {
            ...c,
            traits: c.tags || c.traits || []
        };
    }

    // ── Operational Methods ───────────────────────────────────

    async record(type, content, project = null) {
        Middleware.log(`[MemoryManager] Recording ${type} memory...`);
        
        if (type === "project" && project) {
            const mem = this.loadProjectMemory(project);
            mem.content.verbatim.push(content);
            mem.updated_at = new Date().toISOString();
            this._safeWrite(paths.projectMemory(project), mem);
            
            if (mem.content.verbatim.length >= this.PROJECT_LIMIT) {
                await this.distill("project", project);
            }
        } else if (type === "identity" || type === "user_observation") {
            const mem = this.loadIdentity();
            const targetField = type === "user_observation" ? "preferences" : "preferences"; // For now, both go to preferences
            mem.content[targetField].push(content);
            mem.updated_at = new Date().toISOString();
            this._safeWrite(paths.identityMemory(), mem);
        }
    }

    /**
     * 9-Stage Distillation Pipeline
     */
    async distill(type, target = null) {
        Middleware.log(`[MemoryManager] Starting 9-stage distillation for ${type}:${target || "global"}...`);

        // 1. COLLECT
        let rawData = null;
        let targetPath = null;
        if (type === "project") {
            rawData = this.loadProjectMemory(target);
            targetPath = paths.projectMemory(target);
        } else if (type === "identity") {
            rawData = this.loadIdentity();
            targetPath = paths.identityMemory();
        }

        if (!rawData || (rawData.content.verbatim || []).length === 0) {
            return { ok: false, error: "No memory items to distill" };
        }

        // 2-6. LLM PROCESSING (Normalize, Cluster, Merge, Preserve, Compress)
        const distilledContent = await this._runLlmDistillation(rawData);
        if (!distilledContent) return { ok: false, error: "LLM distillation failed" };

        // 7. VALIDATE
        if (!distilledContent.summary || !distilledContent.verbatim) {
            return { ok: false, error: "Invalid distillation output schema" };
        }

        // 8. WRITE (with version backup)
        const finalMemory = {
            ...rawData,
            source: "distilled",
            updated_at: new Date().toISOString(),
            content: {
                ...distilledContent,
                tags: [...new Set([...(rawData.content.tags || []), ...(distilledContent.tags || [])])]
            }
        };

        this._createBackup(targetPath);
        this._safeWrite(targetPath, finalMemory);

        // 9. NOTIFY (Handled via return for UI to display diff)
        return { ok: true, type, target, before: rawData, after: finalMemory };
    }

    // ── Internal Helpers ──────────────────────────────────────

    async _runLlmDistillation(memory) {
        if (!local || typeof local.generate !== 'function') {
            local = require("../access/llm/LocalModelAdapter");
        }
        const modelPath = await this._getLocalModelPath();
        if (!modelPath) return null;

        const system = `You are the ProtoAI Memory Distillation Engine. 
RULES:
1. Merge duplicates and collapse related items.
2. PRESERVE VERBATIM user intent in the 'verbatim' array.
3. ZERO INFERENCE: Do not invent facts or read between lines.
4. Output strict JSON only.

SCHEMA:
{
  "summary": "one-line dense summary",
  "verbatim": ["original user statements"],
  "constraints": ["hard rules identified"],
  "tags": ["keywords"]
}`;

        const prompt = `DISTILL THESE MEMORIES:
${JSON.stringify(memory.content.verbatim || memory.content.preferences, null, 2)}

Existing constraints: ${JSON.stringify(memory.content.constraints || [])}
Existing tags: ${JSON.stringify(memory.content.tags || [])}

JSON OUTPUT:`;

        try {
            const raw = await local.generate(prompt, {
                modelPath,
                maxTokens: 500,
                temperature: 0.1,
                systemPrompt: system
            });

            const m = raw.match(/\{[\s\S]*?\}/);
            return m ? JSON.parse(m[0]) : null;
        } catch (e) {
            console.error("[MemoryManager] LLM Error:", e.message);
            return null;
        }
    }

    _safeRead(filePath, fallback) {
        if (!fs.existsSync(filePath)) return fallback;
        try {
            return fs.readJsonSync(filePath);
        } catch (_) {
            return fallback;
        }
    }

    _safeWrite(filePath, data) {
        fs.ensureDirSync(path.dirname(filePath));
        fs.writeJsonSync(filePath, data, { spaces: 2 });
    }

    _createBackup(filePath) {
        if (!fs.existsSync(filePath)) return;
        const backupPath = `${filePath}.${Date.now()}.bak`;
        fs.copySync(filePath, backupPath);
    }

    async _getLocalModelPath() {
        try {
            const file = paths.resolve("config", "models.json");
            if (!fs.existsSync(file)) return null;
            const models = fs.readJsonSync(file);
            const entry = (models.entries || []).find(m => m.provider === "local");
            if (!entry) return null;
            const modelPath = entry.model_path;
            if (path.isAbsolute(modelPath)) return modelPath;
            return path.join(paths.root, modelPath.replace(/^\.\//, ""));
        } catch (_) {
            return null;
        }
    }
}

module.exports = new MemoryManager();
