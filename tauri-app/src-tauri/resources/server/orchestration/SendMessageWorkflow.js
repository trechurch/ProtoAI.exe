"use strict";

// ============================================================
// SendMessageWorkflow.js
// version: 2.0.0
// ============================================================
// Invokes claude-select.cjs to call OpenRouter/Anthropic APIs.
// Uses a temp context file to pass large payloads rather than
// shell args (avoids Windows arg length limits).
// Handles streaming, spellcheck, history, and failover output.
// ============================================================

const WorkflowBase  = require("./WorkflowBase");
const WorkflowResult = require("./WorkflowResult");
const path          = require("path");
const fs            = require("fs");
const { spawnSync, spawn } = require("child_process");
const paths         = require("../access/env/paths");

exports.VERSION    = "2.0.0";
exports.getVersion = () => exports.VERSION;

// ── resolve claude-select.cjs ────────────────────────────────
// cli/ is two levels above server/ in the repo root.
// server/ = PROTOAI_ROOT/tauri-app/src-tauri/resources/server
// cli/    = PROTOAI_ROOT/cli
// ── end of resolve ───────────────────────────────────────────
function _findCliScript() {
    const root = paths.root;

    // Primary: repo-root/cli/claude-select.cjs
    const primary = path.join(root, "cli", "claude-select.cjs");
    if (fs.existsSync(primary)) return primary;

    // Fallback: walk up from __dirname looking for cli/
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
        const candidate = path.join(dir, "cli", "claude-select.cjs");
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    return null;
}

// ── resolve node executable ──────────────────────────────────
// Use the bundled node sidecar if available, otherwise system node.
// ── end of resolve ───────────────────────────────────────────
function _findNode() {
    // Tauri bundles node as a sidecar next to the exe
    const exeDir = path.dirname(process.execPath);
    const bundled = path.join(exeDir, "node.exe");
    if (fs.existsSync(bundled)) return bundled;
    return process.execPath; // current node process
}

class SendMessageWorkflow extends WorkflowBase {
    constructor() { super(); }

