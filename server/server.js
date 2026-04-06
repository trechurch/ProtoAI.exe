console.log("🔥 SERVER.JS LOADED FROM:", __filename);
console.log(">>> ProtoAI server.js (Repository-Integrated Version) LOADED");

// ------------------------------------------------------------
// ProtoAI Local Server — Portable, Repository-Based Version
// ------------------------------------------------------------
// Supports:
// - Static UI serving
// - /projects
// - /history/:project
// - /chat (workflow-driven CLI invocation)
// - /upload
// - /ingest
// - /profiles
// - Uses Access-layer repositories + Workflow engine
// ------------------------------------------------------------

const http = require("http");
const fs = require("fs");
const path = require("path");

// Workflow Engine
const WorkflowRegistry = require("./orchestration/WorkflowRegistry");
const SendMessageWorkflow = require("./orchestration/workflows/SendMessageWorkflow");
const ImageGenWorkflow = require("./orchestration/workflows/ImageGenWorkflow");
const DeepSearchWorkflow = require("./orchestration/workflows/DeepSearchWorkflow");
const ChatSessionWorkflow = require("./orchestration/workflows/ChatSessionWorkflow");

const registry = new WorkflowRegistry();
registry.register("SendMessageWorkflow", new SendMessageWorkflow());
registry.register("ImageGenWorkflow", new ImageGenWorkflow());
registry.register("DeepSearchWorkflow", new DeepSearchWorkflow());
registry.register("ChatSessionWorkflow", new ChatSessionWorkflow());

// Access Layer
const paths = require("./access/env/paths");
const FsProjectRepository = require("./access/fs/FsProjectRepository");
const FsMemoryRepository = require("./access/fs/FsMemoryRepository");
const FsProfileRepository = require("./access/fs/FsProfileRepository");

// Instantiate repositories
const projectRepo = new FsProjectRepository();
const memoryRepo = new FsMemoryRepository();
const profileRepo = new FsProfileRepository();

// Settings
const SettingsManager = require("./lib/SettingsManager");
const settingsManager = new SettingsManager(paths.data("settings.json"));

const PORT = 17890;

// UI directory
const UI_DIR = paths.ui();

// Logging
const LOG_FILE = paths.data("logs", "server.log");
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

// Utility: send JSON
function sendJSON(res, obj) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
}

// Utility: read request body
function readBody(req, callback) {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => callback(body));
}

// ------------------------------------------------------------
// STATIC FILE SERVING
// ------------------------------------------------------------
function serveStatic(req, res) {
    let filePath = req.url === "/" ? "/index.html" : req.url;
    filePath = path.join(UI_DIR, filePath);

    if (!fs.existsSync(filePath)) return false;

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".txt": "text/plain"
    };

    const mime = mimeTypes[ext] || "application/octet-stream";

    try {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { "Content-Type": mime });
        res.end(content);
        return true;
    } catch (e) {
        res.writeHead(500);
        res.end("Error loading file");
        return true;
    }
}

// ------------------------------------------------------------
// API ROUTES
// ------------------------------------------------------------

// GET /projects
function handleProjects(req, res) {
    const projects = projectRepo.listProjects();
    sendJSON(res, { projects });
}

// GET /history/:project
function handleHistory(req, res, project) {
    const history = projectRepo.getHistory(project);
    sendJSON(res, { history });
}

// POST /chat (workflow-driven)
function handleChat(req, res) {
    readBody(req, async body => {
        let parsed;
        try {
            parsed = JSON.parse(body);
        } catch {
            return sendJSON(res, { error: "Invalid JSON" });
        }

        const { project, message, profile, engine } = parsed;

        console.log("\n==============================");
        console.log("📨 CHAT REQUEST RECEIVED");
        console.log("Project:", project);
        console.log("Profile:", profile);
        console.log("Engine:", engine);
        console.log("Message:", message);
        console.log("==============================\n");

        try {
            const workflow = registry.get("SendMessageWorkflow");
            const result = await workflow.run({ project, message, profile, engine });

            if (result.status === "error") {
                return sendJSON(res, result.data);
            }

            return sendJSON(res, { response: result.data.reply });

        } catch (err) {
            console.error("❌ WORKFLOW ERROR:", err);
            try { sendJSON(res, { error: "Workflow error", detail: String(err) }); } catch (_) {}
        }
    });
}

