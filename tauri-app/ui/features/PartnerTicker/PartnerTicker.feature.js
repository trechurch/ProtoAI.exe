/* ============================================================
   PartnerTicker.feature.js — SDOA v4 Feature
   version: 4.1.0
   Last modified: 2026-05-09 04:10 UTC
   ============================================================ */

(function () {
    "use strict";

    const MANIFEST = {
        id: "PartnerTicker.feature", 
        type: "feature", 
        layer: 1,
        runtime: "Browser", 
        version: "4.1.0",
        requires: ["Toast.prim"],
        docs: {
            description: "Silent Partner activity ticker. Displays system events and spontaneous commentary.",
            author: "ProtoAI Team"
        }
    };

    const EVENT_META = {
        "orchestrator:routing":    { icon: "🔀", label: (d) => "routing request…",                     color: "dim"    },
        "orchestrator:routed":     { icon: "✓",  label: (d) => `→ ${d.profile || "default"} (${d.complexity || "?"})`, color: "ok"  },
        "orchestrator:engineering":{ icon: "✏️", label: (d) => "engineering prompt…",                   color: "dim"    },
        "orchestrator:engineered": { icon: "✓",  label: (d) => `optimised ${d.originalLen}→${d.optimizedLen} chars`,   color: "ok"  },
        "orchestrator:watching":   { icon: "👁",  label: (d) => `watching (${d.bufferLen} chars)…`,      color: "dim"    },
        "orchestrator:flagged":    { icon: "⚠",  label: (d) => `flagged: ${(d.flag || "").slice(0,60)}`, color: "warn"   },
        "orchestrator:auditing":   { icon: "🔍", label: (d) => "auditing response…",                    color: "dim"    },
        "orchestrator:audited":    { icon: "✓",  label: (d) => `score ${d.score ?? "?"}/10 — ${(d.note || "").slice(0,40)}`, color: "ok" },
        "orchestrator:commentary_generating": { icon: "💭", label: (d) => `thinking (${d.persona})…`, color: "dim" },
        "orchestrator:commentary": { icon: "💬", label: (d) => d.text, color: "persona" },
        "orchestrator:error":      { icon: "✗",  label: (d) => `[${d.stage}] ${(d.message||"").slice(0,60)}`, color: "err" },
        "local:modelLoaded":       { icon: "🧠", label: (d) => "local model ready",                     color: "ok"     },
        "route_error":             { icon: "✗",  label: (d) => `route error: ${(d.error||"").slice(0,50)}`, color: "err" },
        "audit_error":             { icon: "✗",  label: (d) => `audit error: ${(d.error||"").slice(0,50)}`, color: "err" },
    };

    const STORAGE_ENABLED = "protoai:orchestrator:enabled";
    const STORAGE_TOGGLES = "protoai:ticker:toggles";
    const STORAGE_STATE   = "protoai:ticker:state";
    const STORAGE_PERSONA = "sdoa.pt.persona";
    const STORAGE_PULSE   = "sdoa.pt.pulse_freq";

    let _container    = null;
    let _log          = [];
    let _tickerItems  = [];
    let _state        = localStorage.getItem(STORAGE_STATE) || "locked";
    let _persona      = localStorage.getItem(STORAGE_PERSONA) || "advisor";
    let _pulseFreq    = parseInt(localStorage.getItem(STORAGE_PULSE) || "10", 10); // Default 10 mins
    let _hoverTimer   = null;
    let _heartbeatTimer = null;
    let _toggles      = _loadToggles();

    function _loadToggles() { try { return JSON.parse(localStorage.getItem(STORAGE_TOGGLES) || "{}"); } catch (_) { return {}; } }
    function _saveToggles() { localStorage.setItem(STORAGE_TOGGLES, JSON.stringify(_toggles)); }
    function _isEnabled()   { return localStorage.getItem(STORAGE_ENABLED) !== "false"; }

    const FEATURES = [
        { key: "route",    label: "Route" },
        { key: "engineer", label: "Engineer" },
        { key: "watch",    label: "Watch" },
        { key: "audit",    label: "Audit" },
    ];

    async function init() {
        console.log(`[PartnerTicker.feature] Initializing v${MANIFEST.version}...`);
        window.PartnerTicker = { pushEvent, playback, render: mount }; // Compatibility
    }

    async function mount(container) {
        _container = container;
        if (!_container) return;
        _container.innerHTML = "";
        _container.className = "partner-ticker";
        _container.innerHTML = `
            <div class="pt-strip" title="Click to open · Double-click to close">
                <span class="pt-dot" id="ptDot"></span>
                <div class="pt-strip-text">waiting…</div>
            </div>
            <div class="pt-panel ${_state === "minimized" ? "hidden" : ""}"></div>
        `;

        if (_state !== "minimized") _renderPanel();
        _wireInteractions();
        _wireBusEvents();
        _startPulse();
        _startHeartbeat();
    }

    function pushEvent(type, data = {}) {
        console.log(`[PartnerTicker] Pushing event: ${type}`, data);
        const meta = EVENT_META[type] || { icon: "·", label: () => type, color: "dim" };
        const entry = { type, data, icon: meta.icon, text: meta.label(data), color: meta.color, ts: Date.now() };
        _log.push(entry);
        if (_log.length > 100) _log.shift();
        _tickerItems.push(entry);
        if (_tickerItems.length > 20) _tickerItems.shift();
        _updateTickerStrip();
        if (_state !== "minimized") _renderPanel();
    }

    function playback(events = []) {
        let delay = 0;
        for (const ev of events) {
            const type = ev.type.startsWith("orchestrator:") ? ev.type : `orchestrator:${ev.type}`;
            setTimeout(() => pushEvent(type, ev.data || {}), delay);
            delay += 220;
        }
    }

    function _updateTickerStrip() {
        if (!_container) return;
        const strip = _container.querySelector(".pt-strip-text");
        if (!strip) return;
        const recent = _tickerItems.slice(-6).reverse();
        if (recent.length === 0) {
            strip.textContent = _isEnabled() ? "waiting…" : "partner offline";
            return;
        }
        strip.innerHTML = recent.map(e => `<span class="pt-item pt-${e.color}">${e.icon} ${_esc(e.text)}</span>`).join('<span class="pt-sep">  ·  </span>');
    }

    function _renderPanel() {
        const panel = _container?.querySelector(".pt-panel");
        if (!panel) return;
        const enabled = _isEnabled();
        const recent  = _log.slice(-12).reverse();

        panel.innerHTML = `
            <div class="pt-panel-header">
                <span class="pt-panel-title">🤖 Local Partner</span>
                <label class="pt-master-toggle">
                    <input type="checkbox" ${enabled ? "checked" : ""} id="ptMasterToggle"/>
                    <span>${enabled ? "active" : "offline"}</span>
                </label>
            </div>
            <div class="pt-panel-log">
                ${recent.length === 0 ? `<div class="pt-log-empty">No activity yet</div>` : recent.map(e => `
                    <div class="pt-log-row ${e.type === "orchestrator:commentary" ? "pt-commentary-row" : ""}">
                        <span class="pt-log-icon">${e.icon}</span>
                        <span class="pt-log-text pt-${e.color}">${_esc(e.text)}</span>
                        <span class="pt-log-ts">${_relTime(e.ts)}</span>
                    </div>`).join("")}
            </div>
            <div class="pt-panel-toggles">
                <select id="ptPersonaSelect" class="sdoa-select sdoa-select--sm" style="flex:1; margin-right:8px; height:24px; font-size:10px;">
                    <option value="advisor"  ${_persona === "advisor"  ? "selected" : ""}>Advisor</option>
                    <option value="critic"   ${_persona === "critic"   ? "selected" : ""}>Critic</option>
                    <option value="friend"   ${_persona === "friend"   ? "selected" : ""}>Friend</option>
                    <option value="comedy"   ${_persona === "comedy"   ? "selected" : ""}>Comedy</option>
                </select>
                <button id="ptDownloadBtn" class="sdoa-btn sdoa-btn--sm" title="Download Model" style="font-size:10px; height:24px; padding:0 8px; background:var(--bg-accent-subtle); border-color:var(--border-accent);">📥</button>
                <button id="ptForceBtn" class="sdoa-btn sdoa-btn--sm" title="Ask for Observation" style="font-size:10px; height:24px; padding:0 8px; margin-left:4px; background:var(--bg-accent-subtle); border-color:var(--border-accent);">⚡</button>
            </div>
            <div class="pt-panel-toggles" style="justify-content: space-between; align-items: center;">
                <div style="font-size: 10px; color: var(--text-dim);">Pulse Frequency:</div>
                <select id="ptPulseSelect" class="sdoa-select sdoa-select--sm" style="width:70px; height:22px; font-size:10px;">
                    <option value="1"  ${_pulseFreq === 1  ? "selected" : ""}>1m</option>
                    <option value="5"  ${_pulseFreq === 5  ? "selected" : ""}>5m</option>
                    <option value="10" ${_pulseFreq === 10 ? "selected" : ""}>10m</option>
                    <option value="15" ${_pulseFreq === 15 ? "selected" : ""}>15m</option>
                    <option value="30" ${_pulseFreq === 30 ? "selected" : ""}>30m</option>
                    <option value="60" ${_pulseFreq === 60 ? "selected" : ""}>1h</option>
                </select>
            </div>
            <div class="pt-panel-toggles">
                ${FEATURES.map(f => `
                    <label class="pt-toggle-chip ${_toggles[f.key] !== false ? "on" : "off"}" data-feature="${f.key}">
                        <input type="checkbox" ${_toggles[f.key] !== false ? "checked" : ""} data-feature="${f.key}" style="display:none"/>
                        ${f.label}
                    </label>`).join("")}
            </div>
        `;

        panel.querySelector("#ptMasterToggle")?.addEventListener("change", (e) => {
            localStorage.setItem(STORAGE_ENABLED, e.target.checked ? "true" : "false");
            window.EventBus?.emit("ticker:toggleChanged", { feature: "all", enabled: e.target.checked });
            _renderPanel();
        });

        panel.querySelectorAll(".pt-toggle-chip").forEach(chip => {
            chip.addEventListener("click", () => {
                const f = chip.dataset.feature;
                _toggles[f] = !(_toggles[f] !== false);
                _saveToggles();
                window.EventBus?.emit("ticker:toggleChanged", { feature: f, enabled: _toggles[f] });
                _renderPanel();
            });
        });

        panel.querySelector("#ptPersonaSelect")?.addEventListener("change", (e) => {
            _persona = e.target.value;
            localStorage.setItem(STORAGE_PERSONA, _persona);
            window.ToastPrim?.show(`Partner persona: ${_persona}`, "info");
        });

        panel.querySelector("#ptDownloadBtn")?.addEventListener("click", async (e) => {
            const btn = e.target;
            const originalText = btn.textContent;
            btn.disabled = true;
            btn.textContent = "⏳";
            
            try {
                const res = await window.backendConnector.runWorkflow("SysProvisionModel.workflow", {
                    modelId: "qwen2.5-coder-7b-q4km",
                    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/qwen2.5-coder-7b-instruct-q4_k_m.gguf",
                    targetPath: "models/qwen2.5-coder-7b-q4km/qwen2.5-coder-7b-instruct-q4_k_m.gguf"
                });

                if (res.ok !== false) {
                    btn.textContent = "✅";
                    window.ToastPrim?.show("Local model ready for use", "ok");
                    pushEvent("local:modelLoaded", { modelPath: res.path });
                } else {
                    throw new Error(res.error);
                }
            } catch (err) {
                btn.textContent = "❌";
                btn.disabled = false;
                alert("Download failed: " + err.message);
            } finally {
                setTimeout(() => { if (btn.disabled) { btn.disabled = false; btn.textContent = originalText; } }, 2000);
            }
        });

        panel.querySelector("#ptForceBtn")?.addEventListener("click", async (e) => {
            if (!_isEnabled()) return window.ToastPrim?.show("Enable Silent Partner first", "warn");
            const btn = e.target;
            const originalText = btn.textContent;
            btn.textContent = "⏳";
            btn.disabled = true;
            try {
                await _generateCommentary("Manual trigger: Provide an immediate observation.", "Look at the current project context and provide a spontaneous, helpful observation or critique.");
            } finally {
                btn.textContent = originalText;
                btn.disabled = false;
            }
        });

        panel.querySelector("#ptPulseSelect")?.addEventListener("change", (e) => {
            _pulseFreq = parseInt(e.target.value, 10);
            localStorage.setItem(STORAGE_PULSE, _pulseFreq);
            window.ToastPrim?.show(`Heartbeat frequency: ${_pulseFreq}m`, "info");
            _startHeartbeat(); // Reset timer with new frequency
        });
    }

    function _wireInteractions() {
        const strip = _container?.querySelector(".pt-strip");
        const panel = _container?.querySelector(".pt-panel");
        if (!strip) return;

        strip.addEventListener("click", (e) => {
            _state = (_state === "minimized") ? "locked" : "minimized";
            panel?.classList.toggle("hidden", _state === "minimized");
            localStorage.setItem(STORAGE_STATE, _state);
            if (_state === "locked") _renderPanel();
            e.stopPropagation();
        });
    }

    function _wireBusEvents() {
        const bus = window.EventBus;
        if (!bus) return;
        Object.keys(EVENT_META).forEach(type => bus.on(type, (data) => pushEvent(type, data || {})));

        // Background Observations
        console.log("[PartnerTicker] Wiring bus events...");
        bus.on("app:projectSelected", (payload) => {
            console.log("[PartnerTicker] Project selected event received:", payload);
            if (_isEnabled()) {
                _generateCommentary(`I just switched to the project: ${payload.project}`, "Observe the project and say something brief.");
            }
        });

        // Trigger spontaneous reactions after assistant messages
        // bus.on("chat:appendMessage", (data) => { ... }); // REMOVED: Handled by MultiModelSend now

        // Add a "System Ready" event immediately
        pushEvent("local:modelLoaded", { message: "Silent Partner system is awake." });
        window.ToastPrim?.show("Silent Partner (NSS) is online.", "info");
    }

    let _watchdogTimer = null;

    async function _generateCommentary(message, response) {
        if (!window.backendConnector) return;
        const thinkingId = `think_${Date.now()}`;
        let watchdogFired = false;

        // Watchdog: If no reply in 20s, auto-unlock UI (extended from 15s).
        // Sets watchdogFired so the later try/catch won't double-post an error.
        clearTimeout(_watchdogTimer);
        _watchdogTimer = setTimeout(() => {
            watchdogFired = true;
            console.warn("[PartnerTicker] Commentary timed out. Forcing UI unlock.");
            pushEvent("orchestrator:error", { stage: "Silent Partner", message: "Commentary generation timed out." });
            window.EventBus?.emit("app:force_reset");
        }, 20000);

        pushEvent("orchestrator:commentary_generating", { persona: _persona, id: thinkingId });

        try {
            const res = await window.backendConnector.runWorkflow("PartnerCommentary.workflow", {
                message, response, persona: _persona
            });

            // If watchdog already fired, swallow the result — the error was already shown.
            if (watchdogFired) return;

            const text = res?.data?.text || res?.text;
            const persona = res?.data?.persona || res?.persona;

            if (text) {
                pushEvent("orchestrator:commentary", { text, persona: persona || _persona });
            } else if (res?.ok === false) {
                const msg = res.error || res.detail || "Backend returned an error";
                pushEvent("orchestrator:error", { stage: "commentary", message: msg });
            }
            // Empty text with ok:true means local model isn't downloaded — silent drop.
        } catch (err) {
            if (watchdogFired) return;
            console.warn("[PartnerTicker] Commentary failed:", err);
            const msg = (typeof err === "string") ? err : (err.message || JSON.stringify(err));
            pushEvent("orchestrator:error", { stage: "commentary", message: msg || "Failed to generate commentary." });
        } finally {
            clearTimeout(_watchdogTimer);
            _tickerItems = _tickerItems.filter(item => item.data?.id !== thinkingId);
            _updateTickerStrip();
        }
    }

    function _startHeartbeat() {
        if (_heartbeatTimer) clearTimeout(_heartbeatTimer);

        // Randomized pulse around the user-defined frequency (+/- 20% jitter)
        const baseMs = _pulseFreq * 60 * 1000;
        const jitter = baseMs * 0.2;
        const delay  = baseMs + (Math.random() * jitter * 2 - jitter);

        _heartbeatTimer = setTimeout(async () => {
            if (_isEnabled()) {
                console.log("[PartnerTicker] Heartbeat pulse...");
                await _generateCommentary("Just checking in on the idle workspace.", "Spontaneously say something brief, in-character, and observant about the current atmosphere or project.");
            }
            _startHeartbeat(); // Schedule next
        }, delay);
    }

    function _startPulse() {
        const dot = _container?.querySelector("#ptDot");
        if (!dot) return;
        setInterval(() => {
            const active = _log.length > 0 && (Date.now() - _log[_log.length - 1].ts) < 8000;
            dot.className = `pt-dot ${active ? "pt-dot-active" : ""}`;
        }, 1000);
    }

    function _esc(str) { return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function _relTime(ts) {
        const diff = Math.floor((Date.now() - ts) / 1000);
        if (diff < 5) return "just now";
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        return `${Math.floor(diff / 3600)}h ago`;
    }

    window.PartnerTickerFeature = { MANIFEST, init, mount, pushEvent, playback };
    if (window.ModuleLoader) window.ModuleLoader.register(MANIFEST, window.PartnerTickerFeature);
})();
