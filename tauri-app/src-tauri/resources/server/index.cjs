// =============================================================================
// Last modified: 2026-05-04 03:11 UTC
// index.cjs — SDOA v4 ProtoAI IPC Server Bootloader
// =============================================================================

"use strict";

// ── stdout guard ──────────────────────────────────────────────────────────────
console.log = (...args) => console.error(...args);

const fs   = require("fs");
const path = require("path");

const Middleware = require("./services/Middleware.service");
const Router = require("./services/Router.service");
const AuthListener = require("./services/AuthListener.service");

AuthListener.start();

// ── crash handlers ────────────────────────────────────────────────────────────
process.on("uncaughtException", (err) => {
    Middleware.log("[boot] uncaughtException:", err.message || String(err));
});
process.on("unhandledRejection", (reason) => {
    Middleware.log("[boot] unhandledRejection:", String(reason));
});

function _fatalStartup(reason) {
    Middleware.log("[boot] FATAL STARTUP: " + reason);
    try {
        process.stdout.write(JSON.stringify({ id: "startup", ok: false, error: "Server startup failed", detail: reason }) + "\n");
    } catch { /* stdout may not be writable */ }
    process.exit(1);
}

function _requireStrict(mod, label) {
    try { return require(mod); }
    catch (err) { _fatalStartup("Required module missing: " + (label || mod) + "\n" + err.message); }
}

function _safeRequire(mod, label) {
    try { return require(mod); }
    catch (err) { Middleware.log("[boot] Optional module unavailable: " + (label || mod) + " — " + err.message); return null; }
}

function _safeRegister(label, fn) {
    try { fn(); }
    catch (err) { Middleware.log("[boot] Optional workflow unavailable: " + label + " — " + err.message); }
}

// ── paths + logging setup ─────────────────────────────────────────────────────
const paths = _requireStrict("./access/env/paths", "paths");

try {
    const logFile = paths.data("logs", "server-ipc.log");
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    Middleware.initLogging(logFile);
} catch (err) {
    Middleware.initLogging(null);
}

Middleware.log(">>> ProtoAI SDOA v4 IPC server (stdin/stdout JSON-lines) starting...");

// ── repositories & settings ───────────────────────────────────────────────────
const FsProjectRepository = _requireStrict("./access/fs/FsProjectRepository", "FsProjectRepository");
const FsProfileRepository = _requireStrict("./access/fs/FsProfileRepository", "FsProfileRepository");
const SettingsManager     = _requireStrict("./lib/SettingsManager", "SettingsManager");

const projectRepo     = new FsProjectRepository();
const profileRepo     = new FsProfileRepository();
const settingsManager = new SettingsManager(paths.data("settings.json"));

// ── workflow registry ────────────────────────────────────────────────────────
const WorkflowRegistry = _requireStrict("./orchestration/WorkflowRegistry", "WorkflowRegistry");
const registry = new WorkflowRegistry();

// ── core workflows ───────────────────────────────────────────────────────────
const SendMessageWorkflow  = _requireStrict("./orchestration/workflows/SendMessage.workflow",  "SendMessage.workflow");
const ImageGenWorkflow     = _requireStrict("./orchestration/workflows/ImageGen.workflow",     "ImageGen.workflow");
const DeepSearchWorkflow   = _requireStrict("./orchestration/workflows/DeepSearch.workflow",   "DeepSearch.workflow");
const ChatSessionWorkflow  = _requireStrict("./orchestration/workflows/ChatSession.workflow",  "ChatSession.workflow");
const SpawnShellWorkflow   = _requireStrict("./orchestration/workflows/SpawnShell.workflow",   "SpawnShell.workflow");

