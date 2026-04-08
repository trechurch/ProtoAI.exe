// ProtoAI CLI Selector — Full Production Version
// Portable, path-resolved, zero hardcoded drive letters

const paths = require("../server/access/env/paths");

const fs = require("fs");
const path = require("path");
const https = require("https");

// -------------------------------
// ARGUMENT PARSING
// -------------------------------
const args = process.argv.slice(2);
let profile = "default";
let message = "";
let project = null;
let contextFile = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === "--profile") profile = args[i + 1];
    if (args[i] === "--chat") message = args[i + 1];
    if (args[i] === "--project") project = args[i + 1];
    if (args[i] === "--context-file") contextFile = args[i + 1];
}

// -------------------------------
// LOAD PROFILES
// -------------------------------
const profileFile = paths.profiles();
if (!fs.existsSync(profileFile)) {
    console.error("Missing profiles.json");
    process.exit(1);
}

const profiles = JSON.parse(fs.readFileSync(profileFile, "utf8"));

if (!profiles[profile]) {
    console.error("Unknown profile:", profile);
    process.exit(1);
}

const p = profiles[profile];

// -------------------------------
// LOAD API KEY
// -------------------------------
// Prefer SettingsManager (user-configured), fall back to secret.key
let apiKey = "";
const settingsPath = paths.data("settings.json");
if (fs.existsSync(settingsPath)) {
    try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        if (settings?.apiKeys?.openrouter) {
            apiKey = settings.apiKeys.openrouter.trim();
        }
        // Also try anthropic key as fallback (for direct Anthropic API calls)
        if (!apiKey && settings?.apiKeys?.anthropic) {
            apiKey = settings.apiKeys.anthropic.trim();
        }
    } catch (_) {}
}
// Fall back to secret.key if settings didn't provide a key
if (!apiKey) {
    const keyFile = paths.secretKey();
    if (fs.existsSync(keyFile)) {
        apiKey = fs.readFileSync(keyFile, "utf8").trim();
    }
}
if (!apiKey) {
    console.error("No API key configured. Set your OpenRouter or Anthropic key in Settings (Ctrl+Shift+S), or create data/secret.key");
    process.exit(1);
}

// -------------------------------
// LOAD MEMORY
// -------------------------------
let memoryText = "";

function loadMemory() {
    let globalMemory = [];
    let projectMemory = [];

    if (p.memory_mode === "global" || p.memory_mode === "global+project") {
        const globalMemoryFile = paths.globalMemory();
        if (fs.existsSync(globalMemoryFile)) {
            globalMemory = JSON.parse(fs.readFileSync(globalMemoryFile, "utf8")).facts || [];
        }
    }

    if ((p.memory_mode === "project" || p.memory_mode === "global+project") && project) {
        const projectMemoryFile = paths.projectMemory(project);
        if (fs.existsSync(projectMemoryFile)) {
            projectMemory = JSON.parse(fs.readFileSync(projectMemoryFile, "utf8")).facts || [];
        }
    }

    const combined = [...globalMemory, ...projectMemory];
    memoryText = combined.length > 0
        ? combined.map(f => "- " + f).join("\n")
        : "(no memory)";
}

loadMemory();

// -------------------------------
// FILE CONTEXT — injected by SendMessageWorkflow (server-side resolver)
// -------------------------------
let fileContext = "";

if (contextFile && fs.existsSync(contextFile)) {
    try {
        const parsed = JSON.parse(fs.readFileSync(contextFile, "utf8"));
        fileContext = parsed.fileContext || "";
        if (parsed.message) message = parsed.message;
    } catch (_) {}
}

// -------------------------------
// BUILD MESSAGE PAYLOAD
// -------------------------------
function buildMessages() {
    const messages = [];

    // System prompt — attach memory only if profile uses it
    const memoryLines = p.memory_mode === "none" ? "" : `\n\nProject Memory:\n${memoryText}`;
    messages.push({
        role: "system",
        content: `${p.system}${memoryLines}`
    });

    // Inject file context BEFORE user message (if any) — only if profile allows it
    if (fileContext && p.file_ingestion) {
        messages.push({
            role: "user",
            content: fileContext
        });
    }

    // User message
    messages.push({
        role: "user",
        content: message
    });

    return messages;
}

