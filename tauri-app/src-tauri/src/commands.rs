// src-tauri/src/commands.rs

use serde_json::Value;
use tauri::State;
use crate::engine_bridge::BridgeState;

/// Macro to safely extract the bridge and run a block of code.
/// This avoids closure lifetime issues by executing the block directly in the macro scope.
macro_rules! with_bridge {
    ($bridge:expr, |$b:ident| $action:expr) => {{
        let inner = $bridge.inner.lock().await;
        match &*inner {
            Some($b) => {
                $action.await.map_err(|e: anyhow::Error| e.to_string())
            },
            None => Err("Engine bridge not initialized. Try reconnecting.".to_string()),
        }
    }};
}

// ---------------------------------------------------------------
// Engine & Workflow Management
// ---------------------------------------------------------------

#[tauri::command]
pub fn ping() -> String { "pong".into() }

#[tauri::command]
pub fn get_status() -> String { "ok".into() }

#[tauri::command]
pub async fn engine_status(bridge: State<'_, BridgeState>) -> Result<String, String> {
    if bridge.given_up.load(std::sync::atomic::Ordering::Relaxed) {
        return Ok("crashed".to_string());
    }
    let inner = bridge.inner.lock().await;
    if inner.is_some() { Ok("ready".to_string()) } else { Ok("initializing".to_string()) }
}

#[tauri::command]
pub async fn engine_reconnect(app: tauri::AppHandle, bridge: State<'_, BridgeState>) -> Result<(), String> {
    bridge.crash_count.store(0, std::sync::atomic::Ordering::Relaxed);
    bridge.given_up.store(false, std::sync::atomic::Ordering::Relaxed);
    
    match crate::engine_bridge::EngineBridge::new(&app).await {
        Ok(b) => {
            let mut inner = bridge.inner.lock().await;
            *inner = Some(b);
            bridge.spawn_watchdog(app);
            Ok(())
        }
        Err(e) => Err(e.to_string())
    }
}

// ---------------------------------------------------------------
// File-system Layer
// ---------------------------------------------------------------

#[tauri::command]
pub fn get_project_dir(project: String) -> Result<String, String> {
    let root = std::env::var("PROTOAI_ROOT").unwrap_or_else(|_| ".".into());
    let dir = std::path::Path::new(&root).join("data").join("projects").join(&project);
    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command] 
pub fn fs_read_file(path: String) -> Result<String, String> { 
    std::fs::read_to_string(&path).map_err(|e| e.to_string()) 
}

#[tauri::command] 
pub fn fs_write_file(path: String, content: String) -> Result<(), String> { 
    std::fs::write(&path, content).map_err(|e| e.to_string()) 
}

#[tauri::command] 
pub fn fs_rename(old_path: String, new_path: String) -> Result<(), String> { 
    std::fs::rename(old_path, new_path).map_err(|e| e.to_string()) 
}

#[tauri::command] 
pub fn fs_unlink(path: String) -> Result<(), String> { 
    std::fs::remove_file(path).map_err(|e| e.to_string()) 
}

#[tauri::command] 
pub fn fs_mkdir(path: String) -> Result<(), String> { 
    std::fs::create_dir_all(path).map_err(|e| e.to_string()) 
}

#[tauri::command]
pub fn fs_copy(source: String, destination: String) -> Result<(), String> {
    std::fs::copy(source, destination)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_remove(path: String) -> Result<(), String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        std::fs::remove_dir_all(path).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn fs_stat(path: String) -> Result<Value, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({
        "is_dir": meta.is_dir(),
        "size": meta.len(),
        "readonly": meta.permissions().readonly()
    }))
}// ---------------------------------------------------------------
// File-system — directory listing (for VFS file picker)
// ---------------------------------------------------------------

