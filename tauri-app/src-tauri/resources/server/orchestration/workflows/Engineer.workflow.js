// ============================================================
// Engineer.workflow.js — SDOA v4 Workflow
// ============================================================
"use strict";

const WorkflowBase = require("../WorkflowBase");
const WorkflowResult = require("../WorkflowResult");
const orchestrator = require("./MultiModelOrchestrator");

class EngineerWorkflow extends WorkflowBase {
    static MANIFEST = {
        id: "EngineerWorkflow",
        type: "service",
        runtime: "NodeJS",
        version: "1.0.0",
        capabilities: ["orchestrator.engineer"],
        dependencies: ["MultiModelOrchestrator"],
        docs: {
            description: "Rewrites a prompt for optimal performance using the local model.",
            input: { message: "string" },
            output: "{ prompt: string, original: string }"
        }
    };

    async run(context) {
        const { message } = context;
        if (!message) return new WorkflowResult("error", null, "Message is required");

        try {
            const result = await orchestrator.engineer(message);
            return new WorkflowResult("ok", { prompt: result.prompt, original: result.original });
        } catch (err) {
            return new WorkflowResult("error", null, err.message);
        }
    }
}

module.exports = EngineerWorkflow;
