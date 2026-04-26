use std::path::PathBuf;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::state::{PopoverShownAt, RecordingActive, TrayAnchor};
use crate::util::{
    build_overlay_url, is_recording_active, mark_popover_shown, primary_monitor_physical_size,
    set_capture_excluded,
};

/// Native overlay windows for the recording experience. These render the same
/// React bundle with a hash route that `main.tsx` uses to pick the component.
const COUNTDOWN_LABEL: &str = "countdown";
const TOOLBAR_LABEL: &str = "toolbar";
const BUBBLE_LABEL: &str = "bubble";
const FINALIZING_LABEL: &str = "finalizing";

/// Physical-pixel bubble sizes. Logical px on retina = physical / 2, so these
/// map to ~96 (small) and ~180 (medium) logical px — matching Loom's camera
/// bubble sizes exactly. Small is the default so the bubble feels like a
/// quiet PiP rather than a giant circle the user has to shrink on every
/// launch — this matches Loom's out-of-the-box behavior.
const BUBBLE_SIZE_SMALL: u32 = 360;
const BUBBLE_SIZE_MEDIUM: u32 = 504;

/// Extra vertical real-estate reserved beneath the circular bubble for the
/// hover-controls pill (small-dot + medium-dot). The Tauri window is
/// `transparent: true`, so the budget paints through as empty space until the
/// user hovers the bubble and the pill fades in. We'd otherwise have no pixels
/// to paint the pill into — WebKit can't render outside its window bounds, no
/// matter what CSS `overflow` says.
///
/// 80 physical px ≈ 40 logical px on retina — enough for the ~28px pill plus
/// an 8px gap from the circle, with a small cushion so the pill's drop-shadow
/// doesn't clip at the window bottom.
const BUBBLE_CONTROLS_BUDGET_PX: u32 = 80;

fn bubble_size_for_name(name: &str) -> u32 {
    match name {
        "medium" => BUBBLE_SIZE_MEDIUM,
        _ => BUBBLE_SIZE_SMALL,
    }
}

