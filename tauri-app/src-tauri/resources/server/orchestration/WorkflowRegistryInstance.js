// Last modified: 2026-05-04 03:11 UTC
// SDOA Version
exports.VERSION = "1.0.0";
exports.getVersion = () => exports.VERSION;

class WorkflowRegistry {

    static MANIFEST = {
        id:           "WorkflowRegistry",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages WorkflowRegistry operations.",
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
    this.workflows = new Map();
  }

  register(name, WorkflowClass) {
    this.workflows.set(name, WorkflowClass);
  }

  has(name) {
    return this.workflows.has(name);
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
