const fs = require("fs-extra");
const path = require("path");
const BaseRepository = require("./BaseRepository");
const paths = require("../env/paths");

class FsProjectRepository extends BaseRepository {
  constructor() {
    super(paths.projects());
  }

  listProjects() {
    return fs.readdirSync(this.basePath)
      .filter(name => fs.statSync(path.join(this.basePath, name)).isDirectory());
  }

  projectPath(project) {
    return paths.projectDir(project);
  }

  historyFile(project) {
    return path.join(this.projectPath(project), "history.json");
  }

  getHistory(project) {
    const file = this.historyFile(project);
    return this.readJson(file, []);
  }

  appendToHistory(project, entry) {
    const file = this.historyFile(project);
    const history = this.readJson(file, []);
    history.push(entry);
    this.writeJson(file, history);
  }

  // ——— Chat sessions ———
  _sessionsDir(project) {
    return path.join(this.projectPath(project), "chat_sessions");
  }

  _sessionsManifest(project) {
    return path.join(this._sessionsDir(project), "sessions.json");
  }

  listChatSessions(project) {
    const manifest = this._sessionsManifest(project);
    if (!fs.existsSync(manifest)) return [];
    return this.readJson(manifest, []);
  }

  createChatSession(project, name) {
    const dir = this._sessionsDir(project);
    fs.mkdirSync(dir, { recursive: true });
    const manifest = this._sessionsManifest(project);
    const sessions = this.readJson(manifest, []);
    const id = `chat-${Date.now()}`;
    sessions.push({ id, name: name || `Chat ${sessions.length + 1}`, createdAt: new Date().toISOString() });
    this.writeJson(manifest, sessions);
    // Create the message file
    const msgFile = path.join(dir, `${id}.json`);
    this.writeJson(msgFile, []);
    return id;
  }

  renameChatSession(project, chatId, name) {
    const manifest = this._sessionsManifest(project);
    const sessions = this.readJson(manifest, []);
    const session = sessions.find(s => s.id === chatId);
    if (!session) return;
    session.name = name;
    this.writeJson(manifest, sessions);
  }

  deleteChatSession(project, chatId) {
    const manifest = this._sessionsManifest(project);
    const sessions = this.readJson(manifest, []);
    const filtered = sessions.filter(s => s.id !== chatId);
    this.writeJson(manifest, filtered);
    const msgFile = path.join(this._sessionsDir(project), `${chatId}.json`);
    if (fs.existsSync(msgFile)) fs.unlinkSync(msgFile);
  }

  _sessionMsgFile(project, chatId) {
    return path.join(this._sessionsDir(project), `${chatId}.json`);
  }

  loadChatSession(project, chatId) {
    return this.readJson(this._sessionMsgFile(project, chatId), []);
  }

  appendChatMessage(project, chatId, entry) {
    const file = this._sessionMsgFile(project, chatId);
    const messages = this.readJson(file, []);
    messages.push(entry);
    this.writeJson(file, messages);
  }

  getProjectStructure(project) {
    return this.walkDirectory(this.projectPath(project));
  }

  walkDirectory(dirPath, prefix = "") {
    const entries = fs.readdirSync(dirPath);

    return entries.map(entry => {
      const full = path.join(dirPath, entry);
      const stat = fs.statSync(full);

      return {
        name: entry,
        path: path.join(prefix, entry),
        type: stat.isDirectory() ? "directory" : "file",
        children: stat.isDirectory()
          ? this.walkDirectory(full, path.join(prefix, entry))
          : undefined
      };
    });
  }
}

module.exports = FsProjectRepository;
