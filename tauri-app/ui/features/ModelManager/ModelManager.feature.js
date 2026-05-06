// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// ModelManager.feature.js — SDOA v4 Feature | v4.0.0 | layer 1
// Replaces ModelManager.ui.js. Manages AI models & archetypes.
// ============================================================

(function () {
    "use strict";

    const MANIFEST = {
        id: "ModelManager.feature", type: "feature", layer: 1,
        runtime: "Browser", version: "4.0.0",
        requires: ["Modal.prim", "TabGroup.prim", "Form.prim", "Button.prim", "Toast.prim"],
        dataFiles: [],
        lifecycle: ["init"],
        actions: { commands: { open: {}, activateArchetype: {}, getActiveModels: {} }, events: { archetypeActivated: {}, inventoryReordered: {}, policyUpdated: {} }, accepts: {}, slots: {} },
        backendDeps: ["get_model_inventory", "save_model_inventory"],
        docs: { description: "Model inventory manager and archetype profile system.", author: "ProtoAI team", sdoa: "4.0.0" }
    };

    // ── CATEGORIES & DEFAULTS ────────────────────────────────
    const CATEGORIES = [
        { id: "chat",         label: "💬 Chat",         color: "#60a5fa" },
        { id: "coding",       label: "💻 Coding",       color: "#34d399" },
        { id: "research",     label: "🔎 Research",     color: "#a78bfa" },
        { id: "reasoning",    label: "🧠 Reasoning",    color: "#f59e0b" },
        { id: "image",        label: "🖼 Image",        color: "#f472b6" },
        { id: "video",        label: "🎬 Video",        color: "#fb923c" },
        { id: "audio",        label: "🎵 Audio",        color: "#38bdf8" },
        { id: "music",        label: "🎼 Music",        color: "#c084fc" },
        { id: "experimental", label: "🧪 Experimental", color: "#6ee7b7" },
        { id: "assistant",    label: "🤖 Assistant",    color: "#94a3b8" },
        { id: "router",       label: "🔀 Router",       color: "#71717a" },
    ];
    const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

    let _models = [];
    let _archetypes = [];
    let _activeArchetype = null;
    let _modal = null;
    let _editModal = null;
    let _draggedIndex = null;

    async function init() {
        // Expose to window for backwards compat with anything still calling window.modelManager
        window.modelManager = { activateArchetype, getActiveModels };
        
        // Add open button logic to toolbar or settings area
        const btn = document.getElementById("openModelsButton");
        if (btn) btn.addEventListener("click", open);
    }

    async function open() {
        await _loadState();

        _modal = window.ModalPrim.create({
            title: "Model Manager",
            size: "xl",
            onClose: () => { _modal = null; }
        });

        _modal._sdoaBody.style.padding = "0";

        // Build TabGroup
        const tabsData = [
            { id: "archetypes", label: "🎭 Archetypes" },
            ...CATEGORIES
        ];

        const tabs = window.TabGroupPrim.create({
            variant: "horizontal",
            tabs: tabsData,
            renderTab: (tabId, container) => {
                container.classList.add("mm-root");
                const content = document.createElement("div");
                content.className = "mm-content";
                
                if (tabId === "archetypes") {
                    _renderArchetypes(content);
                } else {
                    _renderInventory(content, tabId);
                }
                
                container.appendChild(content);
            }
        });

        _modal._sdoaBody.appendChild(tabs);
        window.ModalPrim.open(_modal);
    }

    function _renderArchetypes(content) {
        content.innerHTML = `
            <div class="mm-archetype-header">
                <p style="font-size:12px;color:var(--text-dim,#666);margin:0 0 12px;">
                    Select an archetype to activate its persona and model routing preferences.
                    The active archetype's models will be used for all AI requests.
                </p>
            </div>
            <div class="mm-archetype-grid" id="mmArchetypeGrid"></div>
        `;

        const grid = content.querySelector("#mmArchetypeGrid");

        _archetypes.forEach(arch => {
            const isActive = _activeArchetype === arch.id;
            const card = document.createElement("div");
            card.className = `mm-archetype-card ${isActive ? "active" : ""}`;
            
            const primaryPreview = (arch.primaryModels || []).slice(0, 3)
                .map(m => `<span class="mm-model-chip">${m.split("/").pop()}</span>`).join("");

            card.innerHTML = `
                <div class="mm-card-emoji">${arch.emoji || "🤖"}</div>
                <div class="mm-card-name">${arch.name}</div>
                <div class="mm-card-desc">${arch.description}</div>
                <div class="mm-card-voice" style="font-size:11px;color:var(--text-dim,#666);margin:4px 0 8px;font-style:italic;">
                    ${arch.voice}
                </div>
                <div class="mm-card-models">${primaryPreview}</div>
                ${isActive ? `<div class="mm-card-active-badge">✓ Active</div>` : `<div class="mm-card-activate-btn-container"></div>`}
            `;

            if (!isActive) {
                const btnContainer = card.querySelector(".mm-card-activate-btn-container");
                const activateBtn = window.ButtonPrim.create({
                    label: "Activate",
                    variant: "secondary",
                    size: "sm",
                    onClick: async (e) => {
                        e.stopPropagation();
                        await activateArchetype(arch.id);
                        _renderArchetypes(content); // re-render grid to update badge
                    }
                });
                activateBtn.style.marginTop = "8px";
                activateBtn.style.width = "100%";
                btnContainer.appendChild(activateBtn);
            }

            grid.appendChild(card);
        });
    }

    function _renderInventory(content, categoryId) {
        const categoryModels = _models.filter(m => m.category === categoryId);
        const cat = CATEGORY_MAP[categoryId];

        content.innerHTML = `
            <div class="mm-inventory-header">
                <span style="font-size:14px;font-weight:600;color:${cat?.color || "#ccc"};">
                    ${cat?.label || categoryId}
                </span>
                <span style="font-size:12px;color:var(--text-dim,#666);margin-left:8px;">
                    ${categoryModels.filter(m => m.active).length} / ${categoryModels.length} active
                </span>
                <div id="mmAddModelContainer" style="margin-left:auto;"></div>
            </div>
            <div class="mm-table" id="mmTable">
                ${categoryModels.length === 0 ? `<div style="padding:20px;color:var(--text-dim,#666);font-size:13px;">No models in this category.</div>` : ""}
            </div>
        `;

        const addBtnContainer = content.querySelector("#mmAddModelContainer");
        const addBtn = window.ButtonPrim.create({ label: "+ Add Model", variant: "secondary", size: "sm", onClick: () => _addModelPrompt(categoryId, content) });
        addBtnContainer.appendChild(addBtn);

        const table = content.querySelector("#mmTable");

        categoryModels.forEach(model => {
            const globalIndex = _models.findIndex(m => m.id === model.id);
            const row = document.createElement("div");
            row.className   = "mm-model-row";
            row.draggable   = true;
            
            row.innerHTML = `
                <div class="mm-drag-handle" title="Drag to reorder">⋮⋮</div>
                <div class="mm-row-toggle-container"></div>
                <span class="mm-model-name ${model.active ? "" : "mm-inactive"}">
                    ${model.name}
                </span>
                <span class="mm-api-badge">${model.api}</span>
                <button class="mm-edit-btn icon-btn" title="Edit">⋯</button>
            `;

            // Wait, we can use Toggle.prim for the switch!
            const toggleContainer = row.querySelector(".mm-row-toggle-container");
            const toggle = window.TogglePrim.create({
                checked: model.active,
                onChange: (checked) => {
                    _models[globalIndex].active = checked;
                    row.querySelector(".mm-model-name").classList.toggle("mm-inactive", !checked);
                    _saveState();
                }
            });
            toggleContainer.appendChild(toggle);

            row.querySelector(".mm-edit-btn").addEventListener("click", () => _openEditModal(globalIndex, content, categoryId));

            // Drag Events
            row.addEventListener("dragstart", e => { _draggedIndex = globalIndex; row.classList.add("mm-dragging"); e.dataTransfer.effectAllowed = "move"; });
            row.addEventListener("dragend", () => { row.classList.remove("mm-dragging"); _draggedIndex = null; });
            row.addEventListener("dragover", e => { e.preventDefault(); row.classList.add("mm-drag-over"); });
            row.addEventListener("dragleave", () => { row.classList.remove("mm-drag-over"); });
            row.addEventListener("drop", e => {
                e.preventDefault();
                row.classList.remove("mm-drag-over");
                if (_draggedIndex === null || _draggedIndex === globalIndex) return;

                const dragged = _models.splice(_draggedIndex, 1)[0];
                const newIdx  = _models.findIndex(m => m.id === model.id);
                _models.splice(newIdx, 0, dragged);

                _saveState();
                _renderInventory(content, categoryId);
            });

            table.appendChild(row);
        });
    }

    function _addModelPrompt(categoryId, content) {
        if (content.querySelector(".mm-add-form")) return;

        const form = document.createElement("div");
        form.className = "mm-add-form";
        
        const sdoaForm = window.FormPrim.create({
            fields: [
                { id: "name", type: "text", placeholder: "provider/model-name" },
                { id: "api", type: "select", options: ["openrouter", "anthropic", "openai", "local"] }
            ],
            submitLabel: "Add",
            onSubmit: (vals) => {
                if (!vals.name) return;
                const id = vals.name.replace(/[^a-z0-9]/gi, "-").toLowerCase() + "-" + Date.now();
                _models.push({ id, name: vals.name, api: vals.api || "openrouter", category: categoryId, active: true });
                _saveState();
                _renderInventory(content, categoryId);
            }
        });
        
        // Form styling tweak to make it inline
        sdoaForm.style.display = "flex";
        sdoaForm.style.flexDirection = "row";
        sdoaForm.style.gap = "8px";
        sdoaForm.style.alignItems = "center";
        
        form.appendChild(sdoaForm);

        const cancelBtn = window.ButtonPrim.create({ label: "Cancel", variant: "secondary", onClick: () => form.remove() });
        form.appendChild(cancelBtn);

        content.querySelector("#mmTable").after(form);
    }

    function _openEditModal(index, contentContainer, categoryId) {
        const m = _models[index];
        
        _editModal = window.ModalPrim.create({
            title: "Edit Model",
            size: "md",
            onClose: () => { _editModal = null; }
        });

        const formValues = { api: m.api, category: m.category, active: m.active };
        
        const form = window.FormPrim.create({
            fields: [
                { type: "heading", label: m.name },
                { id: "api", type: "select", label: "API Source", options: ["openrouter", "anthropic", "openai", "google", "local"] },
                { id: "category", type: "select", label: "Category", options: CATEGORIES.map(c => ({ value: c.id, label: c.label })) },
                { id: "active", type: "toggle", label: "Active" }
            ],
            values: formValues,
            submitLabel: "Save",
            onSubmit: (vals) => {
                _models[index].api = vals.api;
                _models[index].category = vals.category;
                _models[index].active = vals.active;
                _saveState();
                window.ModalPrim.close(_editModal);
                _renderInventory(contentContainer, categoryId);
            }
        });
        
        _editModal._sdoaBody.appendChild(form);
        window.ModalPrim.open(_editModal);
    }

    async function activateArchetype(id) {
        const arch = _archetypes.find(a => a.id === id);
        if (!arch) return;

        _activeArchetype = id;
        
        // Fallback for global
        if (window.llmPolicyEngine) {
            await window.llmPolicyEngine.updatePolicy({ activeArchetype: id, primary: { model: arch.primaryModels?.[0] } });
        }
        
        if (window.ToastPrim) {
            window.ToastPrim.show(`Archetype activated: ${arch.emoji} ${arch.name}`);
        }
        if (window.EventBus) {
            window.EventBus.emit("archetypeActivated", { id, name: arch.name });
        }
        _saveState();
    }

    function getActiveModels() { return _models.filter(m => m.active); }

    async function _loadState() {
        if (!window.backendConnector) return;
        try {
            const saved = await window.backendConnector.runWorkflow("get_model_inventory", {});
            if (saved?.models?.length) _models = saved.models;
            if (saved?.activeArchetype) _activeArchetype = saved.activeArchetype;
            if (saved?.archetypes?.length) _archetypes = saved.archetypes;
        } catch { /* Fallback to defaults */ }
    }

    async function _saveState() {
        if (!window.backendConnector) return;
        try {
            await window.backendConnector.runWorkflow("save_model_inventory", { models: _models, activeArchetype: _activeArchetype });
        } catch { /* Ignore */ }
    }

    window.ModelManagerFeature = { MANIFEST, init, open, activateArchetype, getActiveModels };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { init, open });

})();
