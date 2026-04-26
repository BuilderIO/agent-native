use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

use crate::clips::toggle_popover;
use crate::state::DictationActive;
use crate::util::is_recording_active;

pub fn register_shortcuts(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // Register the global shortcut. On macOS we use Cmd+Shift+L;
    // on Windows/Linux we use Ctrl+Shift+L. Registering both is safe
    // because on macOS Ctrl isn't the primary modifier and vice versa.
    let shortcut_cmd = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyL);
    let shortcut_ctrl = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyL);
    #[cfg(not(target_os = "macos"))]
    let shortcut_fn = Shortcut::new(None, Code::Fn);
    let gs = app.handle().global_shortcut();
    if let Err(err) = gs.register(shortcut_cmd) {
        eprintln!("[clips-tray] failed to register Cmd+Shift+L: {err}");
    }
    if let Err(err) = gs.register(shortcut_ctrl) {
        eprintln!("[clips-tray] failed to register Ctrl+Shift+L: {err}");
    }
    #[cfg(not(target_os = "macos"))]
    if let Err(err) = gs.register(shortcut_fn) {
        eprintln!("[clips-tray] failed to register Fn push-to-talk: {err}");
    }
    #[cfg(target_os = "macos")]
    install_fn_event_tap(app.handle().clone());

    Ok(())
}

/// Build the global shortcut plugin with its handler. Called from `run()` to
/// register the plugin before `.build()`.
pub fn build_shortcut_plugin() -> tauri_plugin_global_shortcut::Builder<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
        let is_cmd = shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::KeyL);
        let is_ctrl = shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyL);
        let is_fn = shortcut.matches(Modifiers::empty(), Code::Fn);
        if is_fn {
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
                        let _ = app.emit("voice:shortcut-start", ());
                    }
                }
                tauri_plugin_global_shortcut::ShortcutState::Released => {
                    if let Some(state) = active_state.as_ref() {
                        if let Ok(mut g) = state.0.lock() {
                            *g = false;
                        }
                    }
                    let _ = app.emit("voice:shortcut-stop", ());
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

#[cfg(target_os = "macos")]
fn install_fn_event_tap(app: tauri::AppHandle) {
    use std::sync::{Arc, Mutex};
    use std::thread;

    use core_foundation::runloop::CFRunLoop;
    use core_graphics::event::{
        CallbackResult, CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions,
        CGEventTapPlacement, CGEventType,
    };

    let active = Arc::new(Mutex::new(false));
    thread::spawn(move || {
        let active = active.clone();
        let app_for_tap = app.clone();
        eprintln!("[clips-tray] installing macOS Fn event tap");
        let result = CGEventTap::with_enabled(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![CGEventType::FlagsChanged],
            move |_proxy, _event_type, event| {
                let is_down = event
                    .get_flags()
                    .contains(CGEventFlags::CGEventFlagSecondaryFn);
                if let Ok(mut was_down) = active.lock() {
                    if is_down && !*was_down {
                        *was_down = true;
                        eprintln!("[clips-tray] Fn down — starting voice dictation");
                        let _ = app_for_tap.emit("voice:shortcut-start", ());
                    } else if !is_down && *was_down {
                        *was_down = false;
                        eprintln!("[clips-tray] Fn up — stopping voice dictation");
                        let _ = app_for_tap.emit("voice:shortcut-stop", ());
                    }
                }
                CallbackResult::Keep
            },
            CFRunLoop::run_current,
        );
        if result.is_err() {
            eprintln!(
                "[clips-tray] failed to install Fn event tap; enable Accessibility/Input Monitoring for Clips or the terminal running tauri dev"
            );
        }
    });
}
