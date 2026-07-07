#[cfg(target_os = "macos")]
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
#[cfg(target_os = "macos")]
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::dlog;
use crate::state::{
    DictationActive, LastTranscript, MeetingActive, RecordingActive, TrayAnchor, VoiceTargetBundle,
    VoiceWakePopover,
};
use crate::util::{
    build_overlay_url, configure_overlay_behavior, hide_voice_wake_popover, is_recording_active,
    mark_popover_shown, present_interactive_window, set_capture_excluded,
    set_capture_excluded_always, set_capture_included, tray_monitor_physical_rect,
};

/// Native overlay windows for the recording experience. These render the same
/// React bundle with a hash route that `main.tsx` uses to pick the component.
const COUNTDOWN_LABEL: &str = "countdown";
const TOOLBAR_LABEL: &str = "toolbar";
// Geometry of the two circular cancel/skip buttons that flank the countdown
// number. These MUST stay in sync with the CSS in
// `templates/clips/desktop/src/styles.css` (`.countdown-control` is 64px and
// its center sits ±200px logical from the window center). A few px of slop is
// added to each hit-rect so edge clicks register.
const COUNTDOWN_CONTROL_OFFSET_X: f64 = 200.0;
const COUNTDOWN_CONTROL_DIAMETER: f64 = 64.0;
const COUNTDOWN_CONTROL_HIT_PAD: f64 = 8.0;
// Guards the single cursor-poll loop that toggles click-through on the
// countdown overlay so only the button zones are interactive.
static COUNTDOWN_CONTROL_TRACKING: AtomicBool = AtomicBool::new(false);
const BUBBLE_LABEL: &str = "bubble";
const FINALIZING_LABEL: &str = "finalizing";
const FLOW_BAR_LABEL: &str = "flow-bar";
const REGION_GUIDES_LABEL: &str = "region-guides";
const REGION_GUIDE_EDITOR_LABEL: &str = "region-guide-editor";
const REGION_RECORD_BORDER_LABEL: &str = "region-record-border";
const ONBOARDING_LABEL: &str = "onboarding";
const ONBOARDING_WIDTH_LOGICAL: f64 = 560.0;
const ONBOARDING_HEIGHT_LOGICAL: f64 = 640.0;

/// Physical-pixel bubble sizes. Logical px on retina = physical / 2, so these
/// map to ~96 (small) and ~180 (medium) logical px — matching Loom's camera
/// bubble sizes exactly. Small is the default so the bubble feels like a
/// quiet PiP rather than a giant circle the user has to shrink on every
/// launch — this matches Loom's out-of-the-box behavior.
const BUBBLE_SIZE_SMALL: u32 = 360;
const BUBBLE_SIZE_MEDIUM: u32 = 504;
const POPOVER_SHADOW_GUTTER_LOGICAL: f64 = 12.0;
const POPOVER_DEFAULT_WIDTH_LOGICAL: f64 = 360.0;
const POPOVER_DEFAULT_HEIGHT_LOGICAL: f64 = 520.0;
const OVERLAY_SHADOW_GUTTER_LOGICAL: f64 = 18.0;

#[cfg(target_os = "macos")]
#[link(name = "AppKit", kind = "framework")]
extern "C" {}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

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
/// an 8px gap from the circle, with a small cushion at the window bottom.
const BUBBLE_CONTROLS_BUDGET_PX: u32 = 80;

fn overlay_scale_factor(app: &AppHandle) -> f64 {
    app.get_webview_window("popover")
        .and_then(|w| w.scale_factor().ok())
        .or_else(|| {
            app.primary_monitor()
                .ok()
                .flatten()
                .map(|monitor| monitor.scale_factor())
        })
        .unwrap_or(2.0)
        .max(1.0)
}

fn overlay_shadow_gutter_physical(app: &AppHandle) -> u32 {
    (OVERLAY_SHADOW_GUTTER_LOGICAL * overlay_scale_factor(app)).round() as u32
}

fn popover_window_size_logical(content_width: f64, content_height: f64) -> (f64, f64) {
    let gutter = POPOVER_SHADOW_GUTTER_LOGICAL * 2.0;
    (content_width + gutter, content_height + gutter)
}

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

fn bubble_window_size_for(app: &AppHandle, size: u32) -> (u32, u32) {
    let gutter = overlay_shadow_gutter_physical(app);
    let content_h = bubble_window_height_for(size);
    (size + gutter * 2, content_h + gutter * 2)
}

