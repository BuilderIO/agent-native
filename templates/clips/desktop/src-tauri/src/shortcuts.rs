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

/// Hold threshold before a Fn press counts as a dictation gesture. Below
/// this, we treat it as a stray tap (e.g. user nudging the macOS input
/// source / globe HUD) and emit nothing — so a quick Fn tap never opens our
/// flow-bar overlay.
#[cfg(target_os = "macos")]
const FN_HOLD_THRESHOLD_MS: u64 = 180;

/// Listen for Fn key down/up via a CoreGraphics event tap. Tap is
/// `ListenOnly` so we don't suppress macOS's own Fn behavior (the system
/// always shows the globe/input-source HUD on Fn — only the user can
/// disable that, in System Settings → Keyboard → Press 🌐 key to: Do
/// Nothing). We only emit `voice:shortcut-start` after the user has held
/// Fn past `FN_HOLD_THRESHOLD_MS` so a momentary tap doesn't pop the
/// dictation bar. We mirror `DictationActive` so the long-tail
/// `show_flow_bar` safety timeout applies to Fn-triggered dictation too.
#[cfg(target_os = "macos")]
fn install_fn_event_tap(app: tauri::AppHandle) {
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::Duration;

    use core_foundation::runloop::CFRunLoop;
    use core_graphics::event::{
        CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
        CGEventType, CallbackResult,
    };

    struct FnState {
        was_down: bool,
        // Generation counter — bumped on each down so a delayed start
        // task that fires after a quick release knows to bail.
        generation: u64,
        started: bool,
    }

    let state = Arc::new(Mutex::new(FnState {
        was_down: false,
        generation: 0,
        started: false,
    }));

    thread::spawn(move || {
        let state = state.clone();
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
                let mut s = match state.lock() {
                    Ok(g) => g,
                    Err(_) => return CallbackResult::Keep,
                };
                if is_down && !s.was_down {
                    s.was_down = true;
                    s.generation = s.generation.wrapping_add(1);
                    s.started = false;
                    let gen = s.generation;
                    drop(s);
                    let app_for_delay = app_for_tap.clone();
                    let state_for_delay = state.clone();
                    thread::spawn(move || {
                        thread::sleep(Duration::from_millis(FN_HOLD_THRESHOLD_MS));
                        let mut s = match state_for_delay.lock() {
                            Ok(g) => g,
                            Err(_) => return,
                        };
                        if !s.was_down || s.generation != gen {
                            // Released before the threshold, or a new
                            // press has started a fresh generation.
                            return;
                        }
                        s.started = true;
                        drop(s);
                        if let Some(active) = app_for_delay.try_state::<DictationActive>() {
                            if let Ok(mut g) = active.0.lock() {
                                *g = true;
                            }
                        }
                        eprintln!("[clips-tray] Fn held — starting voice dictation");
                        let _ = app_for_delay.emit(
                            "voice:shortcut-start",
                            serde_json::json!({ "source": "fn" }),
                        );
                    });
                } else if !is_down && s.was_down {
                    let was_started = s.started;
                    s.was_down = false;
                    s.started = false;
                    drop(s);
                    if let Some(active) = app_for_tap.try_state::<DictationActive>() {
                        if let Ok(mut g) = active.0.lock() {
                            *g = false;
                        }
                    }
                    if was_started {
                        eprintln!("[clips-tray] Fn up — stopping voice dictation");
                        let _ = app_for_tap
                            .emit("voice:shortcut-stop", serde_json::json!({ "source": "fn" }));
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
