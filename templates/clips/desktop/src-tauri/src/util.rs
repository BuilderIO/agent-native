use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow};

use crate::dlog;
use crate::state::{DictationActive, PopoverShownAt, RecordingActive, VoiceWakePopover};

// ---------------------------------------------------------------------------
// Capture-sharing helpers (macOS only)
// ---------------------------------------------------------------------------
//
// Clips-owned recording chrome (toolbar / countdown / finalizing /
// recording-pill) gets `NSWindow.sharingType = NSWindowSharingNone` so it does
// not leak into the recorded video. The main popover is different: users expect
// to screenshot it for feedback, so it stays shareable during normal idle /
// settings use and is flipped to NSWindowSharingNone only while it is parked as
// the hidden recording controller.
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
    // AppKit's `-[NSWindow setSharingType:]` is strictly main-thread-only, and
    // macOS 15.5+ hard-asserts it (the process crashes in
    // `-[NSWMWindowCoordinator performTransactionUsingBlock:]` otherwise).
    // Most of our callers are `async fn #[tauri::command]`s, which run on a
    // tokio worker thread — so we always hop back to the main runloop before
    // poking AppKit. If we're already on the main thread (e.g. the setup
    // handler path), `run_on_main_thread` just runs the closure inline.
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
    set_window_capture_excluded(window, true);
}

#[cfg(target_os = "macos")]
pub fn set_capture_included(window: &WebviewWindow) {
    set_window_capture_excluded(window, false);
}

#[cfg(not(target_os = "macos"))]
pub fn set_capture_excluded(_window: &WebviewWindow) {
    // No-op on non-macOS platforms. Screen-capture exclusion isn't a public
    // Windows API; Linux doesn't even have a universal screen-capture API.
}

#[cfg(not(target_os = "macos"))]
pub fn set_capture_included(_window: &WebviewWindow) {
    // No-op on non-macOS platforms.
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
            // Stay visible when the user switches apps (otherwise AppKit
            // would auto-hide on Clips deactivation, which happens
            // immediately because we never become key).
            let _: () = objc2::msg_send![&*obj, setHidesOnDeactivate: false];
            // Order in without making key/main. Equivalent of NSPanel's
            // non-activating behavior on a vanilla NSWindow.
            let _: () = objc2::msg_send![&*obj, orderFrontRegardless];
        }
        dlog!("[clips-tray] show_without_activation({label}): orderFrontRegardless");
    }) {
        eprintln!("[clips-tray] show_without_activation: run_on_main_thread failed: {err}");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn show_without_activation(window: &WebviewWindow) {
    // On non-macOS we just fall back to the standard show. Focus stealing
    // is a macOS-flavored complaint; if it shows up on Windows / Linux
    // we'll add a per-platform fix.
    let _ = window.show();
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
    // tauri dev serves the Vite dev server; prod builds resolve relative to
    // the bundled index.html. WebviewUrl::App handles both transparently —
    // we pass an index + hash route.
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
            let _ = app.emit("clips:popover-visible", false);
        }
    }
}
