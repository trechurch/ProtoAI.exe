// ============================================================
// FileManager — SDOA v3.0 Component
// File Tree + File List + Permissions + Tier Management
// ============================================================

const { Component } = require('../base/sdoa-base.js');

// Global caches referenced by original logic
let _permissionsCache = null;
let _selectedFolder = null;

class FileManager extends Component {

    // ------------------------------------------------------------
    // SDOA v3.0 MANIFEST (embedded, authoritative)
    // ------------------------------------------------------------
    static MANIFEST = {
        id: "FileManager",
        type: "component",
        runtime: "JavaScript",
        version: "3.0.0",

        // v1.2 compatibility fields
        capabilities: [
            "file-tree",
            "file-list",
            "tier-management",
            "drag-drop",
            "permissions.read",
            "permissions.write"
        ],

        dependencies: [
            "ListFilesWorkflow",
            "FilePermissionsWorkflow"
        ],

        // --------------------------------------------------------
        // v3.0 ACTION SURFACE
        // --------------------------------------------------------
        actions: {
            commands: {
                render: {
                    description: "Render the file manager UI into a container.",
                    input: { container: "DOMElement" },
                    output: "void"
                },
                loadFileList: {
                    description: "Load the file list for a folder.",
                    input: { folderPath: "string" },
                    output: "FileEntry[]"
                },
                getPermissions: {
                    description: "Load cached or fresh permissions for the current project.",
                    input: {},
                    output: "PermissionPolicy"
                },
                updateTier: {
                    description: "Update tier assignment for a file or folder.",
                    input: { path: "string", tier: "string | null" },
                    output: "void"
                }
            },

            triggers: {
                folderSelected: {
                    description: "Fires when a folder is selected in the tree.",
                    payload: { path: "string" }
                },
                fileOpened: {
                    description: "Fires when a file is double‑clicked.",
                    payload: { path: "string" }
                },
                tierChanged: {
                    description: "Fires when a tier is updated.",
                    payload: { path: "string", tier: "string | null" }
                }
            },

            emits: {
                fileListLoaded: {
                    description: "Emits after a file list is loaded.",
                    payload: { folderPath: "string", count: "number" }
                },
                permissionsLoaded: {
                    description: "Emits when permissions are loaded or refreshed.",
                    payload: { project: "string" }
                }
            },

            workflows: {
                listFiles: {
                    description: "Primary workflow for listing files.",
                    input: { project: "string", path: "string" },
                    output: "FileEntry[]"
                },
                permissions: {
                    description: "Primary workflow for reading/writing permissions.",
                    input: { action: "string", project: "string", file: "string?" },
                    output: "PermissionPolicy"
                }
            }
        },

        // --------------------------------------------------------
        // v1.2 Docs (kept for backward compatibility)
        // --------------------------------------------------------
        docs: {
            description: "Self-contained file browser (tree + list + permissions).",
            input: { container: "DOMElement" },
            output: "void",
            author: "ProtoAI team",
            sdoa_compatibility: `
                SDOA Compatibility Contract:
                - v1.2 Manifest is minimum requirement (Name/Type/Version/Description/Capabilities/Dependencies/Docs).
                - v2.0 may also read sidecars, hot‑reload, version‑CLI.
                - v3.0 may add actions.commands, actions.triggers, actions.emits, actions.workflows.
                - Lower versions MUST ignore unknown/unexpressed fields.
                - Higher versions MUST NOT change meaning of older fields.
                - All versions are backward and forward compatible.
            `
        }
    };

    // ------------------------------------------------------------
    // Render File Manager UI
    // ------------------------------------------------------------
    async render(container) {
        if (!currentProject) {
            container.innerHTML = `
                <div style="padding:40px;text-align:center;color:var(--text-dim);">
                    Select a project to browse files
                </div>`;
            return;
        }

        const projectDir = await this.getProjectDir();

        container.innerHTML = `
            <div id="fileMgrWrapper" style="display:flex;height:100%;overflow:hidden;">
                <div id="folderTree" style="width:35%;border-right:1px solid var(--border-subtle);overflow:auto;background:var(--bg-elevated-2);"></div>
                <div id="fileListPanel" style="flex:1;overflow:auto;display:flex;flex-direction:column;">
                    <div id="fileListBreadcrumb" style="padding:8px 12px;border-bottom:1px solid var(--border-subtle);font-size:11px;color:var(--text-dim);"></div>
                    <div id="fileList" style="flex:1;overflow:auto;padding:4px;"></div>
                </div>
            </div>
        `;

        const wrapper = container.querySelector("#fileMgrWrapper");
        const treeContainer = container.querySelector("#folderTree");
        const listContainer = container.querySelector("#fileList");

        // Responsive layout
        new ResizeObserver(() => {
            const isWide = wrapper.offsetWidth > wrapper.offsetHeight * 1.2;
            wrapper.style.flexDirection = isWide ? "row" : "column";
            treeContainer.style.width = isWide ? "35%" : "100%";
            treeContainer.style.height = isWide ? "100%" : "40%";
            treeContainer.style.borderRight = isWide ? "1px solid var(--border-subtle)" : "none";
            treeContainer.style.borderBottom = isWide ? "none" : "1px solid var(--border-subtle)";
        }).observe(wrapper);

        await this.renderFolderTree(treeContainer, projectDir, listContainer);
        await this.loadFileList(listContainer, projectDir);
    }

