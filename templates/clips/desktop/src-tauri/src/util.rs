use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow};

use crate::state::{PopoverShownAt, RecordingActive};

// ---------------------------------------------------------------------------
// Exclude-from-capture helper (macOS only)
// ---------------------------------------------------------------------------
//
// Every Clips-owned overlay window (popover / bubble / toolbar / countdown /
// signin) gets `NSWindow.sharingType = NSWindowSharingNone` flipped on right
// after build. This has two effects on macOS:
//
//   1. **Screen pickers don't list it.** When the user clicks "Start Recording"
//      the popover stays open on screen while macOS shows the screen / window
//      picker. Because the popover is marked non-sharable, the picker doesn't
//      enumerate it as a potential capture source — the user can't accidentally
//      record the Clips UI itself.
//
//   2. **Full-screen captures omit it.** Even when the user picks a full
//      display, the compositor doesn't composite the overlay windows into the
//      captured frame. The final recording shows the screen content beneath
//      the popover / bubble / toolbar / countdown, not the overlays.
//
// This is the same mechanism Loom, 1Password, and CleanShot use to keep their
// own chrome out of captures. It also sidesteps a nasty WebKit bug we hit
// earlier: hiding the popover's webview mid-`getDisplayMedia` suspends JS
// execution and the recorder promise never resolves — freezing the tray.
// By leaving the popover VISIBLE (but non-sharable) during the screen picker,
// JS keeps running and the promise resolves cleanly.
//
// Caveat: on macOS 15.4+ (Sequoia), ScreenCaptureKit-based apps can sometimes
// still capture `NSWindowSharingNone` windows — Apple has acknowledged this as
// a platform bug with no public workaround. Everything up to macOS 14 works
// correctly, and on 15.4+ the majority of capture apps still honour it.
#[cfg(target_os = "macos")]
pub fn set_capture_excluded(window: &WebviewWindow) {
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
                eprintln!("[clips-tray] set_capture_excluded({label}): ns_window() failed: {err}");
                return;
            }
        };
        if ns_window_ptr.is_null() {
            eprintln!("[clips-tray] set_capture_excluded({label}): ns_window is null");
            return;
        }
        // 0 == NSWindowSharingNone, 1 == NSWindowSharingReadOnly (default). We
        // want 0. Pass as NSUInteger (usize) to match the Objective-C selector
        // signature.
        // SAFETY: ns_window() returns a live NSWindow* owned by Tauri. We're
        // guaranteed to be on the main thread here (run_on_main_thread), which
        // is what AppKit's setSharingType: requires. The setter is idempotent
        // and has no return value.
        unsafe {
            let obj = ns_window_ptr as *mut objc2::runtime::AnyObject;
            let _: () = objc2::msg_send![&*obj, setSharingType: 0usize];
        }
        eprintln!("[clips-tray] set_capture_excluded({label}): NSWindowSharingNone applied");
    }) {
        eprintln!("[clips-tray] set_capture_excluded: run_on_main_thread failed: {err}");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn set_capture_excluded(_window: &WebviewWindow) {
    // No-op on non-macOS platforms. Screen-capture exclusion isn't a public
    // Windows API; Linux doesn't even have a universal screen-capture API.
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
