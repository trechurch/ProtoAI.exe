"use strict";

// ============================================================
// VfsManifestWorkflow.js — Get or refresh a VFS manifest
// version: 1.0.0
// ============================================================

const WorkflowBase         = require("../WorkflowBase");
const WorkflowResult       = require("../WorkflowResult");
const FsVfsRepository      = require("../../access/fs/FsVfsRepository");
const VfsManifestExtractor = require("./VfsManifestExtractor");

exports.VERSION    = "1.0.0";
exports.getVersion = () => exports.VERSION;

class VfsManifestWorkflow extends WorkflowBase {
    async run(payload) {
        try {
            const { project, id, refresh = false } = payload || {};
            if (!project) return WorkflowResult.error("Missing 'project'");
            if (!id)      return WorkflowResult.error("Missing 'id'");

            const repo  = new FsVfsRepository(project);
            const entry = repo.getEntry(id);
            if (!entry) return WorkflowResult.error("VFS entry not found: " + id);

            let manifest = repo.loadManifest(id);

            // Re-extract if missing or refresh requested
            if (!manifest || refresh) {
                manifest    = VfsManifestExtractor.extract(entry.realPath, entry.type);
                manifest.id = id;
                repo.saveManifest(id, manifest);
            }

            return WorkflowResult.ok({ entry, manifest });
        } catch (err) {
            return WorkflowResult.error(err.message || String(err));
        }
    }
}

module.exports = VfsManifestWorkflow;