fn monitor_rects_for_bubble(app: &AppHandle) -> Vec<(i32, i32, u32, u32)> {
    app.get_webview_window(BUBBLE_LABEL)
        .or_else(|| app.get_webview_window("popover"))
        .and_then(|window| window.available_monitors().ok())
        .map(|monitors| {
            monitors
                .into_iter()
                .map(|monitor| {
                    let pos = monitor.position();
                    let size = monitor.size();
                    (pos.x, pos.y, size.width, size.height)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn distance_to_rect_squared(cx: i32, cy: i32, rect: (i32, i32, u32, u32)) -> i64 {
    let (rx, ry, rw, rh) = rect;
    let right = rx + rw as i32;
    let bottom = ry + rh as i32;
    let dx = i64::from(if cx < rx {
        rx - cx
    } else if cx > right {
        cx - right
    } else {
        0
    });
    let dy = i64::from(if cy < ry {
        ry - cy
    } else if cy > bottom {
        cy - bottom
    } else {
        0
    });
    dx * dx + dy * dy
}

fn bubble_target_monitor_rect(
    app: &AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> (i32, i32, u32, u32) {
    let cx = x + width as i32 / 2;
    let cy = y + height as i32 / 2;
    let rects = monitor_rects_for_bubble(app);

    rects
        .iter()
        .copied()
        .find(|(rx, ry, rw, rh)| {
            cx >= *rx && cx < *rx + *rw as i32 && cy >= *ry && cy < *ry + *rh as i32
        })
        .or_else(|| {
            rects
                .iter()
                .copied()
                .min_by_key(|rect| distance_to_rect_squared(cx, cy, *rect))
        })
        .unwrap_or_else(|| tray_monitor_physical_rect(app))
}

fn clamp_bubble_window_position(
    app: &AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> (i32, i32) {
    let (mx, my, mw, mh) = bubble_target_monitor_rect(app, x, y, width, height);
    let max_x = (mx + mw as i32 - width as i32).max(mx);
    let max_y = (my + mh as i32 - height as i32).max(my);
    (x.clamp(mx, max_x), y.clamp(my, max_y))
}

fn clamp_existing_bubble_window(app: &AppHandle, window: &WebviewWindow) {
    let Ok(pos) = window.outer_position() else {
        return;
    };
    let Ok(size) = window.outer_size() else {
        return;
    };
    let (x, y) = clamp_bubble_window_position(app, pos.x, pos.y, size.width, size.height);
    if x != pos.x || y != pos.y {
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

/// True while the user is hand-dragging the bubble through the JS pointer
/// handlers (`bubble_drag_start` / `bubble_drag_move` / `bubble_drag_end`).
///
/// While this is set, the bubble's `Moved` event handler skips its own clamp.
/// That handler used to re-clamp on EVERY move — including the OS-native drag's
/// interpolated moves — calling `set_position` to snap the window back inside
/// the screen. During a drag the OS keeps shoving the window back out toward the
/// cursor, so the snap-back and the OS fought each frame and the bubble
/// visibly jittered. Now the drag-move command is the sole authority on
/// position during a drag and clamps every frame itself, so the handler must
/// yield to it.
static BUBBLE_DRAGGING: AtomicBool = AtomicBool::new(false);

/// Anchor captured at the start of a hand-drag: the global cursor position and
/// the bubble window's top-left, both in physical px with a desktop top-left
/// origin (the same space `cursor_position()` / `outer_position()` report in).
/// Each move computes `win_start + (cursor_now - cursor_start)` so the bubble
/// tracks the cursor 1:1, then clamps to the monitor BEFORE moving.
struct BubbleDragAnchor {
    cursor_x: i32,
    cursor_y: i32,
    win_x: i32,
    win_y: i32,
}

fn bubble_drag_anchor() -> &'static Mutex<Option<BubbleDragAnchor>> {
    static ANCHOR: OnceLock<Mutex<Option<BubbleDragAnchor>>> = OnceLock::new();
    ANCHOR.get_or_init(|| Mutex::new(None))
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
        stop_countdown_control_tracking();
        let _ = app.emit("clips:countdown-shortcuts-active", false);
        let _ = existing.close();
    }
    let (mx, my, mw, mh) = tray_monitor_physical_rect(&app);
    dlog!(
        "[clips-tray] countdown target {}x{} at ({},{}) physical",
        mw,
        mh,
        mx,
        my
    );
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
    let _ = win.set_position(PhysicalPosition::new(mx, my));
    let _ = win.set_ignore_cursor_events(true);
    set_capture_excluded(&win);
    configure_overlay_behavior(&win);
    let _ = win.show();
    let _ = app.emit("clips:countdown-shortcuts-active", true);
    start_countdown_control_tracking(&app);
    dlog!("[clips-tray] countdown shown");
    Ok(())
}

/// True when the global cursor sits inside either circular cancel/skip button
/// zone of the countdown overlay. The controls row is centered in the window;
/// each button's center is `COUNTDOWN_CONTROL_OFFSET_X` logical px to the
/// left/right of the window center, vertically at the window center. Cursor,
/// window position, and window size all come from Tauri in physical px with a
/// desktop top-left origin, so we convert the logical button geometry using the
/// window's scale factor and do a plain point-in-rect test.
fn cursor_over_countdown_control(window: &WebviewWindow) -> bool {
    let (Ok(c), Ok(p), Ok(s), Ok(scale)) = (
        window.cursor_position(),
        window.outer_position(),
        window.outer_size(),
        window.scale_factor(),
    ) else {
        return false;
    };
    let center_x = p.x as f64 + s.width as f64 / 2.0;
    let center_y = p.y as f64 + s.height as f64 / 2.0;
    let half = (COUNTDOWN_CONTROL_DIAMETER / 2.0 + COUNTDOWN_CONTROL_HIT_PAD) * scale;
    let offset = COUNTDOWN_CONTROL_OFFSET_X * scale;
    let in_button = |bx: f64| -> bool {
        c.x >= bx - half && c.x <= bx + half && c.y >= center_y - half && c.y <= center_y + half
    };
    in_button(center_x - offset) || in_button(center_x + offset)
}

/// Poll the cursor against the two button zones while the countdown overlay is
/// alive, toggling `set_ignore_cursor_events` so the buttons are clickable only
/// when the cursor is over them and the rest of the screen stays click-through.
/// Idempotent; mirrors `start_pill_hover_tracking` in `recording_indicator.rs`.
fn start_countdown_control_tracking(app: &AppHandle) {
    if COUNTDOWN_CONTROL_TRACKING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut prev_interactive = false;
        while COUNTDOWN_CONTROL_TRACKING.load(Ordering::Relaxed) {
            let Some(win) = app.get_webview_window(COUNTDOWN_LABEL) else {
                break;
            };
            let over = cursor_over_countdown_control(&win);
            if over != prev_interactive {
                prev_interactive = over;
                // ignore_cursor_events(false) => clicks land on the buttons.
                let _ = win.set_ignore_cursor_events(!over);
            }
            tokio::time::sleep(Duration::from_millis(70)).await;
        }
        COUNTDOWN_CONTROL_TRACKING.store(false, Ordering::SeqCst);
    });
}

fn stop_countdown_control_tracking() {
    COUNTDOWN_CONTROL_TRACKING.store(false, Ordering::SeqCst);
}

/// Full-screen transparent overlay that shows compact bottom-left progress
/// while the recorder flushes its final chunks and awaits the server finalize.
/// Rendered immediately after the user clicks Stop so they don't stare at a
/// blank screen for a few seconds while `recorder.stop()` completes. Ignores
/// cursor events so the progress card does not block the screen. Marked
/// non-sharable for consistency with the other Clips overlays, even though
/// the recording has already ended by the time this appears.
#[tauri::command]
pub async fn show_finalizing(app: AppHandle) -> Result<(), String> {
    dlog!("[clips-tray] show_finalizing invoked");
    if let Some(existing) = app.get_webview_window(FINALIZING_LABEL) {
        let _ = existing.close();
    }
    let (mx, my, mw, mh) = tray_monitor_physical_rect(&app);
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
    let _ = win.set_position(PhysicalPosition::new(mx, my));
    let _ = win.set_ignore_cursor_events(true);
    set_capture_excluded(&win);
    configure_overlay_behavior(&win);
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

/// First-run onboarding window (ONBOARD-WINDOW). Unlike the transparent,
/// click-through overlays above, this is a normal decorated, focused window
/// with its own solid dark background (`.onboarding-root` in styles.css) —
/// centered on the primary display so it reads as a real app window, not a
/// HUD. Called once from `lib.rs`'s `setup()` when `onboarding_complete` is
/// false. Reuses an existing window if one is somehow already open (e.g. a
/// hot-reload re-triggering setup in dev) instead of building a second one.
pub fn show_onboarding_window(app: &AppHandle) {
    if let Some(existing) = app.get_webview_window(ONBOARDING_LABEL) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return;
    }
    let win =
        match WebviewWindowBuilder::new(app, ONBOARDING_LABEL, build_overlay_url("onboarding"))
            .title("Welcome to Clips")
            .inner_size(ONBOARDING_WIDTH_LOGICAL, ONBOARDING_HEIGHT_LOGICAL)
            .resizable(false)
            .center()
            .focused(true)
            .build()
        {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[clips-tray] onboarding window build failed: {}", e);
                return;
            }
        };
    let _ = win.show();
}

/// Close the first-run onboarding window once the overlay's finish handler
/// has saved feature config + opened the popover. Idempotent — closing an
/// already-closed/never-built window is a no-op.
#[tauri::command]
pub async fn hide_onboarding_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(ONBOARDING_LABEL) {
        let _ = w.close();
    }
    Ok(())
}

/// Full-screen, click-through recording guides. The React view renders the
/// saved translucent rectangles, while AppKit marks the whole overlay as
/// non-shareable so the guides stay private to the recorder.
#[tauri::command]
pub async fn show_region_guides(app: AppHandle) -> Result<(), String> {
    let guides = crate::config::feature_config(&app).region_guides;
    if !guides.enabled || guides.rects.is_empty() {
        if let Some(existing) = app.get_webview_window(REGION_GUIDES_LABEL) {
            let _ = existing.close();
        }
        return Ok(());
    }

    if let Some(existing) = app.get_webview_window(REGION_GUIDES_LABEL) {
        let _ = existing.show();
        return Ok(());
    }

    let (mx, my, mw, mh) = tray_monitor_physical_rect(&app);
    let win = WebviewWindowBuilder::new(
        &app,
        REGION_GUIDES_LABEL,
        build_overlay_url("region-guides"),
    )
    .title("Clips Region Guides")
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
        eprintln!("[clips-tray] region guides build failed: {}", e);
        e.to_string()
    })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(mw, mh)));
    let _ = win.set_position(PhysicalPosition::new(mx, my));
    let _ = win.set_ignore_cursor_events(true);
    set_capture_excluded_always(&win);
    configure_overlay_behavior(&win);
    crate::util::show_without_activation(&win);
    Ok(())
}

