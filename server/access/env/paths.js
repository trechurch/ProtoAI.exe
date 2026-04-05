const path = require("path");

class PathResolver {
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
}

module.exports = new PathResolver();
