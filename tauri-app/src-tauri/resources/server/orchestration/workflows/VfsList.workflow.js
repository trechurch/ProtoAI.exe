// Last modified: 2026-05-04 03:11 UTC
"use strict";

// ============================================================
// VfsListWorkflow.js — List VFS entries for a project
// version: 1.0.0
// ============================================================

const WorkflowBase     = require("../WorkflowBase");
const WorkflowResult   = require("../WorkflowResult");
const FsVfsRepository  = require("../../access/fs/FsVfsRepository");

exports.VERSION    = "1.0.0";
exports.getVersion = () => exports.VERSION;

class VfsListWorkflow extends WorkflowBase {

    static MANIFEST = {
        id:           "VfsListWorkflow",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages VfsListWorkflow operations.",
            author: "ProtoAI team",
        },
        actions: {
            commands:  {},
            triggers:  {},
            emits:     {},
            workflows: {},
        },
    };
        async run(payload) {
        try {
            const { project, type } = payload || {};
            if (!project) return WorkflowResult.error("Missing 'project'");

            const repo    = new FsVfsRepository(project);
            let   entries = repo.listEntries();

            if (type) entries = entries.filter(e => e.type === type);

            return WorkflowResult.ok({
                project,
                entries,
                count: entries.length,
            });
        } catch (err) {
            return WorkflowResult.error(err.message || String(err));
        }
    }
}

module.exports = VfsListWorkflow;
