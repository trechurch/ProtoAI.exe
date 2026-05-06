// Last modified: 2026-05-04 03:11 UTC
"use strict";

// ============================================================
// SearchHistoryWorkflow.js — Search chat history
// version: 1.0.0
// ============================================================
// Searches all history.json files for a project.
// Returns matching turns with context snippets.
// Supports case-insensitive substring search.
// ============================================================

const fs   = require("fs");
const path = require("path");
const WorkflowBase   = require("../WorkflowBase");
const WorkflowResult = require("../WorkflowResult");
const paths          = require("../../access/env/paths");

exports.VERSION    = "1.0.0";
exports.getVersion = () => exports.VERSION;

class SearchHistoryWorkflow extends WorkflowBase {

    static MANIFEST = {
        id:           "SearchHistoryWorkflow",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages SearchHistoryWorkflow operations.",
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
            const { project, query, limit = 50, allProjects = false } = payload || {};

            if (!query || !query.trim()) {
                return WorkflowResult.error("Missing 'query'");
            }

            const needle   = query.trim().toLowerCase();
            const results  = [];
            const projects = allProjects
                ? _listProjects()
                : (project ? [project] : []);

            if (projects.length === 0) {
                return WorkflowResult.ok({ results: [], count: 0, query });
            }

            for (const proj of projects) {
                const historyFile = path.join(paths.projectDir(proj), "history.json");
                if (!fs.existsSync(historyFile)) continue;

                let history = [];
                try {
                    history = JSON.parse(fs.readFileSync(historyFile, "utf8"));
                } catch { continue; }

                if (!Array.isArray(history)) continue;

                history.forEach((entry, idx) => {
                    const text = entry.message || entry.content || entry.corrected || "";
                    if (!text.toLowerCase().includes(needle)) return;

                    // Build context snippet around the match
                    const matchIdx = text.toLowerCase().indexOf(needle);
                    const start    = Math.max(0, matchIdx - 60);
                    const end      = Math.min(text.length, matchIdx + query.length + 60);
                    const snippet  = (start > 0 ? "…" : "") +
                                     text.slice(start, end) +
                                     (end < text.length ? "…" : "");

                    results.push({
                        project,
                        role:    entry.role || "unknown",
                        message: text,
                        snippet,
                        ts:      entry.ts || entry.timestamp || null,
                        idx,
                        matchOffset: matchIdx,
                    });

                    if (results.length >= limit) return;
                });

                if (results.length >= limit) break;
            }

            // Sort by most recent first
            results.sort((a, b) => {
                if (!a.ts && !b.ts) return 0;
                if (!a.ts) return 1;
                if (!b.ts) return -1;
                return new Date(b.ts) - new Date(a.ts);
            });

            return WorkflowResult.ok({
                results: results.slice(0, limit),
                count:   results.length,
                query,
            });

        } catch (err) {
            return WorkflowResult.error(err.message || String(err));
        }
    }
}

function _listProjects() {
    try {
        const dir = paths.projects();
        return fs.readdirSync(dir).filter(name => {
            try { return fs.statSync(path.join(dir, name)).isDirectory(); }
            catch { return false; }
        });
    } catch { return []; }
}

module.exports = SearchHistoryWorkflow;
