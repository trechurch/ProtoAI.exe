// SDOA v1.2 compliant — Native Shell Dashboard
use sdoa_sdk::prelude::*;
use tauri::Manager;

#[derive(SdoaDashboard)]
#[sdoa(
    id = "SystemHealth",
    runtime = "Rust/Tauri",
    version = "2.0.0",
    dependencies = ["ProvisioningService", "LlmPolicyEngine"]
)]
pub struct SystemHealth;

impl SystemHealth {
    // This Rust method triggers the native Tauri window
    pub fn spawn_window(&self, app_handle: tauri::AppHandle) {
        let _window = tauri::WindowBuilder::new(
            &app_handle,
            "system_health",
            tauri::WindowUrl::App("health_view.html".into())
        )
        .title("SDOA System Control")
        .inner_size(1200.0, 800.0)
        .build()
        .unwrap();
        
        self.bump_patch("Migrated to native Tauri shell");
    }
}