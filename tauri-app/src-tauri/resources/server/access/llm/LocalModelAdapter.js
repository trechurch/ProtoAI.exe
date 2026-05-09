// ============================================================
// LocalModelAdapter.js — SDOA v4 Adapter (NodeJS)
// version: 2.0.0
// Last modified: 2026-05-09
//
// Supports two backends:
//
//   1. python-http  — Spawns qwen_server.py inside the user's
//                     ai_env venv (or embedded Python), waits for
//                     QWEN_SERVER_READY:<port> on stdout, then
//                     routes all inference through HTTP.
//                     Selected when models.json entry has
//                     { "backend": "python-http" }.
//
//   2. llama-cpp    — Legacy GGUF inference via node-llama-cpp.
//                     Selected when entry has a local "model_path".
//
// Both backends expose the same public API:
//   generate(prompt, opts)  → string
//   stream(prompt, opts)    → string  (calls opts.onChunk per token)
//   estimateTokens(text)    → number
//   calculateBudget(opts)   → { promptTokens, responseTokens, headroom, fits }
// ============================================================

"use strict";

const path     = require("path");
const fs       = require("fs");
const os       = require("os");
const http     = require("http");
const { spawn } = require("child_process");
const paths    = require("../env/paths");
const Middleware = require("../../services/Middleware.service");

// ── ESM compatibility for node-llama-cpp (legacy backend) ──
let _llamaCppMod = null;
async function _llamaCpp() {
    if (!_llamaCppMod) _llamaCppMod = await import("node-llama-cpp");
    return _llamaCppMod;
}


// ══════════════════════════════════════════════════════════
//  Python HTTP backend helpers
// ══════════════════════════════════════════════════════════

/**
 * Locate the Python executable to use for the AI environment.
 * Priority:
 *   1. %APPDATA%\protoai\ai_env\Scripts\python.exe  (set up by bootstrap)
 *   2. <resources>/python-embed/python.exe           (bundled embed)
 *   3. System python3 / python
 */
function _findPython() {
    const appdata  = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    const venvPy   = path.join(appdata, "protoai", "ai_env", "Scripts", "python.exe");
    if (fs.existsSync(venvPy)) return venvPy;

    const embedPy  = path.join(paths.root, "python-embed", "python.exe");
    if (fs.existsSync(embedPy)) return embedPy;

    // Fallback for dev — check system PATH
    const fallbacks = ["python3", "python"];
    for (const name of fallbacks) {
        try {
            require("child_process").execSync(`${name} --version`, { stdio: "ignore" });
            return name;
        } catch (_) {}
    }

    return null;
}

/**
 * Resolve the path to qwen_server.py, which lives in resources/server/local_model/.
 */
function _serverScriptPath() {
    const candidates = [
        path.join(paths.root, "server", "local_model", "qwen_server.py"),
        path.join(__dirname, "..", "..", "local_model", "qwen_server.py"),
        path.join(__dirname, "qwen_server.py"),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    return null;
}

/**
 * Ping the inference server. Returns true when it responds to /health.
 */
function _ping(port, timeoutMs = 2000) {
    return new Promise((resolve) => {
        const req = http.get(
            { hostname: "127.0.0.1", port, path: "/health", timeout: timeoutMs },
            (res) => {
                let body = "";
                res.on("data", d => body += d);
                res.on("end", () => {
                    try { resolve(JSON.parse(body)); } catch (_) { resolve(null); }
                });
            }
        );
        req.on("error", () => resolve(null));
        req.on("timeout", () => { req.destroy(); resolve(null); });
    });
}

/**
 * POST /generate to the inference server and return the text.
 */
function _httpGenerate(port, payload, timeoutMs = 120_000) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(payload);
        const req  = http.request(
            {
                hostname: "127.0.0.1",
                port,
                path:     "/generate",
                method:   "POST",
                headers: {
                    "Content-Type":   "application/json",
                    "Content-Length": Buffer.byteLength(body),
                },
                timeout: timeoutMs,
            },
            (res) => {
                let data = "";
                res.on("data", d => data += d);
                res.on("end", () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.error) reject(new Error(parsed.error));
                        else resolve(parsed.text || "");
                    } catch (e) {
                        reject(new Error("Invalid JSON response from qwen_server"));
                    }
                });
            }
        );
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("qwen_server request timed out")); });
        req.write(body);
        req.end();
    });
}


