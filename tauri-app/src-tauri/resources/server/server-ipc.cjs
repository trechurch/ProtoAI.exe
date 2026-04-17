// =============================================================================
// server-ipc.cjs — ProtoAI IPC Server (stdin/stdout JSON-lines)
// =============================================================================
// Message format:
//   Request:  { "id": "uuid", "type": "chat|projects|...", "payload": { ... } }
//   Response: { "id": "uuid", "ok": true,  "data": { ... } }
//          or { "id": "uuid", "ok": false, "error": "msg", "detail": "..." }
// =============================================================================

"use strict";

// ── stdout guard ──────────────────────────────────────────────────────────────
// stdout is the IPC channel. Redirect ALL console.log to stderr immediately
// so no startup banner or stray log ever corrupts the JSON-lines stream.
// Must happen before ANY other code runs.
// ── end of stdout guard ───────────────────────────────────────────────────────
console.log = (...args) => console.error(...args);

// ── crash handlers ────────────────────────────────────────────────────────────
// Register FIRST — before any require() — so startup errors are caught.
// These keep the process alive on non-fatal errors. Fatal startup failures
// (missing required core modules) call _fatalStartup() instead.
// ── end of crash handlers ─────────────────────────────────────────────────────
process.on("uncaughtException", (err) => {
  _safeLog("[server-ipc] uncaughtException:", err.message || String(err));
  // Don't exit — the queue will continue processing other messages.
});
process.on("unhandledRejection", (reason) => {
  _safeLog("[server-ipc] unhandledRejection:", String(reason));
});

// ── core requires (fatal if missing) ─────────────────────────────────────────
// Only node built-ins here — guaranteed available.
// ── end of core requires ─────────────────────────────────────────────────────
const fs   = require("fs");
const path = require("path");

// ── safe logging (usable before LOG_FILE is set) ─────────────────────────────
let _logFile = null;

function _safeLog(...args) {
  const line = args.map(a =>
    a instanceof Error ? `${a.message}\n${a.stack}` :
    typeof a === "string" ? a :
    JSON.stringify(a)
  ).join(" ");

  process.stderr.write(line + "\n");

  if (_logFile) {
    try { fs.appendFileSync(_logFile, line + "\n"); } catch { /* log file not writable */ }
  }
}
// ── end of safe logging ───────────────────────────────────────────────────────

// ── safe require ─────────────────────────────────────────────────────────────
// Wraps require() so a missing optional dependency returns null instead of
// crashing the server. Core dependencies use _requireStrict() which calls
// _fatalStartup() on failure.
// ── end of safe require ───────────────────────────────────────────────────────
function _safeRequire(mod, label) {
  try {
    return require(mod);
  } catch (err) {
    _safeLog(`[server-ipc] Optional module unavailable: ${label || mod} — ${err.message}`);
    return null;
  }
}

function _requireStrict(mod, label) {
  try {
    return require(mod);
  } catch (err) {
    _fatalStartup(`Required module missing: ${label || mod}\n${err.message}`);
  }
}

// ── fatal startup ─────────────────────────────────────────────────────────────
// Called when a truly unrecoverable startup condition is hit.
// Writes a structured error to stdout so the Rust side knows what happened,
// then exits cleanly (code 1) — the watchdog will restart.
// ── end of fatal startup ─────────────────────────────────────────────────────
function _fatalStartup(reason) {
  _safeLog(`[server-ipc] FATAL STARTUP: ${reason}`);
  try {
    process.stdout.write(JSON.stringify({
      id: "startup",
      ok: false,
      error: "Server startup failed",
      detail: reason
    }) + "\n");
  } catch { /* stdout may not be writable */ }
  process.exit(1);
}

// ── startup banner ────────────────────────────────────────────────────────────
_safeLog(">>> ProtoAI IPC server (stdin/stdout JSON-lines) starting...");
_safeLog("    script:", __filename);

// ── paths + logging setup ─────────────────────────────────────────────────────
const paths = _requireStrict("./access/env/paths", "paths");

try {
  _logFile = paths.data("logs", "server-ipc.log");
  fs.mkdirSync(path.dirname(_logFile), { recursive: true });
  fs.appendFileSync(_logFile, `\n--- IPC server started at ${new Date().toISOString()} ---\n`);
} catch (err) {
  _safeLog("[server-ipc] Warning: could not open log file:", err.message);
  _logFile = null;
}

