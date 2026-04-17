// ============================================================
// SearchHistory.ui.js — Chat Search (Live + History)
// version: 1.0.0
// depends: tauri-utils.js, EventBus.ui.js
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    // ── SearchHistory.ui ─────────────────────────────────────
    // Two search modes in one panel, toggled by scope:
    //
    // "This chat" — searches visible #chatContainer messages.
    //   Pure frontend, instant, no backend needed.
    //   Highlights matching text in bubbles.
    //   Previous/Next navigation (Ctrl+F style).
    //
    // "All history" — searches all history.json files for
    //   the current project via SearchHistoryWorkflow.
    //   Returns matching turns with context snippets.
    //   Results are clickable — loads that session in chat.
    // ── end of SearchHistory.ui ──────────────────────────────

    // ── SDOA v3 MANIFEST ─────────────────────────────────────
    const MANIFEST = {
        id:      "SearchHistory.ui",
        type:    "component",
        runtime: "Browser",
        version: "1.0.0",
        capabilities: ["search.live", "search.history", "search.highlight", "search.navigate"],
        dependencies: ["tauri-utils.js", "EventBus.ui.js"],
        docs: { description: "Searches live chat messages (frontend) and saved chat history (backend). Scope toggle switches between modes." },
        actions: {
            commands: {
                render: { description: "Render into container.", input: { container: "DOMElement" }, output: "void" },
                focus:  { description: "Focus search input.",    input: {},                          output: "void" },
                clear:  { description: "Clear search state.",    input: {},                          output: "void" },
            },
            triggers: {},
            emits: {
                "search:resultSelected": { payload: { role: "string", message: "string", ts: "string" } },
            },
            workflows: {}
        }
    };
    // ── end of SDOA v3 MANIFEST ──────────────────────────────

    // ── state ─────────────────────────────────────────────────
    let _container    = null;
    let _scope        = "live";     // live | history
    let _query        = "";
    let _matches      = [];         // for live search — array of DOM elements
    let _matchIdx     = 0;
    let _debounceTimer = null;
    // ── end of state ─────────────────────────────────────────

    // ── render ────────────────────────────────────────────────

    function render(container) {
        _container = container;
        _container.className = "search-panel";
        _container.innerHTML = `
            <div class="search-header">
                <div class="search-scope-toggle">
                    <button class="search-scope-btn active" data-scope="live">This chat</button>
                    <button class="search-scope-btn"        data-scope="history">All history</button>
                </div>
            </div>

            <div class="search-input-row">
                <input
                    type="text"
                    id="searchInput"
                    class="search-input"
                    placeholder="Search messages…"
                    autocomplete="off"
                    spellcheck="false"
                />
                <div class="search-nav" id="searchNav" style="display:none">
                    <button class="search-nav-btn" id="searchPrev" title="Previous match">↑</button>
                    <span   class="search-count"   id="searchCount">0/0</span>
                    <button class="search-nav-btn" id="searchNext" title="Next match">↓</button>
                </div>
                <button class="search-clear-btn" id="searchClear" style="display:none">✕</button>
            </div>

            <div class="search-results" id="searchResults">
                <div class="search-hint">Type to search ${_scope === "live" ? "this chat" : "all history"}</div>
            </div>
        `;

        // Wire scope toggle
        _container.querySelectorAll(".search-scope-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                _scope = btn.dataset.scope;
                _container.querySelectorAll(".search-scope-btn").forEach(b => b.classList.toggle("active", b === btn));
                _clearHighlights();
                _query = "";
                const input = _container.querySelector("#searchInput");
                if (input) input.value = "";
                _showHint();
                _container.querySelector("#searchNav").style.display  = "none";
                _container.querySelector("#searchClear").style.display = "none";
            });
        });

        // Wire search input
        const input = _container.querySelector("#searchInput");
        input?.addEventListener("input", () => {
            _query = input.value.trim();
            clearTimeout(_debounceTimer);
            _debounceTimer = setTimeout(_doSearch, 200);
            _container.querySelector("#searchClear").style.display = _query ? "" : "none";
        });

        input?.addEventListener("keydown", (e) => {
            if (e.key === "Enter")  { e.shiftKey ? _prevMatch() : _nextMatch(); }
            if (e.key === "Escape") { clear(); }
        });

        // Wire navigation
        _container.querySelector("#searchPrev")?.addEventListener("click", _prevMatch);
        _container.querySelector("#searchNext")?.addEventListener("click", _nextMatch);
        _container.querySelector("#searchClear")?.addEventListener("click", () => { clear(); input?.focus(); });
    }

    // ── _doSearch ────────────────────────────────────────────

    function _doSearch() {
        if (!_query) { _clearHighlights(); _showHint(); return; }
        if (_scope === "live") {
            _searchLive();
        } else {
            _searchHistory();
        }
    }

    // ── _searchLive ───────────────────────────────────────────
    // Searches visible chat messages in #chatContainer.
    // Highlights matching text spans inline.
    // ── end of _searchLive ───────────────────────────────────

    function _searchLive() {
        _clearHighlights();
        _matches  = [];
        _matchIdx = 0;

        const chat = document.getElementById("chatContainer");
        if (!chat || !_query) return;

        const results = _container?.querySelector("#searchResults");
        if (results) results.innerHTML = "";

        const needle = _query.toLowerCase();
        let   count  = 0;

        chat.querySelectorAll(".message-body").forEach(body => {
            const text = body.textContent || "";
            if (!text.toLowerCase().includes(needle)) return;

            // Highlight matches in the DOM
            _highlightInNode(body, _query);
            const spans = body.querySelectorAll(".search-highlight");
            spans.forEach(sp => _matches.push(sp));
            count += spans.length;

            // Add result snippet
            if (results) {
                const snippet = _buildLiveSnippet(body, _query);
                snippet.addEventListener("click", () => {
                    const firstSpan = body.querySelector(".search-highlight");
                    firstSpan?.scrollIntoView({ behavior: "smooth", block: "center" });
                });
                results.appendChild(snippet);
            }
        });

        _updateNav(count);
        if (_matches.length > 0) _scrollToMatch(0);
    }

    // ── _searchHistory ────────────────────────────────────────
    // Calls the backend to search history.json files.
    // ── end of _searchHistory ────────────────────────────────

    async function _searchHistory() {
        const results = _container?.querySelector("#searchResults");
        if (results) results.innerHTML = `<div class="search-loading">Searching history…</div>`;

        try {
            const res = await window.backendConnector?.runWorkflow("search_history", {
                project: window.currentProject || "default",
                query:   _query,
                limit:   50,
            });

            const hits = res?.results || res?.data?.results || [];
            const nav2 = _container?.querySelector("#searchNav"); if (nav2) nav2.style.display = "none";

            if (!results) return;
            results.innerHTML = "";

            if (hits.length === 0) {
                results.innerHTML = `<div class="search-no-results">No results found in history</div>`;
                return;
            }

            const header = document.createElement("div");
            header.className   = "search-results-header";
            header.textContent = `${hits.length} result${hits.length !== 1 ? "s" : ""} in history`;
            results.appendChild(header);

            hits.forEach(hit => {
                const item = document.createElement("div");
                item.className = "search-result-item";
                item.innerHTML = `
                    <div class="search-result-role">${hit.role === "user" ? "You" : "ProtoAI"}</div>
                    <div class="search-result-text">${_highlightText(_escapeHtml(hit.snippet || hit.message?.slice(0,200) || ""), _query)}</div>
                    <div class="search-result-meta">${hit.ts ? new Date(hit.ts).toLocaleString() : ""}</div>
                `;
                item.addEventListener("click", () => {
                    window.EventBus?.emit("search:resultSelected", hit);
                    // TODO: load that session when chat sessions are implemented
                    window.showToast?.(`Found in history: ${new Date(hit.ts).toLocaleString()}`);
                });
                results.appendChild(item);
            });

        } catch (err) {
            if (results) results.innerHTML = `<div class="search-error">Search failed: ${err.message}</div>`;
        }
    }

    // ── live search helpers ───────────────────────────────────

    function _highlightInNode(node, query) {
        if (node.nodeType === Node.TEXT_NODE) {
            const idx = node.textContent.toLowerCase().indexOf(query.toLowerCase());
            if (idx < 0) return;
            const before = document.createTextNode(node.textContent.slice(0, idx));
            const match  = document.createElement("mark");
            match.className   = "search-highlight";
            match.textContent = node.textContent.slice(idx, idx + query.length);
            const after  = document.createTextNode(node.textContent.slice(idx + query.length));
            node.parentNode.replaceChild(after,  node);
            node.parentNode.insertBefore(match,  after);
            node.parentNode.insertBefore(before, match);
            return;
        }
        if (node.nodeType === Node.ELEMENT_NODE && node.tagName !== "MARK") {
            Array.from(node.childNodes).forEach(child => _highlightInNode(child, query));
        }
    }

    function _clearHighlights() {
        document.querySelectorAll(".search-highlight").forEach(mark => {
            const parent = mark.parentNode;
            if (parent) {
                parent.replaceChild(document.createTextNode(mark.textContent), mark);
                parent.normalize();
            }
        });
        _matches  = [];
        _matchIdx = 0;
    }

    function _nextMatch() {
        if (_matches.length === 0) return;
        _matches[_matchIdx]?.classList.remove("search-highlight-active");
        _matchIdx = (_matchIdx + 1) % _matches.length;
        _scrollToMatch(_matchIdx);
    }

    function _prevMatch() {
        if (_matches.length === 0) return;
        _matches[_matchIdx]?.classList.remove("search-highlight-active");
        _matchIdx = (_matchIdx - 1 + _matches.length) % _matches.length;
        _scrollToMatch(_matchIdx);
    }

    function _scrollToMatch(idx) {
        const el = _matches[idx];
        if (!el) return;
        el.classList.add("search-highlight-active");
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const cnt2 = _container?.querySelector("#searchCount"); if (cnt2) cnt2.textContent = `${idx + 1}/${_matches.length}`;
    }

    function _updateNav(count) {
        const nav   = _container?.querySelector("#searchNav");
        const cnt   = _container?.querySelector("#searchCount");
        if (nav) nav.style.display = count > 0 ? "flex" : "none";
        if (cnt) cnt.textContent   = count > 0 ? `1/${count}` : "0/0";
    }

    function _buildLiveSnippet(body, query) {
        const item = document.createElement("div");
        item.className = "search-result-item";
        const role    = body.closest(".message.user") ? "You" : "ProtoAI";
        const text    = body.textContent || "";
        const idx     = text.toLowerCase().indexOf(query.toLowerCase());
        const start   = Math.max(0, idx - 40);
        const end     = Math.min(text.length, idx + query.length + 40);
        const snippet = (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
        item.innerHTML = `
            <div class="search-result-role">${role}</div>
            <div class="search-result-text">${_highlightText(_escapeHtml(snippet), query)}</div>
        `;
        return item;
    }

    function _highlightText(html, query) {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return html.replace(new RegExp(`(${escaped})`, "gi"), `<mark class="search-highlight-inline">$1</mark>`);
    }

    function _showHint() {
        const results = _container?.querySelector("#searchResults");
        if (results) results.innerHTML = `<div class="search-hint">Type to search ${_scope === "live" ? "this chat" : "all history"}</div>`;
    }

    function _escapeHtml(s) {
        return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    }

    // ── public API ────────────────────────────────────────────

    function focus() { _container?.querySelector("#searchInput")?.focus(); }

    function clear() {
        _clearHighlights();
        _query = "";
        const input = _container?.querySelector("#searchInput");
        if (input) input.value = "";
        _showHint();
        if (_container) {
            _container.querySelector("#searchNav").style.display   = "none";
            _container.querySelector("#searchClear").style.display = "none";
        }
    }

    // ── window export ─────────────────────────────────────────
    window.SearchHistory = { MANIFEST, render, focus, clear };

    domReady(() => {
        window.EventBus?.command("search", "render", ({ container }) => render(container));
        window.EventBus?.command("search", "focus",  ()             => focus());
        window.EventBus?.command("search", "clear",  ()             => clear());

        // Ctrl+F → focus search if search pane is open
        document.addEventListener("keydown", e => {
            if ((e.ctrlKey || e.metaKey) && e.key === "f") {
                e.preventDefault();
                // Open search pane if not already open
                window.primaryPanel?.setSecondaryMode("search");
                if (window.primaryPanel?.getMode() === "none") {
                    window.primaryPanel?.setSplitMode("vertical");
                }
                setTimeout(focus, 100);
            }
        });
    });

})();
