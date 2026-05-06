// Last modified: 2026-05-04 03:11 UTC
// QmdAdapter.js — wraps @tobilu/qmd via the bundled Node.js runtime
// Spawns qmd as a child process since it's an ESM-only package
const { spawn } = require("child_process");
const path = require("path");

class QmdAdapter {

    static MANIFEST = {
        id:           "QmdAdapter",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages QmdAdapter operations.",
            author: "ProtoAI team",
        },
        actions: {
            commands:  {},
            triggers:  {},
            emits:     {},
            workflows: {},
        },
    };
      constructor(options = {}) {
    this.qmdEntry = options.qmdEntry || findQmdEntry();
  }

  /**
   * Execute a qmd command via the bundled Node.js runtime.
   * Returns a promise that resolves with parsed JSON output.
   * @param {string[]} args - argv to pass to qmd (e.g. ["vsearch", "hello"])
   */
  _run(args) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [this.qmdEntry, ...args, "--json"], {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: process.cwd(),
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));

      child.on("error", (err) => resolve({ error: err.message }));
      child.on("close", (code) => {
        try {
          const lines = stdout.trim().split("\n").filter(l => l.trim());
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (!line) continue;
            try {
              resolve(JSON.parse(line));
              return;
            } catch (_) {}
          }
          const detail = stderr.trim();
          resolve({ error: `qmd exited with code ${code}`, detail });
        } catch (err) {
          resolve({ error: err.message });
        }
      });
    });
  }

  /**
   * Semantic vector search across collections.
   */
  async search(term) {
    return this._run(["vsearch", term]);
  }

  /**
   * SQL-like metadata query.
   */
  async query(sql) {
    return this._run(["query", sql]);
  }

  /**
   * Initialize or refresh project embeddings for a given path.
   */
  async index(collectionPath, mask = "**/*.{ts,tsx,md,json}") {
    const addResult = await this._run(["collection", "add", collectionPath, "--mask", mask]);
    if (addResult?.error) return addResult;
    return this._run(["embed"]);
  }
}

/**
 * Find the qmd CLI entry point. Tries multiple strategies since it's
 * an ESM-only package with restrictive exports.
 */
function findQmdEntry() {
  const serverDir = path.join(__dirname, "../..");
  const candidates = [
    // Strategy 1: relative to this file (dev or bundled)
    path.join(__dirname, "../../node_modules/@tobilu/qmd/dist/cli/qmd.js"),
    // Strategy 2: server root
    path.join(serverDir, "node_modules/@tobilu/qmd/dist/cli/qmd.js"),
    // Strategy 3: cwd-relative (for dev without bundle)
    path.join(process.cwd(), "node_modules/@tobilu/qmd/dist/cli/qmd.js"),
  ];

  const fs = require("fs");
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) {
      return resolved;
    }
  }

  throw new Error(
    "qmd module not found. Make sure @tobilu/qmd is installed in server/node_modules."
  );
}

module.exports = QmdAdapter;