// ══════════════════════════════════════════════════════════
//  LocalModelAdapter class
// ══════════════════════════════════════════════════════════

class LocalModelAdapter {

    static MANIFEST = {
        id:           "LocalModelAdapter",
        type:         "adapter",
        runtime:      "NodeJS",
        version:      "2.0.0",
        capabilities: [
            "local.generate",
            "local.stream",
            "local.tokenize",
            "local.budget",
        ],
        backends: ["python-http", "llama-cpp"],
        docs: {
            description: "Runtime adapter for local LLMs. Supports Qwen2.5-Omni-7B via Python HTTP server or legacy GGUF models via node-llama-cpp.",
            author: "ProtoAI team",
        },
    };

    constructor() {
        // ── python-http backend state ──
        this._serverProc  = null;   // child_process.ChildProcess
        this._serverPort  = null;   // number
        this._serverReady = false;
        this._serverStart = null;   // shared Promise while starting up

        // ── llama-cpp backend state (legacy) ──
        this._llama            = null;
        this._model            = null;
        this._ctx              = null;
        this._modelPath        = null;
        this._llamaReady       = false;
        this._llamaLoading     = null;
        this._LlamaChatSession = null;
    }

    // ──────────────────────────────────────────────────────
    //  Python HTTP backend
    // ──────────────────────────────────────────────────────

    /**
     * Ensure the Python inference server is running.
     * Shared start Promise prevents double-spawn on concurrent callers.
     */
    async _ensureServer(entry = {}) {
        if (this._serverReady) return;
        if (this._serverStart) return this._serverStart;

        this._serverStart = this._startServer(entry);
        await this._serverStart;
        this._serverStart = null;
    }

    async _startServer(entry = {}) {
        const port   = entry.port || 17892;
        const python = _findPython();
        const script = _serverScriptPath();

        if (!python) throw new Error("[LocalModelAdapter] No Python executable found. Run Setup Local AI first.");
        if (!script)  throw new Error("[LocalModelAdapter] qwen_server.py not found in resources.");

        // Check if something is already listening on the port
        const alive = await _ping(port);
        if (alive?.ok) {
            Middleware.log(`[LocalModelAdapter] Python server already running on :${port}`);
            this._serverPort  = port;
            this._serverReady = true;
            return;
        }

        Middleware.log(`[LocalModelAdapter] Spawning qwen_server.py on :${port} with ${python}`);

        return new Promise((resolve, reject) => {
            const proc = spawn(python, [script, "--port", String(port)], {
                stdio: ["ignore", "pipe", "pipe"],
            });

            this._serverProc = proc;

            const startTimeout = setTimeout(() => {
                reject(new Error("[LocalModelAdapter] qwen_server.py did not signal readiness within 60s"));
            }, 60_000);

            proc.stdout.on("data", (chunk) => {
                const text = chunk.toString();
                Middleware.log(`[qwen_server] ${text.trim()}`);
                if (text.includes("QWEN_SERVER_READY")) {
                    clearTimeout(startTimeout);
                    this._serverPort  = port;
                    this._serverReady = true;
                    resolve();
                }
            });

            proc.stderr.on("data", (chunk) => {
                Middleware.log(`[qwen_server:err] ${chunk.toString().trim()}`);
            });

            proc.on("exit", (code, signal) => {
                Middleware.log(`[LocalModelAdapter] qwen_server exited (code=${code} signal=${signal})`);
                this._serverReady = false;
                this._serverProc  = null;
                this._serverPort  = null;
            });

            proc.on("error", (err) => {
                clearTimeout(startTimeout);
                reject(err);
            });
        });
    }

    async _generateViaHttp(prompt, opts = {}) {
        const { maxTokens = 512, temperature = 0.7, systemPrompt = "", port } = opts;
        await this._ensureServer({ port: port || this._serverPort || 17892 });

        return _httpGenerate(this._serverPort, {
            prompt,
            system_prompt: systemPrompt,
            max_new_tokens: maxTokens,
            temperature,
        });
    }

    // ──────────────────────────────────────────────────────
    //  llama-cpp backend (legacy GGUF)
    // ──────────────────────────────────────────────────────