#[tauri::command]
pub async fn hide_region_guides(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(REGION_GUIDES_LABEL) {
        let _ = w.close();
    }
    Ok(())
}

/// Live border framing the region currently being recorded. Like the region
/// guides this is a full-screen, click-through, capture-excluded overlay — but
/// the rect is ephemeral (it belongs to one recording, not the saved preset),
/// so it's handed in via the URL query rather than read from config. The React
/// view paints only an OUTWARD frame so the stroke stays out of the captured
/// pixels. The recording flow owns this window; it's torn down by
/// `hide_recording_chrome` / `hide_overlays` when capture stops.
#[tauri::command]
pub async fn show_region_record_border(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if !(width > 0.0 && height > 0.0) {
        return Ok(());
    }
    if let Some(existing) = app.get_webview_window(REGION_RECORD_BORDER_LABEL) {
        let _ = existing.close();
    }

    let (mx, my, mw, mh) = tray_monitor_physical_rect(&app);
    let url = WebviewUrl::App(
        format!("index.html?region={x:.6},{y:.6},{width:.6},{height:.6}#region-record-border")
            .into(),
    );
    let win = WebviewWindowBuilder::new(&app, REGION_RECORD_BORDER_LABEL, url)
        .title("Clips Recording Region")
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
            eprintln!("[clips-tray] region record border build failed: {}", e);
            e.to_string()
        })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(mw, mh)));
    let _ = win.set_position(PhysicalPosition::new(mx, my));
    let _ = win.set_ignore_cursor_events(true);
    set_capture_excluded_always(&win);
    configure_overlay_behavior(&win);
    crate::util::show_without_activation(&win);
    Ok(())
}

#[tauri::command]
pub async fn hide_region_record_border(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(REGION_RECORD_BORDER_LABEL) {
        let _ = w.close();
    }
    Ok(())
}

/// Reconcile the always-on region-guides overlay with the current config.
/// Called from config saves and on startup so the guides window matches the
/// `always_visible` toggle without needing a recording-flow round trip. When a
/// recording is active the recording flow owns the `region-guides` window, so
/// we leave it alone.
pub fn reconcile_region_guides(app: &AppHandle) {
    let g = crate::config::feature_config(app).region_guides;
    if crate::util::is_recording_active(app) {
        return;
    }
    let should_show = g.always_visible && g.enabled && !g.rects.is_empty();
    if should_show {
        let a = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = show_region_guides(a).await;
        });
    } else if let Some(w) = app.get_webview_window(REGION_GUIDES_LABEL) {
        let _ = w.close();
    }
}

/// Interactive full-screen editor for the region-guide preset. It is also
/// capture-excluded so opening it during an active recording won't leak the
/// preset UI into the video.
#[tauri::command]
pub async fn show_region_guide_editor(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(REGION_GUIDE_EDITOR_LABEL) {
        let _ = existing.close();
    }

    let (mx, my, mw, mh) = tray_monitor_physical_rect(&app);
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(
        &app,
        REGION_GUIDE_EDITOR_LABEL,
        build_overlay_url("region-guides-editor"),
    )
    .title("Edit Clips Region Guides")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(false)
    .visible(false)
    .focused(true);
    #[cfg(target_os = "macos")]
    {
        builder = builder.accept_first_mouse(true);
    }
    let win = builder.build().map_err(|e| {
        eprintln!("[clips-tray] region guide editor build failed: {}", e);
        e.to_string()
    })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(mw, mh)));
    let _ = win.set_position(PhysicalPosition::new(mx, my));
    set_capture_excluded_always(&win);
    configure_overlay_behavior(&win);
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

/// Interactive full-screen one-shot selector for choosing the screen region to
/// record. The React view emits the selected normalized rectangle back to the
/// recorder and closes itself.
#[tauri::command]
pub async fn show_region_capture_selector(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(REGION_GUIDE_EDITOR_LABEL) {
        let _ = existing.close();
    }

    let (mx, my, mw, mh) = tray_monitor_physical_rect(&app);
    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(
        &app,
        REGION_GUIDE_EDITOR_LABEL,
        build_overlay_url("region-capture-selector"),
    )
    .title("Select Clips Recording Region")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(false)
    .visible(false)
    .focused(true);
    #[cfg(target_os = "macos")]
    {
        builder = builder.accept_first_mouse(true);
    }
    let win = builder.build().map_err(|e| {
        eprintln!("[clips-tray] region capture selector build failed: {}", e);
        e.to_string()
    })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(mw, mh)));
    let _ = win.set_position(PhysicalPosition::new(mx, my));
    set_capture_excluded_always(&win);
    configure_overlay_behavior(&win);
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

