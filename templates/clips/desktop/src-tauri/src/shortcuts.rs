use std::thread;
use std::time::Duration;
use tauri::{Emitter, Listener, Manager, PhysicalPosition, PhysicalSize};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

use crate::clips::toggle_popover;
use crate::dlog;
use crate::state::{DictationActive, VoiceWakePopover};
use crate::util::{is_recording_active, show_without_activation};

fn escape_shortcut() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

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

/// Globally intercept Escape while the popover is visible so it dismisses even
/// when another app is focused — Loom-style. We register/unregister on every
/// `clips:popover-visible` toggle so Escape stays a normal key everywhere
/// else. The "parked offscreen" voice-dictation state emits visible=false, so
/// Escape is correctly inactive then too.
pub fn install_popover_dismiss_handler(app: &tauri::App) {
    let handle = app.handle().clone();
    app.listen("clips:popover-visible", move |event| {
        let payload = event.payload().to_string();
        let handle = handle.clone();
        // Defer register/unregister to a worker thread. Calling
        // global_shortcut::{register,unregister,is_registered} from inside
        // a listener fired by an Escape press freezes the app on macOS:
        // the listener runs while the Carbon hotkey callback is still on
        // the stack, and Carbon's hotkey table is not reentrant from
        // within its own callback.
        std::thread::spawn(move || {
            let visible: bool = serde_json::from_str(&payload).unwrap_or(false);
            let shortcut = escape_shortcut();
            let gs = handle.global_shortcut();
            if visible {
                if !gs.is_registered(shortcut) {
                    if let Err(err) = gs.register(shortcut) {
                        eprintln!("[clips-tray] failed to register Escape: {err}");
                    }
                }
            } else if gs.is_registered(shortcut) {
                let _ = gs.unregister(shortcut);
            }
        });
    });
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
        let is_escape = shortcut.matches(Modifiers::empty(), Code::Escape);
        if is_escape {
            if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
                return;
            }
            // Don't dismiss mid-recording — same guard as the React-side Esc
            // handler. The user would lose the recorder handle.
            if is_recording_active(app) {
                return;
            }
            if let Some(window) = app.get_webview_window("popover") {
                let _ = window.hide();
            }
            let _ = app.emit("clips:popover-visible", false);
            return;
        }
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
    // Use orderFrontRegardless instead of Tauri's show() (which calls
    // makeKeyAndOrderFront and steals focus from the user's foreground
    // app). The popover is parked at 2x2 px just to keep its JS alive so
    // it can receive the voice:shortcut-* events — the user should never
    // notice it appearing.
    show_without_activation(&window);
    let _ = app.emit("clips:popover-visible", false);
}

