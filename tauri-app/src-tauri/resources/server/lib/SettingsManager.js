// SettingsManager — reads/writes settings.json, validates API keys, merges defaults
const fs = require("fs");
const path = require("path");
const https = require("https");

const DEFAULTS = {
  version: 1,
  firstRunCompleted: false,
  apiKeys: { anthropic: "", openai: "", openrouter: "" },
  models: {
    enabled: [
      "anthropic/claude-3.5-sonnet",
      "anthropic/claude-opus-4.1",
      "openai/gpt-4o-mini"
    ],
    defaults: { default: "anthropic/claude-3.5-sonnet", coding: "anthropic/claude-3.5-sonnet" },
    failoverList: [],
  },
  profiles: {
    defaultProfile: "default",
    fallbackProfile: "analysis",
    // User-defined profiles: { [id]: { archetypeId?, name?, model?, system?, ... } }
    userProfiles: {},
  },
  ingestion: {
    maxDepth: 4,
    maxFileSizeMB: 10,
    supportedExtensions: [".js", ".ts", ".py", ".rs", ".go", ".java", ".md", ".txt", ".json", ".html", ".css"],
  },
  backend: { timeoutMs: 30000, retryCount: 3, fallbackBehavior: "http" },
  spellcheck: { enabled: true },
  advanced: { debugLogging: false },
};

function deepMerge(target, source) {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      out[key] &&
      typeof out[key] === "object"
    ) {
      out[key] = deepMerge(out[key], source[key]);
    } else {
      out[key] = source[key];
    }
  }
  return out;
}

