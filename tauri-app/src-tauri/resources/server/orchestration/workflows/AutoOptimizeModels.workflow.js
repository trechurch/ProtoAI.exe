// Last modified: 2026-05-04
"use strict";

const WorkflowBase   = require("../WorkflowBase");
const WorkflowResult = require("../WorkflowResult");
const https          = require("https");
const paths          = require("../../access/env/paths");
const fs             = require("fs");
const path           = require("path");

class AutoOptimizeModelsWorkflow extends WorkflowBase {

    static MANIFEST = {
        id:           "AutoOptimizeModelsWorkflow",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.1.0",
        capabilities: [],
        dependencies: [],
        docs: { description: "Polls OpenRouter, selects best free models by role, updates settings and profiles.", author: "ProtoAI team" },
        actions: { commands: {}, triggers: {}, emits: {}, workflows: {} },
    };

    constructor() { super(); }

    async run(payload) {
        try {
            const { apiKey } = payload;
            if (!apiKey) return WorkflowResult.error("OpenRouter API key is required.");

            // 1. Fetch current model list
            const modelsData = await this._fetchModels(apiKey);
            if (!modelsData?.data) return WorkflowResult.error("Failed to fetch models from OpenRouter.");

            const allModels = modelsData.data;

            // Free models only (prompt + completion both "0")
            const freeModels = allModels.filter(m => {
                const p = m.pricing;
                return p && p.prompt === "0" && p.completion === "0";
            });

            if (freeModels.length === 0) return WorkflowResult.error("No free models found on OpenRouter.");

            // 2. Pick best-in-class per role
            const optimized = {
                coding:   this._findBest(freeModels, ["qwen3-coder", "qwen2.5-coder", "deepseek-coder", "coder", "llama-3-coder"]),
                research: this._findBest(freeModels, ["gemini-flash", "gemini", "thinking", "reasoning", "phi-4", "mistral-small"]),
                image:    this._findBest(freeModels, ["vision", "pixtral", "gemini-flash"], "text+image"),
                default:  this._findBest(freeModels, ["gemini-flash", "deepseek-chat", "llama-3.3-70b", "mistral-7b"]),
            };

            // 3. Build a ranked failover pool of all free models (top 20 by context + score)
            const rankedPool = this._rankAll(freeModels).slice(0, 20).map(m => m.id);

            // 4. Persist to settings.json
            this._updateSettings(optimized, rankedPool);

            // 5. Update profiles.json so the CLI uses them immediately
            this._updateProfiles(optimized, rankedPool);

            return WorkflowResult.ok({
                message: "Model selection optimised for free tier.",
                selection: optimized,
                failoverPool: rankedPool.slice(0, 5),
            });

        } catch (err) {
            return WorkflowResult.error(err.message || String(err));
        }
    }

    // ── Fetch ────────────────────────────────────────────────────────────────

    _fetchModels(apiKey) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: "openrouter.ai",
                port: 443,
                path: "/api/v1/models",
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "HTTP-Referer": "https://protoai.app",
                    "X-Title": "ProtoAI"
                }
            };
            const req = https.request(options, res => {
                let data = "";
                res.on("data", chunk => data += chunk);
                res.on("end", () => {
                    try { resolve(JSON.parse(data)); }
                    catch (e) { reject(new Error("Failed to parse OpenRouter response")); }
                });
            });
            req.on("error", e => reject(e));
            req.end();
        });
    }

    // ── Selection helpers ────────────────────────────────────────────────────

    _scoreModel(m, keywords, modality = "text") {
        if (modality === "text+image") {
            const hasImage = m.architecture?.modality?.includes("image") ||
                m.id.includes("vision") || m.name.toLowerCase().includes("vision");
            if (!hasImage) return -1;
        }
        let score = 0;
        const id   = m.id.toLowerCase();
        const name = m.name.toLowerCase();
        keywords.forEach((kw, idx) => {
            if (id.includes(kw) || name.includes(kw)) score += (keywords.length - idx) * 10;
        });
        if (m.context_length) score += Math.log10(m.context_length);
        return score;
    }

    _findBest(models, keywords, modality = "text") {
        let best = null, bestScore = -Infinity;
        for (const m of models) {
            const score = this._scoreModel(m, keywords, modality);
            if (score > bestScore) { bestScore = score; best = m; }
        }
        if (!best && modality === "text+image") best = models[0]; // fallback
        return best ? best.id : models[0].id;
    }

    _rankAll(models) {
        const generalKw = ["gemini-flash", "deepseek", "qwen", "llama", "mistral", "phi"];
        return models
            .map(m => ({ id: m.id, score: this._scoreModel(m, generalKw) }))
            .sort((a, b) => b.score - a.score);
    }

    // ── Persistence ──────────────────────────────────────────────────────────

    _updateSettings(optimized, failoverPool) {
        const settingsPath = paths.data("settings.json");
        if (!fs.existsSync(settingsPath)) return;
        try {
            const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
            if (!settings.models)          settings.models          = {};
            if (!settings.models.defaults) settings.models.defaults = {};

            settings.models.defaults.coding   = optimized.coding;
            settings.models.defaults.research = optimized.research;
            settings.models.defaults.vision   = optimized.image;
            settings.models.defaults.default  = optimized.default;

            // Populate the global failover pool (used by CLI as last-resort chain)
            settings.models.failoverList = failoverPool;

            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
        } catch (err) {
            console.error("[AutoOptimize] Failed to update settings:", err.message);
        }
    }

    _updateProfiles(optimized, failoverPool) {
        // Find profiles.json — it lives beside claude-select.cjs (cli/) or in data/
        const candidates = [
            paths.profiles ? paths.profiles() : null,
        ].filter(Boolean);

        for (const profilesPath of candidates) {
            if (!fs.existsSync(profilesPath)) continue;
            try {
                const profiles = JSON.parse(fs.readFileSync(profilesPath, "utf8"));
                // Update every profile's primary model to the role-matched optimised choice,
                // and rebuild its fallback list from the broader ranked pool.
                const roleMap = {
                    coding:   optimized.coding,
                    research: optimized.research,
                };

                for (const [name, prof] of Object.entries(profiles)) {
                    const newPrimary = roleMap[name] || optimized.default;
                    profiles[name] = {
                        ...prof,
                        model:    newPrimary,
                        fallback: failoverPool.filter(id => id !== newPrimary).slice(0, 8),
                    };
                }

                fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2), "utf8");
                console.error("[AutoOptimize] Updated profiles.json with optimised models.");
            } catch (err) {
                console.error("[AutoOptimize] Failed to update profiles:", err.message);
            }
        }
    }
}

module.exports = AutoOptimizeModelsWorkflow;
