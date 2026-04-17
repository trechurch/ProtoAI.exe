// ============================================================
// LlmPolicyEngine.ui.js — UI Adapter (Browser-Safe)
// version: 3.0.0
// depends: tauri-utils.js, BackendConnector.ui.js
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    // ── LlmPolicyEngine.ui ───────────────────────────────────
    // Browser-safe UI adapter for LLM governance.
    // Mirrors LlmPolicyEngine.js (backend) public surface but
    // delegates all execution to BackendConnector.ui via
    // window.backendConnector.runWorkflow().
    // Never uses require(). Never calls Tauri directly —
    // all IPC is owned by BackendConnector.ui.
    // ── end of LlmPolicyEngine.ui ───────────────────────────

    class LlmPolicyEngine {

        // ── SDOA v3.0 MANIFEST ───────────────────────────────
        static MANIFEST = {
            id:      "LlmPolicyEngine.ui",
            type:    "adapter",
            runtime: "Browser",
            version: "3.0.0",

            // v1.2 fields — always present, never removed
            capabilities: [
                "policy.read",
                "policy.write",
                "policy.resolve",
                "workflow.invoke"
            ],
            dependencies: [
                "tauri-utils.js",
                "BackendConnector.ui.js"
            ],
            docs: {
                description: "Browser-safe governance adapter. Reads and writes LLM routing policy via BackendConnector.ui. Exposes resolveRoute, getPolicy, and updatePolicy to UI surfaces.",
                input: {
                    resolveRoute:  { requestedTier: "string" },
                    updatePolicy:  { newSettings: "object" }
                },
                output: {
                    resolveRoute:  "PolicyRoute",
                    getPolicy:     "PolicyObject",
                    updatePolicy:  "void"
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
                    resolveRoute: {
                        description: "Resolve the best model route based on tier and current policy state.",
                        input:  { requestedTier: "string" },
                        output: "PolicyRoute"
                    },
                    getPolicy: {
                        description: "Load the current LLM policy from backend config.",
                        input:  {},
                        output: "PolicyObject"
                    },
                    updatePolicy: {
                        description: "Merge and persist new policy settings to backend.",
                        input:  { newSettings: "object" },
                        output: "void"
                    }
                },
                triggers: {
                    policyUpdated: {
                        description: "Fires when the policy is successfully updated.",
                        payload: { updated: "object" }
                    }
                },
                emits: {
                    routeResolved: {
                        description: "Emits the resolved route after resolution.",
                        payload: { requestedTier: "string", resolved: "object" }
                    }
                },
                workflows: {
                    resolveRoute: {
                        description: "Primary policy resolution workflow.",
                        input:  { requestedTier: "string" },
                        output: "PolicyRoute"
                    },
                    updatePolicy: {
                        description: "Primary policy update workflow.",
                        input:  { newSettings: "object" },
                        output: "void"
                    }
                }
            }
        };
        // ── end of SDOA v3.0 MANIFEST ────────────────────────

        constructor() {
            // ── state ────────────────────────────────────────
            this._policyCache  = null;
            this.listeners     = [];
            // ── end of state ─────────────────────────────────
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
                        console.error(`[LlmPolicyEngine.ui] Listener error (${event}):`, e);
                    }
                }
            }
        }

        // ── end of event emitter ─────────────────────────────

        // ── _connector ───────────────────────────────────────
        // Lazy accessor for BackendConnector.ui instance.
        // Deferred so load order doesn't require strict
        // synchronous sequencing beyond domReady.
        // ── end of _connector ────────────────────────────────

        get _connector() {
            if (!window.backendConnector) {
                throw new Error("[LlmPolicyEngine.ui] BackendConnector.ui not initialized.");
            }
            return window.backendConnector;
        }

        // ── getPolicy ────────────────────────────────────────
        // Fetches the current LLM policy from the backend.
        // Caches the result in memory for the session.
        // Cache is invalidated on updatePolicy.
        // ── end of getPolicy ─────────────────────────────────

        async getPolicy() {
            if (this._policyCache) return this._policyCache;

            try {
                const policy = await this._connector.runWorkflow(
                    "get_policy", {}
                );
                this._policyCache = policy;
                return policy;
            } catch (err) {
                console.error("[LlmPolicyEngine.ui] getPolicy failed:", err);
                // Return a safe default so the UI doesn't crash
                return {
                    state:  "unknown",
                    tiers:  {},
                    primary: { provider: "unknown", model: "unknown" }
                };
            }
        }

        // ── resolveRoute ─────────────────────────────────────
        // Resolves the best model route for the requested tier.
        // Applies economic failover locally if policy.state
        // indicates low_credits, matching backend logic.
        // Emits routeResolved for any subscriber.
        // ── end of resolveRoute ──────────────────────────────

        async resolveRoute(requestedTier) {
            const policy = await this.getPolicy();

            let resolved;

            if (policy.state === "low_credits") {
                resolved = policy.tiers?.["local_fallback"] ?? null;
            } else {
                resolved = policy.tiers?.[requestedTier]
                        ?? policy.tiers?.["standard"]
                        ?? null;
            }

            this.emit("routeResolved", { requestedTier, resolved });
            return resolved;
        }

        // ── updatePolicy ─────────────────────────────────────
        // Merges new settings into the current policy and
        // persists via backend. Invalidates local cache and
        // emits policyUpdated on success.
        // ── end of updatePolicy ──────────────────────────────

        async updatePolicy(newSettings) {
            try {
                await this._connector.runWorkflow(
                    "update_policy", newSettings
                );

                // Invalidate cache so next getPolicy fetches fresh
                this._policyCache = null;

                this.emit("policyUpdated", { updated: newSettings });
                console.info("[LlmPolicyEngine.ui] Policy updated.");
            } catch (err) {
                console.error("[LlmPolicyEngine.ui] updatePolicy failed:", err);
                throw err;
            }
        }

        // ── invalidateCache ──────────────────────────────────
        // Allows external modules to force a fresh policy fetch
        // on next getPolicy/resolveRoute call.
        // ── end of invalidateCache ───────────────────────────

        invalidateCache() {
            this._policyCache = null;
        }

    }
    // ── end of class LlmPolicyEngine ─────────────────────────

    // ── auto-init ────────────────────────────────────────────
    domReady(() => {
        window.llmPolicyEngine = new LlmPolicyEngine();
    });
    // ── end of auto-init ─────────────────────────────────────

})();
