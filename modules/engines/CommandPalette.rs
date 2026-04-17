// SDOA v1.2 compliant — Native System Engine
use sdoa_sdk::prelude::*;
use tauri::{GlobalShortcutManager, Manager};

#[derive(SdoaEngine)]
#[sdoa(
    id = "CommandPalette",
    runtime = "Rust/Tauri",
    version = "1.0.0",
    dependencies = ["QmdAdapter", "LlmBridge"]
)]
pub struct CommandPalette;

impl CommandPalette {
    pub fn setup_hotkeys(&self, app: &mut tauri::App) {
        let mut shortcuts = app.global_shortcut_manager();
        let handle = app.handle();

        // Register Cmd+Shift+Space as the universal SDOA entry point
        shortcuts.register("CmdOrCtrl+Shift+Space", move || {
            let window = handle.get_window("palette").unwrap();
            if window.is_visible().unwrap() {
                window.hide().unwrap();
            } else {
                window.show().unwrap();
                window.set_focus().unwrap();
            }
        }).unwrap();
        
        self.bump_patch("Global hotkey registered.");
    }
}