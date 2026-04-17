// ============================================================
// ManifestPanel.ui.js — VFS Purpose Manifest Display
// version: 1.0.0
// depends: tauri-utils.js, EventBus.ui.js
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    // ── ManifestPanel.ui ─────────────────────────────────────
    // Displays the purpose manifest for a selected file.
    // Shown when:
    //   - A file is single-clicked in FileTree
    //   - A file is single-clicked in FileList
    //   - filemanager:selectEntry is emitted (from manifest tag)
    //
    // Shows: file type badge, metadata, purpose fields,
    // VFS status (in VFS or not), permissions, add-to-VFS button.
    // ── end of ManifestPanel.ui ──────────────────────────────

    // ── SDOA v3 MANIFEST ─────────────────────────────────────
    const MANIFEST = {
        id:      "ManifestPanel.ui",
        type:    "component",
        runtime: "Browser",
        version: "1.0.0",
        capabilities: ["manifest.display", "vfs.status", "vfs.add"],
        dependencies: ["tauri-utils.js", "EventBus.ui.js"],
        docs: { description: "Displays VFS purpose manifest for a selected file. Shows metadata, purpose fields, VFS status and permissions." },
        actions: {
            commands: {
                render:     { description: "Render manifest panel into container.", input: { container: "DOMElement" }, output: "void" },
                showFile:   { description: "Show manifest for a file path.",        input: { path: "string" },         output: "void" },
                showEntry:  { description: "Show manifest for a VFS entry id.",     input: { id: "string" },           output: "void" },
                clear:      { description: "Clear panel to empty state.",           input: {},                         output: "void" },
            },
            triggers: {},
            emits: {
                "manifestpanel:addedToVfs":        { payload: { path: "string", entryId: "string" } },
                "manifestpanel:permissionsChanged": { payload: { id: "string", permissions: "object" } },
            },
            workflows: {}
        }
    };
    // ── end of SDOA v3 MANIFEST ──────────────────────────────

    // ── state ─────────────────────────────────────────────────
    let _container   = null;
    let _currentPath = null;
    let _currentId   = null;
    // ── end of state ─────────────────────────────────────────

    function render(container) {
        _container = container;
        _container.className = "manifest-panel";
        clear();
    }

    function clear() {
        if (!_container) return;
        _container.innerHTML = `
            <div class="manifest-empty">
                <div class="manifest-empty-icon">◈</div>
                <div class="manifest-empty-text">Select a file to view its manifest</div>
            </div>
        `;
        _currentPath = null;
        _currentId   = null;
    }

    // ── showFile ─────────────────────────────────────────────

    async function showFile(filePath) {
        if (!_container) return;
        _currentPath = filePath;
        _showLoading(filePath);

        try {
            // Try to get VFS manifest first
            const res = await window.backendConnector?.runWorkflow("vfs_manifest", {
                project:  window.currentProject || "default",
                realPath: filePath,
            }).catch(() => null);

            if (res?.manifest) {
                _currentId = res.entry?.id || null;
                _renderManifest(res.manifest, res.entry);
            } else {
                // File not in VFS — show basic file info + add prompt
                _renderNotInVfs(filePath);
            }
        } catch (err) {
            _renderError(err.message);
        }
    }

    // ── showEntry ────────────────────────────────────────────

    async function showEntry(id) {
        if (!_container) return;
        _currentId = id;
        _showLoading();

        try {
            const res = await window.backendConnector?.runWorkflow("vfs_manifest", {
                project: window.currentProject || "default",
                id,
            });
            if (res?.manifest) {
                _currentPath = res.entry?.realPath || null;
                _renderManifest(res.manifest, res.entry);
            }
        } catch (err) {
            _renderError(err.message);
        }
    }

    // ── _showLoading ─────────────────────────────────────────

    function _showLoading(path) {
        if (!_container) return;
        const name = path ? path.split(/[\\/]/).pop() : "…";
        _container.innerHTML = `
            <div class="manifest-loading">
                <div class="manifest-loading-name">${name}</div>
                <div class="manifest-loading-text">Loading manifest…</div>
            </div>
        `;
    }

    // ── _renderManifest ───────────────────────────────────────

    function _renderManifest(manifest, entry) {
        if (!_container) return;
        const p    = manifest.purpose || {};
        const meta = manifest.meta    || {};
        const type = manifest.type    || "generic";

        const perm = entry?.permissions || {};
        const permStr = [
            perm.read    ? "Read"    : null,
            perm.write   ? "Write"   : null,
            perm.execute ? "Execute" : null,
        ].filter(Boolean).join(" · ") || "None";

        _container.innerHTML = `
            <div class="manifest-content">

                <div class="manifest-file-header">
                    <div class="manifest-file-icon">${_typeIcon(type)}</div>
                    <div class="manifest-file-info">
                        <div class="manifest-file-name">${meta.name || _currentPath?.split(/[\\/]/).pop() || "file"}</div>
                        <div class="manifest-file-meta">${_formatSize(meta.size)} · ${meta.ext || type}</div>
                    </div>
                    <div class="manifest-type-badge manifest-type-${type}">${type}</div>
                </div>

                <div class="manifest-real-path" title="${_currentPath || ""}">${_shortPath(_currentPath || "")}</div>

                <div class="manifest-vfs-status">
                    <span class="manifest-vfs-badge in-vfs">● In VFS</span>
                    <div class="manifest-perms">${permStr}</div>
                    <button class="manifest-perm-btn" id="manifestPermBtn">Edit permissions</button>
                </div>

                <div class="manifest-divider"></div>

                <div class="manifest-purpose" id="manifestPurpose">
                    ${_renderPurposeFields(type, p)}
                </div>

                <div class="manifest-divider"></div>

                <div class="manifest-actions">
                    <button class="manifest-action-btn" id="manifestRefreshBtn">↻ Refresh</button>
                    <button class="manifest-action-btn manifest-action-open" id="manifestOpenBtn">Open file →</button>
                </div>

            </div>
        `;

        // Wire buttons
        _container.querySelector("#manifestRefreshBtn")?.addEventListener("click", async () => {
            _showLoading(_currentPath);
            try {
                const res = await window.backendConnector?.runWorkflow("vfs_manifest", {
                    project: window.currentProject || "default",
                    id:      _currentId,
                    refresh: true,
                });
                if (res?.manifest) _renderManifest(res.manifest, res.entry);
            } catch (err) { _renderError(err.message); }
        });

        _container.querySelector("#manifestOpenBtn")?.addEventListener("click", () => {
            if (_currentPath) window.primaryPanel?.openFile(_currentPath);
        });

        _container.querySelector("#manifestPermBtn")?.addEventListener("click", () => {
            _showPermissionsEditor(entry);
        });
    }

    // ── _renderNotInVfs ───────────────────────────────────────

    function _renderNotInVfs(filePath) {
        if (!_container) return;
        const name = filePath.split(/[\\/]/).pop();
        _container.innerHTML = `
            <div class="manifest-content">
                <div class="manifest-file-header">
                    <div class="manifest-file-icon">📄</div>
                    <div class="manifest-file-info">
                        <div class="manifest-file-name">${name}</div>
                        <div class="manifest-file-meta">${_shortPath(filePath)}</div>
                    </div>
                </div>

                <div class="manifest-not-in-vfs">
                    <div class="manifest-not-in-vfs-text">
                        This file is not in the VFS.<br>
                        Add it to generate a purpose manifest.
                    </div>
                    <div class="manifest-add-options">
                        <label class="manifest-perm-row">
                            <input type="checkbox" id="permRead"    checked /> Read
                        </label>
                        <label class="manifest-perm-row">
                            <input type="checkbox" id="permWrite"           /> Write
                        </label>
                        <label class="manifest-perm-row">
                            <input type="checkbox" id="permExecute"         /> Execute
                        </label>
                    </div>
                    <button class="manifest-add-btn" id="manifestAddBtn">Add to VFS</button>
                </div>
            </div>
        `;

        _container.querySelector("#manifestAddBtn")?.addEventListener("click", async () => {
            const btn  = _container.querySelector("#manifestAddBtn");
            btn.disabled    = true;
            btn.textContent = "Adding…";

            const permissions = {
                read:    _container.querySelector("#permRead")?.checked    ?? true,
                write:   _container.querySelector("#permWrite")?.checked   ?? false,
                execute: _container.querySelector("#permExecute")?.checked ?? false,
            };

            try {
                const res = await window.backendConnector?.runWorkflow("vfs_add", {
                    project:  window.currentProject || "default",
                    realPath: filePath,
                    permissions,
                });
                const added = res?.added?.[0] || res?.data?.added?.[0];
                if (added) {
                    window.EventBus?.emit("manifestpanel:addedToVfs", { path: filePath, entryId: added.id });
                    showFile(filePath);
                }
            } catch (err) {
                btn.disabled    = false;
                btn.textContent = "Add to VFS";
                window.showToast?.(`Failed to add: ${err.message}`);
            }
        });
    }

    // ── _showPermissionsEditor ────────────────────────────────

    function _showPermissionsEditor(entry) {
        if (!entry?.id) return;
        const perm = entry.permissions || {};

        const editor = document.createElement("div");
        editor.className = "manifest-perm-editor";
        editor.innerHTML = `
            <div class="manifest-perm-title">Permissions</div>
            <label class="manifest-perm-row"><input type="checkbox" id="peRead"    ${perm.read    ? "checked" : ""} /> Read</label>
            <label class="manifest-perm-row"><input type="checkbox" id="peWrite"   ${perm.write   ? "checked" : ""} /> Write</label>
            <label class="manifest-perm-row"><input type="checkbox" id="peExecute" ${perm.execute ? "checked" : ""} /> Execute</label>
            <div class="manifest-perm-btns">
                <button id="peSave">Save</button>
                <button id="peCancel">Cancel</button>
            </div>
        `;

        _container.querySelector(".manifest-vfs-status")?.appendChild(editor);

        editor.querySelector("#peSave")?.addEventListener("click", async () => {
            const permissions = {
                read:    editor.querySelector("#peRead")?.checked    ?? perm.read,
                write:   editor.querySelector("#peWrite")?.checked   ?? perm.write,
                execute: editor.querySelector("#peExecute")?.checked ?? perm.execute,
            };
            try {
                await window.backendConnector?.runWorkflow("vfs_permissions", {
                    project: window.currentProject || "default",
                    id:      entry.id,
                    permissions,
                });
                window.EventBus?.emit("manifestpanel:permissionsChanged", { id: entry.id, permissions });
                showEntry(entry.id); // refresh
            } catch (err) {
                window.showToast?.(`Failed: ${err.message}`);
            }
        });

        editor.querySelector("#peCancel")?.addEventListener("click", () => editor.remove());
    }

    // ── _renderPurposeFields ──────────────────────────────────

    function _renderPurposeFields(type, p) {
        const rows = [];

        const add = (label, val) => {
            if (!val) return;
            const v = Array.isArray(val) ? val.join(", ") : String(val);
            rows.push(`<div class="manifest-field">
                <div class="manifest-field-label">${label}</div>
                <div class="manifest-field-value">${_escapeHtml(v.slice(0, 300))}</div>
            </div>`);
        };

        if (p.summary)                   add("Summary",   p.summary);
        if (type === "code") {
            add("Language",  p.language);
            add("Classes",   p.classes);
            add("Functions", p.functions?.slice(0, 10));
            add("Exports",   p.exports);
            add("Imports",   p.imports?.slice(0, 8));
            if (p.sdoa) add("SDOA", `${p.sdoa.id} v${p.sdoa.version}`);
        }
        if (type === "document") {
            add("Title",     p.title);
            add("Words",     p.wordCount?.toLocaleString());
            add("Sections",  p.sections?.slice(0, 5));
        }
        if (type === "data") {
            add("Format",    p.format);
            add("Rows",      p.rowCount?.toLocaleString());
            add("Fields",    p.fields?.slice(0, 10) || p.keys?.slice(0, 10));
        }
        if (type === "image") {
            if (p.width && p.height) add("Dimensions", `${p.width} × ${p.height}`);
            add("Format", p.format);
        }
        if (type === "audio") {
            add("Title",  p.title);
            add("Artist", p.artist);
            add("Album",  p.album);
            add("Format", p.format);
        }
        if (type === "video") {
            add("Format",     p.format);
            add("Resolution", p.resolution);
        }

        if (p.preview) {
            rows.push(`<div class="manifest-field">
                <div class="manifest-field-label">Preview</div>
                <pre class="manifest-preview">${_escapeHtml(p.preview.slice(0, 400))}</pre>
            </div>`);
        }

        if (rows.length === 0) {
            return `<div class="manifest-no-purpose">No purpose fields extracted</div>`;
        }

        return rows.join("");
    }

    // ── helpers ───────────────────────────────────────────────

    function _typeIcon(type) {
        const m = { code: "📄", document: "📃", data: "📊", image: "🖼", audio: "🎵", video: "🎬", directory: "📁", generic: "📎" };
        return m[type] || "📎";
    }

    function _formatSize(bytes) {
        if (!bytes) return "—";
        if (bytes > 1048576) return `${(bytes/1048576).toFixed(1)} MB`;
        if (bytes > 1024)    return `${(bytes/1024).toFixed(1)} KB`;
        return `${bytes} B`;
    }

    function _shortPath(p) {
        if (!p) return "";
        if (p.length < 50) return p;
        const parts = p.split(/[\\/]/);
        return "…/" + parts.slice(-3).join("/");
    }

    function _escapeHtml(s) {
        return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    }

    function _renderError(msg) {
        if (_container) _container.innerHTML = `<div class="manifest-error">Error: ${_escapeHtml(msg)}</div>`;
    }

    // ── window export ─────────────────────────────────────────
    window.ManifestPanel = { MANIFEST, render, showFile, showEntry, clear };

    domReady(() => {
        window.EventBus?.command("manifestpanel", "render",    ({ container }) => render(container));
        window.EventBus?.command("manifestpanel", "showFile",  ({ path })      => showFile(path));
        window.EventBus?.command("manifestpanel", "showEntry", ({ id })        => showEntry(id));
        window.EventBus?.command("manifestpanel", "clear",     ()              => clear());

        // Listen for file selection events
        window.EventBus?.on("filelist:fileSelected",    ({ path })  => showFile(path));
        window.EventBus?.on("filetree:fileSelected",    ({ path })  => showFile(path));
        window.EventBus?.on("filemanager:selectEntry",  ({ id })    => showEntry(id));
    });

})();