_safeRegister("SendMessage.workflow",  () => registry.register("SendMessage.workflow",  new SendMessageWorkflow()));
_safeRegister("ImageGen.workflow",     () => registry.register("ImageGen.workflow",     new ImageGenWorkflow()));
_safeRegister("DeepSearch.workflow",   () => registry.register("DeepSearch.workflow",   new DeepSearchWorkflow()));
_safeRegister("ChatSession.workflow",  () => registry.register("ChatSession.workflow",  new ChatSessionWorkflow()));
_safeRegister("SpawnShell.workflow",   () => registry.register("SpawnShell.workflow",   new SpawnShellWorkflow()));

// ── optional / utility workflows ─────────────────────────────────────────────
const IngestWorkflow = _safeRequire("./orchestration/workflows/Ingest.workflow", "Ingest.workflow");
let triggerIngest = null;

if (IngestWorkflow) {
    _safeRegister("Ingest.workflow", () => {
        registry.register("Ingest.workflow", new IngestWorkflow());
        triggerIngest = async (project) => {
            try { await registry.get("Ingest.workflow")?.run({ project }); }
            catch (err) { Middleware.log("[boot] Auto-ingest failed for " + project + ": " + err.message); }
        };
    });
}

const CreateProjectWorkflow      = _safeRequire("./orchestration/workflows/CreateProject.workflow",      "CreateProjectWorkflow");
const MultiModelSendWorkflow     = _safeRequire("./orchestration/workflows/MultiModelSend.workflow",     "MultiModelSendWorkflow");
const VfsAddWorkflow             = _safeRequire("./orchestration/workflows/VfsAdd.workflow",             "VfsAddWorkflow");
const VfsListWorkflow            = _safeRequire("./orchestration/workflows/VfsList.workflow",            "VfsListWorkflow");
const VfsManifestWorkflow        = _safeRequire("./orchestration/workflows/VfsManifest.workflow",        "VfsManifestWorkflow");
const VfsUpdatePermissionsWf     = _safeRequire("./orchestration/workflows/VfsUpdatePermissions.workflow","VfsUpdatePermissionsWorkflow");
const ListFilesWorkflow          = _safeRequire("./orchestration/workflows/ListFiles.workflow",          "ListFilesWorkflow");
const ListProcessesWorkflow      = _safeRequire("./orchestration/workflows/ListProcesses.workflow",      "ListProcessesWorkflow");
const SearchHistoryWorkflow      = _safeRequire("./orchestration/workflows/SearchHistory.workflow",      "SearchHistoryWorkflow");
const FileContextWorkflow        = _safeRequire("./orchestration/workflows/FileContext.workflow",        "FileContextWorkflow");
const FilePermissionsWorkflow    = _safeRequire("./orchestration/workflows/FilePermissions.workflow",    "FilePermissionsWorkflow");
const AutoOptimizeModelsWorkflow = _safeRequire("./orchestration/workflows/AutoOptimizeModels.workflow", "AutoOptimizeModelsWorkflow");
const GoogleDriveWorkflow        = _safeRequire("./orchestration/workflows/GoogleDrive.workflow",        "GoogleDriveWorkflow");
const GetModelInventoryWorkflow  = _safeRequire("./orchestration/workflows/GetModelInventory.workflow",  "GetModelInventoryWorkflow");
const SaveModelInventoryWorkflow = _safeRequire("./orchestration/workflows/SaveModelInventory.workflow", "SaveModelInventoryWorkflow");
const GetPolicyWorkflow          = _safeRequire("./orchestration/workflows/GetPolicy.workflow",          "GetPolicyWorkflow");
const UpdatePolicyWorkflow       = _safeRequire("./orchestration/workflows/UpdatePolicy.workflow",       "UpdatePolicyWorkflow");
const PartnerCommentaryWorkflow  = _safeRequire("./orchestration/workflows/PartnerCommentary.workflow",  "PartnerCommentaryWorkflow");
const SysProvisionModelWorkflow = _safeRequire("./orchestration/workflows/SysProvisionModel.workflow", "SysProvisionModelWorkflow");

