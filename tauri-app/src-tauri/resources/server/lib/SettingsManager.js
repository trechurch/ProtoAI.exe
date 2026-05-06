// ============================================================
// SettingsManager.js — SDOA v3.0 Service (NodeJS)
// version: 1.0.0
// Last modified: 2026-05-02 10:00 UTC
// depends: fs, https, paths
// ============================================================

// SettingsManager — reads/writes settings.json, validates API keys, merges defaults
const fs = require("fs");
const path = require("path");
const https = require("https");

let DEFAULTS = {};
try {
  const defaultsPath = path.join(__dirname, "..", "data", "settings.defaults.json");
  DEFAULTS = JSON.parse(fs.readFileSync(defaultsPath, "utf8"));
} catch (err) {
  console.error("[SettingsManager] Warning: failed to load settings.defaults.json", err.message);
  DEFAULTS = {
    version: 1, firstRunCompleted: false, apiKeys: {}, models: { enabled: [], defaults: {}, failoverList: [] },
    profiles: { defaultProfile: "default", fallbackProfile: "analysis", userProfiles: {} },
    ingestion: { maxDepth: 4, maxFileSizeMB: 10, supportedExtensions: [".js", ".ts", ".py", ".rs", ".md", ".txt", ".json", ".html", ".css"] },
    backend: { timeoutMs: 30000, retryCount: 3, fallbackBehavior: "http" }, spellcheck: { enabled: true }, advanced: { debugLogging: false }
  };
}

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

    // ── SDOA v3.0 MANIFEST ───────────────────────────────────
    static MANIFEST = {
        id:           "SettingsManager",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [
            "settings.load",
            "settings.save",
            "settings.get",
            "settings.set",
            "settings.validateApiKey",
            "settings.resolveProfile",
        ],
        dependencies: ["fs", "https", "paths"],
        docs: {
            description: "Reads and writes settings.json, merges defaults, validates API keys against provider endpoints, and resolves active profiles.",
            author: "ProtoAI team",
        },
        actions: {
            commands: {
                load:            { description: "Load settings from disk, merging DEFAULTS.", input: {}, output: "Settings" },
                save:            { description: "Persist settings object to disk.", input: { settings: "object" }, output: "void" },
                get:             { description: "Get a single setting key.", input: { key: "string" }, output: "any" },
                set:             { description: "Set a single setting key and persist.", input: { key: "string", value: "any" }, output: "void" },
                validateApiKey:  { description: "Test an API key against the provider endpoint.", input: { provider: "string", key: "string" }, output: "{ valid, credits?, error? }" },
                resolveProfile:  { description: "Resolve the active profile config for a given profile name.", input: { profile: "string?" }, output: "ProfileConfig" },
            },
            triggers:  {},
            emits:     {},
            workflows: {},
        },
    };
    // ── end MANIFEST ─────────────────────────────────────────

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

  // Returns whether each provider has a key saved (checks secret.key for openrouter)
  getKeyInfo() {
    if (!this._settings) this.load();
    const secretKeyPath = path.join(path.dirname(this.filePath), "secret.key");
    let secretKeyExists = false;
    try {
      const content = fs.readFileSync(secretKeyPath, "utf8").trim();
      secretKeyExists = content.length > 0;
    } catch (_) {}

    const apiKeys = this._settings.apiKeys || {};
    const status  = this._settings.apiKeyStatus || {};
    return {
      ok: true,
      providers: {
        anthropic:  { saved: !!(apiKeys.anthropic),  status: status.anthropic  || null },
        openai:     { saved: !!(apiKeys.openai),      status: status.openai     || null },
        openrouter: { saved: !!(apiKeys.openrouter) || secretKeyExists, secretKey: secretKeyExists, status: status.openrouter || null },
      },
    };
  }

  // ── _httpsGet helper ────────────────────────────────────────
  _httpsGet(options, body) {
    return new Promise((resolve) => {
      const req = https.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
      });
      req.setTimeout(8000, () => { req.destroy(); resolve({ statusCode: 0, body: "" }); });
      req.on("error", (e) => resolve({ statusCode: 0, body: "", networkError: e.message }));
      if (body) req.write(body);
      req.end();
    });
  }

  validateApiKey(provider, key) {
    return new Promise(async (resolve) => {
      if (!this._settings) this.load();

      // For openrouter: fall back to secret.key when no key in settings
      let apiKey = (key || "").trim() || this._settings.apiKeys?.[provider] || "";
      if (!apiKey && provider === "openrouter") {
        try {
          const secretKeyPath = path.join(path.dirname(this.filePath), "secret.key");
          apiKey = fs.readFileSync(secretKeyPath, "utf8").trim();
        } catch (_) {}
      }
      if (!apiKey) return resolve({ ok: false, error: "No API key provided" });

      const authHeaders = {
        anthropic:  { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        openai:     { Authorization: `Bearer ${apiKey}` },
        openrouter: { Authorization: `Bearer ${apiKey}`, "HTTP-Referer": "https://protoai.app", "X-Title": "ProtoAI" },
      };
      if (!authHeaders[provider]) return resolve({ ok: false, error: `Unknown provider: ${provider}` });

      // ── Primary validation request ────────────────────────
      const primaryConfigs = {
        anthropic: {
          hostname: "api.anthropic.com", port: 443, path: "/v1/messages", method: "POST",
          headers: authHeaders.anthropic,
        },
        openai: {
          hostname: "api.openai.com", port: 443, path: "/v1/models", method: "GET",
          headers: authHeaders.openai,
        },
        openrouter: {
          hostname: "openrouter.ai", port: 443, path: "/api/v1/auth/key", method: "GET",
          headers: authHeaders.openrouter,
        },
      };

      const config = primaryConfigs[provider];
      if (!config) return resolve({ ok: false, error: "No validation config for provider" });

      let body = null;
      if (provider === "anthropic") {
        body = JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        });
      }

      const response = await this._httpsGet(config, body);
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return resolve({ ok: true });
      } else if (response.statusCode === 401) {
        return resolve({ ok: false, error: "Unauthorized — invalid API key" });
      } else if (response.statusCode === 429) {
        return resolve({ ok: false, error: "Rate limited — please try again later" });
      } else {
        return resolve({ ok: false, error: `HTTP ${response.statusCode}` });
      }
    });
  }
}

module.exports = SettingsManager;
