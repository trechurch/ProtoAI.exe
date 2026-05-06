// Last modified: 2026-05-04 03:11 UTC
// SysCheckBinaryWorkflow.js — Checks if a binary is available on the system PATH or in app bin
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const paths = require("../../access/env/paths");

class SysCheckBinaryWorkflow {

    static MANIFEST = {
        id:           "SysCheckBinaryWorkflow",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages SysCheckBinaryWorkflow operations.",
            author: "ProtoAI team",
        },
        actions: {
            commands:  {},
            triggers:  {},
            emits:     {},
            workflows: {},
        },
    };
      async run(payload = {}) {
    const { bin } = payload;
    if (!bin) return { status: "error", message: "Missing binary name" };

    // 1. Check local bin directory first
    const localBin = path.join(paths.bin(), bin.endsWith(".exe") ? bin : `${bin}.exe`);
    if (fs.existsSync(localBin)) {
      return { status: "ok", found: true, path: localBin };
    }

    // 2. Check system PATH
    try {
      const cmd = process.platform === "win32" ? `where ${bin}` : `which ${bin}`;
      const foundPath = execSync(cmd, { stdio: "pipe" }).toString().trim().split("\n")[0];
      return { status: "ok", found: true, path: foundPath };
    } catch (_) {
      return { status: "ok", found: false };
    }
  }
}

module.exports = SysCheckBinaryWorkflow;
