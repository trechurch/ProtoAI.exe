// SDOA Version
exports.VERSION = "1.0.0";
exports.getVersion = () => exports.VERSION;

const registry = require("./WorkflowRegistryInstance");

const SendMessageWorkflow = require("./SendMessageWorkflow");
const ListProjectsWorkflow = require("./ListProjectsWorkflow");
const ListProfilesWorkflow = require("./ListProfilesWorkflow");
const LoadProjectHistoryWorkflow = require("./LoadProjectHistoryWorkflow");
const VoiceChatWorkflow = require("./VoiceChatWorkflow");
const SpellcheckWorkflow = require("./SpellcheckWorkflow");
const VersionInfoWorkflow = require("./VersionInfoWorkflow");
const ImageGenWorkflow = require("./workflows/ImageGenWorkflow");
const DeepSearchWorkflow = require("./workflows/DeepSearchWorkflow");
const FilePermissionsWorkflow = require("./workflows/FilePermissionsWorkflow");
const FileContextWorkflow = require("./workflows/FileContextWorkflow");
const ChatSessionWorkflow = require("./workflows/ChatSessionWorkflow");
const ListFilesWorkflow = require("./workflows/ListFilesWorkflow");

function registerAllWorkflows() {
  registry.register("SendMessageWorkflow", SendMessageWorkflow);
  registry.register("ListProjectsWorkflow", ListProjectsWorkflow);
  registry.register("ListProfilesWorkflow", ListProfilesWorkflow);
  registry.register("LoadProjectHistoryWorkflow", LoadProjectHistoryWorkflow);
  registry.register("VoiceChatWorkflow", VoiceChatWorkflow);
  registry.register("SpellcheckWorkflow", SpellcheckWorkflow);
  registry.register("VersionInfoWorkflow", VersionInfoWorkflow);
  registry.register("ImageGenWorkflow", ImageGenWorkflow);
  registry.register("DeepSearchWorkflow", DeepSearchWorkflow);
  registry.register("FilePermissionsWorkflow", FilePermissionsWorkflow);
  registry.register("FileContextWorkflow", FileContextWorkflow);
  registry.register("ChatSessionWorkflow", ChatSessionWorkflow);
  registry.register("ListFilesWorkflow", ListFilesWorkflow);
}

module.exports = { registerAllWorkflows };