function log(...args) { _safeLog(...args); }
// ── end of paths + logging setup ─────────────────────────────────────────────

// ── repositories ─────────────────────────────────────────────────────────────
const FsProjectRepository = _requireStrict("./access/fs/FsProjectRepository", "FsProjectRepository");
const FsMemoryRepository  = _safeRequire("./access/fs/FsMemoryRepository",  "FsMemoryRepository");
const FsProfileRepository = _requireStrict("./access/fs/FsProfileRepository", "FsProfileRepository");

const projectRepo = new FsProjectRepository();
const memoryRepo  = FsMemoryRepository  ? new FsMemoryRepository()  : null;
const profileRepo = new FsProfileRepository();
// ── end of repositories ───────────────────────────────────────────────────────

// ── settings ──────────────────────────────────────────────────────────────────
const SettingsManager = _requireStrict("./lib/SettingsManager", "SettingsManager");
const settingsManager = new SettingsManager(paths.data("settings.json"));
// ── end of settings ───────────────────────────────────────────────────────────

// ── workflow registry ────────────────────────────────────────────────────────
const WorkflowRegistry = _requireStrict("./orchestration/WorkflowRegistry", "WorkflowRegistry");
const registry = new WorkflowRegistry();

// ── core workflows (required) ─────────────────────────────────────────────────
const SendMessageWorkflow  = _requireStrict("./orchestration/workflows/SendMessageWorkflow",  "SendMessageWorkflow");
const ImageGenWorkflow     = _requireStrict("./orchestration/workflows/ImageGenWorkflow",     "ImageGenWorkflow");
const DeepSearchWorkflow   = _requireStrict("./orchestration/workflows/DeepSearchWorkflow",   "DeepSearchWorkflow");
const ChatSessionWorkflow  = _requireStrict("./orchestration/workflows/ChatSessionWorkflow",  "ChatSessionWorkflow");

registry.register("SendMessageWorkflow",  new SendMessageWorkflow());
registry.register("ImageGenWorkflow",     new ImageGenWorkflow());
registry.register("DeepSearchWorkflow",   new DeepSearchWorkflow());
registry.register("ChatSessionWorkflow",  new ChatSessionWorkflow());

// ── optional workflows (graceful degradation if deps missing) ─────────────────
// IngestWorkflow depends on @tobilu/qmd which may not be installed.
// If it fails to load, qmd_index and qmd_search return a clear "unavailable"
// error rather than crashing the entire server.
const IngestWorkflow = _safeRequire("./orchestration/workflows/IngestWorkflow", "IngestWorkflow");
const QMD_AVAILABLE  = !!IngestWorkflow;

if (QMD_AVAILABLE) {
  try {
    registry.register("IngestWorkflow", new IngestWorkflow());
    log("[server-ipc] QMD / IngestWorkflow: available");
  } catch (err) {
    log(`[server-ipc] IngestWorkflow instantiation failed: ${err.message} — QMD disabled`);
  }
} else {
  log("[server-ipc] QMD / IngestWorkflow: unavailable (optional — skipped)");
}
// ── VFS workflows (always available — no external deps) ──────────────────────
const VfsAddWorkflow      = _safeRequire('./orchestration/workflows/VfsAddWorkflow',      'VfsAddWorkflow');
const VfsListWorkflow     = _safeRequire('./orchestration/workflows/VfsListWorkflow',     'VfsListWorkflow');
const VfsManifestWorkflow = _safeRequire('./orchestration/workflows/VfsManifestWorkflow', 'VfsManifestWorkflow');
const VfsUpdatePermissionsWorkflow = _safeRequire('./orchestration/workflows/VfsUpdatePermissionsWorkflow', 'VfsUpdatePermissionsWorkflow');
const VFS_AVAILABLE       = !!(VfsAddWorkflow && VfsListWorkflow && VfsManifestWorkflow);

