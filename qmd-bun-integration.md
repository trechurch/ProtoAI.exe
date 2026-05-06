# Plan: Bundle qmd & Adapt First-Run Wizard

**Status:** ✅ PARTIALLY IMPLEMENTED
- `QmdAdapter.js` and `IngestWorkflow.js` exist in `server/orchestration/workflows/`
- `server-ipc.cjs` has `ingest`, `qmd_index`, `qmd_search` IPC handlers wired in dispatcher
- `@tobilu/qmd` is optional — graceful "QMD not available" fallback is in place
- `settings_complete_first_run` Tauri command exists (`commands.rs:298`)
- 🔲 BunInstaller Windows adapter — status unknown, not verified
- 🔲 `completeWizard()` non-blocking fix in wizard — not verified against current `Settings.ui.js`

**Context:** Adding `@tobilu/qmd` (npm-based semantic search) to ProtoAI's existing Node.js sidecar, and wiring up the wizard + modules to use it. Also adapting the BunInstaller for Windows to work outside Tauri. Two separate concerns:
1. qmd integration — straightforward since it's an npm package and we already bundle Node.js
2. Bun adapter — Bun is only needed for the external module system, not for qmd itself
3. First-run wizard fix — wizard hangs because it retries settings save waiting for a sidecar that isn't fully up

## Part 1: Bundle qmd as npm dependency

### 1.1 Add `@tobilu/qmd` to server dependencies
**File:** `server/package.json`
- Add `"@tobilu/qmd": "^x.x.x"` to dependencies
- Run `npm install` in server/ to pull in node_modules

### 1.2 Create QmdAdapter for the current architecture
**New file:** `server/lib/QmdAdapter.js`

Replace the SDOA-framework-dependent `modules/adapters/QmdAdapter.js` with a standalone adapter that uses the same `require('@tobilu/qmd')` API or calls it via bundled `node.exe`:

```javascript
const { execFileSync } = require('child_process');
const path = require('path');

class QmdAdapter {
  constructor() { this.qmdPath = require.resolve('@tobilu/qmd/package.json'); }
}
```

Actually — cleaner approach: use `npx` with the bundled node.exe + node_modules path so we don't need a global install:

```javascript
const nodeExe = process.execPath; // bundled node.exe
const qmdPkg = require.resolve('@tobilu/qmd/bin/qmd'); // or similar entry
// Use child_process.spawn/fork to run qmd commands
```

We need to verify the actual qmd entry point after install. For now, use `npx @tobilu/qmd` with NODE_PATH pointing at server/node_modules.

### 1.3 Create IngestWorkflow using QmdAdapter
**New file:** `server/orchestration/workflows/IngestWorkflow.js`

Register it in `server/orchestration/workflows/registerWorkflows.js` (which is currently missing DeepSearch/ImageGen too).

### 1.4 Wire ingest to the engine bridge
**File:** `server/server-ipc.js` — add `ingest` message type handler that calls IngestWorkflow
**File:** `ui/app.js` — wire the "Ingest Code File" button (line ~1061) to call `engine_ingest` bridge command

## Part 2: Adapt BunInstaller.js for Windows

### 2.1 Create Windows-compatible Bun provisioner
**File:** `modules/adapters/BunInstaller.js` — update `install()` method to:
- Detect Windows (`os.platform() === 'win32'`)
- Download from `https://github.com/oven-sh/bun/releases/latest` (zip with `bun-windows-x64.zip` or similar)
- Extract to `${PROTOAI_ROOT}/bin/bun.exe`
- Add to child process PATH

This is a **standalone utility** that runs outside Tauri's sidecar. It's for users who want to run the modules/ directory independently. No Tauri integration needed — the Tauri app uses the Node.js sidecar for qmd (via npm), not Bun.

## Part 3: Adapt LlmPolicyEngine + RefactorService for Tauri

### 3.1 Create settings bridge
**New file:** `server/lib/LlmPolicyBridge.js`
- Combines LlmPolicyEngine.js logic with SettingsManager.js
- Uses the same `sdoa_llm_policy.json` config but also merges from ProtoAI's main settings

### 3.2 Wire RefactorService as a workflow
**File:** `server/orchestration/workflows/RefactorWorkflow.js` — adapts RefactorService.py logic to JS
- Uses QmdAdapter for context retrieval
- Uses SendMessageWorkflow for LLM generation
- Register in workflow registry

## Part 4: First-Run Wizard Fix

### 4.1 Add native `first_run_complete` Tauri command
**File:** `tauri-app/src-tauri/src/commands.rs`

Add a new command that directly reads/writes the settings file from Rust without going through the Node.js sidecar:

```rust
#[tauri::command]
pub async fn complete_first_run(bridge: State<'_, BridgeState>) -> Result<(), String> {
    // Direct file write or settings_set that the bridge handles even without sidecar
    with_bridge!(bridge, |b| b.set_settings("firstRunCompleted".into(), serde_json::json!(true)))?;
    Ok(())
}
```

Register in `main.rs`.

### 4.2 Update wizard completion
**File:** `ui/settings.js` — `completeWizard()` function (lines 327-360)

Change from retrying all settings through sidecar to:
1. Try `complete_first_run` Tauri command (doesn't depend on sidecar)
2. Save other settings via sidecar with best-effort (remove the 30-retry blocking loop)
3. Immediately close wizard and proceed to init

```javascript
async function completeWizard() {
    // 1. Mark first-run complete via native Tauri (no sidecar dependency)
    try {
        await window.__TAURI__.core.invoke("complete_first_run", {});
    } catch (_) {}

    // 2. Best-effort save remaining settings (no blocking retries)
    try {
        const settings = readAllFromUI();
        settings.firstRunCompleted = true;
        await window.__TAURI__.core.invoke("settings_set", { ... });
    } catch (_) {}

    // 3. Close and init main app immediately
    closeFirstRunWizard();
    init();
}
```

## Files to Modify

| File | Change |
|------|--------|
| `server/package.json` | Add `@tobilu/qmd` dependency |
| `server/lib/QmdAdapter.js` | **New** — standalone qmd adapter using bundled node |
| `server/orchestration/workflows/IngestWorkflow.js` | **New** — uses QmdAdapter |
| `server/orchestration/workflows/registerWorkflows.js` | Register IngestWorkflow |
| `server/server-ipc.js` | Add ingest message handler |
| `ui/app.js` | Wire ingest button to engine_ingest |
| `ui/settings.js` | Fix `completeWizard()` to not block on sidecar |
| `tauri-app/src-tauri/src/commands.rs` | Add `complete_first_run` command |
| `tauri-app/src-tauri/src/main.rs` | Register `complete_first_run` |
| `modules/adapters/BunInstaller.js` | Add Windows download logic |

## Verification

1. `npm install` in server/ — confirms qmd installs
2. `node -e "require('@tobilu/qmd')"` — confirms module loads
3. Run wizard, click "Skip" or "Launch" — should close immediately without hanging
4. Trigger ingest from UI — should call qmd and return results
5. Re-launch app — wizard should not reappear (firstRunCompleted = true)
