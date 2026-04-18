//! Clips menu-bar tray app.
//!
//! The app is a single always-on-top popover window. Clicking the tray icon
//! toggles it. Pressing Cmd/Ctrl+Shift+L also toggles it. The popover itself
//! is served by the Vite-built React UI (see `../dist`).

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Rect, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

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
fn set_capture_excluded(window: &WebviewWindow) {
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
fn set_capture_excluded(_window: &WebviewWindow) {
    // No-op on non-macOS platforms. Screen-capture exclusion isn't a public
    // Windows API; Linux doesn't even have a universal screen-capture API.
}

/// Last-known tray icon rect, updated on every tray event. Used to anchor the
/// popover directly under the icon (Loom-style) instead of floating in the
/// top-right corner of the screen.
#[derive(Default)]
struct TrayAnchor(Mutex<Option<Rect>>);

/// Timestamp of the most-recent popover show. The blur-to-hide handler checks
/// this — macOS briefly steals focus during the tray click itself, so without
/// this guard the popover would be hidden the instant it's shown.
#[derive(Default)]
struct PopoverShownAt(Mutex<Option<Instant>>);

/// Whether a recording is currently in progress. Set from JS via
/// `set_recording_state`. Used to re-purpose the tray icon click as a
/// stop-recording shortcut while recording, matching Loom.
#[derive(Default)]
struct RecordingActive(Mutex<bool>);
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Native overlay windows for the recording experience. These render the same
/// React bundle with a hash route that `main.tsx` uses to pick the component.
const COUNTDOWN_LABEL: &str = "countdown";
const TOOLBAR_LABEL: &str = "toolbar";
const BUBBLE_LABEL: &str = "bubble";

fn build_overlay_url(path: &str) -> WebviewUrl {
    // tauri dev serves the Vite dev server; prod builds resolve relative to
    // the bundled index.html. WebviewUrl::App handles both transparently —
    // we pass an index + hash route.
    WebviewUrl::App(format!("index.html#{path}").into())
}

/// Full-screen transparent overlay that runs the 3-2-1 countdown. It ignores
/// cursor events so the user can still click into whatever they're about to
/// record, and closes itself when the countdown finishes.
#[tauri::command]
async fn show_countdown(app: AppHandle) -> Result<(), String> {
    eprintln!("[clips-tray] show_countdown invoked");
    if let Some(existing) = app.get_webview_window(COUNTDOWN_LABEL) {
        let _ = existing.close();
    }
    let (mw, mh) = primary_monitor_physical_size(&app).unwrap_or((2880, 1800));
    eprintln!("[clips-tray] countdown target size {}x{} physical", mw, mh);
    let win = WebviewWindowBuilder::new(&app, COUNTDOWN_LABEL, build_overlay_url("countdown"))
        .title("Countdown")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        // Don't steal focus from the popover when the overlay opens —
        // otherwise macOS fires Focused(false) on the popover, which
        // kicks off a cascade of blur-related React re-renders and
        // eventually (past the 1500ms guard) auto-hides the popover.
        .focused(false)
        .build()
        .map_err(|e| {
            eprintln!("[clips-tray] countdown build failed: {}", e);
            e.to_string()
        })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(mw, mh)));
    let _ = win.set_position(PhysicalPosition::new(0, 0));
    let _ = win.set_ignore_cursor_events(true);
    set_capture_excluded(&win);
    let _ = win.show();
    eprintln!("[clips-tray] countdown shown");
    Ok(())
}

