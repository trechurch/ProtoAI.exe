// ============================================================
// Last modified: 2026-05-04 03:11 UTC
// Settings.feature.js — SDOA v4 Feature | v4.0.0 | layer 1
// Replaces Settings.ui.js and the hard-coded HTML modal.
// ============================================================

(function () {
    "use strict";

    const MANIFEST = {
        id: "Settings.feature", type: "feature", layer: 1,
        runtime: "Browser", version: "4.0.0",
        requires: ["Modal.prim", "TabGroup.prim", "Form.prim", "Toast.prim", "Button.prim"],
        dataFiles: ["schemas/settings.schema.json"],
        lifecycle: ["init"],
        actions: { commands: { open: {} }, events: { "settings:saved": {} }, accepts: {}, slots: {} },
        backendDeps: [],
        docs: { description: "Global settings modal using declarative JSON schemas.", author: "ProtoAI team", sdoa: "4.0.0" }
    };

    let _schema = null;
    let _modal = null;

    async function init() {
        try {
            const res = await fetch("/data/schemas/settings.schema.json");
            if (res.ok) _schema = await res.json();
            
            // Wire the main settings button in index.html
            const btn = document.getElementById("openSettingsButton");
            if (btn) btn.addEventListener("click", open);

        } catch (err) {
            console.error("[Settings.feature] Failed to load schema:", err);
        }
    }

    async function open() {
        if (!_schema) {
            window.ToastPrim.show("Settings schema not loaded.", "error");
            return;
        }

        // Fetch current settings from backend or state store
        const currentSettings = window.StateStore?.get("settings") || {};

        // Create Modal
        _modal = window.ModalPrim.create({
            title: "Settings",
            size: "lg",
            onClose: () => { _modal = null; }
        });

        // Create TabGroup
        const tabs = window.TabGroupPrim.create({
            variant: "vertical",
            tabs: _schema.tabs.map(t => ({ id: t.id, label: t.label, icon: t.icon })),
            renderTab: (tabId, container) => {
                const tabData = _schema.tabs.find(t => t.id === tabId);
                if (!tabData) return;

                // Create Form for this tab
                const form = window.FormPrim.create({
                    fields: tabData.fields,
                    values: currentSettings,
                    submitLabel: false, // We use a global save button in the modal footer
                    onChange: (fieldId, val) => {
                        currentSettings[fieldId] = val;
                    }
                });

                // Handle custom field types
                for (const field of tabData.fields) {
                    if (field.type === "custom-profile-manager") {
                        const fieldEl = form._sdoaGetField(field.id);
                        if (fieldEl) {
                            fieldEl.innerHTML = ""; // Clear the default "placeholder" or label
                            _renderProfileManager(fieldEl, currentSettings);
                        }
                    }
                    
                    if (field.action) {
                        const fieldEl = form._sdoaGetField(field.id);
                        if (fieldEl) {
                            const btn = window.ButtonPrim.create({
                                label: field.action.label,
                                size: "sm",
                                variant: "secondary",
                                onClick: () => _handleFieldAction(field.action.id, field.id, currentSettings[field.id])
                            });
                            btn.style.marginTop = "4px";
                            fieldEl.appendChild(btn);
                        }
                    }
                }

                container.appendChild(form);
            }
        });

        _modal._sdoaBody.appendChild(tabs);
        _modal._sdoaBody.style.padding = "0"; // Let tab group dictate padding

        // Add Save button to footer
        _modal._sdoaShowFooter();
        const saveBtn = window.ButtonPrim.create({
            label: "Save Changes",
            variant: "primary",
            onClick: async () => {
                saveBtn._sdoaUpdate({ loading: true });
                await _saveSettings(currentSettings);
                saveBtn._sdoaUpdate({ loading: false });
                window.ModalPrim.close(_modal);
            }
        });
        _modal._sdoaFooter.appendChild(saveBtn);

        window.ModalPrim.open(_modal);
    }

    /**
     * Renders a complex profile management interface inside the settings form.
     */
    function _renderProfileManager(container, settings) {
        if (!settings.profiles) settings.profiles = {};
        if (!settings.profiles.userProfiles) settings.profiles.userProfiles = {};

        const manager = document.createElement("div");
        manager.className = "sdoa-profile-manager";
        manager.innerHTML = `
            <div class="sdoa-input-group">
                <label class="sdoa-input__label">Manage Custom Profiles</label>
                <div style="display:flex; gap:8px;">
                    <select id="profileManagerSelect" class="sdoa-input" style="flex:1;">
                        <option value="">-- Create New --</option>
                    </select>
                </div>
            </div>
            <div id="profileEditor" class="sdoa-profile-editor" style="margin-top:16px; display:none; padding:12px; background:rgba(0,0,0,0.2); border-radius:8px;">
                <div class="sdoa-input-group">
                    <label class="sdoa-input__label">Profile Name</label>
                    <input type="text" id="profName" class="sdoa-input" placeholder="e.g. My Coding Assistant" />
                </div>
                <div class="sdoa-input-group">
                    <label class="sdoa-input__label">Base Archetype</label>
                    <select id="profArchetype" class="sdoa-input"></select>
                </div>
                <div class="sdoa-input-group">
                    <label class="sdoa-input__label">System Prompt Override</label>
                    <textarea id="profSystem" class="sdoa-input" rows="4" placeholder="Additional instructions..."></textarea>
                </div>
                <div class="sdoa-input-group">
                    <label class="sdoa-input__label">Model Override</label>
                    <select id="profModel" class="sdoa-input"></select>
                </div>
                <div style="display:flex; gap:8px; margin-top:16px;">
                    <button id="profSaveBtn" class="sdoa-button sdoa-button--primary sdoa-button--sm">Update Profile</button>
                    <button id="profDeleteBtn" class="sdoa-button sdoa-button--error sdoa-button--sm">Delete</button>
                </div>
            </div>
        `;

        const select = manager.querySelector("#profileManagerSelect");
        const editor = manager.querySelector("#profileEditor");
        const archSelect = manager.querySelector("#profArchetype");
        const modelSelect = manager.querySelector("#profModel");

        // Populate selects
        const updateSelects = () => {
            // Profiles
            select.innerHTML = '<option value="">-- Create New --</option>';
            Object.keys(settings.profiles.userProfiles).forEach(id => {
                const opt = document.createElement("option");
                opt.value = id;
                opt.textContent = settings.profiles.userProfiles[id].name || id;
                select.appendChild(opt);
            });

            // Archetypes
            archSelect.innerHTML = '<option value="">None</option>';
            const archetypes = window.StateStore?.get("archetypes") || [];
            archetypes.forEach(a => {
                const opt = document.createElement("option");
                opt.value = a.id;
                opt.textContent = a.name;
                archSelect.appendChild(opt);
            });

            // Models
            modelSelect.innerHTML = '<option value="">Use Default</option>';
            const models = window.StateStore?.get("models") || [];
            models.forEach(m => {
                const opt = document.createElement("option");
                opt.value = m.id;
                opt.textContent = m.name;
                modelSelect.appendChild(opt);
            });
        };

        const loadProfile = (id) => {
            if (!id) {
                editor.style.display = "block";
                manager.querySelector("#profName").value = "";
                manager.querySelector("#profArchetype").value = "";
                manager.querySelector("#profSystem").value = "";
                manager.querySelector("#profModel").value = "";
                manager.querySelector("#profSaveBtn").textContent = "Create Profile";
                manager.querySelector("#profDeleteBtn").style.display = "none";
                return;
            }
            const p = settings.profiles.userProfiles[id];
            if (!p) return;

            editor.style.display = "block";
            manager.querySelector("#profName").value = p.name || "";
            manager.querySelector("#profArchetype").value = p.archetypeId || "";
            manager.querySelector("#profSystem").value = p.system || "";
            manager.querySelector("#profModel").value = p.model || "";
            manager.querySelector("#profSaveBtn").textContent = "Update Profile";
            manager.querySelector("#profDeleteBtn").style.display = "block";
        };

        select.addEventListener("change", (e) => loadProfile(e.target.value));

        manager.querySelector("#profSaveBtn").addEventListener("click", () => {
            const name = manager.querySelector("#profName").value.trim();
            if (!name) return window.ToastPrim.show("Profile name is required.", "error");

            const id = select.value || name.toLowerCase().replace(/\s+/g, "-");
            settings.profiles.userProfiles[id] = {
                name,
                archetypeId: manager.querySelector("#profArchetype").value,
                system: manager.querySelector("#profSystem").value,
                model: manager.querySelector("#profModel").value
            };
            
            updateSelects();
            select.value = id;
            loadProfile(id);
            window.ToastPrim.show("Profile updated in memory. Remember to Save Changes.", "info");
        });

        manager.querySelector("#profDeleteBtn").addEventListener("click", () => {
            const id = select.value;
            if (id && confirm(`Delete profile "${id}"?`)) {
                delete settings.profiles.userProfiles[id];
                updateSelects();
                select.value = "";
                loadProfile("");
                window.ToastPrim.show("Profile removed. Remember to Save Changes.", "info");
            }
        });

        updateSelects();
        container.appendChild(manager);
    }

    async function _saveSettings(settings) {
        try {
            if (window.backendConnector) {
                await window.backendConnector.runWorkflow("saveSettings", { settings });
            }
            window.StateStore?.set("settings", settings);
            window.ToastPrim.show("Settings saved successfully.", "success");
            if (window.EventBus) window.EventBus.emit("settingsSaved", { settings });
        } catch (err) {
            window.ToastPrim.show("Failed to save settings: " + err.message, "error");
        }
    }

    async function _handleFieldAction(actionId, fieldId, value) {
        if (actionId.startsWith("test-")) {
            const provider = actionId.split("-")[1];
            window.ToastPrim.show(`Testing ${provider} key...`, "info");
            
            // Legacy backend integration for key testing
            try {
                if (window.backendConnector) {
                    const res = await window.backendConnector.runWorkflow("testApiKey", { provider, key: value });
                    if (res?.ok || res === true) {
                        window.ToastPrim.show(`${provider} key is valid!`, "success");
                    } else {
                        throw new Error(res?.error || "Invalid key");
                    }
                }
            } catch (err) {
                window.ToastPrim.show(`${provider} test failed: ` + err.message, "error");
            }
        }
    }

    window.SettingsFeature = { MANIFEST, init, open };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, { init, open });

})();
