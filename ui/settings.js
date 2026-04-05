// settings.js — Settings Dashboard + First-Run Wizard
(function () {
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

  async function callTauri(cmd, args) {
    if (TAURI_AVAILABLE) {
      return window.__TAURI__.core.invoke(cmd, args);
    }
    // HTTP fallback
    if (cmd === "settings_get") {
      const r = await fetch(`${HTTP_BASE}/settings`);
      return (await r.json()).settings;
    }
    if (cmd === "settings_set") {
      await fetch(`${HTTP_BASE}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set", key: args.key, value: args.value }),
      });
      return _pendingSettings;
    }
    if (cmd === "settings_test_key") {
      const r = await fetch(`${HTTP_BASE}/settings/test-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: args.provider, key: args.key }),
      });
      return await r.json();
    }
    if (cmd === "settings_first_run_status") {
      // fallback: assume first run
      return { firstRunCompleted: false };
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Load / Save
  // ---------------------------------------------------------------------------
  async function loadSettings() {
    _settings = await callTauri("settings_get", {});
    return _settings;
  }

  async function saveSettings() {
    _pendingSettings = readAllFromUI();
    for (const key of Object.keys(_pendingSettings)) {
      if (key === "version") continue;
      await callTauri("settings_set", { key, value: _pendingSettings[key] });
    }
    if (typeof showToast === "function") showToast("Settings saved");
    _settings = _pendingSettings;
    _pendingSettings = null;
    applySettingsToApp();
  }

  function readAllFromUI() {
    // API keys: read from settings panel first, fall back to wizard inputs
    const apiKeyVal = (id) => qs("#" + id)?.value || qs("#wiz-" + id)?.value || "";
    const apiKeys = {
      anthropic: apiKeyVal("apiKey-anthropic"),
      openai: apiKeyVal("apiKey-openai"),
      openrouter: apiKeyVal("apiKey-openrouter"),
    };
    const models = {
      enabled: qsa(".model-cb:checked").map(cb => cb.value),
      defaults: {
        default: qs("#defaultModelSelect")?.value || apiKeys.anthropic ? "anthropic/claude-3.5-sonnet" : "qwen/qwen3.6-plus:free",
        coding: qs("#codingModelSelect")?.value || "",
      },
    };
    const profiles = {
      defaultProfile: qs("#defaultProfile")?.value || "default",
      fallbackProfile: qs("#fallbackProfile")?.value || "analysis",
    };
    const ingestion = {
      maxDepth: parseInt(qs("#maxDepth")?.value || "4", 10),
      maxFileSizeMB: parseInt(qs("#maxFileSizeMB")?.value || "10", 10),
      supportedExtensions: qsa(".ext-cb:checked").map(cb => cb.value),
    };
    const backend = {
      timeoutMs: parseInt(qs("#timeoutMs")?.value || "30000", 10),
      retryCount: parseInt(qs("#retryCount")?.value || "3", 10),
      fallbackBehavior: qs("#fallbackBehavior")?.value || "http",
    };
    const spellcheck = { enabled: !!(qs("#spellcheckEnabled")?.checked) };
    const advanced = { debugLogging: !!(qs("#debugLogging")?.checked) };
    return {
      version: 1,
      apiKeys, models, profiles, ingestion, backend, spellcheck, advanced,
      firstRunCompleted: _settings?.firstRunCompleted ?? true,
    };
  }

  function populateUI(s) {
    if (!s) return;
    // API Keys
    if (qs("#apiKey-anthropic")) qs("#apiKey-anthropic").value = (s.apiKeys?.anthropic) || "";
    if (qs("#apiKey-openai")) qs("#apiKey-openai").value = (s.apiKeys?.openai) || "";
    if (qs("#apiKey-openrouter")) qs("#apiKey-openrouter").value = (s.apiKeys?.openrouter) || "";

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

    // Profiles
    if (qs("#defaultProfile")) qs("#defaultProfile").value = (s.profiles?.defaultProfile) || "default";
    if (qs("#fallbackProfile")) qs("#fallbackProfile").value = (s.profiles?.fallbackProfile) || "analysis";

    // Ingestion
    if (qs("#maxDepth")) qs("#maxDepth").value = (s.ingestion?.maxDepth) || 4;
    if (qs("#maxFileSizeMB")) qs("#maxFileSizeMB").value = (s.ingestion?.maxFileSizeMB) || 10;
    const exts = [".js", ".ts", ".py", ".rs", ".go", ".java", ".md", ".txt", ".json", ".html", ".css", ".xml", ".yaml", ".yml", ".sh", ".bat"];
    const extDiv = qs("#extensionCheckboxes");
    if (extDiv) {
      extDiv.innerHTML = "";
      const supported = new Set((s.ingestion?.supportedExtensions) || [".js", ".ts", ".py", ".rs", ".go", ".md", ".txt", ".json", ".html", ".css"]);
      extDiv.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;";
      exts.forEach(e => {
        const lbl = document.createElement("label");
        lbl.style.cssText = "font-size:11px;color:#999;display:flex;align-items:center;gap:2px;";
        lbl.innerHTML = `<input type="checkbox" class="ext-cb" value="${e}" ${supported.has(e) ? "checked" : ""} /> ${e}`;
        extDiv.appendChild(lbl);
      });
    }

    // Backend
    if (qs("#timeoutMs")) qs("#timeoutMs").value = (s.backend?.timeoutMs) || 30000;
    if (qs("#retryCount")) qs("#retryCount").value = (s.backend?.retryCount) || 3;
    if (qs("#fallbackBehavior")) qs("#fallbackBehavior").value = (s.backend?.fallbackBehavior) || "http";

    // Spellcheck
    if (qs("#spellcheckEnabled")) qs("#spellcheckEnabled").checked = !!(s.spellcheck?.enabled);

    // Advanced
    if (qs("#debugLogging")) qs("#debugLogging").checked = !!(s.advanced?.debugLogging);
  }

  function applySettingsToApp() {
    // Replace model selects in main UI
    const allSelects = [qs("#engineSelect")];
    const sideSelect = qs("#otfmsEngineSelect");
    if (sideSelect) allSelects.push(sideSelect);

    const enabled = new Set((_settings?.models?.enabled) || []);
    const fallbacks = ["anthropic/claude-3.5-sonnet", "anthropic/claude-opus-4.1", "openai/gpt-4o-mini", "qwen/qwen3.6-plus:free"];
    const models = enabled.size > 0 ? [...enabled] : fallbacks;

    allSelects.forEach(sel => {
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = models.map(m =>
        `<option value="${m}" ${m === cur ? "selected" : ""}>${m}</option>`
      ).join("");
    });
  }

  // ---------------------------------------------------------------------------
  // Test API Key
  // ---------------------------------------------------------------------------
  async function testApiKey(provider, btn) {
    const input = qs(`#apiKey-${provider}`);
    if (!input) return;
    const key = input.value.trim();
    if (!key) {
      if (input.nextElementSibling) input.nextElementSibling.textContent = "(empty)";
      return;
    }
    const originalText = btn.textContent;
    btn.textContent = "...";
    btn.disabled = true;
    try {
      const result = await callTauri("settings_test_key", { provider, key });
      if (result.ok) {
        btn.textContent = "OK";
        btn.style.color = "#4ade80";
      } else {
        btn.textContent = "Fail";
        btn.style.color = "#f87171";
        btn.title = result.error || "";
      }
    } catch (e) {
      btn.textContent = "Err";
      btn.style.color = "#fbbf24";
    }
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.color = "";
      btn.disabled = false;
      btn.title = "";
    }, 3000);
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
    });
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
    loadSettings().then(s => { _settings = s; populateUI(s); });
  }

  function closeFirstRunWizard() {
    const overlay = qs("#wizardOverlay");
    if (overlay) overlay.classList.add("hidden");
  }

  function updateWizardStep() {
    qsa(".wizard-step").forEach(el => el.classList.remove("active"));
    const step = qs(`#wizardStep${_wizardStep}`);
    if (step) step.classList.add("active");
    // Update dots
    qsa(".wizard-dot").forEach((d, i) => {
      d.classList.toggle("active", i === _wizardStep - 1);
    });
    // Button state
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
    // Save settings
    _pendingSettings = readAllFromUI();
    _pendingSettings.firstRunCompleted = true;
    for (const key of Object.keys(_pendingSettings)) {
      if (key === "version") continue;
      await callTauri("settings_set", { key, value: _pendingSettings[key] });
    }
    _settings = _pendingSettings;
    _pendingSettings = null;
    applySettingsToApp();
    closeFirstRunWizard();
  }

  window.openFirstRunWizard = openFirstRunWizard;
  window.closeFirstRunWizard = closeFirstRunWizard;
  window.wizardNext = wizardNext;
  window.wizardBack = wizardBack;
  window.testApiKey = testApiKey;
  window.saveSettings = saveSettings;

  // ---------------------------------------------------------------------------
  // DOM init on load
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

    // Close button
    const closeBtn = qs("#settingsCloseBtn");
    if (closeBtn) closeBtn.addEventListener("click", closeSettingsPanel);

    // Save / Cancel
    const saveBtn = qs("#settingsSaveBtn");
    if (saveBtn) saveBtn.addEventListener("click", saveSettings);
    const cancelBtn = qs("#settingsCancelBtn");
    if (cancelBtn) cancelBtn.addEventListener("click", closeSettingsPanel);

    // Wizard buttons
    const nextBtn = qs("#wizardNextBtn");
    if (nextBtn) nextBtn.addEventListener("click", wizardNext);
    const backBtn = qs("#wizardBackBtn");
    if (backBtn) backBtn.addEventListener("click", wizardBack);
    const skipBtn = qs("#wizardSkipBtn");
    if (skipBtn) skipBtn.addEventListener("click", completeWizard);

    // Test key buttons
    qsa(".test-key-btn").forEach(btn => {
      btn.addEventListener("click", () => testApiKey(btn.dataset.provider, btn));
    });

    // Export / Import
    const exportBtn = qs("#exportSettingsBtn");
    if (exportBtn) exportBtn.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(_settings, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "protoai-settings.json";
      a.click();
      URL.revokeObjectURL(a.href);
    });
    const importBtn = qs("#importSettingsBtn");
    if (importBtn) {
      importBtn.addEventListener("click", () => {
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
              if (typeof showToast === "function") showToast("Settings imported");
            } catch (e) {
              if (typeof showToast === "function") showToast("Invalid JSON file");
            }
          };
          reader.readAsText(f);
        };
        input.click();
      });
    }

    // Auto-save on change for settings values (debounced)
    let saveTimer;
    ["apiKey-anthropic", "apiKey-openai", "apiKey-openrouter", "maxDepth", "maxFileSizeMB", "timeoutMs", "retryCount"].forEach(id => {
      const el = qs("#" + id);
      if (!el) return;
      el.addEventListener("input", () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {}, 1000); // visual debounce only; actual save on button click
      });
    });
  }

  // Register when DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupSettingsPanel);
  } else {
    setupSettingsPanel();
  }
})();
