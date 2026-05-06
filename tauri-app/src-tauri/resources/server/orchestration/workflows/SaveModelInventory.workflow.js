// Last modified: 2026-05-04 03:11 UTC
const fs = require("fs");
const path = require("path");

class SaveModelInventoryWorkflow {
    static MANIFEST = {
        id: "SaveModelInventory.workflow",
        type: "service",
        runtime: "NodeJS",
        version: "4.0.0",
        capabilities: [],
        dependencies: ["paths"],
        docs: { description: "Saves updates to the model inventory in models.catalog.json.", author: "ProtoAI team" }
    };

    constructor(deps) {
        this.paths = deps.paths;
    }

    async run(context) {
        try {
            const { models, activeArchetype, archetypes } = context;
            const catalogPath = this.paths.data("models.catalog.json");
            
            let catalog = {};
            if (fs.existsSync(catalogPath)) {
                catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
            }

            if (models) catalog.models = models;
            if (activeArchetype) catalog.activeArchetype = activeArchetype;
            if (archetypes) catalog.archetypes = archetypes;

            fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), "utf8");

            return { status: "ok", data: catalog };
        } catch (err) {
            return { status: "error", error: "Failed to save model inventory", detail: String(err) };
        }
    }
}

module.exports = SaveModelInventoryWorkflow;
