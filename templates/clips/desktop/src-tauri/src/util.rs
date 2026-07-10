use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::dlog;
use crate::state::{
    DictationActive, PopoverShownAt, RecordingActive, TrayAnchor, VoiceWakePopover,
};

const POPOVER_SHADOW_GUTTER_LOGICAL: f64 = 24.0;
const POPOVER_DEFAULT_WIDTH_LOGICAL: f64 = 360.0;
const POPOVER_DEFAULT_HEIGHT_LOGICAL: f64 = 520.0;

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
    // The "Show overlays in screen capture" debug toggle (Settings → Open
    // at login section) keeps every overlay visible to screenshot and
    // screen-recording APIs by short-circuiting exclusion here. Off by
    // default, so the normal recording flow still keeps Clips chrome out
    // of the user's captured video.
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

pub fn build_popover_window(app: &mut tauri::App) -> Result<WebviewWindow, tauri::Error> {
    let gutter = POPOVER_SHADOW_GUTTER_LOGICAL * 2.0;
    WebviewWindowBuilder::new(app, "popover", WebviewUrl::App("index.html".into()))
        .title("Clips")
        .inner_size(
            POPOVER_DEFAULT_WIDTH_LOGICAL + gutter,
            POPOVER_DEFAULT_HEIGHT_LOGICAL + gutter,
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
        .shadow(false)
        .accept_first_mouse(true)
        .build()
}

// Sets NSWindowCollectionBehaviorCanJoinAllSpaces (bit 0) and
// NSWindowCollectionBehaviorFullScreenAuxiliary (bit 8). Bit 0 keeps the
// window visible when the user switches Spaces; bit 8 keeps it visible over
// fullscreen apps. Tauri exposes bit 0 via set_visible_on_all_workspaces but
// not bit 8. Must be called before every show — orderOut: resets these bits.
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
    // No-op on non-macOS platforms. Spaces are a macOS concept.
}

#[cfg(not(target_os = "macos"))]
pub fn set_capture_excluded(_window: &WebviewWindow) {
    // No-op on non-macOS platforms. Screen-capture exclusion isn't a public
    // Windows API; Linux doesn't even have a universal screen-capture API.
}

#[cfg(not(target_os = "macos"))]
pub fn set_capture_excluded_always(_window: &WebviewWindow) {
    // No-op on non-macOS platforms.
}

#[cfg(not(target_os = "macos"))]
pub fn set_capture_included(_window: &WebviewWindow) {
    // No-op on non-macOS platforms.
}

/// Walk every live overlay webview window and reapply its capture-sharing
/// state so the "Show overlays in screen capture" toggle takes effect
/// immediately on anything currently on screen. Called from
/// `set_feature_config` when the toggle flips.
///
/// The popover is intentionally skipped — its sharing-type is dynamic
/// (`set_capture_included` while shown, `set_capture_excluded` while
/// parked at 2x2 px during recording). Both of those helpers now consult
/// the toggle, so the next `show_popover` / `park_popover_offscreen` call
/// picks up the new setting. Rewriting it here would clobber the parked
/// state mid-recording.
///
/// Region-guide overlays are private recorder aids, not Clips chrome demos, so
/// they stay excluded even when the debug toggle makes the rest visible.
pub fn reapply_capture_exclusion_to_overlays(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let visible = crate::config::show_in_screen_capture(app);
        let windows = app.webview_windows();
        for (label, window) in &windows {
            if label.as_str() == "popover" {
                continue;
            }
            // The meeting reminder is a notification, not Clips recording
            // chrome — keep it visible in captures regardless of the debug
            // toggle so it never gets re-excluded on a config change.
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

/// Show a user-invoked popover and make a best-effort pass at bringing it to
/// the front even when Clips was launched as a background login item.
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

/// Returns `(x, y, width, height)` of the monitor where the tray icon was last
/// clicked, in physical pixels. Falls back to the primary monitor. Use this
/// instead of `primary_monitor_physical_size` for any overlay that should appear
/// on the same screen as the recording.
pub fn tray_monitor_physical_rect(app: &AppHandle) -> (i32, i32, u32, u32) {
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

pub fn is_meeting_active(app: &AppHandle) -> bool {
    use crate::state::MeetingActive;
    app.try_state::<MeetingActive>()
        .and_then(|s| s.0.lock().ok().map(|g| *g))
        .unwrap_or(false)
}

/// Bundle id of the frontmost macOS app, or `None` on failure / non-macOS.
/// Uses a lightweight `osascript` shell-out so callers don't need objc2.
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
