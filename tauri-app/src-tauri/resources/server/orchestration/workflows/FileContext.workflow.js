// Last modified: 2026-05-04 03:11 UTC
// FileContextWorkflow — resolves which files to include as context in a chat message
// Uses FilePermissionsWorkflow tiers:
//   - "eager": always include content (fast, small files)
//   - "cached": include content if it's in the context cache
//   - "lazy": only include if user explicitly references by filename in the message
//
// AUTO-ESCALATION: When an eager file imports/requires another file, that file's
// tier is automatically raised to eager for this context resolution. This means
// if App.jsx imports utils, utils gets pulled in automatically. Recursive: if
// utils imports helpers, helpers also gets pulled in.
//
// NOTE: Escalation is per-session (memory only). It does NOT modify the
// permissions file on disk.

const path = require("path");
const fs = require("fs-extra");
const pathsModule = require("../../access/env/paths");
const WorkflowResult = require("../WorkflowResult");

const PERMISSIONS_FILE = ".protoai-permissions.json";
const CONTEXT_CACHE_FILE = ".protoai-context-cache.json";

// Extensions to scan for imports (ignore binary/build artifacts)
const CODE_EXTENSIONS = new Set([
  ".js", ".jsx", ".mjs", ".cjs",
  ".ts", ".tsx", ".mts", ".cts",
  ".py",
  ".html", ".htm", ".svelte", ".vue",
  ".css", ".scss", ".less",
  ".json",
  ".toml", ".yaml", ".yml",
  ".rs", ".go", ".rb", ".php",
  ".sh", ".bash", ".ps1",
  ".lua", ".r", ".R",
  ".java", ".kt", ".swift",
]);

function isCodeFile(fileName) {
  const ext = fileName.includes(".") ? "." + fileName.split(".").pop().toLowerCase() : "";
  return CODE_EXTENSIONS.has(ext);
}

let cache = null;

function getCachePath(project) {
  const projectDir = pathsModule.projectDir(project);
  return path.join(projectDir, CONTEXT_CACHE_FILE);
}

function loadCache(project) {
  const filePath = getCachePath(project);
  if (!fs.existsSync(filePath)) return {};
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")).entries || {}; }
  catch (_) { return {}; }
}

function updateCache(project, key, content) {
  const filePath = getCachePath(project);
  if (!cache) cache = {};
  cache[key] = { content, cachedAt: new Date().toISOString() };
  try { fs.writeFileSync(filePath, JSON.stringify({ entries: cache, project }, null, 2), "utf8"); }
  catch (_) {}
}

function loadPermissions(project) {
  const projectDir = pathsModule.projectDir(project);
  const filePath = path.join(projectDir, PERMISSIONS_FILE);
  if (!fs.existsSync(filePath)) return { granted: [], default: "deny" };
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); }
  catch (_) { return { granted: [], default: "deny" }; }
}

function getTierForFile(permissions, fileName, effectiveTiers) {
  // Check if auto-escalated
  if (effectiveTiers.has(fileName)) return effectiveTiers.get(fileName);

  for (const g of permissions.granted) {
    if (g.type === "file" && g.path === fileName) return g.tier || "eager";
    if (g.type === "directory" && fileName.startsWith(g.path)) return g.tier || "eager";
    if (g.type === "pattern") {
      const regex = new RegExp(
        "^" + g.path.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\?/g, ".") + "$"
      );
      if (regex.test(fileName)) return g.tier || "eager";
    }
  }
  return permissions.default === "allow" ? "eager" : "none";
}

function fileReferencesName(text, fileName) {
  if (!text || !fileName) return false;
  const base = fileName.replace(/\.[^.]+$/, "");
  return text.toLowerCase().includes(fileName.toLowerCase()) ||
         text.toLowerCase().includes(base.toLowerCase());
}

// ---------------------------------------------------------------------------
// IMPORT / DEPENDENCY DETECTION
// ---------------------------------------------------------------------------

