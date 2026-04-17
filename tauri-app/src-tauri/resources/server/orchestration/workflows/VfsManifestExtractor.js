"use strict";

// ============================================================
// VfsManifestExtractor.js — Purpose-aware manifest extraction
// version: 1.0.0
// ============================================================
// Extracts type-specific intelligence from a file without
// loading the entire file into memory or sending it to an LLM.
// The resulting manifest is what gets sent to the LLM instead
// of raw file contents — keeping context windows lean.
// ============================================================

const fs   = require("fs");
const path = require("path");

const PREVIEW_CHARS  = 500;
const MAX_READ_BYTES = 1024 * 256; // 256KB max read for extraction

class VfsManifestExtractor {

    // ── extract ───────────────────────────────────────────────
    // Main entry point. Returns a manifest object for any file.
    // ── end of extract ───────────────────────────────────────

    extract(realPath, type) {
        const stat  = _safeStat(realPath);
        if (!stat) {
            return _errorManifest(realPath, "File not accessible");
        }

        const base = {
            id:          null, // set by caller
            realPath,
            type,
            generatedAt: new Date().toISOString(),
            meta: {
                size:     stat.size,
                modified: stat.mtime.toISOString(),
                ext:      path.extname(realPath).toLowerCase(),
                name:     path.basename(realPath),
            },
            purpose: {}
        };

        try {
            switch (type) {
                case "code":     base.purpose = this._extractCode(realPath);     break;
                case "document": base.purpose = this._extractDocument(realPath); break;
                case "data":     base.purpose = this._extractData(realPath);     break;
                case "image":    base.purpose = this._extractImage(realPath);    break;
                case "audio":    base.purpose = this._extractAudio(realPath);    break;
                case "video":    base.purpose = this._extractVideo(realPath);    break;
                default:         base.purpose = this._extractGeneric(realPath);  break;
            }
        } catch (err) {
            base.purpose = { error: err.message, preview: _safePreview(realPath) };
        }

        return base;
    }

    // ── code extraction ──────────────────────────────────────
    // Extracts: language, exports, imports, functions, classes,
    // SDOA manifest if present, line count, preview.
    // ── end of code extraction ───────────────────────────────

