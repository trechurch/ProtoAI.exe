// ============================================================
// MultiModelSendWorkflow.js — SDOA v3.0 Service (NodeJS)
// version: 1.0.0
// Last modified: 2026-05-04 03:11 UTC
// depends: SendMessageWorkflow, MultiModelOrchestrator, WorkflowResult
// ============================================================
//
// Orchestrated chat pipeline:
//
//   1. route()    — local model classifies request, picks prime profile
//   2. engineer() — local model rewrites prompt for optimal prime output
//   3. prime      — SendMessageWorkflow runs with engineered prompt;
//                   watch() fires non-blocking on every ~400 chars of stream
//   4. audit()    — local model scores the completed response
//
// Returns WorkflowResult.ok({ reply, orchestrator: { events, route,
//   engineer, watchFlags, audit, engineeredPrompt, resolvedProfile } })
//
// The orchestrator block is consumed by LlmBridge.ui.js, which plays
// back the events into the EventBus so PartnerTicker.ui.js can animate
// them in the ticker after the response arrives.
// ============================================================

"use strict";

const WorkflowBase        = require("../WorkflowBase");
const WorkflowResult      = require("../WorkflowResult");
const SendMessageWorkflow = require("./SendMessage.workflow");
const orchestrator        = require("./MultiModelOrchestrator");

class MultiModelSendWorkflow extends WorkflowBase {

    // ── SDOA v3.0 MANIFEST ───────────────────────────────────
    static MANIFEST = {
        id:           "MultiModelSendWorkflow",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: ["chat.send", "chat.stream", "orchestrator.pipeline"],
        dependencies: ["SendMessageWorkflow", "MultiModelOrchestrator"],
        docs: {
            description: "Orchestrated chat workflow. Routes the request through the local model (route → engineer → watch → audit) then delegates to the prime model via SendMessageWorkflow.",
            input: {
                project:  "string",
                profile:  "string?",
                message:  "string",
                stream:   "boolean?",
                onChunk:  "function?",
            },
            output: { reply: "string", orchestrator: "object" },
            author: "ProtoAI team",
        },
        actions: {
            commands: {},
            triggers: {},
            emits: {
                "orchestrator:routing":    {},
                "orchestrator:routed":     {},
                "orchestrator:engineering":{},
                "orchestrator:engineered": {},
                "orchestrator:watching":   {},
                "orchestrator:flagged":    {},
                "orchestrator:auditing":   {},
                "orchestrator:audited":    {},
            },
            workflows: {
                run: {
                    description: "Full orchestrated send: route → engineer → prime (+ watch) → audit.",
                    input:  { project: "string", profile: "string?", message: "string" },
                    output: "WorkflowResult",
                },
            },
        },
    };
    // ── end MANIFEST ─────────────────────────────────────────

    async run(context) {
        const { project, message, profile: requestedProfile, onChunk, stream } = context;

        // ── event log — replayed in UI ticker ─────────────────
        const events = [];
        const _track = (type, data = {}) => {
            events.push({ type, ts: Date.now(), data });
        };

        // Collect orchestrator events into the log
        const _onOrchestratorEvent = (type) => (data) => _track(type, data);
        const _evtTypes = [
            "orchestrator:routing", "orchestrator:routed",
            "orchestrator:engineering", "orchestrator:engineered",
            "orchestrator:watching", "orchestrator:flagged",
            "orchestrator:auditing", "orchestrator:audited",
            "orchestrator:commentary_generating", "orchestrator:commentary",
            "orchestrator:error",
        ];
        _evtTypes.forEach(t => orchestrator.on(t, _onOrchestratorEvent(t)));

        try {
            // ── 1. Route ──────────────────────────────────────
            let resolvedProfile = requestedProfile || "default";
            let routeResult     = { skipped: true };
            try {
                routeResult = await orchestrator.route(message);
                // Only override profile if none was explicitly requested
                if (routeResult.profile && !requestedProfile) {
                    resolvedProfile = routeResult.profile;
                }
            } catch (e) {
                _track("route_error", { error: e.message });
            }

            // ── 2. Engineer ───────────────────────────────────
            let finalMessage   = message;
            let engineerResult = { skipped: true };
            try {
                engineerResult = await orchestrator.engineer(message);
                if (engineerResult.prompt && !engineerResult.skipped) {
                    finalMessage = engineerResult.prompt;
                }
            } catch (e) {
                _track("engineer_error", { error: e.message });
            }

            // ── 3. Prime model — watcher fires in parallel ────
            const watchResults = [];
            let   watchBuffer  = "";

            // Wrap onChunk to accumulate a rolling buffer for the watcher
            const watchingOnChunk = async (chunk) => {
                onChunk?.(chunk);
                watchBuffer += chunk;
                // Fire-and-forget watch check every ~400 chars
                if (watchBuffer.length > 0 && (watchBuffer.length % 400) < (chunk.length + 8)) {
                    setImmediate(async () => {
                        try {
                            const w = await orchestrator.watch(watchBuffer, message);
                            if (w && !w.ok && w.flag) {
                                watchResults.push(w);
                                _track("orchestrator:flagged", { flag: w.flag });
                            }
                        } catch (_) {}
                    });
                }
            };

            const primaryWf     = new SendMessageWorkflow();
            const primaryResult = await primaryWf.run({
                ...context,
                message: finalMessage,
                profile: resolvedProfile,
                onChunk: stream ? watchingOnChunk : onChunk,
            });

            if (primaryResult.status !== "ok") {
                // primaryResult.data may be null (WorkflowResult.error() sets data=null),
                // so we must pull the error string from primaryResult.error directly.
                const primeError  = primaryResult.data?.error  || primaryResult.error  || "Prime workflow failed";
                const primeDetail = primaryResult.data?.detail || primaryResult.detail || undefined;
                return new WorkflowResult("error", {
                    error:  primeError,
                    ...(primeDetail ? { detail: primeDetail } : {}),
                    orchestrator: { events, routeResult, engineerResult },
                });
            }

            const primeReply = primaryResult.data?.reply || "";

            // ── 4. Audit ──────────────────────────────────────
            let auditResult = { score: null, issues: [], note: "", skipped: true };
            try {
                // Use original message for auditing (judges quality against what user asked)
                auditResult = await orchestrator.audit(message, primeReply);
            } catch (e) {
                _track("audit_error", { error: e.message });
            }

            // ── 5. Commentary ─────────────────────────────────
            let commentaryResult = { skipped: true };
            try {
                // Persona could be picked based on auditResult.score or user preferences
                const persona = (auditResult.score && auditResult.score < 6) ? "advisor" : "friend";
                commentaryResult = await orchestrator.commentary(message, primeReply, persona);
            } catch (e) {
                _track("commentary_error", { error: e.message });
            }

            // ── 6. Result ─────────────────────────────────────
            return new WorkflowResult("ok", {
                reply:        primeReply,
                project,
                profile:      resolvedProfile,
                orchestrator: {
                    events,
                    route:    routeResult,
                    engineer: engineerResult,
                    audit:    auditResult,
                    commentary: commentaryResult,
                },
                streaming:    !!stream,
            });

        } finally {
            // Cleanup: remove orchestrator listeners so they don't leak
            _evtTypes.forEach(t => orchestrator.off(t, _onOrchestratorEvent(t)));
        }
    }
}

module.exports = MultiModelSendWorkflow;