/// Vertical recording pill anchored to the left edge. Stop + timer + pause,
/// matching Loom's left-rail placement. Draggable, always on top.
#[tauri::command]
async fn show_toolbar(app: AppHandle) -> Result<(), String> {
    eprintln!("[clips-tray] show_toolbar invoked");
    if let Some(existing) = app.get_webview_window(TOOLBAR_LABEL) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    let (_mw, mh) = primary_monitor_physical_size(&app).unwrap_or((2880, 1800));
    // Tighter pill: buttons are 30px, padding is 10px, gap is 10px. The
    // window is sized so the pill fills it with only ~4-6 px of slack per
    // side for the CSS drop shadow to bleed into. Values are physical px,
    // so ~2x the logical pill dimensions on retina.
    let w: u32 = 110;
    let h: u32 = 260;
    // Flush-left with a small margin; vertically centered on the screen.
    let x: i32 = 48;
    let y: i32 = (mh as i32 - h as i32) / 2;
    eprintln!("[clips-tray] toolbar pos=({},{}) size={}x{}", x, y, w, h);
    let mut builder = WebviewWindowBuilder::new(&app, TOOLBAR_LABEL, build_overlay_url("toolbar"))
        .title("Clips Recorder")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        // IMPORTANT: native window shadow MUST stay off — macOS draws it
        // based on the rectangular window bounds, not the rounded React
        // content, so it shows up as a hard-edged black rectangle around
        // the rounded pill. CSS box-shadow on `.toolbar-v` provides the
        // soft drop shadow instead, shaped to the visible content.
        .shadow(false)
        .visible(false)
        .focused(false);
    // macOS: without this, the first click on an unfocused window is
    // swallowed activating the window and only the SECOND click reaches
    // the React button. `accept_first_mouse(true)` tells WKWebView to
    // treat the activating click as a real click too — one-click stop,
    // as the user expects. The builder method exists on all platforms
    // but is only honored on macOS (no-op elsewhere).
    #[cfg(target_os = "macos")]
    {
        builder = builder.accept_first_mouse(true);
    }
    let win = builder.build().map_err(|e| {
        eprintln!("[clips-tray] toolbar build failed: {}", e);
        e.to_string()
    })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    set_capture_excluded(&win);
    let _ = win.show();
    eprintln!("[clips-tray] toolbar shown");
    Ok(())
}

/// Physical-pixel bubble sizes. Logical px on retina = physical / 2, so these
/// map to ~96 (small) and ~180 (medium) logical px — matching Loom's camera
/// bubble sizes exactly. Medium is the default (and matches the previous
/// hardcoded 360 value so existing users see no change on upgrade).
const BUBBLE_SIZE_SMALL: u32 = 192;
const BUBBLE_SIZE_MEDIUM: u32 = 360;

fn bubble_size_for_name(name: &str) -> u32 {
    match name {
        "small" => BUBBLE_SIZE_SMALL,
        _ => BUBBLE_SIZE_MEDIUM,
    }
}

/// Path to the JSON blob that stores the last-known bubble position on disk.
/// Lives in the Tauri app-data dir (platform-specific — `~/Library/Application
/// Support/<bundle-id>/` on macOS). Returns None if the app-data dir cannot be
/// resolved.
fn bubble_position_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    if let Err(err) = std::fs::create_dir_all(&dir) {
        eprintln!(
            "[clips-tray] bubble_position_path mkdir failed: {} ({})",
            err,
            dir.display()
        );
        return None;
    }
    Some(dir.join("bubble-position.json"))
}

/// Path to the JSON blob that stores the last-chosen bubble size ("small" or
/// "medium"). Same storage pattern as `bubble-position.json`.
fn bubble_size_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    if let Err(err) = std::fs::create_dir_all(&dir) {
        eprintln!(
            "[clips-tray] bubble_size_path mkdir failed: {} ({})",
            err,
            dir.display()
        );
        return None;
    }
    Some(dir.join("bubble-size.json"))
}

/// Load the last-saved bubble size name, default "medium" if nothing is saved
/// or parsing fails.
fn load_bubble_size_name(app: &AppHandle) -> String {
    let Some(path) = bubble_size_path(app) else {
        return "medium".to_string();
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return "medium".to_string();
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return "medium".to_string();
    };
    match value.get("size").and_then(|v| v.as_str()) {
        Some("small") => "small".to_string(),
        Some("medium") => "medium".to_string(),
        _ => "medium".to_string(),
    }
}

/// Persist the chosen bubble size to disk (atomic write via temp + rename).
fn save_bubble_size_name(app: &AppHandle, name: &str) {
    let Some(path) = bubble_size_path(app) else {
        return;
    };
    let body = match serde_json::to_vec(&serde_json::json!({ "size": name })) {
        Ok(b) => b,
        Err(err) => {
            eprintln!("[clips-tray] save_bubble_size_name serialize failed: {err}");
            return;
        }
    };
    let tmp = path.with_extension("json.tmp");
    if let Err(err) = std::fs::write(&tmp, &body) {
        eprintln!("[clips-tray] save_bubble_size_name write tmp failed: {err}");
        return;
    }
    if let Err(err) = std::fs::rename(&tmp, &path) {
        eprintln!("[clips-tray] save_bubble_size_name rename failed: {err}");
        let _ = std::fs::remove_file(&tmp);
    }
}

