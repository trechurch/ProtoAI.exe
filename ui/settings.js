// settings.js — Settings Dashboard + First-Run Wizard
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let _settings = null;
  let _pendingSettings = null;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function qs(sel) { return document.querySelector(sel); }
  function qsa(sel) { return document.querySelectorAll(sel); }

  // Unified backend caller — Tauri IPC only
  async function callTauri(cmd, args) {
    if (cmd === "settings_get") {
      return await window.__TAURI__.core.invoke("settings_get", {});
    }
    if (cmd === "settings_set") {
      return await window.__TAURI__.core.invoke("settings_set", { key: args.key, value: args.value });
    }
    if (cmd === "settings_test_key") {
      return await window.__TAURI__.core.invoke("settings_test_key", { provider: args.provider, key: args.key });
    }
    if (cmd === "settings_first_run_status") {
      return await window.__TAURI__.core.invoke("settings_first_run_status", {});
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Load / Save
  // ---------------------------------------------------------------------------
  async function loadSettings() {
    try {
      _settings = await callTauri("settings_get", {});
      return _settings;
    } catch (e) {
      console.error("[Settings] Failed to load settings:", e);
      _settings = {};
      return _settings;
    }
  }

  async function saveSettings() {
    try {
      _pendingSettings = readAllFromUI();
      for (const key of Object.keys(_pendingSettings)) {
        if (key === "version") continue;
        await callTauri("settings_set", { key, value: _pendingSettings[key] });
      }
      _settings = _pendingSettings;
      _pendingSettings = null;
      applySettingsToApp();
      if (typeof showToast === "function") {
        showToast("Settings saved");
      }
    } catch (e) {
      console.error("[Settings] Failed to save:", e);
      if (typeof showToast === "function") {
        showToast("Failed to save settings: " + e.message);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Read all settings from UI elements
  // ---------------------------------------------------------------------------
  function readAllFromUI() {
    // API keys — prefer main settings panel values, fall back to wizard inputs
    const keyVal = (id) => (qs("#" + id)?.value || "").trim() || (qs("#wiz-" + id)?.value || "").trim() || "";
    const apiKeys = {
      anthropic: keyVal("apiKey-anthropic"),
      openai: keyVal("apiKey-openai"),
      openrouter: keyVal("apiKey-openrouter"),
    };
    const models = {
      enabled: qsa(".model-cb:checked").map(cb => cb.value),
      defaults: {
        default: qs("#defaultModelSelect")?.value || "qwen/qwen3.6-plus:free",
        coding: qs("#codingModelSelect")?.value || "anthropic/claude-3.5-sonnet",
      },
      failoverList: qsa(".failover-cb:checked").map(cb => cb.value),
    };
    const profiles = {
      defaultProfile: qs("#defaultProfile")?.value || "default",
      fallbackProfile: qs("#fallbackProfile")?.value || "analysis",
    };
    const ingestion = {
      maxDepth: Math.max(1, Math.min(10, parseInt(qs("#maxDepth")?.value || "4", 10) || 4)),
      maxFileSizeMB: Math.max(1, Math.min(100, parseInt(qs("#maxFileSizeMB")?.value || "10", 10) || 10)),
      supportedExtensions: qsa(".ext-cb:checked").map(cb => cb.value),
    };
    const backend = {
      timeoutMs: Math.max(5000, Math.min(120000, parseInt(qs("#timeoutMs")?.value || "30000", 10) || 30000)),
      retryCount: Math.max(0, Math.min(10, parseInt(qs("#retryCount")?.value || "3", 10) || 3)),
    };
    const spellcheck = { enabled: !!(qs("#spellcheckEnabled")?.checked) };
    const advanced = { debugLogging: !!(qs("#debugLogging")?.checked) };
    return {
      version: 1,
      apiKeys, models, profiles, ingestion, backend, spellcheck, advanced,
      firstRunCompleted: _settings?.firstRunCompleted ?? true,
    };
  }

  // ---------------------------------------------------------------------------
  // Populate all UI elements from a settings object
  // ---------------------------------------------------------------------------
  function populateUI(s) {
    if (!s) return;
    // API Keys — both main panel and wizard inputs
    if (qs("#apiKey-anthropic")) qs("#apiKey-anthropic").value = s.apiKeys?.anthropic || "";
    if (qs("#apiKey-openai")) qs("#apiKey-openai").value = s.apiKeys?.openai || "";
    if (qs("#apiKey-openrouter")) qs("#apiKey-openrouter").value = s.apiKeys?.openrouter || "";
    if (qs("#wiz-apiKey-anthropic")) qs("#wiz-apiKey-anthropic").value = s.apiKeys?.anthropic || "";
    if (qs("#wiz-apiKey-openai")) qs("#wiz-apiKey-openai").value = s.apiKeys?.openai || "";
    if (qs("#wiz-apiKey-openrouter")) qs("#wiz-apiKey-openrouter").value = s.apiKeys?.openrouter || "";

    // Models
    const enabled = new Set((s.models?.enabled) || []);
    const modelDefs = [
      "anthropic/claude-3.5-sonnet", "anthropic/claude-opus-4.1",
      "openai/gpt-4o-mini", "qwen/qwen3.6-plus:free",
    ];
    const listDiv = qs("#modelList");
    if (listDiv) {
      listDiv.innerHTML = "";
      modelDefs.forEach(m => {
        const lbl = document.createElement("label");
        lbl.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:13px;color:var(--text,#ccc);";
        lbl.innerHTML = `<input type="checkbox" class="model-cb" value="${m}" ${enabled.has(m) ? "checked" : ""} /> ${m}`;
        listDiv.appendChild(lbl);
      });
    }
    if (qs("#defaultModelSelect")) {
      qs("#defaultModelSelect").innerHTML = modelDefs.map(m =>
        `<option value="${m}" ${(s.models?.defaults?.default) === m ? "selected" : ""}>${m}</option>`
      ).join("");
    }
    if (qs("#codingModelSelect")) {
      qs("#codingModelSelect").innerHTML = modelDefs.map(m =>
        `<option value="${m}" ${(s.models?.defaults?.coding) === m ? "selected" : ""}>${m}</option>`
      ).join("");
    }
    // Failover list
    const failoverModels = [
      "qwen/qwen3.6-plus:free",
      "qwen/qwen-2-7b-instruct:free",
      "openai/gpt-4o-mini",
      "anthropic/claude-3.5-sonnet",
    ];
    const failoverDiv = qs("#failoverCheckboxes");
    if (failoverDiv) {
      failoverDiv.innerHTML = "";
      failoverDiv.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;";
      const failoverSet = new Set(s.models?.failoverList || []);
      failoverModels.forEach(m => {
        const lbl = document.createElement("label");
        lbl.style.cssText = "font-size:12px;color:#999;display:flex;align-items:center;gap:2px;";
        lbl.innerHTML = `<input type="checkbox" class="failover-cb" value="${m}" ${failoverSet.has(m) ? "checked" : ""} /> ${m}`;
        failoverDiv.appendChild(lbl);
      });
    }

    // Profiles
    if (qs("#defaultProfile")) qs("#defaultProfile").value = s.profiles?.defaultProfile || "default";
    if (qs("#fallbackProfile")) qs("#fallbackProfile").value = s.profiles?.fallbackProfile || "analysis";

    // Ingestion
    if (qs("#spellcheckEnabled")) qs("#spellcheckEnabled").checked = !!(s.spellcheck?.enabled);

    // Advanced
    if (qs("#debugLogging")) qs("#debugLogging").checked = !!(s.advanced?.debugLogging);
  }

  // ---------------------------------------------------------------------------
  // Apply settings to main app (model selects)
  // ---------------------------------------------------------------------------
  function applySettingsToApp() {
    const allSelects = [];
    const main = qs("#engineSelect");
    if (main) allSelects.push(main);
    const side = qs("#otfmsEngineSelect");
    if (side) allSelects.push(side);

    const enabled = new Set((_settings?.models?.enabled) || []);
    const fallbacks = ["anthropic/claude-3.5-sonnet", "anthropic/claude-opus-4.1", "openai/gpt-4o-mini", "qwen/qwen3.6-plus:free"];
    const models = enabled.size > 0 ? [...enabled] : fallbacks;

    allSelects.forEach(sel => {
      const cur = sel.value;
      sel.innerHTML = models.map(m =>
        `<option value="${m}" ${m === cur ? "selected" : ""}>${m}</option>`
      ).join("");
    });
  }

  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Test API Key — local format check, then tries Tauri IPC if available
  // ---------------------------------------------------------------------------
  async function testApiKey(provider, btn) {
    if (!provider || !btn) return;
    if (btn._testing) return;
    btn._testing = true;

    const input = qs(`#wiz-apiKey-${provider}`) || qs(`#apiKey-${provider}`);
    if (!input) { btn._testing = false; return; }
    const key = (input.value || "").trim();
    const originalText = btn.textContent;

    if (!key) {
      btn.textContent = "empty";
      btn.style.color = "#fbbf24";
      setTimeout(() => { btn.textContent = originalText; btn.style.color = ""; btn._testing = false; }, 1500);
      return;
    }

    // Local key format validation — instant feedback without sidecar
    const keyPrefixes = {
      anthropic: ["sk-ant-"],
      openai: ["sk-"],
      openrouter: ["sk-or-"],
    };
    const prefixes = keyPrefixes[provider] || [];
    if (prefixes.length > 0 && !prefixes.some(p => key.startsWith(p))) {
      btn.textContent = "format?";
      btn.style.color = "#fbbf24";
      btn.title = `Key doesn't look like a ${provider} key. Should start with ${prefixes.join(" or ")}`;
      setTimeout(() => { btn.textContent = originalText; btn.style.color = ""; btn.title = ""; btn._testing = false; }, 3000);
      return;
    }

    // Full validation via sidecar
    btn.textContent = "...";
    btn.disabled = true;

    let result = null;
    try {
      result = await window.__TAURI__.core.invoke("settings_test_key", { provider, key });
    } catch (e) {
      // Sidecar not ready yet
      btn.textContent = "waiting";
      btn.style.color = "#fbbf24";
      btn.title = "Sidecar still starting up — try again in a moment.";
      setTimeout(() => { btn.textContent = originalText; btn.style.color = ""; btn.disabled = false; btn.title = ""; btn._testing = false; }, 3000);
      return;
    }

    if (result && result.ok) {
      btn.textContent = "OK";
      btn.style.color = "#4ade80";
    } else if (result) {
      btn.textContent = "Fail";
      btn.style.color = "#f87171";
      btn.title = result.error || "Validation failed";
    } else {
      btn.textContent = "Err";
      btn.style.color = "#fbbf24";
      btn.title = "Could not reach backend";
    }

    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.color = "";
      btn.disabled = false;
      btn.title = "";
      btn._testing = false;
    }, 4000);
  }

  // ---------------------------------------------------------------------------
  // Settings Panel
  // ---------------------------------------------------------------------------
  function openSettingsPanel() {
    const overlay = qs("#settingsOverlay");
    if (!overlay) return;
    overlay.classList.remove("hidden");
    loadSettings().then(s => {
      _settings = s;
      populateUI(s);
      applySettingsToApp();
    }).catch(e => console.error("[Settings] open panel error:", e));
  }

  function closeSettingsPanel() {
    const overlay = qs("#settingsOverlay");
    if (overlay) overlay.classList.add("hidden");
  }

  window.openSettingsPanel = openSettingsPanel;
  window.closeSettingsPanel = closeSettingsPanel;

  // ---------------------------------------------------------------------------
  // First-Run Wizard
  // ---------------------------------------------------------------------------
  let _wizardStep = 1;
  const WIZARD_TOTAL_STEPS = 3;

  function openFirstRunWizard() {
    const overlay = qs("#wizardOverlay");
    if (!overlay) return;
    _wizardStep = 1;
    overlay.classList.remove("hidden");
    updateWizardStep();
    loadSettings().catch(() => { _settings = {}; }).then(s => {
      _settings = s || {};
      populateUI(s || _settings);
    });
  }

  function closeFirstRunWizard() {
    const overlay = qs("#wizardOverlay");
    if (overlay) overlay.classList.add("hidden");
  }

  function updateWizardStep() {
    qsa(".wizard-step").forEach(el => el.classList.remove("active"));
    const step = qs(`#wizardStep${_wizardStep}`);
    if (step) step.classList.add("active");
    qsa(".wizard-dot").forEach((d, i) => {
      d.classList.toggle("active", i === _wizardStep - 1);
    });
    const backBtn = qs("#wizardBackBtn");
    if (backBtn) backBtn.style.visibility = _wizardStep === 1 ? "hidden" : "visible";
    const nextBtn = qs("#wizardNextBtn");
    if (nextBtn) nextBtn.textContent = _wizardStep === WIZARD_TOTAL_STEPS ? "Launch ProtoAI" : "Next";
  }

  function wizardNext() {
    if (_wizardStep < WIZARD_TOTAL_STEPS) {
      _wizardStep++;
      updateWizardStep();
    } else {
      completeWizard();
    }
  }

  function wizardBack() {
    if (_wizardStep > 1) {
      _wizardStep--;
      updateWizardStep();
    }
  }

  async function completeWizard() {
    _pendingSettings = readAllFromUI();
    _pendingSettings.firstRunCompleted = true;

    // Non-blocking: mark first-run complete via Rust (doesn't depend on sidecar)
    try {
      await window.__TAURI__.core.invoke("settings_complete_first_run", {});
    } catch (_) {}

    // Best-effort save remaining settings (sidecar may not be ready yet)
    try {
      for (const key of Object.keys(_pendingSettings)) {
        if (key === "version" || key === "firstRunCompleted") continue;
        await window.__TAURI__.core.invoke("settings_set", { key, value: _pendingSettings[key] });
      }
    } catch (_) {}

    _settings = _pendingSettings;
    _pendingSettings = null;
    applySettingsToApp();
    closeFirstRunWizard();

    if (typeof init === "function") {
      try { init(); } catch (_) {}
    }
  }

  window.openFirstRunWizard = openFirstRunWizard;
  window.closeFirstRunWizard = closeFirstRunWizard;
  window.wizardNext = wizardNext;
  window.wizardBack = wizardBack;
  window.testApiKey = testApiKey;
  window.saveSettings = saveSettings;

  // ---------------------------------------------------------------------------
  // DOM init — register all event handlers
  // ---------------------------------------------------------------------------
  function setupSettingsPanel() {
    // Nav tabs
    qsa(".settings-nav-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const section = btn.dataset.section;
        qsa(".settings-nav-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        qsa(".settings-section").forEach(s => s.classList.remove("active"));
        const target = qs(`#settings-${section}`);
        if (target) target.classList.add("active");
      });
    });

    // Settings header close
    const closeBtn = qs("#settingsCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", closeSettingsPanel);

    // Save / Cancel
    const saveBtn = qs("#settingsSaveBtn");
    if (saveBtn) saveBtn.addEventListener("click", saveSettings);
    const cancelBtn = qs("#settingsCancelBtn");
    if (cancelBtn) cancelBtn.addEventListener("click", closeSettingsPanel);

    // Wizard navigation
    const nextBtn = qs("#wizardNextBtn");
    if (nextBtn) nextBtn.addEventListener("click", wizardNext);
    const backBtn = qs("#wizardBackBtn");
    if (backBtn) backBtn.addEventListener("click", wizardBack);
    const skipBtn = qs("#wizardSkipBtn");
    if (skipBtn) skipBtn.addEventListener("click", completeWizard);

    // Test key buttons — register on ALL matching elements (main panel + wizard)
    qsa(".test-key-btn").forEach(btn => {
      const provider = btn.dataset.provider;
      if (provider) {
        btn.addEventListener("click", () => testApiKey(provider, btn));
      }
    });

    // Export settings
    const exportBtn = qs("#exportSettingsBtn");
    if (exportBtn) exportBtn.addEventListener("click", () => {
      if (!_settings || Object.keys(_settings).length === 0) {
        loadSettings().then(s => {
          _settings = s;
          doExportSettings();
        });
        return;
      }
      doExportSettings();
    });

    // Import settings
    const importBtn = qs("#importSettingsBtn");
    if (importBtn) importBtn.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.onchange = () => {
        const f = input.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const obj = JSON.parse(reader.result);
            _settings = obj;
            populateUI(obj);
            applySettingsToApp();
            // Also save imported settings to backend
            for (const key of Object.keys(obj)) {
              if (key === "version") continue;
              callTauri("settings_set", { key, value: obj[key] }).catch(() => {});
            }
            if (typeof showToast === "function") showToast("Settings imported and saved");
          } catch (e) {
            if (typeof showToast === "function") showToast("Invalid JSON file");
          }
        };
        reader.readAsText(f);
      };
      input.click();
    });

    // Click outside panel to close (but not clicks on the panel itself)
    const overlay = qs("#settingsOverlay");
    if (overlay) {
      overlay.addEventListener("click", e => {
        if (e.target === overlay) closeSettingsPanel();
      });
    }
    const wizOverlay = qs("#wizardOverlay");
    if (wizOverlay) {
      wizOverlay.addEventListener("click", e => {
        // Don't allow closing wizard by clicking outside — force navigation
      });
    }
  }

  function doExportSettings() {
    if (!_settings || Object.keys(_settings).length === 0) return;
    const safeSettings = JSON.parse(JSON.stringify(_settings));
    delete safeSettings.version; // internal field
    const blob = new Blob([JSON.stringify(safeSettings, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "protoai-settings.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  // Register when DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupSettingsPanel);
  } else {
    setupSettingsPanel();
  }
})();
