// ============================================================
// MultiModelOrchestrator.js — SDOA v3.0 Service (NodeJS)
// version: 1.0.0
// Last modified: 2026-05-04 03:11 UTC
// depends: LocalModelAdapter, paths, config/models.json
// ============================================================
//
// The "silent partner that rarely shuts up."
//
// Four focused pipelines, each using the local GGUF model with
// tiny, purpose-built prompts:
//
//   route()    — classify the request, pick a prime profile
//   engineer() — rewrite the prompt for optimal prime performance
//   watch()    — non-blocking monitor of the prime's streaming output
//   audit()    — post-response quality score + issue flags
//
// All methods are safe to call in parallel or independently.
// All methods degrade gracefully — if the local model is unavailable,
// the original input is returned unchanged and skipped: true is set.
//
// Events are emitted via a simple internal event bus so that
// MultiModelSendWorkflow can collect them into the orchestrator log
// and replay them in the UI ticker after the response completes.
// ============================================================

"use strict";

const fs    = require("fs");
const path  = require("path");
const paths = require("../../access/env/paths");
const local = require("../../access/llm/LocalModelAdapter");
const memory = require("../../lib/MemoryManager");

// ── helpers ───────────────────────────────────────────────

function _safeJson(text, fallback) {
    try {
        const m = (text || "").match(/\{[\s\S]*?\}/);
        if (m) return JSON.parse(m[0]);
    } catch (_) {}
    return fallback;
}

