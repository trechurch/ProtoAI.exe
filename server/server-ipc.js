// server-ipc.js
// -----------------------------------------------------------------------------
// ProtoAI IPC Server — stdin/stdout JSON-lines protocol
// -----------------------------------------------------------------------------
// This file runs the same core logic as server.js, but instead of exposing an
// HTTP server, it listens for JSON messages on stdin and writes JSON responses
// on stdout.
//
// Message format (one JSON object per line):
//   Request:  { "id": "uuid-or-counter", "type": "chat|projects|history|upload|ingest|profiles", "payload": { ... } }
//   Response: { "id": "same-as-request", "ok": true, "data": { ... } }
//          or { "id": "same-as-request", "ok": false, "error": "message", "detail": "optional detail" }
//
// This is designed to be called by the Tauri EngineBridge via a persistent
// child process using stdin/stdout.
// -----------------------------------------------------------------------------

// Redirect console.log → stderr so startup banners never corrupt the JSON-lines stdout stream
console.log = (...args) => console.error(...args);

console.log("🔥 SERVER-IPC.JS LOADED FROM:", __filename);
console.log(">>> ProtoAI IPC server (stdin/stdout JSON-lines) LOADED");

// Crash handlers — only exit on truly fatal errors
process.on("uncaughtException", (err) => {
  console.error("[server-ipc] uncaughtException:", err);
  // Don't exit — the queue will continue processing.
  // The Rust watchdog will restart us if we do crash.
});
process.on("unhandledRejection", (reason) => {
  console.error("[server-ipc] unhandledRejection:", reason);
  // Log and keep running — the queue handler catches errors.
});

const fs = require("fs");
const path = require("path");

// Workflow Engine
const WorkflowRegistry = require("./orchestration/WorkflowRegistry");
const SendMessageWorkflow = require("./orchestration/workflows/SendMessageWorkflow");
const ImageGenWorkflow = require("./orchestration/workflows/ImageGenWorkflow");
const DeepSearchWorkflow = require("./orchestration/workflows/DeepSearchWorkflow");
const ChatSessionWorkflow = require("./orchestration/workflows/ChatSessionWorkflow");
const IngestWorkflow = require("./orchestration/workflows/IngestWorkflow");

// Access Layer
const paths = require("./access/env/paths");
const FsProjectRepository = require("./access/fs/FsProjectRepository");
const FsMemoryRepository = require("./access/fs/FsMemoryRepository");
const FsProfileRepository = require("./access/fs/FsProfileRepository");

// Instantiate workflow engine
const registry = new WorkflowRegistry();
registry.register("SendMessageWorkflow", new SendMessageWorkflow());
registry.register("ImageGenWorkflow", new ImageGenWorkflow());
registry.register("DeepSearchWorkflow", new DeepSearchWorkflow());
registry.register("ChatSessionWorkflow", new ChatSessionWorkflow());
registry.register("IngestWorkflow", new IngestWorkflow());

// Instantiate repositories
const projectRepo = new FsProjectRepository();
const memoryRepo = new FsMemoryRepository();
const profileRepo = new FsProfileRepository();

// Settings
const SettingsManager = require("./lib/SettingsManager");
const settingsManager = new SettingsManager(paths.data("settings.json"));

// Logging
const LOG_FILE = paths.data("logs", "server-ipc.log");
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
fs.appendFileSync(LOG_FILE, `IPC server started at ${new Date().toISOString()}\n`);

// -----------------------------------------------------------------------------
// Helpers: logging + safe JSON
// -----------------------------------------------------------------------------
function log(...args) {
  const line = args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  fs.appendFileSync(LOG_FILE, line + "\n");
  console.error(...args); // stderr only — stdout is reserved for JSON-lines IPC
}

function safeJsonParse(str) {
  try {
    return { ok: true, value: JSON.parse(str) };
  } catch (err) {
    return { ok: false, error: err };
  }
}

function writeResponse(obj) {
  try {
    const line = JSON.stringify(obj);
    process.stdout.write(line + "\n");
  } catch (err) {
    // If we can't even serialize, log and bail
    log("❌ Failed to serialize response:", err);
  }
}

// -----------------------------------------------------------------------------
// Handler implementations (duplicated from server.js, but adapted to IPC)
// -----------------------------------------------------------------------------

// projects: list all projects
function handleProjectsIPC() {
  const projects = projectRepo.listProjects();
  return { projects };
}

