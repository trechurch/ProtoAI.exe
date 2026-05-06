// Last modified: 2026-05-04 03:11 UTC
"use strict";

// ============================================================
// CreateProjectWorkflow.js — Create a new ProtoAI project
// version: 1.1.0
// last-modified: 2026-04-24
// ============================================================
// Creates a project directory under the projects root and
// writes a minimal manifest.json.
// NO UI/browser dependencies — Node.js sidecar only.
// ============================================================

const fs   = require("fs-extra");
const path = require("path");
const WorkflowBase   = require("../WorkflowBase");
const WorkflowResult = require("../WorkflowResult");
const paths          = require("../../access/env/paths");

exports.VERSION    = "1.1.0";
exports.getVersion = () => exports.VERSION;

class CreateProjectWorkflow extends WorkflowBase {
    /**
     * @param {Object} payload
     * @param {string} payload.project   - name / slug for the new project (required)
     * @param {string} [payload.template] - optional template label stored in manifest
     */

    static MANIFEST = {
        id:           "CreateProjectWorkflow",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages CreateProjectWorkflow operations.",
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
            const { project, template } = payload || {};

            if (!project || typeof project !== "string" || !project.trim()) {
                return WorkflowResult.error("Missing or invalid 'project' name");
            }

            const slug        = project.trim();
            const projectPath = paths.projectDir(slug);

            // ── 1. Guard: project must not already exist ──────
            if (fs.existsSync(projectPath)) {
                return WorkflowResult.error(`Project "${slug}" already exists`);
            }

            // ── 2. Create directory ───────────────────────────
            fs.mkdirSync(projectPath, { recursive: true });

            // ── 3. Write minimal manifest ─────────────────────
            const manifest = {
                name:      slug,
                type:      "project",
                version:   "1.0.0",
                createdAt: new Date().toISOString(),
                ...(template ? { template } : {}),
            };
            const manifestPath = path.join(projectPath, "manifest.json");
            fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

            // ── 4. Scaffold minimal sub-directories ───────────
            fs.mkdirSync(path.join(projectPath, "vfs"),          { recursive: true });
            fs.mkdirSync(path.join(projectPath, "chat_sessions"), { recursive: true });

            return WorkflowResult.ok({
                project:      slug,
                projectPath,
                manifestPath,
                message:      `Project "${slug}" created successfully`,
            });

        } catch (err) {
            return WorkflowResult.error(err.message || String(err));
        }
    }
}

module.exports = CreateProjectWorkflow;
