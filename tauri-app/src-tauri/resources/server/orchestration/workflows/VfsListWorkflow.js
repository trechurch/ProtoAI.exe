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
