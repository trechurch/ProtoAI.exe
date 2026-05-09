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
                    if (field.type === "custom-local-ai-setup") {
                        const fieldEl = form._sdoaGetField(field.id);
                        if (fieldEl) {
                            fieldEl.innerHTML = "";
                            _renderLocalAiSetup(fieldEl);
                        }
                    }

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
     * Renders the Local AI setup panel — status badge, progress display,
     * setup button, and CUDA toggle. Polls /local_ai_status every 2s while
     * a provision is running so the UI stays live without a page reload.
     */
    function _renderLocalAiSetup(container) {
        let _pollTimer   = null;
        let _useCuda     = false;

        const panel = document.createElement("div");
        panel.className = "sdoa-local-ai-panel";
        panel.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:16px;">

                <!-- Status card -->
                <div id="lai-status-card" style="
                    padding:16px; border-radius:8px;
                    background:rgba(0,0,0,0.25);
                    border:1px solid var(--border-subtle);
                    display:flex; align-items:center; gap:12px;">
                    <div id="lai-badge" style="
                        width:12px; height:12px; border-radius:50%;
                        background:var(--text-dim); flex-shrink:0;"></div>
                    <div style="flex:1;">
                        <div id="lai-status-label" style="font-weight:600; font-size:13px;">Checking status…</div>
                        <div id="lai-status-sub"   style="font-size:12px; color:var(--text-dim); margin-top:2px;"></div>
                    </div>
                    <div id="lai-model-tag" style="
                        font-size:11px; padding:2px 8px; border-radius:12px;
                        background:rgba(255,255,255,0.07); color:var(--text-dim);
                        display:none;">Qwen2.5-Omni-7B</div>
                </div>

                <!-- Progress (hidden until setup running) -->
                <div id="lai-progress-section" style="display:none; flex-direction:column; gap:8px;">
                    <div style="display:flex; justify-content:space-between; font-size:12px; color:var(--text-dim);">
                        <span id="lai-progress-label">Preparing…</span>
                        <span id="lai-progress-step"></span>
                    </div>
                    <div style="height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden;">
                        <div id="lai-progress-bar" style="
                            height:100%; width:0%; border-radius:3px;
                            background:var(--accent);
                            transition:width 0.4s ease;"></div>
                    </div>
                    <div id="lai-progress-sub" style="font-size:11px; color:var(--text-dim); font-family:monospace; word-break:break-all; max-height:60px; overflow:hidden;"></div>
                </div>

                <!-- Controls -->
                <div id="lai-controls" style="display:flex; flex-direction:column; gap:10px;">
                    <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">
                        <input type="checkbox" id="lai-cuda-toggle" style="cursor:pointer;" />
                        Use CUDA (GPU acceleration — requires NVIDIA GPU + CUDA 12.1)
                    </label>
                    <div style="display:flex; gap:8px;">
                        <button id="lai-setup-btn" class="sdoa-button sdoa-button--primary sdoa-button--sm" style="display:none;">
                            ⬇ Setup Local AI
                        </button>
                        <button id="lai-test-btn" class="sdoa-button sdoa-button--secondary sdoa-button--sm" style="display:none;">
                            ✓ Test Connection
                        </button>
                    </div>
                    <p style="font-size:11px; color:var(--text-dim); margin:0;">
                        First-time setup downloads ~4 GB of Python packages and ~15 GB of model weights from HuggingFace.
                        Your internet connection and disk space should be sufficient before proceeding.
                    </p>
                </div>

            </div>
        `;

        container.appendChild(panel);

        // ── Element refs ──────────────────────────────────────
        const badge         = panel.querySelector("#lai-badge");
        const statusLabel   = panel.querySelector("#lai-status-label");
        const statusSub     = panel.querySelector("#lai-status-sub");
        const modelTag      = panel.querySelector("#lai-model-tag");
        const progressSec   = panel.querySelector("#lai-progress-section");
        const progressLabel = panel.querySelector("#lai-progress-label");
        const progressStep  = panel.querySelector("#lai-progress-step");
        const progressBar   = panel.querySelector("#lai-progress-bar");
        const progressSub   = panel.querySelector("#lai-progress-sub");
        const cudaToggle    = panel.querySelector("#lai-cuda-toggle");
        const setupBtn      = panel.querySelector("#lai-setup-btn");
        const testBtn       = panel.querySelector("#lai-test-btn");

        // ── Helpers ───────────────────────────────────────────
        const setBadge = (color) => badge.style.background = color;
        const COLORS   = { idle: "var(--text-dim)", running: "#f59e0b", done: "#22c55e", error: "#ef4444" };

        function _applyStatus(s) {
            if (!s) return;
            setBadge(COLORS[s.state] || COLORS.idle);

            if (s.state === "idle") {
                statusLabel.textContent = "Not installed";
                statusSub.textContent   = "Run Setup Local AI to install Qwen2.5-Omni-7B.";
                setupBtn.style.display  = "inline-flex";
                testBtn.style.display   = "none";
                progressSec.style.display = "none";
                modelTag.style.display    = "none";

            } else if (s.state === "running") {
                statusLabel.textContent   = "Installing…";
                statusSub.textContent     = "";
                setupBtn.style.display    = "none";
                testBtn.style.display     = "none";
                progressSec.style.display = "flex";
                modelTag.style.display    = "none";
                if (s.label) progressLabel.textContent = s.label;
                if (s.step)  progressStep.textContent  = `Step ${s.step} of ${s.total || 5}`;
                if (s.sub)   progressSub.textContent   = s.sub;
                const pct = Math.max(((s.step - 1) / (s.total || 5)) * 100, s.pct || 0);
                progressBar.style.width = pct + "%";
                _startPolling();

            } else if (s.state === "done") {
                statusLabel.textContent   = "Ready";
                statusSub.textContent     = `Model: ${s.model || "Qwen2.5-Omni-7B"}`;
                setupBtn.style.display    = "none";
                testBtn.style.display     = "inline-flex";
                progressSec.style.display = "none";
                modelTag.style.display    = "inline-block";
                progressBar.style.width   = "100%";
                setBadge(COLORS.done);
                _stopPolling();

            } else if (s.state === "error") {
                statusLabel.textContent   = "Setup failed";
                statusSub.textContent     = s.error || "Unknown error.";
                setupBtn.style.display    = "inline-flex";
                testBtn.style.display     = "none";
                progressSec.style.display = "none";
                modelTag.style.display    = "none";
                _stopPolling();
            }
        }

        // ── Polling ───────────────────────────────────────────
        function _startPolling() {
            if (_pollTimer) return;
            _pollTimer = setInterval(_pollStatus, 2000);
        }
        function _stopPolling() {
            clearInterval(_pollTimer);
            _pollTimer = null;
        }
        async function _pollStatus() {
            try {
                const res = await window.backendConnector?.runWorkflow("local_ai_status", {});
                _applyStatus(res?.data || res);
            } catch (_) {}
        }

        // ── Buttons ───────────────────────────────────────────
        cudaToggle.addEventListener("change", () => { _useCuda = cudaToggle.checked; });

        setupBtn.addEventListener("click", async () => {
            setupBtn.disabled = true;
            setupBtn.textContent = "Starting…";
            try {
                const res = await window.backendConnector?.runWorkflow("provision", {
                    model: "Qwen/Qwen2.5-Omni-7B",
                    cuda:  _useCuda,
                });
                if (res?.started === false) {
                    window.ToastPrim?.show(res.reason || "Could not start setup.", "error");
                    setupBtn.disabled = false;
                    setupBtn.textContent = "⬇ Setup Local AI";
                } else {
                    _applyStatus({ state: "running", step: 1, total: 5, label: "Starting setup…" });
                    _startPolling();
                }
            } catch (err) {
                window.ToastPrim?.show("Setup failed to start: " + err.message, "error");
                setupBtn.disabled = false;
                setupBtn.textContent = "⬇ Setup Local AI";
            }
        });

        testBtn.addEventListener("click", async () => {
            testBtn.disabled = true;
            testBtn.textContent = "Testing…";
            try {
                const res = await window.backendConnector?.runWorkflow("local_ai_health", {});
                const health = res?.data || res;
                if (health?.ok && health?.ready) {
                    window.ToastPrim?.show(`Local AI is healthy on ${health.device || "CPU"}.`, "success");
                } else if (health?.ok && !health?.ready) {
                    window.ToastPrim?.show("Server is up but model is still loading — try again shortly.", "info");
                } else {
                    window.ToastPrim?.show("Server not responding. Launch ProtoAI to start it.", "error");
                }
            } catch (err) {
                window.ToastPrim?.show("Health check failed: " + err.message, "error");
            } finally {
                testBtn.disabled = false;
                testBtn.textContent = "✓ Test Connection";
            }
        });

        // ── Initial status check ──────────────────────────────
        (async () => {
            try {
                // Check provision status first
                const statusRes = await window.backendConnector?.runWorkflow("local_ai_status", {});
                const status    = statusRes?.data || statusRes;
                if (status?.state && status.state !== "idle") {
                    _applyStatus(status);
                    return;
                }
                // Then check if server is already live
                const healthRes = await window.backendConnector?.runWorkflow("local_ai_health", {});
                const health    = healthRes?.data || healthRes;
                if (health?.ok) {
                    _applyStatus({ state: "done", model: health.model || "Qwen2.5-Omni-7B" });
                } else {
                    _applyStatus({ state: "idle" });
                }
            } catch (_) {
                _applyStatus({ state: "idle" });
            }
        })();
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
                // Route through the "settings" IPC handler → settingsManager.importAll()
                await window.backendConnector.runWorkflow("settings", { action: "set", value: settings });
            }
            window.StateStore?.set("settings", settings);
            window.ToastPrim.show("Settings saved. Changes apply immediately.", "success");
            // Broadcast so any module can hot-apply without a reload
            window.EventBus?.emit("settings:changed", { settings });
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
