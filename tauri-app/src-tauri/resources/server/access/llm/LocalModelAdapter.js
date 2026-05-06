// ============================================================
// LocalModelAdapter.js — SDOA v3.0 Adapter (NodeJS)
// version: 1.0.0
// Last modified: 2026-05-04 03:11 UTC
// depends: node-llama-cpp (v3.x), paths
// ============================================================
//
// Lazy-loads a GGUF model into the persistent sidecar process on
// first use and keeps it resident for the lifetime of the session.
// Concurrent callers share a single load Promise — the model is
// never loaded twice.
//
// All inference methods (generate, stream) dispose their context
// sequence when done so the context slot is freed for the next call.
// ============================================================

"use strict";

const path  = require("path");
const fs    = require("fs");
const paths = require("../env/paths");

// ── ESM compatibility ────────────────────────────────────────
// node-llama-cpp v3.x ships as ESM; dynamic import() works from CJS.
let _mod = null;
async function _llamaCpp() {
    if (!_mod) _mod = await import("node-llama-cpp");
    return _mod;
}

class LocalModelAdapter {

    // ── SDOA v3.0 MANIFEST ───────────────────────────────────
    static MANIFEST = {
        id:           "LocalModelAdapter",
        type:         "adapter",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [
            "local.generate",
            "local.stream",
            "local.tokenize",
            "local.budget",
        ],
        dependencies: ["node-llama-cpp"],
        docs: {
            description: "Runtime adapter for local GGUF models via node-llama-cpp. Lazy-loads on first use, keeps model resident in the sidecar process for the full session.",
            input: {
                generate: { prompt: "string", modelPath: "string", maxTokens: "number?", temperature: "number?", systemPrompt: "string?" },
            },
            output: {
                generate: "string",
                stream:   "string",
                budget:   "{ promptTokens, responseTokens, headroom, fits }",
            },
            author: "ProtoAI team",
        },
        actions: {
            commands: {
                generate: { description: "Single-shot generation from local model.", input: { prompt: "string", opts: "object?" }, output: "string" },
                stream:   { description: "Streaming generation from local model.",   input: { prompt: "string", opts: "object?" }, output: "string" },
                budget:   { description: "Calculate safe token budget for a request.", input: { promptText: "string" }, output: "object" },
            },
            triggers:  {},
            emits: {
                "local:modelLoaded":  { payload: { modelPath: "string", elapsed: "number" } },
                "local:generateDone": { payload: { elapsed: "number" } },
            },
            workflows: {},
        },
    };
    // ── end MANIFEST ─────────────────────────────────────────

    constructor() {
        this._llama            = null;
        this._model            = null;
        this._ctx              = null;
        this._modelPath        = null;
        this._ready            = false;
        this._loading          = null;   // shared Promise while loading
        this._LlamaChatSession = null;
    }

    // ── _ensureLoaded ─────────────────────────────────────────
    // Concurrent callers share the same load Promise so the model
    // is never loaded twice. Resolves once the model is ready.
    // ── end of _ensureLoaded ─────────────────────────────────

    async _ensureLoaded(modelPath) {
        if (this._ready && this._modelPath === modelPath) return;
        if (this._loading) return this._loading;

        this._loading = (async () => {
            const t0 = Date.now();
            console.error(`[LocalModelAdapter] Loading ${path.basename(modelPath)}…`);

            const { getLlama, LlamaChatSession } = await _llamaCpp();
            // Force CPU-only mode — Vulkan GPU conflicts with WebView2's GPU
            // process and causes vk::Queue::submit: ErrorDeviceLost crashes.
            this._llama = await getLlama({ gpu: false });
            this._model = await this._llama.loadModel({ modelPath });
            this._ctx   = await this._model.createContext({
                contextSize: 8192,   // conservative; safe for 4–5 GB Q4_K_M GGUF
                batchSize:   512,
            });

            this._LlamaChatSession = LlamaChatSession;
            this._modelPath        = modelPath;
            this._ready            = true;
            this._loading          = null;

            const ms = Date.now() - t0;
            console.error(`[LocalModelAdapter] Ready in ${ms}ms — ${path.basename(modelPath)}`);
        })();

        return this._loading;
    }