/// Load the saved bubble size and return it to the frontend. Default is
/// "medium". Exposed to JS via `invoke("load_bubble_size")`.
#[tauri::command]
async fn load_bubble_size(app: AppHandle) -> Result<String, String> {
    Ok(load_bubble_size_name(&app))
}

/// Resize the bubble window to match the named size ("small" | "medium") and
/// persist the choice. Clamps to valid names silently — unknown values fall
/// back to medium so a typo in the frontend doesn't brick persistence.
#[tauri::command]
async fn set_bubble_size(app: AppHandle, size: String) -> Result<(), String> {
    let name = match size.as_str() {
        "small" => "small",
        _ => "medium",
    };
    let px = bubble_size_for_name(name);
    if let Some(win) = app.get_webview_window(BUBBLE_LABEL) {
        // Re-center the resize around the current position's center so the
        // bubble visually grows / shrinks around its current spot instead of
        // jumping toward the top-left corner (Tauri resizes from the window's
        // origin by default).
        let current_pos = win
            .outer_position()
            .ok()
            .map(|p| (p.x, p.y))
            .unwrap_or((0, 0));
        let current_size = win
            .outer_size()
            .ok()
            .map(|s| s.width as i32)
            .unwrap_or(BUBBLE_SIZE_MEDIUM as i32);
        let new_px = px as i32;
        let delta = (current_size - new_px) / 2;
        let new_x = current_pos.0 + delta;
        let new_y = current_pos.1 + delta;
        let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(px, px)));
        let _ = win.set_position(PhysicalPosition::new(new_x, new_y));
    }
    save_bubble_size_name(&app, name);
    Ok(())
}

/// Load the last-saved bubble position, if any. Returns (x, y) in physical
/// pixels. Any IO or parse failure is treated as "no saved position" — the
/// caller will fall back to the default Loom-style anchor.
fn load_bubble_position(app: &AppHandle) -> Option<(i32, i32)> {
    let path = bubble_position_path(app)?;
    let bytes = std::fs::read(&path).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let x = value.get("x")?.as_i64()? as i32;
    let y = value.get("y")?.as_i64()? as i32;
    Some((x, y))
}

/// Persist the bubble position so it survives restarts. Exposed to JS via
/// `invoke("save_bubble_position", { x, y })`. Writes atomically (temp file +
/// rename) so a crash mid-write can't corrupt the JSON blob.
#[tauri::command]
async fn save_bubble_position(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    let Some(path) = bubble_position_path(&app) else {
        // No writable app-data dir — log and swallow so the UI doesn't
        // treat this as a fatal error.
        eprintln!("[clips-tray] save_bubble_position: no app_data_dir, skipping");
        return Ok(());
    };
    let body = serde_json::to_vec(&serde_json::json!({ "x": x, "y": y }))
        .map_err(|e| format!("serialize: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    if let Err(err) = std::fs::write(&tmp, &body) {
        eprintln!("[clips-tray] save_bubble_position write tmp failed: {err}");
        return Ok(());
    }
    if let Err(err) = std::fs::rename(&tmp, &path) {
        eprintln!("[clips-tray] save_bubble_position rename failed: {err}");
        // Best-effort cleanup of the tmp file so it doesn't linger.
        let _ = std::fs::remove_file(&tmp);
        return Ok(());
    }
    Ok(())
}

/// Circular, draggable webcam bubble — small always-on-top window that hosts
/// its own getUserMedia stream and floats over everything the user captures.
#[tauri::command]
async fn show_bubble(app: AppHandle) -> Result<(), String> {
    eprintln!("[clips-tray] show_bubble invoked");
    if let Some(existing) = app.get_webview_window(BUBBLE_LABEL) {
        let _ = existing.show();
        eprintln!("[clips-tray] bubble reused");
        return Ok(());
    }
    let (mw, mh) = primary_monitor_physical_size(&app).unwrap_or((2880, 1800));
    // Honor the user's last-chosen size. Default is "medium" (360 physical =
    // 180 logical), which matches the original hardcoded value — existing
    // users see no visual change on upgrade.
    let size_name = load_bubble_size_name(&app);
    let size: u32 = bubble_size_for_name(&size_name);
    // Default Loom-style anchor: flush-left with a small margin, a hair
    // above the bottom edge of the primary display. On Retina the 60
    // physical-px offset maps to ~30 logical px.
    let default_x: i32 = 48;
    let default_y: i32 = mh as i32 - size as i32 - 60;
    // Prefer the last-known position, clamped to the primary monitor so a
    // position saved on a now-disconnected external display can't leave
    // the bubble off-screen.
    let max_x = (mw as i32 - size as i32).max(0);
    let max_y = (mh as i32 - size as i32).max(0);
    let (x, y, source) = match load_bubble_position(&app) {
        Some((sx, sy)) => (sx.clamp(0, max_x), sy.clamp(0, max_y), "saved"),
        None => (default_x, default_y, "default"),
    };
    eprintln!(
        "[clips-tray] bubble pos=({},{}) source={} size={} monitor={}x{}",
        x, y, source, size, mw, mh
    );
    let mut builder = WebviewWindowBuilder::new(&app, BUBBLE_LABEL, build_overlay_url("bubble"))
        .title("Clips Camera")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false)
        .focused(false);
    // macOS: let the first click drag / interact with the bubble instead
    // of being eaten by window activation. Same reasoning as the toolbar
    // above — the bubble is `.focused(false)` so it doesn't steal focus
    // from the screen being recorded, but that otherwise forces users to
    // click twice to grab or drag it.
    #[cfg(target_os = "macos")]
    {
        builder = builder.accept_first_mouse(true);
    }
    let win = builder.build().map_err(|e| {
        eprintln!("[clips-tray] bubble build failed: {}", e);
        e.to_string()
    })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(size, size)));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    set_capture_excluded(&win);
    let _ = win.show();
    eprintln!("[clips-tray] bubble shown at ({},{}) size {}", x, y, size);
    Ok(())
}