// -------------------------------
// OPENROUTER REQUEST
// -------------------------------
function sendRequest(model, callback) {
    const payload = JSON.stringify({
        model,
        temperature: p.temperature,
        max_tokens: p.max_tokens,
        messages: buildMessages()
    });

    const options = {
        hostname: "openrouter.ai",
        path: "/api/v1/chat/completions",
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
            "Content-Length": Buffer.byteLength(payload)
        }
    };

    const req = https.request(options, res => {
        let data = "";

        res.on("data", chunk => data += chunk);
        res.on("end", () => {
            try {
                const json = JSON.parse(data);
                if (!res.statusCode || res.statusCode >= 400) {
                    const errMsg = JSON.stringify(json);
                    console.error(`OpenRouter error [${res.statusCode}] for ${model}: ${errMsg.slice(0, 500)}`);
                    const err = new Error(`HTTP ${res.statusCode}`);
                    err.statusCode = res.statusCode;
                    return callback(err, null);
                }
                const reply = json.choices?.[0]?.message?.content || "";
                callback(null, reply);
            } catch (e) {
                console.error(`Parse error for ${model}: ${data.slice(0, 500)}`);
                callback(e, null);
            }
        });
    });

    req.on("error", err => {
        console.error(`OpenRouter network error for ${model}: ${err.message}`);
        callback(err, null);
    });

    req.setTimeout(30000, () => {
        console.error(`OpenRouter timeout for ${model} (30s)`);
        req.destroy();
        callback(new Error("Request timed out"), null);
    });

    req.write(payload);
    req.end();
}

// Determine whether an error means the *provider* is rate-limiting or down,
// vs. a config problem that would hit every model the same way.
function isFailoverError(err, statusCode) {
    if (!err) return false;
    const msg = String(err);
    // Rate limits, overload, upstream errors — worth trying another model
    if (statusCode === 429) return true;
    if (statusCode >= 500) return true;
    if (/timed out|timeout|network|ECONNRESET|ENOTFOUND|ECONNREFUSED/i.test(msg)) return true;
    // 400 (bad request), 401 (bad key), 403 (forbidden) are config problems — don't failover
    return false;
}

// -------------------------------
// FALLBACK CHAIN + GLOBAL FAILOVER LIST
// -------------------------------
const globalFailover = (settings?.models?.failoverList || []).filter(
  m => ![p.model, ...(p.fallback || [])].includes(m)
);
const modelsToTry = [p.model, ...(p.fallback || []), ...globalFailover];

function tryNextModel(index = 0, skipFailover = false) {
  if (index >= modelsToTry.length) {
    console.error("All models failed.");
    process.exit(1);
  }

  const model = modelsToTry[index];

  sendRequest(model, (err, reply) => {
    if (!err && reply) {
      let output;
      try {
        output = processOutput(reply);
      } catch (e) {
        console.error(`Output processing failed for ${model}: ${e.message}`);
        output = reply.trim();
      }

      if (!output) {
        return tryNextModel(index + 1, skipFailover);
      }

      if (index > 0) {
        console.error(`[failover] Using ${model} after ${index} failure(s)`);
      }
      console.log(output);
      return;
    }

    const statusCode = err?.statusCode || null;
    if (!skipFailover && isFailoverError(err, statusCode)) {
      console.error(`[failover] ${model} returned ${statusCode ? `HTTP ${statusCode}` : err.message} — trying next model`);
      return tryNextModel(index + 1, false);
    }

    // Config error (400/401/403) — rethrow immediately
    console.error(`[failover] ${model} failed with non-retryable error: ${err?.message || 'empty response'}`);
    process.exit(1);
  });
}
// -------------------------------
// OUTPUT PROCESSING
// -------------------------------

function processOutput(text) {
    let output = text.trim();

    // Suppress chain-of-thought if profile requests it
    if (p.cot === "suppress") {
        const coTMarkers = [
            "<think>",
            "Reasoning:", "Thought process:",
            "Step 1:", "Step by step"
        ];
        const lower = output.toLowerCase();
        for (const marker of coTMarkers) {
            const idx = lower.indexOf(marker.toLowerCase());
            if (idx >= 0) {
                const endIdx = output.toLowerCase().includes("</think>")
                    ? output.toLowerCase().indexOf("</think>") + 9
                    : idx;
                output = output.slice(0, idx).trim() + output.slice(endIdx).trim();
                break;
            }
        }
    }

    // Apply verbosity trimming if needed
    if (p.verbosity === "concise") {
        output = output.split("\n\n").slice(0, 3).join("\n\n");
    }

    return output;
}

// -------------------------------
// START
// -------------------------------
tryNextModel();
