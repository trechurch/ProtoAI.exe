// ============================================================
// updater.ui.js — UI Updater Adapter
// version: 3.0.0
// Last modified: 2026-05-02 10:00 UTC
// depends: tauri-utils.js
// replaces: updater.js (legacy — retire once confirmed stable)
// ============================================================

(function () {
    "use strict";

    const { domReady } = window.TauriUtils;

    // ── UpdaterUI ────────────────────────────────────────────
    // Manages version badge, update availability dot, and
    // update install/download surface.
    //
    // Update check strategy (matches legacy updater.js):
    //   - Fetches GitHub Releases API directly (no Tauri IPC
    //     needed — public endpoint, no auth required)
    //   - Compares semver against APP_VERSION global
    //   - Shows toast-style prompt with release notes on match
    //   - Turns update dot red + pulsing on update available
    //   - Turns update dot green on current
    //
    // Install strategy:
    //   - If Tauri updater plugin is active: invoke IPC
    //   - Otherwise: open the GitHub release URL in browser
    // ── end of UpdaterUI ─────────────────────────────────────

    // ── SDOA v3.0 MANIFEST ───────────────────────────────────
    const MANIFEST = {
        id:      "UpdaterUI",
        type:    "component",
        runtime: "Browser",
        version: "3.0.0",

        // v1.2 fields — always present, never removed
        capabilities: [
            "updater.check",
            "updater.prompt",
            "updater.install",
            "version.display"
        ],
        dependencies: [
            "tauri-utils.js"
        ],
        docs: {
            description: "Version checker and update prompt. Fetches GitHub Releases API on startup and on manual trigger. Displays version badge, status dot, release notes toast, and install/download action. Tauri updater plugin used if active; falls back to browser open.",
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
                check: {
                    description: "Manually trigger an update check.",
                    input:  {},
                    output: "UpdateResult | null"
                },
                install: {
                    description: "Trigger install or open download URL.",
                    input:  { url: "string?" },
                    output: "void"
                }
            },
            triggers: {
                updateAvailable: {
                    description: "Fires when a newer version is found on GitHub.",
                    payload: { version: "string", url: "string" }
                }
            },
            emits: {
                checkCompleted: {
                    description: "Emits after a check resolves (update found or current).",
                    payload: { updateAvailable: "boolean", version: "string?" }
                },
                checkFailed: {
                    description: "Emits when the GitHub API call fails or times out.",
                    payload: { error: "string" }
                }
            },
            workflows: {
                check: {
                    description: "Primary update check workflow.",
                    input:  {},
                    output: "UpdateResult | null"
                }
            }
        }
    };
    // ── end of SDOA v3.0 MANIFEST ────────────────────────────

    // ── constants ────────────────────────────────────────────
    const REPO    = "trechurch/ProtoAI.exe";
    const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
    const CURRENT = typeof window.APP_VERSION === "string" ? window.APP_VERSION : "0.0.0";
    // ── end of constants ─────────────────────────────────────

    // ── module state ─────────────────────────────────────────
    let _listeners   = [];
    let _lastUpdate  = null;    // cached last known update result
    let _checking    = false;   // guard against concurrent checks
    // ── end of module state ──────────────────────────────────

    // ── event emitter ────────────────────────────────────────

    function on(event, handler) {
        _listeners.push({ event, handler });
    }

    function emit(event, data) {
        for (const l of _listeners) {
            if (l.event === event) {
                try { l.handler(data); } catch (e) {
                    console.error(`[UpdaterUI] Listener error (${event}):`, e);
                }
            }
        }
    }

    // ── end of event emitter ─────────────────────────────────

    // ── _fetchLatestRelease ───────────────────────────────────
    // Fetches the latest GitHub release with a 5s timeout.
    // Returns a structured update object if a newer version
    // exists, or null if current or fetch fails.
    // ── end of _fetchLatestRelease ───────────────────────────

    async function _fetchLatestRelease() {
        try {
            const ctrl  = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 5000);

            const res = await fetch(API_URL, {
                headers: { "Accept": "application/vnd.github.v3+json" },
                signal:  ctrl.signal
            });
            clearTimeout(timer);

            if (!res.ok) return null;

            const json   = await res.json();
            const latest = (json.tag_name || "").replace(/^v/, "") || "0.0.0";

            if (!_isNewer(latest, CURRENT)) return null;

            return {
                version: latest,
                notes:   json.body || "",
                url:     json.html_url,
                assets:  (json.assets || []).map(a => ({
                    name: a.name,
                    url:  a.browser_download_url
                }))
            };

        } catch {
            return null;
        }
    }

    // ── _isNewer ─────────────────────────────────────────────
    // Semver comparison. Returns true if latest > current.
    // ── end of _isNewer ──────────────────────────────────────

    function _isNewer(latest, current) {
        const l = latest.split(".").map(Number);
        const c = current.split(".").map(Number);
        for (let i = 0; i < Math.max(l.length, c.length); i++) {
            const a = l[i] || 0, b = c[i] || 0;
            if (a > b) return true;
            if (a < b) return false;
        }
        return false;
    }

    // ── check ────────────────────────────────────────────────
    // Public entry point for manual + auto checks.
    // Guards against concurrent calls with _checking flag.
    // Updates dot, badge, and shows prompt if update found.
    // ── end of check ─────────────────────────────────────────

    async function check() {
        if (_checking) return;
        _checking = true;
        _setChecking(true);

        try {
            const update = await _fetchLatestRelease();
            _lastUpdate  = update;

            if (update) {
                window.LATEST_VERSION = update.version;
                _applyUpdateAvailable(update);
                _showUpdatePrompt(update);
                emit("updateAvailable",  { version: update.version, url: update.url });
                emit("checkCompleted",   { updateAvailable: true,  version: update.version });
            } else {
                window.LATEST_VERSION = CURRENT;
                _applyUpToDate();
                emit("checkCompleted",   { updateAvailable: false, version: CURRENT });
            }

            return update;

        } catch (err) {
            console.error("[UpdaterUI] Check failed:", err);
            _applyError();
            emit("checkFailed", { error: err.message });
            return null;

        } finally {
            _checking = false;
            _setChecking(false);
        }
    }

    // ── _applyUpdateAvailable ────────────────────────────────
    // Updates the dot to red + pulsing and sets the version
    // badge. Makes dot clickable to re-show the prompt.
    // ── end of _applyUpdateAvailable ─────────────────────────

    function _applyUpdateAvailable(update) {
        const badge = document.getElementById("versionBadge");
        const dot   = document.getElementById("updateDot");

        if (badge) badge.textContent = CURRENT;

        if (dot) {
            dot.style.background = "#f87171";
            dot.style.cursor     = "pointer";
            dot.style.animation  = "pulse-dot 2s infinite";
            dot.title            = `Update available: v${update.version}`;
            dot.onclick          = () => _showUpdatePrompt(update);
        }
    }

    // ── _applyUpToDate ───────────────────────────────────────

    function _applyUpToDate() {
        const badge = document.getElementById("versionBadge");
        const dot   = document.getElementById("updateDot");

        if (badge) badge.textContent = CURRENT;
        if (dot) {
            dot.style.background = "#4ade80";
            dot.style.cursor     = "";
            dot.style.animation  = "";
            dot.title            = `Up to date: v${CURRENT}`;
            dot.onclick          = null;
        }
    }

    // ── _applyError ──────────────────────────────────────────
    // Updates dot to amber error state so the user knows
    // the check failed rather than leaving stale UI.
    // ── end of _applyError ───────────────────────────────────

    function _applyError() {
        const badge = document.getElementById("versionBadge");
        const dot   = document.getElementById("updateDot");

        if (badge) badge.textContent = CURRENT || "—";
        if (dot) {
            dot.style.background = "#fbbf24";
            dot.style.cursor     = "pointer";
            dot.style.animation  = "";
            dot.title            = "Update check failed — click to retry";
            dot.onclick          = () => check();
        }
    }

    // ── _setChecking ─────────────────────────────────────────
    // Disables the manual check button while in flight.
    // ── end of _setChecking ──────────────────────────────────

    function _setChecking(active) {
        const btn = document.getElementById("checkForUpdatesButton");
        if (!btn) return;
        btn.disabled     = active;
        btn.textContent  = active ? "Checking…" : "Check for Updates";
    }

    // ── _showUpdatePrompt ────────────────────────────────────
    // Renders a toast-style update notification at the top
    // of chatContainer (or #main as fallback).
    // Matches the visual style from legacy updater.js.
    // ── end of _showUpdatePrompt ─────────────────────────────

    function _showUpdatePrompt(update) {
        // Remove any existing prompt first
        document.getElementById("updatePrompt")?.remove();

        const div = document.createElement("div");
        div.id = "updatePrompt";
        div.style.cssText = [
            "margin:12px 16px",
            "padding:14px 18px",
            "background:var(--bg-elevated-1,#1a1a2e)",
            "border:1px solid var(--accent,#6366f1)",
            "border-radius:10px",
            "font-size:13px"
        ].join(";");

        div.innerHTML = `
            <div style="font-weight:600;color:var(--accent,#6366f1);margin-bottom:4px;">
                ⬆ Update available: v${update.version}
            </div>
            <div style="color:var(--text-dim,#999);margin-bottom:8px;">
                Current version: v${CURRENT}
            </div>
            ${update.notes ? `
            <div style="color:var(--text,#ccc);max-height:120px;overflow-y:auto;border-top:1px solid var(--border-subtle,#333);padding-top:6px;font-size:12px;white-space:pre-wrap;margin-bottom:8px;">
                ${update.notes}
            </div>` : ""}
            <div>
                <button class="install-update-btn" style="background:var(--accent,#6366f1);color:#fff;border:none;border-radius:6px;padding:5px 12px;font-size:12px;cursor:pointer;margin-right:8px;">
                    Install v${update.version}
                </button>
                <a href="${update.url}" target="_blank"
                   style="color:var(--accent,#6366f1);text-decoration:underline;margin-right:12px;font-size:12px;">
                    View release
                </a>
                <span class="dismiss-update-btn"
                      style="color:var(--text-dim,#999);cursor:pointer;font-size:12px;">
                    Dismiss
                </span>
            </div>
        `;

        div.querySelector(".install-update-btn").onclick = () => _install(update.url);
        div.querySelector(".dismiss-update-btn").onclick = () => div.remove();

        const container = document.getElementById("chatContainer")
                       || document.getElementById("main");
        if (!container) return;

        if (container.firstChild) {
            container.insertBefore(div, container.firstChild);
        } else {
            container.appendChild(div);
        }
    }

    // ── _install ─────────────────────────────────────────────
    // Attempts Tauri updater IPC if the plugin is active.
    // Falls back to opening the GitHub release URL in the
    // system browser.
    // ── end of _install ──────────────────────────────────────

    async function _install(fallbackUrl) {
        const inv = window.__TAURI__?.core?.invoke;

        if (inv) {
            try {
                await inv("plugin:updater|check");
                return;
            } catch {
                // Tauri updater plugin not active — fall through
            }
        }

        // Fallback: open release page
        if (inv) {
            try {
                await inv("plugin:shell|open", { path: fallbackUrl });
                return;
            } catch { /* fall through to window.open */ }
        }

        window.open(fallbackUrl, "_blank");
    }

    // ── window exports ───────────────────────────────────────
    // checkForUpdates exposed for command palette and HTML
    // onclick handlers matching legacy updater.js convention.
    // ── end of window exports ────────────────────────────────

    window.checkForUpdates = check;
    window.UpdaterUI       = { MANIFEST, on };

    // ── auto-init ────────────────────────────────────────────
    // Wire manual check button then auto-check after 2s,
    // matching the legacy updater.js startup delay.
    // ── end of auto-init ─────────────────────────────────────

    domReady(() => {
        const btn = document.getElementById("checkForUpdatesButton");
        if (btn) btn.addEventListener("click", () => check());

        // Auto-check — delayed to avoid racing sidecar startup
        window.UPDATER_CHECKING = true;
        setTimeout(async () => {
            await check();
            window.UPDATER_CHECKING = false;
        }, 2000);
    });

})();
