use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(target_os = "windows")]
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::dlog;
use crate::state::{
    DictationActive, PopoverShownAt, RecordingActive, SelectedRecordingDisplay, TrayAnchor,
    VoiceWakePopover,
};

static OAUTH_WINDOW_COUNTER: AtomicU64 = AtomicU64::new(0);
const POPOVER_DEFAULT_WIDTH_LOGICAL: f64 = 320.0;
const POPOVER_DEFAULT_HEIGHT_LOGICAL: f64 = 520.0;

// ---------------------------------------------------------------------------
// Capture-sharing helpers (macOS only)
// ---------------------------------------------------------------------------
//
// Clips-owned recording chrome (toolbar / countdown / finalizing /
// recording-pill) gets `NSWindow.sharingType = NSWindowSharingNone` so it does
// not leak into the recorded video. The main popover follows the same user
// preference: private by default, shareable only when "Show Clips in screen
// captures" is enabled. Reopening it during a recording must not silently
// override that choice.
// Recording-time exclusion has two effects on macOS: screen pickers don't list
// excluded windows, and full-screen captures omit them from the compositor
// output. This is the same mechanism Loom, 1Password, and CleanShot use to keep
// their own chrome out of captures.
//
// Caveat: on macOS 15.4+ (Sequoia), ScreenCaptureKit-based apps can sometimes
// still capture `NSWindowSharingNone` windows — Apple has acknowledged this as
// a platform bug with no public workaround. Everything up to macOS 14 works
// correctly, and on 15.4+ the majority of capture apps still honour it.
#[cfg(target_os = "macos")]
fn set_window_capture_excluded(window: &WebviewWindow, excluded: bool) {
    let win = window.clone();
    if let Err(err) = win.clone().run_on_main_thread(move || {
        let label = win.label().to_string();
        let ns_window_ptr = match win.ns_window() {
            Ok(p) => p,
            Err(err) => {
                eprintln!(
                    "[clips-tray] set_window_capture_excluded({label}): ns_window() failed: {err}"
                );
                return;
            }
        };
        if ns_window_ptr.is_null() {
            eprintln!("[clips-tray] set_window_capture_excluded({label}): ns_window is null");
            return;
        }
        // 0 == NSWindowSharingNone, 1 == NSWindowSharingReadOnly (default).
        // Pass as NSUInteger (usize) to match the Objective-C selector
        // signature.
        // SAFETY: ns_window() returns a live NSWindow* owned by Tauri. We're
        // guaranteed to be on the main thread here (run_on_main_thread), which
        // is what AppKit's setSharingType: requires. The setter is idempotent
        // and has no return value.
        unsafe {
            let obj = ns_window_ptr as *mut objc2::runtime::AnyObject;
            let sharing_type = if excluded { 0usize } else { 1usize };
            let _: () = objc2::msg_send![&*obj, setSharingType: sharing_type];
        }
        let mode = if excluded {
            "NSWindowSharingNone"
        } else {
            "NSWindowSharingReadOnly"
        };
        dlog!("[clips-tray] set_window_capture_excluded({label}): {mode} applied");
    }) {
        eprintln!("[clips-tray] set_window_capture_excluded: run_on_main_thread failed: {err}");
    }
}

#[cfg(target_os = "macos")]
pub fn set_capture_excluded(window: &WebviewWindow) {
    if crate::config::show_in_screen_capture(window.app_handle()) {
        set_window_capture_excluded(window, false);
        return;
    }
    set_window_capture_excluded(window, true);
}

#[cfg(target_os = "macos")]
pub fn set_capture_excluded_always(window: &WebviewWindow) {
    set_window_capture_excluded(window, true);
}

#[cfg(target_os = "macos")]
pub fn set_capture_included(window: &WebviewWindow) {
    set_window_capture_excluded(window, false);
}