    _extractCode(filePath) {
        const content = _safeRead(filePath);
        if (!content) return { error: "Could not read file" };

        const ext      = path.extname(filePath).toLowerCase();
        const language = _languageFromExt(ext);
        const lines    = content.split("\n");

        const purpose = {
            language,
            lineCount: lines.length,
            preview:   content.slice(0, PREVIEW_CHARS),
        };

        // ── exports ───────────────────────────────────────────
        const exports_ = [];
        // ES: export default / export class / export function / export const
        const esExport = /export\s+(?:default\s+)?(?:class|function|const|let|var|async function)\s+(\w+)/g;
        let m;
        while ((m = esExport.exec(content)) !== null) exports_.push(m[1]);
        // CJS: module.exports = X / exports.X
        const cjsExport = /(?:module\.exports\s*=\s*(\w+)|exports\.(\w+)\s*=)/g;
        while ((m = cjsExport.exec(content)) !== null) exports_.push(m[1] || m[2]);
        if (exports_.length) purpose.exports = [...new Set(exports_)];

        // ── imports ───────────────────────────────────────────
        const imports = [];
        const esImport  = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
        const cjsImport = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
        while ((m = esImport.exec(content))  !== null) imports.push(m[1]);
        while ((m = cjsImport.exec(content)) !== null) imports.push(m[1]);
        if (imports.length) purpose.imports = [...new Set(imports)];

        // ── functions ─────────────────────────────────────────
        const functions = [];
        const fnRe = /(?:async\s+)?function\s+(\w+)\s*\(|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/g;
        while ((m = fnRe.exec(content)) !== null) functions.push(m[1] || m[2]);
        if (functions.length) purpose.functions = [...new Set(functions)].slice(0, 20);

        // ── classes ───────────────────────────────────────────
        const classes = [];
        const classRe = /class\s+(\w+)/g;
        while ((m = classRe.exec(content)) !== null) classes.push(m[1]);
        if (classes.length) purpose.classes = [...new Set(classes)];

        // ── SDOA manifest ─────────────────────────────────────
        const sdoaRe = /MANIFEST\s*=\s*\{[\s\S]*?id\s*:\s*['"]([^'"]+)['"][\s\S]*?version\s*:\s*['"]([^'"]+)['"]/;
        const sdoaM  = sdoaRe.exec(content);
        if (sdoaM) {
            purpose.sdoa = { id: sdoaM[1], version: sdoaM[2] };
        }

        // ── summary ───────────────────────────────────────────
        // First meaningful comment block as summary
        const commentRe = /\/\*\*?([\s\S]*?)\*\/|\/\/\s*={3,}\s*\n([\s\S]*?)\/\/\s*={3,}/;
        const commentM  = commentRe.exec(content);
        if (commentM) {
            const raw = (commentM[1] || commentM[2] || "").replace(/\s*\*\s*/g, " ").trim();
            if (raw.length > 10) purpose.summary = raw.slice(0, 200);
        }

        return purpose;
    }

    // ── document extraction ──────────────────────────────────
    // Plain text / markdown: title, word count, sections, preview.
    // For binary formats (PDF, DOCX) we extract what we can
    // without heavy dependencies.
    // ── end of document extraction ───────────────────────────

    _extractDocument(filePath) {
        const ext = path.extname(filePath).toLowerCase();

        if (ext === ".md" || ext === ".txt" || ext === ".rtf") {
            const content = _safeRead(filePath);
            if (!content) return { error: "Could not read file" };

            const lines    = content.split("\n");
            const words    = content.match(/\S+/g)?.length || 0;
            const sections = lines.filter(l => l.startsWith("#")).map(l => l.replace(/^#+\s*/, "").trim());
            const title    = sections[0] || path.basename(filePath, ext);

            return {
                title,
                wordCount:  words,
                lineCount:  lines.length,
                sections:   sections.slice(0, 10),
                preview:    content.slice(0, PREVIEW_CHARS),
            };
        }

        // Binary document — return meta only
        return {
            format:  ext.replace(".", "").toUpperCase(),
            note:    "Binary document — open file to read contents",
            preview: null,
        };
    }

    // ── data extraction ──────────────────────────────────────
    // CSV: schema, row count, field names, sample row.
    // JSON: top-level keys, array length if array, preview.
    // ── end of data extraction ───────────────────────────────

    _extractData(filePath) {
        const ext     = path.extname(filePath).toLowerCase();
        const content = _safeRead(filePath);
        if (!content) return { error: "Could not read file" };

        if (ext === ".csv" || ext === ".tsv") {
            const sep    = ext === ".tsv" ? "\t" : ",";
            const lines  = content.split("\n").filter(Boolean);
            const fields = lines[0]?.split(sep).map(f => f.trim().replace(/^["']|["']$/g, "")) || [];
            const sample = lines[1]?.split(sep).map(f => f.trim().replace(/^["']|["']$/g, "")) || [];

            return {
                format:     ext === ".tsv" ? "TSV" : "CSV",
                rowCount:   Math.max(0, lines.length - 1),
                fieldCount: fields.length,
                fields,
                sampleRow:  Object.fromEntries(fields.map((f, i) => [f, sample[i] || ""])),
            };
        }

        if (ext === ".json" || ext === ".jsonl") {
            try {
                const parsed = JSON.parse(content.slice(0, MAX_READ_BYTES));
                if (Array.isArray(parsed)) {
                    return {
                        format:   "JSON array",
                        length:   parsed.length,
                        schema:   parsed[0] ? Object.keys(parsed[0]) : [],
                        preview:  content.slice(0, PREVIEW_CHARS),
                    };
                }
                return {
                    format:  "JSON object",
                    keys:    Object.keys(parsed).slice(0, 20),
                    preview: content.slice(0, PREVIEW_CHARS),
                };
            } catch {
                return { format: "JSON", error: "Parse failed", preview: content.slice(0, PREVIEW_CHARS) };
            }
        }

        if (ext === ".yaml" || ext === ".yml") {
            const topKeys = content.match(/^[\w-]+:/gm)?.map(k => k.replace(":", "")) || [];
            return { format: "YAML", topLevelKeys: topKeys, preview: content.slice(0, PREVIEW_CHARS) };
        }

        return { format: ext.replace(".", "").toUpperCase(), preview: content.slice(0, PREVIEW_CHARS) };
    }

    // ── image extraction ─────────────────────────────────────
    // Dimensions from PNG/JPEG headers, EXIF fields where readable.
    // ── end of image extraction ──────────────────────────────

    _extractImage(filePath) {
        const ext  = path.extname(filePath).toLowerCase();
        const stat = _safeStat(filePath);

        const result = {
            format: ext.replace(".", "").toUpperCase(),
            size:   stat?.size,
        };

        try {
            const buf = fs.readFileSync(filePath);

            if (ext === ".png" && buf.length > 24) {
                // PNG: width at bytes 16-19, height at 20-23 (big-endian)
                result.width  = buf.readUInt32BE(16);
                result.height = buf.readUInt32BE(20);
            } else if ((ext === ".jpg" || ext === ".jpeg") && buf.length > 4) {
                // JPEG: scan for SOF markers
                const dims = _jpegDimensions(buf);
                if (dims) { result.width = dims.width; result.height = dims.height; }
            } else if (ext === ".svg") {
                const content = buf.toString("utf8", 0, Math.min(buf.length, 2048));
                const wM = /width=["']([^"']+)["']/.exec(content);
                const hM = /height=["']([^"']+)["']/.exec(content);
                if (wM) result.width  = wM[1];
                if (hM) result.height = hM[1];
            }
        } catch { /* dimensions unavailable */ }

        return result;
    }

    // ── audio extraction ─────────────────────────────────────
    // ID3 tags from MP3, basic duration estimate from file size.
    // ── end of audio extraction ──────────────────────────────

    _extractAudio(filePath) {
        const ext  = path.extname(filePath).toLowerCase();
        const stat = _safeStat(filePath);
        const result = { format: ext.replace(".", "").toUpperCase(), size: stat?.size };

        if (ext === ".mp3" && stat) {
            try {
                const buf = fs.readFileSync(filePath, { start: 0, end: 128 } );
                // ID3v1 tag at last 128 bytes
                const id3buf = Buffer.alloc(128);
                const fd = fs.openSync(filePath, "r");
                fs.readSync(fd, id3buf, 0, 128, Math.max(0, stat.size - 128));
                fs.closeSync(fd);

                if (id3buf.slice(0, 3).toString() === "TAG") {
                    const tag = (b, s, l) => id3buf.slice(s, s + l).toString("latin1").replace(/\0/g, "").trim();
                    result.title  = tag(id3buf, 3,  30) || undefined;
                    result.artist = tag(id3buf, 33, 30) || undefined;
                    result.album  = tag(id3buf, 63, 30) || undefined;
                    result.year   = tag(id3buf, 93, 4)  || undefined;
                }
            } catch { /* ID3 unavailable */ }
        }

        return result;
    }

    // ── video extraction ─────────────────────────────────────
    // Basic format info — full extraction requires ffprobe.
    // ── end of video extraction ──────────────────────────────

    _extractVideo(filePath) {
        const ext  = path.extname(filePath).toLowerCase();
        const stat = _safeStat(filePath);
        return {
            format: ext.replace(".", "").toUpperCase(),
            size:   stat?.size,
            note:   "Install ffprobe for duration/resolution extraction",
        };
    }

    // ── generic extraction ───────────────────────────────────

    _extractGeneric(filePath) {
        return {
            preview: _safePreview(filePath),
        };
    }
}

// ── helpers ───────────────────────────────────────────────────

function _safeStat(filePath) {
    try { return fs.statSync(filePath); } catch { return null; }
}

function _safeRead(filePath) {
    try {
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_READ_BYTES) {
            const buf = Buffer.alloc(MAX_READ_BYTES);
            const fd  = fs.openSync(filePath, "r");
            fs.readSync(fd, buf, 0, MAX_READ_BYTES, 0);
            fs.closeSync(fd);
            return buf.toString("utf8");
        }
        return fs.readFileSync(filePath, "utf8");
    } catch { return null; }
}

function _safePreview(filePath) {
    const content = _safeRead(filePath);
    return content ? content.slice(0, PREVIEW_CHARS) : null;
}

function _languageFromExt(ext) {
    const map = {
        ".js": "JavaScript", ".ts": "TypeScript", ".jsx": "React JSX",
        ".tsx": "React TSX", ".py": "Python", ".rs": "Rust",
        ".go": "Go", ".java": "Java", ".cs": "C#", ".cpp": "C++",
        ".c": "C", ".rb": "Ruby", ".php": "PHP", ".swift": "Swift",
        ".kt": "Kotlin", ".sh": "Shell", ".html": "HTML",
        ".css": "CSS", ".scss": "SCSS", ".md": "Markdown",
    };
    return map[ext] || ext.replace(".", "").toUpperCase();
}

function _jpegDimensions(buf) {
    let i = 2;
    while (i < buf.length) {
        if (buf[i] !== 0xFF) break;
        const marker = buf[i + 1];
        const len    = buf.readUInt16BE(i + 2);
        if (marker >= 0xC0 && marker <= 0xC3) {
            return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
    }
    return null;
}

function _errorManifest(realPath, error) {
    return { realPath, error, generatedAt: new Date().toISOString(), purpose: {} };
}

module.exports = new VfsManifestExtractor();
