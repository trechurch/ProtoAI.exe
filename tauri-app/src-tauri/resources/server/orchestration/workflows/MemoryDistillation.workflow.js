// ============================================================
// MemoryDistillation.workflow.js — SDOA v4.0 Workflow
// ============================================================
"use strict";

const WorkflowBase = require("../WorkflowBase");
const WorkflowResult = require("../WorkflowResult");
const MemoryManager = require("../../lib/MemoryManager");

class MemoryDistillationWorkflow extends WorkflowBase {
    static MANIFEST = {
        id: "MemoryDistillationWorkflow",
        type: "service",
        runtime: "NodeJS",
        version: "1.0.0",
        capabilities: ["memory.distill"],
        docs: {
            description: "Triggers the 9-stage memory distillation pipeline for a specific memory class.",
            input: {
                type: "identity | project | wisdom",
                target: "string (e.g. project name)"
            },
            output: "object containing before/after diff"
        }
    };

    async run(context) {
        const { type, target } = context;

        if (!type) {
            return WorkflowResult.error("Memory type (identity|project|wisdom) is required");
        }

        try {
            const result = await MemoryManager.distill(type, target);
            
            if (!result.ok) {
                return WorkflowResult.error(result.error);
            }

            return WorkflowResult.ok({
                message: "Distillation complete",
                type: result.type,
                target: result.target,
                diff: {
                    before: result.before.content,
                    after: result.after.content
                }
            });
        } catch (err) {
            return WorkflowResult.error(`Distillation failed: ${err.message}`);
        }
    }
}

module.exports = MemoryDistillationWorkflow;
