// Last modified: 2026-05-04 03:11 UTC
"use strict";

const WorkflowBase  = require("../WorkflowBase");
const WorkflowResult = require("../WorkflowResult");
const https         = require("https");
const fs            = require("fs");
const path          = require("path");
const paths         = require("../../access/env/paths");

class GoogleDriveWorkflow extends WorkflowBase {
    constructor() {
        super();
        this.tokensPath = path.join(paths.data(), "google_tokens.json");
    }

    async run(payload) {
        const { action, params } = payload;

        switch (action) {
            case "get_auth_url":
                return this.getAuthUrl(params);
            case "exchange_code":
                return this.exchangeCode(params);
            case "list_files":
                return this.listFiles(params);
            case "download_file":
                return this.downloadFile(params);
            default:
                return WorkflowResult.error(`Unknown Google Drive action: ${action}`);
        }
    }

    getAuthUrl(params) {
        const { clientId } = params;
        if (!clientId) return WorkflowResult.error("Client ID is required");

        const scope = "https://www.googleapis.com/auth/drive.readonly";
        const redirectUri = "http://localhost:3000/callback"; // We can intercept this or use a simple listener
        const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent`;
        
        return WorkflowResult.ok({ url });
    }

    async exchangeCode(params) {
        const { clientId, clientSecret, code } = params;
        const redirectUri = "http://localhost:3000/callback";

        const postData = new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri
        }).toString();

        try {
            const result = await this._httpsRequest({
                hostname: "oauth2.googleapis.com",
                path: "/token",
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            }, postData);

            const tokens = JSON.parse(result);
            fs.writeFileSync(this.tokensPath, JSON.stringify(tokens, null, 2), "utf8");
            return WorkflowResult.ok({ message: "Successfully authenticated with Google Drive" });
        } catch (err) {
            return WorkflowResult.error(`Failed to exchange code: ${err.message}`);
        }
    }

    async listFiles(params) {
        const tokens = this._loadTokens();
        if (!tokens) return WorkflowResult.error("Not authenticated");

        try {
            const result = await this._httpsRequest({
                hostname: "www.googleapis.com",
                path: "/drive/v3/files?pageSize=20&fields=files(id,name,mimeType,size)",
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${tokens.access_token}`
                }
            });

            return WorkflowResult.ok(JSON.parse(result));
        } catch (err) {
            // Handle token expiry
            if (err.statusCode === 401) {
                return WorkflowResult.error("AUTH_EXPIRED", "Token expired. Please reconnect.");
            }
            return WorkflowResult.error(`Failed to list files: ${err.message}`);
        }
    }

    async downloadFile(params) {
        const { fileId, fileName, project } = params;
        const tokens = this._loadTokens();
        if (!tokens) return WorkflowResult.error("Not authenticated");

        try {
            const content = await this._httpsRequest({
                hostname: "www.googleapis.com",
                path: `/drive/v3/files/${fileId}?alt=media`,
                method: "GET",
                headers: {
                    "Authorization": `Bearer ${tokens.access_token}`
                }
            });

            const projectDir = path.join(paths.data(), "projects", project, "google_drive");
            if (!fs.existsSync(projectDir)) fs.mkdirSync(projectDir, { recursive: true });

            const filePath = path.join(projectDir, fileName);
            fs.writeFileSync(filePath, content, "utf8");

            return WorkflowResult.ok({ message: `Downloaded ${fileName} to ${project}`, path: filePath });
        } catch (err) {
            return WorkflowResult.error(`Failed to download file: ${err.message}`);
        }
    }

    _loadTokens() {
        if (!fs.existsSync(this.tokensPath)) return null;
        try {
            return JSON.parse(fs.readFileSync(this.tokensPath, "utf8"));
        } catch {
            return null;
        }
    }

    _httpsRequest(options, body = null) {
        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let data = "";
                // If downloading binary/large file, this might need optimization
                res.on("data", (chunk) => data += chunk);
                res.on("end", () => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(data);
                    } else {
                        const err = new Error(`HTTP ${res.statusCode}: ${data}`);
                        err.statusCode = res.statusCode;
                        reject(err);
                    }
                });
            });

            req.on("error", (e) => reject(e));
            if (body) req.write(body);
            req.end();
        });
    }
}

module.exports = GoogleDriveWorkflow;