    // ------------------------------------------------------------
    // Project Directory
    // ------------------------------------------------------------
    async getProjectDir() {
        if (!currentProject) return null;

        try {
            return await window.__TAURI__.core.invoke("get_project_dir", {
                project: currentProject
            });
        } catch (e) {
            console.warn("get_project_dir failed, using fallback", e);
            return `./projects/${currentProject}`;
        }
    }

    // ------------------------------------------------------------
    // Permissions
    // ------------------------------------------------------------
    async getPermissions() {
        if (_permissionsCache?.project === currentProject) {
            this.emit("permissionsLoaded", { project: currentProject });
            return _permissionsCache;
        }

        try {
            const res = await runWorkflow("FilePermissionsWorkflow", {
                action: "list",
                project: currentProject
            });

            _permissionsCache = res;
            this.emit("permissionsLoaded", { project: currentProject });
            return res;

        } catch (e) {
            console.error("Permissions load failed", e);
            return { grantedPaths: [], defaultPolicy: "deny" };
        }
    }

    invalidatePermissions() {
        _permissionsCache = null;
    }

    getTierForPath(path) {
        const perms = _permissionsCache?.grantedPaths || [];
        const entry = perms.find(p =>
            p.path === path ||
            path.startsWith(p.path + (p.type === "directory" ? "/" : ""))
        );
        return entry ? (entry.tier || null) : null;
    }

    // ------------------------------------------------------------
    // Folder Tree
    // ------------------------------------------------------------
    async renderFolderTree(treeContainer, rootPath, listContainer) {
        treeContainer.innerHTML = "";
        const rootNode = await this.buildTreeNode(rootPath, rootPath);

        const ul = document.createElement("ul");
        ul.style.cssText = "list-style:none;padding:0;margin:0;font-size:12px;";

        this.renderTreeNode(ul, rootNode, treeContainer, listContainer, rootPath);
        treeContainer.appendChild(ul);
    }

    async buildTreeNode(fullPath, displayName) {
        let entries = [];

        try {
            const res = await runWorkflow("ListFilesWorkflow", {
                project: currentProject,
                path: fullPath.replace(/\\/g, "/")
            });
            entries = res.entries || [];
        } catch (_) {}

        return {
            path: fullPath,
            name: displayName.split(/[/\\]/).pop() || "Project Root",
            isDir: true,
            children: entries
                .filter(e => e.isDir)
                .map(e => ({ path: e.path, name: e.name, isDir: true }))
        };
    }

    renderTreeNode(parentUl, node, treeContainer, listContainer, rootPath) {
        const li = document.createElement("li");
        const row = document.createElement("div");

        row.className = "folder-node";
        row.style.cssText = `
            display:flex;align-items:center;gap:6px;
            padding:4px 8px;cursor:pointer;border-radius:4px;
        `;

        const chevron = document.createElement("span");
        chevron.textContent = "▶";
        chevron.style.transition = "transform 0.2s";

        const icon = document.createElement("span");
        icon.textContent = "📁";

        const nameSpan = document.createElement("span");
        nameSpan.textContent = node.name;
        nameSpan.style.flex = "1";

        const tierDot = this.createTierDot(node.path);

        row.append(chevron, icon, nameSpan, tierDot);
        li.appendChild(row);

        let childrenUl = null;

        row.addEventListener("click", async (e) => {
            if (e.target.closest(".tier-dot")) return;

            _selectedFolder = node.path;
            this.highlightSelectedFolder(treeContainer, node.path);

            this.emit("folderSelected", { path: node.path });

            await this.loadFileList(
                listContainer.querySelector("#fileList") || listContainer,
                node.path
            );
        });

        chevron.addEventListener("click", async (e) => {
            e.stopImmediatePropagation();

            if (!childrenUl) {
                childrenUl = document.createElement("ul");
                childrenUl.style.cssText = "list-style:none;padding-left:22px;margin:2px 0;";
                li.appendChild(childrenUl);

                const fullNode = await this.buildTreeNode(node.path, node.name);
                fullNode.children.forEach(child => {
                    this.renderTreeNode(childrenUl, child, treeContainer, listContainer, rootPath);
                });
            }

            const isOpen = childrenUl.style.display !== "none";
            childrenUl.style.display = isOpen ? "none" : "block";
            chevron.style.transform = isOpen ? "" : "rotate(90deg)";
            row.classList.toggle("open", !isOpen);
        });

        // Drag & drop
        row.addEventListener("dragover", e => {
            e.preventDefault();
            row.classList.add("drag-over");
        });

        row.addEventListener("dragleave", () => row.classList.remove("drag-over"));

        row.addEventListener("drop", async e => {
            e.preventDefault();
            row.classList.remove("drag-over");

            const data = JSON.parse(e.dataTransfer.getData("text/plain"));

            for (const src of data.paths) {
                const dest = node.path + "/" + src.split(/[/\\]/).pop();
                try {
                    await window.__TAURI__.core.invoke("fs_rename", {
                        old_path: src,
                        new_path: dest
                    });
                } catch (err) {
                    console.error(err);
                }
            }

            refreshFileManager();
        });

        parentUl.appendChild(li);
    }