    // ── generate ─────────────────────────────────────────────
    // Single-shot inference. Creates a fresh context sequence per
    // call so requests don't contaminate each other's KV cache.
    // ── end of generate ──────────────────────────────────────

    async generate(prompt, opts = {}) {
        const {
            modelPath,
            maxTokens    = 512,
            temperature  = 0.15,
            systemPrompt = "",
        } = opts;

        if (!modelPath) throw new Error("[LocalModelAdapter] opts.modelPath is required");
        if (!fs.existsSync(modelPath)) throw new Error(`[LocalModelAdapter] Model file not found: ${modelPath}`);

        await this._ensureLoaded(modelPath);

        const seq     = this._ctx.getSequence();
        const session = new this._LlamaChatSession({ contextSequence: seq, systemPrompt });

        const t0 = Date.now();
        let result = "";
        try {
            result = await session.prompt(prompt, { maxTokens, temperature });
        } finally {
            try { seq.dispose(); } catch (_) {}
        }

        console.error(`[LocalModelAdapter] generate ${Date.now() - t0}ms`);
        return (result || "").trim();
    }

    // ── stream ────────────────────────────────────────────────
    // Streaming inference. Calls onChunk(token) for each emitted
    // token and returns the full accumulated text when complete.
    // ── end of stream ────────────────────────────────────────

    async stream(prompt, opts = {}) {
        const {
            modelPath,
            maxTokens    = 512,
            temperature  = 0.15,
            systemPrompt = "",
            onChunk,
        } = opts;

        if (!modelPath) throw new Error("[LocalModelAdapter] opts.modelPath is required");
        if (!fs.existsSync(modelPath)) throw new Error(`[LocalModelAdapter] Model file not found: ${modelPath}`);

        await this._ensureLoaded(modelPath);

        const seq     = this._ctx.getSequence();
        const session = new this._LlamaChatSession({ contextSequence: seq, systemPrompt });

        let full = "";
        try {
            await session.prompt(prompt, {
                maxTokens,
                temperature,
                onTextChunk: (chunk) => {
                    full += chunk;
                    try { onChunk?.(chunk); } catch (_) {}
                },
            });
        } finally {
            try { seq.dispose(); } catch (_) {}
        }

        return full.trim();
    }

    // ── estimateTokens ────────────────────────────────────────
    // Fast heuristic — no model load required. Good enough for
    // budget calculations; over-estimates slightly for safety.
    // ── end of estimateTokens ────────────────────────────────

    estimateTokens(text = "") {
        if (!text) return 0;
        const words   = (text.match(/\S+/g) || []).length;
        const symbols = (text.match(/[{}()[\];=<>/\\+\-*|&^%$#@!,.?:'"~`]/g) || []).length;
        return Math.ceil(words * 0.85 + symbols * 0.3);
    }

    // ── calculateBudget ───────────────────────────────────────
    // Given the full prompt text + system text, returns a safe
    // maxTokens value for the response while keeping the total
    // token count within contextSize.
    // ── end of calculateBudget ───────────────────────────────

    calculateBudget({
        promptText    = "",
        systemText    = "",
        contextSize   = 8192,
        minResponse   = 64,
        maxResponse   = 2048,
    } = {}) {
        const promptTokens   = this.estimateTokens(promptText + " " + systemText);
        const safetyMargin   = 96;
        const available      = contextSize - promptTokens - safetyMargin;
        const responseTokens = Math.max(minResponse, Math.min(available, maxResponse));

        return {
            promptTokens,
            responseTokens,
            headroom: Math.max(0, available - responseTokens),
            fits:     promptTokens + responseTokens + safetyMargin <= contextSize,
        };
    }
}

// ── Singleton export ──────────────────────────────────────────
// One model res