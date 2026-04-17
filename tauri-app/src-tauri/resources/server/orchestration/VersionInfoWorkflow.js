const WorkflowBase = require("./WorkflowBase");
const WorkflowResult = require("./WorkflowResult");
const registry = require("./WorkflowRegistryInstance");

// SDOA Version
exports.VERSION = "1.0.0";
exports.getVersion = () => exports.VERSION;

class VersionInfoWorkflow extends WorkflowBase {
  async run() {
    try {
      const workflows = registry.list().map(name => {
        const WorkflowClass = require(`./${name}`);
        const version = WorkflowClass.VERSION || "unknown";
        return { name, version };
      });

      return WorkflowResult.ok({
        sdoaVersion: exports.VERSION,
        workflows
      });
    } catch (err) {
      return WorkflowResult.error(err);
    }
  }
}

module.exports = VersionInfoWorkflow;