/// Listen for Fn (globe) key down/up via a CoreGraphics event tap.
///
/// We use the lower-level `CGEventTap::new` + manual runloop registration
/// (rather than the `with_enabled` convenience) so we can:
///
/// - Subscribe to `TapDisabledByTimeout` and `TapDisabledByUserInput`,
///   which macOS posts when it auto-disables the tap after a slow
///   callback or system event (sleep/wake, screen lock, Mission Control).
///   Without this subscription the tap silently dies after the first
///   dictation and Fn appears to "do nothing" on subsequent presses —
///   which is the exact symptom we were hitting.
/// - Hold a reference to the `CGEventTap` on the runloop thread and call
///   `tap.enable()` between runloop ticks, so a disabled tap is revived
///   automatically without the user having to relaunch the app.
///
/// Tap is `ListenOnly` so we don't swallow the user's real Fn behavior
/// (the system globe/input-source HUD still appears unless the user sets
/// System Settings → Keyboard → Press 🌐 key to: Do Nothing).
///
/// Edge-triggered on the SecondaryFn flag bit: `voice:shortcut-start` on
/// `false → true`, `voice:shortcut-stop` on `true → false`. Other modifier
/// flag changes (Cmd, Shift, Ctrl, Option) are ignored.
///
/// `DictationActive` is mirrored on every edge so the long-tail
/// `show_flow_bar` safety timeout applies to Fn-triggered dictation too.
///
/// Pattern adapted from linespeed and handy-keys (proven open-source
/// Tauri voice-dictation apps that ship to thousands of macOS users).
#[cfg(target_os = "macos")]
fn install_fn_event_tap(app: tauri::AppHandle) {
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Arc;
    use std::thread;
    use std::time::Duration;

    use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
    use core_graphics::event::{
        CGEventFlags, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
        CGEventType, CallbackResult,
    };

    let prev_down = Arc::new(AtomicBool::new(false));
    let needs_reenable = Arc::new(AtomicBool::new(false));
    let event_count = Arc::new(AtomicU64::new(0));

    dlog!("[clips-tray][fn-tap] install_fn_event_tap called — spawning listener thread");

    thread::Builder::new()
        .name("clips-fn-key-tap".into())
        .spawn(move || {
            let app_for_cb = app.clone();
            let prev_for_cb = prev_down.clone();
            let needs_reenable_for_cb = needs_reenable.clone();
            let event_count_for_cb = event_count.clone();

            dlog!("[clips-tray][fn-tap] thread started; about to call CGEventTap::new");
            let tap_result = CGEventTap::new(
                CGEventTapLocation::HID,
                CGEventTapPlacement::HeadInsertEventTap,
                CGEventTapOptions::ListenOnly,
                // ONLY include FlagsChanged in the mask. The
                // TapDisabledByTimeout / TapDisabledByUserInput types
                // are NOT mask-subscribable — their numeric values
                // (0xFFFFFFFE / 0xFFFFFFFF) overflow the `1 << n` shift
                // the rust crate uses to build the mask, panicking the
                // tap thread on creation. Those events are still
                // delivered to the callback automatically when the OS
                // disables the tap; we just match on `etype` below.
                vec![CGEventType::FlagsChanged],
                move |_proxy, etype, event| {
                    let n = event_count_for_cb.fetch_add(1, Ordering::SeqCst) + 1;
                    if n <= 5 || n % 50 == 0 {
                        dlog!(
                            "[clips-tray][fn-tap] event #{n} type={:?} flags={:?}",
                            etype,
                            event.get_flags()
                        );
                    }
                    match etype {
                        CGEventType::TapDisabledByTimeout => {
                            eprintln!(
                                "[clips-tray] Fn tap disabled by timeout — flagging for re-enable"
                            );
                            // Reset edge state so the next genuine Fn-down
                            // is detected as a fresh transition (we may have
                            // missed an up-edge while the tap was disabled).
                            prev_for_cb.store(false, Ordering::SeqCst);
                            needs_reenable_for_cb.store(true, Ordering::SeqCst);
                            // Wake the runloop thread out of run_in_mode so
                            // it can call tap.enable() before the next event.
                            CFRunLoop::get_current().stop();
                            return CallbackResult::Keep;
                        }
                        CGEventType::TapDisabledByUserInput => {
                            eprintln!(
                                "[clips-tray] Fn tap disabled by user input — flagging for re-enable"
                            );
                            prev_for_cb.store(false, Ordering::SeqCst);
                            needs_reenable_for_cb.store(true, Ordering::SeqCst);
                            CFRunLoop::get_current().stop();
                            return CallbackResult::Keep;
                        }
                        CGEventType::FlagsChanged => {}
                        _ => return CallbackResult::Keep,
                    }

                    let fn_down = event
                        .get_flags()
                        .contains(CGEventFlags::CGEventFlagSecondaryFn);
                    let was_down = prev_for_cb.swap(fn_down, Ordering::SeqCst);
                    if fn_down == was_down {
                        return CallbackResult::Keep;
                    }
                    set_dictation_active(&app_for_cb, fn_down);
                    if fn_down {
                        dlog!("[clips-tray] Fn down — starting voice dictation");
                        // Wake the popover (parked at 2x2, no focus) so its
                        // JS runtime is live to receive the event. Without
                        // this, if the popover was hidden, macOS may have
                        // suspended its webview and the listener wouldn't
                        // fire — manifesting as "Fn key sometimes does
                        // nothing" depending on whether the popover happened
                        // to be open.
                        wake_popover_for_voice(&app_for_cb);
                        // Small delay to give the popover JS a chance to
                        // resume before we emit. wake_popover_for_voice
                        // hops to the main thread internally so the actual
                        // show happens slightly later than this line.
                        let app_for_emit = app_for_cb.clone();
                        thread::spawn(move || {
                            thread::sleep(Duration::from_millis(80));
                            let _ = app_for_emit.emit(
                                "voice:shortcut-start",
                                serde_json::json!({ "source": "fn" }),
                            );
                        });
                    } else {
                        dlog!("[clips-tray] Fn up — stopping voice dictation");
                        let _ = app_for_cb.emit(
                            "voice:shortcut-stop",
                            serde_json::json!({ "source": "fn" }),
                        );
                    }
                    CallbackResult::Keep
                },
            );

            let tap = match tap_result {
                Ok(t) => {
                    dlog!("[clips-tray][fn-tap] CGEventTap::new succeeded");
                    t
                }
                Err(()) => {
                    eprintln!(
                        "[clips-tray][fn-tap] CGEventTapCreate returned NULL. Most likely cause: \
                         Input Monitoring is not granted to Clips. Open System Settings → \
                         Privacy & Security → Input Monitoring and enable Clips (or the \
                         terminal running `tauri dev`). Note: Accessibility is a separate \
                         permission and is not sufficient for ListenOnly taps."
                    );
                    return;
                }
            };
            let source = match tap.mach_port().create_runloop_source(0) {
                Ok(s) => {
                    dlog!("[clips-tray][fn-tap] runloop source created");
                    s
                }
                Err(()) => {
                    eprintln!("[clips-tray][fn-tap] CFMachPortCreateRunLoopSource failed");
                    return;
                }
            };
            let runloop = CFRunLoop::get_current();
            runloop.add_source(&source, unsafe { kCFRunLoopCommonModes });
            tap.enable();
            dlog!(
                "[clips-tray][fn-tap] tap enabled; entering runloop — press Fn now to test"
            );

            // Run the runloop in repeated short bursts so we can re-enable
            // the tap if the OS disables it. We use run_current (blocks
            // until something stops the loop) and re-enter on exit. The
            // disable callbacks above call CFRunLoop::stop, which makes
            // run_current return; we then call tap.enable() and re-enter.
            // This is the handy-keys / linespeed pattern.
            loop {
                if needs_reenable.swap(false, Ordering::SeqCst) {
                    dlog!("[clips-tray] re-enabling Fn event tap");
                    tap.enable();
                }
                CFRunLoop::run_current();
                // run_current returned — either we asked it to (a disable
                // event flagged needs_reenable above), or something else
                // removed our source. In the latter case avoid a tight
                // spin, then re-call enable() defensively (it's idempotent
                // — calling on an already-enabled tap is a no-op).
                if !needs_reenable.load(Ordering::SeqCst) {
                    thread::sleep(Duration::from_millis(50));
                    dlog!(
                        "[clips-tray] Fn runloop exited unexpectedly — re-enabling tap"
                    );
                    needs_reenable.store(true, Ordering::SeqCst);
                }
            }
        })
        .expect("spawn clips-fn-key-tap thread");
}

#[cfg(target_os = "macos")]
fn set_dictation_active(app: &tauri::AppHandle, active: bool) {
    if let Some(state) = app.try_state::<DictationActive>() {
        if let Ok(mut g) = state.0.lock() {
            *g = active;
        }
    }
}
