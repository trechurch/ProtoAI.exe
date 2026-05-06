// Last modified: 2026-05-04 03:11 UTC
"use strict";

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
