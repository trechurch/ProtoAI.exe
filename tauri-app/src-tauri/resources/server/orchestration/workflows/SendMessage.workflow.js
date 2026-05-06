// Last modified: 2026-05-04 03:11 UTC
const { spawn, exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const WorkflowResult = require("../WorkflowResult");
const paths = require("../../access/env/paths");
const FsProjectRepository = require("../../access/fs/FsProjectRepository");
const FileContextWorkflow = require("./FileContext.workflow");

class SendMessageWorkflow {

    static MANIFEST = {
        id:           "SendMessageWorkflow",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages SendMessageWorkflow operations.",
            author: "ProtoAI team",
        },
        actions: {
            commands:  {},
            triggers:  {},
            emits:     {},
            workflows: {},
        },
    };
      constructor() {
    this.projectRepo = new FsProjectRepository();
  }

  async run(context) {
    const { project, profile, message, streamId, onChunk } = context;

    // Resolve file context via FileContextWorkflow server-side
    const fileContextWorkflow = new FileContextWorkflow();
    const fileContextResult = await fileContextWorkflow.run({ project, message });

    let fileContext = "";
    let escalatedFiles = [];
    if (fileContextResult.status === "ok") {
      fileContext = fileContextResult.data.context || "";
      escalatedFiles = fileContextResult.data.escalatedFiles || [];
    }

    // Write context + message to temp file
    const projectDir = paths.projectDir(project);
    fs.mkdirSync(projectDir, { recursive: true }); // ensure dir exists
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tmpFile = path.join(projectDir, `.protoai-msg-${uniqueId}.tmp`);
    fs.writeFileSync(tmpFile, JSON.stringify({ fileContext, message }), "utf8");

    const cliPath = paths.cli("claude-select.cmd");

    let reply;
    try {
      reply = await new Promise((resolve, reject) => {
        if (onChunk) {
          // Streaming: use spawn so we can read stdout line-by-line as chunks arrive
          const child = spawn(cliPath, [
            "--profile", profile,
            "--project", project,
            "--context-file", tmpFile,
            "--stream",
          ], {
            timeout: 120000,
            cwd: paths.root,
            env: { ...process.env, PROTOAI_ROOT: paths.root },
            shell: true,
          });

          let lineBuf = "";
          let stderrBuf = "";
          let chunkCount = 0;

          child.stdout.on("data", chunk => {
            const lines = (lineBuf + chunk.toString()).split("\n");
            lineBuf = lines.pop(); // keep incomplete last line
            for (const line of lines) {
              if (line.startsWith("STREAM_CHUNK:")) {
                chunkCount++;
                onChunk(line.slice(13));
              }
            }
          });

          child.stderr.on("data", chunk => { stderrBuf += chunk.toString(); });
          child.on("error", err => reject(err));
          child.on("close", (code) => {
            if (code !== 0 && chunkCount === 0) {
              const detail = stderrBuf.trim() || `CLI exited with code ${code}`;
              return reject(new Error(`CLI error (exit ${code})\n${detail}`));
            }
            resolve("__streaming_done__");
          });

        } else {
          // Non-streaming: exec is simplest and most reliable on Windows .cmd files
          const cmd = `"${cliPath}" --profile "${profile}" --project "${project}" --context-file "${tmpFile}"`;
          exec(cmd, {
            timeout: 120000,
            cwd: paths.root,
            env: { ...process.env, PROTOAI_ROOT: paths.root },
          }, (err, stdout, stderr) => {
            if (err) return reject(new Error(`${err.message || "CLI timeout"}\n${(stderr || "").trim()}`.trim()));
            const out = (stdout || "").trim();
            if (!out && stderr?.trim()) return reject(new Error(`CLI returned no output but had stderr:\n${stderr.trim()}`));
            resolve(out);
          });
        }
      });
    } catch (err) {
      return new WorkflowResult("error", {
        error: "CLI error or timeout",
        detail: String(err)
      });
    } finally {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
    }

    // In streaming mode, the full reply was assembled in the caller from chunks
    if (reply === "__streaming_done__") {
      return new WorkflowResult("ok", { reply: "", project, profile, streaming: true });
    }

    if (!reply) {
      return new WorkflowResult("error", {
        error: "Empty response from LLM",
        detail: "CLI returned no stdout output. Check: (1) API key in settings, (2) model exists in profile config, (3) OpenRouter connectivity"
      });
    }

    return new WorkflowResult("ok", {
      reply,
      project,
      profile,
      fileContextInfo: {
        filesIncluded: fileContextResult.data.files || {},
        filesEscalated: escalatedFiles,
        totalBytes: fileContextResult.data.totalBytes || 0
      }
    });
  }
}

module.exports = SendMessageWorkflow;