_safeRegister("CreateProject.workflow",      () => { if (CreateProjectWorkflow)      registry.register("CreateProject.workflow",      new CreateProjectWorkflow(FsProjectRepository)); });
_safeRegister("MultiModelSend.workflow",     () => { if (MultiModelSendWorkflow)     registry.register("MultiModelSend.workflow",     new MultiModelSendWorkflow()); });
_safeRegister("PartnerCommentary.workflow",  () => { if (PartnerCommentaryWorkflow)  registry.register("PartnerCommentary.workflow",  new PartnerCommentaryWorkflow()); });
_safeRegister("SysProvisionModel.workflow",  () => { if (SysProvisionModelWorkflow)  registry.register("SysProvisionModel.workflow",  new SysProvisionModelWorkflow()); });
_safeRegister("VfsAdd.workflow",             () => { if (VfsAddWorkflow)             registry.register("VfsAdd.workflow",             new VfsAddWorkflow()); });
_safeRegister("VfsList.workflow",            () => { if (VfsListWorkflow)            registry.register("VfsList.workflow",            new VfsListWorkflow()); });
_safeRegister("VfsManifest.workflow",        () => { if (VfsManifestWorkflow)        registry.register("VfsManifest.workflow",        new VfsManifestWorkflow()); });
_safeRegister("VfsUpdatePermissions.workflow",() => { if (VfsUpdatePermissionsWf)   registry.register("VfsUpdatePermissions.workflow",new VfsUpdatePermissionsWf()); });
_safeRegister("ListFiles.workflow",          () => { if (ListFilesWorkflow)          registry.register("ListFiles.workflow",          new ListFilesWorkflow()); });
_safeRegister("ListProcesses.workflow",      () => { if (ListProcessesWorkflow)      registry.register("ListProcesses.workflow",      new ListProcessesWorkflow()); });
_safeRegister("SearchHistory.workflow",      () => { if (SearchHistoryWorkflow)      registry.register("SearchHistory.workflow",      new SearchHistoryWorkflow()); });
_safeRegister("FileContext.workflow",        () => { if (FileContextWorkflow)        registry.register("FileContext.workflow",        new FileContextWorkflow()); });
_safeRegister("FilePermissions.workflow",    () => { if (FilePermissionsWorkflow)    registry.register("FilePermissions.workflow",    new FilePermissionsWorkflow()); });
_safeRegister("AutoOptimizeModels.workflow", () => { if (AutoOptimizeModelsWorkflow) registry.register("AutoOptimizeModels.workflow", new AutoOptimizeModelsWorkflow()); });
_safeRegister("GoogleDrive.workflow",        () => { if (GoogleDriveWorkflow)        registry.register("GoogleDrive.workflow",        new GoogleDriveWorkflow()); });

// ── deps ───────────────────────────────────────────────────────────────────────
const deps = { projectRepo, profileRepo, settingsManager, paths, fs, path, triggerIngest };

_safeRegister("GetModelInventory.workflow",  () => { if (GetModelInventoryWorkflow)  registry.register("GetModelInventory.workflow",  new GetModelInventoryWorkflow(deps)); });
_safeRegister("SaveModelInventory.workflow", () => { if (SaveModelInventoryWorkflow) registry.register("SaveModelInventory.workflow", new SaveModelInventoryWorkflow(deps)); });
_safeRegister("GetPolicy.workflow",          () => { if (GetPolicyWorkflow)          registry.register("GetPolicy.workflow",          new GetPolicyWorkflow(deps)); });
_safeRegister("UpdatePolicy.workflow",       () => { if (UpdatePolicyWorkflow)       registry.register("UpdatePolicy.workflow",       new UpdatePolicyWorkflow(deps)); });

// ── boot router ──────────────────────────────────────────────────────────────
const router = new Router(registry, deps);

router.startListening();
Middleware.log(">>> ProtoAI IPC server READY");
