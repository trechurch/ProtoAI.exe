// Last modified: 2026-05-04 03:11 UTC
// FilePermissionsWorkflow — manages AI file editing permissions per project
// Stores permissions in project-level config files
// Operations: grant, revoke, list, check, clear

const path = require("path");
const fs = require("fs-extra");
const paths = require("../../access/env/paths");
const WorkflowResult = require("../WorkflowResult");

const PERMISSIONS_FILE = ".protoai-permissions.json";

function getPermissionsPath(project) {
  const projectDir = paths.projectDir(project);
  return path.join(projectDir, PERMISSIONS_FILE);
}

function loadPermissions(project) {
  const filePath = getPermissionsPath(project);
  if (!fs.existsSync(filePath)) {
    return {
      version: 1,
      project,
      granted: [],
      default: "deny", // "allow" or "deny"
      lastModified: new Date().toISOString()
    };
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    return {
      version: 1,
      project,
      granted: [],
      default: "deny",
      lastModified: new Date().toISOString()
    };
  }
}

function savePermissions(project, permissions) {
  const filePath = getPermissionsPath(project);
  permissions.lastModified = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(permissions, null, 2), "utf8");
  return permissions;
}

class FilePermissionsWorkflow {

    static MANIFEST = {
        id:           "FilePermissionsWorkflow",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages FilePermissionsWorkflow operations.",
            author: "ProtoAI team",
        },
        actions: {
            commands:  {},
            triggers:  {},
            emits:     {},
            workflows: {},
        },
    };
      async run(context) {
    const { action, project, file, directory, pattern, default: newDefault, tier } = context || {};

    if (!project) {
      return new WorkflowResult("error", { error: "Missing 'project' parameter" });
    }

    const permissions = loadPermissions(project);

    switch (action) {
      case "grant": {
        if (!file && !directory && !pattern) {
          return new WorkflowResult("error", {
            error: "Must specify 'file', 'directory', or 'pattern' to grant access to"
          });
        }

        const grant = {
          type: file ? "file" : directory ? "directory" : "pattern",
          path: file || directory || pattern,
          tier: tier || "eager", // eager | cached | lazy
          grantedAt: new Date().toISOString(),
        };

        // Check if already granted
        const existing = permissions.granted.findIndex(
          g => g.type === grant.type && g.path === grant.path
        );

        if (existing >= 0) {
          // Merge: update tier if specified, otherwise preserve
          if (tier) permissions.granted[existing].tier = tier;
        } else {
          permissions.granted.push(grant);
        }

        savePermissions(project, permissions);
        return new WorkflowResult("ok", {
          granted: grant,
          totalPermissions: permissions.granted.length,
          message: `Granted AI editing access to ${grant.type}: "${grant.path}" (tier: ${grant.tier})`
        });
      }

      case "revoke": {
        const target = file || directory || pattern;
        if (!target) {
          return new WorkflowResult("error", {
            error: "Must specify 'file', 'directory', or 'pattern' to revoke"
          });
        }

        const before = permissions.granted.length;
        permissions.granted = permissions.granted.filter(
          g => !(g.type === (file ? "file" : directory ? "directory" : "pattern") && g.path === target)
        );
        const removed = before - permissions.granted.length;

        if (removed === 0) {
          return new WorkflowResult("error", {
            error: `No permission found for: ${target}`
          });
        }

        savePermissions(project, permissions);
        return new WorkflowResult("ok", {
          revoked: target,
          remainingPermissions: permissions.granted.length,
          message: `Revoked AI editing access from: ${target}`
        });
      }

      case "list": {
        return new WorkflowResult("ok", {
          project,
          defaultPolicy: permissions.default,
          grantedPaths: permissions.granted.map(g => ({
            type: g.type,
            path: g.path,
            tier: g.tier || "eager",
            grantedAt: g.grantedAt
          })),
          total: permissions.granted.length
        });
      }

      case "check": {
        const checkPath = file || directory;
        if (!checkPath) {
          return new WorkflowResult("error", {
            error: "Must specify 'file' or 'directory' to check"
          });
        }

        // Check exact file match
        const exactMatch = permissions.granted.find(
          g => g.type === "file" && g.path === checkPath
        );

        if (exactMatch) {
          return new WorkflowResult("ok", {
            project,
            file: checkPath,
            allowed: true,
            tier: exactMatch.tier || "eager",
            matchedRule: exactMatch
          });
        }

        // Check directory match
        const dirMatch = permissions.granted.find(
          g => g.type === "directory" && checkPath.startsWith(g.path)
        );

        if (dirMatch) {
          return new WorkflowResult("ok", {
            project,
            file: checkPath,
            allowed: true,
            tier: dirMatch.tier || "eager",
            matchedRule: dirMatch
          });
        }

        // Check pattern match
        const patternMatch = permissions.granted.find(
          g => {
            if (g.type !== "pattern") return false;
            const regex = new RegExp(
              "^" + g.path.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, ".") + "$"
            );
            return regex.test(checkPath);
          }
        );

        if (patternMatch) {
          return new WorkflowResult("ok", {
            project,
            file: checkPath,
            allowed: true,
            tier: patternMatch.tier || "eager",
            matchedRule: patternMatch
          });
        }

        // Default policy
        return new WorkflowResult("ok", {
          project,
          file: checkPath,
          allowed: permissions.default === "allow",
          tier: "default",
          matchedRule: null,
          reason: "default policy: " + permissions.default
        });
      }

      case "clear": {
        permissions.granted = [];
        savePermissions(project, permissions);
        return new WorkflowResult("ok", {
          message: `Cleared all AI editing permissions for project: ${project}`
        });
      }

      case "set-default": {
        if (!newDefault || (newDefault !== "allow" && newDefault !== "deny")) {
          return new WorkflowResult("error", {
            error: "'default' must be 'allow' or 'deny'"
          });
        }
        permissions.default = newDefault;
        savePermissions(project, permissions);
        return new WorkflowResult("ok", {
          defaultPolicy: newDefault,
          message: `Set default AI editing policy to: ${newDefault}`
        });
      }

      case "set-tier": {
        if (tier !== "eager" && tier !== "cached" && tier !== "lazy") {
          return new WorkflowResult("error", {
            error: "'tier' must be 'eager', 'cached', or 'lazy'"
          });
        }
        const target = file || directory || pattern;
        if (!target) {
          return new WorkflowResult("error", {
            error: "Must specify 'file', 'directory', or 'pattern' to set tier on"
          });
        }

        const found = permissions.granted.findIndex(
          g => {
            const matchType = g.type === (file ? "file" : directory ? "directory" : "pattern");
            return matchType && g.path === target;
          }
        );

        if (found < 0) {
          return new WorkflowResult("error", {
            error: `No permission found for: ${target}`
          });
        }

        permissions.granted[found].tier = tier;
        savePermissions(project, permissions);
        return new WorkflowResult("ok", {
          file: target,
          tier: tier,
          message: `Set tier to "${tier}" for: ${target}`
        });
      }

      default:
        return new WorkflowResult("error", {
          error: `Unknown action: ${action}. Use: grant, revoke, list, check, clear, set-default, set-tier`
        });
    }
  }
}

module.exports = FilePermissionsWorkflow;
