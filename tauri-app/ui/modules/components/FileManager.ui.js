// ============================================================
// FileManager.ui.js — File Manager Orchestrator
// version: 3.1.0
// depends: tauri-utils.js, EventBus.ui.js,
//          FileTree.ui.js, FileList.ui.js, ManifestPanel.ui.js
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    const MANIFEST = {
        id: "FileManager.ui", type: "component", runtime: "Browser", version: "3.1.0",
        capabilities: ["file.browse","file.select","file.open","vfs.add","vfs.list","manifest.view","tree.collapsible","list.explorer","split.adaptive"],
        dependencies: ["tauri-utils.js","EventBus.ui.js","FileTree.ui.js","FileList.ui.js","ManifestPanel.ui.js"],
        docs: { description: "File manager orchestrator. Owns internal split. Delegates to FileTree, FileList, ManifestPanel." },
        actions: {
            commands: {
                render:      { description: "Render into container.",      input: { container: "DOMElement" }, output: "void" },
                setRootPath: { description: "Navigate to a path.",         input: { path: "string" },         output: "void" },
                refresh:     { description: "Reload current view.",        input: {},                         output: "void" },
                showVfsList: { description: "Switch to VFS registry tab.", input: {},                         output: "void" },
            },
            triggers: {},
            emits: {
                "filemanager:fileOpened":    { payload: { path: "string", entry: "object" } },
                "filemanager:folderChanged": { payload: { path: "string" } },
                "filemanager:vfsUpdated":    { payload: { project: "string" } },
            },
            workflows: {}
        }
    };

    let _container       = null;
    let _rootPath        = null;
    let _treeVisible     = true;
    let _manifestVisible = true;
    let _activeTab       = "browse";

    async function render(container) {
        _container = container;
        _container.innerHTML = "";
        _container.className = "filemgr-root";

        // Wait for bridge before resolving paths
        _rootPath = await _getProjectDir();
        _buildLayout();
        _wireBusEvents();
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
                    <button class="filemgr-icon-btn" id="filemgrToggleTree" title="Toggle tree">⬡</button>
                    <button class="filemgr-icon-btn" id="filemgrRefresh"    title="Refresh">↻</button>
                    <button class="filemgr-icon-btn" id="filemgrGoHome"     title="Project root">⌂</button>
                    <button class="filemgr-icon-btn" id="filemgrAddVfs"     title="Add to VFS">+VFS</button>
                </div>
            </div>
            <div class="filemgr-breadcrumb"><span class="breadcrumb-text">${_rootPath||"/"}</span></div>
            <div class="filemgr-body" id="filemgrBody"></div>
        `;
        _buildBodyLayout();
        _wireToolbar();
    }

    function _buildBodyLayout() {
        const body = _container?.querySelector("#filemgrBody");
        if (!body) return;
        body.innerHTML = "";

        if (_activeTab === "browse") {
            body.innerHTML = `
                <div class="filemgr-split" id="filemgrSplit">
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
            const res     = await window.backendConnector?.runWorkflow("vfs_list", { project: window.currentProject||"default" });
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
                row.addEventListener("click",    () => { lb.querySelectorAll(".selected").forEach(r=>r.classList.remove("selected")); row.classList.add("selected"); window.ManifestPanel?.showEntry(entry.id); });
                row.addEventListener("dblclick", () => window.primaryPanel?.openFile(entry.realPath));
                lb.appendChild(row);
            });
        } catch(err) {
            body.innerHTML = `<div class="filemgr-error">Failed: ${err.message}</div>`;
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
        _container?.querySelector("#filemgrRefresh")?.addEventListener("click", () => { window.FileTree?.refresh(); window.FileList?.refresh(); });
        _container?.querySelector("#filemgrGoHome")?.addEventListener("click",  async () => { _rootPath = await _getProjectDir(); window.FileTree?.setRootPath(_rootPath); window.FileList?.loadPath(_rootPath); _updateBreadcrumb(_rootPath); });
        _container?.querySelector("#filemgrAddVfs")?.addEventListener("click",  async () => { const sel = window.FileList?.getSelection()||[]; if(!sel.length){window.showToast?.("Select files first");return;} await _addToVfs(sel); });
    }

    function _wireBusEvents() {
        const bus = window.EventBus;
        if (!bus) return;
        bus.on("filetree:folderSelected",   ({ path })        => { window.FileList?.loadPath(path); _updateBreadcrumb(path); });
        bus.on("filelist:fileOpened",        ({ path, entry }) => { window.primaryPanel?.openFile(path); bus.emit("filemanager:fileOpened",{path,entry}); });
        bus.on("firetree:fileOpened",        ({ path, entry }) => { window.primaryPanel?.openFile(path); bus.emit("filemanager:fileOpened",{path,entry}); });
        bus.on("filelist:addToVfs",          ({ paths })       => _addToVfs(paths));
        bus.on("filelist:viewManifest",      ({ path })        => { _manifestVisible=true; _container?.querySelector("#filemgrManifestPane")?.classList.remove("hidden"); window.ManifestPanel?.showFile(path); });
        bus.on("manifestpanel:addedToVfs",   ()                => bus.emit("filemanager:vfsUpdated",{project:window.currentProject}));
        bus.on("app:projectSelected",        async ()          => { _rootPath=await _getProjectDir(); if(_container){_buildBodyLayout();_updateBreadcrumb(_rootPath);} });
        bus.command("filemanager","render",      ({container}) => render(container));
        bus.command("filemanager","setRootPath", ({path})      => setRootPath(path));
        bus.command("filemanager","refresh",     ()            => refresh());
        bus.command("filemanager","showVfsList", ()            => showVfsList());
    }

    async function _addToVfs(paths) {
        let added = 0;
        for (const path of paths) {
            try { await window.backendConnector?.runWorkflow("vfs_add",{project:window.currentProject||"default",realPath:path}); added++; }
            catch(err) { window.showToast?.(`VFS add failed: ${err.message}`); }
        }
        if (added > 0) { window.showToast?.(`Added ${added} file${added>1?"s":""} to VFS`); window.EventBus?.emit("filemanager:vfsUpdated",{project:window.currentProject}); }
    }

    async function _getProjectDir() {
        const proj = window.currentProject || "default";
        try {
            const dir = await window.backendConnector?.runWorkflow("get_project_dir", { project: proj });
            // Reject relative paths — means PROTOAI_ROOT wasn't set
            if (dir && !dir.startsWith(".") && dir.length > 3) return dir;
        } catch { /* fall through */ }
        // Fallback: construct from known root
        return `C:\\protoai\\data\\projects\\${proj}`;
    }

    function _updateBreadcrumb(path) { const el=_container?.querySelector(".breadcrumb-text"); if(el) el.textContent=path||"/"; }
    function _typeIcon(type) { const m={code:"📄",document:"📃",data:"📊",image:"🖼",audio:"🎵",video:"🎬",directory:"📁",generic:"📎"}; return m[type]||"📎"; }
    function setRootPath(path) { _rootPath=path; window.FileTree?.setRootPath(path); window.FileList?.loadPath(path); _updateBreadcrumb(path); }
    function refresh()         { window.FileTree?.refresh(); window.FileList?.refresh(); }
    function showVfsList()     { _activeTab="vfs"; _container?.querySelectorAll(".filemgr-tab").forEach(b=>b.classList.toggle("active",b.dataset.tab==="vfs")); _buildBodyLayout(); }

    window.fileManager = { MANIFEST, render, setRootPath, refresh, showVfsList };
    domReady(() => {});

})();
