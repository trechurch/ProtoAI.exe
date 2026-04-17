// ============================================================
// FileList.ui.js — Windows Explorer-Style File List
// version: 1.0.0
// depends: tauri-utils.js, EventBus.ui.js
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    // ── FileList.ui ───────────────────────────────────────────
    // Windows Explorer look and feel:
    //   single click      — select
    //   ctrl+click        — multi-select
    //   shift+click       — range select
    //   double click      — open file (routes via PrimaryPanel)
    //   drag selected     — drag group
    //   right-click       — context menu (standard + ProtoAI extras)
    //
    // Events emitted via EventBus:
    //   filelist:fileSelected    { path, entry, selection }
    //   filelist:fileOpened      { path, entry }
    //   filelist:selectionChanged { paths }
    //   filelist:addToVfs        { paths }
    //   filelist:viewManifest    { path }
    // ── end of FileList.ui ───────────────────────────────────

    // ── SDOA v3 MANIFEST ─────────────────────────────────────
    const MANIFEST = {
        id:      "FileList.ui",
        type:    "component",
        runtime: "Browser",
        version: "1.0.0",
        capabilities: [
            "list.render", "list.select", "list.multiselect",
            "list.dragdrop", "list.contextmenu", "list.keyboard"
        ],
        dependencies: ["tauri-utils.js", "EventBus.ui.js"],
        docs: { description: "Windows Explorer-style file list. Full selection model, drag/drop, right-click context menu with ProtoAI extras." },
        actions: {
            commands: {
                loadPath:        { description: "Load and display a directory path.", input: { path: "string" }, output: "void" },
                refresh:         { description: "Reload current path.",               input: {}, output: "void" },
                getSelection:    { description: "Get currently selected paths.",      input: {}, output: "string[]" },
                clearSelection:  { description: "Clear all selections.",              input: {}, output: "void" },
            },
            triggers: {},
            emits: {
                "filelist:fileSelected":    { payload: { path: "string", entry: "object", selection: "string[]" } },
                "filelist:fileOpened":      { payload: { path: "string", entry: "object" } },
                "filelist:selectionChanged": { payload: { paths: "string[]" } },
                "filelist:addToVfs":        { payload: { paths: "string[]" } },
                "filelist:viewManifest":    { payload: { path: "string" } },
            },
            workflows: {}
        }
    };
    // ── end of SDOA v3 MANIFEST ──────────────────────────────

    // ── routing config ────────────────────────────────────────
    const OPEN_ROUTING = window._openRouting || "auto"; // auto | active
    // ── end of routing config ────────────────────────────────

    // ── state ─────────────────────────────────────────────────
    let _container    = null;
    let _currentPath  = null;
    let _entries      = [];      // { name, path, realPath, type, size, ext, icon, modified }
    let _selected     = new Set(); // set of selected realPaths
    let _lastClicked  = null;    // for shift-click range
    let _contextMenu  = null;    // active context menu DOM node
    // ── end of state ─────────────────────────────────────────

    // ── render ────────────────────────────────────────────────

    function render(container) {
        _container = container;
        _container.className = "filelist-root";
        _container.tabIndex  = 0; // make focusable for keyboard

        // Keyboard handling
        _container.addEventListener("keydown", _onKeydown);

        // Dismiss context menu on outside click
        document.addEventListener("click", _dismissContextMenu);
    }

    // ── loadPath ─────────────────────────────────────────────

    async function loadPath(dirPath) {
        if (!_container) return;
        _currentPath = dirPath;
        _selected.clear();
        _lastClicked = null;
        _container.innerHTML = `<div class="filelist-loading">Loading…</div>`;

        try {
            const result = await window.backendConnector?.runWorkflow("list_files", {
                realPath: dirPath
            });

            const folders = result?.folders || result?.data?.folders || [];
            const files   = result?.files   || result?.data?.files   || [];

            _entries = [
                ...folders.map(f => ({ ...f, type: "directory" })),
                ...files.map(f   => ({ ...f, type: "file"      }))
            ];

            _render();
        } catch (err) {
            _container.innerHTML = `<div class="filelist-error">Failed to load: ${err.message}</div>`;
        }
    }

    // ── _render ───────────────────────────────────────────────

    function _render() {
        if (!_container) return;

        // Header row
        _container.innerHTML = `
            <div class="filelist-header">
                <div class="filelist-col col-name">Name</div>
                <div class="filelist-col col-size">Size</div>
                <div class="filelist-col col-modified">Modified</div>
                <div class="filelist-col col-type">Type</div>
            </div>
            <div class="filelist-body" id="filelistBody"></div>
        `;

        const body = _container.querySelector("#filelistBody");

        if (_entries.length === 0) {
            body.innerHTML = `<div class="filelist-empty">This folder is empty</div>`;
            return;
        }

        _entries.forEach((entry, idx) => {
            body.appendChild(_buildRow(entry, idx));
        });
    }

    // ── _buildRow ─────────────────────────────────────────────

    function _buildRow(entry, idx) {
        const row   = document.createElement("div");
        const rPath = entry.realPath || entry.path;
        row.className      = `filelist-row ${entry.type === "directory" ? "is-dir" : "is-file"}`;
        row.dataset.path   = rPath;
        row.dataset.idx    = idx;
        row.draggable      = true;

        const isSelected = _selected.has(rPath);
        if (isSelected) row.classList.add("selected");

        const icon = _entryIcon(entry);
        const size = entry.type === "directory"
            ? "—"
            : entry.size > 1048576 ? `${(entry.size/1048576).toFixed(1)} MB`
            : entry.size > 1024    ? `${(entry.size/1024).toFixed(1)} KB`
            : `${entry.size} B`;

        const modified = entry.modified
            ? new Date(entry.modified).toLocaleDateString()
            : "—";

        const typeLabel = entry.type === "directory"
            ? "Folder"
            : (entry.ext || "file").toUpperCase().replace(".", "");

        row.innerHTML = `
            <div class="filelist-col col-name">
                <span class="filelist-icon">${icon}</span>
                <span class="filelist-name">${entry.name}</span>
            </div>
            <div class="filelist-col col-size">${size}</div>
            <div class="filelist-col col-modified">${modified}</div>
            <div class="filelist-col col-type">${typeLabel}</div>
        `;

        // ── single click ──────────────────────────────────────
        row.addEventListener("click", (e) => _onRowClick(e, entry, rPath, idx));

        // ── double click ──────────────────────────────────────
        row.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            if (entry.type === "directory") {
                loadPath(rPath);
            } else {
                window.EventBus?.emit("filelist:fileOpened", { path: rPath, entry });
                window.EventBus?.emit("filemanager:fileOpened", { path: rPath, entry });
            }
        });

        // ── right click ───────────────────────────────────────
        row.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            // Ensure right-clicked item is selected
            if (!_selected.has(rPath)) {
                _selected.clear();
                _selected.add(rPath);
                _renderSelectionState();
            }
            _showContextMenu(e.clientX, e.clientY, entry, rPath);
        });

        // ── drag start ────────────────────────────────────────
        row.addEventListener("dragstart", (e) => {
            const paths = _selected.size > 0
                ? [..._selected]
                : [rPath];
            e.dataTransfer.setData("text/plain", JSON.stringify({ paths }));
            e.dataTransfer.effectAllowed = "move";
        });

        return row;
    }

    // ── _onRowClick ───────────────────────────────────────────

    function _onRowClick(e, entry, rPath, idx) {
        e.stopPropagation();

        if (e.ctrlKey || e.metaKey) {
            // Ctrl+click — toggle selection
            if (_selected.has(rPath)) {
                _selected.delete(rPath);
            } else {
                _selected.add(rPath);
            }
        } else if (e.shiftKey && _lastClicked !== null) {
            // Shift+click — range select
            const rows  = Array.from(_container.querySelectorAll(".filelist-row"));
            const lastEl = _container.querySelector(`[data-idx="${_lastClicked}"]`);
            const lastIdx = lastEl ? parseInt(lastEl.dataset.idx) : 0;
            const [from, to] = [Math.min(idx, lastIdx), Math.max(idx, lastIdx)];
            _selected.clear();
            rows.forEach(r => {
                const rIdx = parseInt(r.dataset.idx);
                if (rIdx >= from && rIdx <= to) _selected.add(r.dataset.path);
            });
        } else {
            // Normal click — single select
            _selected.clear();
            _selected.add(rPath);
        }

        _lastClicked = idx;
        _renderSelectionState();

        // Single-click on file → emit manifest view event
        if (entry.type === "file") {
            window.EventBus?.emit("filelist:fileSelected", {
                path: rPath, entry, selection: [..._selected]
            });
        } else {
            // Single-click on folder → load that folder
            loadPath(rPath);
            window.EventBus?.emit("filetree:folderSelected", { path: rPath, entry });
        }

        window.EventBus?.emit("filelist:selectionChanged", { paths: [..._selected] });
    }

    // ── _renderSelectionState ─────────────────────────────────

    function _renderSelectionState() {
        _container?.querySelectorAll(".filelist-row").forEach(row => {
            row.classList.toggle("selected", _selected.has(row.dataset.path));
        });
    }

    // ── _onKeydown ────────────────────────────────────────────

    function _onKeydown(e) {
        if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
            // Ctrl+A — select all
            e.preventDefault();
            _entries.forEach(en => _selected.add(en.realPath || en.path));
            _renderSelectionState();
            window.EventBus?.emit("filelist:selectionChanged", { paths: [..._selected] });
        }
        if (e.key === "Escape") {
            _selected.clear();
            _renderSelectionState();
            _dismissContextMenu();
        }
        if (e.key === "Enter" && _selected.size === 1) {
            const path = [..._selected][0];
            const entry = _entries.find(en => (en.realPath || en.path) === path);
            if (entry?.type === "directory") loadPath(path);
            else window.EventBus?.emit("filelist:fileOpened", { path, entry });
        }
    }

    // ── _showContextMenu ──────────────────────────────────────

    function _showContextMenu(x, y, entry, rPath) {
        _dismissContextMenu();

        const routing    = window.ChatBehavior?.get()?.doubleClickRouting || "auto";
        const isFile     = entry.type === "file";
        const isMulti    = _selected.size > 1;
        const countLabel = isMulti ? `${_selected.size} items` : entry.name;

        const menu = document.createElement("div");
        menu.className = "context-menu";
        menu.style.cssText = `left:${Math.min(x, window.innerWidth-220)}px;top:${Math.min(y, window.innerHeight-300)}px`;

        const items = [];

        // ── default open action ───────────────────────────────
        if (isFile) {
            if (routing === "active") {
                items.push({ label: "Open in active panel", bold: true, action: () => _openIn(rPath, entry, null) });
                items.push("---");
                items.push({ label: "Open in editor",   action: () => _openIn(rPath, entry, "code")    });
                items.push({ label: "Open in chat",     action: () => _openIn(rPath, entry, "chat")    });
                items.push({ label: "Open in browser",  action: () => _openIn(rPath, entry, "browser") });
                items.push({ label: "Open in terminal", action: () => _openIn(rPath, entry, "terminal") });
            } else {
                const defaultMode = _defaultMode(entry);
                items.push({ label: `Open in ${defaultMode}`, bold: true, action: () => _openIn(rPath, entry, defaultMode) });
                items.push("---");
                items.push({ label: "Open in editor",      action: () => _openIn(rPath, entry, "code")    });
                items.push({ label: "Open in chat",        action: () => _openIn(rPath, entry, "chat")    });
                items.push({ label: "Open in browser",     action: () => _openIn(rPath, entry, "browser") });
                items.push({ label: "Open in terminal",    action: () => _openIn(rPath, entry, "terminal") });
                items.push({ label: "Open in active panel", action: () => _openIn(rPath, entry, null)     });
            }
        } else {
            items.push({ label: "Open folder", bold: true, action: () => loadPath(rPath) });
        }

        items.push("---");

        // ── ProtoAI extras ────────────────────────────────────
        const selPaths = [..._selected];
        items.push({ label: "Add to VFS",     action: () => window.EventBus?.emit("filelist:addToVfs",     { paths: selPaths }) });
        items.push({ label: "View manifest",  action: () => window.EventBus?.emit("filelist:viewManifest", { path: rPath     }) });
        items.push("---");

        // ── standard file ops ─────────────────────────────────
        items.push({ label: "Copy path",          action: () => navigator.clipboard?.writeText(rPath) });
        items.push({ label: "Copy relative path", action: () => {
            const rel = rPath.replace(window.currentProject || "", "").replace(/^[\\/]/, "");
            navigator.clipboard?.writeText(rel);
        }});
        items.push("---");
        items.push({ label: "Rename", action: () => _renameEntry(rPath, entry) });
        items.push({ label: "Delete", danger: true, action: () => _deleteEntries(selPaths) });

        // ── build DOM ─────────────────────────────────────────
        items.forEach(item => {
            if (item === "---") {
                const sep = document.createElement("div");
                sep.className = "context-sep";
                menu.appendChild(sep);
                return;
            }
            const el = document.createElement("div");
            el.className   = `context-item${item.bold ? " bold" : ""}${item.danger ? " danger" : ""}`;
            el.textContent = item.label;
            el.addEventListener("click", () => { item.action(); _dismissContextMenu(); });
            menu.appendChild(el);
        });

        document.body.appendChild(menu);
        _contextMenu = menu;

        // Adjust if off-screen
        const rect = menu.getBoundingClientRect();
        if (rect.right  > window.innerWidth)  menu.style.left = `${x - rect.width}px`;
        if (rect.bottom > window.innerHeight) menu.style.top  = `${y - rect.height}px`;
    }

    function _dismissContextMenu() {
        if (_contextMenu) { _contextMenu.remove(); _contextMenu = null; }
    }

    // ── _openIn ───────────────────────────────────────────────

    function _openIn(path, entry, mode) {
        window.EventBus?.emit("filelist:fileOpened",      { path, entry });
        window.EventBus?.emit("filemanager:fileOpened",   { path, entry });
        if (mode) {
            window.primaryPanel?.openFile(path, mode);
        } else {
            window.primaryPanel?.openFile(path);
        }
    }

    function _defaultMode(entry) {
        const ext = (entry.ext || "").toLowerCase().replace(".", "");
        const map = {
            js: "code", ts: "code", py: "code", rs: "code", go: "code",
            html: "browser", htm: "browser", svg: "browser",
            jpg: "browser", png: "browser", gif: "browser",
            mp3: "browser", mp4: "browser",
            log: "terminal", sh: "terminal",
        };
        return map[ext] || "code";
    }

    // ── _renameEntry ──────────────────────────────────────────

    async function _renameEntry(oldPath, entry) {
        const newName = prompt(`Rename "${entry.name}" to:`, entry.name);
        if (!newName || newName === entry.name) return;
        const dir     = oldPath.replace(/[\\/][^\\/]+$/, "");
        const newPath = dir + "/" + newName;
        try {
            await window.backendConnector?.runWorkflow("fs_rename", { old_path: oldPath, new_path: newPath });
            refresh();
        } catch (err) {
            window.showToast?.(`Rename failed: ${err.message}`);
        }
    }

    // ── _deleteEntries ────────────────────────────────────────

    async function _deleteEntries(paths) {
        const msg = paths.length === 1
            ? `Delete "${paths[0].split(/[\\/]/).pop()}"?`
            : `Delete ${paths.length} items?`;
        if (!confirm(msg)) return;
        for (const p of paths) {
            try {
                await window.backendConnector?.runWorkflow("fs_remove", { path: p });
            } catch (err) {
                window.showToast?.(`Delete failed: ${err.message}`);
            }
        }
        _selected.clear();
        refresh();
    }

    // ── _entryIcon ────────────────────────────────────────────

    function _entryIcon(entry) {
        if (entry.type === "directory") return "📁";
        const ext = (entry.ext || "").toLowerCase().replace(".", "");
        const icons = {
            js: "📄", ts: "📄", jsx: "📄", tsx: "📄",
            py: "🐍", rs: "🦀", go: "📄", java: "☕",
            html: "🌐", css: "🎨", json: "📋",
            md: "📝", txt: "📄", pdf: "📕",
            jpg: "🖼️", png: "🖼️", gif: "🖼️", svg: "🖼️",
            mp3: "🎵", wav: "🎵", mp4: "🎬", mov: "🎬",
            zip: "📦", gz: "📦",
            sh: "⚙️", log: "📋",
        };
        return icons[ext] || "📄";
    }

    function getSelection() { return [..._selected]; }
    function clearSelection() { _selected.clear(); _renderSelectionState(); }
    function refresh() { if (_currentPath) loadPath(_currentPath); }

    // ── window export ─────────────────────────────────────────
    window.FileList = { MANIFEST, render, loadPath, refresh, getSelection, clearSelection };

    domReady(() => {
        window.EventBus?.command("filelist", "loadPath",       ({ path })      => loadPath(path));
        window.EventBus?.command("filelist", "refresh",        ()              => refresh());
        window.EventBus?.command("filelist", "getSelection",   ()              => getSelection());
        window.EventBus?.command("filelist", "clearSelection", ()              => clearSelection());
    });

})();
