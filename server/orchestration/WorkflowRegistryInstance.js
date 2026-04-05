// SDOA Version
exports.VERSION = "1.0.0";
exports.getVersion = () => exports.VERSION;

class WorkflowRegistry {
  constructor() {
    this.workflows = new Map();
  }

  register(name, WorkflowClass) {
    this.workflows.set(name, WorkflowClass);
  }

  get(name) {
    const WorkflowClass = this.workflows.get(name);
    if (!WorkflowClass) {
      throw new Error(`Workflow not registered: ${name}`);
    }
    return new WorkflowClass();
  }

  list() {
    return Array.from(this.workflows.keys());
  }
}

const registry = new WorkflowRegistry();
module.exports = registry;
