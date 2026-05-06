// Last modified: 2026-05-04 03:11 UTC
const fs = require("fs");
const path = require("path");

class UpdatePolicyWorkflow {
    static MANIFEST = {
        id: "UpdatePolicy.workflow",
        type: "service",
        runtime: "NodeJS",
        version: "4.0.0",
        capabilities: [],
        dependencies: ["paths"],
        docs: { description: "Updates the LLM policy in policy.defaults.json.", author: "ProtoAI team" }
    };

    constructor(deps) {
        this.paths = deps.paths;
    }

    async run(context) {
        try {
            const policyPath = this.paths.data("policy.defaults.json");
            let policy = {};
            
            if (fs.existsSync(policyPath)) {
                policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
            }

            // Merge the new settings into the existing policy
            const updatedPolicy = { ...policy, ...context };

            fs.writeFileSync(policyPath, JSON.stringify(updatedPolicy, null, 4), "utf8");

            return { status: "ok", data: updatedPolicy };
        } catch (err) {
            return { status: "error", error: "Failed to update policy", detail: String(err) };
        }
    }
}

module.exports = UpdatePolicyWorkflow;