class SettingsManager {
  constructor(filePath) {
    this.filePath = filePath;
    this._settings = null;
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8");
        const parsed = JSON.parse(raw);
        this._settings = deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), parsed);
        console.error("[DEBUG] SettingsManager loaded settings from file:", this.filePath);
      } else {
        this._settings = JSON.parse(JSON.stringify(DEFAULTS));
        console.error("[DEBUG] SettingsManager file not found, using defaults:", this.filePath);
      }
    } catch (err) {
      console.error("[SettingsManager] Failed to load, using defaults:", err.message);
      this._settings = JSON.parse(JSON.stringify(DEFAULTS));
    }
    console.error("[DEBUG] SettingsManager.load returning:", this._settings);
    return this._settings;
  }

  save() {
    if (!this._settings) this.load();
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this._settings, null, 2), "utf8");
  }

  get(keyPath) {
    if (!this._settings) this.load();
    const parts = keyPath.split(".");
    let val = this._settings;
    for (const p of parts) {
      if (val == null || typeof val !== "object") return undefined;
      val = val[p];
    }
    return val;
  }

  set(keyPath, value) {
    if (!this._settings) this.load();
    const parts = keyPath.split(".");
    let obj = this._settings;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in obj) || typeof obj[parts[i]] !== "object") {
        obj[parts[i]] = {};
      }
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
    console.error("[DEBUG] SettingsManager set: keyPath=", keyPath, "value=", typeof value === "string" ? value.substring(0, 10) + "..." : value);
    this.save();
  }

  // -----------------------------------------------------------------------
  // Archetype + profile resolution helpers
  // -----------------------------------------------------------------------

  // Returns all archetype objects from data/archetypes/*.json
  getArchetypes() {
    const archetypesDir = path.join(path.dirname(this.filePath), "archetypes");
    if (!fs.existsSync(archetypesDir)) return [];
    try {
      return fs.readdirSync(archetypesDir)
        .filter(f => f.endsWith(".json"))
        .map(f => {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(archetypesDir, f), "utf8"));
            return { id: f.replace(/\.json$/, ""), isArchetype: true, ...data };
          } catch { return null; }
        })
        .filter(Boolean);
    } catch { return []; }
  }

  // Returns user profiles stored in settings (profiles.userProfiles map)
  getUserProfiles() {
    if (!this._settings) this.load();
    const map = this._settings.profiles?.userProfiles || {};
    return Object.entries(map).map(([id, data]) => ({ id, isArchetype: false, ...data }));
  }

  // Persist a single user profile into settings (profiles.userProfiles[id])
  saveUserProfile(id, data) {
    if (!this._settings) this.load();
    if (!this._settings.profiles) this._settings.profiles = {};
    if (!this._settings.profiles.userProfiles) this._settings.profiles.userProfiles = {};
    this._settings.profiles.userProfiles[id] = data;
    this.save();
  }

  deleteUserProfile(id) {
    if (!this._settings) this.load();
    const map = this._settings.profiles?.userProfiles;
    if (map && id in map) {
      delete map[id];
      this.save();
    }
  }

  // Resolve a profile id to a runtime-ready profile object.
  // Chain: userProfiles[id] (with optional archetypeId inheritance) →
  //        archetypes/<id>.json → profiles.defaultProfile (legacy)
  resolveProfile(id) {
    if (!this._settings) this.load();

    // 1. User profile stored in settings
    const userProfiles = this._settings.profiles?.userProfiles || {};
    if (userProfiles[id]) {
      const user = userProfiles[id];
      if (user.archetypeId) {
        const archetype = this._loadArchetypeById(user.archetypeId);
        if (archetype) {
          return Object.assign({}, _archetypeToProfile(archetype), user, { id });
        }
      }
      return { id, ...user };
    }

    // 2. Direct archetype lookup
    const archetype = this._loadArchetypeById(id);
    if (archetype) return _archetypeToProfile(archetype);

    // 3. No match — return null (caller can fall back to legacy profiles.json)
    return null;
  }

  _loadArchetypeById(id) {
    const filePath = path.join(path.dirname(this.filePath), "archetypes", `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return { id, isArchetype: true, ...data };
    } catch { return null; }
  }

  exportAll() {
    if (!this._settings) this.load();
    return JSON.parse(JSON.stringify(this._settings));
  }

  importAll(obj) {
    this._settings = deepMerge(JSON.parse(JSON.stringify(DEFAULTS)), obj);
    this.save();
  }

  validateApiKey(provider, key) {
    return new Promise((resolve) => {
      if (!this._settings) this.load();
      const apiKey = key || this._settings.apiKeys?.[provider] || "";
      if (!apiKey) return resolve({ ok: false, error: "No API key provided" });

      const configs = {
        anthropic: {
          host: "api.anthropic.com",
          path: "/v1/messages",
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({ model: "claude-3-haiku-20240307", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
        },
        openai: {
          host: "api.openai.com",
          path: "/v1/models",
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        },
        openrouter: {
          host: "openrouter.ai",
          path: "/api/v1/models",
          method: "GET",
          headers: { Authorization: `Bearer ${apiKey}` },
        },
      };

      const cfg = configs[provider];
      if (!cfg) return resolve({ ok: false, error: `Unknown provider: ${provider}` });

      // All providers use HTTPS — always use https module
      const options = { hostname: cfg.host, port: 443, path: cfg.path, method: cfg.method, headers: cfg.headers };
      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            resolve({ ok: true });
          } else {
            let errMsg = `HTTP ${res.statusCode}`;
            try {
              const parsed = JSON.parse(data);
              errMsg = parsed?.error?.message || parsed?.error || errMsg;
            } catch (_) {}
            resolve({ ok: false, error: errMsg });
          }
        });
      });

      req.setTimeout(8000, () => { req.destroy(); resolve({ ok: false, error: "Request timed out" }); });
      req.on("error", (e) => resolve({ ok: false, error: e.message }));
      if (cfg.body) req.write(cfg.body);
      req.end();
    });
  }
}

// Convert an archetype definition into the profile shape claude-select.cjs expects
function _archetypeToProfile(archetype) {
  return {
    id: archetype.id,
    isArchetype: true,
    name: archetype.name,
    model: (archetype.primaryModels || [])[0] || "nvidia/nemotron-3-super-120b-a12b:free",
    fallback: (archetype.primaryModels || []).slice(1),
    system: _buildSystemPrompt(archetype),
    temperature: 0.7,
    max_tokens: 2048,
    verbosity: "balanced",
    format: "plain",
    memory_mode: "global+project",
    file_ingestion: true,
    cot: "suppress",
  };
}

function _buildSystemPrompt(archetype) {
  const parts = [];
  if (archetype.name) parts.push(`You are ${archetype.name}.`);
  if (archetype.description) parts.push(archetype.description);
  if (archetype.voice) parts.push(`Voice: ${archetype.voice}.`);
  if (archetype.personality) parts.push(`Personality: ${archetype.personality}.`);
  if (archetype.strengths?.length) parts.push(`Strengths: ${archetype.strengths.join(", ")}.`);
  return parts.join(" ");
}

module.exports = SettingsManager;
