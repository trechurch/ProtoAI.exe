// ============================================================
// settings.ui.js — Settings Panel + First-Run Wizard
// version: 3.0.0
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
        version: "3.0.0",

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
            if (typeof window.showToast === "function") window.showToast("Failed to save settings: " + e.message);
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
                    default: qs("#defaultModelSelect")?.value || "qwen/qwen3.6-plus:free",
                    coding:  qs("#codingModelSelect")?.value  || "anthropic/claude-3.5-sonnet",
                },
                failoverList: Array.from(qsa(".failover-cb:checked")).map(cb => cb.value),
            },
            profiles: {
                defaultProfile:  qs("#defaultProfile")?.value  || "default",
                fallbackProfile: qs("#fallbackProfile")?.value || "analysis",
            },
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
            firstRunCompleted: _settings?.firstRunCompleted ?? true,
        };
    }

    // ── populateUI ───────────────────────────────────────────
    // Pushes a settings object into all known UI fields.
    // ── end of populateUI ────────────────────────────────────

    function populateUI(s) {
        if (!s) return;

        // ── API keys ─────────────────────────────────────────
        const k = s.apiKeys || {};
        ["anthropic", "openai", "openrouter"].forEach(provider => {
            const val  = k[provider] || "";
            const main = mainInput(`apiKey-${provider}`);
            const wiz  = wizInput(`apiKey-${provider}`);
            const ind  = qs(`#apiKey-${provider}-indicator`);
            if (main) main.value = val;
            if (wiz)  wiz.value  = val;
            if (ind)  {
                ind.textContent = val ? "● Key is set" : "○ No key";
                ind.style.color = val ? "#4ade80" : "#f87171";
            }
        });
        // ── end of API keys ───────────────────────────────────

        // ── models ───────────────────────────────────────────
        const enabled = new Set(s.models?.enabled || []);
        let modelList = (s.models?.enabled || []).filter(Boolean);
        if (modelList.length === 0) {
            modelList = [
                s.models?.defaults?.coding  || "nvidia/nemotron-3-super-120b-a12b:free",
                s.models?.defaults?.default || "nvidia/nemotron-3-super-120b-a12b:free",
                "nvidia/nemotron-3-nano-30b-a3b:free",
                "openai/gpt-oss-120b:free"
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
    }

    // ── _loadProfiles ────────────────────────────────────────

    async function _loadProfiles() {
        try {
            let result = null;
            if (window.__TAURI__?.core?.invoke) {
                result = await window.__TAURI__.core.invoke("run_workflow", {
                    name: "ListProfilesWorkflow", payload: "{}"
                });
                if (typeof result === "string") result = JSON.parse(result);
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

    // ── applySettingsToApp ───────────────────────────────────
    // Syncs engine selects with the current enabled model list.
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
    }

    // ── testApiKey ───────────────────────────────────────────

    async function testApiKey(provider, btn) {
        if (!provider || !btn || btn._testing) return;
        btn._testing = true;

        const input = wizInput(`apiKey-${provider}`) || mainInput(`apiKey-${provider}`);
        if (!input) { btn._testing = false; return; }

        const key          = (input.value || "").trim();
        const originalText = btn.textContent;

        if (!key) {
            btn.textContent = "empty";
            btn.style.color = "#fbbf24";
            setTimeout(() => { btn.textContent = originalText; btn.style.color = ""; btn._testing = false; }, 1500);
            return;
        }

        const keyPrefixes = { anthropic: ["sk-ant-"], openai: ["sk-"], openrouter: ["sk-or-"] };
        const prefixes    = keyPrefixes[provider] || [];
        if (prefixes.length > 0 && !prefixes.some(p => key.startsWith(p))) {
            btn.textContent = "format?";
            btn.style.color = "#fbbf24";
            btn.title = `Key doesn't look like a ${provider} key. Should start with: ${prefixes.join(" or ")}`;
            setTimeout(() => { btn.textContent = originalText; btn.style.color = ""; btn.title = ""; btn._testing = false; }, 3000);
            return;
        }

        btn.textContent = "...";
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

        if (result?.ok) {
            btn.textContent = "OK";   btn.style.color = "#4ade80";
        } else if (result) {
            btn.textContent = "Fail"; btn.style.color = "#f87171";
            btn.title = result.error || "Validation failed";
        } else {
            btn.textContent = "Err";  btn.style.color = "#fbbf24";
            btn.title = "Could not reach backend";
        }

        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.color = "";
            btn.disabled    = false;
            btn.title       = "";
            btn._testing    = false;
        }, 4000);
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

    // ── _setupSettingsPanel ──────────────────────────────────
    // Registers all event handlers for the settings panel
    // and wizard. Called once on domReady.
    // ── end of _setupSettingsPanel ───────────────────────────

    function _setupSettingsPanel() {

        // Tab navigation
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
                    // Lazy-render ModelManager when Inventory tab opens
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

        // Panel close / save / cancel
        const closeBtn  = qs("#settingsCloseBtn");
        const saveBtn   = qs("#settingsSaveBtn");
        const cancelBtn = qs("#settingsCancelBtn");
        if (closeBtn)  closeBtn.addEventListener("click",  e => { e.stopPropagation(); closeSettingsPanel(); });
        if (saveBtn)   saveBtn.addEventListener("click",   e => { e.stopPropagation(); saveSettings(); });
        if (cancelBtn) cancelBtn.addEventListener("click", e => { e.stopPropagation(); closeSettingsPanel(); });

        // Wizard nav
        const nextBtn = qs("#wizardNextBtn");
        const backBtn = qs("#wizardBackBtn");
        const skipBtn = qs("#wizardSkipBtn");
        if (nextBtn) nextBtn.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); wizardNext(); });
        if (backBtn) backBtn.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); wizardBack(); });
        if (skipBtn) skipBtn.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); _completeWizard(); });

        // Test key buttons
        qsa(".test-key-btn").forEach(btn => {
            const provider = btn.dataset.provider;
            if (provider) btn.addEventListener("click", e => { e.stopPropagation(); testApiKey(provider, btn); });
        });

        // Export / import
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

        // Model import
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

        // Overlay click-to-close
        const overlay    = qs("#settingsOverlay");
        const wizOverlay = qs("#wizardOverlay");
        if (overlay)    overlay.addEventListener("click",    e => { if (e.target === overlay) closeSettingsPanel(); });
        if (wizOverlay) wizOverlay.addEventListener("click", e => { e.stopPropagation(); });
    }

    // ── window exports ───────────────────────────────────────
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
    // ── end of window exports ────────────────────────────────

    // ── auto-init ────────────────────────────────────────────
    domReady(() => { _setupSettingsPanel(); });
    // ── end of auto-init ─────────────────────────────────────

})();
