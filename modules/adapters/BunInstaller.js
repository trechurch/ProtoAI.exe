// ============================================================
// BunInstaller — SDOA v3.0 Provisioning Adapter
// Ensures the Bun runtime is installed and ready.
// ============================================================

const { Adapter } = require('../base/sdoa-base.js');

class BunInstaller extends Adapter {

    // ------------------------------------------------------------
    // SDOA v3.0 MANIFEST (embedded, authoritative)
    // ------------------------------------------------------------
    static MANIFEST = {
        id: "BunInstaller",
        type: "adapter",
        runtime: "NodeJS",
        version: "3.0.0",

        // v1.2 compatibility fields
        capabilities: [
            "provisioning.check",
            "provisioning.install",
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
                ensureReady: {
                    description: "Ensure the Bun runtime is installed and ready.",
                    input: {},
                    output: "boolean"
                },
                isInstalled: {
                    description: "Check whether the Bun binary is available.",
                    input: {},
                    output: "boolean"
                }
            },

            triggers: {
                installStarted: {
                    description: "Fires when Bun installation begins."
                },
                installCompleted: {
                    description: "Fires when Bun installation completes successfully."
                }
            },

            emits: {
                installFailed: {
                    description: "Emits when Bun installation fails.",
                    payload: { error: "string" }
                }
            },

            workflows: {
                ensureReady: {
                    description: "Primary provisioning workflow for Bun.",
                    input: {},
                    output: "boolean"
                },
                isInstalled: {
                    description: "Workflow wrapper for sys_check_binary(bun).",
                    input: {},
                    output: "boolean"
                }
            }
        },

        // --------------------------------------------------------
        // v1.2 Docs (kept for backward compatibility)
        // --------------------------------------------------------
        docs: {
            description: "Provisioning adapter that ensures the Bun runtime is installed.",
            input: {
                ensureReady: {},
                isInstalled: {}
            },
            output: {
                ensureReady: "boolean",
                isInstalled: "boolean"
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
    // Ensure Bun is installed
    // ------------------------------------------------------------
    async ensureReady() {
        if (await this.isInstalled()) return true;

        console.log("🚀 SDOA Provisioning: Bun runtime missing. Installing...");
        this.emit("installStarted", {});

        try {
            const success = await this.registry
                .get("BackendConnector")
                .runWorkflow("sys_provision_bun");

            if (success) {
                this.bump_patch("Bun runtime provisioned successfully.");
                this.emit("installCompleted", {});
            }

            return success;

        } catch (err) {
            this.emit("installFailed", { error: err.message });
            throw err;
        }
    }

    // ------------------------------------------------------------
    // Check if Bun is installed
    // ------------------------------------------------------------
    async isInstalled() {
        return await this.registry
            .get("BackendConnector")
            .runWorkflow("sys_check_binary", { bin: "bun" });
    }
}

module.exports = BunInstaller;
