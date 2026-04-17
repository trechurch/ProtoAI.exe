// SDOA Version
exports.VERSION = "1.0.0";
exports.getVersion = () => exports.VERSION;

class WorkflowBase {
  constructor() {
    this.version = exports.VERSION;
  }

  getName() {
    return this.constructor.name;
  }

  getVersion() {
    return this.version;
  }

  // Override in subclasses
  async run(_payload) {
    throw new Error(`run() not implemented in ${this.getName()}`);
  }
}

module.exports = WorkflowBase;
