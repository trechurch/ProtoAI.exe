// Last modified: 2026-05-04 03:11 UTC
// SDOA Version
exports.VERSION = "1.0.0";
exports.getVersion = () => exports.VERSION;

const path = require("path");
const minimist = require("minimist");
const registry = require("./orchestration/WorkflowRegistryInstance");

// SDOA v3.0 MANIFEST
const MANIFEST = {
    id:           "tauri-entry",
    type:         "utility",
    runtime:      "NodeJS",
    version:      "1.0.0",
    capabilities: [],
    dependencies: [],
    docs: {
        description: "tauri-entry utilities and exports.",
        author: "ProtoAI team",
    },
    actions: {
        commands:  {},
        triggers:  {},
        emits:     {},
        workflows: {},
    },
};

const { registerAllWorkflows } = require("./orchestration/registerWorkflows");

registerAllWorkflows();

async function main() {
  try {
    const args = minimist(process.argv.slice(2));
    const name = args.workflow;
    const payloadRaw = args.payload || "{}";

    if (!name) {
      throw new Error("Missing --workflow");
    }

    const payload = JSON.parse(payloadRaw);
    const workflow = registry.get(name);
    const result = await workflow.run(payload);

    if (result.status === "error") {
      console.error(result.error || "Unknown workflow error");
      process.exit(1);
    }

    console.log(JSON.stringify(result.data || {}));
  } catch (err) {
    console.error(err.message || String(err));
    process.exit(1);
  }
}

main();
