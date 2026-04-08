use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
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
}

pub struct NodeProcessBackend {
    child: CommandChild,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<IpcResponse>>>>,
    /// Fires once when the sidecar process terminates.
    exit_rx: Option<oneshot::Receiver<()>>,
}

impl NodeProcessBackend {
    pub async fn new(app: &AppHandle) -> Result<Self> {
        // Resolve the server directory. We prefer the resource-dir copy, but
        // fall back to a path relative to the executable (dev layout).
        let resource_server = app
            .path()
            .resource_dir()
            .map_err(|e| anyhow!("Failed to resolve resource dir: {}", e))?
            .join("server");

        // In a dev build the resource dir contains _up_/_up_/server rather
        // than server/ directly — walk up past _up_ segments to find it.
        let server_dir = if resource_server.join("server-ipc.js").exists() {
            resource_server
        } else {
            // Walk up from executable to find a sibling `server/` directory.
            let exe = std::env::current_exe()
                .map_err(|e| anyhow!("Cannot determine exe path: {}", e))?;
            let mut candidate = exe.parent()
                .ok_or_else(|| anyhow!("Cannot get exe parent dir"))?;
            loop {
                let try_path = candidate.join("server");
                if try_path.join("server-ipc.js").exists() {
                    break try_path;
                }
                candidate = candidate.parent()
                    .ok_or_else(|| anyhow!("server-ipc.js not found in any ancestor of {}", exe.display()))?;
            }
        };

        let server_ipc = server_dir.join("server-ipc.js");
        let script_path = server_ipc
            .to_str()
            .ok_or_else(|| anyhow!("Failed to convert script path to string"))?
            .to_owned();

        // PROTOAI_ROOT tells paths.js where data/ lives (repo root, two levels
        // above the server/ directory).
        let protoai_root = server_dir
            .parent()
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
            .env("NODE_PATH", server_dir.join("node_modules").to_str().unwrap_or(""))
            .spawn()
            .map_err(|e| anyhow!("Failed to spawn node sidecar: {}", e))?;

        let pending = Arc::new(Mutex::new(HashMap::new()));

        // Exit signal: fires when the reader loop sees Terminated
        let (exit_tx, exit_rx) = oneshot::channel::<()>();
        let exit_tx_shared = Arc::new(Mutex::new(Some(exit_tx)));

        Self::start_reader_loop(rx, pending.clone(), exit_tx_shared);

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
            "chat" | "image_gen" | "deep_search" | "qmd_index" => Duration::from_secs(180),
            _ => Duration::from_secs(30),
        }
    }

    fn start_reader_loop(
        mut rx: tokio::sync::mpsc::Receiver<CommandEvent>,
        pending: Arc<Mutex<HashMap<String, oneshot::Sender<IpcResponse>>>>,
        exit_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
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
                            });
                        }
                        // Notify the watchdog
                        if let Some(tx) = exit_tx.lock().await.take() {
                            let _ = tx.send(());
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
    pub fn take_exit_rx(&mut self) -> Option<oneshot::Receiver<()>> {
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
        self.child
            .write(line.as_bytes())
            .map_err(|e| anyhow!("Failed to write to sidecar stdin: {}", e))?;

        let resp_timeout = Self::timeout_for(msg_type);
        let resp = timeout(resp_timeout, rx).await
            .map_err(|_| anyhow!("Sidecar timed out after {:.0}s on '{msg_type}'", resp_timeout.as_secs_f64()))??;

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