#[tauri::command]
pub fn fs_list_dir(path: String) -> Result<serde_json::Value, String> {
    let dir = std::path::Path::new(&path);
    if !dir.exists() {
        return Err(format!("Path does not exist: {}", path));
    }
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", path));
    }

    let mut files   = Vec::new();
    let mut folders = Vec::new();

    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let meta     = match entry.metadata() { Ok(m) => m, Err(_) => continue };
        let name     = entry.file_name().to_string_lossy().to_string();
        let full     = entry.path().to_string_lossy().to_string();
        let modified = meta.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        if name.starts_with(".protoai-") { continue; }

        if meta.is_dir() {
            folders.push(serde_json::json!({
                "name": name, "path": full, "type": "directory",
                "modified": modified
            }));
        } else {
            files.push(serde_json::json!({
                "name": name, "path": full, "type": "file",
                "size": meta.len(), "modified": modified
            }));
        }
    }

    // Sort: folders first alphabetically, then files alphabetically
    folders.sort_by(|a, b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
    files.sort_by(|a,   b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));

    Ok(serde_json::json!({
        "path":    path,
        "parent":  dir.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default(),
        "folders": folders,
        "files":   files,
        "total":   folders.len() + files.len()
    }))
}

// ---------------------------------------------------------------
// Generic IPC passthrough — sends any message type to Node sidecar
// Used for VFS workflows and any future workflow types
// ---------------------------------------------------------------

#[tauri::command]
pub async fn engine_ipc(bridge: State<'_, BridgeState>, msg_type: String, payload: Value) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.ipc(msg_type, payload))
}

// ---------------------------------------------------------------
// Engine Pass-through
// ---------------------------------------------------------------

#[tauri::command]
pub async fn engine_projects(bridge: State<'_, BridgeState>) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.projects())
}

#[tauri::command]
pub async fn engine_history(bridge: State<'_, BridgeState>, project: String) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.history(project))
}

#[tauri::command]
pub async fn engine_profiles(bridge: State<'_, BridgeState>) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.profiles())
}

#[tauri::command]
pub async fn engine_chat(bridge: State<'_, BridgeState>, project: String, profile: String, engine: String, text: String) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.chat(project, profile, engine, text))
}

#[tauri::command]
pub async fn engine_chat_stream(bridge: State<'_, BridgeState>, project: String, profile: String, engine: String, text: String) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.chat_stream(project, profile, engine, text))
}

#[tauri::command]
pub async fn engine_upload(bridge: State<'_, BridgeState>, project: String, file_path: String, content: String) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.upload(project, file_path, content))
}

#[tauri::command]
pub async fn engine_ingest(bridge: State<'_, BridgeState>, project: String) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.ingest(project))
}

#[tauri::command]
pub async fn engine_image_gen(bridge: State<'_, BridgeState>, prompt: String, project: String) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.image_gen(prompt, project))
}

#[tauri::command]
pub async fn engine_deep_search(bridge: State<'_, BridgeState>, query: String) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.deep_search(query))
}

#[tauri::command]
pub async fn engine_qmd_index(bridge: State<'_, BridgeState>, project: String, deep_scan: bool) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.qmd_index(project, deep_scan))
}

#[tauri::command]
pub async fn engine_qmd_search(bridge: State<'_, BridgeState>, query: String, project: String) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.qmd_search(query, project))
}

// ---------------------------------------------------------------
// Settings
// ---------------------------------------------------------------

#[tauri::command]
pub async fn settings_get(bridge: State<'_, BridgeState>) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.get_settings())
}

#[tauri::command]
pub async fn settings_set(bridge: State<'_, BridgeState>, key: String, value: Value) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.set_settings(key, value))
}

#[tauri::command]
pub async fn settings_test_key(bridge: State<'_, BridgeState>, provider: String, key: String) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.test_api_key(provider, key))
}

#[tauri::command]
pub async fn settings_first_run_status(bridge: State<'_, BridgeState>) -> Result<Value, String> {
    let settings = with_bridge!(bridge, |b| b.get_settings())?;
    Ok(serde_json::json!({
        "firstRunCompleted": settings["firstRunCompleted"].as_bool().unwrap_or(false)
    }))
}

#[tauri::command]
pub async fn settings_complete_first_run(bridge: State<'_, BridgeState>) -> Result<Value, String> {
    with_bridge!(bridge, |b| b.set_settings("firstRunCompleted".to_string(), Value::Bool(true)))
}