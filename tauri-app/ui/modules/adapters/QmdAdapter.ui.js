// ============================================================
// QmdAdapter.ui.js — UI Adapter (Browser-Safe)
// version: 3.0.0
// depends: tauri-utils.js, BackendConnector.ui.js
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    // ── QmdAdapter.ui ────────────────────────────────────────
    // Browser-safe UI adapter for QMD semantic search and
    // indexing. Mirrors QmdAdapter.js (backend) public surface
    // but delegates all execution to BackendConnector.ui via
    // window.backendConnector.runWorkflow().
    // Never uses require(). Never calls Tauri directly.
    // ── end of QmdAdapter.ui ─────────────────────────────────

    class QmdAdapter {

        // ── SDOA v3.0 MANIFEST ───────────────────────────────
        static MANIFEST = {
            id:      "QmdAdapter.ui",
            type:    "adapter",
            runtime: "Browser",
            version: "3.0.0",

            // v1.2 fields — always present, never removed
            capabilities: [
                "semantic.search",
                "semantic.index",
                "workflow.invoke"
            ],
            dependencies: [
                "tauri-utils.js",
                "BackendConnector.ui.js"
            ],
            docs: {
                description: "Browser-safe QMD adapter. Routes semantic search and indexing requests through BackendConnector.ui to the Tauri backend.",
                input: {
                    search: { query: "string" },
                    index:  { path: "string" }
                },
                output: {
                    search: "SearchResult[]",
                    index:  "IndexResult | void"
                },
                author: "ProtoAI team",
                sdoa_compatibility: `
                    SDOA Compatibility Contract:
                    - v1.2 Manifest is minimum requirement (Name/Type/Version/Description/Capabilities/Dependencies/Docs).
                    - v2.0 may also read sidecars, hot-reload, version-CLI.
                    - v3.0+ may add actions.commands, actions.triggers, actions.emits, actions.workflows.
                    - Lower versions MUST ignore unknown/unexpressed fields.
                    - Higher versions MUST NOT change meaning of older fields.
                    - All versions are backward and forward compatible.
                `
            },

            // v3.0 action surface — additive only
            actions: {
                commands: {
                    search: {
                        description: "Perform a semantic search using QMD.",
                        input:  { query: "string" },
                        output: "SearchResult[]"
                    },
                    index: {
                        description: "Index a project folder using QMD.",
                        input:  { path: "string" },
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
                        payload: { query: "string", resultCount: "number" }
                    },
                    indexingFailed: {
                        description: "Emits when an indexing attempt fails.",
                        payload: { path: "string", error: "string" }
                    }
                },
                workflows: {
                    search: {
                        description: "Primary semantic search workflow.",
                        input:  { query: "string" },
                        output: "SearchResult[]"
                    },
                    index: {
                        description: "Primary indexing workflow.",
                        input:  { path: "string" },
                        output: "IndexResult | void"
                    }
                }
            }
        };
        // ── end of SDOA v3.0 MANIFEST ────────────────────────

        constructor() {
            this.listeners = [];
        }

        // ── event emitter ────────────────────────────────────

        on(event, handler) {
            this.listeners.push({ event, handler });
        }

        off(event, handler) {
            this.listeners = this.listeners.filter(
                l => !(l.event === event && l.handler === handler)
            );
        }

        emit(event, data) {
            for (const l of this.listeners) {
                if (l.event === event) {
                    try { l.handler(data); } catch (e) {
                        console.error(`[QmdAdapter.ui] Listener error (${event}):`, e);
                    }
                }
            }
        }

        // ── end of event emitter ─────────────────────────────

        // ── _connector ───────────────────────────────────────
        // Lazy accessor for BackendConnector.ui instance.
        // ── end of _connector ────────────────────────────────

        get _connector() {
            if (!window.backendConnector) {
                throw new Error("[QmdAdapter.ui] BackendConnector.ui not initialized.");
            }
            return window.backendConnector;
        }

        // ── search ───────────────────────────────────────────
        // Executes a semantic search via QMD backend workflow.
        // Emits searchExecuted with query and result count.
        // Returns empty array on failure so callers don't crash.
        // ── end of search ────────────────────────────────────

        async search(query) {
            if (!query || !query.trim()) {
                console.warn("[QmdAdapter.ui] search() called with empty query.");
                return [];
            }

            try {
                const results = await this._connector.runWorkflow(
                    "qmd_search", { query }
                );

                const resultArray = Array.isArray(results) ? results : [];
                this.emit("searchExecuted", { query, resultCount: resultArray.length });
                return resultArray;

            } catch (err) {
                console.error("[QmdAdapter.ui] search failed:", err);
                this.emit("searchExecuted", { query, resultCount: 0 });
                return [];
            }
        }

        // ── index ────────────────────────────────────────────
        // Triggers QMD indexing for the given folder path.
        // Emits indexingStarted before and indexingCompleted
        // or indexingFailed after.
        // ── end of index ─────────────────────────────────────

        async index(path) {
            if (!path) {
                console.warn("[QmdAdapter.ui] index() called with no path.");
                return;
            }

            this.emit("indexingStarted", { path });

            try {
                const result = await this._connector.runWorkflow(
                    "qmd_index", { path }
                );

                this.emit("indexingCompleted", { path });
                return result;

            } catch (err) {
                console.error("[QmdAdapter.ui] index failed:", err);
                this.emit("indexingFailed", { path, error: err.message });
                throw err;
            }
        }

    }
    // ── end of class QmdAdapter ──────────────────────────────

    // ── auto-init ────────────────────────────────────────────
    domReady(() => {
        window.qmdAdapter = new QmdAdapter();
    });
    // ── end of auto-init ─────────────────────────────────────

})();
