// ============================================================
// MemoryManager.js — SDOA v3.0 Service (NodeJS)
// version: 1.0.0
// Last modified: 2026-05-02 10:00 UTC
// depends: fs-extra, LocalModelAdapter, paths
// ============================================================

// MemoryManager.js — Persistent long-term memory and user profiling
const fs = require("fs-extra");
const path = require("path");
const paths = require("../access/env/paths");
const local = require("../access/llm/LocalModelAdapter");

class MemoryManager {

    // ── SDOA v3.0 MANIFEST ───────────────────────────────────
    static MANIFEST = {
        id:           "MemoryManager",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [
            "memory.loadGlobal",
            "memory.loadUserProfile",
            "memory.record",
            "memory.distillProfile",
        ],
        dependencies: ["fs-extra", "LocalModelAdapter", "paths"],
        docs: {
            description: "Persistent long-term memory and user profiling. Records observations, distills them into a coherent user trait profile via the local GGUF model.",
            author: "ProtoAI team",
        },
        actions: {
            commands: {
                loadGlobal:      { description: "Load global shared memory facts.", input: {}, output: "{ facts, observations }" },
                loadUserProfile: { description: "Load persistent user profile.", input: {}, output: "UserProfile" },
                record:          { description: "Record a fact or user observation.", input: { type: "string", content: "string", project: "string?" }, output: "void" },
                distillProfile:  { description: "Use local model to distill raw observations into a coherent trait profile.", input: {}, output: "void" },
            },
            triggers:  {},
            emits:     {},
            workflows: {},
        },
    };
    // ── end MANIFEST ─────────────────────────────────────────

  constructor() {
    this.globalPath = paths.globalMemory();
    this.userProfilePath = paths.userProfile();
  }

  /**
   * Load the global memory (shared across all projects)
   */
  loadGlobal() {
    if (!fs.existsSync(this.globalPath)) return { facts: [], observations: [] };
    try {
      return fs.readJsonSync(this.globalPath);
    } catch (_) {
      return { facts: [], observations: [] };
    }
  }

  /**
   * Load the persistent user profile
   */
  loadUserProfile() {
    if (!fs.existsSync(this.userProfilePath)) {
      return {
        name: "User",
        preferences: {},
        style: "balanced",
        observations: [],
        traits: [],
        lastUpdated: new Date().toISOString()
      };
    }
    try {
      return fs.readJsonSync(this.userProfilePath);
    } catch (_) {
      return { observations: [] };
    }
  }

  /**
   * Save a fact or observation to the appropriate store
   */
  async record(type, content, project = null) {
    if (type === "user_observation") {
      const profile = this.loadUserProfile();
      profile.observations.push({ content, ts: Date.now(), project });
      // Keep only last 100 observations before compaction
      if (profile.observations.length > 100) {
        profile.observations = profile.observations.slice(-100);
      }
      fs.writeJsonSync(this.userProfilePath, profile, { spaces: 2 });
    } else {
      const global = this.loadGlobal();
      global.facts.push({ content, ts: Date.now(), project });
      fs.writeJsonSync(this.globalPath, global, { spaces: 2 });
    }
  }

  /**
   * Use the local model to distill raw observations into a coherent profile
   */
  async distillProfile() {
    const profile = this.loadUserProfile();
    if (profile.observations.length < 5) return; // Wait for enough data

    const modelPath = await this._getLocalModelPath();
    if (!modelPath) return;

    const obsText = profile.observations.map(o => `- ${o.content}`).join("\n");
    const sys = `You are a psychological and behavioral profiler for an AI assistant. Analyze raw observations and update the user's persistent traits and preferences. Be concise. Output JSON only: {"traits":["trait1"],"preferences":{"category":"value"}}`;
    const prompt = `Current observations:\n${obsText}\n\nExisting profile traits: ${profile.traits.join(", ")}\n\nDistill into new JSON profile:`;

    try {
      const raw = await local.generate(prompt, {
        modelPath,
        maxTokens: 300,
        temperature: 0.2,
        systemPrompt: sys
      });

      const m = raw.match(/\{[\s\S]*?\}/);
      if (m) {
        const distilled = JSON.parse(m[0]);
        profile.traits = [...new Set([...profile.traits, ...(distilled.traits || [])])].slice(-10);
        profile.preferences = Object.assign(profile.preferences, distilled.preferences || {});
        profile.lastUpdated = new Date().toISOString();
        // Archive distilled observations? For now just keep them.
        fs.writeJsonSync(this.userProfilePath, profile, { spaces: 2 });
      }
    } catch (e) {
      console.error("[MemoryManager] Distill failed:", e.message);
    }
  }

  async _getLocalModelPath() {
    try {
      const file = paths.resolve("config", "models.json");
      if (!fs.existsSync(file)) return null;
      const models = fs.readJsonSync(file);
      const entry = (models.entries || []).find(m => m.provider === "local");
      if (!entry) return null;
      const modelPath = entry.model_path;
      if (path.isAbsolute(modelPath)) return modelPath;
      return path.join(paths.root, modelPath.replace(/^\.\//, ""));
    } catch (_) {
      return null;
    }
  }
}

module.exports = new MemoryManager();
