// Last modified: 2026-05-02 10:00 UTC
const MANIFEST = {
    id:           "SendMessageWorkflow",
    type:         "utility",
    runtime:      "NodeJS",
    version:      "1.0.0",
    capabilities: [],
    dependencies: [],
    docs: {
        description: "SendMessageWorkflow utilities and exports.",
        author: "ProtoAI team",
    },
    actions: {
        commands:  {},
        triggers:  {},
        emits:     {},
        workflows: {},
    },
};


// This file is intentionally a stub — the canonical SendMessageWorkflow
// is at orchestration/workflows/SendMessageWorkflow.js
// Re-export it so any legacy require("./orchestration/SendMessageWorkflow") still works.
module.exports = require("./workflows/SendMessageWorkflow");

module.exports.MANIFEST = MANIFEST;
