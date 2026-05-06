// Last modified: 2026-05-04 03:11 UTC
const { spawn } = require("child_process");
const WorkflowResult = require("../WorkflowResult");

class SpawnShellWorkflow {

    static MANIFEST = {
        id:           "SpawnShellWorkflow",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages SpawnShellWorkflow operations.",
            author: "ProtoAI team",
        },
        actions: {
            commands:  {},
            triggers:  {},
            emits:     {},
            workflows: {},
        },
    };
      constructor() {}

  async run(context) {
    const { shell = "powershell" } = context || {};

    let shellCmd, shellArgs;
    const isWindows = process.platform === "win32";

    if (isWindows) {
      if (shell === "cmd") {
        shellCmd = "cmd.exe";
        shellArgs = [];
      } else if (shell === "powershell") {
        shellCmd = "powershell.exe";
        shellArgs = ["-NoExit"];
      } else {
        // Default to PowerShell
        shellCmd = "powershell.exe";
        shellArgs = ["-NoExit"];
      }
    } else {
      // Unix-like systems
      shellCmd = "/bin/bash";
      shellArgs = ["-i"];
    }

    try {
      const child = spawn(shellCmd, shellArgs, {
        cwd: process.cwd(),
        env: { ...process.env, TERM: "xterm-256color" },
        shell: true,
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Store the process for later interaction
      const pid = child.pid;

      // Clean up on exit
      child.on("close", () => {
        console.log(`[SpawnShellWorkflow] Shell process ${pid} exited`);
      });

      child.on("error", (err) => {
        console.error(`[SpawnShellWorkflow] Error spawning shell:`, err);
      });

      return new WorkflowResult("ok", {
        pid,
        shell: shellCmd,
        message: `Spawned ${shell} with PID ${pid}`,
      });
    } catch (err) {
      return new WorkflowResult("error", {
        error: "Failed to spawn shell",
        detail: String(err),
      });
    }
  }
}

module.exports = SpawnShellWorkflow;
