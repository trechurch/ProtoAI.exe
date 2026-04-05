class WorkflowRegistry {
  constructor() {
    this.workflows = new Map();
  }

  register(name, instance) {
    this.workflows.set(name, instance);
  }

  get(name) {
    if (!this.workflows.has(name)) {
      throw new Error(`Workflow not registered: ${name}`);
    }
    return this.workflows.get(name);
  }
}

module.exports = WorkflowRegistry;
