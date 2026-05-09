// Last modified: 2026-05-04 03:11 UTC
const path = require("path");

class PathResolver {

    static MANIFEST = {
        id:           "PathResolver",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages PathResolver operations.",
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
        let root = process.env.PROTOAI_ROOT || process.cwd();
        
        // SDOA v4 Smart Root: If running inside tauri-app, the real root is one level up.
        if (!process.env.PROTOAI_ROOT && root.toLowerCase().endsWith("tauri-app")) {
            root = path.join(root, "..");
        }
        
        this.root = root;
    }

  resolve(...parts) {
    return path.join(this.root, ...parts);
  }

  // Core directories
  data(...p) {
    return this.resolve("data", ...p);
  }

  projects(...p) {
    return this.data("projects", ...p);
  }

  cli(...p) {
    return this.resolve("cli", ...p);
  }

  ui(...p) {
    return this.resolve("ui", ...p);
  }

  runtime(...p) {
    return this.resolve("runtime", ...p);
  }

  // Specific files
  secretKey() {
    return this.data("secret.key");
  }

  profiles() {
    return this.cli("helpers", "profiles.json");
  }

  // Cognitive Layers (v2.1)
  memoryRoot() {
    return this.resolve("protoai", "memory");
  }

  identityMemory() {
    return path.join(this.memoryRoot(), "identity.json");
  }

  wisdomMemory() {
    return path.join(this.memoryRoot(), "wisdom.json");
  }

  workflowMemory(id) {
    return path.join(this.memoryRoot(), "workflows", `${id}.json`);
  }

  knowledgeDir() {
    return this.resolve("protoai", "knowledge");
  }

  ephemeralDir() {
    return this.resolve("protoai", "tmp", "session");
  }

  // Project Layer
  projectMemory(project) {
    return this.data("projects", project, "memory", "project.json");
  }

  projectKnowledge(project) {
    return this.data("projects", project, "knowledge");
  }

  projectDir(project) {
    return this.data("projects", project);
  }

  userProfiles(...p) {
    return this.resolve("protoai", "profiles", ...p);
  }

  userProfile() {
    return this.resolve("protoai", "memory", "identity.json");
  }

  archetypes(...p) {
    return this.data("archetypes", ...p);
  }

  // ── VFS paths ─────────────────────────────────────────────
  vfs(project, ...p)          { return this.resolve("projects", project, "vfs", ...p); }
  vfsIndex(project)           { return this.vfs(project, "index.json"); }
  vfsManifests(project)       { return this.vfs(project, "manifests"); }
  vfsManifest(project, id)    { return this.vfs(project, "manifests", id + ".json"); }
  // ── end of VFS paths ─────────────────────────────────────
}

module.exports = new PathResolver();
