// Last modified: 2026-05-04 03:11 UTC
const WorkflowBase = require("./WorkflowBase");
const WorkflowResult = require("./WorkflowResult");
const FsProfileRepository = require("../access/fs/FsProfileRepository");

exports.VERSION = "2.0.0";
exports.getVersion = () => exports.VERSION;

class ListProfilesWorkflow extends WorkflowBase {

    static MANIFEST = {
        id:           "ListProfilesWorkflow",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages ListProfilesWorkflow operations.",
            author: "ProtoAI team",
        },
        actions: {
            commands:  {},
            triggers:  {},
            emits:     {},
            workflows: {},
        },
    };
      async run() {
    try {
      const repo = new FsProfileRepository();

      // Archetypes — read-only templates from data/archetypes/
      const archetypes = repo.loadArchetypes().map(a => ({
        id: a.id,
        name: a.name || a.id,
        description: a.description || "",
        isArchetype: true,
        editable: false,
        primaryModels: a.primaryModels || [],
      }));

      // User profiles — custom profiles (may reference an archetypeId)
      const userProfiles = repo.loadUserProfiles().map(p => ({
        id: p.id,
        name: p.name || p.id,
        description: p.description || "",
        isArchetype: false,
        editable: true,
        archetypeId: p.archetypeId || null,
        primaryModels: p.primaryModels || (p.model ? [p.model] : []),
      }));

      // Legacy profiles from cli/helpers/profiles.json, labeled as built-in
      const legacyRaw = repo.loadProfiles();
      const legacyIds = new Set([
        ...archetypes.map(a => a.id),
        ...userProfiles.map(p => p.id),
      ]);
      const legacyProfiles = Object.entries(legacyRaw)
        .filter(([id]) => !legacyIds.has(id))
        .map(([id, data]) => ({
          id,
          name: data.name || id,
          description: data.system ? data.system.slice(0, 80) : "",
          isArchetype: false,
          editable: false,
          builtin: true,
          primaryModels: data.model ? [data.model] : [],
        }));

      return WorkflowResult.ok({
        archetypes,
        userProfiles,
        legacyProfiles,
        // Flat combined list for simple consumers (profile selects, etc.)
        profiles: [
          ...archetypes,
          ...userProfiles,
          ...legacyProfiles,
        ],
      });
    } catch (err) {
      return WorkflowResult.error(err);
    }
  }
}

module.exports = ListProfilesWorkflow;
