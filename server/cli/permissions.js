#!/usr/bin/env node
// ProtoAI File Permissions CLI
// Usage:
//   node permissions.js grant --project myapp --file src/components/Header.jsx
//   node permissions.js grant --project myapp --directory src/components
//   node permissions.js grant --project myapp --pattern src/**/*.js
//   node permissions.js revoke --project myapp --file src/components/Header.jsx
//   node permissions.js list --project myapp
//   node permissions.js check --project myapp --file src/components/Header.jsx
//   node permissions.js clear --project myapp
//   node permissions.js set-default --project myapp --default allow|deny

const path = require("path");
const fs = require("fs-extra");

// Locate project root
const ROOT_DIR = path.resolve(__dirname, "..");

const PERMISSIONS_FILE = ".protoai-permissions.json";

// Simple argument parser
const args = process.argv.slice(2);
const argv = {};
let command = args[0];

for (let i = 1; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    const key = args[i].slice(2);
    if (args[i + 1] && !args[i + 1].startsWith("--")) {
      argv[key] = args[++i];
    } else {
      argv[key] = true;
    }
  }
}

const { project, file, directory, pattern, default: newDefault } = argv;

// Colors for terminal output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m"
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function getPermissionsPath(proj) {
  const projectDir = path.join(ROOT_DIR, "data", "projects", proj);
  return path.join(projectDir, PERMISSIONS_FILE);
}

function loadPermissions(proj) {
  const filePath = getPermissionsPath(proj);
  if (!fs.existsSync(filePath)) {
    return {
      version: 1,
      project: proj,
      granted: [],
      default: "deny",
      lastModified: new Date().toISOString()
    };
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    return {
      version: 1,
      project: proj,
      granted: [],
      default: "deny",
      lastModified: new Date().toISOString()
    };
  }
}

function savePermissions(proj, permissions) {
  const filePath = getPermissionsPath(proj);
  // Ensure project directory exists
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  permissions.lastModified = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(permissions, null, 2), "utf8");
  return permissions;
}

function printHelp() {
  console.log(`
${colorize("ProtoAI File Permissions Manager", "bold")}

${colorize("Usage:", "bold")}
  node permissions.js <command> --project <name> [options]

${colorize("Commands:", "bold")}
  grant         Grant AI editing access to a file, directory, or pattern
  revoke        Revoke AI editing access
  list          Show all current permissions
  check         Check if a specific file is accessible by AI
  clear         Remove all AI permissions for a project
  set-default   Set default AI editing policy (allow/deny)

${colorize("Options:", "bold")}
  --file        Path to a specific file
  --directory   Path to a directory (grants access to all files inside)
  --pattern     Glob pattern (e.g., src/**/*.js)
  --default     "allow" or "deny" for set-default command
  --tier        "eager", "cached", or "lazy" for file context tier

${colorize("Tier System:", "bold")}
  ${colorize("eager:", "green")}   Always included in AI context (core files)
  ${colorize("cached:", "cyan")}    Cached after first read (support files)
  ${colorize("lazy:", "yellow")}    Only included if explicitly referenced by name

${colorize("Examples:", "bold")}
  ${colorize("# Grant access to a single file", "dim")}
  node permissions.js grant --project myapp --file src/components/Header.jsx

  ${colorize("# Grant with tier", "dim")}
  node permissions.js grant --project myapp --file src/utils.js --tier cached

  ${colorize("# Set tier on existing permission", "dim")}
  node permissions.js set-tier --project myapp --file src/utils.js --tier lazy

  ${colorize("# Clear all permissions", "dim")}
  node permissions.js clear --project myapp
`);
}

