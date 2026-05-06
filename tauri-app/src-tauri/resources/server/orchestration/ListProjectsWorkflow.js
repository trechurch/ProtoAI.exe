// Last modified: 2026-05-04 03:11 UTC
const fs = require("fs");
const path = require("path");
const paths = require("../access/env/paths");
const WorkflowBase = require("./WorkflowBase");
const WorkflowResult = require("./WorkflowResult");

class ListProjectsWorkflow extends WorkflowBase {

    static MANIFEST = {
        id:           "ListProjectsWorkflow",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages ListProjectsWorkflow operations.",
            author: "ProtoAI team",
        },
        actions: {
            commands:  {},
            triggers:  {},
            emits:     {},
            workflows: {},
        },
    };

    async run() {
        try {
            const dataRoot = paths.projects();
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
