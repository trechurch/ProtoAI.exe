// ============================================================
// LlmBridge.ui.js — UI Bridge (Browser-Safe)
// version: 3.0.1
// Last modified: 2026-05-04 03:11 UTC
// depends: tauri-utils.js, BackendConnector.ui.js, LlmPolicyEngine.ui.js
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    // ── LlmBridge.ui ─────────────────────────────────────────
    // Browser-safe UI bridge for LLM generation requests.
    // Mirrors LlmBridge.js (backend) public surface but
    // delegates all execution to BackendConnector.ui via
    // window.backendConnector.runWorkflow().
    //
    // Tier-aware routing and failover logic lives in the
    // backend LlmBridge.js — this adapter does not replicate
    // that logic. It passes tier as a hint to the backend
    // and emits UI-level events for route and failure feedback.
    //
    // Never uses require(). Never calls Tauri directly.
    // ── end of LlmBridge.ui ──────────────────────────────────

    class LlmBridge {

        // ── SDOA v3.0 MANIFEST ───────────────────────────────
        static MANIFEST = {
            id:      "LlmBridge.ui",
            type:    "adapter",
            runtime: "Browser",
            version: "3.0.1",

            // v1.2 fields — always present, never removed
            capabilities: [
                "llm.generate",
                "llm.route",
                "llm.tier-hint",
                "workflow.invoke"
            ],
            dependencies: [
                "tauri-utils.js",
                "BackendConnector.ui.js",
                "LlmPolicyEngine.ui.js"
            ],
            docs: {
                description: "Browser-safe LLM generation bridge. Passes generation requests and tier hints to the backend via BackendConnector.ui. Emits UI-level events for route selection and failure. Failover logic is owned by the backend LlmBridge.js.",
            author: "ProtoAI team",
                input: {
                    generate: {
                        prompt:       "string",
                        systemPrompt: "string?",
                        tier:         "string?"
                    }
                },
                output: {
                    generate: "string | LlmResponse"
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
                    generate: {
                        description: "Generate an LLM response. Passes tier hint to backend for route resolution.",
                        input: {
                            prompt:       "string",
                            systemPrompt: "string?",
                            tier:         "string?"
                        },
                        output: "string | LlmResponse"
                    },
                    chat: {
                        description: "Convenience wrapper for generate() using the SendMessageWorkflow.",
                        input: {
                            project:      "string",
                            profile:      "string?",
                            engine:       "string?",
                            message:      "string",
                            stream:       "boolean?",
                            responseMode: "string?",
                            historyDepth: "number|null?",
                            systemExtra:  "string?",
                        },
                        output: "string | ChatResponse"
                    }
                },
                triggers: {
                    allRoutesExhausted: {
                        description: "Fires when the backend reports all LLM routes failed."
                    }
                },
                emits: {
                    generateStarted: {
                        description: "Emits when a generation request is dispatched.",
                        payload: { tier: "string?" }
                    },
                    generateCompleted: {
                        description: "Emits when a generation request succeeds.",
                        payload: { tier: "string?" }
                    },
                    generateFailed: {
                        description: "Emits when a generation request fails.",
                        payload: { tier: "string?", error: "string" }
                    }
                },
                workflows: {
                    generate: {
                        description: "Primary LLM generation workflow.",
                        input: {
                            prompt:       "string",
                            systemPrompt: "string?",
                            tier:         "string?"
                        },
                        output: "string | LlmResponse"
                    },
                    chat: {
                        description: "Stateful chat workflow via SendMessageWorkflow.",
                        input: {
                            project:      "string",
                            profile:      "string?",
                            engine:       "string?",
                            message:      "string",
                            stream:       "boolean?",
                            responseMode: "string?",
                            historyDepth: "number|null?",
                            systemExtra:  "string?",
                        },
                        output: "string | ChatResponse"
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
                        console.error(`[LlmBridge.ui] Listener error (${event}):`, e);
                    }
                }
            }
            // Also emit on global EventBus for SendButton disabled state etc.
            window.EventBus?.emit(`llmbridge:${event}`, data);
        }

        // ── end of event emitter ─────────────────────────────

        // ── _connector ───────────────────────────────────────
        // Lazy accessor for BackendConnector.ui instance.
        // ── end of _connector ────────────────────────────────

        get _connector() {
            if (!window.backendConnector) {
                throw new Error("[LlmBridge.ui] BackendConnector.ui not initialized.");
            }
            return window.backendConnector;
        }

        // ── generate ─────────────────────────────────────────
        // Primary LLM generation entry point.
        // Passes prompt, systemPrompt, and tier hint to the
        // backend llm_generate workflow. Failover and route
        // selection are owned by backend LlmBridge.js.
        // Emits generateStarted, generateCompleted, or
        // generateFailed for UI feedback.
        // ── end of generate ──────────────────────────────────

        async generate(prompt, systemPrompt = "", tier = "high_reasoning") {
            if (!prompt || !prompt.trim()) {
                console.warn("[LlmBridge.ui] generate() called with empty prompt.");
                return "";
            }

            this.emit("generateStarted", { tier });

            try {
                const result = await this._connector.runWorkflow(
                    "llm_generate", { prompt, systemPrompt, tier }
                );

                this.emit("generateCompleted", { tier });
                return result;

            } catch (err) {
                const msg = err.message || String(err);
                const allExhausted = msg.toLowerCase().includes("all llm routes exhausted");

                if (allExhausted) {
                    this.emit("allRoutesExhausted", {});
                }

                this.emit("generateFailed", { tier, error: msg });
                console.error("[LlmBridge.ui] generate failed:", err);
                throw err;
            }
        }

        // ── chat ─────────────────────────────────────────────
        // Stateful chat wrapper that routes through the
        // SendMessageWorkflow path.
        //
        // FIX v3.0.1: Previously only forwarded {project,
        // profile, engine, message}. Now passes all params so
        // stream, responseMode, historyDepth, and systemExtra
        // actually reach the backend workflow.
        // ── end of chat ──────────────────────────────────────

        // ── orchestrator ─────────────────────────────────────
        get _orchestratorEnabled() {
            return localStorage.getItem("protoai:orchestrator:enabled") === "true";
        }

        _playbackOrchestratorEvents(orchestrator) {
            if (!orchestrator || !orchestrator.events) return;
            const events = orchestrator.events;
            let delay = 0;
            events.forEach(ev => {
                setTimeout(() => {
                    window.EventBus?.emit(ev.type, ev.data || {});
                }, delay);
                delay += 220;
            });
        }
        // ── end of orchestrator ───────────────────────────────

        async chat({
            project,
            profile      = "",
            engine       = "",
            message,
            stream       = true,
            responseMode = "standard",
            historyDepth = null,
            systemExtra  = "",
        }) {
            if (!message || !message.trim()) {
                console.warn("[LlmBridge.ui] chat() called with empty message.");
                return "";
            }

            this.emit("generateStarted", { tier: "chat" });

            const useOrchestrator = this._orchestratorEnabled;
            const workflowName    = useOrchestrator ? "MultiModelSendWorkflow" : "SendMessageWorkflow";

            try {
                const result = await this._connector.runWorkflow(
                    workflowName, {
                        project,
                        profile,
                        engine,
                        message,
                        stream,
                        responseMode,
                        historyDepth,
                        systemExtra,
                    }
                );

                this.emit("generateCompleted", { tier: "chat" });

                // Detect explicit backend failure and surface it as a thrown error
                // so handleSendMessage catch block shows an error bubble instead of silence.
                if (result && result.ok === false) {
                    const errMsg = result.error || result.detail || "Backend returned an error";
                    throw new Error("[Backend] " + errMsg);
                }

                if (useOrchestrator && result?.orchestrator) {
                    this._playbackOrchestratorEvents(result.orchestrator);
                }

                // Extract reply string from result shape
                if (typeof result === "string") return result;

                // Orchestrator result is often in result.response (v3.0)
                const reply = result?.response || result?.reply || result?.data?.reply || result?.data?.response;

                // Empty reply without explicit error -- surface it so the user sees something
                if (!reply && reply !== 0) {
                    throw new Error("AI returned an empty response. Check your API key and model in Settings.");
                }

                return reply;

            } catch (err) {
                this.emit("generateFailed", { tier: "chat", error: err.message });
                console.error("[LlmBridge.ui] chat failed:", err);
                throw err;
            }
        }

    }
    // ── end of class LlmBridge ───────────────────────────────

    // ── auto-init ────────────────────────────────────────────
    domReady(() => {
        window.llmBridge = new LlmBridge();
    });
    // ── end of auto-init ─────────────────────────────────────

})();