"use strict";

// ============================================================
// FsVfsRepository.js — Virtual File System persistence layer
// version: 1.0.0
// ============================================================
// Manages the VFS registry for a project.
//
// CORE PRINCIPLE: Files are NEVER copied or moved.
// The VFS stores only:
//   - A pointer to the file's real path on disk
//   - Read/write/execute permissions scoped to this project
//   - A purpose-aware manifest (extracted metadata/intelligence)
//
// Storage: data/projects/{project}/vfs/
//   index.json          — registry of all VFS entries
//   manifests/{id}.json — one manifest file per entry
// ============================================================

const fs   = require("fs-extra");
const path = require("path");
const BaseRepository = require("./BaseRepository");
const paths = require("../env/paths");

// ── manifest type detection ───────────────────────────────────
const TYPE_MAP = {
    // code
    js: "code", ts: "code", jsx: "code", tsx: "code", mjs: "code", cjs: "code",
    py: "code", rs: "code", go: "code", java: "code", cpp: "code", c: "code",
    cs: "code", rb: "code", php: "code", swift: "code", kt: "code", sh: "code",
    // document
    pdf: "document", docx: "document", doc: "document", odt: "document",
    rtf: "document", txt: "document", md: "document",
    // data
    csv: "data", tsv: "data", json: "data", jsonl: "data",
    xml: "data", yaml: "data", yml: "data", xlsx: "data", xls: "data",
    // image
    jpg: "image", jpeg: "image", png: "image", gif: "image",
    svg: "image", webp: "image", bmp: "image", tiff: "image",
    // audio
    mp3: "audio", wav: "audio", flac: "audio", aac: "audio", ogg: "audio", m4a: "audio",
    // video
    mp4: "video", mov: "video", avi: "video", mkv: "video", webm: "video",
    // web
    html: "code", htm: "code", css: "code", scss: "code",
    // config
    toml: "data", ini: "data", env: "data", conf: "data",
};

function detectType(filePath) {
    const ext = path.extname(filePath).toLowerCase().replace(".", "");
    return TYPE_MAP[ext] || "generic";
}

function generateId() {
    return `vfs-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

class FsVfsRepository extends BaseRepository {
    constructor(project) {
        super(paths.vfs(project));
        this.project = project;
        // Ensure manifests subdirectory exists
        fs.mkdirpSync(paths.vfsManifests(project));
    }

    // ── index operations ─────────────────────────────────────

    loadIndex() {
        return this.readJson(paths.vfsIndex(this.project), {
            version: "1.0",
            project: this.project,
            entries: []
        });
    }

    saveIndex(index) {
        index.updatedAt = new Date().toISOString();
        this.writeJsonSync(paths.vfsIndex(this.project), index);
    }

    // ── entry CRUD ───────────────────────────────────────────

    addEntry(realPath, permissions = {}) {
        const index = this.loadIndex();

        // Deduplicate — don't add the same real path twice
        const existing = index.entries.find(e => e.realPath === realPath);
        if (existing) return existing;

        const id = generateId();
        const type = detectType(realPath);

        const entry = {
            id,
            realPath,
            addedAt:     new Date().toISOString(),
            type,
            mimeType:    _mimeForType(type, path.extname(realPath)),
            permissions: {
                read:    permissions.read    ?? true,
                write:   permissions.write   ?? false,
                execute: permissions.execute ?? false,
            },
            manifestId:      id,
            manifestVersion: "1.0",
            manifestReady:   false,
        };

        index.entries.push(entry);
        this.saveIndex(index);
        return entry;
    }

    getEntry(id) {
        const index = this.loadIndex();
        return index.entries.find(e => e.id === id) || null;
    }

    getEntryByPath(realPath) {
        const index = this.loadIndex();
        return index.entries.find(e => e.realPath === realPath) || null;
    }

    updateEntry(id, updates) {
        const index = this.loadIndex();
        const i = index.entries.findIndex(e => e.id === id);
        if (i < 0) return null;
        index.entries[i] = { ...index.entries[i], ...updates };
        this.saveIndex(index);
        return index.entries[i];
    }

    removeEntry(id) {
        const index = this.loadIndex();
        const entry = index.entries.find(e => e.id === id);
        if (!entry) return false;

        index.entries = index.entries.filter(e => e.id !== id);
        this.saveIndex(index);

        // Remove manifest file if it exists
        const manifestPath = paths.vfsManifest(this.project, id);
        if (fs.existsSync(manifestPath)) fs.removeSync(manifestPath);

        return true;
    }

    listEntries() {
        return this.loadIndex().entries;
    }

    // ── manifest operations ───────────────────────────────────

    saveManifest(id, manifest) {
        this.writeJsonSync(paths.vfsManifest(this.project, id), manifest);
        // Mark entry as manifest-ready
        this.updateEntry(id, { manifestReady: true, manifestUpdatedAt: new Date().toISOString() });
    }

    loadManifest(id) {
        return this.readJson(paths.vfsManifest(this.project, id), null);
    }

    // ── permissions update ────────────────────────────────────

    updatePermissions(id, permissions) {
        return this.updateEntry(id, { permissions });
    }
}

function _mimeForType(type, ext) {
    const map = {
        ".js": "application/javascript", ".ts": "application/typescript",
        ".py": "text/x-python", ".rs": "text/x-rust",
        ".json": "application/json", ".md": "text/markdown",
        ".html": "text/html", ".css": "text/css",
        ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml",
        ".mp3": "audio/mpeg", ".mp4": "video/mp4",
        ".pdf": "application/pdf", ".txt": "text/plain",
    };
    return map[ext.toLowerCase()] || "application/octet-stream";
}

module.exports = FsVfsRepository;
