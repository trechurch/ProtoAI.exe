const fs = require("fs");
const path = require("path");
const WorkflowBase = require("./WorkflowBase");
const WorkflowResult = require("./WorkflowResult");

// SDOA Version
exports.VERSION = "1.0.0";
exports.getVersion = () => exports.VERSION;

class ListProjectsWorkflow extends WorkflowBase {
  async run() {
    try {
      const dataRoot = path.resolve(__dirname, "..", "..", "data", "projects");
      if (!fs.existsSync(dataRoot)) {
        return WorkflowResult.ok({ projects: [] });
      }

      const entries = fs.readdirSync(dataRoot, { withFileTypes: true });
      const projects = entries
        .filter(e => e.isDirectory())
        .map(e => ({ id: e.name, name: e.name }));

      return WorkflowResult.ok({ projects });
    } catch (err) {
      return WorkflowResult.error(err);
    }
  }
}

module.exports = ListProjectsWorkflow;
