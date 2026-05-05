#[cfg(target_os = "macos")]
use std::io::Write;
use std::path::PathBuf;
#[cfg(target_os = "macos")]
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::dlog;
use crate::state::{
    DictationActive, LastTranscript, RecordingActive, TrayAnchor, VoiceWakePopover,
};
use crate::util::{
    build_overlay_url, hide_voice_wake_popover, mark_popover_shown, primary_monitor_physical_size,
    set_capture_excluded, set_capture_included, set_dictation_active,
};

/// Native overlay windows for the recording experience. These render the same
/// React bundle with a hash route that `main.tsx` uses to pick the component.
const COUNTDOWN_LABEL: &str = "countdown";
const TOOLBAR_LABEL: &str = "toolbar";
const BUBBLE_LABEL: &str = "bubble";
const FINALIZING_LABEL: &str = "finalizing";
const FLOW_BAR_LABEL: &str = "flow-bar";

/// Physical-pixel bubble sizes. Logical px on retina = physical / 2, so these
/// map to ~96 (small) and ~180 (medium) logical px — matching Loom's camera
/// bubble sizes exactly. Small is the default so the bubble feels like a
/// quiet PiP rather than a giant circle the user has to shrink on every
/// launch — this matches Loom's out-of-the-box behavior.
const BUBBLE_SIZE_SMALL: u32 = 360;
const BUBBLE_SIZE_MEDIUM: u32 = 504;

#[cfg(target_os = "macos")]
#[link(name = "AppKit", kind = "framework")]
extern "C" {}

#[derive(Clone, Copy, Debug)]
enum TextInsertionStrategy {
    ClipboardPaste,
    UnicodeType,
}

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
    dlog!("[clips-tray] show_countdown invoked");
    mark_popover_shown(&app);
    if let Some(existing) = app.get_webview_window(COUNTDOWN_LABEL) {
        let _ = existing.close();
    }
    let (mw, mh) = primary_monitor_physical_size(&app).unwrap_or((2880, 1800));
    dlog!("[clips-tray] countdown target size {}x{} physical", mw, mh);
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
    dlog!("[clips-tray] countdown shown");
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
    dlog!("[clips-tray] show_finalizing invoked");
    if let Some(existing) = app.get_webview_window(FINALIZING_LABEL) {
        let _ = existing.close();
    }
    let (mw, mh) = primary_monitor_physical_size(&app).unwrap_or((2880, 1800));
    dlog!("[clips-tray] finalizing target size {}x{} physical", mw, mh);
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
    dlog!("[clips-tray] finalizing shown");
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
    dlog!("[clips-tray] show_toolbar invoked");
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
    dlog!("[clips-tray] toolbar pos=({},{}) size={}x{}", x, y, w, h);
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
    dlog!("[clips-tray] toolbar shown");

    // Granola-fidelity recording UX: the bottom-center pill is the SINGLE
    // recording indicator across Clips screen-recordings, Meetings, and
    // Wispr-style voice dictation. Spawn it alongside the legacy left-rail
    // toolbar so users always see the live transcript + stop control no
    // matter which surface kicked off the recording. Errors are swallowed
    // — the toolbar is the authoritative stop control; the pill is a
    // quality-of-life addition.
    let app_for_pill = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = crate::recording_indicator::recording_pill_show(
            app_for_pill,
            None,
            Some(crate::recording_indicator::PillMode::Clip),
        )
        .await;
    });

    Ok(())
}

