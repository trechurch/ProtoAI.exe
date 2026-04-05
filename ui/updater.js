// updater.js — checks GitHub releases on boot, prompts if update available
(function () {
  const REPO = "trechurch/ProtoAI.exe";
  const API = `https://api.github.com/repos/${REPO}/releases/latest`;
  const CURRENT = typeof APP_VERSION === "string" ? APP_VERSION : "0.0.0";

  async function checkForUpdates() {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(API, {
        headers: { "Accept": "application/vnd.github.v3+json" },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      const json = await res.json();
      const latest = json.tag_name?.replace(/^v/, "") || "0.0.0";
      if (isNewer(latest, CURRENT)) {
        return {
          version: latest,
          notes: json.body || "",
          url: json.html_url,
          assets: (json.assets || []).map(a => ({ name: a.name, url: a.browser_download_url })),
        };
      }
    } catch (_) { return null; }
    return null;
  }

  function isNewer(latest, current) {
    const l = latest.split(".").map(Number);
    const c = current.split(".").map(Number);
    for (let i = 0; i < Math.max(l.length, c.length); i++) {
      const a = l[i] || 0, b = c[i] || 0;
      if (a > b) return true;
      if (a < b) return false;
    }
    return false;
  }

  function showUpdatePrompt(update) {
    // Show a toast-style notification in the chat area
    const div = document.createElement("div");
    div.style.cssText = "margin:12px 16px;padding:14px 18px;background:var(--bg-elevated-1,#1a1a2e);border:1px solid var(--accent,#6366f1);border-radius:10px;font-size:13px;";
    div.innerHTML = `
      <div style="font-weight:600;color:var(--accent,#6366f1);margin-bottom:4px;">⬆ Update available: v${update.version}</div>
      <div style="color:var(--text-dim,#999);margin-bottom:8px;">Current version: v${CURRENT}</div>
      ${update.notes ? `<div style="color:var(--text,#ccc);max-height:120px;overflow-y:auto;border-top:1px solid var(--border-subtle,#333);padding-top:6px;font-size:12px;white-space:pre-wrap;margin-bottom:8px;">${update.notes}</div>` : ""}
      <div>
        <a href="${update.url}" target="_blank" style="color:var(--accent,#6366f1);text-decoration:underline;margin-right:12px;font-size:12px;">Download v${update.version}</a>
        <span class="dismiss" style="color:var(--text-dim,#999);cursor:pointer;font-size:12px;">Dismiss</span>
      </div>
    `;
    div.querySelector(".dismiss").onclick = () => div.remove();
    // Insert at top of chat
    const container = document.getElementById("chatContainer");
    container.insertBefore(div, container.firstChild);
  }

  // Auto-check on load
  window.addEventListener("load", () => {
    window.UPDATER_CHECKING = true;
    setTimeout(async () => {
      const update = await checkForUpdates();
      window.UPDATER_CHECKING = false;
      if (update) {
        window.LATEST_VERSION = update.version;
        showUpdatePrompt(update);
        // Turn dot red + clickable
        const dot = document.getElementById("updateDot");
        if (dot) {
          dot.style.background = "#f87171";
          dot.style.cursor = "pointer";
          dot.style.animation = "pulse-dot 2s infinite";
          dot.title = "Update available: v" + update.version;
          dot.onclick = () => showUpdatePrompt(update);
        }
      } else {
        window.LATEST_VERSION = CURRENT;
        const dot = document.getElementById("updateDot");
        if (dot) dot.style.background = "#4ade80";
      }
    }, 2000);
  });

  // Manual check from command palette
  window.checkForUpdates = async () => {
    const update = await checkForUpdates();
    if (update) {
      showUpdatePrompt(update);
    } else if (typeof showToast === "function") {
      showToast("No updates available. You're on v" + CURRENT);
    }
  };
})();
