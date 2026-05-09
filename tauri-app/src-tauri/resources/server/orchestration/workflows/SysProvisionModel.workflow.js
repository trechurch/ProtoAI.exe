// ============================================================
// SysProvisionModel.workflow.js — SDOA v4 Workflow
// version: 2.0.0
// Last modified: 2026-05-09
//
// Orchestrates first-run Local AI setup:
//   1. Locate embedded Python runtime (bundled with the app)
//   2. Spawn bootstrap.py, which:
//        • bootstraps pip into embedded Python
//        • creates %APPDATA%\protoai\ai_env venv
//        • installs torch, transformers, accelerate, etc.
//        • downloads Qwen2.5-Omni-7B from HuggingFace
//   3. Streams JSON progress lines as EventBus events so the
//      UI can show a real-time setup progress panel.
//
// Invoked via:
//   backendConnector.runWorkflow("SysProvisionModel", { model?, cuda? })
//
// Events emitted:
//   sys:provision:progress  { step, total, label, sub?, pct }
//   sys:provision:done      { venv, model }
//   sys:provision:error     { error }
// ============================================================
"use strict";

const WorkflowBase   = require("../WorkflowBase");
const WorkflowResult = require("../WorkflowResult");
const path           = require("path");
const fs             = require("fs");
const os             = require("os");
const { spawn }      = require("child_process");
const paths          = require("../../access/env/paths");

class SysProvisionModelWorkflow extends WorkflowBase {
    static MANIFEST = {
        id:      "SysProvisionModelWorkflow",
        type:    "workflow",
        runtime: "NodeJS",
        version: "2.0.0",
        capabilities: ["sys.provision.model"],
        docs: {
            description: "First-run setup: installs Python venv, deps, and downloads Qwen2.5-Omni-7B.",
            input:  { model: "string?", cuda: "boolean?" },
            output: { venv: "string", model: "string" },
        }
    };

    _findBootstrap() {
        const candidates = [
            path.join(paths.root, "server", "local_model", "bootstrap.py"),
            path.join(__dirname, "..", "..", "local_model", "bootstrap.py"),
        ];
        for (const c of candidates) {
            if (fs.existsSync(c)) return c;
        }
        return null;
    }

    _findEmbeddedPython() {
        const embedDir = path.join(paths.root, "python-embed");
        const embedPy  = path.join(embedDir, "python.exe");
        if (fs.existsSync(embedPy)) return { exe: embedPy, dir: embedDir };

        const appdata = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
        const venvPy  = path.join(appdata, "protoai", "ai_env", "Scripts", "python.exe");
        if (fs.existsSync(venvPy)) return { exe: venvPy, dir: null };

        for (const name of ["python3", "python"]) {
            try {
                require("child_process").execSync(`${name} --version`, { stdio: "ignore" });
                return { exe: name, dir: null };
            } catch (_) {}
        }
        return null;
    }

    _emit(eventName, payload) {
        try {
            const EventBus = require("../../services/EventBus.service");
            EventBus.emit(eventName, payload);
        } catch (_) {}
    }

    _writeStatus(statusFile, data) {
        if (!statusFile) return;
        try { fs.writeFileSync(statusFile, JSON.stringify(data), "utf8"); } catch (_) {}
    }

    async run(context = {}) {
        const modelName  = context.model || "Qwen/Qwen2.5-Omni-7B";
        const cuda       = !!context.cuda;
        const statusFile = context.statusFile || null;

        const bootstrap = this._findBootstrap();
        if (!bootstrap) {
            const err = "bootstrap.py not found in resources. Reinstall ProtoAI.";
            this._emit("sys:provision:error", { error: err });
            return WorkflowResult.error(err);
        }

        const pyInfo = this._findEmbeddedPython();
        if (!pyInfo) {
            const err = "No Python runtime found. The ProtoAI installer may be incomplete.";
            this._emit("sys:provision:error", { error: err });
            return WorkflowResult.error(err);
        }

        const appdata  = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
        const venvPath = path.join(appdata, "protoai", "ai_env");

        console.error(`[SysProvisionModel] Starting setup — python: ${pyInfo.exe}`);
        console.error(`[SysProvisionModel] Venv target: ${venvPath}`);
        console.error(`[SysProvisionModel] Model: ${modelName}`);

        const args = [bootstrap, "--model", modelName, "--venv", venvPath];
        if (pyInfo.dir) args.push("--embed-dir", pyInfo.dir);
        if (cuda)       args.push("--cuda");

        return new Promise((resolve) => {
            const proc = spawn(pyInfo.exe, args, { stdio: ["ignore", "pipe", "pipe"] });
            let lastProgress = null;

            proc.stdout.on("data", (chunk) => {
                const lines = chunk.toString().split("\n").filter(Boolean);
                for (const line of lines) {
                    let parsed = null;
                    try { parsed = JSON.parse(line); } catch (_) { continue; }

                    if (parsed.done) {
                        this._emit("sys:provision:done", { venv: parsed.venv, model: parsed.model });
                        this._writeStatus(statusFile, { state: "done", venv: parsed.venv, model: parsed.model, completedAt: new Date().toISOString() });
                        resolve(WorkflowResult.ok({ venv: parsed.venv, model: parsed.model }));
                    } else if (parsed.error) {
                        this._emit("sys:provision:error", { error: parsed.error });
                        this._writeStatus(statusFile, { state: "error", error: parsed.error, completedAt: new Date().toISOString() });
                        resolve(WorkflowResult.error(parsed.error));
                    } else if (parsed.step !== undefined) {
                        lastProgress = parsed;
                        this._emit("sys:provision:progress", parsed);
                        this._writeStatus(statusFile, { state: "running", step: parsed.step, total: parsed.total, label: parsed.label, sub: parsed.sub || null, pct: parsed.pct || 0, model: modelName });
                        const sub = parsed.sub ? ` — ${parsed.sub}` : "";
                        console.error(`[SysProvisionModel] [${parsed.step}/${parsed.total}] ${parsed.label}${sub}`);
                    }
                }
            });

            proc.stderr.on("data", (chunk) => {
                const text = chunk.toString().trim();
                if (text) console.error(`[bootstrap:err] ${text}`);
            });

            proc.on("exit", (code) => {
                if (code === 0 && !lastProgress?.done) {
                    this._emit("sys:provision:done", { venv: venvPath, model: modelName });
                    resolve(WorkflowResult.ok({ venv: venvPath, model: modelName }));
                } else if (code !== 0) {
                    const err = `bootstrap.py exited with code ${code}`;
                    this._emit("sys:provision:error", { error: err });
                    resolve(WorkflowResult.error(err));
                }
            });

            proc.on("error", (err) => {
                const msg = `Failed to spawn bootstrap.py: ${err.message}`;
                this._emit("sys:provision:error", { error: msg });
                resolve(WorkflowResult.error(msg));
            });
        });
    }
}

module.exports = SysProvisionModelWorkflow;
