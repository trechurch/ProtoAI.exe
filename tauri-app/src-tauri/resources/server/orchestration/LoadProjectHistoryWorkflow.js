// Last modified: 2026-05-04 03:11 UTC
const fs = require("fs");
const WorkflowBase = require("./WorkflowBase");
const WorkflowResult = require("./WorkflowResult");
const paths = require("../access/env/paths");

// SDOA Version
exports.VERSION = "1.0.1";
exports.getVersion = () => exports.VERSION;

class LoadProjectHistoryWorkflow extends WorkflowBase {

    static MANIFEST = {
        id:           "LoadProjectHistoryWorkflow",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages LoadProjectHistoryWorkflow operations.",
            author: "ProtoAI team",
        },
        actions: {
            commands:  {},
            triggers:  {},
            emits:     {},
            workflows: {},
        },
    };
      async run(payload) {
    try {
      const { project } = payload;
      if (!project) {
        return WorkflowResult.ok({ history: [] });
      }

      // FIX v1.0.1: Use paths.root (PROTOAI_ROOT) instead of __dirname-relative path.
      // __dirname/../.. resolves to resources/, not the repo root where data/ lives.
      const historyFile = paths.projects(project, "history.json");

      if (!fs.existsSync(historyFile)) {
        return WorkflowResult.ok({ history: [] });
      }

      const raw = fs.readFileSync(historyFile, "utf8");
      const history = JSON.parse(raw);

      return WorkflowResult.ok({ history });
    } catch (err) {
      return WorkflowResult.error(err);
    }
  }
}

module.exports = LoadProjectHistoryWorkflow;
