// SettingsManager — reads/writes settings.json, validates API keys, merges defaults
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const DEFAULTS = {
  version: 1,
  firstRunCompleted: false,
  apiKeys: { anthropic: "", openai: "", openrouter: "" },
  models: {
    enabled: [
      "anthropic/claude-3.5-sonnet",
      "anthropic/claude-opus-4.1",
      "openai/gpt-4o-mini",
      "qwen/qwen3.6-plus:free",
    ],
    defaults: { default: "qwen/qwen3.6-plus:free", coding: "anthropic/claude-3.5-sonnet" },
  },
  profiles: { defaultProfile: "default", fallbackProfile: "analysis" },
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
      } else {
        this._settings = JSON.parse(JSON.stringify(DEFAULTS));
      }
    } catch (err) {
      console.error("[SettingsManager] Failed to load, using defaults:", err.message);
      this._settings = JSON.parse(JSON.stringify(DEFAULTS));
    }
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
    this.save();
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

      const client = cfg.host.includes("openai.com") || cfg.host.includes("openrouter") ? http : https;

      const options = { hostname: cfg.host, port: 443, path: cfg.path, method: cfg.method, headers: cfg.headers };
      const req = client.request(options, (res) => {
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

module.exports = SettingsManager;