/// Vertical recording pill anchored to the left edge. Stop + timer + pause,
/// with hover-revealed restart/cancel controls matching Loom's left-rail
/// placement. Draggable, always on top.
#[tauri::command]
pub async fn show_toolbar(app: AppHandle) -> Result<(), String> {
    dlog!("[clips-tray] show_toolbar invoked");
    // Reset the blur guard — spawning an overlay can briefly steal focus
    // from the popover on some macOS versions even with .focused(false).
    mark_popover_shown(&app);
    let (mx, my, _mw, mh) = tray_monitor_physical_rect(&app);
    let scale = overlay_scale_factor(&app);
    let gutter = overlay_shadow_gutter_physical(&app);
    // CSS is authored in logical px, while this command sizes the native
    // window in physical px. Keep the visible toolbar large enough for the
    // fixed 30px circular controls on high-DPI displays.
    let content_w: u32 = (72.0 * scale).round() as u32;
    let collapsed_content_h: u32 = (150.0 * scale).round() as u32;
    let w: u32 = content_w + gutter * 2;
    let h: u32 = collapsed_content_h + gutter * 2;
    // Flush-left with a small margin; vertically center the collapsed pill.
    // The React toolbar temporarily resizes this window while hover/focus
    // reveals extra controls so transparent pixels don't block clicks.
    let x: i32 = mx + 48 - gutter as i32;
    let y: i32 = my + (mh as i32 - collapsed_content_h as i32) / 2 - gutter as i32;
    dlog!("[clips-tray] toolbar pos=({},{}) size={}x{}", x, y, w, h);
    if let Some(existing) = app.get_webview_window(TOOLBAR_LABEL) {
        let _ = existing.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
        let _ = existing.set_position(PhysicalPosition::new(x, y));
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
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
        // the rounded pill.
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
    configure_overlay_behavior(&win);
    let _ = win.show();
    dlog!("[clips-tray] toolbar shown");

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
        clamp_existing_bubble_window(&app, &existing);
        let _ = existing.show();
        dlog!("[clips-tray] bubble reused");
        return Ok(());
    }
    // Honor the user's last-chosen size. Default is "small" (192 physical =
    // 96 logical) so new users get a quiet PiP rather than a giant circle.
    let size_name = load_bubble_size_name(&app);
    let size: u32 = bubble_size_for_name(&size_name);
    // The actual window is TALLER than the circle — see
    // `BUBBLE_CONTROLS_BUDGET_PX` — to give the hover controls pill room.
    let gutter = overlay_shadow_gutter_physical(&app);
    let content_h: u32 = bubble_window_height_for(size);
    let (win_w, win_h) = bubble_window_size_for(&app, size);

    let (mon_x, mon_y, mon_w, mon_h) = tray_monitor_physical_rect(&app);

    // Default Loom-style anchor: flush-left with a small margin, a hair
    // above the bottom edge of the target monitor. On Retina the 60
    // physical-px offset maps to ~30 logical px.
    let default_x: i32 = mon_x + 48 - gutter as i32;
    let default_y: i32 = mon_y + mon_h as i32 - content_h as i32 - 60 - gutter as i32;
    let (default_x, default_y) =
        clamp_bubble_window_position(&app, default_x, default_y, win_w, win_h);
    // Keep saved positions, but normalize them against the current display
    // layout and bubble size so a stale drag can never revive half off-screen.
    let (x, y, source) = match load_bubble_position(&app) {
        Some((sx, sy)) => {
            let (cx, cy) = clamp_bubble_window_position(&app, sx, sy, win_w, win_h);
            let source = if cx == sx && cy == sy {
                "saved"
            } else {
                "saved-clamped"
            };
            (cx, cy, source)
        }
        _ => (default_x, default_y, "default"),
    };
    dlog!(
        "[clips-tray] bubble pos=({},{}) source={} size={}x{} monitor={}x{}",
        x,
        y,
        source,
        win_w,
        win_h,
        mon_w,
        mon_h
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
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(win_w, win_h)));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    let app_for_bounds = app.clone();
    let win_for_bounds = win.clone();
    win.on_window_event(move |event| {
        if matches!(
            event,
            tauri::WindowEvent::Moved(_)
                | tauri::WindowEvent::Resized(_)
                | tauri::WindowEvent::ScaleFactorChanged { .. }
        ) {
            // During a hand-drag the move command owns the position and clamps
            // every frame; re-clamping here would race that loop and bring back
            // the edge jitter, so yield until the drag ends (which runs a final
            // clamp of its own).
            if BUBBLE_DRAGGING.load(Ordering::SeqCst) {
                return;
            }
            clamp_existing_bubble_window(&app_for_bounds, &win_for_bounds);
        }
    });
    // NOTE: intentionally NOT calling `set_capture_excluded` on the bubble.
    // The bubble is the user's face — Loom's behavior is that the camera
    // PiP IS composited into the final recording (that's the whole point of
    // the bubble). NSWindowSharingNone would make macOS exclude it from
    // `getDisplayMedia`, which matches the other Clips chrome (popover,
    // toolbar, countdown) but NOT what users want for the camera bubble.
    configure_overlay_behavior(&win);
    let _ = win.show();
    dlog!("[clips-tray] bubble shown at ({},{}) size {}", x, y, win_w);
    Ok(())
}

#[tauri::command]
pub async fn set_bubble_capture_excluded(app: AppHandle, excluded: bool) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(BUBBLE_LABEL) {
        if excluded {
            set_capture_excluded_always(&window);
        } else {
            set_capture_included(&window);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_overlays(app: AppHandle) -> Result<(), String> {
    stop_countdown_control_tracking();
    let _ = app.emit("clips:countdown-shortcuts-active", false);
    for label in [
        COUNTDOWN_LABEL,
        TOOLBAR_LABEL,
        BUBBLE_LABEL,
        FINALIZING_LABEL,
        FLOW_BAR_LABEL,
        REGION_GUIDES_LABEL,
        REGION_RECORD_BORDER_LABEL,
    ] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.close();
        }
    }
    // A recording pill may be owned by meeting or voice flows; tear it down too.
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
    stop_countdown_control_tracking();
    let _ = app.emit("clips:countdown-shortcuts-active", false);
    // The countdown + toolbar always tear down on recording stop. The region
    // guides only tear down when they aren't pinned on-screen via the always-on
    // toggle — otherwise we'd flicker close→reopen right after stop.
    let g = crate::config::feature_config(&app).region_guides;
    let keep_region_guides = g.always_visible && g.enabled && !g.rects.is_empty();
    // The recording-region border belongs to a single recording (never pinned),
    // so it always tears down here alongside the countdown + toolbar.
    let mut labels: Vec<&str> = vec![COUNTDOWN_LABEL, TOOLBAR_LABEL, REGION_RECORD_BORDER_LABEL];
    if !keep_region_guides {
        labels.push(REGION_GUIDES_LABEL);
    }
    for label in labels {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.close();
        }
    }
    // If meeting or voice flows showed a recording pill, auto-hide it after
    // recording stops. Bail early if a new recording came up in the meantime.
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
    let _ = app.emit("clips:release-camera", ());
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
    if is_recording_active(&app) {
        return Ok(());
    }
    if let Some(w) = app.get_webview_window("popover") {
        let max_logical_height = w
            .current_monitor()
            .ok()
            .flatten()
            .or_else(|| w.primary_monitor().ok().flatten())
            .map(|monitor| {
                let scale = monitor.scale_factor().max(1.0);
                ((monitor.size().height as f64) / scale
                    - 24.0
                    - POPOVER_SHADOW_GUTTER_LOGICAL * 2.0)
                    .clamp(260.0, 820.0)
            })
            .unwrap_or(820.0);
        let clamped = height.clamp(200.0, max_logical_height);
        let width = width.unwrap_or(360.0).clamp(320.0, 480.0);
        let (window_width, window_height) = popover_window_size_logical(width, clamped);
        let _ = w.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            window_width,
            window_height,
        )));
        // Re-anchor to the tray icon so the window doesn't drift below the
        // bottom of the monitor after a growth.
        position_popover(&app, &w);
    }
    Ok(())
}

#[tauri::command]
pub fn open_macos_privacy_settings(pane: String) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = pane;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let url = match pane.as_str() {
            "camera" => "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera",
            "microphone" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
            }
            "screen" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
            }
            "speech" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition"
            }
            "accessibility" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
            "input-monitoring" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent"
            }
            _ => return Err(format!("Unknown macOS privacy pane: {pane}")),
        };
        Command::new("open")
            .arg(url)
            .status()
            .map_err(|e| format!("failed to open System Settings: {e}"))?;
        Ok(())
    }
}

#[tauri::command]
pub fn open_local_recording_folder(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("local recording folder path is empty".to_string());
    }

    let folder = PathBuf::from(trimmed);
    if !folder.exists() {
        return Err(format!("local recording folder does not exist: {trimmed}"));
    }
    if !folder.is_dir() {
        return Err(format!("local recording path is not a folder: {trimmed}"));
    }

    open_folder_in_file_manager(&folder)
}

