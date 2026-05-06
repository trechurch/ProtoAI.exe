// Last modified: 2026-05-04 03:11 UTC
// server/orchestration/workflows/ChatSessionWorkflow.js
const WorkflowResult = require("../WorkflowResult");
const paths = require("../../access/env/paths");
const FsProjectRepository = require("../../access/fs/FsProjectRepository");

class ChatSessionWorkflow {

    static MANIFEST = {
        id:           "ChatSessionWorkflow",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages ChatSessionWorkflow operations.",
            author: "ProtoAI team",
        },
        actions: {
            commands:  {},
            triggers:  {},
            emits:     {},
            workflows: {},
        },
    };
      constructor() {
    this.projectRepo = new FsProjectRepository();
  }

  async run(context) {
    const { action, project, chatId, name, entry } = context;
    try {
      switch (action) {
        case "list": {
          const sessions = this.projectRepo.listChatSessions(project);
          // Auto-migrate: if no sessions exist but history.json has data, create a default session
          if (sessions.length === 0) {
            const history = this.projectRepo.getHistory(project);
            if (history.length > 0) {
              const defaultId = this.projectRepo.createChatSession(project, "Default");
              history.forEach(e => this.projectRepo.appendChatMessage(project, defaultId, e));
            }
            return new WorkflowResult("ok", this.projectRepo.listChatSessions(project));
          }
          return new WorkflowResult("ok", sessions);
        }
        case "create": {
          const id = this.projectRepo.createChatSession(project, name);
          return new WorkflowResult("ok", { id, name: name || "New Chat" });
        }
        case "rename": {
          this.projectRepo.renameChatSession(project, chatId, name);
          return new WorkflowResult("ok", { id: chatId, name });
        }
        case "delete": {
          this.projectRepo.deleteChatSession(project, chatId);
          return new WorkflowResult("ok", { id: chatId });
        }
        case "load": {
          const messages = this.projectRepo.loadChatSession(project, chatId);
          return new WorkflowResult("ok", { messages, chatId });
        }
        case "append": {
          this.projectRepo.appendChatMessage(project, chatId, entry);
          return new WorkflowResult("ok", { ok: true });
        }
        default:
          return new WorkflowResult("error", { error: `Unknown action: ${action}` });
      }
    } catch (err) {
      return new WorkflowResult("error", { error: "Chat session error", detail: String(err) });
    }
  }
}

module.exports = ChatSessionWorkflow;