if (VFS_AVAILABLE) {
  registry.register('VfsAddWorkflow',      new VfsAddWorkflow());
  registry.register('VfsListWorkflow',     new VfsListWorkflow());
  registry.register('VfsManifestWorkflow', new VfsManifestWorkflow());
  if (VfsUpdatePermissionsWorkflow) registry.register('VfsUpdatePermissionsWorkflow', new VfsUpdatePermissionsWorkflow());
  log('[server-ipc] VFS workflows: available');
} else {
  log('[server-ipc] VFS workflows: one or more missing — VFS disabled');
}
// ── search history workflow ──────────────────────────────────────────────────
const SearchHistoryWorkflow = _safeRequire('./orchestration/workflows/SearchHistoryWorkflow', 'SearchHistoryWorkflow');
if (SearchHistoryWorkflow) {
  registry.register('SearchHistoryWorkflow', new SearchHistoryWorkflow());
  log('[server-ipc] SearchHistoryWorkflow: available');
}
// ── end of workflow registry ──────────────────────────────────────────────────

log(">>> ProtoAI IPC server READY");

// =============================================================================
// IPC Helpers
// =============================================================================

function safeJsonParse(str) {
  try   { return { ok: true,  value: JSON.parse(str) }; }
  catch (err) { return { ok: false, error: err }; }
}

function writeResponse(obj) {
  if (obj === null || obj === undefined) return; // never write null to stdout
  try {
    process.stdout.write(JSON.stringify(obj) + "\n");
  } catch (err) {
    log("❌ Failed to serialize IPC response:", err.message);
  }
}

// =============================================================================
// Handler implementations
// =============================================================================

// ── projects ──────────────────────────────────────────────────────────────────
function handleProjectsIPC() {
  try {
    const projects = projectRepo.listProjects();
    return { projects: projects || [] };
  } catch (err) {
    log("❌ handleProjectsIPC failed:", err.message);
    return { projects: [] };
  }
}

// ── history ───────────────────────────────────────────────────────────────────
function handleHistoryIPC(payload) {
  const { project } = payload || {};
  if (!project) return { ok: false, error: "Missing 'project'" };
  try {
    const history = projectRepo.getHistory(project);
    return { history: history || [] };
  } catch (err) {
    log("❌ handleHistoryIPC failed:", err.message);
    return { history: [] };
  }
}

// ── chat ──────────────────────────────────────────────────────────────────────
async function handleChatIPC(payload, requestId) {
  const { project, message, profile, engine, stream } = payload || {};

  if (!project) return { ok: false, error: "Missing 'project'" };
  if (!message) return { ok: false, error: "Missing 'message'" };
  if (!profile) return { ok: false, error: "Missing 'profile'" };

  log("\n==============================");
  log("📨 CHAT REQUEST (IPC)");
  log("Project:", project, "| Profile:", profile, "| Engine:", engine || "default");
  log("Stream:", !!stream, "| Message:", message.slice(0, 80) + (message.length > 80 ? "…" : ""));
  log("==============================\n");

  let fullStreamedReply = "";
  const onChunk = stream ? (token) => {
    fullStreamedReply += token;
    writeResponse({ id: requestId, ok: true, type: "stream", chunk: token });
  } : null;

  try {
    const workflow = registry.get("SendMessageWorkflow");
    const result = await workflow.run({ project, message, profile, engine, onChunk });
    log("[DEBUG] SendMessageWorkflow result status:", result?.status);

    if (result.status === "error") {
      return { ok: false, ...(result.data || { error: "Workflow error" }) };
    }

    const reply = result.data?.streaming ? fullStreamedReply : result.data?.reply;

    if (stream && fullStreamedReply) {
      try {
        const repo = new FsProjectRepository();
        repo.appendToHistory(project, { timestamp: Date.now(), role: "user",      message });
        repo.appendToHistory(project, { timestamp: Date.now(), role: "assistant", message: fullStreamedReply });
      } catch (err) {
        log("⚠ History save failed:", err.message);
      }
    }

    return { response: reply || "" };
  } catch (err) {
    log("❌ Chat workflow crashed:", err.message);
    return { ok: false, error: "Chat workflow crashed", detail: String(err) };
  }
}