#[cfg(target_os = "macos")]
fn open_folder_in_file_manager(folder: &PathBuf) -> Result<(), String> {
    let status = Command::new("open")
        .arg(folder)
        .status()
        .map_err(|e| format!("failed to open local recording folder: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("open exited with {status}"))
    }
}

#[cfg(target_os = "windows")]
fn open_folder_in_file_manager(folder: &PathBuf) -> Result<(), String> {
    let status = Command::new("explorer")
        .arg(folder)
        .status()
        .map_err(|e| format!("failed to open local recording folder: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("explorer exited with {status}"))
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_folder_in_file_manager(folder: &PathBuf) -> Result<(), String> {
    let status = Command::new("xdg-open")
        .arg(folder)
        .status()
        .map_err(|e| format!("failed to open local recording folder: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("xdg-open exited with {status}"))
    }
}

#[tauri::command]
pub fn request_macos_screen_recording_access() -> Result<bool, String> {
    #[cfg(not(target_os = "macos"))]
    {
        return Ok(true);
    }

    #[cfg(target_os = "macos")]
    {
        let granted = unsafe {
            if CGPreflightScreenCaptureAccess() {
                true
            } else {
                CGRequestScreenCaptureAccess()
            }
        };
        Ok(granted)
    }
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
    configure_overlay_behavior(&win);
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

    let (mx, my, mw, mh) = tray_monitor_physical_rect(&app);
    let scale = overlay_scale_factor(&app);
    // Compact Wispr-style pill window: just enough transparent canvas for
    // the bottom-centered waveform bar and its shadow gutter.
    let content_w: u32 = (160.0 * scale).round() as u32;
    let content_h: u32 = (56.0 * scale).round() as u32;
    let bottom_margin: i32 = (14.0 * scale).round() as i32;
    let gutter = overlay_shadow_gutter_physical(&app);
    let w: u32 = content_w + gutter * 2;
    let h: u32 = content_h + gutter * 2;
    let x: i32 = (mx + (mw as i32 - content_w as i32) / 2 - gutter as i32).max(mx);
    let y: i32 = (my + mh as i32 - h as i32 - bottom_margin).max(my);

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
    configure_overlay_behavior(&win);
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
    // P1: hide_flow_bar is the one Rust-side chokepoint every dictation
    // teardown path funnels through (explicit stop/cancel/error from JS, AND
    // the 15s stale-overlay safety net in show_flow_bar) — routing through
    // the sync wrapper here guarantees Escape's global registration can
    // never outlive a dictation session, even if JS never got to run its
    // own cleanup (crashed webview, hung getUserMedia, etc).
    crate::shortcuts::set_dictation_active_and_sync_escape(&app, false);
    // Hide (don't close) so the next show_flow_bar can reuse the window
    // and avoid the ~200ms WebKit cold-start that creates the stutter
    // on second/third Fn presses.
    if let Some(w) = app.get_webview_window(FLOW_BAR_LABEL) {
        let _ = w.hide();
    }
    hide_voice_wake_popover(&app);
    Ok(())
}

/// Bundle ids of messaging apps where Wispr-style dictation strips a lone
/// trailing period (wispr-ux.md §4) — casual chat contexts read better
/// without one, and messaging apps rarely expect sentence-final punctuation.
const MESSAGING_APP_BUNDLES: &[&str] = &[
    "com.tinyspeck.slackmacgap", // Slack
    "com.apple.MobileSMS",       // Messages
    "com.apple.iChat",           // Messages (legacy bundle id)
    "net.whatsapp.WhatsApp",
    "com.hnc.Discord",
    "ru.keepcoder.Telegram",
];

/// Strip a single trailing `.` (never `...` or `?!`) from single-line text
/// destined for a messaging app. Pure helper so it's unit-testable without
/// the macOS-only paste machinery.
fn strip_trailing_period_for_messaging(text: &str, bundle_id: Option<&str>) -> String {
    let Some(bundle_id) = bundle_id else {
        return text.to_string();
    };
    if !MESSAGING_APP_BUNDLES.contains(&bundle_id) {
        return text.to_string();
    }
    if text.contains('\n') {
        return text.to_string();
    }
    if text.ends_with('.') && !text.ends_with("..") {
        return text[..text.len() - 1].to_string();
    }
    text.to_string()
}

#[tauri::command]
pub async fn complete_voice_dictation(app: AppHandle, text: String) -> Result<(), String> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        eprintln!("[clips-tray] complete_voice_dictation: empty text — nothing to paste");
        return Ok(());
    }
    if let Some(last) = app.try_state::<LastTranscript>() {
        if let Ok(mut g) = last.0.lock() {
            *g = Some(trimmed.clone());
        }
    }
    // Refresh the tray's "Paste Last Dictation" enabled state now that a
    // transcript exists. Cheap — same pattern as toggle-region-guides.
    crate::tray::rebuild_tray_menu(&app);
    insert_text_for_frontmost(&app, &trimmed, "complete_voice_dictation")
}

/// Re-insert the most recent dictation on demand (Wispr's `Cmd+Ctrl+V` /
/// tray "Paste Last Dictation"). Read-only recall — does NOT clear
/// `LastTranscript`, so it stays repeatable. Silently no-ops if nothing has
/// been dictated yet this session (never surfaces an error toast for an
/// empty history — there's nothing actionable for the user to do).
#[tauri::command]
pub async fn paste_last_dictation(app: AppHandle) -> Result<(), String> {
    let text = match app.try_state::<LastTranscript>() {
        Some(last) => last.0.lock().ok().and_then(|g| g.clone()),
        None => None,
    };
    let Some(text) = text.filter(|t| !t.trim().is_empty()) else {
        return Ok(());
    };
    insert_text_for_frontmost(&app, text.trim(), "paste_last_dictation")
}

/// Shared insertion path for both a fresh dictation completion and the
/// paste-last-dictation recall. Recall can fire long after the original
/// dictation, so it always targets the live frontmost app. Only same-session
/// completion is allowed to reactivate the remembered voice target.
fn insert_text_for_frontmost(
    app: &AppHandle,
    trimmed: &str,
    caller: &'static str,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let frontmost_bundle_id = frontmost_bundle_identifier();
    #[cfg(target_os = "macos")]
    let voice_target_bundle_id = if caller == "paste_last_dictation" {
        None
    } else {
        remembered_voice_target_bundle(app)
    };
    #[cfg(target_os = "macos")]
    let trimmed = strip_trailing_period_for_messaging(
        trimmed,
        voice_target_bundle_id
            .as_deref()
            .or(frontmost_bundle_id.as_deref()),
    );
    #[cfg(target_os = "macos")]
    let strategy = text_insertion_strategy(frontmost_bundle_id.as_deref());
    #[cfg(target_os = "macos")]
    eprintln!(
        "[clips-tray] {caller}: inserting {} chars via {:?} (frontmost={})",
        trimmed.chars().count(),
        strategy,
        frontmost_bundle_id.as_deref().unwrap_or("unknown"),
    );
    #[cfg(not(target_os = "macos"))]
    eprintln!(
        "[clips-tray] {caller}: inserting {} chars",
        trimmed.chars().count(),
    );
    #[cfg(target_os = "macos")]
    match strategy {
        // GUI apps: paste via the clipboard so Chrome/Gmail receives one
        // ordinary paste operation instead of a long stream of synthetic
        // Unicode key events through AppKit text input. Save/restore the
        // prior clipboard around the paste (see paste_clipboard) so
        // dictation doesn't clobber whatever the user had copied.
        TextInsertionStrategy::ClipboardPaste => {
            let prior_clipboard = read_clipboard();
            write_clipboard(&trimmed)?;
            paste_clipboard(voice_target_bundle_id, trimmed.clone(), prior_clipboard);
        }
        // Terminal apps type directly via CGEventKeyboardSetUnicodeString and
        // never read the clipboard, so there's nothing to write/restore here
        // — custom terminal paste bindings can intercept Cmd+V or bypass
        // paste handling entirely, which is why this path exists.
        TextInsertionStrategy::UnicodeType => type_text_unicode(&trimmed, voice_target_bundle_id),
    }
    #[cfg(not(target_os = "macos"))]
    type_text_unicode(trimmed);
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

pub fn remember_voice_target(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let target = frontmost_bundle_identifier();
        if let Some(state) = app.try_state::<VoiceTargetBundle>() {
            if let Ok(mut g) = state.0.lock() {
                *g = target;
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }
}

#[cfg(target_os = "macos")]
fn remembered_voice_target_bundle(app: &AppHandle) -> Option<String> {
    app.try_state::<VoiceTargetBundle>()
        .and_then(|state| state.0.lock().ok().and_then(|g| g.clone()))
}

#[cfg(test)]
mod tests {
    use super::{
        strip_trailing_period_for_messaging, text_insertion_strategy, TextInsertionStrategy,
    };

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

    #[test]
    fn strips_lone_trailing_period_in_slack() {
        assert_eq!(
            strip_trailing_period_for_messaging(
                "let's grab lunch.",
                Some("com.tinyspeck.slackmacgap")
            ),
            "let's grab lunch"
        );
    }

    #[test]
    fn keeps_ellipsis_in_messaging_apps() {
        assert_eq!(
            strip_trailing_period_for_messaging("hold on...", Some("net.whatsapp.WhatsApp")),
            "hold on..."
        );
    }

    #[test]
    fn keeps_trailing_period_in_non_messaging_apps() {
        assert_eq!(
            strip_trailing_period_for_messaging("Final report.", Some("com.google.Chrome")),
            "Final report."
        );
    }

    #[test]
    fn keeps_trailing_period_for_multiline_text() {
        assert_eq!(
            strip_trailing_period_for_messaging(
                "line one\nline two.",
                Some("com.tinyspeck.slackmacgap")
            ),
            "line one\nline two."
        );
    }

    #[test]
    fn keeps_trailing_period_when_bundle_unknown() {
        assert_eq!(
            strip_trailing_period_for_messaging("Final report.", None),
            "Final report."
        );
    }

    #[cfg(target_os = "macos")]
    mod macos_only {
        use super::super::chunk_graphemes_by_utf16_units;

        #[test]
        fn never_splits_a_zwj_family_emoji_across_chunks() {
            // Family emoji: man + ZWJ + woman + ZWJ + girl + ZWJ + boy (7 scalars).
            let family = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}";
            let text = format!("{}{}{}", "a".repeat(18), family, "b".repeat(5));
            let chunks = chunk_graphemes_by_utf16_units(&text, 20);
            let rejoined = chunks.concat();
            assert_eq!(rejoined, text);
            assert!(
                chunks.iter().any(|c| c.contains(family)),
                "family emoji grapheme cluster must stay intact in a single chunk"
            );
        }

        #[test]
        fn never_splits_a_flag_regional_indicator_pair() {
            // Flag: two regional-indicator scalars for "US".
            let flag = "\u{1F1FA}\u{1F1F8}";
            let text = format!("{}{}", "a".repeat(19), flag);
            let chunks = chunk_graphemes_by_utf16_units(&text, 20);
            assert!(chunks.iter().any(|c| c.contains(flag)));
            assert_eq!(chunks.concat(), text);
        }

        #[test]
        fn chunks_plain_ascii_at_the_utf16_cap() {
            let text = "a".repeat(45);
            let chunks = chunk_graphemes_by_utf16_units(&text, 20);
            assert_eq!(chunks.len(), 3);
            assert_eq!(chunks[0].len(), 20);
            assert_eq!(chunks[1].len(), 20);
            assert_eq!(chunks[2].len(), 5);
        }
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

/// Read the current clipboard as UTF-8 text via `pbpaste`. Returns `None` on
/// any failure (non-zero exit, non-UTF8 contents, empty clipboard) — treated
/// as "nothing to restore" rather than an error, since this is a best-effort
/// save before we clobber the clipboard for paste. Text-only: images/rich
/// content on the clipboard are not preserved by the later restore.
#[cfg(target_os = "macos")]
fn read_clipboard() -> Option<String> {
    let out = Command::new("pbpaste").output().ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8(out.stdout).ok()
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

/// dictated_text: what we just wrote to the clipboard (to detect whether it's
/// safe to restore). prior_clipboard: what was on the clipboard beforehand,
/// if any and if it was text.
#[cfg(target_os = "macos")]
fn paste_clipboard(
    target_bundle_id: Option<String>,
    dictated_text: String,
    prior_clipboard: Option<String>,
) {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    thread::spawn(move || {
        reactivate_voice_target(target_bundle_id.as_deref());
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

        // Restore the user's prior clipboard shortly after the paste, but
        // only if nothing else has touched the clipboard in the meantime
        // (i.e. it still holds exactly the text we dictated). This keeps
        // "Cmd+V to repeat the last dictation" working for the first
        // ~1.2s — long enough to cover an immediate re-paste — while not
        // permanently stomping whatever the user had copied before.
        // personal-vocabulary.ts's auto-learn pass does NOT depend on this
        // window: it reads the focused field via the Accessibility API
        // (read_focused_field_text), not the clipboard, despite a stale
        // comment in that file suggesting otherwise.
        let Some(prior) = prior_clipboard else {
            return;
        };
        thread::sleep(Duration::from_millis(1200));
        if read_clipboard().as_deref() == Some(dictated_text.as_str()) {
            let _ = write_clipboard(&prior);
        }
    });
}

#[cfg(target_os = "macos")]
fn reactivate_voice_target(target_bundle_id: Option<&str>) {
    let Some(bundle_id) = target_bundle_id else {
        return;
    };
    if bundle_id.trim().is_empty() || bundle_id == "com.clips.tray" {
        return;
    }
    if frontmost_bundle_identifier().as_deref() == Some(bundle_id) {
        return;
    }
    if let Err(err) = Command::new("open").arg("-b").arg(bundle_id).status() {
        eprintln!("[clips-tray] could not reactivate voice target {bundle_id}: {err}");
    }
    // `open -b` only asks Launch Services to activate the target; it returns
    // as soon as that request is issued, not once the app is actually
    // frontmost. Poll briefly so we don't paste into whatever was frontmost
    // during the app's (possibly cold-launch) activation window. If it never
    // becomes frontmost in time, proceed anyway at current focus — matching
    // Wispr's "insert at focus" ethos, since the user may have deliberately
    // switched apps mid-dictation.
    for _ in 0..20 {
        if frontmost_bundle_identifier().as_deref() == Some(bundle_id) {
            return;
        }
        thread::sleep(Duration::from_millis(30));
    }
}

/// Group `text` into chunks of whole grapheme clusters, each capped at
/// `max_utf16_units` UTF-16 code units. A chunk boundary can only fall
/// between grapheme clusters, never inside one (see R22: a raw scalar-count
/// chunker can split flag emoji / ZWJ sequences / combining marks across
/// separate `CGEventKeyboardSetUnicodeString` calls). A single grapheme
/// cluster longer than the cap is still emitted whole as its own
/// over-sized chunk rather than split — that's rare and safer than
/// corrupting the cluster.
#[cfg(target_os = "macos")]
fn chunk_graphemes_by_utf16_units(text: &str, max_utf16_units: usize) -> Vec<String> {
    use unicode_segmentation::UnicodeSegmentation;

    let mut out: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut units = 0usize;
    for grapheme in text.graphemes(true) {
        let grapheme_units = grapheme.encode_utf16().count();
        if units > 0 && units + grapheme_units > max_utf16_units {
            out.push(std::mem::take(&mut current));
            units = 0;
        }
        current.push_str(grapheme);
        units += grapheme_units;
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

#[cfg(target_os = "macos")]
fn type_text_unicode(text: &str, target_bundle_id: Option<String>) {
    use core_graphics::event::{CGEvent, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    let owned = text.to_string();
    thread::spawn(move || {
        reactivate_voice_target(target_bundle_id.as_deref());
        let Ok(source) = CGEventSource::new(CGEventSourceStateID::HIDSystemState) else {
            eprintln!("[clips-tray] type failed: no CGEventSource");
            return;
        };
        // CGEventKeyboardSetUnicodeString has a per-event payload limit
        // (Apple docs: ~20 UTF-16 units, with longer bounded by ~75 char
        // in practice). Chunk by grapheme cluster (not raw scalar) and cap
        // each chunk by UTF-16-unit count, so a chunk boundary never falls
        // inside a multi-scalar sequence (flag emoji, ZWJ family/skin-tone
        // emoji, combining marks) — splitting those across two synthetic
        // keyboard events renders them as separate glyphs.
        let chunks = chunk_graphemes_by_utf16_units(&owned, 20);
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
    crate::tray::rebuild_tray_menu(&app);
    Ok(())
}

/// Set from JS when a live meeting recording/transcription session starts or
/// stops (see `useMeetingTranscription`). Gates the `ExitRequested` quit
/// teardown in `lib.rs`: quit stays instant when no meeting is active, and
/// only waits for a graceful stop when one is.
#[tauri::command]
pub async fn set_meeting_active(app: AppHandle, active: bool) -> Result<(), String> {
    dlog!("[clips-tray] set_meeting_active active={}", active);
    if let Some(state) = app.try_state::<MeetingActive>() {
        if let Ok(mut g) = state.0.lock() {
            *g = active;
        }
    }
    Ok(())
}

/// Guards the quit-teardown handshake in `lib.rs`'s `ExitRequested` handler:
/// 0 = not requested, 1 = requested (waiting on JS), 2 = done (safe to let
/// the process exit — including the watchdog's own forced exit, which must
/// not loop back into `prevent_exit`).
pub static QUIT_TEARDOWN_STATE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);

/// Called by the popover webview once it has finished (or given up on)
/// stopping an in-progress meeting during app quit. Marks teardown done and
/// asks Tauri to exit again — this second `app.exit(0)` is the one that
/// actually terminates the process, since the `ExitRequested` handler only
/// calls `prevent_exit()` on the FIRST pass (gated on this same atomic).
///
/// compare_exchange (not load-then-store) so this and lib.rs's 3s watchdog
/// can't both observe state==1 and both call `app.exit()` — only whichever
/// wins the CAS proceeds. If this loses the race (watchdog already fired),
/// there's nothing left to do: the process is already exiting.
#[tauri::command]
pub async fn quit_teardown_done(app: AppHandle) -> Result<(), String> {
    if QUIT_TEARDOWN_STATE
        .compare_exchange(1, 2, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        eprintln!("[clips-tray] quit_teardown_done — meeting teardown finished, exiting");
        app.exit(0);
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
    if let Some(w) = app.get_webview_window(REGION_GUIDES_LABEL) {
        let _ = w.close();
    }
    if let Some(w) = app.get_webview_window(REGION_RECORD_BORDER_LABEL) {
        let _ = w.close();
    }
    force_show_popover(&app);
    Ok(())
}

/// Load the saved bubble size and return it to the frontend. Default is
/// "small". Exposed to JS via `invoke("load_bubble_size")`.
#[tauri::command]
pub async fn load_bubble_size(app: AppHandle) -> Result<String, String> {
    Ok(load_bubble_size_name(&app))
}

/// Resize the bubble window to match the named size ("small" | "medium") and
/// persist the choice. Clamps to valid names silently — unknown values fall
/// back to small so a typo in the frontend doesn't brick persistence.
#[tauri::command]
pub async fn set_bubble_size(app: AppHandle, size: String) -> Result<(), String> {
    let name = match size.as_str() {
        "medium" => "medium",
        _ => "small",
    };
    let px = bubble_size_for_name(name);
    let gutter = overlay_shadow_gutter_physical(&app);
    let (win_w, win_h) = bubble_window_size_for(&app, px);
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
            .unwrap_or((BUBBLE_SIZE_SMALL + gutter * 2) as i32);
        let new_px = px as i32;
        let current_circle_size = current_size - (gutter * 2) as i32;
        let delta = (current_circle_size - new_px) / 2;
        let new_x = current_pos.0 + delta;
        let new_y = current_pos.1 + delta;
        let (new_x, new_y) = clamp_bubble_window_position(&app, new_x, new_y, win_w, win_h);
        let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(win_w, win_h)));
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
    let (x, y) = if let Some(win) = app.get_webview_window(BUBBLE_LABEL) {
        let size = win.outer_size().ok().unwrap_or_else(|| {
            let size_name = load_bubble_size_name(&app);
            let px = bubble_size_for_name(&size_name);
            let (width, height) = bubble_window_size_for(&app, px);
            PhysicalSize::new(width, height)
        });
        let (cx, cy) = clamp_bubble_window_position(&app, x, y, size.width, size.height);
        if cx != x || cy != y {
            let _ = win.set_position(PhysicalPosition::new(cx, cy));
        }
        (cx, cy)
    } else {
        let size_name = load_bubble_size_name(&app);
        let px = bubble_size_for_name(&size_name);
        let (width, height) = bubble_window_size_for(&app, px);
        clamp_bubble_window_position(&app, x, y, width, height)
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

/// Begin a Loom-style hand-drag of the bubble. The JS pointer handler calls
/// this on pointer-down. We snapshot the current cursor and window position as
/// the drag anchor and flip `BUBBLE_DRAGGING` so the bounds handler yields to
/// the drag loop.
///
/// We deliberately do NOT use Tauri's native `startDragging()`: the OS window
/// server owns the position during a native drag, so clamping it to the screen
/// edge means fighting the OS every frame (the jitter/snap-back the user saw).
/// Driving the move ourselves lets us clamp BEFORE moving, so the bubble stops
/// dead at the edge like a puck hitting a wall.
#[tauri::command]
pub async fn bubble_drag_start(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(BUBBLE_LABEL) else {
        return Ok(());
    };
    let (Ok(cursor), Ok(pos)) = (window.cursor_position(), window.outer_position()) else {
        return Ok(());
    };
    *bubble_drag_anchor()
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(BubbleDragAnchor {
        cursor_x: cursor.x.round() as i32,
        cursor_y: cursor.y.round() as i32,
        win_x: pos.x,
        win_y: pos.y,
    });
    BUBBLE_DRAGGING.store(true, Ordering::SeqCst);
    Ok(())
}

/// Move the bubble to follow the cursor for the active hand-drag. The JS
/// pointer handler calls this once per animation frame while dragging.
///
/// The new top-left is `win_start + (cursor_now - cursor_start)` — a 1:1
/// follow in physical px — then clamped to the target monitor BEFORE the move.
/// Because we clamp first, the window never overshoots the edge, so there is
/// nothing to snap back from: the cursor can keep travelling past the edge
/// while the bubble sits pinned against it. No-op if no drag is in progress.
#[tauri::command]
pub async fn bubble_drag_move(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(BUBBLE_LABEL) else {
        return Ok(());
    };
    let Ok(cursor) = window.cursor_position() else {
        return Ok(());
    };
    let target = {
        let guard = bubble_drag_anchor()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let Some(anchor) = guard.as_ref() else {
            return Ok(());
        };
        (
            anchor.win_x + (cursor.x.round() as i32 - anchor.cursor_x),
            anchor.win_y + (cursor.y.round() as i32 - anchor.cursor_y),
        )
    };
    let Ok(size) = window.outer_size() else {
        return Ok(());
    };
    let (x, y) = clamp_bubble_window_position(&app, target.0, target.1, size.width, size.height);
    let _ = window.set_position(PhysicalPosition::new(x, y));
    Ok(())
}

/// End the hand-drag: clear the anchor, drop the dragging flag, and run one
/// final clamp so the resting position is guaranteed in-bounds. The JS
/// `onMoved` listener persists the final spot via `save_bubble_position`.
#[tauri::command]
pub async fn bubble_drag_end(app: AppHandle) -> Result<(), String> {
    *bubble_drag_anchor()
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = None;
    BUBBLE_DRAGGING.store(false, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window(BUBBLE_LABEL) {
        clamp_existing_bubble_window(&app, &window);
    }
    Ok(())
}

#[tauri::command]
pub async fn show_popover(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("popover") {
        present_popover(&app, &window);
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

fn clear_voice_wake_state(app: &AppHandle) {
    if let Some(state) = app.try_state::<VoiceWakePopover>() {
        if let Ok(mut g) = state.0.lock() {
            *g = false;
        }
    }
}

fn is_pinhole_popover(window: &WebviewWindow) -> bool {
    window
        .outer_size()
        .map(|size| size.width <= 4 || size.height <= 4)
        .unwrap_or(false)
}

fn present_popover(app: &AppHandle, window: &WebviewWindow) {
    clear_voice_wake_state(app);
    set_capture_included(window);
    // Re-apply Space behavior — `orderOut:` resets it, so without this the
    // popover sticks to whichever Space it was first shown on.
    configure_overlay_behavior(window);
    // Restore the popover's normal size — it may have been shrunk to 2×2 during
    // recording or voice wake. The content's ResizeObserver will fine-tune the
    // height on the next render, but we need a sensible starting size so
    // `position_popover` can anchor correctly.
    let (w, h) = popover_window_size_logical(
        POPOVER_DEFAULT_WIDTH_LOGICAL,
        POPOVER_DEFAULT_HEIGHT_LOGICAL,
    );
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(w, h)));
    position_popover(app, window);
    mark_popover_shown(app);
    present_interactive_window(window);
    let _ = app.emit("clips:popover-visible", true);
}

pub fn force_show_popover(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("popover") {
        present_popover(app, &window);
    }
}

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
    let user_visible =
        window.is_visible().unwrap_or(false) && !voice_woken && !is_pinhole_popover(&window);
    if user_visible {
        let _ = window.hide();
        let _ = app.emit("clips:popover-visible", false);
        return;
    }
    present_popover(app, &window);
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
        // Drop the visible panel below the icon with a tiny gap. The native
        // window itself starts a shadow-gutter earlier so the top shadow has
        // real transparent pixels to paint into without moving the panel down.
        let gap = 6_i32;
        let mut y = icon_y + icon_h + gap;

        // Find the monitor that actually contains the tray icon. The popover
        // is parked at (2,2) on the primary display, so current_monitor()
        // always resolves to the primary monitor — wrong when the user clicked
        // the icon on a secondary display
        let icon_cx = icon_x + icon_w / 2;
        let icon_cy = icon_y + icon_h / 2;
        let tray_monitor = window.available_monitors().ok().and_then(|monitors| {
            monitors.into_iter().find(|m| {
                let mp = m.position();
                let ms = m.size();
                icon_cx >= mp.x
                    && icon_cx < mp.x + ms.width as i32
                    && icon_cy >= mp.y
                    && icon_cy < mp.y + ms.height as i32
            })
        });
        let popover_gutter = (POPOVER_SHADOW_GUTTER_LOGICAL
            * tray_monitor
                .as_ref()
                .map(|m| m.scale_factor())
                .unwrap_or_else(|| monitor.scale_factor())
                .max(1.0))
        .round() as i32;
        y -= popover_gutter;

        let (clamp_pos, clamp_size) = tray_monitor
            .map(|m| (*m.position(), *m.size()))
            .unwrap_or((*mon_pos, *mon_size));

        // Clamp so settings and long error states don't run off the edge of
        // shorter displays or get stranded in a corner after a resize.
        let min_x = clamp_pos.x + 8;
        let max_x = clamp_pos.x + clamp_size.width as i32 - win_size.width as i32 - 8;
        let min_y = clamp_pos.y + 8;
        let max_y = clamp_pos.y + clamp_size.height as i32 - win_size.height as i32 - 8;
        if x < min_x {
            x = min_x;
        }
        if x > max_x {
            x = max_x;
        }
        if y < min_y {
            y = min_y;
        }
        if y > max_y.max(min_y) {
            y = max_y.max(min_y);
        }
        let _ = window.set_position(PhysicalPosition::new(x, y));
        return;
    }

    // Fallback: top-right of the active monitor (used before the tray has
    // fired its first event).
    let scale = monitor.scale_factor();
    let margin_right = (12.0 * scale) as i32;
    let margin_top = (36.0 * scale) as i32;
    let popover_gutter = (POPOVER_SHADOW_GUTTER_LOGICAL * scale.max(1.0)).round() as i32;
    let min_x = mon_pos.x + 8;
    let max_x = mon_pos.x + mon_size.width as i32 - win_size.width as i32 - 8;
    let min_y = mon_pos.y + 8;
    let max_y = mon_pos.y + mon_size.height as i32 - win_size.height as i32 - 8;
    let x = (mon_pos.x + mon_size.width as i32 - win_size.width as i32 - margin_right)
        .clamp(min_x, max_x.max(min_x));
    let y = (mon_pos.y + margin_top - popover_gutter).clamp(min_y, max_y.max(min_y));
    let _ = window.set_position(PhysicalPosition::new(x, y));
}
