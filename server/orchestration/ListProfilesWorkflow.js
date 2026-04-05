const fs = require("fs");
const path = require("path");
const WorkflowBase = require("./WorkflowBase");
const WorkflowResult = require("./WorkflowResult");

// SDOA Version
exports.VERSION = "1.0.0";
exports.getVersion = () => exports.VERSION;

class ListProfilesWorkflow extends WorkflowBase {
  async run() {
    try {
      const profilesFile = path.resolve(__dirname, "..", "..", "data", "profiles.json");

      if (!fs.existsSync(profilesFile)) {
        return WorkflowResult.ok({
          profiles: [{ id: "default", name: "Default" }]
        });
      }

      const raw = fs.readFileSync(profilesFile, "utf8");
      const profiles = JSON.parse(raw);

      return WorkflowResult.ok({ profiles });
    } catch (err) {
      return WorkflowResult.error(err);
    }
  }
}

module.exports = ListProfilesWorkflow;