const PATTERNS = [
  // JS/TS: import ... from "path"
  /import\s+(?:[\s\S]*?)\s+from\s+[`'""]([^`'"]+)[`'"]/gm,
  // JS/TS: import "path" (side-effect)
  /^import\s+[`'""]([^`'"]+)[`'"]/gm,
  // JS/TS: require("path") or require('path')
  /(?:const|let|var)\s+\w+\s*=\s*require\s*\(\s*[`'""]([^`'"]+)[`'""]\s*\)/gm,
  // Python: import module / from module import ...
  /(?:^import\s+([\w.]+)|^from\s+([\w.]+)\s+import)/gm,
  // CSS/HTML: @import url("path") or @import "path"
  /@import\s+(?:url\(\s*)?[`'""]([^`'"]+)[`'"]/gm,
  // HTML: src="path" or href="path" (local files only)
  /(?:src|href)=["'](\.\/[^"']+)["']/gm,
];

function extractImports(content, fileName) {
  const imports = new Set();
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0; // reset global flag
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const raw = (match[1] || match[2] || "").trim();
      if (!raw || raw.startsWith("/") || raw.startsWith("http") || raw.startsWith("#")) continue;
      imports.add(raw);
    }
  }
  return imports;
}

function resolveImport(rawImport, projectFiles) {
  // Try exact match
  if (projectFiles.has(rawImport)) return rawImport;

  // Try adding common extensions
  const extensions = [".js", ".jsx", ".ts", ".tsx", ".mjs", ".py", ".html", ".css", ".json", ".vue", ".svelte"];
  if (!rawImport.includes(".")) {
    for (const ext of extensions) {
      const candidate = rawImport + ext;
      if (projectFiles.has(candidate)) return candidate;
    }
    // Try with index file
    for (const ext of extensions) {
      const candidate = rawImport + "/index" + ext;
      if (projectFiles.has(candidate)) return candidate;
    }
  }

  // Strip leading ./ or ../
  const normalized = rawImport.replace(/^\..\//, "").replace(/^\.\//, "");
  if (projectFiles.has(normalized)) return normalized;

  // If it's a path like "folder/file" try matching
  // e.g. import from "./components/App" -> match "components/App.jsx" or "App.jsx"
  const baseName = path.basename(rawImport);
  if (baseName && !baseName.includes(".")) {
    for (const ext of extensions) {
      const candidate = rawImport + ext;
      if (projectFiles.has(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * Resolve dependency graph starting from eager files.
 * Recursively escalates tiers for files that are imported by already-eager files.
 * Returns: Set of files that should be treated as eager
 */
function resolveDependencyGraph(fileTiers, projectFiles, projectDir) {
  const escalationMap = new Map(fileTiers); // fileName -> "eager" | "cached" | "lazy"
  const resolved = new Set(); // avoid cycles
  const queue = [];

  // Seed queue with initially-eager files
  for (const [file, tier] of fileTiers.entries()) {
    if (tier === "eager") queue.push(file);
  }

  while (queue.length > 0) {
    const currentFile = queue.shift();
    if (resolved.has(currentFile)) continue;
    resolved.add(currentFile);

    const fullPath = path.join(projectDir, currentFile);
    if (!isCodeFile(currentFile)) continue;

    let content;
    try { content = fs.readFileSync(fullPath, "utf8"); }
    catch (_) { continue; }

    const imports = extractImports(content, currentFile);
    for (const rawImport of imports) {
      const resolvedPath = resolveImport(rawImport, projectFiles);
      if (!resolvedPath) continue;

      const existingTier = escalationMap.get(resolvedPath) || "none";
      const newTier = resolveHigherTier(existingTier, "eager");

      if (newTier !== existingTier) {
        escalationMap.set(resolvedPath, newTier);
        if (newTier === "eager" && !resolved.has(resolvedPath)) {
          queue.push(resolvedPath); // recurse into newly-eager files
        }
      }
    }
  }

  return escalationMap;
}

function resolveHigherTier(current, candidate) {
  const order = { "none": 0, "lazy": 1, "cached": 2, "eager": 3 };
  return (order[candidate] > order[current]) ? candidate : current;
}

// ---------------------------------------------------------------------------
// MAIN WORKFLOW
// ---------------------------------------------------------------------------

class FileContextWorkflow {

    static MANIFEST = {
        id:           "FileContextWorkflow",
        type:         "service",
        runtime:      "NodeJS",
        version:      "1.0.0",
        capabilities: [],
        dependencies: [],
        docs: {
            description: "Manages FileContextWorkflow operations.",
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
    const { project, message, maxBytes } = context || {};
    if (!project) {
      return new WorkflowResult("error", { error: "Missing 'project' parameter" });
    }

    const perms = loadPermissions(project);
    cache = loadCache(project);
    const MAX_BYTES = maxBytes || 524288; // 512KB
    const MAX_FILE_BYTES = 131072; // 128KB per-file cap
    let totalBytes = 0;

    const projectDir = pathsModule.projectDir(project);
    if (!fs.existsSync(projectDir)) {
      return new WorkflowResult("ok", { files: [], context: "", message, escalatedFiles: [] });
    }

    // Step 0: Optional QMD Semantic Search
    let semanticContext = "";
    try {
      const IngestWorkflow = require("./IngestWorkflow");
      const ingest = new IngestWorkflow();
      const qmdResult = await ingest.search({ query: message, project });
      if (qmdResult.status === "success" && qmdResult.results && qmdResult.results.length > 0) {
        const snippets = qmdResult.results.slice(0, 3).map(res => 
          `[Semantic Match: ${res.path} (score: ${res.score})]\n${res.content}`
        );
        semanticContext = `--- SEMANTIC CONTEXT ---\n${snippets.join("\n\n")}\n--- END SEMANTIC CONTEXT ---\n\n`;
      }
    } catch (_) {
      // QMD not available or failed — skip silently
    }

    function walkSync(dir, filelist = []) {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          if (!file.startsWith(".") && file !== "node_modules" && file !== "dist") {
            walkSync(fullPath, filelist);
          }
        } else {
          if (!file.startsWith(".protoai-")) {
            filelist.push(path.relative(projectDir, fullPath));
          }
        }
      });
      return filelist;
    }

    const allFiles = walkSync(projectDir);

    const projectFiles = new Set(allFiles);

    // Step 1: Classify files by initial tier
    const fileTiers = new Map();
    for (const f of allFiles) {
      const tier = getTierForFile(perms, f, new Map());
      fileTiers.set(f, tier);
    }

    // Step 2: Resolve dependency graph — auto-escalate imports
    const escalatedTiers = resolveDependencyGraph(fileTiers, projectFiles, projectDir);

    // Track which files got escalated
    const escalatedFiles = [];
    for (const [file, tier] of escalatedTiers.entries()) {
      const originalTier = fileTiers.get(file) || "none";
      if (tier !== originalTier && (tier === "eager" || tier === "cached")) {
        escalatedFiles.push({ file, from: originalTier, to: tier });
      }
    }

    // Step 3: Read files in tier priority (eager → cached → lazy)
    const parts = [];

    // 3a. Eager files (including escalated)
    for (const f of allFiles) {
      if (totalBytes >= MAX_BYTES) break;
      if (escalatedTiers.get(f) !== "eager") continue;
      try {
        const stat = fs.statSync(path.join(projectDir, f));
        if (stat.size > MAX_FILE_BYTES) continue; // skip oversized files
        const content = fs.readFileSync(path.join(projectDir, f), "utf8");
        const chunk = `[File: ${f}]${escalatedFiles.find(e => e.file === f) ? " (auto-escalated via import chain)" : ""}\n${content}`;
        const taken = Math.min(chunk.length, MAX_BYTES - totalBytes);
        totalBytes += taken;
        parts.push(chunk.slice(0, taken));
      } catch (_) {}
    }

    // 3b. Cached files
    for (const f of allFiles) {
      if (totalBytes >= MAX_BYTES) break;
      if (escalatedTiers.get(f) !== "cached") continue;
      if (cache[f]) {
        const chunk = `[File (cached): ${f}]\n${cache[f].content}`;
        const taken = Math.min(chunk.length, MAX_BYTES - totalBytes);
        totalBytes += taken;
        parts.push(chunk.slice(0, taken));
      }
    }

    // 3c. Lazy files (only if user references by name)
    if (message) {
      for (const f of allFiles) {
        if (totalBytes >= MAX_BYTES) break;
        if (escalatedTiers.get(f) !== "lazy") continue;
        if (fileReferencesName(message, f)) {
          try {
            const content = fs.readFileSync(path.join(projectDir, f), "utf8");
            const chunk = `[File (lazy match): ${f}]\n${content}`;
            const taken = Math.min(chunk.length, MAX_BYTES - totalBytes);
            totalBytes += taken;
            parts.push(chunk.slice(0, taken));
            updateCache(project, f, content.slice(0, 4096));
          } catch (_) {}
        }
      }
    }

    // Step 4: Include Project File List if requested
    let fileListContext = "";
    const projectKeywords = ["uploaded", "files", "project", "what do you see", "profile", "memory"];
    if (message && projectKeywords.some(k => message.toLowerCase().includes(k))) {
      fileListContext = `--- PROJECT FILES OVERVIEW ---\nYou have the following files in your project directory:
${allFiles.map(f => `- ${f}`).join("\n")}
--- END PROJECT FILES OVERVIEW ---\n\n`;
    }

    const contextString = semanticContext + fileListContext + (parts.length > 0 ? parts.join("\n\n") : "");

    return new WorkflowResult("ok", {
      files: {
        eager: allFiles.filter(f => escalatedTiers.get(f) === "eager"),
        cached: allFiles.filter(f => escalatedTiers.get(f) === "cached" && cache[f]),
        lazy: allFiles.filter(f => message && escalatedTiers.get(f) === "lazy" && fileReferencesName(message, f)),
      },
      escalatedFiles,
      context: contextString,
      totalBytes,
      maxBytes: MAX_BYTES,
      message,
      cacheSize: Object.keys(cache).length,
      // Auto-escalation log for debugging
      escalationLog: escalatedFiles.map(e =>
        `${e.file}: ${e.from} → ${e.to} (auto-escalated via import chain)`
      ).join("\n"),
    });
  }
}

module.exports = FileContextWorkflow;
