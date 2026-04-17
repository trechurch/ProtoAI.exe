const fs = require("fs");
const path = require("path");
const WorkflowBase = require("./WorkflowBase");
const WorkflowResult = require("./WorkflowResult");

// SDOA Version
exports.VERSION = "1.0.0";
exports.getVersion = () => exports.VERSION;

class LoadProjectHistoryWorkflow extends WorkflowBase {
  async run(payload) {
    try {
      const { project } = payload;
      if (!project) {
        return WorkflowResult.ok({ history: [] });
      }

      const historyFile = path.resolve(
        __dirname,
        "..",
        "..",
        "data",
        "projects",
        project,
        "history.json"
      );

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