// POST /upload
function handleUpload(req, res) {
    readBody(req, body => {
        let parsed;
        try {
            parsed = JSON.parse(body);
        } catch {
            return sendJSON(res, { error: "Invalid JSON" });
        }

        const { project, filename, content } = parsed;

        const projectDir = paths.projectDir(project);
        fs.mkdirSync(projectDir, { recursive: true });

        const filePath = path.join(projectDir, filename);
        fs.writeFileSync(filePath, content, "utf8");

        sendJSON(res, { status: "ok" });
    });
}

// POST /ingest
function handleIngest(req, res) {
    readBody(req, body => {
        let parsed;
        try {
            parsed = JSON.parse(body);
        } catch {
            return sendJSON(res, { error: "Invalid JSON" });
        }

        const { project } = parsed;
        const projectDir = paths.projectDir(project);

        if (!fs.existsSync(projectDir)) {
            return sendJSON(res, { files: [] });
        }

        const files = fs.readdirSync(projectDir).filter(f => {
            const full = path.join(projectDir, f);
            return fs.statSync(full).isFile();
        });

        const fileContents = files.map(f => {
            const full = path.join(projectDir, f);
            return {
                filename: f,
                content: fs.readFileSync(full, "utf8")
            };
        });

        sendJSON(res, { files: fileContents });
    });
}

// GET /profiles
function handleProfiles(req, res) {
    const profiles = profileRepo.loadProfiles();
    sendJSON(res, { profiles });
}

// GET /settings
function handleGetSettings(req, res) {
    sendJSON(res, { settings: settingsManager.exportAll() });
}

// POST /settings
function handleSetSettings(req, res) {
    readBody(req, body => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { return sendJSON(res, { error: "Invalid JSON" }); }
        const { action, key, value } = parsed;
        if (action === "set") {
            if (key && value !== undefined) {
                settingsManager.set(key, value);
            } else if (value !== undefined) {
                settingsManager.importAll(value);
            }
        }
        sendJSON(res, { settings: settingsManager.exportAll() });
    });
}

// POST /settings/test-key
function handleTestKey(req, res) {
    readBody(req, async body => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { return sendJSON(res, { error: "Invalid JSON" }); }
        const { provider, key } = parsed;
        try {
            const result = await settingsManager.validateApiKey(provider, key);
            sendJSON(res, result);
        } catch (err) {
            sendJSON(res, { ok: false, error: "Validation request failed", detail: err.message });
        }
    });
}

// GET /sessions/:project
function handleListSessions(req, res, project) {
    const sessions = projectRepo.listChatSessions(project);
    sendJSON(res, { sessions });
}

// POST /sessions
function handleChatSessions(req, res) {
    readBody(req, async body => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { return sendJSON(res, { error: "Invalid JSON" }); }
        const { action, project, chatId, name } = parsed;
        const file = __dirname + "/orchestration/workflows/ChatSessionWorkflow.js";
        const ChatSessionWorkflow = require(file);
        const workflow = new ChatSessionWorkflow();
        const result = await workflow.run({ action, project, chatId, name });
        sendJSON(res, result.data);
    });
}

// ------------------------------------------------------------
// MAIN SERVER
// ------------------------------------------------------------
const server = http.createServer((req, res) => {
    const url = req.url;

    if (serveStatic(req, res)) return;

    if (req.method === "GET" && url === "/projects") return handleProjects(req, res);
    if (req.method === "GET" && url.startsWith("/history/")) {
        const project = url.split("/")[2];
        return handleHistory(req, res, project);
    }
    if (req.method === "POST" && url === "/chat") return handleChat(req, res);
    if (req.method === "POST" && url === "/upload") return handleUpload(req, res);
    if (req.method === "POST" && url === "/ingest") return handleIngest(req, res);
    if (req.method === "GET" && url === "/profiles") return handleProfiles(req, res);
    if (req.method === "GET" && url.startsWith("/sessions/")) {
        const project = url.split("/")[2];
        return handleListSessions(req, res, project);
    }
    if (req.method === "POST" && url === "/sessions") return handleChatSessions(req, res);
    if (req.method === "GET" && url === "/settings") return handleGetSettings(req, res);
    if (req.method === "POST" && url === "/settings") return handleSetSettings(req, res);
    if (req.method === "POST" && url === "/settings/test-key") return handleTestKey(req, res);

    res.writeHead(404);
    res.end("Not found");
});

server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
        console.error(`⚠ Port ${PORT} already in use — trying ${PORT + 1}`);
        server.listen(PORT + 1);
    } else {
        console.error("❌ Server error:", err);
    }
});

server.listen(PORT, () => {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `Server started on port ${PORT}\n`);
    console.log(`ProtoAI server listening on http://127.0.0.1:${PORT}/`);
});
