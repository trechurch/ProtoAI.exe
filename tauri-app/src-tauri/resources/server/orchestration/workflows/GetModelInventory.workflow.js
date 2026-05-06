// Last modified: 2026-05-04 03:11 UTC
const fs = require("fs");
const path = require("path");

class GetModelInventoryWorkflow {
    static MANIFEST = {
        id: "GetModelInventory.workflow",
        type: "service",
        runtime: "NodeJS",
        version: "4.0.0",
        capabilities: [],
        dependencies: ["paths"],
        docs: { description: "Fetches the active model inventory from models.catalog.json.", author: "ProtoAI team" }
    };

    constructor(deps) {
        this.paths = deps.paths;
    }

    async run(context) {
        try {
            const catalogPath = this.paths.data("models.catalog.json");
            if (!fs.existsSync(catalogPath)) {
                return { status: "error", error: "models.catalog.json not found" };
            }

            const raw = fs.readFileSync(catalogPath, "utf8");
            const catalog = JSON.parse(raw);

            return { status: "ok", data: catalog };
        } catch (err) {
            return { status: "error", error: "Failed to read model inventory", detail: String(err) };
        }
    }
}

module.exports = GetModelInventoryWorkflow;