// history: get history for a project
function handleHistoryIPC(payload) {
  const { project } = payload || {};
  if (!project) {
    return { ok: false, error: "Missing 'project' in payload for history" };
  }
  const history = projectRepo.getHistory(project);
  return { history };
}

// chat: run SendMessageWorkflow
async function handleChatIPC(payload) {
  const { project, message, profile, engine } = payload || {};

  if (!project) return { ok: false, error: "Missing 'project' in payload for chat" };
  if (!message) return { ok: false, error: "Missing 'message' in payload for chat" };
  if (!profile) return { ok: false, error: "Missing 'profile' in payload for chat" };

  log("\n==============================");
  log("📨 CHAT REQUEST RECEIVED (IPC)");
  log("Project:", project);
  log("Profile:", profile);
  log("Engine:", engine);
  log("Message:", message);
  log("==============================\n");

  try {
    const workflow = registry.get("SendMessageWorkflow");
    const result = await workflow.run({ project, message, profile, engine });

    if (result.status === "error") {
      return { ok: false, ...result.data };
    }
    return { response: result.data.reply };
  } catch (err) {
    log("❌ Chat workflow crashed:", err);
    return { ok: false, error: "Chat workflow crashed", detail: String(err) };
  }
}

// upload: write a file into a project directory
function handleUploadIPC(payload) {
  const { project, filename, content } = payload || {};
  if (!project) return { ok: false, error: "Missing 'project' in payload for upload" };
  if (!filename) return { ok: false, error: "Missing 'filename' in payload for upload" };

  try {
    const projectDir = paths.projectDir(project);
    fs.mkdirSync(projectDir, { recursive: true });
    const filePath = path.join(projectDir, filename);
    fs.writeFileSync(filePath, content || "", "utf8");
  } catch (err) {
    return { ok: false, error: "Upload failed", detail: err.message };
  }
  return { status: "ok" };
}

// ingest: list files in a project directory (lightweight by default, or read contents)
function handleIngestIPC(payload) {
  const { project, withContents } = payload || {};
  if (!project) return { ok: false, error: "Missing 'project' in payload for ingest" };

  const projectDir = paths.projectDir(project);

  if (!fs.existsSync(projectDir)) {
    return { files: [] };
  }

  const files = fs.readdirSync(projectDir).filter(f => {
    const full = path.join(projectDir, f);
    return fs.statSync(full).isFile();
  });

  // Default: name-only (non-blocking, fast)
  // withContents=true: read all file contents (slow, use sparingly)
  if (!withContents) {
    const fileNames = files.map(f => ({ filename: f }));
    return { files: fileNames };
  }

  const fileContents = [];
  const MAX_BYTES = 65536; // 64KB total cap
  let totalBytes = 0;
  for (const f of files) {
    if (totalBytes >= MAX_BYTES) {
      fileContents.push({ filename: f, truncated: true, error: "Size limit reached" });
      continue;
    }
    const full = path.join(projectDir, f);
    try {
      const content = fs.readFileSync(full, "utf8");
      fileContents.push({ filename: f, content });
      totalBytes += content.length;
    } catch (err) {
      log(`⚠ Could not read file "${f}":`, err.message);
      fileContents.push({ filename: f, error: err.message });
    }
  }

  return {
    files: fileContents,
    totalBytes,
    fileCount: files.length,
  };
}

// profiles: load profiles from repository
function handleProfilesIPC() {
  const profiles = profileRepo.loadProfiles();
  return { profiles };
}

// image_gen: generate image via Pollinations.ai
async function handleImageGenIPC(payload) {
  const { text, project } = payload || {};
  if (!text) return { ok: false, error: "Missing 'text' in payload for image_gen" };
  try {
    const workflow = registry.get("ImageGenWorkflow");
    return await workflow.run({ text, project });
  } catch (err) {
    return { ok: false, error: "Image generation failed", detail: err.message };
  }
}

// deep_search: run deep search via Wikipedia, DuckDuckGo, arXiv
async function handleDeepSearchIPC(payload) {
  const { query } = payload || {};
  if (!query) return { ok: false, error: "Missing 'query' in payload for deep_search" };
  try {
    const workflow = registry.get("DeepSearchWorkflow");
    return await workflow.run({ query });
  } catch (err) {
    return { ok: false, error: "Deep search failed", detail: err.message };
  }
}

