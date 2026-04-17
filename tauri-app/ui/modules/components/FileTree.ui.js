// ============================================================
// FileTree.ui.js — Collapsible Visual File Tree
// version: 1.0.0
// depends: tauri-utils.js, EventBus.ui.js
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    // ── FileTree.ui ───────────────────────────────────────────
    // Renders a visual collapsible tree of any directory.
    // NOT Windows Explorer style — visual/minimal aesthetic.
    // Communicates via EventBus only.
    //
    // Events emitted:
    //   filetree:folderSelected  { path }
    //   filetree:fileSelected    { path, entry }
    //   filetree:fileOpened      { path, entry }  (double-click)
    // ── end of FileTree.ui ───────────────────────────────────

    // ── SDOA v3 MANIFEST ─────────────────────────────────────
    const MANIFEST = {
        id:      "FileTree.ui",
        type:    "component",
        runtime: "Browser",
        version: "1.0.0",
        capabilities: ["tree.render", "tree.navigate", "tree.expand"],
        dependencies: ["tauri-utils.js", "EventBus.ui.js"],
        docs: { description: "Visual collapsible file tree. Emits selection events to EventBus." },
        actions: {
            commands: {
                render:      { description: "Render tree into container.",   input: { container: "DOMElement", rootPath: "string" }, output: "void" },
                setRootPath: { description: "Change root path and re-render.", input: { path: "string" }, output: "void" },
                refresh:     { description: "Reload current tree.",           input: {}, output: "void" },
                selectPath:  { description: "Highlight a path in the tree.", input: { path: "string" }, output: "void" },
            },
            triggers: {},
            emits: {
                "filetree:folderSelected": { payload: { path: "string" } },
                "filetree:fileSelected":   { payload: { path: "string", entry: "object" } },
                "filetree:fileOpened":     { payload: { path: "string", entry: "object" } },
            },
            workflows: {}
        }
    };
    // ── end of SDOA v3 MANIFEST ──────────────────────────────

    // ── state ─────────────────────────────────────────────────
    let _container   = null;
    let _rootPath    = null;
    let _selectedPath = null;
    let _expanded    = new Set();   // set of expanded folder paths
    // ── end of state ─────────────────────────────────────────

    // ── render ────────────────────────────────────────────────

    async function render(container, rootPath) {
        _container = container;
        _rootPath  = rootPath;
        _container.innerHTML = "";
        _container.className = "filetree-root";

        if (!rootPath) {
            _container.innerHTML = `<div class="filetree-empty">No folder selected</div>`;
            return;
        }

        const ul = document.createElement("ul");
        ul.className = "filetree-ul";
        _container.appendChild(ul);

        await _loadChildren(ul, rootPath, 0);
    }

    // ── _loadChildren ─────────────────────────────────────────

    async function _loadChildren(ul, dirPath, depth) {
        ul.innerHTML = `<li class="filetree-loading">Loading…</li>`;
        try {
            const result = await window.backendConnector?.runWorkflow("list_files", {
                realPath: dirPath
            });

            ul.innerHTML = "";

            const folders = result?.folders || result?.data?.folders || [];
            const files   = result?.files   || result?.data?.files   || [];

            if (folders.length === 0 && files.length === 0) {
                const empty = document.createElement("li");
                empty.className   = "filetree-empty-dir";
                empty.textContent = "Empty folder";
                ul.appendChild(empty);
                return;
            }

            // Render folders first
            folders.forEach(f => ul.appendChild(_buildFolderNode(f, depth)));
            // Then files
            files.forEach(f   => ul.appendChild(_buildFileNode(f, depth)));

        } catch (err) {
            ul.innerHTML = `<li class="filetree-error">Failed to load</li>`;
        }
    }

    // ── _buildFolderNode ──────────────────────────────────────

    function _buildFolderNode(entry, depth) {
        const li = document.createElement("li");
        li.className     = "filetree-item filetree-folder";
        li.dataset.path  = entry.path || entry.realPath;

        const row = document.createElement("div");
        row.className    = "filetree-row";
        row.style.paddingLeft = `${depth * 14 + 6}px`;

        const chevron = document.createElement("span");
        chevron.className   = "filetree-chevron";
        chevron.textContent = _expanded.has(entry.path) ? "▾" : "▸";

        const icon = document.createElement("span");
        icon.className   = "filetree-icon";
        icon.textContent = "⬡"; // folder indicator — minimal

        const name = document.createElement("span");
        name.className   = "filetree-name";
        name.textContent = entry.name;

        row.appendChild(chevron);
        row.appendChild(icon);
        row.appendChild(name);
        li.appendChild(row);

        // Children container — lazy loaded
        const childUl = document.createElement("ul");
        childUl.className = "filetree-ul filetree-children";
        childUl.style.display = _expanded.has(entry.path) ? "block" : "none";
        li.appendChild(childUl);

        if (_expanded.has(entry.path)) {
            _loadChildren(childUl, entry.path || entry.realPath, depth + 1);
        }

        // ── single click — select folder + populate file list ─
        row.addEventListener("click", (e) => {
            e.stopPropagation();
            _setSelected(entry.path || entry.realPath, li);
            window.EventBus?.emit("filetree:folderSelected", {
                path:  entry.path || entry.realPath,
                entry
            });
        });

        // ── chevron click — expand/collapse ───────────────────
        chevron.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = childUl.style.display !== "none";
            if (isOpen) {
                childUl.style.display = "none";
                chevron.textContent   = "▸";
                _expanded.delete(entry.path);
            } else {
                childUl.style.display = "block";
                chevron.textContent   = "▾";
                _expanded.add(entry.path);
                if (childUl.children.length === 0) {
                    _loadChildren(childUl, entry.path || entry.realPath, depth + 1);
                }
            }
        });

        return li;
    }

    // ── _buildFileNode ────────────────────────────────────────

    function _buildFileNode(entry, depth) {
        const li = document.createElement("li");
        li.className    = "filetree-item filetree-file";
        li.dataset.path = entry.path || entry.realPath;

        const row = document.createElement("div");
        row.className   = "filetree-row";
        row.style.paddingLeft = `${depth * 14 + 22}px`;

        const icon = document.createElement("span");
        icon.className   = "filetree-icon filetree-file-icon";
        icon.textContent = _fileIconChar(entry.ext || "");

        const name = document.createElement("span");
        name.className   = "filetree-name";
        name.textContent = entry.name;

        row.appendChild(icon);
        row.appendChild(name);
        li.appendChild(row);

        // ── single click — show manifest ──────────────────────
        row.addEventListener("click", (e) => {
            e.stopPropagation();
            _setSelected(entry.path || entry.realPath, li);
            window.EventBus?.emit("filetree:fileSelected", {
                path:  entry.path || entry.realPath,
                entry
            });
        });

        // ── double click — open file ──────────────────────────
        row.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            window.EventBus?.emit("filetree:fileOpened", {
                path:  entry.path || entry.realPath,
                entry
            });
        });

        return li;
    }

    // ── _setSelected ─────────────────────────────────────────

    function _setSelected(path, li) {
        _selectedPath = path;
        _container?.querySelectorAll(".filetree-row.selected")
            .forEach(r => r.classList.remove("selected"));
        li?.querySelector(".filetree-row")?.classList.add("selected");
    }

    function selectPath(path) {
        const item = _container?.querySelector(`[data-path="${CSS.escape(path)}"]`);
        if (item) _setSelected(path, item);
    }

    function setRootPath(path) { render(_container, path); }
    function refresh()         { if (_container && _rootPath) render(_container, _rootPath); }

    // ── _fileIconChar ─────────────────────────────────────────
    function _fileIconChar(ext) {
        const map = {
            js: "·", ts: "·", py: "·", rs: "·", go: "·",
            md: "–", txt: "–", json: ":", yaml: ":", csv: ":",
            html: "<", css: "~", svg: "◇",
            jpg: "▣", png: "▣", gif: "▣",
            mp3: "♪", mp4: "▶",
            pdf: "≡", zip: "□",
        };
        return map[ext?.toLowerCase()] || "·";
    }

    // ── window export ─────────────────────────────────────────
    window.FileTree = { MANIFEST, render, setRootPath, refresh, selectPath };

    domReady(() => {
        window.EventBus?.command("filetree", "render",      ({ container, rootPath }) => render(container, rootPath));
        window.EventBus?.command("filetree", "setRootPath", ({ path })               => setRootPath(path));
        window.EventBus?.command("filetree", "refresh",     ()                       => refresh());
        window.EventBus?.command("filetree", "selectPath",  ({ path })               => selectPath(path));
    });

})();
