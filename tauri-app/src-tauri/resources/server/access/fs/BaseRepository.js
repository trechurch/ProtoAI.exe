const fs = require("fs-extra");

class BaseRepository {
  constructor(basePath) {
    this.basePath = basePath;
    fs.mkdirpSync(this.basePath);
    // Per-file write queues to prevent concurrent write corruption on Windows
    this._writeQueues = new Map();
  }

  readJson(filePath, fallback = null) {
    try {
      return fs.readJsonSync(filePath);
    } catch {
      return fallback;
    }
  }

  writeJson(filePath, data) {
    if (!this._writeQueues.has(filePath)) {
      this._writeQueues.set(filePath, Promise.resolve());
    }
    const queue = this._writeQueues.get(filePath);
    const next = queue.then(() => fs.writeJsonSync(filePath, data, { spaces: 2 }));
    this._writeQueues.set(filePath, next);
  }

  // Synchronous write bypass — use with caution
  writeJsonSync(filePath, data) {
    fs.writeJsonSync(filePath, data, { spaces: 2 });
  }

  fileExists(filePath) {
    return fs.existsSync(filePath);
  }

  listFiles(dirPath) {
    return fs.readdirSync(dirPath);
  }
}

module.exports = BaseRepository;
