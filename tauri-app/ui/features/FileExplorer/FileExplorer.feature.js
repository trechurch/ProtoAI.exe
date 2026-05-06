// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// FileExplorer.feature.js — SDOA v4 Feature | v4.0.0 | layer 1
// Migrated from legacy FileManager.ui.js
// ============================================================

(function () {
    "use strict";

    const MANIFEST = {
        id: "FileExplorer.feature", type: "feature", layer: 1,
        runtime: "Browser", version: "4.0.0",
        requires: ["Toast.prim"],
        dataFiles: [],
        lifecycle: ["init", "mount"],
        actions: { 
            commands: { 
                setRootPath: { description: "Navigate to a path.", input: { path: "string" }, output: "void" },
                refresh:     { description: "Reload current view.", input: {}, output: "void" },
                showVfsList: { description: "Switch to VFS registry tab.", input: {}, output: "void" },
            }, 
            events: {}, 
            accepts: {}, 
            slots: ["rightPaneContent"] 
        },
        backendDeps: ["vfs_list", "vfs_add", "get_project_dir"],
        docs: { description: "File explorer feature. Orchestrates FileTree, FileList, ManifestPanel.", author: "ProtoAI team", sdoa: "4.0.0" }
    };

    let _container       = null;
    let _rootPath        = null;
    let _treeVisible     = true;
    let _manifestVisible = true;
    let _activeTab       = "browse";
    let _resizeObserver  = null;

    async function init() {
        if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { init, mount, setRootPath, refresh, showVfsList });
    }

    async function mount(container) {
        if (!container) return;
        if (_resizeObserver) { _resizeObserver.disconnect(); _resizeObserver = null; }

        _container = container;
        _container.innerHTML = "";
        _container.className = "filemgr-root";

        _rootPath = await _getProjectDir();
        _buildLayout();
        _wireBusEvents();

        _resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                const width = entry.contentRect.width;
                const isNarrow = width < 500;
                _container.dataset.narrow = isNarrow ? "true" : "false";
                const split = _container.querySelector("#filemgrSplit");
                if (split) split.classList.toggle("split-vertical", isNarrow);
            }
        });
        _resizeObserver.observe(_container);
    }

    function _buildLayout() {
        if (!_container) return;
        _container.innerHTML = `
            <div class="filemgr-toolbar" id="filemgrToolbar">
                <div class="filemgr-tabs">
                    <button class="filemgr-tab ${_activeTab==="browse"?"active":""}" data-tab="browse">Browse</button>
                    <button class="filemgr-tab ${_activeTab==="vfs"?"active":""}"    data-tab="vfs">VFS</button>
                </div>
                <div class="filemgr-toolbar-actions">
                    <button class="filemgr-icon-btn" id="filemgrGoUp"        title="Up one level">↑</button>
                    <button class="filemgr-icon-btn" id="filemgrToggleTree"  title="Toggle tree">⬡</button>
                    <button class="filemgr-icon-btn" id="filemgrRefresh"     title="Refresh">↻</button>
                    <button class="filemgr-icon-btn" id="filemgrGoHome"      title="Project root">⌂</button>
                    <button class="filemgr-icon-btn" id="filemgrAddVfs"      title="Add selected / current folder to VFS">+VFS</button>
                    <button class="filemgr-icon-btn" id="filemgrBrowseVfs"   title="Browse for folder to add to VFS">📂+VFS</button>
                </div>
            </div>
            <div class="filemgr-breadcrumb" id="filemgrBreadcrumb" title="Click to type a path">
                <span class="breadcrumb-text">${_rootPath||"/"}</span>
            </div>
            <div class="filemgr-body" id="filemgrBody"></div>
        `;
        _buildBodyLayout();
        _wireToolbar();
        _wireBreadcrumb();
    }

    function _buildBodyLayout() {
        const body = _container?.querySelector("#filemgrBody");
        if (!body) return;
        body.innerHTML = "";

        if (_activeTab === "browse") {
            const isNarrow = _container?.dataset?.narrow === "true";
            body.innerHTML = `
                <div class="filemgr-split ${isNarrow ? "split-vertical" : ""}" id="filemgrSplit">
                    <div class="filemgr-tree-pane ${_treeVisible?"":"hidden"}" id="filemgrTreePane">
                        <div class="filemgr-tree-inner" id="filemgrTreeInner"></div>
                    </div>
                    <div class="filemgr-main-pane" id="filemgrMainPane">
                        <div class="filemgr-list-pane"     id="filemgrListPane"></div>
                        <div class="filemgr-manifest-pane ${_manifestVisible?"":"hidden"}" id="filemgrManifestPane"></div>
                    </div>
                </div>
            `;
            window.FileTree?.render(body.querySelector("#filemgrTreeInner"), _rootPath);
            window.FileList?.render(body.querySelector("#filemgrListPane"));
            window.FileList?.loadPath(_rootPath);
            window.ManifestPanel?.render(body.querySelector("#filemgrManifestPane"));
        } else {
            _renderVfsTab(body);
        }
    }

    async function _renderVfsTab(body) {
        body.innerHTML = `<div class="filemgr-loading">Loading VFS…</div>`;
        try {
            const res = await window.backendConnector?.runWorkflow("vfs_list", { project: window.currentProject||"default" });
            const entries = res?.entries || res?.data?.entries || [];
            if (entries.length === 0) {
                body.innerHTML = `<div class="filemgr-vfs-empty"><div class="filemgr-vfs-empty-icon">◈</div><div class="filemgr-vfs-empty-text">No files in VFS yet</div><div class="filemgr-vfs-empty-hint">Browse to a file and click +VFS</div></div>`;
                return;
            }
            body.innerHTML = `<div class="filemgr-vfs-list"><div class="filelist-header"><div class="filelist-col col-name">File</div><div class="filelist-col col-type">Type</div><div class="filelist-col col-size">Perms</div><div class="filelist-col col-modified">Added</div></div><div class="filelist-body" id="vfsListBody"></div></div>`;
            const lb = body.querySelector("#vfsListBody");
            entries.forEach(entry => {
                const row  = document.createElement("div");
                const perm = entry.permissions || {};
                const name = entry.realPath.split(/[\\/]/).pop();
                row.className    = "filelist-row is-file";
                row.dataset.id   = entry.id;
                row.dataset.path = entry.realPath;
                row.innerHTML = `
                    <div class="filelist-col col-name"><span class="filelist-icon">${_typeIcon(entry.type)}</span><span class="filelist-name" title="${entry.realPath}">${name}</span></div>
                    <div class="filelist-col col-type">${entry.type}</div>
                    <div class="filelist-col col-size">${perm.read?"R":"–"}${perm.write?"W":"–"}${perm.execute?"X":"–"}</div>
                    <div class="filelist-col col-modified">${entry.addedAt?new Date(entry.addedAt).toLocaleDateString():"—"}</div>
                `;
                row.addEventListener("click", () => { lb.querySelectorAll(".selected").forEach(r=>r.classList.remove("selected")); row.classList.add("selected"); window.ManifestPanel?.showEntry(entry.id); });
                row.addEventListener("dblclick", () => window.primaryPanel?.openFile(entry.realPath));
                lb.appendChild(row);
            });
        } catch(err) {
            body.innerHTML = `<div class="filemgr-error">Failed: ${err?.message || String(err)}</div>`;
        }
    }

    function _wireToolbar() {
        _container?.querySelectorAll(".filemgr-tab").forEach(btn => {
            btn.addEventListener("click", () => {
                _activeTab = btn.dataset.tab;
                _container?.querySelectorAll(".filemgr-tab").forEach(b => b.classList.toggle("active", b===btn));
                _buildBodyLayout();
            });
        });
        _container?.querySelector("#filemgrToggleTree")?.addEventListener("click", () => {
            _treeVisible = !_treeVisible;
            _container?.querySelector("#filemgrTreePane")?.classList.toggle("hidden", !_treeVisible);
        });
        _container?.querySelector("#filemgrGoUp")?.addEventListener("click", () => {
            if (!_rootPath) return;
            const parent = _rootPath.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]+$/, "") || _rootPath;
            if (parent && parent !== _rootPath) {
                _rootPath = parent;
                window.FileTree?.setRootPath(_rootPath);
                window.FileList?.loadPath(_rootPath);
                _updateBreadcrumb(_rootPath);
            }
        });
        _container?.querySelector("#filemgrRefresh")?.addEventListener("click", () => { window.FileTree?.refresh(); window.FileList?.refresh(); });
        _container?.querySelector("#filemgrGoHome")?.addEventListener("click",  async () => { _rootPath = await _getProjectDir(); window.FileTree?.setRootPath(_rootPath); window.FileList?.loadPath(_rootPath); _updateBreadcrumb(_rootPath); });
        _container?.querySelector("#filemgrAddVfs")?.addEventListener("click",  async () => {
            const sel = window.FileList?.getSelection() || [];
            if (sel.length) {
                await _addToVfs(sel, false);
            } else if (_rootPath) {
                if (confirm(`Add entire folder to VFS?\n\n${_rootPath}\n\nThis will index all files in the folder and its subfolders.`)) {
                    await _addToVfs([_rootPath], true);
                }
            }
        });

        _container?.querySelector("#filemgrBrowseVfs")?.addEventListener("click", async () => {
            try {
                const dialog = window.__TAURI__?.dialog || window.__TAURI__?.core?.dialog;
                let selected = null;
                if (dialog?.open) {
                    selected = await dialog.open({ directory: true, multiple: false, title: "Select folder to add to VFS" });
                } else {
                    selected = await window.__TAURI__.core.invoke("plugin:dialog|open", {
                        options: { directory: true, multiple: false, title: "Select folder to add to VFS" }
                    });
                }
                if (!selected) return;
                const folders = Array.isArray(selected) ? selected : [selected];
                await _addToVfs(folders, true);
            } catch (err) {
                console.warn(err);
            }
        });
    }

    function _wireBusEvents() {
        const bus = window.EventBus;
        if (!bus) return;
        // avoid re-registering multiple times if mounted multiple times
        bus.off("filetree:folderSelected");
        bus.off("filelist:fileOpened");
        bus.off("firetree:fileOpened");
        bus.off("filelist:addToVfs");
        bus.off("filelist:viewManifest");
        bus.off("manifestpanel:addedToVfs");
        bus.off("app:projectSelected");

        bus.on("filetree:folderSelected",   ({ path })        => { window.FileList?.loadPath(path); _updateBreadcrumb(path); });
        bus.on("filelist:fileOpened",        ({ path, entry }) => { window.primaryPanel?.openFile(path); bus.emit("filemanager:fileOpened",{path,entry}); });
        bus.on("firetree:fileOpened",        ({ path, entry }) => { window.primaryPanel?.openFile(path); bus.emit("filemanager:fileOpened",{path,entry}); });
        bus.on("filelist:addToVfs",          ({ paths, recursive }) => _addToVfs(paths, recursive ?? false));
        bus.on("filelist:viewManifest",      ({ path })        => { _manifestVisible=true; _container?.querySelector("#filemgrManifestPane")?.classList.remove("hidden"); window.ManifestPanel?.showFile(path); });
        bus.on("manifestpanel:addedToVfs",   ()                => bus.emit("filemanager:vfsUpdated",{project:window.currentProject}));
        bus.on("app:projectSelected",        async ()          => { _rootPath=await _getProjectDir(); if(_container){_buildBodyLayout();_updateBreadcrumb(_rootPath);} });
    }

    async function _addToVfs(paths, recursive = false) {
        let added = 0;
        for (const path of paths) {
            try {
                await window.backendConnector?.runWorkflow("vfs_add", {
                    project:   window.currentProject || "default",
                    realPath:  path,
                    recursive: recursive,
                });
                added++;
            } catch(err) { console.warn(err); }
        }
        if (added > 0) {
            window.EventBus?.emit("filemanager:vfsUpdated", { project: window.currentProject });
        }
    }

    async function _getProjectDir() {
        const proj = window.currentProject || "default";
        if (proj === "ProtoAI") return "C:\\protoai";
        try {
            const dir = await window.backendConnector?.runWorkflow("get_project_dir", { project: proj });
            if (dir && !dir.startsWith(".") && dir.length > 3) return dir;
        } catch {}
        return `C:\\protoai\\data\\projects\\${proj}`;
    }

    function _updateBreadcrumb(path) {
        const el = _container?.querySelector(".breadcrumb-text");
        if (el) el.textContent = path || "/";
    }

    function _wireBreadcrumb() {
        const crumb = _container?.querySelector("#filemgrBreadcrumb");
        if (!crumb) return;
        crumb.style.cursor = "text";
        crumb.addEventListener("click", () => {
            if (crumb.querySelector("input")) return;
            const current = _rootPath || "/";
            crumb.innerHTML = `
                <input id="breadcrumbInput" type="text" value="${current}"
                       style="width:100%;background:transparent;border:none;outline:none;
                              color:inherit;font:inherit;padding:0;" />
            `;
            const input = crumb.querySelector("#breadcrumbInput");
            input.focus();
            input.select();

            const commit = () => {
                const typed = input.value.trim();
                if (typed && typed !== _rootPath) {
                    _rootPath = typed;
                    window.FileTree?.setRootPath(_rootPath);
                    window.FileList?.loadPath(_rootPath);
                }
                _updateBreadcrumb(_rootPath);
                crumb.innerHTML = `<span class="breadcrumb-text">${_rootPath || "/"}</span>`;
                _wireBreadcrumb();
            };

            const cancel = () => {
                crumb.innerHTML = `<span class="breadcrumb-text">${_rootPath || "/"}</span>`;
                _wireBreadcrumb();
            };

            input.addEventListener("keydown", e => {
                if (e.key === "Enter")  { e.preventDefault(); commit(); }
                if (e.key === "Escape") { e.preventDefault(); cancel(); }
            });
            input.addEventListener("blur", cancel);
        });
    }

    function _typeIcon(type) { const m={code:"📄",document:"📃",data:"📊",image:"🖼",audio:"🎵",video:"🎬",directory:"📁",generic:"📎"}; return m[type]||"📎"; }
    function setRootPath(path) { _rootPath=path; window.FileTree?.setRootPath(path); window.FileList?.loadPath(path); _updateBreadcrumb(path); }
    function refresh()         { window.FileTree?.refresh(); window.FileList?.refresh(); }
    function showVfsList()     { _activeTab="vfs"; _container?.querySelectorAll(".filemgr-tab").forEach(b=>b.classList.toggle("active",b.dataset.tab==="vfs")); _buildBodyLayout(); }

    window.FileExplorerFeature = { MANIFEST, init, mount, setRootPath, refresh, showVfsList };

})();