#[tauri::command]
async fn hide_overlays(app: AppHandle) -> Result<(), String> {
    for label in [COUNTDOWN_LABEL, TOOLBAR_LABEL, BUBBLE_LABEL] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.close();
        }
    }
    Ok(())
}

/// Close just the recording-specific overlays (countdown + toolbar),
/// leaving the bubble alone. Used on recording stop/cancel when the
/// popover owns the camera bubble for the entire session — we don't
/// want to rip the bubble away mid-session; its lifecycle is governed
/// by the popover's session effect (show on popover-open, hide on
/// popover-close).
#[tauri::command]
async fn hide_recording_chrome(app: AppHandle) -> Result<(), String> {
    for label in [COUNTDOWN_LABEL, TOOLBAR_LABEL] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.close();
        }
    }
    Ok(())
}

/// DESTROY the bubble webview (not just hide it). This is the critical
/// difference from `hide_overlays`: we need the WebKit webview gone so the
/// macOS camera hardware is fully released. When the popover then calls
/// `getDisplayMedia` / `getUserMedia({audio})` for MediaRecorder, WebKit
/// doesn't try to renegotiate a capture graph that has a live camera in
/// another webview — the camera is simply not held by anyone.
///
/// The recorder driver calls this right before acquiring screen + mic,
/// and then calls `show_bubble` again once MediaRecorder is running +
/// stable. At that point the bubble webview is freshly spawned, acquires
/// the camera cleanly, and there's no cross-webview contention because
/// MediaRecorder doesn't touch the camera after start.
#[tauri::command]
async fn close_bubble(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(BUBBLE_LABEL) {
        eprintln!("[clips-tray] close_bubble — destroying bubble webview");
        let _ = w.close();
    } else {
        eprintln!("[clips-tray] close_bubble — no bubble window to close");
    }
    Ok(())
}

/// Show the popover window without toggling, and keep it shown even if it
/// loses focus (popover hides on blur by default, but during post-recording
/// review we want it sticky while the user reads the "Recording saved" copy).
/// Resize the popover window to match the rendered React app height. The
/// React side measures its own shell with a ResizeObserver and calls this
/// whenever the height changes — gives us auto-sizing without having to
/// pick a fixed popover size that fits every state.
#[tauri::command]
async fn resize_popover(app: AppHandle, height: f64) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("popover") {
        let clamped = height.clamp(200.0, 820.0);
        let _ = w.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            360.0, clamped,
        )));
        // Re-anchor to the tray icon so the window doesn't drift below the
        // bottom of the monitor after a growth.
        position_popover(&app, &w);
    }
    Ok(())
}

