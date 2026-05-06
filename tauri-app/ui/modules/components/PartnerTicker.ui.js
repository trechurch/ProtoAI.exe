// ============================================================
// PartnerTicker.ui.js — SDOA v3.0 Component (Browser)
// version: 1.0.0
// Last modified: 2026-05-04 03:11 UTC
// depends: tauri-utils.js, EventBus.ui.js
// ============================================================
//
// The local model's activity ticker — a persistent status strip
// at the bottom of the chat pane that surfaces what the silent
// partner is doing on every request.
//
// ── State machine ────────────────────────────────────────────
//   minimized  — 28px bar, scrolling event text (default)
//   hovered    — expanded preview panel (mouse over ticker)
//   locked     — full panel locked open (single click)
//   minimized  — double-click returns to ticker
//
// ── Interactions ─────────────────────────────────────────────
//   hover       → expand preview (last 8 events)
//   click       → lock panel open
//   double-click → return to minimized ticker
//   toggles     → enable / disable route / engineer / watch / audit
//
// ── EventBus events consumed ─────────────────────────────────
//   orchestrator:routing, orchestrator:routed,
//   orchestrator:engineering, orchestrator:engineered,
//   orchestrator:watching, orchestrator:flagged,
//   orchestrator:auditing, orchestrator:audited,
//   orchestrator:error, local:modelLoaded
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    const MANIFEST = {
        id:      "PartnerTicker.ui", type: "component", runtime: "Browser",
        version: "1.0.0",
        capabilities: ["ticker.display", "orchestrator.events", "feature.toggles"],
        dependencies: ["tauri-utils.js", "EventBus.ui.js"],
        docs: { description: "Local model activity ticker. Minimized strip → hover preview → locked panel. Replays orchestrator events from each completed request." },
            author: "ProtoAI team",
        actions: {
            commands: {
                render:   { description: "Render ticker into container.", input: { container: "DOMElement" }, output: "void" },
                pushEvent: { description: "Push an orchestrator event into the ticker.", input: { type: "string", data: "object?" }, output: "void" },
                playback:  { description: "Replay an array of orchestrator events with staggered animation.", input: { events: "array" }, output: "void" },
            },
            triggers: {
                "orchestrator:routed":     { description: "Show routing result." },
                "orchestrator:engineered": { description: "Show prompt optimization result." },
                "orchestrator:flagged":    { description: "Show watcher flag." },
                "orchestrator:audited":    { description: "Show audit score." },
                "local:modelLoaded":       { description: "Show model-ready status." },
            },
            emits: {
                "ticker:toggleChanged": { payload: { feature: "string", enabled: "boolean" } },
            },
            workflows: {},
        },
    };

    // ── Event type metadata ───────────────────────────────────
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

    // ── Storage keys ──────────────────────────────────────────
    const STORAGE_ENABLED = "protoai:orchestrator:enabled";
    const STORAGE_TOGGLES = "protoai:ticker:toggles";
    const STORAGE_STATE   = "protoai:ticker:state";

    // ── State ─────────────────────────────────────────────────
    let _container    = null;    // host element
    let _log          = [];      // all events, capped at 100
    let _tickerItems  = [];      // items currently scrolling in ticker
    let _state        = localStorage.getItem(STORAGE_STATE) || "locked"; // Default to locked
    let _tickerPos    = 0;
    let _tickerTimer  = null;
    let _hoverTimer   = null;
    let _toggles      = _loadToggles();

    // ── Feature toggle defaults ───────────────────────────────
    function _loadToggles() {
        try { return JSON.parse(localStorage.getItem(STORAGE_TOGGLES) || "{}"); } catch (_) { return {}; }
    }
    function _saveToggles() {
        try { localStorage.setItem(STORAGE_TOGGLES, JSON.stringify(_toggles)); } catch (_) {}
    }
    function _isEnabled() {
        return localStorage.getItem(STORAGE_ENABLED) !== "false";
    }

    const FEATURES = [
        { key: "route",    label: "Route",    default: true },
        { key: "engineer", label: "Engineer", default: true },
        { key: "watch",    label: "Watch",    default: true },
        { key: "audit",    label: "Audit",    default: true },
    ];
    function _featureEnabled(key) {
        return _toggles[key] !== false;
    }

    // ── Event ingestion ───────────────────────────────────────
    function pushEvent(type, data = {}) {
        const meta = EVENT_META[type] || { icon: "·", label: () => type, color: "dim" };
        const entry = {
            type, data,
            icon:  meta.icon,
            text:  meta.label(data),
            color: meta.color,
            ts:    Date.now(),
        };
        _log.push(entry);
        if (_log.length > 100) _log.shift();
        _tickerItems.push(entry);
        if (_tickerItems.length > 20) _tickerItems.shift();
        _updateTickerStrip();
        if (_state !== "minimized") _renderPanel();
    }

    // ── Playback ──────────────────────────────────────────────
    // Stagger-replays an orchestrator event array from WorkflowResult.
    function playback(events = []) {
        if (!_container) return;
        let delay = 0;
        for (const ev of events) {
            const type = ev.type.startsWith("orchestrator:")
                ? ev.type
                : `orchestrator:${ev.type}`;
            setTimeout(() => pushEvent(type, ev.data || {}), delay);
            delay += 220;
        }
    }

    // ── Ticker strip ──────────────────────────────────────────
    function _updateTickerStrip() {
        if (!_container) return;
        const strip = _container.querySelector(".pt-strip-text");
        if (!strip) return;

        const recent = _tickerItems.slice(-6).reverse();
        if (recent.length === 0) {
            strip.textContent = _isEnabled() ? "waiting…" : "partner offline";
            return;
        }
        strip.innerHTML = recent.map(e =>
            `<span class="pt-item pt-${e.color}">${e.icon} ${_esc(e.text)}</span>`
        ).join('<span class="pt-sep">  ·  </span>');
    }

    // ── Panel render ──────────────────────────────────────────
    function _renderPanel() {
        const panel = _container?.querySelector(".pt-panel");
        if (!panel) return;

        const enabled = _isEnabled();
        const recent  = _log.slice(-12).reverse();

        panel.innerHTML = `
            <div class="pt-panel-header">
                <span class="pt-panel-title">🤖 Local Partner</span>
                <label class="pt-master-toggle" title="Enable/disable orchestrator">
                    <input type="checkbox" ${enabled ? "checked" : ""} id="ptMasterToggle"/>
                    <span>${enabled ? "active" : "offline"}</span>
                </label>
            </div>
            <div class="pt-panel-log">
                ${recent.length === 0
                    ? `<div class="pt-log-empty">No activity yet</div>`
                    : recent.map(e => `
                        <div class="pt-log-row ${e.type === "orchestrator:commentary" ? "pt-commentary-row" : ""}">
                            <span class="pt-log-icon">${e.icon}</span>
                            <span class="pt-log-text pt-${e.color}">${_esc(e.text)}</span>
                            <span class="pt-log-ts">${_relTime(e.ts)}</span>
                        </div>`).join("")}
            </div>
            <div class="pt-panel-toggles">
                ${FEATURES.map(f => `
                    <label class="pt-toggle-chip ${_featureEnabled(f.key) ? "on" : "off"}"
                           data-feature="${f.key}" title="Toggle ${f.label}">
                        <input type="checkbox" ${_featureEnabled(f.key) ? "checked" : ""} data-feature="${f.key}"/>
                        ${f.label}
                    </label>`).join("")}
            </div>
            <div class="pt-panel-hint">Click elsewhere to close · Double-click ticker to minimise</div>
        `;

        panel.querySelector("#ptMasterToggle")?.addEventListener("change", (e) => {
            localStorage.setItem(STORAGE_ENABLED, e.target.checked ? "true" : "false");
            window.EventBus?.emit("ticker:toggleChanged", { feature: "all", enabled: e.target.checked });
            _renderPanel();
        });

        panel.querySelectorAll("input[data-feature]").forEach(cb => {
            cb.addEventListener("change", (e) => {
                const f = e.target.dataset.feature;
                _toggles[f] = e.target.checked;
                _saveToggles();
                window.EventBus?.emit("ticker:toggleChanged", { feature: f, enabled: e.target.checked });
                _renderPanel();
            });
        });
    }

    // ── Layout build ──────────────────────────────────────────
    function render(container) {
        _container = container;
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
    }

    // ── Interactions ──────────────────────────────────────────
    function _wireInteractions() {
        const strip = _container?.querySelector(".pt-strip");
        const panel = _container?.querySelector(".pt-panel");
        if (!strip) return;

        let lastClick = 0;

        strip.addEventListener("mouseenter", () => {
            if (_state === "locked") return;
            clearTimeout(_hoverTimer);
            _state = "hovered";
            panel?.classList.remove("hidden");
            _renderPanel();
        });

        strip.addEventListener("mouseleave", () => {
            if (_state === "locked") return;
            _hoverTimer = setTimeout(() => {
                if (_state === "hovered") {
                    _state = "minimized";
                    panel?.classList.add("hidden");
                }
            }, 300);
        });

        panel?.addEventListener("mouseenter", () => clearTimeout(_hoverTimer));
        panel?.addEventListener("mouseleave", () => {
            if (_state !== "locked") {
                _hoverTimer = setTimeout(() => {
                    if (_state === "hovered") {
                        _state = "minimized";
                        panel?.classList.add("hidden");
                    }
                }, 400);
            }
        });

        strip.addEventListener("click", (e) => {
            const now = Date.now();
            if (now - lastClick < 350) {
                // Double-click → toggle minimise/locked
                if (_state === "minimized") {
                    _state = "locked";
                    panel?.classList.remove("hidden");
                    _container.classList.add("pt-locked");
                } else {
                    _state = "minimized";
                    panel?.classList.add("hidden");
                    _container.classList.remove("pt-locked");
                }
                localStorage.setItem(STORAGE_STATE, _state);
            } else {
                // Single click → lock open if not already
                _state = "locked";
                panel?.classList.remove("hidden");
                _container.classList.add("pt-locked");
                localStorage.setItem(STORAGE_STATE, _state);
                _renderPanel();
            }
            lastClick = now;
            e.stopPropagation();
        });

        // Click outside panel → close if locked
        document.addEventListener("click", (e) => {
            if (_state === "locked" && _container && !_container.contains(e.target)) {
                _state = "minimized";
                panel?.classList.add("hidden");
                _container.classList.remove("pt-locked");
            }
        });
    }

    // ── EventBus wiring ───────────────────────────────────────
    function _wireBusEvents() {
        const bus = window.EventBus;
        if (!bus) return;
        Object.keys(EVENT_META).forEach(type => {
            bus.on(type, (data) => pushEvent(type, data || {}));
        });
    }

    // ── Pulse animation ───────────────────────────────────────
    function _startPulse() {
        const dot = _container?.querySelector("#ptDot");
        if (!dot) return;
        setInterval(() => {
            const active = _log.length > 0 && (Date.now() - _log[_log.length - 1].ts) < 8000;
            dot.className = `pt-dot ${active ? "pt-dot-active" : ""}`;
        }, 1000);
    }

    // ── Utilities ─────────────────────────────────────────────
    function _esc(str) {
        return String(str || "")
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    function _relTime(ts) {
        const diff = Math.floor((Date.now() - ts) / 1000);
        if (diff < 5)   return "just now";
        if (diff < 60)  return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        return `${Math.floor(diff / 3600)}h ago`;
    }

    // ── Public API ────────────────────────────────────────────
    window.PartnerTicker = { MANIFEST, render, pushEvent, playback };
    domReady(() => {});

})();
