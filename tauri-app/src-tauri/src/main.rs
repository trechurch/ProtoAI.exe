#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod engine_bridge;
mod node_process_backend;

use tauri::Manager;
use engine_bridge::{EngineBridge, BridgeState};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandEvent;

const _VERSION: &str = "1.0.0";

// ------------------------------------------------------------
// One-shot Workflow Bridge (Tauri → Sidecar Node → tauri-entry.cjs)
// ------------------------------------------------------------
#[tauri::command]
async fn run_workflow(app: tauri::AppHandle, name: String, payload: String) -> Result<String, String> {
    use tauri::Manager;

    // Locate the server directory — same logic as NodeProcessBackend::new().
    let resource_server = app.path().resource_dir()
        .map_err(|e| e.to_string())?
        .join("server");

    let server_dir = if resource_server.join("tauri-entry.cjs").exists() {
        resource_server
    } else {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut candidate = exe.parent()
            .ok_or_else(|| "Cannot get exe parent dir".to_string())?;
        loop {
            let try_path = candidate.join("server");
            if try_path.join("tauri-entry.cjs").exists() {
                break try_path;
            }
            candidate = candidate.parent()
                .ok_or_else(|| format!("tauri-entry.cjs not found near {}", exe.display()))?;
        }
    };

    let script_path = server_dir.join("tauri-entry.cjs");
    let script_path_str = script_path.to_str()
        .ok_or("Failed to convert script path to string")?;

    let protoai_root = server_dir.parent()
        .unwrap_or(&server_dir)
        .to_str().unwrap_or("").to_owned();

    println!("[Workflow] Running: {name}");

    let sidecar_command = app.shell().sidecar("node")
        .map_err(|e| format!("Failed to find node sidecar: {}", e))?
        .arg(script_path_str)
        .arg("--workflow").arg(&name)
        .arg("--payload").arg(&payload)
        .env("PROTOAI_ROOT", &protoai_root)
        .env("NODE_PATH", server_dir.join("node_modules").to_str().unwrap_or(""));

    let (mut rx, _child) = sidecar_command.spawn()
        .map_err(|e| format!("Failed to spawn Sidecar process: {}", e))?;

    // Collect output with a hard 30s timeout
    let collect = async {
        let mut stdout_parts: Vec<String> = Vec::new();
        let mut stderr_parts: Vec<String> = Vec::new();
        let mut exit_code: i32 = 0;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    stdout_parts.push(String::from_utf8_lossy(&bytes).to_string());
                }
                CommandEvent::Stderr(bytes) => {
                    stderr_parts.push(String::from_utf8_lossy(&bytes).to_string());
                }
                CommandEvent::Terminated(payload) => {
                    exit_code = payload.code.unwrap_or(0);
                    break;
                }
                CommandEvent::Error(e) => {
                    return Err(format!("Sidecar error: {}", e));
                }
                _ => {}
            }
        }

        Ok((stdout_parts.join(""), stderr_parts.join(""), exit_code))
    };

    let (stdout, stderr, exit_code) = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        collect,
    )
    .await
    .map_err(|_| "Workflow timed out after 30s".to_string())??;

    if exit_code != 0 {
        eprintln!("[Workflow] Failed (exit {}): {}", exit_code, stderr);
        return Err(format!("Workflow error: {}", stderr));
    }

    println!("[Workflow] Success");
    Ok(stdout)
}

// ------------------------------------------------------------
// Tauri App Entry
// ------------------------------------------------------------
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Register BridgeState immediately — commands always have a State to deref.
            // The inner Option starts as None and is populated once the sidecar inits.
            let bridge_state = BridgeState::new();
            app.manage(bridge_state.clone());

            let app_handle = app.handle().clone();
            let bridge_arc = bridge_state.inner.clone();

            tauri::async_runtime::spawn(async move {
                match EngineBridge::new(&app_handle).await {
                    Ok(bridge) => {
                        *bridge_arc.lock().await = Some(bridge);
                        println!("[ProtoAI] EngineBridge initialized");
                        // Watchdog monitors for crashes, auto-restarts up to 3×
                        bridge_state.spawn_watchdog(app_handle);
                    }
                    Err(err) => {
                        eprintln!("[ProtoAI] Failed to initialize EngineBridge: {err}");
                        eprintln!("[ProtoAI] UI HTTP fallback (port 17890) will be used.");
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            run_workflow,
            commands::ping,
            commands::get_status,
            commands::engine_status,
            commands::engine_reconnect,
            commands::engine_projects,
            commands::engine_history,
            commands::engine_profiles,
            commands::engine_chat,
            commands::engine_upload,
            commands::engine_ingest,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ProtoAI Tauri application");
}
