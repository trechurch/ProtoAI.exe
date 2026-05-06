// ============================================================
// SearchHistory.ui.js — Chat & File Search
// version: 1.0.0
// Last modified: 2026-05-02 10:00 UTC
// depends: tauri-utils.js, EventBus.ui.js
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    // ── SearchHistory.ui ─────────────────────────────────────
    // Renders a search panel inside the right pane's Search tab.
    // Search sources (in priority order):
    //   1. QMD adapter semantic search (if qmdAdapter available)
    //   2. Visible chat message text (substring match)
    //   3. Attached file names
    //
    // Results are clickable:
    //   - Chat matches scroll to the message in #chatContainer
    //   - File matches open via primaryPanel.openFile()
    // ── end of SearchHistory.ui ───────────────────────────────

    // ── SDOA v3 MANIFEST ─────────────────────────────────────
    const MANIFEST = {
        id:      "SearchHistory.ui",
        type:    "component",
        runtime: "Browser",
        version: "1.0.0",
        capabilities: [
            "search.chat",
            "search.files",
            "search.semantic",
        ],
        dependencies: ["tauri-utils.js", "EventBus.ui.js"],
        docs: {
            description: "Renders a search panel. Searches chat history and attached files. Delegates to qmdAdapter for semantic search when available.",
            author: "ProtoAI team",
            sdoa_compatibility: "All versions forward/backward compatible."
        },
        actions: {
            commands: {
                render: { description: "Mount the search panel into a container.", input: { container: "DOMElement" }, output: "void" },
                focus:  { description: "Focus the search input.",                  input: {}, output: "void" },
                clear:  { description: "Clear search input and results.",          input: {}, output: "void" },
            },
            triggers: {},
            emits: {},
            workflows: {}
        }
    };
    // ── end of SDOA v3 MANIFEST ──────────────────────────────

    // ── state ─────────────────────────────────────────────────
    let _container    = null;
    let _debounceTimer = null;
    let _qmdAvailable  = true;   // set to false on first "not available" error
    // ── end of state ─────────────────────────────────────────

    // ── render ────────────────────────────────────────────────
    // Mounts the search UI into the supplied container element.
    // ── end of render ────────────────────────────────────────

    function render(container) {
        _container = container;
        container.innerHTML = `
            <div style="display:flex;flex-direction:column;height:100%;">

                <div style="padding:10px 12px;border-bottom:1px solid var(--border-subtle,#222);">
                    <div style="display:flex;gap:6px;">
                        <input id="searchHistoryInput" type="text"
                               placeholder="Search messages and files…"
                               autocomplete="off"
                               style="flex:1;padding:7px 10px;font-size:13px;
                                      background:var(--bg-deep,#111);
                                      color:var(--text,#eee);
                                      border:1px solid var(--border-subtle,#333);
                                      border-radius:6px;outline:none;" />
                        <button id="searchHistoryClearBtn"
                                style="padding:6px 10px;font-size:12px;
                                       background:var(--bg-elevated-1,#1a1a1a);
                                       color:var(--text-dim,#999);
                                       border:1px solid var(--border-subtle,#333);
                                       border-radius:6px;cursor:pointer;">Clear</button>
                    </div>
                </div>

                <div id="searchHistoryResults"
                     style="flex:1;overflow-y:auto;padding:6px 0;"></div>

            </div>
        `;

        const input = container.querySelector("#searchHistoryInput");
        input?.addEventListener("input", e => {
            // Debounce — wait 300 ms after the user stops typing before searching.
            // This prevents a burst of IPC calls (and QMD error logs) on each keystroke.
            clearTimeout(_debounceTimer);
            const q = (e.target.value || "").trim();
            if (q.length < 2) { _renderResults([], q); return; }
            _debounceTimer = setTimeout(() => _doSearch(q), 300);
        });

        container.querySelector("#searchHistoryClearBtn")
            ?.addEventListener("click", clear);
    }

    // ── focus ─────────────────────────────────────────────────

    function focus() {
        const input = document.getElementById("searchHistoryInput");
        if (input) { input.focus(); input.select(); }
    }

    // ── clear ─────────────────────────────────────────────────

    function clear() {
        const input = document.getElementById("searchHistoryInput");
        if (input) input.value = "";
        _renderResults([], "");
    }

    // ── _doSearch ─────────────────────────────────────────────
    // Gathers results from all sources and renders them.
    // ── end of _doSearch ─────────────────────────────────────

    async function _doSearch(query) {
        const results = [];
        const q       = query.toLowerCase();

        // ── 1. QMD semantic search ────────────────────────────
        // _qmdAvailable is set to false on the first "not available" error
        // so we stop spamming IPC calls and console errors each keystroke.
        if (_qmdAvailable && window.qmdAdapter?.search) {
            try {
                const qmdResults = await window.qmdAdapter.search(query);
                (qmdResults || []).forEach(r => {
                    results.push({
                        title:   r.title || r.path || "File",
                        snippet: r.summary || r.snippet || r.preview || "",
                        type:    "file",
                        path:    r.path || null,
                    });
                });
            } catch (e) {
                // Silently disable QMD for the rest of this session if the
                // package isn't installed — avoids console spam.
                const msg = e?.message || String(e);
                if (msg.includes("QMD not available") || msg.includes("not installed")) {
                    _qmdAvailable = false;
                }
                // Other errors (transient IPC issues) are ignored but QMD stays enabled.
            }
        }

        // ── 2. Chat message text search ───────────────────────
        const messages = document.querySelectorAll("#chatContainer .message");
        messages.forEach((msgEl, i) => {
            const bodyEl = msgEl.querySelector(".message-body");
            const labelEl = msgEl.querySelector(".message-label");
            if (!bodyEl) return;

            const text  = bodyEl.textContent || "";
            const label = labelEl?.textContent || `Message ${i + 1}`;

            if (text.toLowerCase().includes(q)) {
                results.push({
                    title:   label,
                    snippet: _getSnippet(text, query, 140),
                    type:    "chat",
                    el:      msgEl,
                });
            }
        });

        // ── 3. Attached file names ────────────────────────────
        (window._attachedFiles || []).forEach(f => {
            const name = (f.split(/[\\/]/).pop() || "").toLowerCase();
            if (name.includes(q)) {
                results.push({
                    title:   f.split(/[\\/]/).pop(),
                    snippet: f,
                    type:    "attached",
                    path:    f,
                });
            }
        });

        _renderResults(results, query);
    }

    // ── _getSnippet ───────────────────────────────────────────
    // Returns a ~maxLen character snippet centred on the match.
    // ── end of _getSnippet ───────────────────────────────────

    function _getSnippet(text, query, maxLen) {
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return text.slice(0, maxLen) + (text.length > maxLen ? "…" : "");
        const start = Math.max(0, idx - 40);
        const end   = Math.min(text.length, idx + query.length + 80);
        return (start > 0 ? "…" : "") +
               text.slice(start, end) +
               (end < text.length ? "…" : "");
    }

    // ── _renderResults ────────────────────────────────────────

    function _renderResults(results, query) {
        const container = document.getElementById("searchHistoryResults");
        if (!container) return;

        if (!query || !results.length) {
            container.innerHTML = query
                ? `<div style="padding:20px;color:var(--text-muted,#888);font-size:13px;text-align:center;">No results for "${_esc(query)}"</div>`
                : `<div style="padding:20px;color:var(--text-dim,#666);font-size:12px;text-align:center;">Type at least 2 characters to search</div>`;
            return;
        }

        container.innerHTML = `
            <div style="padding:4px 12px 8px;font-size:11px;color:var(--text-dim,#666);">
                ${results.length} result${results.length === 1 ? "" : "s"} for "${_esc(query)}"
            </div>
        `;

        const TYPE_ICONS  = { chat: "💬", file: "📄", attached: "📎" };
        const TYPE_LABELS = { chat: "Chat", file: "File", attached: "Attached" };

        results.forEach(r => {
            const div       = document.createElement("div");
            const icon      = TYPE_ICONS[r.type]  || "🔍";
            const typeLabel = TYPE_LABELS[r.type] || r.type;

            div.style.cssText = [
                "padding:10px 14px",
                "border-bottom:1px solid var(--border-subtle,#1e1e1e)",
                "cursor:pointer",
                "transition:background 0.1s",
            ].join(";");

            div.innerHTML = `
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                    <span style="font-size:14px;">${icon}</span>
                    <span style="font-size:13px;font-weight:500;color:var(--text,#eee);
                                 overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">
                        ${_esc(r.title)}
                    </span>
                    <span style="font-size:10px;color:var(--text-dim,#666);
                                 background:var(--bg-elevated-1,#1a1a2e);
                                 padding:2px 6px;border-radius:10px;white-space:nowrap;">
                        ${typeLabel}
                    </span>
                </div>
                <div style="font-size:12px;color:var(--text-muted,#888);
                            line-height:1.5;overflow:hidden;
                            display:-webkit-box;-webkit-line-clamp:2;
                            -webkit-box-orient:vertical;">
                    ${_esc(r.snippet)}
                </div>
            `;

            div.addEventListener("mouseenter", () => {
                div.style.background = "var(--bg-elevated-1,#1a1a2e)";
            });
            div.addEventListener("mouseleave", () => {
                div.style.background = "";
            });

            div.addEventListener("click", () => {
                if (r.el) {
                    // Scroll chat to the matching message
                    r.el.scrollIntoView({ behavior: "smooth", block: "center" });
                    // Flash highlight
                    r.el.style.outline = "2px solid var(--accent,#6366f1)";
                    setTimeout(() => { r.el.style.outline = ""; }, 1800);
                } else if (r.path) {
                    window.primaryPanel?.openFile(r.path);
                }
            });

            container.appendChild(div);
        });
    }

    // ── _esc ──────────────────────────────────────────────────

    function _esc(str) {
        const div = document.createElement("div");
        div.textContent = str || "";
        return div.innerHTML;
    }

    // ── window export ─────────────────────────────────────────
    window.SearchHistory = { MANIFEST, render, focus, clear };
    // ── end of window export ─────────────────────────────────

    // ── EventBus wiring ───────────────────────────────────────
    domReady(() => {
        window.EventBus?.command("search", "render", ({ container }) => render(container));
        window.EventBus?.command("search", "focus",  ()              => focus());
        window.EventBus?.command("search", "clear",  ()              => clear());
    });
    // ── end of EventBus wiring ────────────────────────────────

})();