    async run(payload) {
        try {
            let { project, profile, engine, message, spellcheckMode, onChunk } = payload;

            if (!message || !message.trim()) {
                return WorkflowResult.error("Message cannot be empty.");
            }
            if (!profile) profile = "default";
            if (typeof spellcheckMode !== "number") spellcheckMode = 0;

            const cliScript = _findCliScript();
            if (!cliScript) {
                return WorkflowResult.error(
                    "claude-select.cjs not found. Expected at: " +
                    path.join(paths.root, "cli", "claude-select.cjs")
                );
            }

            const nodeExe = _findNode();
            const root    = paths.root;

            // ── local spellcheck (mode 0) ─────────────────────
            let correctedMessage = message;
            if (spellcheckMode === 0) {
                try {
                    const Typo = require("typo-js");
                    const dict = new Typo("en_US");
                    correctedMessage = message.split(/\s+/).map(word => {
                        const clean = word.replace(/[^a-zA-Z']/g, "");
                        if (!clean || dict.check(clean)) return word;
                        const sug = dict.suggest(clean)[0];
                        return sug ? word.replace(clean, sug) : word;
                    }).join(" ");
                } catch {
                    correctedMessage = message; // typo-js not available — skip
                }
            }
            // ── end of spellcheck ─────────────────────────────

            // ── build CLI args ────────────────────────────────
            // Pass message via a temp context file to avoid Windows
            // command-line length limits and quoting issues.
            const tmpFile = path.join(
                root, "data", "projects", project || "default",
                `.protoai-msg-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
            );

            // Ensure project dir exists
            fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
            fs.writeFileSync(tmpFile, JSON.stringify({ message: correctedMessage }), "utf8");

            const cliArgs = [
                cliScript,
                "--profile", profile || "default",
                "--project", project || "default",
                "--context-file", tmpFile,
            ];
            if (engine) cliArgs.push("--engine", engine);
            if (onChunk) cliArgs.push("--stream");
            // ── end of CLI args ───────────────────────────────

            // ── invoke CLI ────────────────────────────────────
            const env = {
                ...process.env,
                PROTOAI_ROOT: root,
                NODE_PATH: [
                    path.join(root, "node_modules"),
                    path.join(root, "tauri-app", "node_modules"),
                    path.join(__dirname, "..", "node_modules"),
                ].join(path.delimiter),
            };

            let reply = "";
            let errorOutput = "";

            if (onChunk) {
                // ── streaming mode ────────────────────────────
                reply = await new Promise((resolve, reject) => {
                    const child = spawn(nodeExe, cliArgs, {
                        cwd:  root,
                        env,
                        stdio: ["ignore", "pipe", "pipe"]
                    });

                    let fullReply = "";
                    child.stdout.setEncoding("utf8");
                    child.stderr.setEncoding("utf8");

                    child.stdout.on("data", chunk => {
                        const lines = chunk.split("\n");
                        for (const line of lines) {
                            if (line.startsWith("STREAM_CHUNK:")) {
                                const token = line.slice(13);
                                fullReply += token;
                                try { onChunk(token); } catch { /* ignore listener errors */ }
                            } else if (line.trim()) {
                                // Final JSON line
                                fullReply = line.trim() || fullReply;
                            }
                        }
                    });
                    child.stderr.on("data", d => { errorOutput += d; });
                    child.on("close", code => {
                        _cleanup(tmpFile);
                        if (code !== 0 && !fullReply) {
                            reject(new Error(`CLI error or timeout (${errorOutput.slice(0, 500)})`));
                        } else {
                            resolve(fullReply);
                        }
                    });
                    child.on("error", err => { _cleanup(tmpFile); reject(err); });
                });
                // ── end of streaming mode ─────────────────────

            } else {
                // ── sync mode ─────────────────────────────────
                const result = spawnSync(nodeExe, cliArgs, {
                    cwd:      root,
                    env,
                    encoding: "utf8",
                    timeout:  120000,
                });
                _cleanup(tmpFile);

                if (result.error) {
                    return WorkflowResult.error(`CLI spawn error: ${result.error.message}`);
                }

                const stdout = (result.stdout || "").trim();
                errorOutput  = (result.stderr  || "").trim();

                if (!stdout && errorOutput) {
                    return WorkflowResult.error(`CLI error or timeout (${errorOutput.slice(0, 500)})`);
                }
                if (!stdout) {
                    return WorkflowResult.error("CLI returned no output.");
                }

                reply = stdout;
                // ── end of sync mode ──────────────────────────
            }

            if (!reply) {
                return WorkflowResult.error("Engine returned empty reply.");
            }

            // ── save history ──────────────────────────────────
            if (project) {
                _saveHistory(project, message, correctedMessage, reply, profile, engine, spellcheckMode);
            }
            // ── end of save history ───────────────────────────

            return WorkflowResult.ok({ reply, engine, profile, project });

        } catch (err) {
            return WorkflowResult.error(err.message || String(err));
        }
    }
}

// ── helpers ───────────────────────────────────────────────────

function _cleanup(tmpFile) {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch { /* best effort */ }
}

function _saveHistory(project, original, corrected, reply, profile, engine, spellcheckMode) {
    try {
        const historyDir  = path.join(paths.root, "data", "projects", project);
        const historyFile = path.join(historyDir, "history.json");
        fs.mkdirSync(historyDir, { recursive: true });

        let history = [];
        if (fs.existsSync(historyFile)) {
            try { history = JSON.parse(fs.readFileSync(historyFile, "utf8")); }
            catch { history = []; }
        }

        history.push({
            ts:             new Date().toISOString(),
            role:           "user",
            message:        original,
            corrected:      corrected !== original ? corrected : undefined,
            spellcheckMode: spellcheckMode || 0,
            profile:        profile || "default",
            engine:         engine  || "default",
        });
        history.push({
            ts:      new Date().toISOString(),
            role:    "assistant",
            message: reply,
            profile: profile || "default",
            engine:  engine  || "default",
        });

        fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), "utf8");
    } catch (err) {
        console.error("[SendMessageWorkflow] History save failed:", err.message);
    }
}

module.exports = SendMessageWorkflow;
