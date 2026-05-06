# Plan: Bulletproof ProtoAI Reliability

**Status:** ✅ IMPLEMENTED — `engine_reconnect`, `spawn_watchdog`, `crash_count`, `given_up` all present in `engine_bridge.rs` and `commands.rs`. `fetchWithTimeout`, `setBackendStatus`, `showReconnectButton` present in `app.js`. See verification steps for remaining smoke-test items.

## Context
ProtoAI's Tauri/Node.js sidecar IPC has several failure modes that leave the app permanently broken until manual restart, silently hang the UI for 60s, or drop messages. This plan adds auto-restart with crash threshold, a manual reconnect escape hatch, tooltip status, and fixes 6 other high-impact failure points.

---

## Problems Being Fixed

| # | Problem | Current UX | Fix |
|---|---------|-----------|-----|
| 1 | `console.log` in server-ipc.js corrupts stdout JSON-lines | Parse errors on every startup | Redirect all console.log → stderr |
| 2 | Node process dies → pending requests hang 60s | UI frozen til timeout | Drain pending senders on Terminated |
| 3 | Node process dies → bridge dead forever | All commands fail until app restart | Auto-restart watchdog (max 3 attempts, backoff 2→4→8s) |
| 4 | After 3 crashes → stuck with no recovery option | User must force-quit | Manual `engine_reconnect` command + UI button |
| 5 | Unhandled async exceptions in server-ipc.js crash Node silently | Request times out with no info | `uncaughtException` + `unhandledRejection` → exit(1) cleanly |
| 6 | `run_workflow` has no timeout | Can hang indefinitely | 30s `tokio::time::timeout` wrapper |
| 7 | HTTP fetch has no timeout | Can hang indefinitely | `fetchWithTimeout` helper using AbortController |
| 8 | UI shows no backend status | User can't tell which backend is active | Tooltip on `#currentProfileName` badge |
| 9 | Ingest: one unreadable file fails all | Full error instead of partial results | Per-file try/catch, skip unreadable files |

---

## Files to Modify

1. `server/server-ipc.js`
2. `tauri-app/src-tauri/src/node_process_backend.rs`
3. `tauri-app/src-tauri/src/engine_bridge.rs`
4. `tauri-app/src-tauri/src/commands.rs`
5. `tauri-app/src-tauri/src/main.rs`
6. `ui/app.js`

---

## Implementation

### 1. `server/server-ipc.js`

**a) Redirect console.log → stderr at the very top of the file** (before any other code) so startup banners and debug logs never enter the JSON-lines stdout stream:
```js
console.log = (...args) => console.error(...args);
```
Remove the `console.log(...)` call inside the existing `log()` helper (already writes to file).

**b) Process-level crash handlers** — exit cleanly so Rust watchdog restarts rather than leaving a zombie:
```js
process.on("uncaughtException", (err) => {
  console.error("[server-ipc] uncaughtException:", err);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  console.error("[server-ipc] unhandledRejection:", reason);
  process.exit(1);
});
```

**c) Per-file safety in handleIngestIPC** — wrap each `fs.readFileSync` in try/catch, push a `{ filename, error }` entry for unreadable files and continue.

---

### 2. `node_process_backend.rs`

Add an exit notification channel. Refactor `new()` to create a `oneshot` channel, store the sender in the struct, hand the receiver to the caller (via a two-field return or a `take_exit_rx` method stored as `Option`).

**Struct change:**
```rust
pub struct NodeProcessBackend {
    child: CommandChild,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<IpcResponse>>>>,
    exit_tx: Option<oneshot::Sender<()>>,   // NEW: fires when process dies
}
```

**On Terminated in reader loop** — drain all pending (drops senders → instant `RecvError` in callers instead of 60s wait), then fire exit signal:
```rust
CommandEvent::Terminated(_) => {
    pending.lock().await.clear();   // unblock all waiting send_message callers
    let _ = exit_tx_slot.lock().await.take().map(|tx| tx.send(()));
    break;
}
```

