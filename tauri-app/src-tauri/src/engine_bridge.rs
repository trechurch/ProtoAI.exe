use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;

use anyhow::Result;
use tauri::AppHandle;
use tokio::sync::Mutex;

use crate::node_process_backend::NodeProcessBackend;

const MAX_CRASHES: u32 = 3;

// ---------------------------------------------------------------------------
// BridgeState — managed state registered at app startup.
// Always present so commands always have a State to deref.
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct BridgeState {
    pub inner:       Arc<Mutex<Option<EngineBridge>>>,
    pub crash_count: Arc<AtomicU32>,
    pub given_up:    Arc<AtomicBool>,
}

impl BridgeState {
    pub fn new() -> Self {
        BridgeState {
            inner:       Arc::new(Mutex::new(None)),
            crash_count: Arc::new(AtomicU32::new(0)),
            given_up:    Arc::new(AtomicBool::new(false)),
        }
    }

    /// Spawn the watchdog. Call once after a successful EngineBridge init.
    /// The watchdog monitors for sidecar death, auto-restarts up to MAX_CRASHES
    /// times with exponential backoff, then sets given_up = true and stops.
    pub fn spawn_watchdog(&self, app: AppHandle) {
        let arc         = self.inner.clone();
        let crash_count = self.crash_count.clone();
        let given_up    = self.given_up.clone();

        tauri::async_runtime::spawn(async move {
            let mut delay_secs = 2u64;

            loop {
                // Wait for the current process to signal its exit
                let exit_rx = arc.lock().await.as_mut().and_then(|b| b.take_exit_rx());
                if let Some(rx) = exit_rx {
                    let _ = rx.await;
                } else {
                    // No receiver available — bridge may have been replaced; stop this watchdog
                    break;
                }

                // Process died
                *arc.lock().await = None;
                let count = crash_count.fetch_add(1, Ordering::SeqCst) + 1;
                eprintln!("[Watchdog] Sidecar died (crash {count}/{MAX_CRASHES})");

                if count >= MAX_CRASHES {
                    given_up.store(true, Ordering::SeqCst);
                    eprintln!("[Watchdog] Crash threshold reached. Waiting for manual reconnect.");
                    break;
                }

                eprintln!("[Watchdog] Restarting sidecar in {delay_secs}s…");
                tokio::time::sleep(Duration::from_secs(delay_secs)).await;
                delay_secs = (delay_secs * 2).min(60);

                match EngineBridge::new(&app).await {
                    Ok(bridge) => {
                        delay_secs = 2; // reset backoff on success
                        *arc.lock().await = Some(bridge);
                        eprintln!("[Watchdog] Sidecar restarted successfully");
                        // Loop continues — will wait on the new exit receiver
                    }
                    Err(e) => {
                        eprintln!("[Watchdog] Restart attempt failed: {e}");
                        // Loop continues — will increment crash_count next iteration
                    }
                }
            }
        });
    }
}

// ---------------------------------------------------------------------------
// EngineBridge
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub enum EngineBackend {
    NodeProcess(Arc<Mutex<NodeProcessBackend>>),
}

pub struct EngineBridge {
    backend: EngineBackend,
    exit_rx: Option<tokio::sync::oneshot::Receiver<()>>,
}

// Manual Clone: oneshot::Receiver is not Clone, so we clone without it.
// The watchdog always takes the receiver via take_exit_rx() before cloning anyway.
impl Clone for EngineBridge {
    fn clone(&self) -> Self {
        EngineBridge {
            backend: self.backend.clone(),
            exit_rx: None,
        }
    }
}

impl EngineBridge {
    pub async fn new(app: &AppHandle) -> Result<Self> {
        let mut node_backend = NodeProcessBackend::new(app).await?;
        let exit_rx = node_backend.take_exit_rx();
        let backend = EngineBackend::NodeProcess(Arc::new(Mutex::new(node_backend)));
        Ok(Self { backend, exit_rx })
    }

    /// Take the exit receiver so the watchdog can await process death.
    pub fn take_exit_rx(&mut self) -> Option<tokio::sync::oneshot::Receiver<()>> {
        self.exit_rx.take()
    }

    async fn send_request(
        &self,
        msg_type: &str,
        payload: serde_json::Value,
    ) -> Result<serde_json::Value> {
        match &self.backend {
            EngineBackend::NodeProcess(backend) => {
                backend.lock().await.send_message(msg_type, payload).await
            }
        }
    }

    pub async fn projects(&self) -> Result<serde_json::Value> {
        self.send_request("projects", serde_json::json!({})).await
    }

    pub async fn history(&self, project: String) -> Result<serde_json::Value> {
        self.send_request("history", serde_json::json!({ "project": project })).await
    }

    pub async fn profiles(&self) -> Result<serde_json::Value> {
        self.send_request("profiles", serde_json::json!({})).await
    }

    pub async fn chat(
        &self,
        project: String,
        profile: String,
        engine: String,
        message: String,
    ) -> Result<serde_json::Value> {
        self.send_request(
            "chat",
            serde_json::json!({ "project": project, "profile": profile, "engine": engine, "message": message }),
        )
        .await
    }

    pub async fn upload(
        &self,
        project: String,
        filename: String,
        content: String,
    ) -> Result<serde_json::Value> {
        self.send_request(
            "upload",
            serde_json::json!({ "project": project, "filename": filename, "content": content }),
        )
        .await
    }

    pub async fn ingest(&self, project: String) -> Result<serde_json::Value> {
        self.send_request("ingest", serde_json::json!({ "project": project })).await
    }
}
