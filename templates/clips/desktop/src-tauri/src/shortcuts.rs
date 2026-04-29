use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

use crate::clips::toggle_popover;
use crate::state::{DictationActive, VoiceWakePopover};
use crate::util::is_recording_active;

pub fn register_shortcuts(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Register the global shortcut. On macOS we use Cmd+Shift+L;
    // on Windows/Linux we use Ctrl+Shift+L. Registering both is safe
    // because on macOS Ctrl isn't the primary modifier and vice versa.
    let shortcut_cmd = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyL);
    let shortcut_ctrl = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyL);
    let voice_cmd_space = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);
    let voice_ctrl_space = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space);
    let gs = app.handle().global_shortcut();
    if let Err(err) = gs.register(shortcut_cmd) {
        eprintln!("[clips-tray] failed to register Cmd+Shift+L: {err}");
    }
    if let Err(err) = gs.register(shortcut_ctrl) {
        eprintln!("[clips-tray] failed to register Ctrl+Shift+L: {err}");
    }
    if let Err(err) = gs.register(voice_cmd_space) {
        eprintln!("[clips-tray] failed to register Cmd+Shift+Space voice shortcut: {err}");
    }
    if let Err(err) = gs.register(voice_ctrl_space) {
        eprintln!("[clips-tray] failed to register Ctrl+Shift+Space voice shortcut: {err}");
    }

    Ok(())
}

/// Build the global shortcut plugin with its handler. Called from `run()` to
/// register the plugin before `.build()`.
pub fn build_shortcut_plugin() -> tauri_plugin_global_shortcut::Builder<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
        let is_cmd = shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::KeyL);
        let is_ctrl = shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyL);
        let is_voice_cmd_space = shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::Space);
        let is_voice_ctrl_space =
            shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::Space);
        if is_voice_cmd_space || is_voice_ctrl_space {
            let source = if is_voice_cmd_space {
                "cmd-shift-space"
            } else {
                "ctrl-shift-space"
            };
            let active_state = app.try_state::<DictationActive>();
            match event.state() {
                tauri_plugin_global_shortcut::ShortcutState::Pressed => {
                    let mut already_active = false;
                    if let Some(state) = active_state.as_ref() {
                        if let Ok(mut g) = state.0.lock() {
                            already_active = *g;
                            *g = true;
                        }
                    }
                    if !already_active {
                        eprintln!("[clips-tray] {source} down — starting voice dictation");
                        emit_voice_shortcut(app, "voice:shortcut-start", source, true);
                    }
                }
                tauri_plugin_global_shortcut::ShortcutState::Released => {
                    if let Some(state) = active_state.as_ref() {
                        if let Ok(mut g) = state.0.lock() {
                            *g = false;
                        }
                    }
                    eprintln!("[clips-tray] {source} up — stopping voice dictation");
                    emit_voice_shortcut(app, "voice:shortcut-stop", source, false);
                }
            }
            return;
        }

        if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
            return;
        }
        if is_cmd || is_ctrl {
            // Loom-style: if a recording is already active, the
            // global shortcut stops it rather than re-opening the
            // popover. Keeps parity with the tray-icon click
            // behaviour in `on_tray_icon_event`.
            if is_recording_active(app) {
                let _ = app.emit("clips:recorder-stop", ());
            } else {
                toggle_popover(app);
            }
        }
    })
}

fn emit_voice_shortcut(
    app: &tauri::AppHandle,
    event: &'static str,
    source: &'static str,
    wake: bool,
) {
    if wake {
        wake_popover_for_voice(app);
        let app = app.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(80));
            let _ = app.emit(event, serde_json::json!({ "source": source }));
        });
        return;
    }
    let _ = app.emit(event, serde_json::json!({ "source": source }));
}

fn wake_popover_for_voice(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("popover") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        return;
    }
    if let Some(state) = app.try_state::<VoiceWakePopover>() {
        if let Ok(mut g) = state.0.lock() {
            *g = true;
        }
    }
    let _ = window.set_position(PhysicalPosition::new(2_i32, 2_i32));
    let _ = window.set_size(tauri::Size::Physical(PhysicalSize::new(2_u32, 2_u32)));
    let _ = window.show();
    let _ = app.emit("clips:popover-visible", false);
}