    async _ensureLlama(modelPath) {
        if (this._llamaReady && this._modelPath === modelPath) return;
        if (this._llamaLoading) return this._llamaLoading;

        this._llamaLoading = (async () => {
            const t0 = Date.now();
            Middleware.log(`[LocalModelAdapter] Loading GGUF ${path.basename(modelPath)}…`);

            const { getLlama, LlamaChatSession } = await _llamaCpp();
            this._llama = await getLlama({ gpu: false });
            this._model = await this._llama.loadModel({ modelPath });
            this._ctx   = await this._model.createContext({ contextSize: 8192, batchSize: 512 });

            this._LlamaChatSession = LlamaChatSession;
            this._modelPath        = modelPath;
            this._llamaReady       = true;
            this._llamaLoading     = null;

            Middleware.log(`[LocalModelAdapter] GGUF ready in ${Date.now() - t0}ms`);
        })();

        return this._llamaLoading;
    }

    // ──────────────────────────────────────────────────────
    //  Public API
    // ──────────────────────────────────────────────────────

    /**
     * Single-shot inference.
     * opts.backend = "python-http" | "llama-cpp"  (auto-detected if omitted)
     * opts.modelPath — required for llama-cpp
     * opts.port      — optional override for python-http (default 17892)
     */
    async generate(prompt, opts = {}) {
        const backend = opts.backend || (opts.modelPath ? "llama-cpp" : "python-http");

        if (backend === "python-http") {
            const t0  = Date.now();
            const out = await this._generateViaHttp(prompt, opts);
            Middleware.log(`[LocalModelAdapter] generate (http) ${Date.now() - t0}ms`);
            return out;
        }

        // llama-cpp path
        const { modelPath, maxTokens = 512, temperature = 0.15, systemPrompt = "" } = opts;
        if (!modelPath)             throw new Error("[LocalModelAdapter] opts.modelPath required for llama-cpp backend");
        if (!fs.existsSync(modelPath)) throw new Error(`[LocalModelAdapter] Model not found: ${modelPath}`);

        await this._ensureLlama(modelPath);
        const seq     = this._ctx.getSequence();
        const session = new this._LlamaChatSession({ contextSequence: seq, systemPrompt });
        const t0 = Date.now();
        let result = "";
        try {
            result = await session.prompt(prompt, { maxTokens, temperature });
        } finally {
            try { seq.dispose(); } catch (_) {}
        }
        Middleware.log(`[LocalModelAdapter] generate (llama-cpp) ${Date.now() - t0}ms`);
        return (result || "").trim();
    }

    /**
     * Streaming inference. Calls opts.onChunk(token) per token.
     * python-http backend: full response arrives at once (no true streaming
     * from the server yet), but onChunk is called once with the full text.
     */
    async stream(prompt, opts = {}) {
        const backend = opts.backend || (opts.modelPath ? "llama-cpp" : "python-http");

        if (backend === "python-http") {
            const text = await this._generateViaHttp(prompt, opts);
            try { opts.onChunk?.(text); } catch (_) {}
            return text;
        }

        // llama-cpp streaming path
        const { modelPath, maxTokens = 512, temperature = 0.15, systemPrompt = "", onChunk } = opts;
        if (!modelPath)             throw new Error("[LocalModelAdapter] opts.modelPath required for llama-cpp backend");
        if (!fs.existsSync(modelPath)) throw new Error(`[LocalModelAdapter] Model not found: ${modelPath}`);

        await this._ensureLlama(modelPath);
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

    /** Fast token count heuristic — no model load required. */
    estimateTokens(text = "") {
        if (!text) return 0;
        const words   = (text.match(/\S+/g) || []).length;
        const symbols = (text.match(/[{}()[\];=<>/\\+\-*|&^%$#@!,.?:'"~`]/g) || []).length;
        return Math.ceil(words * 0.85 + symbols * 0.3);
    }

    /** Calculate a safe maxTokens given prompt size and context budget. */
    calculateBudget({ promptText = "", systemText = "", contextSize = 8192, minResponse = 64, maxResponse = 2048 } = {}) {
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

    /**
     * Graceful shutdown: kill the Python server process if we spawned it.
     * Called by the sidecar on SIGTERM/exit.
     */
    shutdown() {
        if (this._serverProc) {
            Middleware.log("[LocalModelAdapter] Killing qwen_server process...");
            try { this._serverProc.kill("SIGTERM"); } catch (_) {}
            this._serverProc  = null;
            this._serverReady = false;
        }
    }
}

// ── Singleton export ──────────────────────────────────────
const adapter = new LocalModelAdapter();
module.exports = adapter;
module.exports.LocalModelAdapter = LocalModelAdapter;
