const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const WorkflowResult = require("../WorkflowResult");
const paths = require("../../access/env/paths");
const FsProjectRepository = require("../../access/fs/FsProjectRepository");
const FileContextWorkflow = require("./FileContextWorkflow");

class SendMessageWorkflow {
  constructor() {
    this.projectRepo = new FsProjectRepository();
  }

  async run(context) {
    const { project, profile, message } = context;

    // Resolve file context via FileContextWorkflow server-side
    // This handles permissions, tiers, auto-escalation of imports, and context caching
    const fileContextWorkflow = new FileContextWorkflow();
    const fileContextResult = await fileContextWorkflow.run({ project, message });

    let fileContext = "";
    let escalatedFiles = [];
    if (fileContextResult.status === "ok") {
      fileContext = fileContextResult.data.context || "";
      escalatedFiles = fileContextResult.data.escalatedFiles || [];
    }

    // Write context + message to temp file — the only data the CLI receives
    const projectDir = paths.projectDir(project);
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tmpFile = path.join(projectDir, `.protoai-msg-${uniqueId}.tmp`);
    fs.writeFileSync(tmpFile, JSON.stringify({ fileContext, message }), "utf8");

    const cliPath = paths.cli("claude-select.cmd");
    const cmd = `"${cliPath}" --profile "${profile}" --project "${project}" --context-file "${tmpFile}"`;

    let reply;
    try {
      reply = await new Promise((resolve, reject) => {
        exec(cmd, {
          timeout: 120000,
          cwd: paths.root,
          env: { ...process.env, PROTOAI_ROOT: paths.root }
        }, (err, stdout, stderr) => {
          if (err) return reject(new Error(`${err.message || "CLI timeout"}\n${(stderr || "").trim()}`.trim()));
          const out = (stdout || "").trim();
          const errLog = (stderr || "").trim();
          if (!out && errLog) return reject(new Error(`CLI returned no output but had stderr:\n${errLog}`));
          resolve(out);
        });
      });
    } catch (err) {
      return new WorkflowResult("error", {
        error: "CLI error or timeout",
        detail: String(err)
      });
    } finally {
      try { fs.unlinkSync(tmpFile); } catch (_) {}
    }

    if (!reply) {
      return new WorkflowResult("error", {
        error: "Empty response from LLM",
        detail: "CLI returned no stdout output. Check: (1) API key in secret.key, (2) model exists in profile config, (3) OpenRouter connectivity"
      });
    }

    // Save history
    this.projectRepo.appendToHistory(project, {
      timestamp: Date.now(),
      role: "user",
      message
    });

    this.projectRepo.appendToHistory(project, {
      timestamp: Date.now(),
      role: "assistant",
      message: reply || "(empty response)"
    });

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
