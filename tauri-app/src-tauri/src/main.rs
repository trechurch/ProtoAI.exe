#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod engine_bridge;
mod node_process_backend;

use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use engine_bridge::{EngineBridge, BridgeState};

// Managed state for the --setup-wizard launch flag
pub struct LaunchFlags {
    pub setup_wizard: bool,
}

#[tauri::command]
fn get_launch_flags(flags: tauri::State<'_, LaunchFlags>) -> serde_json::Value {
    serde_json::json!({ "setupWizard": flags.setup_wizard })
}

// ------------------------------------------------------------
// One-shot Workflow Bridge (Tauri → Sidecar Node → tauri-entry.cjs)
// ------------------------------------------------------------
#[tauri::command]
async fn run_workflow(app: tauri::AppHandle, name: String, payload: String) -> Result<String, String> {
    let resource_server = app.path().resource_dir()
        .map_err(|e| e.to_string())?
        .join("server");

    let server_dir = if resource_server.join("tauri-entry.cjs").exists() {
        resource_server
    } else {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        exe.parent().unwrap().to_path_buf()
    };

    let payload_json: serde_json::Value = serde_json::from_str(&payload).unwrap_or(serde_json::json!({}));

    // Logic to execute the node sidecar via tauri-plugin-shell
    let output = app.shell().command("node")
        .args([
            server_dir.join("tauri-entry.cjs").to_string_lossy().to_string(),
            name,
            payload_json.to_string(),
        ])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn main() {
    // Detect --setup-wizard flag from CLI args
    let args: Vec<String> = std::env::args().collect();
    let setup_wizard = args.contains(&"--setup-wizard".to_string());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(LaunchFlags { setup_wizard })
        .manage(BridgeState::new())
        .setup(|app| {
            // 1. Get a cloned handle that is 'static and owned
            let handle = app.handle().clone(); 
            
            // 2. Get the state and clone the inner Arc/Reference
            let state = app.state::<BridgeState>().inner().clone();

            tauri::async_runtime::spawn(async move {
                // Now 'handle' and 'state' are owned by this block
                match EngineBridge::new(&handle).await {
                    Ok(bridge) => {
                        let mut inner = state.inner.lock().await;
                        *inner = Some(bridge);
                        drop(inner); // release lock before spawning watchdog
                        state.spawn_watchdog(handle);
                    }
                    Err(e) => {
                        eprintln!("[Setup] Failed to initialize EngineBridge: {}", e);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Global Root Commands
            run_workflow,
            get_launch_flags,

            // File System Governance
            commands::get_project_dir,
            commands::fs_read_file,
            commands::fs_write_file,
            commands::fs_rename,
            commands::fs_copy,
            commands::fs_unlink,
            commands::fs_remove,
            commands::fs_mkdir,
            commands::fs_stat,
            commands::fs_list_dir,

            // Engine & Settings Management
            commands::ping,
            commands::get_status,
            commands::engine_ipc,
            commands::engine_status,
            commands::engine_reconnect,
            commands::engine_projects,
            commands::engine_history,
            commands::engine_profiles,
            commands::engine_chat,
            commands::engine_chat_stream,
            commands::engine_upload,
            commands::engine_ingest,
            commands::engine_image_gen,
            commands::engine_deep_search,
            commands::engine_qmd_index,
            commands::engine_qmd_search,
            commands::settings_get,
            commands::settings_set,
            commands::settings_test_key,
            commands::settings_first_run_status,
            commands::settings_complete_first_run,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ProtoAI Tauri application");
}