// Last modified: 2026-05-04 03:11 UTC
// SDOA Version
// Last modified: 2026-04-29 10:00 UTC
exports.VERSION = "1.1.0";
exports.getVersion = () => exports.VERSION;

const registry = require("./WorkflowRegistryInstance");

const SendMessageWorkflow      = require("./SendMessage.workflow");
const ListProjectsWorkflow     = require("./ListProjects.workflow");
const ListProfilesWorkflow     = require("./ListProfiles.workflow");
const LoadProjectHistoryWorkflow = require("./LoadProjectHistory.workflow");
const VoiceChatWorkflow        = require("./VoiceChat.workflow");
const SpellcheckWorkflow       = require("./Spellcheck.workflow");
const VersionInfoWorkflow      = require("./VersionInfo.workflow");
const ImageGenWorkflow         = require("./workflows/ImageGen.workflow");
const DeepSearchWorkflow       = require("./workflows/DeepSearch.workflow");
const FilePermissionsWorkflow  = require("./workflows/FilePermissions.workflow");
const FileContextWorkflow      = require("./workflows/FileContext.workflow");
const ChatSessionWorkflow      = require("./workflows/ChatSession.workflow");
const ListFilesWorkflow        = require("./workflows/ListFiles.workflow");
const SpawnShellWorkflow       = require("./workflows/SpawnShell.workflow");
const ListProcessesWorkflow    = require("./workflows/ListProcesses.workflow");
const MultiModelSendWorkflow   = require("./workflows/MultiModelSend.workflow");

// SDOA v3.0 MANIFEST
const MANIFEST = {
    id:           "registerWorkflows",
    type:         "utility",
    runtime:      "NodeJS",
    version:      "1.0.0",
    capabilities: [],
    dependencies: [],
    docs: {
        description: "registerWorkflows utilities and exports.",
        author: "ProtoAI team",
    },
    actions: {
        commands:  {},
        triggers:  {},
        emits:     {},
        workflows: {},
    },
};


function registerAllWorkflows() {
  registry.register("SendMessage.workflow",        SendMessageWorkflow);
  registry.register("MultiModelSend.workflow",     MultiModelSendWorkflow);
  registry.register("ListProjects.workflow",       ListProjectsWorkflow);
  registry.register("ListProfiles.workflow",       ListProfilesWorkflow);
  registry.register("LoadProjectHistory.workflow", LoadProjectHistoryWorkflow);
  registry.register("VoiceChat.workflow",          VoiceChatWorkflow);
  registry.register("Spellcheck.workflow",         SpellcheckWorkflow);
  registry.register("VersionInfo.workflow",        VersionInfoWorkflow);
  registry.register("ImageGen.workflow",           ImageGenWorkflow);
  registry.register("DeepSearch.workflow",         DeepSearchWorkflow);
  registry.register("FilePermissions.workflow",    FilePermissionsWorkflow);
  registry.register("FileContext.workflow",        FileContextWorkflow);
  registry.register("ChatSession.workflow",        ChatSessionWorkflow);
  registry.register("ListFiles.workflow",          ListFilesWorkflow);
  registry.register("SpawnShell.workflow",         SpawnShellWorkflow);
  registry.register("ListProcesses.workflow",    ListProcessesWorkflow);
}

module.exports = { registerAllWorkflows, MANIFEST };
