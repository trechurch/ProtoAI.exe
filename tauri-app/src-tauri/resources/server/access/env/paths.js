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
    this.root = process.env.PROTOAI_ROOT || process.cwd();
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

  globalMemory() {
    return this.data("memory-global.json");
  }

  projectMemory(project) {
    return this.projects(project, "memory.json");
  }

  projectDir(project) {
    return this.projects(project);
  }

  archetypes(...p) {
    return this.data("archetypes", ...p);
  }

  userProfiles(...p) {
    return this.data("user-profiles", ...p);
  }

  userProfile() {
    return this.data("user-profile.json");
  }

  // ── VFS paths ─────────────────────────────────────────────
  vfs(project, ...p)          { return this.projects(project, "vfs", ...p); }
  vfsIndex(project)           { return this.vfs(project, "index.json"); }
  vfsManifests(project)       { return this.vfs(project, "manifests"); }
  vfsManifest(project, id)    { return this.vfs(project, "manifests", id + ".json"); }
  // ── end of VFS paths ─────────────────────────────────────
}

module.exports = new PathResolver();
