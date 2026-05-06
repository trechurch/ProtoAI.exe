// ProtoAI CLI Selector — Full Production Version
// Portable, path-resolved, zero hardcoded drive letters

const _pathsAbsolute = process.env.PROTOAI_ROOT
    ? require('path').join(process.env.PROTOAI_ROOT, 'tauri-app', 'src-tauri', 'resources', 'server', 'access', 'env', 'paths')
    : require('path').join(__dirname, '..', 'server', 'access', 'env', 'paths');
const paths = require(_pathsAbsolute);

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
let streamingEnabled = false;

for (let i = 0; i < args.length; i++) {
    if (args[i] === "--profile")      profile     = args[i + 1];
    if (args[i] === "--chat")         message     = args[i + 1];
    if (args[i] === "--project")      project     = args[i + 1];
    if (args[i] === "--context-file") contextFile = args[i + 1];
    if (args[i] === "--stream")       streamingEnabled = true;
}

// -------------------------------
// LOAD PROFILES — hybrid resolution
// -------------------------------
function loadArchetype(id) {
    const archetypeFile = paths.archetypes(`${id}.json`);
    if (!fs.existsSync(archetypeFile)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(archetypeFile, "utf8"));
        const primaryModels = data.primaryModels || [];
        const systemParts = [];
        if (data.name)            systemParts.push(`You are ${data.name}.`);
        if (data.description)     systemParts.push(data.description);
        if (data.voice)           systemParts.push(`Voice: ${data.voice}.`);
        if (data.personality)     systemParts.push(`Personality: ${data.personality}.`);
        if (data.strengths?.length) systemParts.push(`Strengths: ${data.strengths.join(", ")}.`);
        return {
            model: primaryModels[0] || "nvidia/nemotron-3-super-120b-a12b:free",
            fallback: primaryModels.slice(1),
            system: systemParts.join(" "),
            temperature: 0.7,
            max_tokens: 2048,
            verbosity: "balanced",
            format: "plain",
            memory_mode: "global+project",
            file_ingestion: true,
            cot: "suppress",
        };
    } catch (e) {
        console.error(`[profile] Failed to parse archetype ${id}: ${e.message}`);
        return null;
    }
}

function loadUserProfile(id) {
    const userFile = paths.userProfiles(`${id}.json`);
    if (!fs.existsSync(userFile)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(userFile, "utf8"));
        if (data.archetypeId) {
            const base = loadArchetype(data.archetypeId);
            if (base) return Object.assign({}, base, data);
        }
        return data;
    } catch (e) {
        console.error(`[profile] Failed to parse user profile ${id}: ${e.message}`);
        return null;
    }
}

let p = loadUserProfile(profile) || loadArchetype(profile);

if (!p) {
    const profileFile = paths.profiles();
    if (!fs.existsSync(profileFile)) {
        console.error("Missing profiles.json and no archetype/user-profile found for:", profile);
        process.exit(1);
    }
    const profiles = JSON.parse(fs.readFileSync(profileFile, "utf8"));
    if (!profiles[profile]) {
        console.error("Unknown profile:", profile, "(checked user-profiles/, archetypes/, and profiles.json)");
        process.exit(1);
    }
    p = profiles[profile];
}

// -------------------------------
// LOAD API KEY
// -------------------------------
let apiKey = "";
let settings = null;
const settingsPath = paths.data("settings.json");
if (fs.existsSync(settingsPath)) {
    try {
        settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        if (settings?.apiKeys?.openrouter) apiKey = settings.apiKeys.openrouter.trim();
        if (!apiKey && settings?.apiKeys?.anthropic) apiKey = settings.apiKeys.anthropic.trim();
    } catch (_) {}
}
if (!apiKey) {
    const keyFile = paths.secretKey();
    if (fs.existsSync(keyFile)) apiKey = fs.readFileSync(keyFile, "utf8").trim();
}
if (!apiKey) {
    console.error("No API key configured. Set your OpenRouter or Anthropic key in Settings.");
    process.exit(1);
}
console.error("[DEBUG] API key loaded: ", apiKey.substring(0, 12) + "...");

// -----------------------------------------------------------------------
// APPLY SETTINGS OVERRIDES FROM AutoOptimizeModels
// Priority: settings.models.defaults[profile] > settings.models.defaults.default > profile.model
// Also merge settings.models.failoverList into the fallback chain.
// -----------------------------------------------------------------------
if (settings?.models?.defaults) {
    const d = settings.models.defaults;
    // Match profile name to a defaults category
    const overrideModel = d[profile] || d.default || null;
    if (overrideModel && overrideModel !== p.model) {
        console.error(`[model] Settings override: ${overrideModel} (profile default was: ${p.model})`);
        p = Object.assign({}, p, { model: overrideModel });
    }
}

// Build the full candidate list; deduplicate while preserving order
const _profileFallback = Array.isArray(p.fallback) ? p.fallback : [];
const _globalFailover  = (settings?.models?.failoverList || []);
const _seen = new Set();
const modelsToTry = [p.model, ..._profileFallback, ..._globalFailover].filter(m => {
    if (!m || _seen.has(m)) return false;
    _seen.add(m);
    return true;
});

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
        : "(memory is currently empty)";
}

loadMemory();