    // ------------------------------------------------------------
    // Tier Dot
    // ------------------------------------------------------------
    createTierDot(path) {
        const dot = document.createElement("span");
        dot.className = "tier-dot";
        dot.style.cssText = `
            display:inline-block;width:8px;height:8px;
            border-radius:50%;margin-left:6px;cursor:pointer;
        `;

        this.updateTierDot(dot, path);

        dot.addEventListener("click", async e => {
            e.stopImmediatePropagation();

            let current = this.getTierForPath(path);
            let idx = TIER_CYCLE.indexOf(current);
            const nextTier = TIER_CYCLE[(idx + 1) % TIER_CYCLE.length];

            try {
                await runWorkflow("FilePermissionsWorkflow", {
                    action: nextTier ? "grant" : "revoke",
                    project: currentProject,
                    [path.endsWith("/") || !path.includes(".") ? "directory" : "file"]: path,
                    tier: nextTier
                });

                this.invalidatePermissions();
                await this.getPermissions();
                this.updateTierDot(dot, path);

                this.emit("tierChanged", { path, tier: nextTier });

            } catch (err) {
                showError("Tier update failed");
            }
        });

        return dot;
    }

    updateTierDot(dot, path) {
        const tier = this.getTierForPath(path);
        dot.style.background = TIER_COLOR[tier] || TIER_COLOR.null;
    }

    highlightSelectedFolder(treeContainer, selectedPath) {
        treeContainer.querySelectorAll(".folder-node").forEach(n => {
            n.classList.toggle(
                "selected",
                n.textContent.includes(selectedPath.split(/[/\\]/).pop())
            );
        });
    }

    // ------------------------------------------------------------
    // File List
    // ------------------------------------------------------------
    async loadFileList(listContainer, folderPath) {
        listContainer.innerHTML = "";

        const breadcrumb = document.getElementById("fileListBreadcrumb");
        if (breadcrumb) breadcrumb.textContent = folderPath.replace(/\\/g, "/");

        try {
            const res = await runWorkflow("ListFilesWorkflow", {
                project: currentProject,
                path: folderPath
            });

            const files = (res.entries || []).filter(e => !e.isDir);

            files.forEach(file => {
                const row = document.createElement("div");
                row.className = "file-row";
                row.draggable = true;

                row.style.cssText = `
                    display:flex;align-items:center;gap:8px;
                    padding:6px 10px;cursor:pointer;border-radius:4px;
                    font-size:12px;
                `;

                row.innerHTML = `
                    <span>📄</span>
                    <span style="flex:1">${file.name}</span>
                    <span style="color:var(--text-dim);font-size:10px;">
                        ${(file.size / 1024).toFixed(1)} KB
                    </span>
                `;

                const tierDot = this.createTierDot(file.path);
                row.appendChild(tierDot);

                row.addEventListener("click", e => handleFileSelection(e, row, file.path));

                row.addEventListener("dblclick", () => {
                    activateCodeTab();
                    showToast(`Opened ${file.name} in editor`);
                    this.emit("fileOpened", { path: file.path });
                });

                row.addEventListener("dragstart", e => {
                    const selected = Array.from(
                        document.querySelectorAll(".file-row.selected")
                    ).map(r => r.dataset.path || file.path);

                    e.dataTransfer.setData(
                        "text/plain",
                        JSON.stringify({ paths: selected.length ? selected : [file.path] })
                    );
                });

                row.dataset.path = file.path;
                listContainer.appendChild(row);
            });

            this.emit("fileListLoaded", {
                folderPath,
                count: files.length
            });

        } catch (e) {
            listContainer.innerHTML = `
                <div style="padding:20px;color:var(--color-error);">
                    Failed to load files: ${e.message}
                </div>`;
        }
    }
}

module.exports = FileManager;
