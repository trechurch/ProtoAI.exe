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
  function wizInput(id) { return qs(`#wiz-${id}`); }
  function mainInput(id) { return qs(`#${id}`); }

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
    // API keys — read from wizard input during wizard, main panel during settings
    const getWizKey = (id) => (wizInput(id)?.value || "").trim();
    const getMainKey = (id) => (mainInput(id)?.value || "").trim();

    // Prefer wizard input values if the wizard overlay is visible
    return {
      version: 1,
      apiKeys: {
        anthropic: getWizKey("apiKey-anthropic") || getMainKey("apiKey-anthropic"),
        openai: getWizKey("apiKey-openai") || getMainKey("apiKey-openai"),
        openrouter: getWizKey("apiKey-openrouter") || getMainKey("apiKey-openrouter"),
      },
      models: {
        enabled: qsa(".model-cb:checked").map(cb => cb.value),
        defaults: {
          default: qs("#defaultModelSelect")?.value || "qwen/qwen3.6-plus:free",
          coding: qs("#codingModelSelect")?.value || "anthropic/claude-3.5-sonnet",
        },
        failoverList: qsa(".failover-cb:checked").map(cb => cb.value),
      },
      profiles: {
        defaultProfile: qs("#defaultProfile")?.value || "default",
        fallbackProfile: qs("#fallbackProfile")?.value || "analysis",
      },
      ingestion: {
        maxDepth: Math.max(1, Math.min(10, parseInt(qs("#maxDepth")?.value || "4", 10) || 4)),
        maxFileSizeMB: Math.max(1, Math.min(100, parseInt(qs("#maxFileSizeMB")?.value || "10", 10) || 10)),
        supportedExtensions: qsa(".ext-cb:checked").map(cb => cb.value),
      },
      backend: {
        timeoutMs: Math.max(5000, Math.min(120000, parseInt(qs("#timeoutMs")?.value || "30000", 10) || 30000)),
        retryCount: Math.max(0, Math.min(10, parseInt(qs("#retryCount")?.value || "3", 10) || 3)),
      },
      spellcheck: { enabled: !!(qs("#spellcheckEnabled")?.checked) },
      advanced: { debugLogging: !!(qs("#debugLogging")?.checked) },
      firstRunCompleted: _settings?.firstRunCompleted ?? true,
    };
  }

  // ---------------------------------------------------------------------------
  // Populate all UI elements from a settings object
  // ---------------------------------------------------------------------------
  function populateUI(s) {
    if (!s) return;
    // API Keys
    const k = s.apiKeys || {};
    if (mainInput("apiKey-anthropic")) mainInput("apiKey-anthropic").value = k.anthropic || "";
    if (mainInput("apiKey-openai")) mainInput("apiKey-openai").value = k.openai || "";
    if (mainInput("apiKey-openrouter")) mainInput("apiKey-openrouter").value = k.openrouter || "";
    if (wizInput("apiKey-anthropic")) wizInput("apiKey-anthropic").value = k.anthropic || "";
    if (wizInput("apiKey-openai")) wizInput("apiKey-openai").value = k.openai || "";
    if (wizInput("apiKey-openrouter")) wizInput("apiKey-openrouter").value = k.openrouter || "";

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
  // Test API Key — local format check first, then tries Tauri IPC
  // Reads from the wizard input when wizard is visible
  // ---------------------------------------------------------------------------
  async function testApiKey(provider, btn) {
    if (!provider || !btn) return;
    if (btn._testing) return;
    btn._testing = true;

    // Always read from wizard input when testing from wizard
    const input = wizInput(`apiKey-${provider}`) || mainInput(`apiKey-${provider}`);
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
      btn.title = "Sidecar still starting up — you can continue setup and test later in Settings.";
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
    // Show/hide skip button — only skip on step 1-2, not step 3
    const skipBtn = qs("#wizardSkipBtn");
    if (skipBtn) skipBtn.style.display = _wizardStep === WIZARD_TOTAL_STEPS ? "none" : "";
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

    // Mark first-run complete — non-blocking, sidecar may not be ready
    try {
      await window.__TAURI__.core.invoke("settings_complete_first_run", {});
    } catch (_) {}

    // Best-effort save remaining settings (fire-and-forget per key)
    _settings = _pendingSettings;
    _pendingSettings = null;
    applySettingsToApp();

    // Save to backend without blocking — the sidecar may still be starting
    try {
      const toSave = { ..._settings };
      delete toSave.firstRunCompleted; // already saved above
      delete toSave.version;
      for (const key of Object.keys(toSave)) {
        if (key === "firstRunCompleted" || key === "version") continue;
        try {
          await window.__TAURI__.core.invoke("settings_set", { key, value: _settings[key] });
        } catch (_) {}
      }
    } catch (_) {}

    // Close wizard and proceed to main app immediately
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

    // Test key buttons — register on ALL matching elements
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

    // Wizard overlay — don't allow closing by clicking outside
    const wizOverlay = qs("#wizardOverlay");
    if (wizOverlay) {
      wizOverlay.addEventListener("click", (e) => {
        // Prevent click-through on wizard overlay
        e.stopPropagation();
      });
    }
  }

  function doExportSettings() {
    if (!_settings || Object.keys(_settings).length === 0) return;
    const safeSettings = JSON.parse(JSON.stringify(_settings));
    delete safeSettings.version;
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
