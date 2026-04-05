const WorkflowBase = require("./WorkflowBase");
const WorkflowResult = require("./WorkflowResult");
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const paths = require("../access/env/paths");

// SDOA Version
exports.VERSION = "1.0.0";
exports.getVersion = () => exports.VERSION;

/**
 * SendMessageWorkflow
 * --------------------
 * Payload:
 * {
 *   project: "projectName",
 *   profile: "profileId",
 *   engine: "engineName",
 *   message: "User message",
 *   spellcheckMode: 0 | 1 | 2   // 0=local, 1=engine, 2=off
 * }
 */
class SendMessageWorkflow extends WorkflowBase {
  constructor() {
    super();
  }

  async run(payload) {
    try {
      let { project, profile, engine, message, spellcheckMode } = payload;

      if (!message || message.trim() === "") {
        return WorkflowResult.error("Message cannot be empty.");
      }

      if (typeof spellcheckMode !== "number") {
        spellcheckMode = 0; // default: local
      }

      const ipcPath = path.resolve(__dirname, "..", "server-ipc.js");
      if (!fs.existsSync(ipcPath)) {
        return WorkflowResult.error("server-ipc.js not found — EngineBridge cannot communicate.");
      }

      // ---------------- SPELLCHECK ----------------
      const originalMessage = message;
      let correctedMessage = message;

      // 0 = local JS spellcheck
      if (spellcheckMode === 0) {
        try {
          const Typo = require("typo-js");
          const dictionary = new Typo("en_US");
          correctedMessage = message
            .split(/\s+/)
            .map(word => {
              if (!word) return word;
              const clean = word.replace(/[^a-zA-Z']/g, "");
              if (!clean) return word;
              if (dictionary.check(clean)) return word;
              const suggestion = dictionary.suggest(clean)[0];
              if (!suggestion) return word;
              return word.replace(clean, suggestion);
            })
            .join(" ");
        } catch (err) {
          // If typo-js or dictionary is missing, silently fall back
          correctedMessage = originalMessage;
        }
      }

      // 1 = engine-powered spellcheck
      if (spellcheckMode === 1) {
        const spellReq = {
          type: "spellcheck",
          text: correctedMessage,
          engine,
          profile,
          project
        };

        const spellResult = spawnSync("node", [ipcPath], {
          input: JSON.stringify(spellReq),
          encoding: "utf8",
          cwd: paths.root,
          env: { ...process.env, PROTOAI_ROOT: paths.root }
        });

        if (!spellResult.error) {
          const stdout = (spellResult.stdout || "").trim();
          if (stdout) {
            try {
              const parsed = JSON.parse(stdout);
              if (parsed.corrected) {
                correctedMessage = parsed.corrected;
              }
            } catch {
              // ignore parse errors, keep correctedMessage as-is
            }
          }
        }
      }

      // 2 = off → correctedMessage stays as originalMessage

      // ---------------- CHAT CALL ----------------
      const chatReq = {
        type: "chat",
        project,
        profile,
        engine,
        message: correctedMessage
      };

      const chatResult = spawnSync("node", [ipcPath], {
        input: JSON.stringify(chatReq),
        encoding: "utf8",
        cwd: paths.root,
        env: { ...process.env, PROTOAI_ROOT: paths.root }
      });

      if (chatResult.error) {
        return WorkflowResult.error(`IPC error: ${chatResult.error.message}`);
      }

      const chatStdout = (chatResult.stdout || "").trim();
      if (!chatStdout) {
        return WorkflowResult.error("Engine returned no output.");
      }

      let parsedChat;
      try {
        parsedChat = JSON.parse(chatStdout);
      } catch (err) {
        return WorkflowResult.error(`Invalid JSON from engine: ${chatStdout}`);
      }

      if (!parsedChat.reply) {
        return WorkflowResult.error("Engine did not return a reply.");
      }

      const reply = parsedChat.reply;

      // ---------------- HISTORY SAVE ----------------
      if (project) {
        const historyDir = path.resolve(__dirname, "..", "..", "data", "projects", project);
        const historyFile = path.join(historyDir, "history.json");

        if (!fs.existsSync(historyDir)) {
          fs.mkdirSync(historyDir, { recursive: true });
        }

        let history = [];
        if (fs.existsSync(historyFile)) {
          try {
            history = JSON.parse(fs.readFileSync(historyFile, "utf8"));
          } catch {
            history = [];
          }
        }

        history.push({
          ts: new Date().toISOString(),
          role: "user",
          original: originalMessage,
          corrected: correctedMessage,
          spellcheckMode,
          profile: profile || "default",
          engine: engine || "default"
        });

        history.push({
          ts: new Date().toISOString(),
          role: "assistant",
          content: reply,
          profile: profile || "default",
          engine: engine || "default"
        });

        fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), "utf8");
      }

      return WorkflowResult.ok({
        reply,
        engine,
        profile,
        project
      });

    } catch (err) {
      return WorkflowResult.error(err);
    }
  }
}

module.exports = SendMessageWorkflow;
