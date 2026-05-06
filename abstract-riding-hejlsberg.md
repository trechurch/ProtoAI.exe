# Plan: Settings Dashboard + First-Run Wizard for ProtoAI

**Status:** ✅ IMPLEMENTED — `Settings.ui.js` (v3.0.1) contains full settings panel, first-run wizard, API key test, model management, profile selection, routing toggle, export/import. `SettingsManager.cjs` is live in the sidecar. `settings_complete_first_run` command exists in `commands.rs`. **Addition (2026-05-01):** Routing section added to settings (Settings → Routing tab + sidebar quick-toggle), backend `handleMultiModelSendIPC` now reads `settingsManager.get("routing")?.mode` and bypasses orchestrator when mode is `"single"` (default).

## Context

ProtoAI has no user-facing configuration system. API keys, models, and behavior are hardcoded (`ENGINES` array in `ui/app.js`) or live in repo-internal files (`cli/helpers/profiles.json`). A fresh user downloading a built `.exe` has no way to add their own API keys or customize behavior. We need a built-in settings panel and a first-run wizard that guides users through initial setup before they can use the app.

## Approach

Add a `SettingsManager` on the Node sidecar (persistent JSON store at `server/data/settings.json`), expose it via the existing IPC/HTTP channels, add Tauri commands in Rust, build a full settings modal + first-run wizard in the UI.

## Files to create (6)

1. **`server/lib/SettingsManager.js`** — Reads/writes `settings.json`, dot-notation get/set, API key validation (hits provider API with minimal request), defaults merging.

2. **`server/data/settings.json`** — Created by SettingsManager on first save, NOT committed. Shape:
```json
{
  "version": 1,
  "firstRunCompleted": false,
  "apiKeys": { "anthropic": "", "openai": "", "openrouter": "" },
  "models": {
    "enabled": ["anthropic/claude-3.5-sonnet", "anthropic/claude-opus-4.1", "openai/gpt-4o-mini", "qwen/qwen3.6-plus:free"],
    "defaults": { "default": "qwen/qwen3.6-plus:free", "coding": "anthropic/claude-3.5-sonnet" }
  },
  "profiles": { "defaultProfile": "default", "fallbackProfile": "analysis" },
  "ingestion": { "maxDepth": 4, "maxFileSizeMB": 10, "supportedExtensions": [".js",".ts",".py",".rs",".go",".md",".txt",".json",".html",".css"] },
  "backend": { "timeoutMs": 30000, "retryCount": 3, "fallbackBehavior": "http" },
  "spellcheck": { "enabled": true },
  "advanced": { "debugLogging": false }
}
```

3. **`ui/settings.js`** — Settings UI module: `openSettingsPanel()`, `closeSettingsPanel()`, `loadSettings()`, `saveSettings()`, `openFirstRunWizard()`, `closeFirstRunWizard()`, `navigateSettingsTab()`, `testApiKey()`

4. **`server/orchestration/workflows/TestKeyWorkflow.js`** — One-shot workflow that validates an API key by hitting `https://api.openai.com/v1/models` (or similar) with the provided key. Used by settings "Test" buttons.

5. **`.gitignore`** update — Add `server/data/settings.json` to prevents accidental commit

6. **`CARGO.toml`** — No changes needed (already has serde, serde_json, tokio)

## Files to modify (6)

1. **`server/server-ipc.js`** — Import SettingsManager, add `"settings"` case to `dispatchMessage()` switch. Three actions: `get` (export all), `set` (set key path), `testKey` (validate).

2. **`server/server.js`** — Import SettingsManager, add `/settings` GET/POST routes to the HTTP router, `/settings/test-key` POST route.

3. **`tauri-app/src-tauri/src/engine_bridge.rs`** — Add `get_settings()`, `set_settings(key, value)`, `test_api_key(provider, key)` methods on `EngineBridge` that call `self.send_request("settings", ...)`.

4. **`tauri-app/src-tauri/src/commands.rs`** — Add Tauri commands: `settings_get()`, `settings_set(key, value)`, `settings_first_run_status()`. Reuse existing `with_bridge!` macro.

5. **`tauri-app/src-tauri/src/main.rs`** — Register the three new commands in `invoke_handler`.

6. **`ui/index.html`** — Add settings modal DOM structure (tabs for API Keys, Models, Profiles, Folder Ingestion, Backend Tuning, Spellcheck, Advanced). Add `<script src="settings.js">`. Add first-run wizard DOM. Add CSS for settings overlay.

7. **`ui/styles.css`** — Add CSS for settings panel styling matching the existing dark theme.

8. **`ui/app.js`** — Add:
   - First-run detection at init time (calls `settings_first_run_status` Tauri command, shows wizard if false)
   - Keyboard shortcut `Ctrl+Shift+S` for settings
   - `"Open Settings"` entry in command palette (`Ctrl+K`)
   - Replace hardcoded `ENGINES` array with dynamic loading from settings (fallback to defaults if settings unavailable)

## UI structure

**First-Run Wizard** (500px modal, step-based):
- Step 1: Welcome — brief intro text, "Get Started"
- Step 2: API Keys — Anthropic, OpenAI, OpenRouter input fields with Test buttons
- Step 3: Default Model — select from available models
- Step 4: Done — "You're all set!" message, "Launch ProtoAI"

**Settings Dashboard** (800px modal, tabbed):
- Left nav bar with 7 sections
- API Keys: password inputs + Test buttons
- Models: checkboxes to enable/disable + default model select
- Profiles: default and fallback profile selects
- Folder Ingestion: max depth (number), max file size (number), extension checkboxes
- Backend: timeout (ms), retry count, fallback behavior select
- Spellcheck: toggle switch
- Advanced: debug logging toggle, export/import JSON

## Data flow

```
UI (settings.js)
  → Tauri IPC → Tauri Command → EngineBridge.send_request("settings", {...})
    → stdin/stdout JSON-lines → server-ipc.js → SettingsManager
  → or HTTP fallback → server.js /settings route → SettingsManager
```

## Verification

1. Run `cargo run` → first-run wizard should appear
2. Enter test key, click Test → green/red indicator
3. Complete wizard → main UI loads with selected model
4. Close app, reopen → wizard should NOT appear
5. `Ctrl+Shift+S` → settings modal opens
6. Change settings, save → close and reopen → changes persisted
7. `Ctrl+K` → "Open Settings" appears in command palette
