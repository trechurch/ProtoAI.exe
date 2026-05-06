// Last modified: 2026-05-04 03:11 UTC
"use strict";

// ============================================================
// VfsAddWorkflow.js — Add file or folder to VFS
// version: 1.1.0
// NO FILES ARE COPIED. Only a pointer + manifest is stored.
// ============================================================

const fs   = require("fs-extra");
const path = require("path");
const WorkflowBase         = require("../WorkflowBase");
const WorkflowResult       = require("../WorkflowResult");
const FsVfsRepository      = require("../../access/fs/FsVfsRepository");
const VfsManifestExtractor = require("./VfsManifestExtractor");

exports.VERSION    = "1.1.0";
exports.getVersion = () => exports.VERSION;

// ── Windows / macOS system directories to skip entirely ──────
const SKIP_DIRS = new Set([
    "$recycle.bin",
    "$recycler",
    "$sysreset",
    "system volume information",
    "recovery",
    "config.msi",
    "$windows.~bt",
    "$windows.~ws",
    "msocache",
    ".git",
    "node_modules",
    ".svn",
    ".hg",
    // macOS
    ".trashes",
    ".spotlight-v100",
    ".fseventsd",
    ".documentrevisions-v100",
]);

class VfsAddWorkflow extends WorkflowBase {

    static MANIFEST = {
        id:           "VfsAddWorkflow",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages VfsAddWorkflow operations.",
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
            const { project, realPath, permissions, recursive = false } = payload || {};
            if (!project)  return WorkflowResult.error("Missing 'project'");
            if (!realPath) return WorkflowResult.error("Missing 'realPath'");
            if (!fs.existsSync(realPath)) return WorkflowResult.error("Path does not exist: " + realPath);

            const repo    = new FsVfsRepository(project);
            const stat    = fs.statSync(realPath);
            const added   = [];
            const skipped = [];

            if (stat.isDirectory() && recursive) {
                for (const filePath of _walkDir(realPath, skipped)) {
                    try {
                        const entry    = repo.addEntry(filePath, permissions);
                        const manifest = VfsManifestExtractor.extract(filePath, entry.type);
                        manifest.id    = entry.id;
                        repo.saveManifest(entry.id, manifest);
                        added.push({ id: entry.id, realPath: filePath, type: entry.type });
                    } catch (fileErr) {
                        // Skip unreadable / locked files — don't abort the whole batch
                        skipped.push({ path: filePath, reason: fileErr.message });
                        console.warn("[VfsAddWorkflow] Skipping file:", filePath, "—", fileErr.message);
                    }
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
                added,
                skipped,
                count:   added.length,
                project,
                message: `Added ${added.length} item(s) to VFS for project "${project}"` +
                         (skipped.length ? ` (${skipped.length} skipped — permission denied or unreadable)` : ""),
            });
        } catch (err) {
            return WorkflowResult.error(err.message || String(err));
        }
    }
}

// ── _walkDir ──────────────────────────────────────────────────
// Recursively walks dirPath, yielding file paths.
// Silently skips:
//   - Directories in the SKIP_DIRS blocklist
//   - Directories we don't have permission to read (EPERM/EACCES)
//   - Symbolic links (to avoid cycles)
// ─────────────────────────────────────────────────────────────
function _walkDir(dirPath, skipped = []) {
    const results = [];

    let entries;
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (err) {
        // Can't read this directory — log and skip the whole subtree
        if (err.code === "EPERM" || err.code === "EACCES" || err.code === "ENOENT") {
            skipped.push({ path: dirPath, reason: err.message });
            console.warn("[VfsAddWorkflow] Skipping inaccessible dir:", dirPath, "—", err.message);
        } else {
            throw err; // unexpected error — bubble up
        }
        return results;
    }

    for (const e of entries) {
        const full      = path.join(dirPath, e.name);
        const nameLower = e.name.toLowerCase();

        // Skip symlinks — avoid cycles and junction traps
        if (e.isSymbolicLink()) continue;

        if (e.isDirectory()) {
            if (SKIP_DIRS.has(nameLower)) {
                console.warn("[VfsAddWorkflow] Skipping system dir:", full);
                continue;
            }
            results.push(..._walkDir(full, skipped));
        } else if (e.isFile()) {
            results.push(full);
        }
    }

    return results;
}

module.exports = VfsAddWorkflow;
