// ============================================================
// PartnerCommentary.workflow.js — SDOA v4 Workflow
// ============================================================
"use strict";

const WorkflowBase = require("../WorkflowBase");
const WorkflowResult = require("../WorkflowResult");
const orchestrator = require("./MultiModelOrchestrator");

class PartnerCommentaryWorkflow extends WorkflowBase {
    static MANIFEST = {
        id: "PartnerCommentaryWorkflow",
        type: "service",
        runtime: "NodeJS",
        version: "1.0.0",
        capabilities: ["partner.commentary"],
        dependencies: ["MultiModelOrchestrator"],
        docs: {
            description: "Generates side-channel commentary from the Silent Partner.",
            input: {
                message: "string",
                response: "string",
                persona: "string?"
            },
            output: "string"
        }
    };

    async run(context) {
        const { message, response, persona = "advisor" } = context;
        
        try {
            const result = await orchestrator.commentary(message, response, persona);
            return new WorkflowResult("ok", { text: result.text, persona: result.persona });
        } catch (err) {
            return new WorkflowResult("error", { error: err.message });
        }
    }
}

module.exports = PartnerCommentaryWorkflow;
