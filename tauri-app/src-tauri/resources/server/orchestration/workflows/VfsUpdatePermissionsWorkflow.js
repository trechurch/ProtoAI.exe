"use strict";

// ============================================================
// VfsUpdatePermissionsWorkflow.js — Update VFS entry permissions
// version: 1.0.0
// ============================================================

const WorkflowBase    = require("../WorkflowBase");
const WorkflowResult  = require("../WorkflowResult");
const FsVfsRepository = require("../../access/fs/FsVfsRepository");

exports.VERSION    = "1.0.0";
exports.getVersion = () => exports.VERSION;

class VfsUpdatePermissionsWorkflow extends WorkflowBase {
    async run(payload) {
        try {
            const { project, id, permissions } = payload || {};
            if (!project)     return WorkflowResult.error("Missing 'project'");
            if (!id)          return WorkflowResult.error("Missing 'id'");
            if (!permissions) return WorkflowResult.error("Missing 'permissions'");

            const repo  = new FsVfsRepository(project);
            const entry = repo.getEntry(id);
            if (!entry) return WorkflowResult.error("VFS entry not found: " + id);

            const updated = repo.updatePermissions(id, {
                read:    permissions.read    ?? entry.permissions.read,
                write:   permissions.write   ?? entry.permissions.write,
                execute: permissions.execute ?? entry.permissions.execute,
            });

            return WorkflowResult.ok({
                id,
                permissions: updated.permissions,
                message: "Permissions updated for: " + entry.realPath,
            });
        } catch (err) {
            return WorkflowResult.error(err.message || String(err));
        }
    }
}

module.exports = VfsUpdatePermissionsWorkflow;
