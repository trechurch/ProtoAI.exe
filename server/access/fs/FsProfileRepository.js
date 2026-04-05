const BaseRepository = require("./BaseRepository");
const paths = require("../env/paths");

class FsProfileRepository extends BaseRepository {
  constructor() {
    super(paths.cli("helpers"));
  }

  loadProfiles() {
    return this.readJson(paths.profiles(), {});
  }
}

module.exports = FsProfileRepository;
