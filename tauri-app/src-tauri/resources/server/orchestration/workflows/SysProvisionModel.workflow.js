// ============================================================
// SysProvisionModel.workflow.js — SDOA v4 Workflow
// ============================================================
"use strict";

const WorkflowBase = require("../WorkflowBase");
const WorkflowResult = require("../WorkflowResult");
const https = require("https");
const fs = require("fs");
const path = require("path");
const paths = require("../../access/env/paths");

class SysProvisionModelWorkflow extends WorkflowBase {
    static MANIFEST = {
        id: "SysProvisionModelWorkflow",
        type: "service",
        runtime: "NodeJS",
        version: "1.0.0",
        capabilities: ["sys.provision.model"],
        docs: {
            description: "Downloads a local LLM model from Hugging Face if missing.",
            input: {
                modelId: "string",
                url: "string",
                targetPath: "string"
            },
            output: "object"
        }
    };

    async run(context) {
        const { modelId, url, targetPath } = context;
        const fullPath = path.resolve(paths.root, targetPath);
        const dir = path.dirname(fullPath);

        if (fs.existsSync(fullPath)) {
            return WorkflowResult.ok({ message: "Model already exists", path: fullPath, skipped: true });
        }

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        return new Promise((resolve) => {
            const file = fs.createWriteStream(fullPath);
            let downloaded = 0;
            let total = 0;

            const request = https.get(url, (response) => {
                // Handle redirects (Hugging Face uses them)
                if (response.statusCode === 301 || response.statusCode === 302) {
                    this.run({ ...context, url: response.headers.location }).then(resolve);
                    return;
                }

                if (response.statusCode !== 200) {
                    resolve(WorkflowResult.error(`Failed to download: HTTP ${response.statusCode}`));
                    return;
                }

                total = parseInt(response.headers["content-length"], 10);
                response.pipe(file);

                response.on("data", (chunk) => {
                    downloaded += chunk.length;
                    const percent = total ? Math.round((downloaded / total) * 100) : 0;
                    // Emit progress if we had a way, but for now we'll just log
                    if (downloaded % (1024 * 1024 * 10) < chunk.length) { // log every 10MB
                        console.error(`[SysProvisionModel] Downloaded ${Math.round(downloaded / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB (${percent}%)`);
                    }
                });

                file.on("finish", () => {
                    file.close();
                    resolve(WorkflowResult.ok({ message: "Download complete", path: fullPath }));
                });
            });

            request.on("error", (err) => {
                fs.unlink(fullPath, () => {});
                resolve(WorkflowResult.error(`Download error: ${err.message}`));
            });
        });
    }
}

module.exports = SysProvisionModelWorkflow;