// ── upload ────────────────────────────────────────────────────────────────────
function handleUploadIPC(payload) {
  const { project, filename, content } = payload || {};
  if (!project)  return { ok: false, error: "Missing 'project'" };
  if (!filename) return { ok: false, error: "Missing 'filename'" };
  try {
    const projectDir = paths.projectDir(project);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(path.join(projectDir, filename), content || "", "utf8");
    return { status: "ok" };
  } catch (err) {
    return { ok: false, error: "Upload failed", detail: err.message };
  }
}

// ── ingest ────────────────────────────────────────────────────────────────────
function handleIngestIPC(payload) {
  const { project, withContents } = payload || {};
  if (!project) return { ok: false, error: "Missing 'project'" };

  const projectDir = paths.projectDir(project);
  if (!fs.existsSync(projectDir)) return { files: [] };

  try {
    const files = fs.readdirSync(projectDir).filter(f =>
      fs.statSync(path.join(projectDir, f)).isFile()
    );

    if (!withContents) {
      return { files: files.map(f => ({ filename: f })) };
    }

    const fileContents = [];
    const MAX_BYTES = 65536;
    let totalBytes = 0;

    for (const f of files) {
      if (totalBytes >= MAX_BYTES) {
        fileContents.push({ filename: f, truncated: true, error: "Size limit reached" });
        continue;
      }
      try {
        const content = fs.readFileSync(path.join(projectDir, f), "utf8");
        fileContents.push({ filename: f, content });
        totalBytes += content.length;
      } catch (err) {
        log(`⚠ Could not read "${f}":`, err.message);
        fileContents.push({ filename: f, error: err.message });
      }
    }

    return { files: fileContents, totalBytes, fileCount: files.length };
  } catch (err) {
    return { ok: false, error: "Ingest failed", detail: err.message };
  }
}

// ── profiles ──────────────────────────────────────────────────────────────────
function handleProfilesIPC() {
  try {
    const profiles = profileRepo.loadProfiles();
    return { profiles: profiles || [] };
  } catch (err) {
    log("❌ handleProfilesIPC failed:", err.message);
    return { profiles: [] };
  }
}

// ── image gen ─────────────────────────────────────────────────────────────────
async function handleImageGenIPC(payload) {
  const { text, project } = payload || {};
  if (!text) return { ok: false, error: "Missing 'text'" };
  try {
    const workflow = registry.get("ImageGenWorkflow");
    return await workflow.run({ text, project });
  } catch (err) {
    return { ok: false, error: "Image generation failed", detail: err.message };
  }
}

// ── deep search ───────────────────────────────────────────────────────────────
async function handleDeepSearchIPC(payload) {
  const { query } = payload || {};
  if (!query) return { ok: false, error: "Missing 'query'" };
  try {
    const workflow = registry.get("DeepSearchWorkflow");
    return await workflow.run({ query });
  } catch (err) {
    return { ok: false, error: "Deep search failed", detail: err.message };
  }
}

// ── settings ──────────────────────────────────────────────────────────────────
async function handleSettingsIPC(payload) {
  const { action, key, value, provider } = payload || {};
  try {
    if (action === "get") {
      return { settings: settingsManager.exportAll() };
    }
    if (action === "set") {
      if (key && value !== undefined) {
        settingsManager.set(key, value);
      } else if (value !== undefined) {
        settingsManager.importAll(value);
      }
      return { settings: settingsManager.exportAll() };
    }
    if (action === "testKey") {
      if (!provider) return { ok: false, error: "Missing 'provider' for testKey" };
      const result = await settingsManager.validateApiKey(provider, value);
      return result;
    }
    return { ok: false, error: `Unknown settings action: ${action}` };
  } catch (err) {
    log("❌ Settings handler error:", err.message);
    return { ok: false, error: "Settings operation failed", detail: err.message };
  }
}

// ── qmd index ─────────────────────────────────────────────────────────────────
async function handleQmdIndexIPC(payload) {
  if (!QMD_AVAILABLE || !registry.has("IngestWorkflow")) {
    return { ok: false, error: "QMD not available", detail: "IngestWorkflow not loaded — @tobilu/qmd may not be installed" };
  }
  const { project, deep_scan = false } = payload || {};
  if (!project) return { ok: false, error: "Missing 'project'" };
  try {
    const workflow = registry.get("IngestWorkflow");
    return await workflow.run({ project, deep_scan });
  } catch (err) {
    return { ok: false, error: "QMD indexing failed", detail: err.message };
  }
}

