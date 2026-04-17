// ============================================================
// LlmPolicyEngine — SDOA v3.0 Governance Service
// ============================================================

const { Service } = require('../base/sdoa-base.js');

class LlmPolicyEngine extends Service {

    // ------------------------------------------------------------
    // SDOA v3.0 MANIFEST (embedded, authoritative)
    // ------------------------------------------------------------
    static MANIFEST = {
        id: "LlmPolicyEngine",
        type: "service",
        runtime: "NodeJS",
        version: "3.0.0",

        // v1.2 compatibility fields
        capabilities: [
            "policy.read",
            "policy.write",
            "policy.resolve",
            "workflow.invoke"
        ],

        dependencies: [
            "BackendConnector"
        ],

        // --------------------------------------------------------
        // v3.0 ACTION SURFACE
        // --------------------------------------------------------
        actions: {
            commands: {
                resolveRoute: {
                    description: "Resolve the best model route based on tier and policy state.",
                    input: { requestedTier: "string" },
                    output: "PolicyRoute"
                },
                getPolicy: {
                    description: "Load the current LLM policy from config.",
                    input: {},
                    output: "PolicyObject"
                },
                updatePolicy: {
                    description: "Merge and persist new policy settings.",
                    input: { newSettings: "object" },
                    output: "void"
                }
            },

            triggers: {
                policyUpdated: {
                    description: "Fires when the policy file is updated.",
                    payload: { updated: "object" }
                }
            },

            emits: {
                routeResolved: {
                    description: "Emits the resolved route before LlmBridge uses it.",
                    payload: { requestedTier: "string", resolved: "object" }
                }
            },

            workflows: {
                resolveRoute: {
                    description: "Primary policy resolution workflow.",
                    input: { requestedTier: "string" },
                    output: "PolicyRoute"
                },
                updatePolicy: {
                    description: "Primary policy update workflow.",
                    input: { newSettings: "object" },
                    output: "void"
                }
            }
        },

        // --------------------------------------------------------
        // v1.2 Docs (kept for backward compatibility)
        // --------------------------------------------------------
        docs: {
            description: "Governance service for LLM routing, policy resolution, and config persistence.",
            input: {
                resolveRoute: { requestedTier: "string" },
                updatePolicy: { newSettings: "object" }
            },
            output: {
                resolveRoute: "PolicyRoute",
                updatePolicy: "void"
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
    // Resolve model route based on tier + policy state
    // ------------------------------------------------------------
    async resolveRoute(requestedTier) {
        const policy = await this.getPolicy();

        // Economic failover mode
        if (policy.state === "low_credits") {
            const resolved = policy.tiers["local_fallback"];
            this.emit("routeResolved", { requestedTier, resolved });
            return resolved;
        }

        const resolved = policy.tiers[requestedTier] || policy.tiers["standard"];
        this.emit("routeResolved", { requestedTier, resolved });
        return resolved;
    }

    // ------------------------------------------------------------
    // Load policy from config file
    // ------------------------------------------------------------
    async getPolicy() {
        return await this.registry
            .get("BackendConnector")
            .runWorkflow("file_read_config", {
                fileName: "sdoa_llm_policy.json"
            });
    }

    // ------------------------------------------------------------
    // Update + persist policy
    // ------------------------------------------------------------
    async updatePolicy(newSettings) {
        const current = await this.getPolicy();
        const updated = { ...current, ...newSettings };

        await this.registry
            .get("BackendConnector")
            .runWorkflow("file_write_config", {
                fileName: "sdoa_llm_policy.json",
                content: updated
            });

        this.bump_minor("Policy updated: " + JSON.stringify(newSettings));

        // v3.0 trigger
        this.emit("policyUpdated", { updated });
    }
}

module.exports = LlmPolicyEngine;
