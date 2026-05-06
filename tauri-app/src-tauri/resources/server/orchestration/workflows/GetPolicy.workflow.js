// Last modified: 2026-05-04 03:11 UTC
const fs = require("fs");
const path = require("path");

class GetPolicyWorkflow {
    static MANIFEST = {
        id: "GetPolicy.workflow",
        type: "service",
        runtime: "NodeJS",
        version: "4.0.0",
        capabilities: [],
        dependencies: ["paths"],
        docs: { description: "Fetches the current LLM policy from policy.defaults.json.", author: "ProtoAI team" }
    };

    constructor(deps) {
        this.paths = deps.paths;
    }

    async run(context) {
        try {
            const policyPath = this.paths.data("policy.defaults.json");
            if (!fs.existsSync(policyPath)) {
                return { status: "error", error: "policy.defaults.json not found" };
            }

            const raw = fs.readFileSync(policyPath, "utf8");
            const policy = JSON.parse(raw);

            return { status: "ok", data: policy };
        } catch (err) {
            return { status: "error", error: "Failed to read policy", detail: String(err) };
        }
    }
}

module.exports = GetPolicyWorkflow;