// ── qmd search ────────────────────────────────────────────────────────────────
async function handleQmdSearchIPC(payload) {
  if (!QMD_AVAILABLE || !registry.has("IngestWorkflow")) {
    return { ok: false, error: "QMD not available", detail: "IngestWorkflow not loaded — @tobilu/qmd may not be installed" };
  }
  const { query, project, sql = false } = payload || {};
  if (!query) return { ok: false, error: "Missing 'query'" };
  try {
    const workflow = registry.get("IngestWorkflow");
    return await workflow.search({ query, project, sql });
  } catch (err) {
    return { ok: false, error: "QMD search failed", detail: err.message };
  }
}

// ── vfs_add ───────────────────────────────────────────────────────────────────
async function handleVfsAddIPC(payload) {
  if (!VFS_AVAILABLE || !registry.has('VfsAddWorkflow')) {
    return { ok: false, error: 'VFS not available' };
  }
  const { project, realPath, permissions, recursive } = payload || {};
  if (!project)  return { ok: false, error: "Missing 'project'" };
  if (!realPath) return { ok: false, error: "Missing 'realPath'" };
  try {
    const wf = registry.get('VfsAddWorkflow');
    const r  = await wf.run({ project, realPath, permissions, recursive });
    return r.status === 'ok' ? r.data : { ok: false, error: r.error };
  } catch (err) {
    return { ok: false, error: 'VFS add failed', detail: err.message };
  }
}

// ── vfs_list ──────────────────────────────────────────────────────────────────
async function handleVfsListIPC(payload) {
  if (!VFS_AVAILABLE || !registry.has('VfsListWorkflow')) {
    return { ok: false, error: 'VFS not available' };
  }
  const { project, includeManifests } = payload || {};
  if (!project) return { ok: false, error: "Missing 'project'" };
  try {
    const wf = registry.get('VfsListWorkflow');
    const r  = await wf.run({ project, includeManifests });
    return r.status === 'ok' ? r.data : { ok: false, error: r.error };
  } catch (err) {
    return { ok: false, error: 'VFS list failed', detail: err.message };
  }
}

// ── vfs_manifest ──────────────────────────────────────────────────────────────
async function handleVfsManifestIPC(payload) {
  if (!VFS_AVAILABLE || !registry.has('VfsManifestWorkflow')) {
    return { ok: false, error: 'VFS not available' };
  }
  const { project, id, entryId, realPath, regenerate } = payload || {};
  if (!project) return { ok: false, error: "Missing 'project'" };
  try {
    const wf = registry.get('VfsManifestWorkflow');
    const r  = await wf.run({ project, id: id || entryId, realPath, regenerate: regenerate || regenerate });
    return r.status === 'ok' ? r.data : { ok: false, error: r.error };
  } catch (err) {
    return { ok: false, error: 'VFS manifest failed', detail: err.message };
  }
}

// ── vfs_permissions ──────────────────────────────────────────────────────────
async function handleVfsPermissionsIPC(payload) {
  if (!VFS_AVAILABLE || !registry.has('VfsUpdatePermissionsWorkflow')) {
    return { ok: false, error: 'VFS permissions workflow not available' };
  }
  const { project, id, permissions } = payload || {};
  if (!project) return { ok: false, error: "Missing 'project'" };
  if (!id)      return { ok: false, error: "Missing 'id'" };
  try {
    const wf = registry.get('VfsUpdatePermissionsWorkflow');
    const r  = await wf.run({ project, id, permissions });
    return r.status === 'ok' ? r.data : { ok: false, error: r.error };
  } catch (err) {
    return { ok: false, error: 'VFS permissions update failed', detail: err.message };
  }
}

// ── list_files ────────────────────────────────────────────────────────────────
async function handleListFilesIPC(payload) {
  const { project, path: folderPath, realPath } = payload || {};
  try {
    const wf = registry.get('ListFilesWorkflow');
    const r  = await wf.run({ project, path: folderPath, realPath });
    return r.status === 'ok' ? r.data : { ok: false, error: r.error };
  } catch (err) {
    return { ok: false, error: 'List files failed', detail: err.message };
  }
}

