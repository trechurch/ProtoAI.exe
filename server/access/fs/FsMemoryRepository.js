const BaseRepository = require("./BaseRepository");
const paths = require("../env/paths");

class FsMemoryRepository extends BaseRepository {
  constructor() {
    super(paths.data());
  }

  loadGlobalMemory() {
    return this.readJson(paths.globalMemory(), { facts: [] });
  }

  loadProjectMemory(project) {
    return this.readJson(paths.projectMemory(project), { facts: [] });
  }

  saveGlobalMemory(data) {
    this.writeJson(paths.globalMemory(), data);
  }

  saveProjectMemory(project, data) {
    this.writeJson(paths.projectMemory(project), data);
  }
}

module.exports = FsMemoryRepository;