// -------------------------------
// FILE CONTEXT
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
    const memoryLines = p.memory_mode === "none" ? "" : `\n\nProject Memory:\n${memoryText}`;
    const dateStr = new Date().toLocaleString();
    messages.push({ role: "system", content: `${p.system}${memoryLines}\n\nCurrent local time: ${dateStr}` });
    if (fileContext && p.file_ingestion) {
        messages.push({ role: "user", content: fileContext });
    }
    messages.push({ role: "user", content: message });
    return messages;
}

// -------------------------------
// OPENROUTER REQUEST
// -------------------------------
function sendRequest(model, callback) {
    if (streamingEnabled) { sendRequestStream(model, callback); return; }

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
                callback(null, json.choices?.[0]?.message?.content || "");
            } catch (e) {
                console.error(`Parse error for ${model}: ${data.slice(0, 500)}`);
                callback(e, null);
            }
        });
    });

    req.on("error", err => { console.error(`Network error for ${model}: ${err.message}`); callback(err, null); });
    req.setTimeout(30000, () => { req.destroy(); callback(new Error("Request timed out"), null); });
    req.write(payload);
    req.end();
}

function sendRequestStream(model, callback) {
    const payload = JSON.stringify({
        model,
        temperature: p.temperature,
        max_tokens: p.max_tokens,
        stream: true,
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
        if (res.statusCode >= 400) {
            let errData = "";
            res.on("data", c => errData += c);
            res.on("end", () => {
                const err = new Error(`HTTP ${res.statusCode}`);
                err.statusCode = res.statusCode;
                callback(err, null);
            });
            return;
        }

        let fullReply = "";
        let buffer = "";

        res.on("data", chunk => {
            buffer += chunk.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop();
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith("data: ")) continue;
                const data = trimmed.slice(6);
                if (data === "[DONE]") continue;
                try {
                    const json = JSON.parse(data);
                    const token = json.choices?.[0]?.delta?.content || "";
                    if (token) { fullReply += token; process.stdout.write("STREAM_CHUNK:" + token + "\n"); }
                } catch (_) {}
            }
        });

        res.on("end", () => callback(null, fullReply || null));
    });

    req.on("error", err => { console.error(`Stream error for ${model}: ${err.message}`); callback(err, null); });
    req.setTimeout(120000, () => { req.destroy(); callback(new Error("Request timed out"), null); });
    req.write(payload);
    req.end();
}

function isFailoverError(err, statusCode) {
    if (!err) return false;
    if (statusCode === 429 || statusCode >= 500) return true;
    if (/timed out|timeout|network|ECONNRESET|ENOTFOUND|ECONNREFUSED/i.test(String(err))) return true;
    return false;
}

// -------------------------------
// OUTPUT PROCESSING
// -------------------------------
function processOutput(text) {
    let output = text.trim();

    if (p.cot === "suppress") {
        const coTMarkers = ["<think>", "Reasoning:", "Thought process:", "Step 1:", "Step by step"];
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

    if (p.verbosity === "concise") {
        output = output.split("\n\n").slice(0, 3).join("\n\n");
    }

    // Parse and handle MEMORY_RECORD: tags
    handleMemoryRecords(text);
    output = output.split("\n").filter(l => !l.includes("MEMORY_RECORD:")).join("\n").trim();

    return output;
}

function handleMemoryRecords(text) {
    if (!project) return;
    const lines = text.split("\n");
    const newFacts = [];
    for (const line of lines) {
        if (line.includes("MEMORY_RECORD:")) {
            const fact = line.split("MEMORY_RECORD:")[1].trim();
            if (fact) newFacts.push(fact);
        }
    }
    if (newFacts.length === 0) return;

    try {
        const memoryFile = paths.projectMemory(project);
        const dir = path.dirname(memoryFile);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        let data = { facts: [], observations: [] };
        if (fs.existsSync(memoryFile)) {
            data = JSON.parse(fs.readFileSync(memoryFile, "utf8"));
        }
        if (!Array.isArray(data.facts)) data.facts = [];

        // Add new facts, avoid duplicates
        const existing = new Set(data.facts);
        newFacts.forEach(f => existing.add(f));
        data.facts = Array.from(existing);
        data.lastUpdated = new Date().toISOString();

        fs.writeFileSync(memoryFile, JSON.stringify(data, null, 2), "utf8");
        console.error(`[memory] Persistent memory updated for project: ${project}`);
    } catch (e) {
        console.error(`[memory] Failed to save memory: ${e.message}`);
    }
}

// -------------------------------
// FAILOVER CHAIN
// -------------------------------
function tryNextModel(index = 0) {
    if (index >= modelsToTry.length) {
        console.error(`All ${modelsToTry.length} model(s) failed. You are likely being rate-limited by the provider (HTTP 429). Please wait a few minutes before trying again.`);
        process.exit(1);
    }

    const model = modelsToTry[index];

    sendRequest(model, (err, reply) => {
        if (!err && reply) {
            let output;
            try { output = processOutput(reply); }
            catch (e) { output = reply.trim(); }

            if (!output) return tryNextModel(index + 1);

            if (index > 0) console.error(`[failover] Using ${model} after ${index} failure(s)`);
            console.log(output);
            return;
        }

        const statusCode = err?.statusCode || null;
        if (isFailoverError(err, statusCode)) {
            console.error(`[failover] ${model} returned ${statusCode ? `HTTP ${statusCode}` : err.message} — trying next model`);
            return tryNextModel(index + 1);
        }

        console.error(`[failover] ${model} failed with non-retryable error: ${err?.message || "empty response"}`);
        process.exit(1);
    });
}

// -------------------------------
// START
// -------------------------------
tryNextModel();
