use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tokio::sync::{Mutex, oneshot};
use tokio::time::timeout;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
struct IpcRequest {
    id: String,
    #[serde(rename = "type")]
    msg_type: String,
    payload: Value,
}

#[derive(Debug, Serialize, Deserialize)]
struct IpcResponse {
    id: String,
    ok: bool,
    #[serde(default)]
    data: Option<Value>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    detail: Option<String>,
    // Present on streaming chunk messages — JSON key is "type"
    #[serde(default, rename = "type")]
    msg_type: Option<String>,
    #[serde(default)]
    chunk: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct StreamChunkEvent {
    id: String,
    chunk: String,
}

pub struct NodeProcessBackend {
    child: CommandChild,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<IpcResponse>>>>,
    /// Fires once when the sidecar process terminates. Returns the exit code if available.
    exit_rx: Option<oneshot::Receiver<Option<i32>>>,
}

impl NodeProcessBackend {
    pub async fn new(app: &AppHandle) -> Result<Self> {
        // Resolve the server directory. We prefer the resource-dir copy, but
        // fall back to a path relative to the executable (dev layout).
        // ── server_dir resolution ─────────────────────────────
        // Priority order:
        //   1. Tauri resource_dir/server  (production — bundled resources)
        //   2. src-tauri/resources/server (dev — source layout)
        //   3. Walk up from exe           (fallback)
        // ── end of server_dir resolution ─────────────────────

        let resource_server = app
            .path()
            .resource_dir()
            .map_err(|e| anyhow!("Failed to resolve resource dir: {}", e))?
            .join("server");

        let server_dir = if resource_server.join("index.cjs").exists() {
            // Production: resources bundled by Tauri
            resource_server
        } else {
            // Dev: try src-tauri/resources/server relative to the manifest dir.
            // CARGO_MANIFEST_DIR is set by cargo at compile time and always
            // points to src-tauri/ regardless of where the exe ends up.
            let dev_path = std::path::PathBuf::from(
                env!("CARGO_MANIFEST_DIR")
            ).join("resources").join("server");

            if dev_path.join("index.cjs").exists() {
                dev_path
            } else {
                // Last resort: walk up from exe
                let exe = std::env::current_exe()
                    .map_err(|e| anyhow!("Cannot determine exe path: {}", e))?;
                let mut candidate = exe.parent()
                    .ok_or_else(|| anyhow!("Cannot get exe parent dir"))?;
                loop {
                    let try_path = candidate.join("server");
                    if try_path.join("index.cjs").exists() {
                        break try_path;
                    }
                    candidate = candidate.parent()
                        .ok_or_else(|| anyhow!("index.cjs not found in any ancestor of {}", exe.display()))?;
                }
            }
        };

        let server_ipc = server_dir.join("index.cjs");
        let script_path = server_ipc
            .to_str()
            .ok_or_else(|| anyhow!("Failed to convert script path to string"))?
            .to_owned();

        // PROTOAI_ROOT tells paths.js where data/ lives (repo root, two levels
        // above the server/ directory).
        // PROTOAI_ROOT must point to the repo root where data/ lives.
        // server/ is at resources/server/ — so we need to go up:
        //   resources/server/ -> resources/ -> src-tauri/ -> tauri-app/ -> protoai/ (repo root)
        // In dev: server_dir = src-tauri/resources/server, root = src-tauri/../.. = tauri-app/..
        // In prod: server_dir = resource_dir/server, root = same walk
        let protoai_root = server_dir
            .parent()                    // resources/  (or resource_dir/)
            .and_then(|p| p.parent())    // src-tauri/  (or app bundle root)
            .and_then(|p| p.parent())    // tauri-app/
            .and_then(|p| p.parent())    // protoai/  (repo root — has data/)
            .unwrap_or(&server_dir)
            .to_str()
            .unwrap_or("")
            .to_owned();

        eprintln!("[NodeProcessBackend] script: {script_path}");
        eprintln!("[NodeProcessBackend] PROTOAI_ROOT: {protoai_root}");

        let (rx, child) = app
            .shell()
            .sidecar("node")
            .map_err(|e| anyhow!("Failed to find node sidecar: {}", e))?
            .arg(&script_path)
            .env("PROTOAI_ROOT", &protoai_root)
            .env("NODE_PATH", {
                // Include all likely node_modules locations.
                // The server's own node_modules is always first (highest priority).
                let server_nm = server_dir.join("node_modules");
                let root_nm   = std::path::PathBuf::from(&protoai_root).join("node_modules");
                let app_nm    = std::path::PathBuf::from(&protoai_root).join("tauri-app").join("node_modules");
                [
                    server_nm.to_str().unwrap_or(""),
                    root_nm.to_str().unwrap_or(""),
                    app_nm.to_str().unwrap_or(""),
                ].join(";")
            })
            .spawn()
            .map_err(|e| anyhow!("Failed to spawn node sidecar: {}", e))?;

        let pending = Arc::new(Mutex::new(HashMap::new()));

        // Exit signal: fires when the reader loop sees Terminated
        let (exit_tx, exit_rx) = oneshot::channel::<Option<i32>>();
        let exit_tx_shared = Arc::new(Mutex::new(Some(exit_tx)));

        Self::start_reader_loop(rx, pending.clone(), exit_tx_shared, app.clone());

        Ok(NodeProcessBackend {
            child,
            pending,
            exit_rx: Some(exit_rx),
        })
    }