**Public method:**
```rust
pub fn take_exit_rx(&mut self) -> Option<oneshot::Receiver<()>> {
    self.exit_rx.take()   // stored alongside exit_tx during new()
}
```

---

### 3. `engine_bridge.rs`

**Expand BridgeState to carry crash tracking:**
```rust
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

#[derive(Clone)]
pub struct BridgeState {
    pub inner:       Arc<Mutex<Option<EngineBridge>>>,
    pub crash_count: Arc<AtomicU32>,
    pub given_up:    Arc<AtomicBool>,
}
```

**EngineBridge holds the exit receiver:**
```rust
pub struct EngineBridge {
    backend:  EngineBackend,
    exit_rx:  Option<oneshot::Receiver<()>>,
}
impl EngineBridge {
    pub fn take_exit_rx(&mut self) -> Option<oneshot::Receiver<()>> {
        self.exit_rx.take()
    }
}
```

**Watchdog on BridgeState** (spawned after every successful init):
```rust
const MAX_CRASHES: u32 = 3;

impl BridgeState {
    pub fn spawn_watchdog(&self, app: AppHandle) {
        let arc         = self.inner.clone();
        let crash_count = self.crash_count.clone();
        let given_up    = self.given_up.clone();

        tauri::async_runtime::spawn(async move {
            let mut delay_secs = 2u64;
            loop {
                // Wait for the current process to die
                let exit_rx = arc.lock().await.as_mut().and_then(|b| b.take_exit_rx());
                if let Some(rx) = exit_rx { let _ = rx.await; }

                *arc.lock().await = None;
                let count = crash_count.fetch_add(1, Ordering::SeqCst) + 1;
                eprintln!("[Watchdog] Sidecar died (crash #{count}/{MAX_CRASHES})");

                if count >= MAX_CRASHES {
                    given_up.store(true, Ordering::SeqCst);
                    eprintln!("[Watchdog] Threshold reached. Use Reconnect button to retry.");
                    break;
                }

                tokio::time::sleep(Duration::from_secs(delay_secs)).await;
                delay_secs = (delay_secs * 2).min(60);

                match EngineBridge::new(&app).await {
                    Ok(bridge) => {
                        delay_secs = 2;
                        *arc.lock().await = Some(bridge);
                        eprintln!("[Watchdog] Sidecar restarted successfully");
                        // Loop continues to watch new process
                    }
                    Err(e) => eprintln!("[Watchdog] Restart attempt failed: {e}"),
                }
            }
        });
    }
}
```

**`engine_status` now reflects three states:**
- `"ready"` — bridge is Some
- `"crashed"` — given_up is true (threshold hit, manual reconnect needed)
- `"unavailable"` — None but not given up (between restarts / still initializing)

---

### 4. `commands.rs`

**Update `engine_status`** to use the new fields:
```rust
#[tauri::command]
pub async fn engine_status(state: State<'_, BridgeState>) -> String {
    if state.given_up.load(Ordering::SeqCst) { return "crashed".into(); }
    if state.inner.lock().await.is_some() { "ready".into() } else { "unavailable".into() }
}
```

**Add `engine_reconnect` command:**
```rust
#[tauri::command]
pub async fn engine_reconnect(
    app: tauri::AppHandle,
    state: State<'_, BridgeState>,
) -> Result<String, String> {
    // Reset crash tracking
    state.crash_count.store(0, Ordering::SeqCst);
    state.given_up.store(false, Ordering::SeqCst);

    match EngineBridge::new(&app).await {
        Ok(bridge) => {
            *state.inner.lock().await = Some(bridge);
            state.spawn_watchdog(app);
            Ok("reconnected".into())
        }
        Err(e) => {
            state.given_up.store(true, Ordering::SeqCst);
            Err(format!("Reconnect failed: {e}"))
        }
    }
}
```

