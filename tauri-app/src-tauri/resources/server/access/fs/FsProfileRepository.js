// Last modified: 2026-05-04 03:11 UTC
const path = require("path");
const BaseRepository = require("./BaseRepository");
const paths = require("../env/paths");

class FsProfileRepository extends BaseRepository {

    static MANIFEST = {
        id:           "FsProfileRepository",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages FsProfileRepository operations.",
            author: "ProtoAI team",
        },
        actions: {
            commands:  {},
            triggers:  {},
            emits:     {},
            workflows: {},
        },
    };
      constructor() {
    super(paths.cli("helpers"));
  }

  // -----------------------------------------------------------------
  // Legacy: flat profiles.json used by cli/claude-select.cjs
  // -----------------------------------------------------------------
  loadProfiles() {
    return this.readJson(paths.profiles(), {});
  }

  /**
   * Unified list for the UI dropdown.
   * Merges legacy profiles, archetypes, and user profiles.
   * Returns an array of objects: [{ id, name, type }]
   */
  listAllForUI() {
    const legacy = this.loadProfiles();
    const archetypes = this.loadArchetypes();
    const userProfiles = this.loadUserProfiles();

    const pool = [];
    const seen = new Set();

    // 1. User-created profiles
    userProfiles.forEach(u => {
      seen.add(u.id);
      pool.push({ id: u.id, name: u.name || u.id, type: "user" });
    });

    // 2. Archetypes (templates)
    archetypes.forEach(a => {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        pool.push({ id: a.id, name: a.name || a.id, type: "archetype" });
      }
    });

    // 3. Legacy profiles
    Object.keys(legacy).forEach(id => {
      if (!seen.has(id)) {
        seen.add(id);
        pool.push({ id, name: legacy[id].name || id, type: "legacy" });
      }
    });

    return pool;
  }

  // -----------------------------------------------------------------
  // Archetypes: read-only templates stored in data/archetypes/
  // Returns an array of archetype objects, each with an `id` field
  // derived from the filename (without .json).
  // -----------------------------------------------------------------
  loadArchetypes() {
    const dir = paths.archetypes();
    if (!this.fileExists(dir)) return [];
    try {
      return this.listFiles(dir)
        .filter(f => f.endsWith(".json"))
        .map(f => {
          const id = f.replace(/\.json$/, "");
          const data = this.readJson(paths.archetypes(f), null);
          if (!data) return null;
          return { id, isArchetype: true, ...data };
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  loadArchetype(id) {
    const filePath = paths.archetypes(`${id}.json`);
    if (!this.fileExists(filePath)) return null;
    const data = this.readJson(filePath, null);
    if (!data) return null;
    return { id, isArchetype: true, ...data };
  }

  // -----------------------------------------------------------------
  // User profiles: custom profiles stored in data/user-profiles/
  // Each file is <id>.json; may contain an archetypeId key to inherit.
  // -----------------------------------------------------------------
  loadUserProfiles() {
    const dir = paths.userProfiles();
    if (!this.fileExists(dir)) return [];
    try {
      return this.listFiles(dir)
        .filter(f => f.endsWith(".json"))
        .map(f => {
          const id = f.replace(/\.json$/, "");
          const data = this.readJson(paths.userProfiles(f), null);
          if (!data) return null;
          return { id, isArchetype: false, ...data };
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  saveUserProfile(id, data) {
    const dir = paths.userProfiles();
    const fs = require("fs-extra");
    fs.mkdirpSync(dir);
    this.writeJsonSync(paths.userProfiles(`${id}.json`), data);
  }

  deleteUserProfile(id) {
    const filePath = paths.userProfiles(`${id}.json`);
    const fs = require("fs-extra");
    if (fs.existsSync(filePath)) fs.removeSync(filePath);
  }

  // -----------------------------------------------------------------
  // Resolve a profile id → merged settings object
  // Resolution order: user profile (with archetype inheritance) →
  //   archetype → legacy profiles.json entry → null
  // -----------------------------------------------------------------
  resolveProfile(id) {
    // 1. Try user profile
    const userFilePath = paths.userProfiles(`${id}.json`);
    if (this.fileExists(userFilePath)) {
      const user = this.readJson(userFilePath, null);
      if (user) {
        if (user.archetypeId) {
          const archetype = this.loadArchetype(user.archetypeId);
          if (archetype) {
            // User overrides take precedence over archetype defaults
            return Object.assign({}, archetypeToProfile(archetype), user, { id });
          }
        }
        return { id, ...user };
      }
    }

    // 2. Try archetype directly
    const archetype = this.loadArchetype(id);
    if (archetype) return archetypeToProfile(archetype);

    // 3. Fall back to legacy flat profiles.json
    const legacy = this.loadProfiles();
    if (legacy[id]) return { id, ...legacy[id] };

    return null;
  }
}

// Convert an archetype object into the shape claude-select.cjs expects
function archetypeToProfile(archetype) {
  return {
    id: archetype.id,
    isArchetype: true,
    name: archetype.name,
    model: (archetype.primaryModels || [])[0] || "nvidia/nemotron-3-super-120b-a12b:free",
    fallback: (archetype.primaryModels || []).slice(1),
    system: buildSystemPrompt(archetype),
    temperature: 0.7,
    max_tokens: 2048,
    verbosity: "balanced",
    format: "plain",
    memory_mode: "global+project",
    file_ingestion: true,
    cot: "suppress",
  };
}

function buildSystemPrompt(archetype) {
  const parts = [];
  if (archetype.name) parts.push(`You are ${archetype.name}.`);
  if (archetype.description) parts.push(archetype.description);
  if (archetype.voice) parts.push(`Voice: ${archetype.voice}.`);
  if (archetype.personality) parts.push(`Personality: ${archetype.personality}.`);
  if (archetype.strengths?.length) parts.push(`Strengths: ${archetype.strengths.join(", ")}.`);
  return parts.join(" ");
}

module.exports = FsProfileRepository;
