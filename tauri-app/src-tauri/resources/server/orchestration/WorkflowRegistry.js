"use strict";

class WorkflowRegistry {
  constructor() {
    this.workflows = new Map();
  }

  register(name, instance) {
    this.workflows.set(name, instance);
  }

  has(name) {
    return this.workflows.has(name);
  }

  get(name) {
    if (!this.workflows.has(name)) {
      throw new Error(`Workflow not registered: ${name}`);
    }
    return this.workflows.get(name);
  }

  list() {
    return Array.from(this.workflows.keys());
  }
}

module.exports = WorkflowRegistry;