// settings: get all, set key, test key
async function handleSettingsIPC(payload) {
  const { action, key, value, provider } = payload || {};
  try {
    if (action === "get") return { settings: settingsManager.exportAll() };
    if (action === "set") {
      if (key && value !== undefined) {
        settingsManager.set(key, value);
      } else if (value !== undefined) {
        settingsManager.importAll(value);
      }
      return { settings: settingsManager.exportAll() };
    }
    if (action === "testKey") {
      const result = await settingsManager.validateApiKey(provider, value);
      return result;
    }
    return { ok: false, error: "Unknown settings action" };
  } catch (err) {
    log("❌ Settings handler error:", err.message);
    return { ok: false, error: "Settings operation failed", detail: err.message };
  }
}

// qmd_index: index project into qmd vector store
async function handleQmdIndexIPC(payload) {
  const { project, deep_scan = false } = payload || {};
  if (!project) return { ok: false, error: "Missing 'project' in payload for qmd_index" };
  try {
    const workflow = registry.get("IngestWorkflow");
    return await workflow.run({ project, deep_scan });
  } catch (err) {
    return { ok: false, error: "QMD indexing failed", detail: err.message };
  }
}

// qmd_search: search indexed project content via qmd
async function handleQmdSearchIPC(payload) {
  const { query, project, sql = false } = payload || {};
  if (!query) return { ok: false, error: "Missing 'query' in payload for qmd_search" };
  try {
    const workflow = registry.get("IngestWorkflow");
    return await workflow.search({ query, project, sql });
  } catch (err) {
    return { ok: false, error: "QMD search failed", detail: err.message };
  }
}

// -----------------------------------------------------------------------------
// IPC message dispatcher
// -----------------------------------------------------------------------------

async function dispatchMessage(msg) {
  const { id, type, payload } = msg;

  if (!id) {
    log("❌ Missing 'id' in IPC message");
    return null; // Can't send structured error back
  }
  if (!type) {
    return { id, ok: false, error: "Missing 'type' in IPC message" };
  }

  let result;
  switch (type) {
    case "projects":
      result = handleProjectsIPC(); break;
    case "history":
      result = handleHistoryIPC(payload); break;
    case "chat":
      result = await handleChatIPC(payload); break;
    case "upload":
      result = handleUploadIPC(payload); break;
    case "ingest":
      result = handleIngestIPC(payload); break;
    case "profiles":
      result = handleProfilesIPC(); break;
    case "image_gen":
      result = await handleImageGenIPC(payload); break;
    case "deep_search":
      result = await handleDeepSearchIPC(payload); break;
    case "settings":
      result = await handleSettingsIPC(payload); break;
    case "qmd_index":
      result = await handleQmdIndexIPC(payload); break;
    case "qmd_search":
      result = await handleQmdSearchIPC(payload); break;
    default:
      return { id, ok: false, error: `Unknown message type: ${type}` };
  }

  // Handlers either return { ok: false, ... } or a success shape (data, projects, etc.)
  if (result && result.ok === false) {
    return { id, ...result };
  }

  return { id, ok: true, data: result };
}

// -----------------------------------------------------------------------------
// stdin JSON-lines reader
// -----------------------------------------------------------------------------

let buffer = "";
let processing = false;
const messageQueue = [];

process.stdin.setEncoding("utf8");

process.stdin.on("data", chunk => {
  buffer += chunk;

  let index;
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);

    if (!line) continue;

    const parsed = safeJsonParse(line);
    if (!parsed.ok) {
      log("❌ Failed to parse IPC line:", line, parsed.error);
      continue;
    }

    messageQueue.push(parsed.value);
    processQueue();
  }
});

async function processQueue() {
  if (processing || messageQueue.length === 0) return;
  processing = true;

  try {
    while (messageQueue.length > 0) {
      const msg = messageQueue.shift();
      try {
        const response = await dispatchMessage(msg);
        writeResponse(response);
      } catch (err) {
        log("❌ IPC dispatch error:", err);
        const id = msg && msg.id ? msg.id : null;
        if (id) {
          writeResponse({
            id,
            ok: false,
            error: "IPC dispatch error",
            detail: String(err)
          });
        }
      }
    }
  } finally {
    processing = false;
    // In case new messages arrived while we were processing
    if (messageQueue.length > 0) {
      processQueue();
    }
  }
}

process.stdin.on("end", () => {
  log("📥 stdin ended — shutting down IPC server");
  process.exit(0);
});

process.on("SIGINT", () => {
  log("🛑 SIGINT received — shutting down IPC server");
  process.exit(0);
});

process.on("SIGTERM", () => {
  log("🛑 SIGTERM received — shutting down IPC server");
  process.exit(0);
});