    /// Per-message-type timeouts so fast ops don't block behind a hung chat.
    fn timeout_for(msg_type: &str) -> Duration {
        match msg_type {
            "projects" | "profiles" => Duration::from_secs(10),
            "ingest" | "history" | "upload" => Duration::from_secs(15),
            "chat" | "image_gen" | "deep_search" | "qmd_index" | "multi_model_send" => Duration::from_secs(180),
            _ => Duration::from_secs(30),
        }
    }

    fn start_reader_loop(
        mut rx: tokio::sync::mpsc::Receiver<CommandEvent>,
        pending: Arc<Mutex<HashMap<String, oneshot::Sender<IpcResponse>>>>,
        exit_tx: Arc<Mutex<Option<oneshot::Sender<Option<i32>>>>>,
        app: AppHandle,
    ) {
        tokio::spawn(async move {
            while let Some(event) = rx.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        let line = String::from_utf8_lossy(&bytes);
                        let line = line.trim();
                        if line.is_empty() {
                            continue;
                        }
                        match serde_json::from_str::<IpcResponse>(line) {
                            Ok(resp) => {
                                // Stream chunk — emit as Tauri event, don't resolve pending sender
                                if resp.msg_type.as_deref() == Some("stream") {
                                    if let Some(chunk) = &resp.chunk {
                                        let _ = app.emit("chat-stream", StreamChunkEvent {
                                            id: resp.id.clone(),
                                            chunk: chunk.clone(),
                                        });
                                    }
                                    continue;
                                }
                                // Normal response — resolve pending sender
                                let mut map = pending.lock().await;
                                if let Some(tx) = map.remove(&resp.id) {
                                    let _ = tx.send(resp);
                                } else {
                                    eprintln!(
                                        "[NodeProcessBackend] Response for unknown id: {}",
                                        resp.id
                                    );
                                }
                            }
                            Err(err) => {
                                eprintln!(
                                    "[NodeProcessBackend] JSON parse error: {} | line: {}",
                                    err, line
                                );
                            }
                        }
                    }
                    CommandEvent::Stderr(bytes) => {
                        eprintln!(
                            "[NodeProcessBackend] node: {}",
                            String::from_utf8_lossy(&bytes)
                        );
                    }
                    CommandEvent::Terminated(payload) => {
                        eprintln!(
                            "[NodeProcessBackend] Node process terminated (code: {:?})",
                            payload.code
                        );
                        // Send a clear error to all pending callers before dropping them
                        let mut map = pending.lock().await;
                        let drained = std::mem::take(&mut *map);
                        drop(map); // release the lock
                        for (id, tx) in drained {
                            let _ = tx.send(IpcResponse {
                                id,
                                ok: false,
                                data: None,
                                error: Some("Sidecar crashed".into()),
                                detail: Some(format!("Process exited with code {:?}", payload.code)),
                                msg_type: None,
                                chunk: None,
                            });
                        }
                        // Notify the watchdog
                        if let Some(tx) = exit_tx.lock().await.take() {
                            let _ = tx.send(payload.code);
                        }
                        break;
                    }
                    _ => {}
                }
            }
        });
    }

    /// Take the exit receiver so the watchdog can await process death.
    /// Returns `None` if already taken.
    pub fn take_exit_rx(&mut self) -> Option<oneshot::Receiver<Option<i32>>> {
        self.exit_rx.take()
    }

    pub async fn send_message(&mut self, msg_type: &str, payload: Value) -> Result<Value> {
        let id = Uuid::new_v4().to_string();
        let req = IpcRequest {
            id: id.clone(),
            msg_type: msg_type.to_string(),
            payload,
        };

        let (tx, rx) = oneshot::channel::<IpcResponse>();
        {
            let mut map = self.pending.lock().await;
            map.insert(id.clone(), tx);
        }

        let mut line = serde_json::to_string(&req)?;
        line.push('\n');

        // Write to stdin. On failure remove the pending sender so it doesn't
        // leak in the map waiting for a response that will never arrive.
        if let Err(e) = self.child.write(line.as_bytes()) {
            eprintln!("[NodeProcessBackend] ❌ Failed to write to sidecar stdin for {}: {}", msg_type, e);
            self.pending.lock().await.remove(&id);
            return Err(anyhow!("Failed to write to sidecar stdin: {}", e));
        } else {
            // eprintln!("[NodeProcessBackend] ✅ Wrote {} bytes to stdin for {}", line.len(), msg_type);
        }

        let resp_timeout = Self::timeout_for(msg_type);
        let resp = match timeout(resp_timeout, rx).await {
            Ok(Ok(r))  => r,
            Ok(Err(_)) => {
                // Channel closed — sidecar crashed, reader loop already cleaned up pending
                return Err(anyhow!("Sidecar channel closed on '{}'", msg_type));
            }
            Err(_) => {
                // Timeout — remove the orphaned sender to avoid memory leak
                self.pending.lock().await.remove(&id);
                return Err(anyhow!("Sidecar timed out after {:.0}s on '{}'", resp_timeout.as_secs_f64(), msg_type));
            }
        };

        if resp.ok {
            Ok(resp.data.unwrap_or(Value::Null))
        } else {
            Err(anyhow!(
                "IPC error: {} ({})",
                resp.error.unwrap_or_else(|| "unknown error".to_string()),
                resp.detail.unwrap_or_default()
            ))
        }
    }
}