/// Open a login window pointed at the Clips server's /login route. The
/// WebView has its own persistent cookie jar, so once the user signs in
/// here the session cookie is available to every subsequent fetch from
/// the popover (localhost:1420 and localhost:8094 are same-site — ports
/// aren't part of the site check — so SameSite=Lax cookies cross-send
/// correctly with credentials: "include").
#[tauri::command]
async fn show_signin(app: AppHandle, url: String) -> Result<(), String> {
    const LABEL: &str = "signin";
    if let Some(existing) = app.get_webview_window(LABEL) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    let parsed = url::Url::parse(&url).map_err(|e| e.to_string())?;
    let win = WebviewWindowBuilder::new(&app, LABEL, WebviewUrl::External(parsed))
        .title("Sign in to Clips")
        .inner_size(520.0, 720.0)
        .resizable(true)
        .always_on_top(false)
        .focused(true)
        .build()
        .map_err(|e| e.to_string())?;
    set_capture_excluded(&win);
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

#[tauri::command]
async fn close_signin(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("signin") {
        let _ = w.close();
    }
    Ok(())
}

/// Record the popover's current recording state. When active, clicking the
/// tray icon emits a stop event instead of toggling the popover — so the
/// user can stop a recording from anywhere with one click.
#[tauri::command]
async fn set_recording_state(app: AppHandle, active: bool) -> Result<(), String> {
    eprintln!("[clips-tray] set_recording_state active={}", active);
    if let Some(state) = app.try_state::<RecordingActive>() {
        if let Ok(mut g) = state.0.lock() {
            *g = active;
        }
    }
    Ok(())
}

/// Last-resort recovery command: clear `is_recording_active` and show the
/// popover. Not wired to any UI by default — available for debugging when
/// the recording-flow side-effects wedge the tray in a dead state.
/// Invoke from the webview via `invoke("reset_state")`.
#[tauri::command]
async fn reset_state(app: AppHandle) -> Result<(), String> {
    eprintln!("[clips-tray] reset_state invoked — clearing recording flag + showing popover");
    if let Some(state) = app.try_state::<RecordingActive>() {
        if let Ok(mut g) = state.0.lock() {
            *g = false;
        }
    }
    if let Some(window) = app.get_webview_window("popover") {
        position_popover(&app, &window);
        mark_popover_shown(&app);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit("clips:popover-visible", true);
    }
    Ok(())
}

fn is_recording_active(app: &AppHandle) -> bool {
    app.try_state::<RecordingActive>()
        .and_then(|s| s.0.lock().ok().map(|g| *g))
        .unwrap_or(false)
}

#[tauri::command]
async fn show_popover(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("popover") {
        position_popover(&app, &window);
        mark_popover_shown(&app);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit("clips:popover-visible", true);
    }
    Ok(())
}

fn mark_popover_shown(app: &AppHandle) {
    if let Some(state) = app.try_state::<PopoverShownAt>() {
        if let Ok(mut g) = state.0.lock() {
            *g = Some(Instant::now());
        }
    }
}

fn primary_monitor_physical_size(app: &AppHandle) -> Option<(u32, u32)> {
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

fn toggle_popover(app: &AppHandle) {
    let Some(window) = app.get_webview_window("popover") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        let _ = app.emit("clips:popover-visible", false);
    } else {
        position_popover(app, &window);
        mark_popover_shown(app);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit("clips:popover-visible", true);
    }
}

fn position_popover(app: &AppHandle, window: &WebviewWindow) {
    // If we have a recent tray icon rect, anchor the popover's top edge just
    // below the icon and center it horizontally on the icon — same feel as
    // Loom / Raycast / 1Password.
    let anchor = app.state::<TrayAnchor>();
    let tray_rect = anchor.0.lock().ok().and_then(|g| *g);

    let win_size: PhysicalSize<u32> = window.outer_size().unwrap_or(PhysicalSize::new(360, 440));
    // IMPORTANT: `current_monitor()` returns None when the window is offscreen
    // (we park it at 99999,99999 on boot to hide the initial flash). Fall back
    // to the primary monitor so we can still position correctly on first show.
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
        });
    let Some(monitor) = monitor else {
        return;
    };
    let mon_size = monitor.size();
    let mon_pos = monitor.position();

    if let Some(rect) = tray_rect {
        // `Rect { position, size }` on macOS is in physical pixels with the
        // origin at the active monitor's top-left (matching macOS's coord
        // system, y grows downward in Tauri v2).
        let icon_x = match rect.position {
            tauri::Position::Physical(p) => p.x,
            tauri::Position::Logical(p) => p.x as i32,
        };
        let icon_y = match rect.position {
            tauri::Position::Physical(p) => p.y,
            tauri::Position::Logical(p) => p.y as i32,
        };
        let icon_w = match rect.size {
            tauri::Size::Physical(s) => s.width as i32,
            tauri::Size::Logical(s) => s.width as i32,
        };
        let icon_h = match rect.size {
            tauri::Size::Physical(s) => s.height as i32,
            tauri::Size::Logical(s) => s.height as i32,
        };

        // Center the popover horizontally on the icon.
        let mut x = icon_x + icon_w / 2 - (win_size.width as i32) / 2;
        // Drop below the icon with a tiny gap.
        let gap = 6_i32;
        let y = icon_y + icon_h + gap;

        // Clamp horizontally so we don't run off the edge of the screen.
        let min_x = mon_pos.x + 8;
        let max_x = mon_pos.x + mon_size.width as i32 - win_size.width as i32 - 8;
        if x < min_x {
            x = min_x;
        }
        if x > max_x {
            x = max_x;
        }
        let _ = window.set_position(PhysicalPosition::new(x, y));
        return;
    }

    // Fallback: top-right of the active monitor (used before the tray has
    // fired its first event).
    let scale = monitor.scale_factor();
    let margin_right = (12.0 * scale) as i32;
    let margin_top = (36.0 * scale) as i32;
    let x = mon_pos.x + mon_size.width as i32 - win_size.width as i32 - margin_right;
    let y = mon_pos.y + margin_top;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // Second launch just focuses the popover of the already-running
            // instance. Prevents the "two tray icons" UX where clicks fight
            // over focus and neither popover shows.
            if let Some(window) = app.get_webview_window("popover") {
                position_popover(app, &window);
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            show_countdown,
            show_toolbar,
            show_bubble,
            hide_overlays,
            hide_recording_chrome,
            close_bubble,
            show_popover,
            resize_popover,
            show_signin,
            close_signin,
            set_recording_state,
            reset_state,
            save_bubble_position,
            set_bubble_size,
            load_bubble_size,
        ])
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let is_cmd = shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::KeyL);
                    let is_ctrl =
                        shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyL);
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
                .build(),
        )
        .manage(TrayAnchor::default())
        .manage(PopoverShownAt::default())
        .manage(RecordingActive::default())
        .setup(|app| {
            // NOTE: we intentionally do NOT call set_activation_policy(Accessory)
            // in dev here. In unbundled dev runs, Accessory mode sometimes
            // prevents the tray icon from registering in the macOS menu bar at
            // all. Production builds (.app bundle) ship with LSUIElement=1 in
            // Info.plist, which is the proper way to get pure menu-bar behavior.
            #[cfg(all(target_os = "macos", not(debug_assertions)))]
            {
                let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            }

            // Simple tray menu — right-click reveals it.
            let show_item = MenuItem::with_id(app, "show", "Show popover", true, None::<&str>)?;
            let devtools_item =
                MenuItem::with_id(app, "devtools", "Toggle DevTools", true, Some("Cmd+Alt+I"))?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Clips", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &devtools_item, &quit_item])?;

            // Load the tray icon from embedded bytes so the binary is
            // self-contained. `icons/tray.png` ships with the source and is
            // the placeholder users replace with their real icon.
            let tray_icon = tauri::image::Image::from_bytes(TRAY_PNG)?;

            eprintln!(
                "[clips-tray] building tray icon from {} bytes",
                TRAY_PNG.len()
            );
            let _tray = TrayIconBuilder::with_id("main")
                .tooltip("Clips")
                .menu(&menu)
                .icon(tray_icon)
                // Colored rounded-square brand icon (not a template) —
                // stays purple in both light and dark menu bars.
                .icon_as_template(false)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => toggle_popover(app),
                    "devtools" => {
                        #[cfg(debug_assertions)]
                        {
                            if let Some(w) = app.get_webview_window("popover") {
                                if w.is_devtools_open() {
                                    w.close_devtools();
                                } else {
                                    w.open_devtools();
                                }
                            }
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Remember the icon's rect so the popover can anchor
                    // directly beneath it. Every tray event carries a fresh
                    // rect — even hover/move — so the anchor stays current
                    // even if the user drags menu-bar items around.
                    let rect = match &event {
                        TrayIconEvent::Click { rect, .. }
                        | TrayIconEvent::DoubleClick { rect, .. }
                        | TrayIconEvent::Enter { rect, .. }
                        | TrayIconEvent::Move { rect, .. }
                        | TrayIconEvent::Leave { rect, .. } => Some(*rect),
                        _ => None,
                    };
                    if let Some(rect) = rect {
                        let app = tray.app_handle();
                        if let Some(anchor) = app.try_state::<TrayAnchor>() {
                            if let Ok(mut g) = anchor.0.lock() {
                                *g = Some(rect);
                            }
                        }
                    }

                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        let active = is_recording_active(app);
                        eprintln!("[clips-tray] tray click — is_recording_active={}", active);
                        if active {
                            // Loom-style: tray click while recording stops it.
                            let _ = app.emit("clips:recorder-stop", ());
                        } else {
                            toggle_popover(app);
                        }
                    }
                })
                .build(app)?;
            eprintln!("[clips-tray] tray built — should be visible in menu bar");
            // Persist the tray so it isn't dropped at the end of setup.
            app.manage(_tray);

            // Register the global shortcut. On macOS we use Cmd+Shift+L;
            // on Windows/Linux we use Ctrl+Shift+L. Registering both is safe
            // because on macOS Ctrl isn't the primary modifier and vice versa.
            let shortcut_cmd = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyL);
            let shortcut_ctrl =
                Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyL);
            let gs = app.handle().global_shortcut();
            if let Err(err) = gs.register(shortcut_cmd) {
                eprintln!("[clips-tray] failed to register Cmd+Shift+L: {err}");
            }
            if let Err(err) = gs.register(shortcut_ctrl) {
                eprintln!("[clips-tray] failed to register Ctrl+Shift+L: {err}");
            }

            // Hide the popover on blur so it feels like a real menu-bar popover.
            // The 250ms guard is the important bit — during the tray-click
            // itself macOS briefly steals focus from the popover, which would
            // fire Focused(false) and hide the window we literally just showed.
            if let Some(window) = app.get_webview_window("popover") {
                // Exclude the popover from screen recordings and from the macOS
                // screen / window picker. See `set_capture_excluded` docs. This
                // is what lets us keep the popover visible (and its JS alive)
                // during `getDisplayMedia` without the popover leaking into the
                // recorded video.
                set_capture_excluded(&window);
                let handle = window.clone();
                let app_handle = app.handle().clone();
                // NOTE: Intentionally NOT calling window.open_devtools()
                // here. An auto-opened devtools window steals focus from
                // the popover on every render, which flaps onFocusChanged
                // constantly and creates an infinite show_bubble/hide loop
                // in the React effect. Users can right-click → Inspect
                // Element if they need devtools.
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        // Don't auto-hide while a recording is active or
                        // mid-setup — the macOS screen-picker, devtools,
                        // and other transient windows all steal focus
                        // from the popover during that flow. Hiding
                        // would also kill the RecordingRow UI the user
                        // is relying on to stop.
                        if is_recording_active(&app_handle) {
                            eprintln!("[clips-tray] popover blur ignored — recording active");
                            return;
                        }
                        let shown_at = app_handle
                            .try_state::<PopoverShownAt>()
                            .and_then(|s| s.0.lock().ok().and_then(|g| *g));
                        let elapsed_ms = shown_at
                            .map(|t| t.elapsed().as_millis())
                            .unwrap_or(u128::MAX);
                        eprintln!("[clips-tray] popover blur, elapsed_ms={}", elapsed_ms);
                        if elapsed_ms >= 1500 {
                            let _ = handle.hide();
                            let _ = app_handle.emit("clips:popover-visible", false);
                        }
                    }
                });
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // macOS: clicking the Dock icon ("reopen") toggles the popover.
            // This is the most natural trigger in debug builds where the Dock
            // icon is visible (production hides it via LSUIElement).
            if let tauri::RunEvent::Reopen { .. } = event {
                toggle_popover(app_handle);
            }
        });
}

// Embedded fallback icon — a tiny 16x16 solid purple PNG so the binary always
// has *something* to display even if `icons/tray.png` is missing on disk. The
// `tauri.conf.json` tray config points at `icons/tray.png`, which the user
// should replace with their real icon.
const TRAY_PNG: &[u8] = include_bytes!("../icons/tray.png");
