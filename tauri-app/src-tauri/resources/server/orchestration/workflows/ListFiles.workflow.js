// Last modified: 2026-05-04 03:11 UTC
"use strict";

// ============================================================
// ListFilesWorkflow.js — List directory contents
// version: 1.1.0
// ============================================================
// Extended to support listing ANY real path on disk (for VFS
// file picker), not just paths within the project directory.
// ============================================================

const path   = require("path");
const fs     = require("fs-extra");
const paths  = require("../../access/env/paths");
const WorkflowResult = require("../WorkflowResult");

exports.VERSION    = "1.1.0";
exports.getVersion = () => exports.VERSION;

class ListFilesWorkflow {

    static MANIFEST = {
        id:           "ListFilesWorkflow",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages ListFilesWorkflow operations.",
            author: "ProtoAI team",
        },
        actions: {
            commands:  {},
            triggers:  {},
            emits:     {},
            workflows: {},
        },
    };
        async run(context) {
        const { project, path: folderPath = "", realPath } = context || {};

        // ── mode: real path (VFS file picker) ────────────────
        // If realPath is provided, list that directory directly.
        // No project scoping — this is for the native file picker.
        if (realPath) {
            return this._listRealPath(realPath);
        }

        // ── mode: project-relative (legacy) ──────────────────
        if (!project) {
            return new WorkflowResult("error", { error: "Missing 'project' or 'realPath'" });
        }
        const projectDir = paths.projectDir(project);
        const targetPath = folderPath ? path.join(projectDir, folderPath) : projectDir;
        return this._listRealPath(targetPath, folderPath, projectDir);
    }

    async _listRealPath(targetPath, relativeTo = "", projectDir = null) {
        if (!fs.existsSync(targetPath)) {
            return new WorkflowResult("ok", {
                files: [], folders: [], currentPath: targetPath,
                parentPath: path.dirname(targetPath), totalFiles: 0, totalFolders: 0
            });
        }

        try {
            const items   = await fs.readdir(targetPath, { withFileTypes: true });
            const files   = [];
            const folders = [];

            for (const item of items) {
                const fullPath     = path.join(targetPath, item.name);
                const relativePath = relativeTo ? path.join(relativeTo, item.name) : fullPath;

                // Skip internal ProtoAI temp files
                if (item.name.startsWith(".protoai-")) continue;

                const stat = _safeStat(fullPath);

                if (item.isDirectory()) {
                    folders.push({
                        name:     item.name,
                        path:     relativePath,
                        realPath: fullPath,
                        type:     "directory",
                        modified: stat?.mtime.toISOString() || null,
                        icon:     "folder",
                    });
                } else if (item.isFile()) {
                    files.push({
                        name:     item.name,
                        path:     relativePath,
                        realPath: fullPath,
                        type:     "file",
                        size:     stat?.size || 0,
                        modified: stat?.mtime.toISOString() || null,
                        ext:      path.extname(item.name).toLowerCase(),
                        icon:     _fileIcon(item.name),
                    });
                }
            }

            folders.sort((a, b) => a.name.localeCompare(b.name));
            files.sort((a, b)   => a.name.localeCompare(b.name));

            return new WorkflowResult("ok", {
                files,
                folders,
                currentPath:  targetPath,
                parentPath:   path.dirname(targetPath),
                totalFiles:   files.length,
                totalFolders: folders.length,
            });
        } catch (err) {
            return new WorkflowResult("error", { error: "Failed to read directory: " + err.message });
        }
    }
}

function _safeStat(p) {
    try { return fs.statSync(p); } catch { return null; }
}

function _fileIcon(fileName) {
    const ext = path.extname(fileName).toLowerCase().slice(1);
    const map = {
        js: "code", ts: "code", jsx: "code", tsx: "code", py: "code",
        rs: "code", go: "code", java: "code", cpp: "code", c: "code",
        cs: "code", rb: "code", sh: "code", html: "code", css: "code",
        json: "data", csv: "data", xml: "data", yaml: "data", yml: "data",
        md: "document", txt: "document", pdf: "document", docx: "document",
        jpg: "image", jpeg: "image", png: "image", gif: "image", svg: "image",
        mp3: "audio", wav: "audio", flac: "audio",
        mp4: "video", mov: "video", avi: "video",
        zip: "archive", rar: "archive", tar: "archive", gz: "archive",
    };
    return map[ext] || "file";
}

module.exports = ListFilesWorkflow;
