// ============================================================
// LlmBridge — SDOA v3.0 Adapter
// ============================================================

const { Adapter } = require('../base/sdoa-base.js');

class LlmBridge extends Adapter {

    // ------------------------------------------------------------
    // SDOA v3.0 MANIFEST (embedded, authoritative)
    // ------------------------------------------------------------
    static MANIFEST = {
        id: "LlmBridge",
        type: "adapter",
        runtime: "NodeJS",
        version: "3.0.0",

        // v1.2 compatibility fields
        capabilities: [
            "llm.generate",
            "llm.failover",
            "llm.route",
            "llm.economic-mode",
            "workflow.invoke"
        ],
        dependencies: [
            "LlmPolicyEngine",
            "BackendConnector"
        ],

        // --------------------------------------------------------
        // v3.0 ACTION SURFACE
        // --------------------------------------------------------
        actions: {
            commands: {
                generate: {
                    description: "Generate an LLM response using tier-aware routing and fail-over.",
                    input: {
                        prompt: "string",
                        systemPrompt: "string",
                        tier: "string?"
                    },
                    output: "string | LlmResponse"
                }
            },

            triggers: {
                failoverActivated: {
                    description: "Fires when a model fails due to credits/402 and the bridge falls back."
                },
                allRoutesExhausted: {
                    description: "Fires when no LLM route succeeds."
                }
            },

            emits: {
                routeSelected: {
                    description: "Emits the chosen model route before execution.",
                    payload: { target: "string" }
                },
                routeFailed: {
                    description: "Emits when a route fails for non-402 reasons.",
                    payload: { target: "string", error: "string" }
                }
            },

            workflows: {
                generate: {
                    description: "Primary LLM generation workflow.",
                    input: {
                        prompt: "string",
                        systemPrompt: "string",
                        tier: "string?"
                    },
                    output: "string | LlmResponse"
                }
            }
        },

        // --------------------------------------------------------
        // v1.2 Docs (kept for backward compatibility)
        // --------------------------------------------------------
        docs: {
            description: "Fail-over aware LLM adapter that routes requests via LlmPolicyEngine and BackendConnector.",
            input: {
                generate: {
                    prompt: "string",
                    systemPrompt: "string",
                    tier: "string?"
                }
            },
            output: {
                generate: "string | LlmResponse"
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
    // Tier-aware, fail-over aware LLM generation
    // ------------------------------------------------------------
    async generate(prompt, systemPrompt, tier = "high_reasoning") {
        const policy = this.registry.get("LlmPolicyEngine").resolveRoute(tier);

        // Primary → fallback → local
        const attemptOrder = [
            policy.primary,
            policy.fallback,
            "ollama/llama3"
        ];

        for (const target of attemptOrder) {
            // v3.0 emit: route selected
            this.emit("routeSelected", { target });

            try {
                return await this._executeRequest(target, prompt, systemPrompt);

            } catch (error) {

                // Economic fail-over (402)
                if (error.status === 402 || error.message.includes("credits")) {
                    console.warn(`💰 Credits exhausted for ${target}. Dropping to next tier.`);
                    this.emit("failoverActivated", { target });
                    continue;
                }

                // Non-economic failure
                this.emit("routeFailed", { target, error: error.message });
                this.bump_patch(`Fail-over: ${target} unsuccessful.`);
            }
        }

        // All routes failed
        this.emit("allRoutesExhausted", {});
        throw new Error("CRITICAL: All LLM routes exhausted.");
    }

    // ------------------------------------------------------------
    // Internal workflow execution
    // ------------------------------------------------------------
    async _executeRequest(target, prompt, system) {
        return await this.registry
            .get("BackendConnector")
            .runWorkflow("ProviderRequest", {
                target,
                prompt,
                system
            });
    }
}

module.exports = LlmBridge;