/// Circular, draggable webcam bubble — small always-on-top window that hosts
/// its own getUserMedia stream and floats over everything the user captures.
#[tauri::command]
pub async fn show_bubble(app: AppHandle) -> Result<(), String> {
    dlog!("[clips-tray] show_bubble invoked");
    // Reset the blur guard — getUserMedia for the camera can trigger a
    // macOS permission dialog that steals focus from the popover.
    mark_popover_shown(&app);
    if let Some(existing) = app.get_webview_window(BUBBLE_LABEL) {
        let _ = existing.show();
        dlog!("[clips-tray] bubble reused");
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
    dlog!(
        "[clips-tray] bubble pos=({},{}) source={} size={}x{} monitor={}x{}",
        x,
        y,
        source,
        size,
        win_h,
        mw,
        mh
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
    dlog!("[clips-tray] bubble shown at ({},{}) size {}", x, y, size);
    Ok(())
}

#[tauri::command]
pub async fn hide_overlays(app: AppHandle) -> Result<(), String> {
    for label in [
        COUNTDOWN_LABEL,
        TOOLBAR_LABEL,
        BUBBLE_LABEL,
        FINALIZING_LABEL,
        FLOW_BAR_LABEL,
    ] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.close();
        }
    }
    // Granola pill is part of the same recording chrome — tear it down too.
    let _ = crate::recording_indicator::recording_pill_hide(app).await;
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
    // Auto-hide the Granola pill ~1s after recording stops so the user
    // sees the timer freeze briefly before it disappears (matches Granola).
    // The brief delay is intentional UX polish — bail early if a new
    // recording came up in the meantime.
    let app_for_pill = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
        if !crate::util::is_recording_active(&app_for_pill) {
            let _ = crate::recording_indicator::recording_pill_hide(app_for_pill).await;
        }
    });
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
        dlog!("[clips-tray] close_bubble — destroying bubble webview");
        let _ = w.close();
    } else {
        dlog!("[clips-tray] close_bubble — no bubble window to close");
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
pub async fn resize_popover(app: AppHandle, height: f64, width: Option<f64>) -> Result<(), String> {
    // CRITICAL: bail out when the popover is parked at 2x2 for voice
    // wake-up. The React shell's ResizeObserver fires on every mount
    // and would un-park the window back to full size, making the
    // Clips UI flash on every Fn press AND steal focus from the
    // foreground app. The window must stay invisible-but-alive until
    // hide_flow_bar clears the wake flag.
    let voice_woken = app
        .try_state::<VoiceWakePopover>()
        .and_then(|state| state.0.lock().ok().map(|g| *g))
        .unwrap_or(false);
    if voice_woken {
        return Ok(());
    }
    if let Some(w) = app.get_webview_window("popover") {
        let clamped = height.clamp(200.0, 820.0);
        let width = width.unwrap_or(360.0).clamp(320.0, 480.0);
        let _ = w.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            width, clamped,
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

/// Show the dictation pill at the bottom-center of the
/// primary display. The React overlay is driven by `voice:*` events.
///
/// Reuses an existing flow-bar window if one is alive (just repositions
/// and shows it), so back-to-back Fn presses don't pay the ~200ms WebKit
/// spin-up cost on every press. The React component listens for
/// `voice:state-change` to reset its visual state.
#[tauri::command]
pub async fn show_flow_bar(app: AppHandle) -> Result<(), String> {
    dlog!("[clips-tray] show_flow_bar invoked");

    let (mw, mh) = primary_monitor_physical_size(&app).unwrap_or((2880, 1800));
    // Wider + taller than the pill alone so the live transcript chip
    // can stack above it. Height accommodates: bottom-anchored 32px pill
    // + 6px gap + ~28px transcript chip + drop-shadow margin.
    let w: u32 = 420;
    let h: u32 = 120;
    let x: i32 = ((mw as i32 - w as i32) / 2).max(0);
    // Bottom margin: ~14 logical px ≈ 28 physical px.
    let y: i32 = (mh as i32 - h as i32 - 28).max(0);

    if let Some(existing) = app.get_webview_window(FLOW_BAR_LABEL) {
        // Reposition (in case the user changed display geometry between
        // sessions) and bring it back into view WITHOUT stealing focus
        // from the user's foreground app. State reset is handled by the
        // JS side emitting voice:state-change.
        let _ = existing.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
        let _ = existing.set_position(PhysicalPosition::new(x, y));
        let _ = existing.set_ignore_cursor_events(false);
        crate::util::show_without_activation(&existing);
        return Ok(());
    }

    let win = WebviewWindowBuilder::new(&app, FLOW_BAR_LABEL, build_overlay_url("flow-bar"))
        .title("Voice")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false)
        .focused(false)
        .build()
        .map_err(|e| {
            eprintln!("[clips-tray] flow bar build failed: {}", e);
            e.to_string()
        })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    // The flow bar contains a visible cancel button, so it must be a real
    // click target. Keep the OS window compact instead of making a wide
    // click-through rectangle that strands the X button.
    let _ = win.set_ignore_cursor_events(false);
    set_capture_excluded(&win);
    crate::util::show_without_activation(&win);
    let app_for_timeout = app.clone();
    thread::spawn(move || {
        // Long-tail safety net: if the JS cleanup path doesn't reach
        // hide_flow_bar (hung getUserMedia, missed listener, network
        // stall during transcription), force-close the overlay so the
        // user is never stuck staring at it. 15s is past any realistic
        // Whisper round-trip and well past the recording / processing
        // happy paths. Re-checks DictationActive so we don't kill the
        // bar while the user is still holding the shortcut.
        thread::sleep(Duration::from_secs(15));
        let dictating = app_for_timeout
            .try_state::<DictationActive>()
            .and_then(|state| state.0.lock().ok().map(|g| *g))
            .unwrap_or(false);
        if !dictating {
            if let Some(w) = app_for_timeout.get_webview_window(FLOW_BAR_LABEL) {
                eprintln!("[clips-tray] hiding stale voice overlay after timeout");
                let _ = w.hide();
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn hide_flow_bar(app: AppHandle) -> Result<(), String> {
    set_dictation_active(&app, false);
    // Hide (don't close) so the next show_flow_bar can reuse the window
    // and avoid the ~200ms WebKit cold-start that creates the stutter
    // on second/third Fn presses.
    if let Some(w) = app.get_webview_window(FLOW_BAR_LABEL) {
        let _ = w.hide();
    }
    hide_voice_wake_popover(&app);
    Ok(())
}

#[tauri::command]
pub async fn complete_voice_dictation(app: AppHandle, text: String) -> Result<(), String> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        eprintln!("[clips-tray] complete_voice_dictation: empty text — nothing to paste");
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    let frontmost_bundle_id = frontmost_bundle_identifier();
    #[cfg(target_os = "macos")]
    let strategy = text_insertion_strategy(frontmost_bundle_id.as_deref());
    #[cfg(target_os = "macos")]
    eprintln!(
        "[clips-tray] complete_voice_dictation: inserting {} chars via {:?} (frontmost={})",
        trimmed.chars().count(),
        strategy,
        frontmost_bundle_id.as_deref().unwrap_or("unknown"),
    );
    #[cfg(not(target_os = "macos"))]
    eprintln!(
        "[clips-tray] complete_voice_dictation: inserting {} chars",
        trimmed.chars().count(),
    );
    if let Some(last) = app.try_state::<LastTranscript>() {
        if let Ok(mut g) = last.0.lock() {
            *g = Some(trimmed.clone());
        }
    }
    // Keep the clipboard updated so users can Cmd+V again to repeat the
    // last dictation. For normal GUI apps, paste via the clipboard so
    // Chrome/Gmail receives one ordinary paste operation instead of a long
    // stream of synthetic Unicode key events through AppKit text input.
    // Known terminal apps still use direct Unicode typing because custom
    // terminal paste bindings can intercept Cmd+V or bypass paste handling.
    write_clipboard(&trimmed)?;
    #[cfg(target_os = "macos")]
    match strategy {
        TextInsertionStrategy::ClipboardPaste => paste_clipboard(),
        TextInsertionStrategy::UnicodeType => type_text_unicode(&trimmed),
    }
    #[cfg(not(target_os = "macos"))]
    type_text_unicode(&trimmed);
    Ok(())
}

fn text_insertion_strategy(bundle_id: Option<&str>) -> TextInsertionStrategy {
    if bundle_id.map(is_terminal_bundle).unwrap_or(false) {
        TextInsertionStrategy::UnicodeType
    } else {
        TextInsertionStrategy::ClipboardPaste
    }
}

fn is_terminal_bundle(bundle_id: &str) -> bool {
    matches!(
        bundle_id,
        "com.apple.Terminal"
            | "com.googlecode.iterm2"
            | "com.mitchellh.ghostty"
            | "dev.warp.Warp-Stable"
            | "dev.warp.Warp-Preview"
            | "com.github.wez.wezterm"
            | "org.wezfurlong.wezterm"
            | "io.alacritty"
            | "org.alacritty"
            | "net.kovidgoyal.kitty"
            | "co.zeit.hyper"
    )
}

#[cfg(test)]
mod tests {
    use super::{text_insertion_strategy, TextInsertionStrategy};

    #[test]
    fn uses_clipboard_paste_for_chrome() {
        assert!(matches!(
            text_insertion_strategy(Some("com.google.Chrome")),
            TextInsertionStrategy::ClipboardPaste
        ));
    }

    #[test]
    fn uses_unicode_typing_for_terminal_apps() {
        assert!(matches!(
            text_insertion_strategy(Some("com.mitchellh.ghostty")),
            TextInsertionStrategy::UnicodeType
        ));
    }

    #[test]
    fn defaults_to_clipboard_paste_when_frontmost_app_is_unknown() {
        assert!(matches!(
            text_insertion_strategy(None),
            TextInsertionStrategy::ClipboardPaste
        ));
    }
}

#[cfg(target_os = "macos")]
fn write_clipboard(text: &str) -> Result<(), String> {
    let mut child = Command::new("pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("pbcopy spawn: {e}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| format!("pbcopy write: {e}"))?;
    }
    let status = child.wait().map_err(|e| format!("pbcopy wait: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("pbcopy exited with {status}"))
    }
}

// Voice-dictation paste relies on macOS-specific `pbcopy` + CGEvent paste; the
// non-mac path is an explicit error so the JS layer can surface a clear
// message rather than the user seeing a silent failure.
#[cfg(not(target_os = "macos"))]
fn write_clipboard(_text: &str) -> Result<(), String> {
    Err("voice dictation is currently macOS-only".to_string())
}

#[cfg(target_os = "macos")]
fn frontmost_bundle_identifier() -> Option<String> {
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};

    unsafe {
        let class_name = std::ffi::CString::new("NSWorkspace").ok()?;
        let cls: &AnyClass = AnyClass::get(&class_name)?;
        let workspace: *mut AnyObject = msg_send![cls, sharedWorkspace];
        if workspace.is_null() {
            return None;
        }
        let app: *mut AnyObject = msg_send![workspace, frontmostApplication];
        if app.is_null() {
            return None;
        }
        let bundle_id: *mut AnyObject = msg_send![app, bundleIdentifier];
        ns_string_to_owned(bundle_id)
    }
}

#[cfg(target_os = "macos")]
unsafe fn ns_string_to_owned(ptr: *mut objc2::runtime::AnyObject) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    let utf8_ptr: *const i8 = objc2::msg_send![ptr, UTF8String];
    if utf8_ptr.is_null() {
        return None;
    }
    let cstr = std::ffi::CStr::from_ptr(utf8_ptr);
    Some(cstr.to_string_lossy().into_owned())
}

#[cfg(target_os = "macos")]
fn paste_clipboard() {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    thread::spawn(move || {
        thread::sleep(Duration::from_millis(40));
        let Ok(source) = CGEventSource::new(CGEventSourceStateID::HIDSystemState) else {
            eprintln!("[clips-tray] paste failed: no CGEventSource");
            return;
        };
        // macOS virtual keycode 9 is "V".
        let Ok(down) = CGEvent::new_keyboard_event(source.clone(), 9, true) else {
            eprintln!("[clips-tray] paste failed: no keydown event");
            return;
        };
        let Ok(up) = CGEvent::new_keyboard_event(source, 9, false) else {
            eprintln!("[clips-tray] paste failed: no keyup event");
            return;
        };
        let flags = CGEventFlags::CGEventFlagCommand;
        down.set_flags(flags);
        up.set_flags(flags);
        down.post(CGEventTapLocation::HID);
        thread::sleep(Duration::from_millis(8));
        up.post(CGEventTapLocation::HID);
    });
}

#[cfg(target_os = "macos")]
fn type_text_unicode(text: &str) {
    use core_graphics::event::{CGEvent, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    let owned = text.to_string();
    thread::spawn(move || {
        // Brief delay so the focused-app context is ready (mirrors the
        // delay the previous Cmd+V path used).
        thread::sleep(Duration::from_millis(40));
        let Ok(source) = CGEventSource::new(CGEventSourceStateID::HIDSystemState) else {
            eprintln!("[clips-tray] type failed: no CGEventSource");
            return;
        };
        // CGEventKeyboardSetUnicodeString has a per-event payload limit
        // (Apple docs: ~20 UTF-16 units, with longer bounded by ~75 char
        // in practice). Chunk by codepoint to stay safely under that.
        let chunks: Vec<String> = {
            let mut out: Vec<String> = Vec::new();
            let mut current = String::new();
            let mut count = 0usize;
            for c in owned.chars() {
                current.push(c);
                count += 1;
                if count >= 20 {
                    out.push(std::mem::take(&mut current));
                    count = 0;
                }
            }
            if !current.is_empty() {
                out.push(current);
            }
            out
        };
        for chunk in chunks {
            let utf16: Vec<u16> = chunk.encode_utf16().collect();
            let Ok(down) = CGEvent::new_keyboard_event(source.clone(), 0, true) else {
                eprintln!("[clips-tray] type failed: no keydown event");
                return;
            };
            let Ok(up) = CGEvent::new_keyboard_event(source.clone(), 0, false) else {
                eprintln!("[clips-tray] type failed: no keyup event");
                return;
            };
            down.set_string_from_utf16_unchecked(&utf16);
            up.set_string_from_utf16_unchecked(&utf16);
            down.post(CGEventTapLocation::HID);
            up.post(CGEventTapLocation::HID);
            // Tiny gap between chunks gives terminal apps time to digest
            // each batch — without this, Ghostty occasionally drops the
            // tail of long inserts.
            thread::sleep(Duration::from_millis(2));
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn type_text_unicode(_text: &str) {}

/// Record the popover's current recording state. When active, clicking the
/// tray icon emits a stop event instead of toggling the popover — so the
/// user can stop a recording from anywhere with one click.
#[tauri::command]
pub async fn set_recording_state(app: AppHandle, active: bool) -> Result<(), String> {
    dlog!("[clips-tray] set_recording_state active={}", active);
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
        set_capture_included(&window);
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
        set_capture_excluded(&window);
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
    // Voice-wake parks the popover at 2x2 px and leaves it "visible" from
    // AppKit's perspective so its JS keeps running. If a tray click lands
    // while the wake flag is still set, the user wants to OPEN the
    // popover normally — not toggle it shut. Treat the parked state as
    // "user-invisible" so we always show full size on click. Without
    // this, the user has to click the tray icon twice to see the popover
    // after any voice dictation: first click hides the parked window,
    // second click finally shows it.
    let voice_woken = app
        .try_state::<VoiceWakePopover>()
        .and_then(|s| s.0.lock().ok().map(|g| *g))
        .unwrap_or(false);
    let user_visible = window.is_visible().unwrap_or(false) && !voice_woken;
    if user_visible {
        let _ = window.hide();
        let _ = app.emit("clips:popover-visible", false);
        return;
    }
    if voice_woken {
        // Voice wake is over from the user's POV — clear the flag so the
        // hide_flow_bar safety net doesn't double-hide the popover later.
        if let Some(state) = app.try_state::<VoiceWakePopover>() {
            if let Ok(mut g) = state.0.lock() {
                *g = false;
            }
        }
    }
    // Restore normal size in case the window was shrunk to a pinhole
    // during recording / voice-wake — otherwise it would reappear as a
    // 2x2 dot.
    set_capture_included(&window);
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(360.0, 520.0)));
    position_popover(app, &window);
    mark_popover_shown(app);
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit("clips:popover-visible", true);
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