function _resolveModelPath(relOrAbs) {
    if (!relOrAbs) return null;
    if (path.isAbsolute(relOrAbs)) return relOrAbs;
    return path.join(paths.root, relOrAbs.replace(/^\.\//, ""));
}

// ── MultiModelOrchestrator ────────────────────────────────

class MultiModelOrchestrator {

    // ── SDOA v3.0 MANIFEST ───────────────────────────────────
    static MANIFEST = {
        id:           "MultiModelOrchestrator",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [
            "orchestrator.route",
            "orchestrator.engineer",
            "orchestrator.watch",
            "orchestrator.audit",
        ],
        dependencies: ["LocalModelAdapter", "paths"],
        docs: {
            description: "Multi-model orchestration pipeline. Uses the local GGUF as a silent partner to route, engineer, watch, and audit every request sent to the prime model.",
            author: "ProtoAI team",
        },
        actions: {
            commands: {
                route:    { description: "Classify request, suggest profile + complexity.", input: { message: "string" }, output: "object" },
                engineer: { description: "Rewrite prompt for optimal prime performance.",   input: { message: "string" }, output: "object" },
                watch:    { description: "Monitor streaming prime output for issues.",      input: { buffer: "string", question: "string" }, output: "object" },
                audit:    { description: "Quality-score a completed prime response.",       input: { question: "string", response: "string" }, output: "object" },
            },
            triggers: {},
            emits: {
                "orchestrator:routing":    { payload: {} },
                "orchestrator:routed":     { payload: { profile: "string", complexity: "string", type: "string" } },
                "orchestrator:engineering":{ payload: {} },
                "orchestrator:engineered": { payload: { originalLen: "number", optimizedLen: "number" } },
                "orchestrator:watching":   { payload: { bufferLen: "number" } },
                "orchestrator:flagged":    { payload: { flag: "string" } },
                "orchestrator:auditing":   { payload: {} },
                "orchestrator:audited":    { payload: { score: "number", note: "string" } },
                "orchestrator:commentary_generating": { payload: { persona: "string" } },
                "orchestrator:commentary": { payload: { text: "string", persona: "string" } },
                "orchestrator:error":      { payload: { stage: "string", message: "string" } },
            },
            workflows: {},
        },
    };
    // ── end MANIFEST ─────────────────────────────────────────

    constructor() {
        this._modelPath = null;   // cached after first models.json read
        this._listeners = [];
    }

    // ── internal event emitter ────────────────────────────────
    on(event, handler)  { this._listeners.push({ event, handler }); }
    off(event, handler) { this._listeners = this._listeners.filter(l => !(l.event === event && l.handler === handler)); }
    emit(event, data)   { for (const l of this._listeners) { if (l.event === event) try { l.handler(data); } catch (_) {} } }

    // ── _getModelPath ─────────────────────────────────────────
    // Reads models.json once and caches the resolved local model path.
    _getModelPath() {
        if (this._modelPath) return this._modelPath;
        try {
            const file   = paths.resolve("config", "models.json");
            const models = JSON.parse(fs.readFileSync(file, "utf8"));
            const entry  = (models.entries || []).find(m => m.provider === "local");
            if (!entry) { console.error("[Orchestrator] No local model entry in models.json"); return null; }
            this._modelPath = _resolveModelPath(entry.model_path);
            if (!fs.existsSync(this._modelPath)) {
                console.error("[Orchestrator] GGUF not found at:", this._modelPath);
                this._modelPath = null;
            }
        } catch (e) {
            console.error("[Orchestrator] Cannot resolve local model path:", e.message);
            this._modelPath = null;
        }
        return this._modelPath;
    }

    _budget(promptText, systemText = "", maxResponse = 256) {
        return local.calculateBudget({ promptText, systemText, maxResponse });
    }

    // ── route ─────────────────────────────────────────────────
    // Classifies the request and returns a suggested profile.
    // Fast: < 80 response tokens, temperature near zero.
    //
    // Returns: { type, complexity, profile, skipped?, error? }
    // ── end of route ─────────────────────────────────────────

    async route(message) {
        const modelPath = this._getModelPath();
        const fallback  = { type: "chat", complexity: "medium", profile: null, skipped: true };
        if (!modelPath) return fallback;

        this.emit("orchestrator:routing", {});

        const sys    = `You classify user requests. Respond with compact JSON only — no explanation, no markdown.`;
        const prompt = `Classify this request (first 400 chars shown):\n"${message.slice(0, 400)}"\n\nJSON response format: {"type":"code|debug|explain|design|chat","complexity":"low|medium|high","profile":"default|coding|deep_reasoning"}`;
        const budget = this._budget(prompt, sys, 80);

        try {
            const raw    = await local.generate(prompt, { modelPath, maxTokens: budget.responseTokens, temperature: 0.05, systemPrompt: sys });
            const result = _safeJson(raw, fallback);
            this.emit("orchestrator:routed", {
                type:       result.type       || "chat",
                complexity: result.complexity || "medium",
                profile:    result.profile    || "default",
            });
            return { ...fallback, ...result, skipped: false };
        } catch (e) {
            console.error("[Orchestrator] route error:", e.message);
            this.emit("orchestrator:error", { stage: "route", message: e.message });
            return { ...fallback, error: e.message };
        }
    }

    // ── engineer ─────────────────────────────────────────────
    // Rewrites the user's prompt to be maximally clear and precise
    // before sending to the prime model.
    //
    // Returns: { prompt, original, skipped?, error? }
    //   prompt   — the rewritten message (or original if skipped)
    //   original — the unmodified input
    // ── end of engineer ──────────────────────────────────────

    async engineer(message) {
        const modelPath = this._getModelPath();
        if (!modelPath) return { prompt: message, original: message, skipped: true };

        this.emit("orchestrator:engineering", {});

        const sys    = `You are a prompt optimizer for AI coding assistants. Rewrite the user message to be maximally clear, precise, and effective. Preserve ALL original intent. Be concise. Output ONLY the rewritten message — no explanation, no preamble.`;
        const budget = this._budget(message, sys, 400);

        try {
            const out = await local.generate(message, {
                modelPath,
                maxTokens:   budget.responseTokens,
                temperature: 0.2,
                systemPrompt: sys,
            });

            // Reject if the rewrite is too short or clearly broken
            const engineered = (out && out.trim().length > 12) ? out.trim() : message;
            this.emit("orchestrator:engineered", {
                originalLen:  message.length,
                optimizedLen: engineered.length,
            });
            return { prompt: engineered, original: message, skipped: false };
        } catch (e) {
            console.error("[Orchestrator] engineer error:", e.message);
            this.emit("orchestrator:error", { stage: "engineer", message: e.message });
            return { prompt: message, original: message, skipped: true, error: e.message };
        }
    }

    // ── watch ─────────────────────────────────────────────────
    // Lightweight real-time monitor called on rolling chunks of
    // the prime model's streaming output. Designed to be invoked
    // as fire-and-forget (setImmediate) so it never blocks the stream.
    //
    // Returns: { ok: true } or { flag: "brief description" }
    // ── end of watch ─────────────────────────────────────────

    async watch(buffer, question) {
        const modelPath = this._getModelPath();
        if (!modelPath || !buffer || buffer.length < 80) return { ok: true };

        this.emit("orchestrator:watching", { bufferLen: buffer.length });

        // Only inspect the most recent ~600 chars — keep token count tiny
        const tail   = buffer.slice(-600);
        const sys    = `You monitor AI-generated content for errors. If everything looks fine, respond: {"ok":true}. If you spot a clear issue (wrong code, hallucination, factual error), respond: {"flag":"one-sentence description"}. JSON only.`;
        const prompt = `Reviewing response in progress:\n---\n${tail}\n---`;
        const budget = this._budget(prompt, sys, 60);

        try {
            const raw    = await local.generate(prompt, { modelPath, maxTokens: budget.responseTokens, temperature: 0.05, systemPrompt: sys });
            const result = _safeJson(raw, { ok: true });
            if (result.flag) this.emit("orchestrator:flagged", { flag: result.flag });
            return result;
        } catch (e) {
            return { ok: true };   // watch failures are always silent
        }
    }

    // ── audit ─────────────────────────────────────────────────
    // Post-response quality assessment. Called once after the prime
    // model finishes. Scores the response and flags issues.
    //
    // Returns: { score, issues, note, skipped?, error? }
    // ── end of audit ─────────────────────────────────────────

    async audit(question, response) {
        const modelPath = this._getModelPath();
        if (!modelPath || !response) return { score: null, issues: [], note: "", skipped: true };

        this.emit("orchestrator:auditing", {});

        const sys    = `You review AI coding responses for quality and extract user behavioral observations. Be concise. Output compact JSON only.`;
        const prompt = `Question (first 300 chars):\n${question.slice(0, 300)}\n\nResponse (first 800 chars):\n${response.slice(0, 800)}\n\nScore, assess, and observe user traits. JSON: {"score":8,"issues":[],"note":"brief assessment","user_observation":"one-sentence observation about user preferences or behavior (or null)"}`;
        const budget = this._budget(prompt, sys, 150);

        try {
            const raw    = await local.generate(prompt, { modelPath, maxTokens: budget.responseTokens, temperature: 0.1, systemPrompt: sys });
            const result = _safeJson(raw, { score: null, issues: [], note: "", user_observation: null });
            this.emit("orchestrator:audited", {
                score: result.score ?? null,
                note:  result.note  || "",
            });

            // Record user observation if present
            if (result.user_observation) {
                memory.record("user_observation", result.user_observation);
            }

            return { ...result, skipped: false };
        } catch (e) {
            console.error("[Orchestrator] audit error:", e.message);
            this.emit("orchestrator:error", { stage: "audit", message: e.message });
            return { score: null, issues: [], note: "", skipped: true, error: e.message };
        }
    }

    // ── commentary ───────────────────────────────────────────
    // Generates side-channel dialogue from a specific persona.
    // ── end of commentary ────────────────────────────────────

    async commentary(message, response, persona = "advisor") {
        const modelPath = this._getModelPath();
        if (!modelPath || !response) return { text: "", skipped: true };

        this.emit("orchestrator:commentary_generating", { persona });

        const profile = memory.loadUserProfile();
        const traits  = (profile.traits || []).join(", ");
        
        const sys = `You are a "Silent Partner" AI. You act as a ${persona} to the user.
Traits about this user: ${traits || "none yet"}
Rules:
- Be extremely concise (1-2 sentences max).
- Add flavor based on your persona (comedy, advice, friendship).
- Speak directly to the user about their interaction.
- Output ONLY your message text — no prefixes like "Advisor:" or "Comedian:".`;

        const prompt = `User asked: "${message.slice(0, 200)}..."\nPrime model replied: "${response.slice(0, 400)}..."\n\nGenerate your ${persona} commentary:`;

        try {
            const out = await local.generate(prompt, {
                modelPath,
                maxTokens: 120,
                temperature: 0.8,
                systemPrompt: sys
            });
            const text = out ? out.trim().replace(/^["']|["']$/g, "") : "";
            this.emit("orchestrator:commentary", { text, persona });
            return { text, persona, skipped: false };
        } catch (e) {
            console.error("[Orchestrator] commentary error:", e.message);
            return { text: "", skipped: true };
        }
    }
}

// ── Singleton export ──────────────────────────────────────────
const orchestrator = new MultiModelOrchestrator();
module.exports = orchestrator;
module.exports.MultiModelOrchestrator = MultiModelOrchestrator;
