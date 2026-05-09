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

        const sidebarStatus = document.getElementById("sidebarStatusText");
        if (sidebarStatus) sidebarStatus.textContent = "Connecting…";

        // Hard 5-second safety timeout for the bridge
        const ready = await Promise.race([
            _waitForBridge(),
            new Promise(r => setTimeout(() => r(false), 5000))
        ]);

        if (!ready) {
            console.warn("[app.js] Engine bridge UNRESPONSIVE — booting in degraded mode");
            backend?.setBackendStatus("unavailable", "Engine Deadlock");
        } else {
            backend?.setBackendStatus("tauri");
        }

        if (sidebarStatus) {
            sidebarStatus.textContent = ready ? "Tauri IPC" : "Disconnected";
            const dot = document.getElementById("statusDot");
            if (dot) dot.style.background = ready ? "var(--color-ok)" : "var(--color-error)";
        }

        // ── SDOA v4 Boot ──────────────────────────────────────
        if (window.ModuleLoader) {
            bootLog("Initializing modules...");
            await window.ModuleLoader.initAll();

            bootLog("Mounting UI...");
            const containers = {
                "Chat.feature":         document.getElementById("pane-left"),
                "FileExplorer.feature": document.getElementById("rightPaneContent"),
                "PartnerTicker.feature": document.getElementById("partnerTickerHost"),
                "AppShell.feature":     document.body,
                "ProjectManager.feature": document.body,
                "ModelManager.feature": document.body,
                "Settings.feature":     document.body
            };

            await window.ModuleLoader.mountAll(containers);
        }

        bootLog("Ready");
        setTimeout(() => document.getElementById("boot-status")?.remove(), 1000);
    } catch (err) {
        console.error("[app.js] Critical Boot failure:", err);
        bootLog("Error: " + err.message);
    }
}

async function _waitForBridge(maxAttempts = 10, intervalMs = 500) {
    if (!window.__TAURI__) return false;
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const status = await window.__TAURI__.core.invoke("engine_status").catch(() => null);
            if (status === "ready") return true;
        } catch { /* spin */ }
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
}

document.addEventListener("DOMContentLoaded", () => {
    init();
});
