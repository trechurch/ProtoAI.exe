// src-tauri/src/commands.rs

use std::sync::atomic::Ordering;

use serde_json::Value;
use tauri::State;

use crate::engine_bridge::BridgeState;

const NOT_READY: &str =
    "EngineBridge not ready — sidecar failed to start or is still initializing. \
     UI HTTP fallback (port 17890) should be active.";

const GIVEN_UP: &str =
    "Sidecar crashed too many times (threshold: 3). \
     Use the Reconnect button in the UI or call engine_reconnect.";

macro_rules! with_bridge {
    ($state:expr, |$b:ident| $body:expr) => {{
        if $state.given_up.load(Ordering::SeqCst) {
            return Err(GIVEN_UP.into());
        }
        let guard = $state.inner.lock().await;
        match guard.as_ref() {
            Some($b) => $body.await.map_err(|e: anyhow::Error| e.to_string()),
            None => Err(NOT_READY.into()),
        }
    }};
}

// -----------------------------
// engine_projects
// -----------------------------
#[tauri::command]
pub async fn engine_projects(bridge: State<'_, BridgeState>) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.projects())
}

// -----------------------------
// engine_history
// -----------------------------
#[tauri::command]
pub async fn engine_history(
    bridge: State<'_, BridgeState>,
    project: String,
) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.history(project))
}

// -----------------------------
// engine_profiles
// -----------------------------
#[tauri::command]
pub async fn engine_profiles(bridge: State<'_, BridgeState>) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.profiles())
}

// -----------------------------
// engine_chat
// -----------------------------
#[tauri::command]
pub async fn engine_chat(
    bridge: State<'_, BridgeState>,
    project: String,
    profile: String,
    engine: String,
    message: String,
) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.chat(project, profile, engine, message))
}

// -----------------------------
// engine_upload
// -----------------------------
#[tauri::command]
pub async fn engine_upload(
    bridge: State<'_, BridgeState>,
    project: String,
    filename: String,
    content: String,
) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.upload(project, filename, content))
}

// -----------------------------
// engine_ingest
// -----------------------------
#[tauri::command]
pub async fn engine_ingest(
    bridge: State<'_, BridgeState>,
    project: String,
) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.ingest(project))
}

// -----------------------------
// engine_status
// Returns: "ready" | "unavailable" | "crashed"
// -----------------------------
#[tauri::command]
pub async fn engine_status(state: State<'_, BridgeState>) -> Result<String, String> {
    if state.given_up.load(Ordering::SeqCst) {
        return Ok("crashed".into());
    }
    if state.inner.lock().await.is_some() {
        Ok("ready".into())
    } else {
        Ok("unavailable".into())
    }
}

// -----------------------------
// engine_reconnect
// Resets crash tracking and retries EngineBridge init.
// -----------------------------
#[tauri::command]
pub async fn engine_reconnect(
    app: tauri::AppHandle,
    state: State<'_, BridgeState>,
) -> Result<String, String> {
    use crate::engine_bridge::EngineBridge;

    // Reset crash tracking so the watchdog runs fresh
    state.crash_count.store(0, Ordering::SeqCst);
    state.given_up.store(false, Ordering::SeqCst);

    match EngineBridge::new(&app).await {
        Ok(bridge) => {
            *state.inner.lock().await = Some(bridge);
            state.spawn_watchdog(app);
            Ok("reconnected".into())
        }
        Err(e) => {
            // Failed immediately — give up again so the UI knows
            state.given_up.store(true, Ordering::SeqCst);
            Err(format!("Reconnect failed: {e}"))
        }
    }
}

// -----------------------------
// utility commands
// -----------------------------
#[tauri::command]
pub fn ping() -> String {
    "pong".into()
}

#[tauri::command]
pub fn get_status() -> String {
    "ok".into()
}
