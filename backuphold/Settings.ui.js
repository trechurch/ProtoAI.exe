// ============================================================
// settings.ui.js — Settings Panel + First-Run Wizard
// version: 3.0.1
// Last modified: 2026-05-02 10:00 UTC
// depends: tauri-utils.js, BackendConnector.ui.js
// replaces: settings.js (legacy — retire once confirmed stable)
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    // ── SettingsUI ───────────────────────────────────────────
    // Full settings panel and first-run wizard.
    // Absorbs all functionality from legacy settings.js:
    //   - Settings load/save via Tauri IPC
    //   - All tab sections (API keys, models, profiles,
    //     ingestion, backend, spellcheck, advanced)
    //   - API key format validation + live sidecar test
    //   - Profile and archetype chip population
    //   - Model list, failover list, model import
    //   - Settings export / import (JSON)
    //   - First-run wizard (choice screen + 3 steps)
    //   - applySettingsToApp() engine select sync
    // ── end of SettingsUI ───────────────────────────────────

    // ── SDOA v3.0 MANIFEST ───────────────────────────────────
    const MANIFEST = {
        id:      "SettingsUI",
        type:    "component",
        runtime: "Browser",
        version: "3.0.1",

        // v1.2 fields — always present, never removed
        capabilities: [
            "settings.read",
            "settings.write",
            "settings.export",
            "settings.import",
            "wizard.first-run",
            "apikey.validate",
            "profiles.populate",
            "models.manage"
        ],
        dependencies: [
            "tauri-utils.js",
            "BackendConnector.ui.js"
        ],
        docs: {
            description: "Full settings panel and first-run wizard. Manages all user-configurable settings via Tauri IPC. Provides tab navigation, API key testing, model list management, profile selection, and JSON export/import.",
            input:  {},
            output: "void",
            author: "ProtoAI team",
            sdoa_compatibility: `
                SDOA Compatibility Contract:
                - v1.2 Manifest is minimum requirement (Name/Type/Version/Description/Capabilities/Dependencies/Docs).
                - v2.0 may also read sidecars, hot-reload, version-CLI.
                - v3.0+ may add actions.commands, actions.triggers, actions.emits, actions.workflows.
                - Lower versions MUST ignore unknown/unexpressed fields.
                - Higher versions MUST NOT change meaning of older fields.
                - All versions are backward and forward compatible.
            `
        },

        // v3.0 action surface — additive only
        actions: {
            commands: {
                openSettingsPanel:   { description: "Open the settings overlay.",          input: {}, output: "void" },
                closeSettingsPanel:  { description: "Close the settings overlay.",         input: {}, output: "void" },
                saveSettings:        { description: "Persist current UI values.",          input: {}, output: "void" },
                openFirstRunWizard:  { description: "Open the first-run wizard overlay.",  input: {}, output: "void" },
                closeFirstRunWizard: { description: "Close the first-run wizard overlay.", input: {}, output: "void" },
                testApiKey: {
                    description: "Validate an API key for a provider.",
                    input:  { provider: "string", btn: "DOMElement" },
                    output: "void"
                }
            },
            triggers: {
                settingsSaved:   { description: "Fires when settings are successfully persisted." },
                wizardCompleted: { description: "Fires when the first-run wizard is completed."  }
            },
            emits: {
                settingsLoaded:     { description: "Emits when settings are loaded from backend.", payload: { settings: "object" } },
                settingsSaveFailed: { description: "Emits when a save fails.",                    payload: { error: "string"   } }
            },
            workflows: {
                loadSettings: { description: "Fetch settings from backend.", input: {}, output: "SettingsObject" },
                saveSettings: { description: "Persist settings to backend.", input: { settings: "object" }, output: "void" }
            }
        }
    };
    // ── end of SDOA v3.0 MANIFEST ────────────────────────────

    // ── constants ────────────────────────────────────────────
    const WIZARD_TOTAL_STEPS = 3;
    // ── end of constants ─────────────────────────────────────

    // ── module state ─────────────────────────────────────────
    let _settings        = null;
    let _pendingSettings = null;
    let _profiles        = null;
    let _wizardStep      = 0;
    // ── end of module state ──────────────────────────────────

    // ── DOM helpers ──────────────────────────────────────────
    const qs        = sel => document.querySelector(sel);
    const qsa       = sel => document.querySelectorAll(sel);
    const wizInput  = id  => qs(`#wiz-${id}`);
    const mainInput = id  => qs(`#${id}`);
    // ── end of DOM helpers ───────────────────────────────────

    // ── _callTauri ───────────────────────────────────────────
    // Direct Tauri IPC for settings-specific commands that
    // are not routed through the workflow system.
    // ── end of _callTauri ────────────────────────────────────

    async function _callTauri(cmd, args = {}) {
        const inv = window.__TAURI__?.core?.invoke;
        if (!inv) throw new Error("[SettingsUI] Tauri IPC not available");
        return inv(cmd, args);
    }

    // ── loadSettings ─────────────────────────────────────────

    async function loadSettings() {
        try {
            _settings = await _callTauri("settings_get", {});
            console.info("[SettingsUI] Settings loaded:", _settings);
            return _settings;
        } catch (e) {
            console.error("[SettingsUI] Failed to load settings:", e);
            _settings = {};
            return _settings;
        }
    }

    // ── end of loadSettings ──────────────────────────────────

    // ── saveSettings ─────────────────────────────────────────

    async function saveSettings() {
        try {
            _pendingSettings = _readAllFromUI();

            // Mask keys in debug log
            const masked = JSON.parse(JSON.stringify(_pendingSettings));
            if (masked.apiKeys) {
                for (const provider of Object.keys(masked.apiKeys)) {
                    if (masked.apiKeys[provider]) {
                        masked.apiKeys[provider] = masked.apiKeys[provider].substring(0, 8) + "...";
                    }
                }
            }
            console.info("[SettingsUI] Saving settings:", masked);

            for (const key of Object.keys(_pendingSettings)) {
                if (key === "version") continue;
                await _callTauri("settings_set", { key, value: _pendingSettings[key] });
            }

            _settings        = _pendingSettings;
            _pendingSettings = null;
            applySettingsToApp();

            if (typeof window.showToast === "function") window.showToast("Settings saved");

        } catch (e) {
            console.error("[SettingsUI] Failed to save:", e);
            const msg = e?.message || e?.toString() || "Unknown error";
            if (typeof window.showToast === "function") window.showToast("Failed to save settings: " + msg);
        }
    }

    // ── end of saveSettings ──────────────────────────────────

    // ── _readAllFromUI ───────────────────────────────────────
    // Reads current values from all settings fields.
    // Prefers wizard input values when wizard is visible.
    // ── end of _readAllFromUI ────────────────────────────────

    function _readAllFromUI() {
        const getWizKey  = id => (wizInput(id)?.value  || "").trim();
        const getMainKey = id => (mainInput(id)?.value || "").trim();

        return {
            version: 1,
            apiKeys: {
                anthropic:  getWizKey("apiKey-anthropic")  || getMainKey("apiKey-anthropic"),
                openai:     getWizKey("apiKey-openai")      || getMainKey("apiKey-openai"),
                openrouter: getWizKey("apiKey-openrouter")  || getMainKey("apiKey-openrouter"),
            },
            models: {
                enabled: Array.from(qsa(".model-cb:checked")).map(cb => cb.value),
                defaults: {
                    default: qs("#defaultModelSelect")?.value || "qwen/qwen-2.5-coder-32b-instruct:free",
                    coding:  qs("#codingModelSelect")?.value  || "qwen/qwen-2.5-coder-32b-instruct:free",
                },
                failoverList: Array.from(qsa(".failover-cb:checked")).map(cb => cb.value),
            },
            profiles: Object.assign({}, _settings?.profiles || {}, {
                defaultProfile:  qs("#defaultProfile")?.value  || "default",
                fallbackProfile: qs("#fallbackProfile")?.value || "analysis",
            }),
            ingestion: {
                maxDepth:            Math.max(1, Math.min(10,  parseInt(qs("#maxDepth")?.value      || "4",     10) || 4)),
                maxFileSizeMB:       Math.max(1, Math.min(100, parseInt(qs("#maxFileSizeMB")?.value || "10",    10) || 10)),
                supportedExtensions: Array.from(qsa(".ext-cb:checked")).map(cb => cb.value),
            },
            backend: {
                timeoutMs:  Math.max(5000, Math.min(120000, parseInt(qs("#timeoutMs")?.value  || "30000", 10) || 30000)),
                retryCount: Math.max(0,    Math.min(10,     parseInt(qs("#retryCount")?.value || "3",     10) || 3)),
            },
            spellcheck: { enabled: !!(qs("#spellcheckEnabled")?.checked) },
            advanced:   { debugLogging: !!(qs("#debugLogging")?.checked) },
            routing: {
                mode:          qs("#routingModeMulti")?.checked ? "multi" : "single",
                lockedModel:   qs("#lockedModelSelect")?.value || "",
                orchTimeoutMs: Math.max(10000, Math.min(300000, parseInt(qs("#orchTimeoutMs")?.value  || "120000", 10) || 120000)),
                orchConcurrency: Math.max(1, Math.min(8, parseInt(qs("#orchConcurrency")?.value || "3", 10) || 3)),
                orchStopOnFirst:   !!(qs("#orchStopOnFirst")?.checked),
                orchTickerEnabled: !!(qs("#orchTickerEnabled")?.checked),
            },
            firstRunCompleted: _settings?.firstRunCompleted ?? true,
        };
    }

    // ── populateUI ───────────────────────────────────────────
    // Pushes a settings object into all known UI fields.
    // ── end of populateUI ────────────────────────────────────

    function _attachAllHelp() {
        if (!window.attachHelp || !window.GLOBAL_HELP) return;
        Object.keys(window.GLOBAL_HELP).forEach(id => {
            window.attachHelp(id, window.GLOBAL_HELP[id]);
        });
    }

    function populateUI(s) {
        if (!s) return;

        // Attach help to elements after population
        setTimeout(_attachAllHelp, 0);

        // ── API keys ─────────────────────────────────────────
        const k = s.apiKeys || {};
        ["anthropic", "openai", "openrouter"].forEach(provider => {
            const val  = k[provider] || "";
            const main = mainInput(`apiKey-${provider}`);
            const wiz  = wizInput(`apiKey-${provider}`);
            if (main) main.value = val;
            if (wiz)  wiz.value  = val;
            // Indicators get initial state from stored test results; live keyInfo updates below
            _renderKeyIndicator(provider, { saved: !!val }, s.apiKeyStatus?.[provider] || null);
        });

        // Fetch live key-save status (detects secret.key for OpenRouter)
        _callTauri("settings", { action: "keyInfo" })
            .then(info => {
                if (!info?.providers) return;
                ["anthropic", "openai", "openrouter"].forEach(provider => {
                    const p = info.providers[provider];
                    if (p) _renderKeyIndicator(provider, { saved: p.saved, secretKey: p.secretKey }, p.status);
                });
            })
            .catch(() => {/* sidecar may still be starting — indicators stay as-is */});
        // ── end of API keys ───────────────────────────────────

        // ── models ───────────────────────────────────────────
        const enabled = new Set(s.models?.enabled || []);
        let modelList = (s.models?.enabled || []).filter(Boolean);
        if (modelList.length === 0) {
            modelList = [
                s.models?.defaults?.coding  || "qwen/qwen-2.5-coder-32b-instruct:free",
                s.models?.defaults?.default || "qwen/qwen-2.5-coder-32b-instruct:free",
                "openai/gpt-oss-120b:free",
                "google/gemini-2.0-flash-exp:free"
            ].filter(Boolean);
        }
        modelList = [...new Set(modelList)];

        const listDiv = qs("#modelList");
        if (listDiv) {
            listDiv.innerHTML = "";
            modelList.forEach(m => {
                const lbl = document.createElement("label");
                lbl.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:13px;color:var(--text,#ccc);";
                lbl.innerHTML = `<input type="checkbox" class="model-cb" value="${m}" ${enabled.has(m) ? "checked" : ""} /> ${m}`;
                listDiv.appendChild(lbl);
            });
        }
        if (qs("#defaultModelSelect")) {
            qs("#defaultModelSelect").innerHTML = modelList.map(m =>
                `<option value="${m}" ${s.models?.defaults?.default === m ? "selected" : ""}>${m}</option>`
            ).join("");
        }
        if (qs("#codingModelSelect")) {
            qs("#codingModelSelect").innerHTML = modelList.map(m =>
                `<option value="${m}" ${s.models?.defaults?.coding === m ? "selected" : ""}>${m}</option>`
            ).join("");
        }

        const failoverModels = (s.models?.failoverList || []).filter(Boolean);
        const failoverDiv    = qs("#failoverCheckboxes");
        if (failoverDiv) {
            failoverDiv.innerHTML = "";
            failoverDiv.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;";
            const failoverSet  = new Set(s.models?.failoverList || []);
            const modelsToShow = failoverModels.length > 0 ? failoverModels : [
                s.models?.defaults?.coding  || "anthropic/claude-3.5-sonnet",
                s.models?.defaults?.default || "anthropic/claude-3.5-sonnet",
                "openai/gpt-4o-mini"
            ];
            modelsToShow.forEach(m => {
                const lbl = document.createElement("label");
                lbl.style.cssText = "font-size:12px;color:#999;display:flex;align-items:center;gap:2px;";
                lbl.innerHTML = `<input type="checkbox" class="failover-cb" value="${m}" ${failoverSet.has(m) ? "checked" : ""} /> ${m}`;
                failoverDiv.appendChild(lbl);
            });
        }
        // ── end of models ─────────────────────────────────────

        _populateProfileSelects(s);

        if (qs("#spellcheckEnabled")) qs("#spellcheckEnabled").checked = !!(s.spellcheck?.enabled);
        if (qs("#debugLogging"))      qs("#debugLogging").checked      = !!(s.advanced?.debugLogging);
        if (qs("#maxDepth"))          qs("#maxDepth").value            = s.ingestion?.maxDepth      ?? 4;
        if (qs("#maxFileSizeMB"))     qs("#maxFileSizeMB").value       = s.ingestion?.maxFileSizeMB ?? 10;
        if (qs("#timeoutMs"))         qs("#timeoutMs").value           = s.backend?.timeoutMs       ?? 30000;
        if (qs("#retryCount"))        qs("#retryCount").value          = s.backend?.retryCount      ?? 3;

        // ── routing section ──────────────────────────────────
        // Derive mode: prefer saved setting, fall back to localStorage state
        const savedMode = s.routing?.mode || (
            localStorage.getItem("protoai:orchestrator:enabled") === "false" ? "single" : "multi"
        );
        const isSingle = savedMode === "single";
        if (qs("#routingModeSingle")) qs("#routingModeSingle").checked = isSingle;
        if (qs("#routingModeMulti"))  qs("#routingModeMulti").checked  = !isSingle;

        // Populate locked model selector from enabled models
        const lockedSel = qs("#lockedModelSelect");
        if (lockedSel) {
            const modelList = (s.models?.enabled || []).filter(Boolean);
            lockedSel.innerHTML = `<option value="">— use engine dropdown —</option>` +
                modelList.map(m => `<option value="${m}" ${m === (s.routing?.lockedModel || "") ? "selected" : ""}>${m}</option>`).join("");
        }

        if (qs("#orchTimeoutMs"))    qs("#orchTimeoutMs").value           = s.routing?.orchTimeoutMs    ?? 120000;
        if (qs("#orchConcurrency"))  qs("#orchConcurrency").value         = s.routing?.orchConcurrency  ?? 3;
        if (qs("#orchStopOnFirst"))  qs("#orchStopOnFirst").checked       = s.routing?.orchStopOnFirst  ?? true;
        if (qs("#orchTickerEnabled")) qs("#orchTickerEnabled").checked    = s.routing?.orchTickerEnabled ?? true;

        _syncRoutingUI(isSingle);
        // ── end of routing section ───────────────────────────
    }

    // ── _loadProfiles ────────────────────────────────────────

    async function _loadProfiles() {
        try {
            let result = null;
            if (window.__TAURI__?.core?.invoke) {
                result = await window.__TAURI__.core.invoke("run_workflow", {
                    name: "ListProfilesWorkflow", payload: "{}"
                });
                // FIX v3.0.1: Guard against empty-string response before JSON.parse.
                // JSON.parse("") throws SyntaxError: Unexpected end of JSON input.
                if (typeof result === "string") {
                    result = result.trim() ? JSON.parse(result) : null;
                }
            }
            _profiles = result?.data || result || null;
        } catch (e) {
            console.error("[SettingsUI] Failed to load profiles:", e);
            _profiles = null;
        }
        return _profiles;
    }

    // ── _populateProfileSelects ──────────────────────────────

    function _populateProfileSelects(s) {
        const defaultSel       = qs("#defaultProfile");
        const fallbackSel      = qs("#fallbackProfile");
        const archetypeListDiv = qs("#archetypeList");

        // ── Custom Profile Builder ──
        const customProfileSelect    = qs("#customProfileSelect");
        const customProfileArchetype = qs("#customProfileArchetype");
        const customProfileModel     = qs("#customProfileModel");

        if (customProfileArchetype) {
            const archetypes = _profiles?.archetypes || [];
            customProfileArchetype.innerHTML = '<option value="">None (Blank slate)</option>';
            archetypes.forEach(a => {
                const opt = document.createElement("option");
                opt.value = a.id;
                opt.textContent = a.name || a.id;
                customProfileArchetype.appendChild(opt);
            });
        }

        if (customProfileModel) {
            const models = (s?.models?.enabled || []).filter(Boolean);
            customProfileModel.innerHTML = '<option value="">(Use default/archetype model)</option>';
            models.forEach(m => {
                const opt = document.createElement("option");
                opt.value = m;
                opt.textContent = m;
                customProfileModel.appendChild(opt);
            });
        }

        if (customProfileSelect) {
            const userProfiles = s?.profiles?.userProfiles || {};
            const currentlySelected = customProfileSelect.value;
            customProfileSelect.innerHTML = '<option value="new">+ Create New Profile</option>';
            Object.keys(userProfiles).forEach(id => {
                const opt = document.createElement("option");
                opt.value = id;
                opt.textContent = userProfiles[id].name || id;
                customProfileSelect.appendChild(opt);
            });
            if (currentlySelected && currentlySelected !== "new" && userProfiles[currentlySelected]) {
                customProfileSelect.value = currentlySelected;
            } else if (currentlySelected !== "new") {
                customProfileSelect.value = "new";
            }
        }

        const allProfiles = _profiles?.profiles || [
            { id: "default",  name: "Default"  },
            { id: "analysis", name: "Analysis" },
            { id: "coding",   name: "Coding"   },
            { id: "creative", name: "Creative" },
        ];

        const currentDefault  = s?.profiles?.defaultProfile  || "default";
        const currentFallback = s?.profiles?.fallbackProfile || "analysis";

        const makeOption = p => {
            const badge = p.isArchetype ? " [A]" : (p.builtin ? " [B]" : "");
            const opt   = document.createElement("option");
            opt.value       = p.id;
            opt.textContent = (p.name || p.id) + badge;
            return opt;
        };

        if (defaultSel) {
            defaultSel.innerHTML = "";
            allProfiles.forEach(p => {
                const opt = makeOption(p);
                if (p.id === currentDefault) opt.selected = true;
                defaultSel.appendChild(opt);
            });
        }
        if (fallbackSel) {
            fallbackSel.innerHTML = "";
            allProfiles.forEach(p => {
                const opt = makeOption(p);
                if (p.id === currentFallback) opt.selected = true;
                fallbackSel.appendChild(opt);
            });
        }

        if (archetypeListDiv) {
            const archetypes = _profiles?.archetypes || [];
            archetypeListDiv.innerHTML = "";
            archetypes.forEach(a => {
                const chip = document.createElement("button");
                chip.type  = "button";
                chip.title = a.description || a.name;
                chip.style.cssText = [
                    "padding:4px 10px",
                    "border-radius:12px",
                    "border:1px solid #444",
                    "background:" + (currentDefault === a.id ? "#3b82f6" : "#2a2a2a"),
                    "color:"      + (currentDefault === a.id ? "#fff"    : "#ccc"),
                    "font-size:12px",
                    "cursor:pointer"
                ].join(";");
                chip.textContent = a.name || a.id;
                chip.addEventListener("click", () => {
                    if (defaultSel) defaultSel.value = a.id;
                    _populateProfileSelects(Object.assign({}, s, {
                        profiles: Object.assign({}, s?.profiles, { defaultProfile: a.id })
                    }));
                });
                archetypeListDiv.appendChild(chip);
            });
        }
    }

    // ── _updateCustomProfileForm ─────────────────────────────

    function _updateCustomProfileForm(id) {
        const nameInput   = qs("#customProfileName");
        const archSelect  = qs("#customProfileArchetype");
        const systemInput = qs("#customProfileSystem");
        const modelSelect = qs("#customProfileModel");
        const delBtn      = qs("#customProfileDeleteBtn");

        if (!nameInput || !archSelect || !systemInput || !modelSelect || !delBtn) return;

        if (!id || id === "new") {
            nameInput.value   = "";
            archSelect.value  = "";
            systemInput.value = "";
            modelSelect.value = "";
            delBtn.style.display = "none";
        } else {
            const p = (_settings?.profiles?.userProfiles || {})[id];
            if (p) {
                nameInput.value   = p.name || id;
                archSelect.value  = p.archetypeId || "";
                systemInput.value = p.system || "";
                modelSelect.value = p.model || "";
                delBtn.style.display = "block";
            }
        }
    }

    async function _saveCustomProfile() {
        if (!_settings) _settings = {};
        if (!_settings.profiles) _settings.profiles = {};
        if (!_settings.profiles.userProfiles) _settings.profiles.userProfiles = {};

        const idSelect    = qs("#customProfileSelect");
        const nameInput   = qs("#customProfileName");
        const archSelect  = qs("#customProfileArchetype");
        const systemInput = qs("#customProfileSystem");
        const modelSelect = qs("#customProfileModel");

        let id = idSelect?.value;
        const name = (nameInput?.value || "").trim();
        if (!name) {
            if (typeof window.showToast === "function") window.showToast("Profile Name is required.");
            return;
        }

        if (!id || id === "new") {
            id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
            if (!id) id = "custom-" + Date.now();
        }

        const profileData = {
            name: name,
            archetypeId: archSelect?.value || undefined,
            system: systemInput?.value || undefined,
            model: modelSelect?.value || undefined
        };

        // Remove undefined fields
        Object.keys(profileData).forEach(k => profileData[k] === undefined && delete profileData[k]);

        _settings.profiles.userProfiles[id] = profileData;

        try {
            await _callTauri("settings_set", { key: "profiles.userProfiles", value: _settings.profiles.userProfiles });
            if (typeof window.showToast === "function") window.showToast("Profile saved");
            
            // Reload profiles and refresh UI
            await _loadProfiles();
            _populateProfileSelects(_settings);
            if (idSelect) idSelect.value = id;
            _updateCustomProfileForm(id);
        } catch (e) {
            console.error("[SettingsUI] Failed to save profile:", e);
            if (typeof window.showToast === "function") window.showToast("Failed to save profile");
        }
    }

    async function _deleteCustomProfile() {
        const idSelect = qs("#customProfileSelect");
        let id = idSelect?.value;
        if (!id || id === "new") return;

        if (!_settings?.profiles?.userProfiles?.[id]) return;

        delete _settings.profiles.userProfiles[id];

        // If the deleted profile was the default, reset it
        if (_settings.profiles.defaultProfile === id) {
            _settings.profiles.defaultProfile = "default";
        }

        try {
            await _callTauri("settings_set", { key: "profiles", value: _settings.profiles });
            if (typeof window.showToast === "function") window.showToast("Profile deleted");
            
            await _loadProfiles();
            _populateProfileSelects(_settings);
            if (idSelect) idSelect.value = "new";
            _updateCustomProfileForm("new");
        } catch (e) {
            console.error("[SettingsUI] Failed to delete profile:", e);
            if (typeof window.showToast === "function") window.showToast("Failed to delete profile");
        }
    }

    // ── _syncRoutingUI ───────────────────────────────────────
    // Toggles visibility of single vs multi option blocks,
    // the warning banner, and the sidebar quick-toggle buttons.
    // ── end of _syncRoutingUI ────────────────────────────────

    function _syncRoutingUI(isSingle) {
        const singleOpts  = qs("#singleModelOptions");
        const multiOpts   = qs("#multiModelOptions");
        const warning     = qs("#routingTimeoutWarning");
        const singleLabel = qs("#routingModeSingleLabel");
        const multiLabel  = qs("#routingModeMultiLabel");

        if (singleOpts) singleOpts.style.display = isSingle ? "block" : "none";
        if (multiOpts)  multiOpts.style.display  = isSingle ? "none"  : "block";
        if (warning)    warning.style.display     = isSingle ? "none"  : "block";

        const activeStyle   = "background:var(--accent,#3b3bff);";
        const inactiveStyle = "background:var(--bg-elevated,#1a1a2e);";
        if (singleLabel) singleLabel.style.background = isSingle ? "var(--accent-subtle, rgba(108,108,255,0.15))" : "";
        if (multiLabel)  multiLabel.style.background  = isSingle ? "" : "var(--accent-subtle, rgba(108,108,255,0.15))";

        // Sidebar quick-toggle
        const sidebarSingle = qs("#sidebarModeSingle");
        const sidebarMulti  = qs("#sidebarModeMulti");
        const sidebarHint   = qs("#sidebarModeHint");
        const accentBg      = "var(--accent,#3b3bff)";
        const neutralBg     = "var(--bg-elevated,#1a1a2e)";
        if (sidebarSingle) {
            sidebarSingle.style.background = isSingle ? accentBg : neutralBg;
            sidebarSingle.style.color      = isSingle ? "#fff" : "var(--text,#ccc)";
            sidebarSingle.style.fontWeight = isSingle ? "600" : "normal";
        }
        if (sidebarMulti) {
            sidebarMulti.style.background = isSingle ? neutralBg : accentBg;
            sidebarMulti.style.color      = isSingle ? "var(--text,#ccc)" : "#fff";
            sidebarMulti.style.fontWeight = isSingle ? "normal" : "600";
        }
        if (sidebarHint) {
            sidebarHint.textContent = isSingle
                ? "Direct · no orchestrator"
                : "MultiModelSendWorkflow";
        }
    }

    // ── applySettingsToApp ───────────────────────────────────
    // Syncs engine selects with the current enabled model list.
    // Also applies routing mode to localStorage so LlmBridge
    // picks it up immediately without a page reload.
    // Exposed on window for app.js.
    // ── end of applySettingsToApp ────────────────────────────

    function applySettingsToApp() {
        const selects = [qs("#engineSelect"), qs("#otfmsEngineSelect")].filter(Boolean);
        const enabled   = new Set(_settings?.models?.enabled || []);
        const fallbacks = [
            "nvidia/nemotron-3-super-120b-a12b:free",
            "nvidia/nemotron-3-nano-30b-a3b:free",
            "openai/gpt-oss-120b:free"
        ];
        const models = enabled.size > 0 ? [...enabled] : fallbacks;

        selects.forEach(sel => {
            const cur = sel.value;
            sel.innerHTML = models.map(m =>
                `<option value="${m}" ${m === cur ? "selected" : ""}>${m}</option>`
            ).join("");
        });

        // ── apply routing to localStorage ────────────────────
        // LlmBridge.ui._orchestratorEnabled reads this key live.
        const routingMode = _settings?.routing?.mode ?? "single";
        const isSingle    = routingMode !== "multi";
        try {
            localStorage.setItem("protoai:orchestrator:enabled", isSingle ? "false" : "true");
        } catch (_) {}
        _syncRoutingUI(isSingle);

        // If a locked model is set, override the engine dropdown value
        const lockedModel = _settings?.routing?.lockedModel || "";
        if (lockedModel) {
            selects.forEach(sel => { if (sel.querySelector(`option[value="${lockedModel}"]`)) sel.value = lockedModel; });
        }
        // ── end routing apply ─────────────────────────────────

        // ── populate main profile dropdown (#profileSelect) ──
        const profileSel = qs("#profileSelect");
        if (profileSel) {
            const cur = profileSel.value || "default";
            const builtIn = ["default", "coding", "creative", "research", "concise"];
            const userProfiles = Object.keys(_settings?.profiles?.userProfiles || {});
            const all = [...builtIn, ...userProfiles.filter(p => !builtIn.includes(p))];
            profileSel.innerHTML = all.map(p =>
                `<option value="${p}" ${p === cur ? "selected" : ""}>${p.charAt(0).toUpperCase() + p.slice(1)}</option>`
            ).join("");
        }
        // ── end profile dropdown ─────────────────────────────
    }

    // ── _renderKeyIndicator ──────────────────────────────────
    // Renders the status badge for an API key row.
    //   keyState  { saved: bool, secretKey?: bool }
    //   testRecord  null | { ok, testedAt, error?, credits?, balance? }
    function _renderKeyIndicator(provider, keyState, testRecord) {
        const ind = qs(`#apiKey-${provider}-indicator`);
        if (!ind) return;

        // Nothing saved at all
        if (!keyState?.saved) {
            ind.textContent = "○ No key";
            ind.style.color = "#888";
            ind.title       = "";
            return;
        }

        // Key saved — check for a test result
        if (!testRecord) {
            const source = (provider === "openrouter" && keyState.secretKey) ? " (legacy file)" : "";
            ind.textContent = `● Saved${source} — untested`;
            ind.style.color = "#fbbf24";
            ind.title       = "Click Test to verify this key with the live API";
            return;
        }

        // We have a test record
        const when = testRecord.testedAt
            ? new Date(testRecord.testedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
            : "?";

        if (testRecord.ok) {
            let extra = "";
            if (testRecord.credits) {
                const c = testRecord.credits;
                if (c.usage != null) {
                    const usageFmt  = `$${c.usage.toFixed(4)}`;
                    const limitFmt  = c.limit != null ? `/$${c.limit.toFixed(2)}` : "";
                    const tierFmt   = c.is_free_tier === true ? " · free tier" : (c.is_free_tier === false ? " · paid" : "");
                    extra = ` · used ${usageFmt}${limitFmt}${tierFmt}`;
                } else if (c.is_free_tier != null) {
                    extra = c.is_free_tier ? " · free tier" : " · paid";
                }
            }
            ind.textContent = `✓ Verified ${when}${extra}`;
            ind.style.color = "#4ade80";
            ind.title       = testRecord.credits?.label ? `Key label: ${testRecord.credits.label}` : "";
        } else {
            ind.textContent = `✗ Failed ${when}`;
            ind.style.color = "#f87171";
            ind.title       = testRecord.error || "Validation failed";
        }
    }
    // ── end of _renderKeyIndicator ───────────────────────────

    // ── testApiKey ───────────────────────────────────────────

    async function testApiKey(provider, btn) {
        if (!provider || !btn || btn._testing) return;
        btn._testing = true;

        const input = wizInput(`apiKey-${provider}`) || mainInput(`apiKey-${provider}`);
        if (!input) { btn._testing = false; return; }

        const key          = (input.value || "").trim();
        const originalText = btn.textContent;

        // If no key typed but openrouter might have secret.key — allow testing with empty field
        const isOpenRouter = provider === "openrouter";
        if (!key && !isOpenRouter) {
            btn.textContent = "empty";
            btn.style.color = "#fbbf24";
            setTimeout(() => { btn.textContent = originalText; btn.style.color = ""; btn._testing = false; }, 1500);
            return;
        }

        const keyPrefixes = { anthropic: ["sk-ant-"], openai: ["sk-"], openrouter: ["sk-or-"] };
        const prefixes    = keyPrefixes[provider] || [];
        if (key && prefixes.length > 0 && !prefixes.some(p => key.startsWith(p))) {
            btn.textContent = "format?";
            btn.style.color = "#fbbf24";
            btn.title = `Key doesn't look like a ${provider} key. Should start with: ${prefixes.join(" or ")}`;
            setTimeout(() => { btn.textContent = originalText; btn.style.color = ""; btn.title = ""; btn._testing = false; }, 3000);
            return;
        }

        btn.textContent = "testing…";
        btn.disabled    = true;

        let result = null;
        try {
            result = await _callTauri("settings_test_key", { provider, key });
        } catch {
            btn.textContent = "waiting";
            btn.style.color = "#fbbf24";
            btn.title = "Sidecar still starting — test again from Settings later.";
            setTimeout(() => { btn.textContent = originalText; btn.style.color = ""; btn.disabled = false; btn.title = ""; btn._testing = false; }, 3000);
            return;
        }

        // Backend already persisted the result in apiKeyStatus — update indicator now
        // and also sync _settings so future populateUI calls are correct
        if (result) {
            if (!_settings) _settings = {};
            if (!_settings.apiKeyStatus) _settings.apiKeyStatus = {};
            _settings.apiKeyStatus[provider] = result;
            _renderKeyIndicator(provider, { saved: true }, result);
        }

        btn.textContent = result?.ok ? "✓ OK" : (result ? "✗ Fail" : "Err");
        btn.style.color = result?.ok ? "#4ade80" : "#f87171";
        btn.title       = result?.ok ? "" : (result?.error || "Validation failed");

        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.color = "";
            btn.disabled    = false;
            btn.title       = "";
            btn._testing    = false;
        }, 2000);
    }

    // ── end of testApiKey ────────────────────────────────────

    // ── Settings Panel ───────────────────────────────────────

    function openSettingsPanel() {
        const overlay = qs("#settingsOverlay");
        if (!overlay) return;
        overlay.classList.remove("hidden");
        Promise.all([loadSettings(), _loadProfiles()])
            .then(([s]) => { _settings = s; populateUI(s); applySettingsToApp(); })
            .catch(e => console.error("[SettingsUI] openSettingsPanel error:", e));
    }

    function closeSettingsPanel() {
        const overlay = qs("#settingsOverlay");
        if (overlay) overlay.classList.add("hidden");
    }

    // ── end of Settings Panel ────────────────────────────────

    // ── First-Run Wizard ─────────────────────────────────────

    function openFirstRunWizard() {
        const overlay = qs("#wizardOverlay");
        if (!overlay) return;
        _wizardStep = 0;
        overlay.classList.remove("hidden");
        _updateWizardStep();
        loadSettings().catch(() => { _settings = {}; }).then(s => {
            _settings = s || {};
            populateUI(_settings);
        });
        const chooseManual = qs("#wizardChooseManual");
        const chooseSetup  = qs("#wizardChooseSetup");
        if (chooseManual) chooseManual.onclick = () => _completeWizard();
        if (chooseSetup)  chooseSetup.onclick  = () => { _wizardStep = 1; _updateWizardStep(); };
    }

    function closeFirstRunWizard() {
        const overlay = qs("#wizardOverlay");
        if (overlay) overlay.classList.add("hidden");
    }

    function _updateWizardStep() {
        qsa(".wizard-step").forEach(el => el.classList.remove("active"));
        const step = qs(_wizardStep === 0 ? "#wizardStep0" : `#wizardStep${_wizardStep}`);
        if (step) step.classList.add("active");

        const onChoiceScreen = _wizardStep === 0;
        const dots   = qs("#wizardDots");
        const footer = qs("#wizardFooter");
        if (dots)   dots.style.display   = onChoiceScreen ? "none" : "";
        if (footer) footer.style.display = onChoiceScreen ? "none" : "";

        if (!onChoiceScreen) {
            qsa(".wizard-dot").forEach((d, i) => {
                d.classList.toggle("active", i === _wizardStep - 1);
            });
            const backBtn = qs("#wizardBackBtn");
            if (backBtn) backBtn.style.visibility = _wizardStep === 1 ? "hidden" : "visible";
            const nextBtn = qs("#wizardNextBtn");
            if (nextBtn) nextBtn.textContent = _wizardStep === WIZARD_TOTAL_STEPS ? "Launch ProtoAI" : "Next";
            const skipBtn = qs("#wizardSkipBtn");
            if (skipBtn) skipBtn.style.display = _wizardStep === WIZARD_TOTAL_STEPS ? "none" : "";
        }
    }

    function wizardNext() {
        if (_wizardStep < WIZARD_TOTAL_STEPS) { _wizardStep++; _updateWizardStep(); }
        else { _completeWizard(); }
    }

    function wizardBack() {
        if (_wizardStep > 1) { _wizardStep--; _updateWizardStep(); }
    }

    function _completeWizard() {
        // Read synchronously — no async before closing
        _pendingSettings = _readAllFromUI();
        _pendingSettings.firstRunCompleted = true;
        _settings        = _pendingSettings;
        _pendingSettings = null;

        closeFirstRunWizard();
        try { applySettingsToApp(); } catch (_) {}

        if (window.__TAURI__?.core?.invoke) {
            window.__TAURI__.core.invoke("settings_complete_first_run", {}).catch(() => {});
            setTimeout(async () => {
                for (const key of Object.keys(_settings)) {
                    if (key === "version" || key === "firstRunCompleted") continue;
                    try { await window.__TAURI__.core.invoke("settings_set", { key, value: _settings[key] }); }
                    catch (_) {}
                }
                if (typeof window.init === "function") { try { window.init(); } catch (_) {} }
            }, 100);
        } else {
            setTimeout(() => {
                if (typeof window.init === "function") { try { window.init(); } catch (_) {} }
            }, 100);
        }
    }

    // ── end of First-Run Wizard ──────────────────────────────

    // ── export / import ──────────────────────────────────────

    function _doExportSettings() {
        if (!_settings || Object.keys(_settings).length === 0) return;
        const safe = JSON.parse(JSON.stringify(_settings));
        delete safe.version;
        const blob = new Blob([JSON.stringify(safe, null, 2)], { type: "application/json" });
        const a    = document.createElement("a");
        a.href     = URL.createObjectURL(blob);
        a.download = "protoai-settings.json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    }

    function _doImportSettings() {
        const input    = document.createElement("input");
        input.type     = "file";
        input.accept   = ".json";
        input.onchange = () => {
            const f = input.files[0];
            if (!f) return;
            const reader     = new FileReader();
            reader.onload    = () => {
                try {
                    const obj = JSON.parse(reader.result);
                    _settings = obj;
                    populateUI(obj);
                    applySettingsToApp();
                    for (const key of Object.keys(obj)) {
                        if (key === "version") continue;
                        _callTauri("settings_set", { key, value: obj[key] }).catch(() => {});
                    }
                    if (typeof window.showToast === "function") window.showToast("Settings imported and saved");
                } catch {
                    if (typeof window.showToast === "function") window.showToast("Invalid JSON file");
                }
            };
            reader.readAsText(f);
        };
        input.click();
    }

    // ── end of export / import ───────────────────────────────

    function _setupSettingsPanel() {

        qsa(".settings-nav-btn").forEach(btn => {
            btn.addEventListener("click", e => {
                e.stopPropagation();
                const section = btn.dataset.section;
                qsa(".settings-nav-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                qsa(".settings-section").forEach(s => s.classList.remove("active"));
                const target = qs(`#settings-${section}`);
                if (target) {
                    target.classList.add("active");
                    // Refresh help icons for the newly active section
                    setTimeout(_attachAllHelp, 0);
                    if (section === "inventory") {
                        const mmContainer = qs("#modelManagerContainer");
                        if (mmContainer && window.modelManager && !mmContainer.dataset.rendered) {
                            window.modelManager.render(mmContainer);
                            mmContainer.dataset.rendered = "1";
                        }
                    }
                }
            });
        });

        const saveBtn      = qs("#settingsSaveBtn");
        const closeBtn     = qs("#settingsCloseBtn");
        const cancelBtn    = qs("#settingsCancelBtn");
        const overlay      = qs("#settingsOverlay");

        // Custom Profile Builder Events
        const customProfileSelect = qs("#customProfileSelect");
        if (customProfileSelect) {
            customProfileSelect.addEventListener("change", e => _updateCustomProfileForm(e.target.value));
        }
        const customProfileSaveBtn = qs("#customProfileSaveBtn");
        if (customProfileSaveBtn) {
            customProfileSaveBtn.addEventListener("click", e => { e.preventDefault(); _saveCustomProfile(); });
        }
        const customProfileDeleteBtn = qs("#customProfileDeleteBtn");
        if (customProfileDeleteBtn) {
            customProfileDeleteBtn.addEventListener("click", e => { e.preventDefault(); _deleteCustomProfile(); });
        }
        if (closeBtn)  closeBtn.addEventListener("click",  e => { e.stopPropagation(); closeSettingsPanel(); });
        if (saveBtn)   saveBtn.addEventListener("click",   e => { e.stopPropagation(); saveSettings(); });
        if (cancelBtn) cancelBtn.addEventListener("click", e => { e.stopPropagation(); closeSettingsPanel(); });

        const nextBtn = qs("#wizardNextBtn");
        const backBtn = qs("#wizardBackBtn");
        const skipBtn = qs("#wizardSkipBtn");
        if (nextBtn) nextBtn.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); wizardNext(); });
        if (backBtn) backBtn.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); wizardBack(); });
        if (skipBtn) skipBtn.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); _completeWizard(); });

        qsa(".test-key-btn").forEach(btn => {
            const provider = btn.dataset.provider;
            if (provider) btn.addEventListener("click", e => { e.stopPropagation(); testApiKey(provider, btn); });
        });

        const exportBtn = qs("#exportSettingsBtn");
        const importBtn = qs("#importSettingsBtn");
        if (exportBtn) exportBtn.addEventListener("click", e => {
            e.stopPropagation();
            if (!_settings || Object.keys(_settings).length === 0) {
                loadSettings().then(s => { _settings = s; _doExportSettings(); }).catch(() => {});
                return;
            }
            _doExportSettings();
        });
        if (importBtn) importBtn.addEventListener("click", e => { e.stopPropagation(); _doImportSettings(); });

        const modelImportBtn = qs("#modelImportBtn");
        if (modelImportBtn) modelImportBtn.addEventListener("click", e => {
            e.stopPropagation();
            const textarea = qs("#modelImportList");
            const status   = qs("#modelImportStatus");
            if (!textarea) return;
            const raw = textarea.value.trim();
            if (!raw) { if (status) status.textContent = "No models to import"; return; }
            const models = [...new Set(raw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean))];
            if (_settings) {
                _settings.models.enabled      = models;
                const existingFailover        = _settings.models.failoverList || [];
                _settings.models.failoverList = existingFailover.length > 0
                    ? existingFailover
                    : models.slice(0, Math.min(2, models.length));
                if (!_settings.models.defaults?.default) _settings.models.defaults.default = models[0] || "";
                if (!_settings.models.defaults?.coding)  _settings.models.defaults.coding  = models[0] || "";
                populateUI(_settings);
                applySettingsToApp();
                if (status) status.textContent = `Imported ${models.length} models`;
                if (typeof window.showToast === "function") window.showToast(`Imported ${models.length} models`);
                for (const key of Object.keys(_settings)) {
                    if (key === "version") continue;
                    _callTauri("settings_set", { key, value: _settings[key] }).catch(() => {});
                }
            } else {
                if (status) status.textContent = "Settings not loaded yet";
            }
        });

        const wizOverlay = qs("#wizardOverlay");
        if (overlay)    overlay.addEventListener("click",    e => { if (e.target === overlay) closeSettingsPanel(); });
        if (wizOverlay) wizOverlay.addEventListener("click", e => { e.stopPropagation(); });
    }

    window.openSettingsPanel    = openSettingsPanel;
    window.closeSettingsPanel   = closeSettingsPanel;
    window.saveSettings         = saveSettings;
    window.openFirstRunWizard   = openFirstRunWizard;
    window.closeFirstRunWizard  = closeFirstRunWizard;
    window.wizardNext           = wizardNext;
    window.wizardBack           = wizardBack;
    window.testApiKey           = testApiKey;
    window.applySettingsToApp   = applySettingsToApp;
    window.SettingsUI           = { MANIFEST };

    domReady(() => { 
        _setupSettingsPanel(); 
        loadSettings().then(s => { _settings = s || {}; applySettingsToApp(); }).catch(() => {});
    });

})();
