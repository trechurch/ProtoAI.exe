// ============================================================
// Last modified: 2026-05-04T12:00:00Z
// app.js — SDOA Surface Layer (Bootloader)
// version: 2.0.1 (SDOA v4)
// ============================================================

let backend = null;

async function init() {
    const bootLog = (msg) => {
        console.log(`[app.js] ${msg}`);
        const el = document.getElementById("boot-status");
        if (el) el.textContent = msg;
    };

    try {
        bootLog("Initializing environment...");
        backend = window.backendConnector;

        if (window.PartnerTicker) {
            window.PartnerTicker.render(document.getElementById("partnerTickerHost"));
        }

        const sidebarStatus = document.getElementById("sidebarStatusText");
        if (sidebarStatus) sidebarStatus.textContent = "Starting engine…";

        const ready = await _waitForBridge();
        if (!ready) {
            console.warn("[app.js] Engine bridge timed out — continuing in degraded mode");
            backend?.setBackendStatus("unavailable", "Engine timed out");
        } else {
            backend?.setBackendStatus("tauri");
        }

        if (sidebarStatus) sidebarStatus.textContent = ready ? "Tauri IPC" : "Degraded";

        const flags = await backend?.runWorkflow("get_launch_flags").catch(() => null);
        if (flags?.setupWizard && typeof window.openFirstRunWizard === "function") {
            window.openFirstRunWizard();
            return;
        }

        // ── SDOA v4 ──────────────────────────────────────────
        // Initialize all registered v4 modules
        if (window.ModuleLoader) {
            bootLog("Initializing modules...");
            await window.ModuleLoader.initAll();

            bootLog("Mounting features...");
            const containers = {
                "Chat.feature":         document.getElementById("pane-left"),
                "FileExplorer.feature": document.getElementById("rightPaneContent"),
                "PartnerTicker.feature": document.getElementById("partnerTickerHost"),
                "AppShell.feature":     document.body,
                "ProjectManager.feature": document.body,
                "ModelManager.feature": document.body,
                "Settings.feature":     document.body
            };
            console.log("[app.js] Mount containers mapped:", Object.keys(containers));

            await window.ModuleLoader.mountAll(containers);
        }

        // ── Direct Chat mount fallback ────────────────────────
        // If ModuleLoader didn't mount Chat (e.g. a silent init
        // error), mount it directly so the UI is never empty.
        const paneLeft = document.getElementById("pane-left");
        if (paneLeft && !paneLeft.querySelector("#chat-feature-main")) {
            console.warn("[app.js] Chat not mounted by ModuleLoader — mounting directly to pane-left");
            if (window.ChatFeature?.mount) {
                await window.ChatFeature.mount(paneLeft);
            }
        }

        // ── Finalise ─────────────────────────────────────────
        bootLog("Ready");
        setTimeout(() => document.getElementById("boot-status")?.remove(), 2000);
        backend?.setBackendStatus("tauri");
    } catch (err) {
        console.error("[SDOA Init Error]", err);
        bootLog("Critical Error: " + err.message);
        backend?.setBackendStatus("unavailable", err.message);
    }
}

async function _waitForBridge(maxAttempts = 20, intervalMs = 500) {
    if (typeof window === "undefined" || !window.__TAURI__) return false;
    
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const status = await window.__TAURI__.core.invoke("engine_status");
            if (status === "ready") return true;
        } catch { /* not ready yet */ }
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
}

document.addEventListener("DOMContentLoaded", () => {
    init();
});