#[cfg(target_os = "macos")]
pub fn set_window_opacity(window: &WebviewWindow, opacity: f64) {
    let win = window.clone();
    if let Err(err) = win.clone().run_on_main_thread(move || {
        let label = win.label().to_string();
        let ns_window_ptr = match win.ns_window() {
            Ok(p) => p,
            Err(err) => {
                eprintln!("[clips-tray] set_window_opacity({label}): ns_window() failed: {err}");
                return;
            }
        };
        if ns_window_ptr.is_null() {
            eprintln!("[clips-tray] set_window_opacity({label}): ns_window is null");
            return;
        }
        unsafe {
            let obj = ns_window_ptr as *mut objc2::runtime::AnyObject;
            let _: () = objc2::msg_send![&*obj, setAlphaValue: opacity];
        }
    }) {
        eprintln!("[clips-tray] set_window_opacity: run_on_main_thread failed: {err}");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn set_window_opacity(_window: &WebviewWindow, _opacity: f64) {}

pub fn build_popover_window(app: &mut tauri::App) -> Result<WebviewWindow, tauri::Error> {
    let app_handle = app.handle().clone();
    WebviewWindowBuilder::new(app, "popover", WebviewUrl::App("index.html".into()))
        .title("Clips")
        .inner_size(
            POPOVER_DEFAULT_WIDTH_LOGICAL,
            POPOVER_DEFAULT_HEIGHT_LOGICAL,
        )
        .position(2.0, 2.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(true)
        .shadow(true)
        .accept_first_mouse(true)
        .on_new_window(move |url, features| {
            let label = format!(
                "google-oauth-{}",
                OAUTH_WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed)
            );
            let popup = WebviewWindowBuilder::new(&app_handle, label, WebviewUrl::External(url))
                .title("Sign in to Clips")
                .inner_size(520.0, 720.0)
                .resizable(true)
                .always_on_top(false)
                .focused(true)
                .window_features(features)
                .build();

            match popup {
                Ok(window) => {
                    set_capture_excluded(&window);
                    configure_overlay_behavior(&window);
                    tauri::webview::NewWindowResponse::Create { window }
                }
                Err(error) => {
                    eprintln!("[clips-tray] failed to create OAuth popup: {error}");
                    tauri::webview::NewWindowResponse::Deny
                }
            }
        })
        .build()
}

#[cfg(target_os = "macos")]
pub fn configure_overlay_behavior(window: &WebviewWindow) {
    let win = window.clone();
    // AppKit calls must run on the main thread.
    if let Err(err) = win.clone().run_on_main_thread(move || {
        let label = win.label().to_string();
        let ns_window_ptr = match win.ns_window() {
            Ok(p) => p,
            Err(err) => {
                eprintln!("[clips-tray] configure_overlay_behavior({label}): ns_window() failed: {err}");
                return;
            }
        };
        if ns_window_ptr.is_null() {
            eprintln!("[clips-tray] configure_overlay_behavior({label}): ns_window is null");
            return;
        }
        // SAFETY: ns_window() returns a live NSWindow*; called on main thread.
        unsafe {
            let obj = ns_window_ptr as *mut objc2::runtime::AnyObject;
            let current: usize = objc2::msg_send![&*obj, collectionBehavior];
            let next = current | (1usize << 0) | (1usize << 8); // CanJoinAllSpaces | FullScreenAuxiliary
            let _: () = objc2::msg_send![&*obj, setCollectionBehavior: next];
        }
        dlog!("[clips-tray] configure_overlay_behavior({label}): CanJoinAllSpaces|FullScreenAuxiliary");
    }) {
        eprintln!("[clips-tray] configure_overlay_behavior: run_on_main_thread failed: {err}");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn configure_overlay_behavior(_window: &WebviewWindow) {
}

#[cfg(target_os = "macos")]
pub fn raise_to_status_level(window: &WebviewWindow) {
    let win = window.clone();
    if let Err(err) = win.clone().run_on_main_thread(move || {
        let label = win.label().to_string();
        let ns_window_ptr = match win.ns_window() {
            Ok(p) => p,
            Err(err) => {
                eprintln!("[clips-tray] raise_to_status_level({label}): ns_window() failed: {err}");
                return;
            }
        };
        if ns_window_ptr.is_null() {
            eprintln!("[clips-tray] raise_to_status_level({label}): ns_window is null");
            return;
        }
        // SAFETY: ns_window() returns a live NSWindow*; called on main thread.
        unsafe {
            let obj = ns_window_ptr as *mut objc2::runtime::AnyObject;
            let _: () = objc2::msg_send![&*obj, setLevel: 25isize];
        }
        dlog!("[clips-tray] raise_to_status_level({label}): NSStatusWindowLevel");
    }) {
        eprintln!("[clips-tray] raise_to_status_level: run_on_main_thread failed: {err}");
    }
}

#[cfg(target_os = "windows")]
pub fn raise_to_status_level(window: &WebviewWindow) {
    if let Err(err) = window.set_always_on_top(true) {
        eprintln!(
            "[clips-tray] raise_to_status_level({}): set_always_on_top failed: {err}",
            window.label()
        );
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn raise_to_status_level(_window: &WebviewWindow) {
}

#[cfg(any(target_os = "windows", test))]
fn advance_topmost_generation(current_generation: &AtomicU64) -> u64 {
    current_generation
        .fetch_add(1, Ordering::SeqCst)
        .wrapping_add(1)
}

#[cfg(any(target_os = "windows", test))]
fn is_current_topmost_generation(current_generation: &AtomicU64, generation: u64) -> bool {
    current_generation.load(Ordering::SeqCst) == generation
}

#[cfg(target_os = "windows")]
pub fn start_topmost_reassert_loop(
    app: &AppHandle,
    label: &'static str,
    current_generation: &'static AtomicU64,
) {
    let generation = advance_topmost_generation(current_generation);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            if !is_current_topmost_generation(current_generation, generation) {
                break;
            }
            let Some(window) = app.get_webview_window(label) else {
                break;
            };
            if window.is_visible().unwrap_or(false) {
                raise_to_status_level(&window);
            }
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
}

#[cfg(not(target_os = "windows"))]
pub fn start_topmost_reassert_loop(
    _app: &AppHandle,
    _label: &'static str,
    _current_generation: &'static AtomicU64,
) {
}

#[cfg(not(target_os = "macos"))]
pub fn set_capture_excluded(_window: &WebviewWindow) {
}

#[cfg(not(target_os = "macos"))]
pub fn set_capture_excluded_always(_window: &WebviewWindow) {
}

#[cfg(not(target_os = "macos"))]
pub fn set_capture_included(_window: &WebviewWindow) {
}

pub fn reapply_capture_exclusion_to_overlays(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let visible = crate::config::show_in_screen_capture(app);
        let windows = app.webview_windows();
        for (label, window) in &windows {
            if label.as_str() == "meeting-notif" {
                set_window_capture_excluded(window, false);
                continue;
            }
            let private_guide = matches!(
                label.as_str(),
                "region-guides" | "region-guide-editor" | "region-record-border"
            );
            set_window_capture_excluded(window, private_guide || !visible);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }
}

/// Show a Tauri WebviewWindow on screen WITHOUT making it the key window or
/// activating Clips — the user's current foreground app stays focused.
///
/// Tauri's `WebviewWindow::show()` ultimately calls
/// `[NSWindow makeKeyAndOrderFront:]` which steals key-window status from the
/// frontmost app. For the voice-dictation overlays (parked popover, flow-bar)
/// we want a "passive HUD" appearance — visible, on top, but never grabbing
/// keyboard focus or interrupting whatever the user is typing into.
///
/// Uses NSWindow's `orderFrontRegardless` (orders the window in without
/// touching key/main status) and `setHidesOnDeactivate: NO` (so it stays
/// visible across app-switches). Both must run on the main thread because
/// AppKit is main-thread-only.
#[cfg(target_os = "macos")]
pub fn show_without_activation(window: &WebviewWindow) {
    let win = window.clone();
    if let Err(err) = win.clone().run_on_main_thread(move || {
        let label = win.label().to_string();
        let ns_window_ptr = match win.ns_window() {
            Ok(p) => p,
            Err(err) => {
                eprintln!(
                    "[clips-tray] show_without_activation({label}): ns_window() failed: {err}"
                );
                return;
            }
        };
        if ns_window_ptr.is_null() {
            eprintln!("[clips-tray] show_without_activation({label}): ns_window is null");
            return;
        }
        unsafe {
            let obj = ns_window_ptr as *mut objc2::runtime::AnyObject;
            let _: () = objc2::msg_send![&*obj, setHidesOnDeactivate: false];
            let _: () = objc2::msg_send![&*obj, orderFrontRegardless];
        }
        dlog!("[clips-tray] show_without_activation({label}): orderFrontRegardless");
    }) {
        eprintln!("[clips-tray] show_without_activation: run_on_main_thread failed: {err}");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn show_without_activation(window: &WebviewWindow) {
    let _ = window.show();
}

#[cfg(target_os = "macos")]
pub fn present_interactive_window(window: &WebviewWindow) {
    let _ = window.show();
    let win = window.clone();
    if let Err(err) = win.clone().run_on_main_thread(move || {
        use objc2::runtime::{AnyClass, AnyObject, Bool};

        let label = win.label().to_string();
        let ns_window_ptr = match win.ns_window() {
            Ok(p) => p,
            Err(err) => {
                eprintln!(
                    "[clips-tray] present_interactive_window({label}): ns_window() failed: {err}"
                );
                return;
            }
        };
        if ns_window_ptr.is_null() {
            eprintln!("[clips-tray] present_interactive_window({label}): ns_window is null");
            return;
        }

        unsafe {
            if let Ok(class_name) = std::ffi::CString::new("NSApplication") {
                if let Some(cls) = AnyClass::get(&class_name) {
                    let ns_app: *mut AnyObject = objc2::msg_send![cls, sharedApplication];
                    if !ns_app.is_null() {
                        let _: () =
                            objc2::msg_send![&*ns_app, activateIgnoringOtherApps: Bool::YES];
                    }
                }
            }

            let obj = ns_window_ptr as *mut AnyObject;
            let _: () = objc2::msg_send![&*obj, setHidesOnDeactivate: false];
            let _: () = objc2::msg_send![&*obj, orderFrontRegardless];
            let _: () =
                objc2::msg_send![&*obj, makeKeyAndOrderFront: std::ptr::null::<AnyObject>()];
        }
        dlog!("[clips-tray] present_interactive_window({label}): ordered front");
    }) {
        eprintln!("[clips-tray] present_interactive_window: run_on_main_thread failed: {err}");
    }
    let _ = window.set_focus();
}

#[cfg(not(target_os = "macos"))]
pub fn present_interactive_window(window: &WebviewWindow) {
    let _ = window.show();
    let _ = window.set_focus();
}

pub fn tray_monitor_physical_rect(app: &AppHandle) -> (i32, i32, u32, u32) {
    if let Some(id) = SelectedRecordingDisplay::get(app) {
        if let Some(rect) = crate::native_screen::monitor_rect_for_display_id(app, id) {
            return rect;
        }
    }

    let tray_rect = app
        .try_state::<TrayAnchor>()
        .and_then(|a| a.0.lock().ok().and_then(|g| *g));

    let (icon_cx, icon_cy) = tray_rect
        .map(|rect| {
            let x = match rect.position {
                tauri::Position::Physical(p) => p.x,
                tauri::Position::Logical(p) => p.x as i32,
            };
            let y = match rect.position {
                tauri::Position::Physical(p) => p.y,
                tauri::Position::Logical(p) => p.y as i32,
            };
            let w = match rect.size {
                tauri::Size::Physical(s) => s.width as i32,
                tauri::Size::Logical(s) => s.width as i32,
            };
            let h = match rect.size {
                tauri::Size::Physical(s) => s.height as i32,
                tauri::Size::Logical(s) => s.height as i32,
            };
            (x + w / 2, y + h / 2)
        })
        .unwrap_or((0, 0));

    let window = app.get_webview_window("popover");
    let monitor = window
        .as_ref()
        .and_then(|w| w.available_monitors().ok())
        .and_then(|monitors| {
            monitors.into_iter().find(|m| {
                let mp = m.position();
                let ms = m.size();
                icon_cx >= mp.x
                    && icon_cx < mp.x + ms.width as i32
                    && icon_cy >= mp.y
                    && icon_cy < mp.y + ms.height as i32
            })
        })
        .or_else(|| window.and_then(|w| w.primary_monitor().ok().flatten()));

    match monitor {
        Some(m) => {
            let p = m.position();
            let s = m.size();
            (p.x, p.y, s.width, s.height)
        }
        None => (0, 0, 2880, 1800),
    }
}

pub fn primary_monitor_physical_size(app: &AppHandle) -> Option<(u32, u32)> {
    let window = app.get_webview_window("popover")?;
    let monitor = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .or_else(|| {
            window
                .available_monitors()
                .ok()
                .and_then(|m| m.into_iter().next())
        })?;
    let size = monitor.size();
    Some((size.width, size.height))
}

pub fn build_overlay_url(path: &str) -> WebviewUrl {
    WebviewUrl::App(format!("index.html#{path}").into())
}

pub fn mark_popover_shown(app: &AppHandle) {
    if let Some(state) = app.try_state::<PopoverShownAt>() {
        if let Ok(mut g) = state.0.lock() {
            *g = Some(std::time::Instant::now());
        }
    }
}

pub fn is_recording_active(app: &AppHandle) -> bool {
    app.try_state::<RecordingActive>()
        .and_then(|s| s.0.lock().ok().map(|g| *g))
        .unwrap_or(false)
}

pub fn is_meeting_active(app: &AppHandle) -> bool {
    use crate::state::MeetingActive;
    app.try_state::<MeetingActive>()
        .and_then(|s| s.0.lock().ok().map(|g| *g))
        .unwrap_or(false)
}

#[cfg(target_os = "macos")]
pub fn frontmost_bundle_id() -> Option<String> {
    use std::process::Command;
    let out = Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to get bundle identifier of (first process whose frontmost is true)",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8(out.stdout).ok()?.trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[cfg(not(target_os = "macos"))]
pub fn frontmost_bundle_id() -> Option<String> {
    None
}

#[tauri::command]
pub fn restart_after_update(app: AppHandle) {
    app.request_restart();
}

pub fn set_dictation_active(app: &AppHandle, active: bool) {
    if let Some(state) = app.try_state::<DictationActive>() {
        if let Ok(mut g) = state.0.lock() {
            *g = active;
        }
    }
}

pub fn is_dictation_active(app: &AppHandle) -> bool {
    app.try_state::<DictationActive>()
        .and_then(|s| s.0.lock().ok().map(|g| *g))
        .unwrap_or(false)
}

pub fn hide_voice_wake_popover(app: &AppHandle) {
    let should_hide = app
        .try_state::<VoiceWakePopover>()
        .and_then(|state| {
            state.0.lock().ok().map(|mut g| {
                let was_woken = *g;
                *g = false;
                was_woken
            })
        })
        .unwrap_or(false);
    if should_hide {
        if let Some(w) = app.get_webview_window("popover") {
            let _ = w.hide();
            crate::clips::close_bubble_if_idle(app);
            let _ = app.emit("clips:popover-visible", false);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{advance_topmost_generation, is_current_topmost_generation};
    use std::sync::atomic::AtomicU64;

    #[test]
    fn replacement_topmost_loop_supersedes_the_exiting_generation() {
        let current_generation = AtomicU64::new(0);
        let exiting_generation = advance_topmost_generation(&current_generation);
        let replacement_generation = advance_topmost_generation(&current_generation);

        assert!(!is_current_topmost_generation(
            &current_generation,
            exiting_generation
        ));
        assert!(is_current_topmost_generation(
            &current_generation,
            replacement_generation
        ));
    }
}