Update `NOT_READY` macro to reference correct field (`state.inner`).
Register `engine_reconnect` in `invoke_handler`.

---

### 5. `main.rs`

**After successful init, spawn watchdog:**
```rust
Ok(bridge) => {
    *bridge_arc.lock().await = Some(bridge);
    bridge_state.spawn_watchdog(app_handle.clone());  // NEW
    println!("[ProtoAI] EngineBridge initialized");
}
```

**Add 30s timeout to `run_workflow` event loop:**
```rust
let result = tokio::time::timeout(
    Duration::from_secs(30),
    async {
        while let Some(event) = rx.recv().await {
            // existing match arms
        }
        Ok::<_, String>((stdout_parts.join(""), stderr_parts.join(""), exit_code))
    }
).await.map_err(|_| "Workflow timed out after 30s".to_string())??;
let (stdout, stderr, exit_code) = result;
```

Update `BridgeState::new()` call site: `BridgeState { inner: Arc::new(...), crash_count: Arc::new(AtomicU32::new(0)), given_up: Arc::new(AtomicBool::new(false)) }`.

---

### 6. `ui/app.js`

**a) `fetchWithTimeout` helper:**
```js
async function fetchWithTimeout(url, opts = {}, ms = 30_000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
        clearTimeout(timer);
    }
}
```
Replace all `fetch(...)` calls in `httpFallback` with `fetchWithTimeout(...)`.

**b) Backend status tooltip on `#currentProfileName`:**
```js
function setBackendStatus(mode, detail = "") {
    const badge = document.getElementById("currentProfileName");
    if (!badge) return;
    const labels = {
        tauri:    "Backend: Tauri IPC (sidecar active)",
        http:     "Backend: HTTP fallback — port 17890",
        crashed:  "Sidecar crashed (3/3). Click Reconnect.",
        offline:  "Backend offline",
    };
    badge.title = detail ? `${labels[mode] ?? mode}\n${detail}` : (labels[mode] ?? mode);
    badge.dataset.backendMode = mode;
}
```
Call `setBackendStatus("tauri")` / `setBackendStatus("http")` inside `runWorkflow` when the active path is determined. Call `setBackendStatus("crashed")` when `engine_status` returns `"crashed"`.

**c) Show inline Reconnect button when bridge is crashed:**
```js
function showReconnectButton() {
    if (!TAURI_AVAILABLE) return;
    const btn = document.createElement("button");
    btn.textContent = "Reconnect Sidecar";
    btn.className = "secondary";
    btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = "Reconnecting…";
        try {
            await window.__TAURI__.core.invoke("engine_reconnect");
            setBackendStatus("tauri");
            btn.remove();
        } catch (err) {
            btn.textContent = "Reconnect failed — try again";
            btn.disabled = false;
            showError(`Reconnect failed: ${err}`);
        }
    };
    chatContainer.appendChild(btn);
}
```
Call `showReconnectButton()` when `runWorkflow` detects status is `"crashed"`.

---

## Verification

1. `cargo build` — clean compile
2. `cargo run` — confirm "[ProtoAI] EngineBridge initialized" and "[Watchdog] watching"  
3. Kill the sidecar: `taskkill /IM node-x86_64-pc-windows-msvc.exe /F` — watch console for "[Watchdog] Sidecar died (crash #1/3)" + automatic restart within ~2s
4. Kill it 3 times total — confirm "[Watchdog] Threshold reached" + Reconnect button appears in UI chat area
5. Click Reconnect — confirm "[ProtoAI] EngineBridge initialized" again, button disappears
6. Test `run_workflow` 30s timeout: add a long `setTimeout` in a workflow, confirm Tauri command returns "timed out" at ~30s
7. Test HTTP fetch timeout: use browser devtools to throttle network to "offline", confirm fetch fails with AbortError within 30s rather than hanging
8. Hover the profile badge — confirm tooltip shows current backend mode