// ── search_history ───────────────────────────────────────────────────────────
async function handleSearchHistoryIPC(payload) {
  if (!registry.has('SearchHistoryWorkflow')) {
    return { ok: false, error: 'SearchHistoryWorkflow not available' };
  }
  const { project, query, limit, allProjects } = payload || {};
  if (!query) return { ok: false, error: "Missing 'query'" };
  try {
    const wf = registry.get('SearchHistoryWorkflow');
    const r  = await wf.run({ project, query, limit, allProjects });
    return r.status === 'ok' ? r.data : { ok: false, error: r.error };
  } catch (err) {
    return { ok: false, error: 'Search history failed', detail: err.message };
  }
}

// =============================================================================
// IPC dispatcher
// =============================================================================

async function dispatchMessage(msg) {
  const { id, type, payload } = msg;

  if (!id) {
    log("❌ IPC message missing 'id' — cannot respond");
    return null; // can't send a structured error without an id
  }
  if (!type) {
    return { id, ok: false, error: "Missing 'type' in IPC message" };
  }

  let result;
  try {
    switch (type) {
      case "projects":    result = handleProjectsIPC();               break;
      case "history":     result = handleHistoryIPC(payload);         break;
      case "chat":        result = await handleChatIPC(payload, id);  break;
      case "upload":      result = handleUploadIPC(payload);          break;
      case "ingest":      result = handleIngestIPC(payload);          break;
      case "profiles":    result = handleProfilesIPC();               break;
      case "image_gen":   result = await handleImageGenIPC(payload);  break;
      case "deep_search": result = await handleDeepSearchIPC(payload); break;
      case "settings":    result = await handleSettingsIPC(payload);  break;
      case "qmd_index":   result = await handleQmdIndexIPC(payload);  break;
      case "qmd_search":  result = await handleQmdSearchIPC(payload);  break;
      case "vfs_add":      result = await handleVfsAddIPC(payload);      break;
      case "vfs_list":     result = await handleVfsListIPC(payload);     break;
      case "vfs_manifest": result = await handleVfsManifestIPC(payload); break;
      case "vfs_permissions": result = await handleVfsPermissionsIPC(payload); break;
      case "list_files":         result = await handleListFilesIPC(payload);         break;
      case "search_history":     result = await handleSearchHistoryIPC(payload);     break;
      default:
        return { id, ok: false, error: `Unknown message type: ${type}` };
    }
  } catch (err) {
    log(`❌ Unhandled error in handler for type "${type}":`, err.message);
    return { id, ok: false, error: "Handler crashed", detail: String(err) };
  }

  if (result && result.ok === false) {
    return { id, ...result };
  }

  return { id, ok: true, data: result };
}

// =============================================================================
// stdin JSON-lines reader
// =============================================================================

let _buffer     = "";
let _processing = false;
const _queue    = [];

process.stdin.setEncoding("utf8");

process.stdin.on("data", chunk => {
  _buffer += chunk;
  let index;
  while ((index = _buffer.indexOf("\n")) >= 0) {
    const line = _buffer.slice(0, index).trim();
    _buffer = _buffer.slice(index + 1);
    if (!line) continue;

    const parsed = safeJsonParse(line);
    if (!parsed.ok) {
      log("❌ Failed to parse IPC line:", line.slice(0, 200));
      continue;
    }
    _queue.push(parsed.value);
  }
  _drainQueue();
});

function _drainQueue() {
  if (_processing || _queue.length === 0) return;
  _processNext();
}

async function _processNext() {
  if (_queue.length === 0) { _processing = false; return; }
  _processing = true;

  const msg = _queue.shift();
  try {
    const response = await dispatchMessage(msg);
    writeResponse(response);
  } catch (err) {
    log("❌ IPC dispatch error:", err.message);
    const id = msg?.id || null;
    if (id) writeResponse({ id, ok: false, error: "IPC dispatch error", detail: String(err) });
  }

  // Process next message — serial queue, one at a time
  setImmediate(_processNext);
}

process.stdin.on("end", () => {
  log("📥 stdin closed — IPC server shutting down");
  process.exit(0);
});

process.on("SIGINT",  () => { log("🛑 SIGINT");  process.exit(0); });
process.on("SIGTERM", () => { log("🛑 SIGTERM"); process.exit(0); });