// Execute command
async function run() {
  if (!command || !project) {
    printHelp();
    process.exit(1);
  }

  const permissions = loadPermissions(project);

  switch (command) {
    case "grant": {
      if (!file && !directory && !pattern) {
        console.log(colorize("Error: Must specify --file, --directory, or --pattern", "red"));
        process.exit(1);
      }

      const grant = {
        type: file ? "file" : directory ? "directory" : "pattern",
        path: file || directory || pattern,
        tier: argv.tier || "eager",
        grantedAt: new Date().toISOString()
      };

      const existing = permissions.granted.findIndex(
        g => g.type === grant.type && g.path === grant.path
      );

      if (existing >= 0) {
        permissions.granted[existing] = grant;
        console.log(colorize(`Updated permission for: ${grant.path}`, "yellow"));
      } else {
        permissions.granted.push(grant);
        console.log(colorize(`+ Granted AI editing access to: ${grant.type} "${grant.path}"`, "green"));
      }

      savePermissions(project, permissions);
      console.log(colorize(`Total permissions: ${permissions.granted.length}`, "dim"));
      break;
    }

    case "revoke": {
      const target = file || directory || pattern;
      if (!target) {
        console.log(colorize("Error: Must specify --file, --directory, or --pattern", "red"));
        process.exit(1);
      }

      const before = permissions.granted.length;
      permissions.granted = permissions.granted.filter(
        g => !(g.type === (file ? "file" : directory ? "directory" : "pattern") && g.path === target)
      );
      const removed = before - permissions.granted.length;

      if (removed === 0) {
        console.log(colorize(`No permission found for: ${target}`, "red"));
      } else {
        console.log(colorize(`- Revoked AI editing access from: ${target}`, "red"));
        savePermissions(project, permissions);
      }
      break;
    }

    case "list": {
      console.log(colorize(`Permissions for project: ${project}`, "bold"));
      console.log(colorize(`Default policy: ${permissions.default}`, "cyan"));

      if (permissions.granted.length === 0) {
        console.log(colorize("  (no permissions granted)", "dim"));
      } else {
        permissions.granted.forEach((g, i) => {
          const icon = g.type === "directory" ? "📁" : g.type === "file" ? "📄" : "🔗";
          console.log(`  ${colorize(`${i + 1}.`, "dim")} ${icon} ${g.type}: "${g.path}" ${colorize(`(${new Date(g.grantedAt).toLocaleDateString()})`, "dim")}`);
        });
      }
      console.log(colorize(`\nTotal: ${permissions.granted.length} permissions`, "dim"));
      break;
    }

    case "check": {
      const checkPath = file || directory;
      if (!checkPath) {
        console.log(colorize("Error: Must specify --file or --directory to check", "red"));
        process.exit(1);
      }

      // Check exact file match
      const exactMatch = permissions.granted.find(g => g.type === "file" && g.path === checkPath);
      if (exactMatch) {
        console.log(colorize(`✅ ALLOWED: ${checkPath}`, "green"));
        console.log(colorize(`   Matched rule: file "${exactMatch.path}"`, "dim"));
        return;
      }

      // Check directory match
      const dirMatch = permissions.granted.find(g => g.type === "directory" && checkPath.startsWith(g.path));
      if (dirMatch) {
        console.log(colorize(`✅ ALLOWED: ${checkPath}`, "green"));
        console.log(colorize(`   Matched rule: directory "${dirMatch.path}"`, "dim"));
        return;
      }

      // Check pattern match
      const patternMatch = permissions.granted.find(g => {
        if (g.type !== "pattern") return false;
        const regex = new RegExp(
          "^" + g.path.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, ".") + "$"
        );
        return regex.test(checkPath);
      });

      if (patternMatch) {
        console.log(colorize(`✅ ALLOWED: ${checkPath}`, "green"));
        console.log(colorize(`   Matched rule: pattern "${patternMatch.path}"`, "dim"));
        return;
      }

      // Default policy
      if (permissions.default === "allow") {
        console.log(colorize(`✅ ALLOWED: ${checkPath}`, "green"));
        console.log(colorize("   Reason: default policy is 'allow'", "dim"));
      } else {
        console.log(colorize(`❌ DENIED: ${checkPath}`, "red"));
        console.log(colorize("   Reason: default policy is 'deny' and no matching permission", "dim"));
      }
      break;
    }

    case "clear": {
      permissions.granted = [];
      savePermissions(project, permissions);
      console.log(colorize(`Cleared all AI editing permissions for project: ${project}`, "yellow"));
      break;
    }

    case "set-default": {
      if (!newDefault || (newDefault !== "allow" && newDefault !== "deny")) {
        console.log(colorize("Error: --default must be 'allow' or 'deny'", "red"));
        process.exit(1);
      }
      permissions.default = newDefault;
      savePermissions(project, permissions);
      console.log(colorize(`Set default AI editing policy to: ${newDefault}`, "green"));
      break;
    }

    case "set-tier": {
      const target = file || directory || pattern;
      if (!target) {
        console.log(colorize("Error: Must specify --file, --directory, or --pattern", "red"));
        process.exit(1);
      }
      if (!argv.tier || (argv.tier !== "eager" && argv.tier !== "cached" && argv.tier !== "lazy")) {
        console.log(colorize("Error: --tier must be 'eager', 'cached', or 'lazy'", "red"));
        process.exit(1);
      }

      const found = permissions.granted.findIndex(g => {
        const matchType = g.type === (file ? "file" : directory ? "directory" : "pattern");
        return matchType && g.path === target;
      });

      if (found < 0) {
        console.log(colorize(`No permission found for: ${target}`, "red"));
        break;
      }

      permissions.granted[found].tier = argv.tier;
      savePermissions(project, permissions);
      console.log(colorize(`Set tier to "${argv.tier}" for: ${target}`, "green"));
      break;
    }

    default:
      console.log(colorize(`Unknown command: ${command}`, "red"));
      printHelp();
      process.exit(1);
  }
}

run();