/// Total window height for a bubble of the given diameter — includes the
/// controls-budget strip beneath the circle.
fn bubble_window_height_for(size: u32) -> u32 {
    size + BUBBLE_CONTROLS_BUDGET_PX
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

/// Load the last-saved bubble size name, default "small" if nothing is saved
/// or parsing fails. Small is the out-of-the-box default so the bubble feels
/// like a quiet PiP on first launch — users can bump it to medium from the
/// hover-controls pill if they want it bigger.
fn load_bubble_size_name(app: &AppHandle) -> String {
    let Some(path) = bubble_size_path(app) else {
        return "small".to_string();
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return "small".to_string();
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return "small".to_string();
    };
    match value.get("size").and_then(|v| v.as_str()) {
        Some("small") => "small".to_string(),
        Some("medium") => "medium".to_string(),
        _ => "small".to_string(),
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

/// Load the saved bubble position, if any. Returns (x, y) in physical
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

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Full-screen transparent overlay that runs the 3-2-1 countdown. It ignores
/// cursor events so the user can still click into whatever they're about to
/// record, and closes itself when the countdown finishes.
#[tauri::command]
pub async fn show_countdown(app: AppHandle) -> Result<(), String> {
    eprintln!("[clips-tray] show_countdown invoked");
    mark_popover_shown(&app);
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

/// Full-screen transparent overlay that shows a centered spinner while the
/// recorder flushes its final chunks and awaits the server finalize. Rendered
/// immediately after the user clicks Stop so they don't stare at a blank
/// screen for a few seconds while `recorder.stop()` completes. Ignores cursor
/// events so accidental clicks can't disrupt the finalize flow. Marked
/// non-sharable for consistency with the other Clips overlays, even though
/// the recording has already ended by the time this appears.
#[tauri::command]
pub async fn show_finalizing(app: AppHandle) -> Result<(), String> {
    eprintln!("[clips-tray] show_finalizing invoked");
    if let Some(existing) = app.get_webview_window(FINALIZING_LABEL) {
        let _ = existing.close();
    }
    let (mw, mh) = primary_monitor_physical_size(&app).unwrap_or((2880, 1800));
    eprintln!("[clips-tray] finalizing target size {}x{} physical", mw, mh);
    let win = WebviewWindowBuilder::new(&app, FINALIZING_LABEL, build_overlay_url("finalizing"))
        .title("Finalizing")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        // Don't steal focus — same rationale as the countdown overlay.
        .focused(false)
        .build()
        .map_err(|e| {
            eprintln!("[clips-tray] finalizing build failed: {}", e);
            e.to_string()
        })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(mw, mh)));
    let _ = win.set_position(PhysicalPosition::new(0, 0));
    let _ = win.set_ignore_cursor_events(true);
    set_capture_excluded(&win);
    let _ = win.show();
    eprintln!("[clips-tray] finalizing shown");
    Ok(())
}

/// Close the finalizing spinner overlay. Called from the recorder stop path
/// right after `openExternal` opens the browser to the recording URL.
#[tauri::command]
pub async fn hide_finalizing(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(FINALIZING_LABEL) {
        let _ = w.close();
    }
    Ok(())
}

/// Vertical recording pill anchored to the left edge. Stop + timer + pause,
/// matching Loom's left-rail placement. Draggable, always on top.
#[tauri::command]
pub async fn show_toolbar(app: AppHandle) -> Result<(), String> {
    eprintln!("[clips-tray] show_toolbar invoked");
    // Reset the blur guard — spawning an overlay can briefly steal focus
    // from the popover on some macOS versions even with .focused(false).
    mark_popover_shown(&app);
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
    #[allow(unused_mut)]
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

/// Circular, draggable webcam bubble — small always-on-top window that hosts
/// its own getUserMedia stream and floats over everything the user captures.
#[tauri::command]
pub async fn show_bubble(app: AppHandle) -> Result<(), String> {
    eprintln!("[clips-tray] show_bubble invoked");
    // Reset the blur guard — getUserMedia for the camera can trigger a
    // macOS permission dialog that steals focus from the popover.
    mark_popover_shown(&app);
    if let Some(existing) = app.get_webview_window(BUBBLE_LABEL) {
        let _ = existing.show();
        eprintln!("[clips-tray] bubble reused");
        return Ok(());
    }
    let (mw, mh) = primary_monitor_physical_size(&app).unwrap_or((2880, 1800));
    // Honor the user's last-chosen size. Default is "small" (192 physical =
    // 96 logical) so new users get a quiet PiP rather than a giant circle.
    let size_name = load_bubble_size_name(&app);
    let size: u32 = bubble_size_for_name(&size_name);
    // The actual window is TALLER than the circle — see
    // `BUBBLE_CONTROLS_BUDGET_PX` — to give the hover controls pill room.
    let win_h: u32 = bubble_window_height_for(size);
    // Default Loom-style anchor: flush-left with a small margin, a hair
    // above the bottom edge of the primary display. On Retina the 60
    // physical-px offset maps to ~30 logical px. Account for the extra
    // height below the circle so the circle (not the controls strip) sits
    // at the same visual position as before.
    let default_x: i32 = 48;
    let default_y: i32 = mh as i32 - win_h as i32 - 60;
    // Prefer the last-known position, clamped to the primary monitor so a
    // position saved on a now-disconnected external display can't leave
    // the bubble off-screen.
    let max_x = (mw as i32 - size as i32).max(0);
    let max_y = (mh as i32 - win_h as i32).max(0);
    let (x, y, source) = match load_bubble_position(&app) {
        Some((sx, sy)) => (sx.clamp(0, max_x), sy.clamp(0, max_y), "saved"),
        None => (default_x, default_y, "default"),
    };
    eprintln!(
        "[clips-tray] bubble pos=({},{}) source={} size={}x{} monitor={}x{}",
        x, y, source, size, win_h, mw, mh
    );
    #[allow(unused_mut)]
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
    #[cfg(target_os = "macos")]
    {
        builder = builder.accept_first_mouse(true);
    }
    let win = builder.build().map_err(|e| {
        eprintln!("[clips-tray] bubble build failed: {}", e);
        e.to_string()
    })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(size, win_h)));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    // NOTE: intentionally NOT calling `set_capture_excluded` on the bubble.
    // The bubble is the user's face — Loom's behavior is that the camera
    // PiP IS composited into the final recording (that's the whole point of
    // the bubble). NSWindowSharingNone would make macOS exclude it from
    // `getDisplayMedia`, which matches the other Clips chrome (popover,
    // toolbar, countdown) but NOT what users want for the camera bubble.
    let _ = win.show();
    eprintln!("[clips-tray] bubble shown at ({},{}) size {}", x, y, size);
    Ok(())
}

#[tauri::command]
pub async fn hide_overlays(app: AppHandle) -> Result<(), String> {
    for label in [
        COUNTDOWN_LABEL,
        TOOLBAR_LABEL,
        BUBBLE_LABEL,
        FINALIZING_LABEL,
    ] {
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
pub async fn hide_recording_chrome(app: AppHandle) -> Result<(), String> {
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
pub async fn close_bubble(app: AppHandle) -> Result<(), String> {
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
pub async fn resize_popover(app: AppHandle, height: f64) -> Result<(), String> {
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
pub async fn show_signin(app: AppHandle, url: String) -> Result<(), String> {
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
pub async fn close_signin(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("signin") {
        let _ = w.close();
    }
    Ok(())
}

/// Record the popover's current recording state. When active, clicking the
/// tray icon emits a stop event instead of toggling the popover — so the
/// user can stop a recording from anywhere with one click.
#[tauri::command]
pub async fn set_recording_state(app: AppHandle, active: bool) -> Result<(), String> {
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
pub async fn reset_state(app: AppHandle) -> Result<(), String> {
    eprintln!("[clips-tray] reset_state invoked — clearing recording flag + showing popover");
    if let Some(state) = app.try_state::<RecordingActive>() {
        if let Ok(mut g) = state.0.lock() {
            *g = false;
        }
    }
    if let Some(window) = app.get_webview_window("popover") {
        // Restore normal size in case the window was shrunk to a pinhole
        // during recording — otherwise it would reappear as a 2×2 dot.
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(360.0, 520.0)));
        position_popover(&app, &window);
        mark_popover_shown(&app);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit("clips:popover-visible", true);
    }
    Ok(())
}

/// Load the saved bubble size and return it to the frontend. Default is
/// "medium". Exposed to JS via `invoke("load_bubble_size")`.
#[tauri::command]
pub async fn load_bubble_size(app: AppHandle) -> Result<String, String> {
    Ok(load_bubble_size_name(&app))
}

/// Resize the bubble window to match the named size ("small" | "medium") and
/// persist the choice. Clamps to valid names silently — unknown values fall
/// back to medium so a typo in the frontend doesn't brick persistence.
#[tauri::command]
pub async fn set_bubble_size(app: AppHandle, size: String) -> Result<(), String> {
    let name = match size.as_str() {
        "medium" => "medium",
        _ => "small",
    };
    let px = bubble_size_for_name(name);
    let win_h = bubble_window_height_for(px);
    if let Some(win) = app.get_webview_window(BUBBLE_LABEL) {
        // Re-center the resize around the current circle's center so the
        // bubble visually grows / shrinks around its current spot instead of
        // jumping toward the top-left corner (Tauri resizes from the window's
        // origin by default). We center on the CIRCLE's center — not the
        // window center — since the controls budget strip is always beneath
        // the circle, not around it.
        let current_pos = win
            .outer_position()
            .ok()
            .map(|p| (p.x, p.y))
            .unwrap_or((0, 0));
        let current_size = win
            .outer_size()
            .ok()
            .map(|s| s.width as i32)
            .unwrap_or(BUBBLE_SIZE_SMALL as i32);
        let new_px = px as i32;
        let delta = (current_size - new_px) / 2;
        let new_x = current_pos.0 + delta;
        let new_y = current_pos.1 + delta;
        let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(px, win_h)));
        let _ = win.set_position(PhysicalPosition::new(new_x, new_y));
    }
    save_bubble_size_name(&app, name);
    Ok(())
}

/// Persist the bubble position so it survives restarts. Exposed to JS via
/// `invoke("save_bubble_position", { x, y })`. Writes atomically (temp file +
/// rename) so a crash mid-write can't corrupt the JSON blob.
#[tauri::command]
pub async fn save_bubble_position(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
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

#[tauri::command]
pub async fn show_popover(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("popover") {
        // Restore the popover's normal size — it may have been shrunk to 2×2
        // during recording by `park_popover_offscreen` (kept the JS alive
        // while keeping the window out of the way). The content's
        // ResizeObserver will call `resize_popover` on the next render to
        // fine-tune the height, but we need a sensible starting size so
        // `position_popover` can anchor correctly.
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(360.0, 520.0)));
        position_popover(&app, &window);
        mark_popover_shown(&app);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit("clips:popover-visible", true);
    }
    Ok(())
}

/// Shrink the popover to a 2x2 pinhole anchored on the primary screen WITHOUT
/// hiding it. Used during recording to hide the popover from the user while
/// keeping its JS alive.
///
/// History: we used to park the window off-screen at (99999,99999). That kept
/// AppKit's backing surface alive, but on macOS 15+ WKWebView treats a window
/// with no on-screen pixels as "occluded" and throttles the whole page's JS —
/// `requestAnimationFrame`, `setInterval`, and (critically) `<video>` playback
/// + `requestVideoFrameCallback` all stall. The bubble frame pump is owned by
/// this popover, so the moment we parked it the bubble showed its last frame
/// and froze.
///
/// Fix: anchor the window at a visible coordinate on the primary screen and
/// shrink it to 2x2 physical pixels. From WKWebView's point of view the
/// window IS on-screen — no occlusion, no throttling, pump keeps ticking. The
/// user sees a 2-pixel dot that effectively vanishes against any pixel the
/// cursor won't touch. NSWindowSharingNone is already set on the popover, so
/// it stays out of the recording either way.
///
/// Call `show_popover` to restore normal size + tray-anchored position when
/// the recording ends.
#[tauri::command]
pub async fn park_popover_offscreen(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("popover") {
        // Anchor near the top-left of the primary display. We avoid (0,0)
        // exactly because on some macOS versions that corner falls under the
        // menu-bar cutout — 2,2 is safely inside every real display's bounds.
        let _ = window.set_position(PhysicalPosition::new(2_i32, 2_i32));
        // 2x2 physical px = 1x1 logical on retina — visually a dot that
        // disappears into the menu-bar shadow. Going smaller than 2x2 has
        // caused AppKit to treat the window as "empty" on some macOS builds.
        let _ = window.set_size(tauri::Size::Physical(PhysicalSize::new(2, 2)));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Public helpers used by tray.rs and shortcuts.rs
// ---------------------------------------------------------------------------

pub fn toggle_popover(app: &AppHandle) {
    let Some(window) = app.get_webview_window("popover") else {
        return;
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        let _ = app.emit("clips:popover-visible", false);
    } else {
        // Restore normal size in case the window was shrunk to a pinhole
        // during recording — otherwise it would reappear as a 2x2 dot.
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(360.0, 520.0)));
        position_popover(app, &window);
        mark_popover_shown(app);
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit("clips:popover-visible", true);
    }
}

pub fn position_popover(app: &AppHandle, window: &WebviewWindow) {
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
