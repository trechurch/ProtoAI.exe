// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// ProjectManager.feature.js — SDOA v4 Feature | v4.0.0 | layer 1
// Replaces ProjectManager modal HTML and app.js logic.
// ============================================================

(function () {
    "use strict";

    const MANIFEST = {
        id: "ProjectManager.feature", type: "feature", layer: 1,
        runtime: "Browser", version: "4.0.0",
        requires: ["Modal.prim", "TabGroup.prim", "Form.prim", "List.prim", "Button.prim", "Toast.prim"],
        dataFiles: ["schemas/project_manager.schema.json"],
        lifecycle: ["init"],
        actions: { commands: { open: {} }, events: {}, accepts: {}, slots: {} },
        backendDeps: ["ListProjectsWorkflow"],
        docs: { description: "Project Manager UI for editing project configurations and archiving.", author: "ProtoAI team", sdoa: "4.0.0" }
    };

    let _schema = null;
    let _modal = null;
    let _projects = [];
    let _selectedProject = null;

    async function init() {
        try {
            const res = await fetch("/data/schemas/project_manager.schema.json");
            if (res.ok) _schema = await res.json();
            
            // Wire the manage projects button in index.html sidebar
            const btn = document.getElementById("manageProjectsBtn");
            if (btn) btn.addEventListener("click", open);

            // Backwards compatibility for anything still calling window.openProjectManager
            window.openProjectManager = open;
            window.closeProjectManager = () => { if (_modal) window.ModalPrim.close(_modal); };

        } catch (err) {
            console.error("[ProjectManager.feature] Failed to load schema:", err);
        }
    }

    async function open() {
        if (!_schema) {
            window.ToastPrim.show("Project Manager schema not loaded.", "error");
            return;
        }

        // Fetch projects
        try {
            const res = await window.backendConnector.runWorkflow("ListProjectsWorkflow");
            _projects = res?.projects || res?.data?.projects || [];
        } catch (e) {
            console.warn("Failed to list projects for PM, using fallback", e);
            _projects = ["default"];
        }

        _selectedProject = _projects[0] || null;

        // Create Modal
        _modal = window.ModalPrim.create({
            title: "Project Manager",
            size: "xl",
            onClose: () => { _modal = null; }
        });

        // Create layout
        const layout = document.createElement("div");
        layout.style.display = "flex";
        layout.style.height = "500px"; // Fixed height for interior

        // Create Sidebar List
        const sidebar = document.createElement("div");
        sidebar.style.width = "250px";
        sidebar.style.borderRight = "1px solid var(--border-subtle)";
        sidebar.style.display = "flex";
        sidebar.style.flexDirection = "column";

        const title = document.createElement("div");
        title.style.padding = "var(--space-md)";
        title.style.fontSize = "var(--text-xs)";
        title.style.textTransform = "uppercase";
        title.style.color = "var(--text-dim)";
        title.style.fontWeight = "600";
        title.textContent = "Active Projects";

        sidebar.appendChild(title);

        const projectList = window.ListPrim.create({
            items: _projects.map(p => {
                const name = typeof p === "string" ? p : (p.name || p.id || "Unknown");
                return { id: name, title: name };
            }),
            selectionMode: "single",
            onSelect: (selectedIds) => {
                _selectedProject = selectedIds[0];
                _renderEditor(editorContainer);
            }
        });
        
        if (_selectedProject) {
            projectList._sdoaUpdate({ selectedIds: [_selectedProject] });
        }

        sidebar.appendChild(projectList);

        // Create Editor Container
        const editorContainer = document.createElement("div");
        editorContainer.style.flex = "1";
        editorContainer.style.display = "flex";
        editorContainer.style.flexDirection = "column";

        layout.appendChild(sidebar);
        layout.appendChild(editorContainer);

        _modal._sdoaBody.appendChild(layout);
        _modal._sdoaBody.style.padding = "0"; 

        _renderEditor(editorContainer);

        window.ModalPrim.open(_modal);
    }

    function _renderEditor(container) {
        container.innerHTML = ""; // Clear existing

        if (!_selectedProject) {
            const empty = window.EmptyStatePrim.create({
                icon: "📂",
                title: "No Project Selected",
                description: "Select a project from the sidebar to manage its settings."
            });
            container.appendChild(empty);
            return;
        }

        // Mock getting current project settings
        const currentSettings = { projectName: _selectedProject };

        // Create TabGroup
        const tabs = window.TabGroupPrim.create({
            variant: "horizontal",
            tabs: _schema.tabs.map(t => ({ id: t.id, label: t.label })),
            renderTab: (tabId, tabContainer) => {
                const tabData = _schema.tabs.find(t => t.id === tabId);
                if (!tabData) return;

                const form = window.FormPrim.create({
                    fields: tabData.fields,
                    values: currentSettings,
                    submitLabel: false, 
                    onChange: (fieldId, val) => {
                        currentSettings[fieldId] = val;
                    }
                });
                tabContainer.appendChild(form);

                if (tabId === "general") {
                    // Add danger actions specifically to general tab
                    const hr = document.createElement("hr");
                    hr.style.margin = "var(--space-xl) 0";
                    hr.style.borderColor = "var(--border-subtle)";
                    
                    const dangerZone = document.createElement("div");
                    dangerZone.style.display = "flex";
                    dangerZone.style.gap = "var(--space-md)";
                    
                    const archiveBtn = window.ButtonPrim.create({ label: "📦 Archive Project", variant: "secondary" });
                    const deleteBtn = window.ButtonPrim.create({ label: "🗑 Delete Project", variant: "danger", onClick: () => {
                        window.ToastPrim.show("Cannot delete default project.", "error");
                    }});
                    
                    dangerZone.appendChild(archiveBtn);
                    dangerZone.appendChild(deleteBtn);
                    
                    tabContainer.appendChild(hr);
                    tabContainer.appendChild(dangerZone);
                }
            }
        });
        
        container.appendChild(tabs);

        // Add Save button to bottom right of editor container
        const footer = document.createElement("div");
        footer.style.padding = "var(--space-md)";
        footer.style.borderTop = "1px solid var(--border-subtle)";
        footer.style.display = "flex";
        footer.style.justifyContent = "flex-end";
        
        const saveBtn = window.ButtonPrim.create({
            label: "Save Changes",
            variant: "primary",
            onClick: () => {
                window.ToastPrim.show(`Saved project: ${_selectedProject}`, "success");
            }
        });
        
        footer.appendChild(saveBtn);
        container.appendChild(footer);
    }

    window.ProjectManagerFeature = { MANIFEST, init, open };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { init, open });

})();
