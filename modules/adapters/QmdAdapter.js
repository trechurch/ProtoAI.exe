// ============================================================
// QmdAdapter — SDOA v3.0 Adapter
// Semantic Search + Indexing (QMD)
// ============================================================

const { Adapter } = require('../base/sdoa-base.js');

class QmdAdapter extends Adapter {

    // ------------------------------------------------------------
    // SDOA v3.0 MANIFEST (embedded, authoritative)
    // ------------------------------------------------------------
    static MANIFEST = {
        id: "QmdAdapter",
        type: "adapter",
        runtime: "NodeJS",
        version: "3.0.0",

        // v1.2 compatibility fields
        capabilities: [
            "semantic.search",
            "semantic.index",
            "workflow.invoke"
        ],

        dependencies: [
            "BackendConnector",
            "BunInstaller"
        ],

        // --------------------------------------------------------
        // v3.0 ACTION SURFACE
        // --------------------------------------------------------
        actions: {
            commands: {
                search: {
                    description: "Perform a semantic search using QMD.",
                    input: { query: "string" },
                    output: "SearchResult[]"
                },
                index: {
                    description: "Index a project folder using QMD.",
                    input: { path: "string" },
                    output: "IndexResult | void"
                }
            },

            triggers: {
                indexingStarted: {
                    description: "Fires when QMD indexing begins.",
                    payload: { path: "string" }
                },
                indexingCompleted: {
                    description: "Fires when QMD indexing completes.",
                    payload: { path: "string" }
                }
            },

            emits: {
                searchExecuted: {
                    description: "Emits after a semantic search is executed.",
                    payload: { query: "string" }
                }
            },

            workflows: {
                search: {
                    description: "Primary semantic search workflow.",
                    input: { query: "string" },
                    output: "SearchResult[]"
                },
                index: {
                    description: "Primary indexing workflow.",
                    input: { path: "string" },
                    output: "IndexResult | void"
                }
            }
        },

        // --------------------------------------------------------
        // v1.2 Docs (kept for backward compatibility)
        // --------------------------------------------------------
        docs: {
            description: "Access layer adapter for QMD semantic search and indexing.",
            input: {
                search: { query: "string" },
                index: { path: "string" }
            },
            output: {
                search: "SearchResult[]",
                index: "IndexResult | void"
            },
            author: "ProtoAI team",
            sdoa_compatibility: `
                SDOA Compatibility Contract:
                - v1.2 Manifest is minimum requirement (Name/Type/Version/Description/Capabilities/Dependencies/Docs).
                - v2.0 may also read sidecars, hot‑reload, version‑CLI.
                - v3.0 may add actions.commands, actions.triggers, actions.emits, actions.workflows.
                - Lower versions MUST ignore unknown/unexpressed fields.
                - Higher versions MUST NOT change meaning of older fields.
                - All versions are backward and forward compatible.
            `
        }
    };

    // ------------------------------------------------------------
    // Semantic Search
    // ------------------------------------------------------------
    async search(query) {
        // v3.0 emit
        this.emit("searchExecuted", { query });

        return await this.registry
            .get("BackendConnector")
            .runWorkflow("qmd_search", { query });
    }

    // ------------------------------------------------------------
    // Indexing
    // ------------------------------------------------------------
    async index(path) {
        // v3.0 triggers
        this.emit("indexingStarted", { path });

        this.bump_minor(`Indexing project at ${path}`);

        const result = await this.registry
            .get("BackendConnector")
            .runWorkflow("qmd_index", { path });

        this.emit("indexingCompleted", { path });

        return result;
    }
}

module.exports = QmdAdapter;
