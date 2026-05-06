// Last modified: 2026-05-04 03:11 UTC
const { spawn } = require("child_process");
const WorkflowResult = require("../WorkflowResult");

class ListProcessesWorkflow {

    static MANIFEST = {
        id:           "ListProcessesWorkflow",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages ListProcessesWorkflow operations.",
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
    const { filter = "" } = context || {};

    let processes = [];
    let platform = process.platform;

    try {
      if (platform === "win32") {
        // Windows: use PowerShell to get process list
        const child = spawn("powershell.exe", [
          "Get-Process | Select-Object Id, ProcessName, StartTime | ConvertTo-Json"
        ], {
          timeout: 5000,
          shell: true
        });

        let stdout = "";
        child.stdout.on("data", data => { stdout += data.toString(); });
        child.stderr.on("data", data => {});

        await new Promise((resolve, reject) => {
          child.on("close", code => {
            if (code === 0) resolve();
            else reject(new Error(`Process list failed with code ${code}`));
          });
        });

        if (stdout) {
          try {
            const psData = JSON.parse(stdout);
            processes = Array.isArray(psData) ? psData : [psData];
          } catch (e) {
            console.warn("[ListProcessesWorkflow] Failed to parse PowerShell output:", e);
          }
        }

      } else {
        // Unix-like systems: use ps command
        const child = spawn("ps", ["-eo", "pid,comm,lstart"]);

        let stdout = "";
        child.stdout.on("data", data => { stdout += data.toString(); });

        await new Promise((resolve, reject) => {
          child.on("close", code => {
            if (code === 0) resolve();
            else reject(new Error(`Process list failed with code ${code}`));
          });
        });

        if (stdout) {
          const lines = stdout.trim().split("\n");
          // Skip header line
          for (let i = 1; i < lines.length; i++) {
            const parts = lines[i].trim().split(/\s+/);
            if (parts.length < 2) continue;

            const pid = parseInt(parts[0], 10);
            if (isNaN(pid)) continue;

            const name = parts.slice(1, -4).join(" ");
            const start = parts.slice(-4).join(" ");

            processes.push({
              pid,
              name,
              start
            });
          }
        }
      }

      // Apply filter if provided
      if (filter) {
        const filterLower = filter.toLowerCase();
        processes = processes.filter(p =>
          p.name?.toLowerCase().includes(filterLower) ||
          p.comm?.toLowerCase().includes(filterLower)
        );
      }

      return new WorkflowResult("ok", {
        processes,
        platform,
        timestamp: Date.now()
      });

    } catch (err) {
      return new WorkflowResult("error", {
        error: "Failed to list processes",
        detail: String(err),
        platform
      });
    }
  }
}

module.exports = ListProcessesWorkflow;
