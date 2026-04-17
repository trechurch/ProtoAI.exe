"use strict";

// ============================================================
// VfsAddWorkflow.js — Add file or folder to VFS
// version: 1.0.0
// NO FILES ARE COPIED. Only a pointer + manifest is stored.
// ============================================================

const fs   = require("fs-extra");
const path = require("path");
const WorkflowBase         = require("../WorkflowBase");
const WorkflowResult       = require("../WorkflowResult");
const FsVfsRepository      = require("../../access/fs/FsVfsRepository");
const VfsManifestExtractor = require("./VfsManifestExtractor");

exports.VERSION    = "1.0.0";
exports.getVersion = () => exports.VERSION;

class VfsAddWorkflow extends WorkflowBase {
    async run(payload) {
        try {
            const { project, realPath, permissions, recursive = false } = payload || {};
            if (!project)  return WorkflowResult.error("Missing 'project'");
            if (!realPath) return WorkflowResult.error("Missing 'realPath'");
            if (!fs.existsSync(realPath)) return WorkflowResult.error("Path does not exist: " + realPath);

            const repo  = new FsVfsRepository(project);
            const stat  = fs.statSync(realPath);
            const added = [];

            if (stat.isDirectory() && recursive) {
                for (const filePath of _walkDir(realPath)) {
                    const entry    = repo.addEntry(filePath, permissions);
                    const manifest = VfsManifestExtractor.extract(filePath, entry.type);
                    manifest.id    = entry.id;
                    repo.saveManifest(entry.id, manifest);
                    added.push({ id: entry.id, realPath: filePath, type: entry.type });
                }
            } else if (stat.isDirectory()) {
                const entry = repo.addEntry(realPath, permissions);
                repo.updateEntry(entry.id, { type: "directory" });
                added.push({ id: entry.id, realPath, type: "directory" });
            } else {
                const entry    = repo.addEntry(realPath, permissions);
                const manifest = VfsManifestExtractor.extract(realPath, entry.type);
                manifest.id    = entry.id;
                repo.saveManifest(entry.id, manifest);
                added.push({ id: entry.id, realPath, type: entry.type });
            }

            return WorkflowResult.ok({
                added, count: added.length, project,
                message: "Added " + added.length + " item(s) to VFS for project \"" + project + "\""
            });
        } catch (err) {
            return WorkflowResult.error(err.message || String(err));
        }
    }
}

function _walkDir(dirPath) {
    const results = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
        const full = path.join(dirPath, e.name);
        if (e.isDirectory()) results.push(..._walkDir(full));
        else if (e.isFile()) results.push(full);
    }
    return results;
}

module.exports = VfsAddWorkflow;
