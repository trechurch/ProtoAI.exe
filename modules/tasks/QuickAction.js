// SDOA v1.2 compliant — Execution Pipeline
const { Task } = require('../base/sdoa-base.js');

class QuickAction extends Task {
    static MANIFEST = {
        id: "QuickAction",
        runtime: "NodeJS",    // Added for cross-runtime routing
        version: "1.0.2",    // Added for Registry tracking
        dependencies: ["QmdAdapter", "LlmBridge", "RefactorService"]
    };

    async run({ filePath, userIntent }) {
        // 1. Fetch code via Adapter
        const qmd = this.registry.get("QmdAdapter");
        const code = await qmd.query(`SELECT content FROM snippets WHERE path = '${filePath}'`);

        // 2. Delegate logic to the Python-based RefactorService
        // This is a cross-runtime SDOA call!
        const refactor = await this.registry.get("RefactorService").propose_refactor(
            filePath, 
            userIntent
        );

        this.bump_patch(`QuickAction: ${userIntent} executed on ${filePath}`);
        return refactor;
    }
} 