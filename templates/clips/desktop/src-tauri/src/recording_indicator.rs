//! Floating recording indicator pill (Granola-style).
//!
//! A small floating window anchored bottom-center for normal Clips recordings
//! and center-right for meeting notes. The user can drag it anywhere; we
//! persist the chosen position to disk so it survives restarts. Always-on-top,
//! transparent, no decorations, skip-taskbar, and capture-excluded
//! (`NSWindowSharingNone`) so it never appears in the user's own screen
//! recording — even when they record a full display.
//!
//! Two visual modes (driven entirely from the React side via the URL hash):
//!
//!   - `meeting`  — meeting-aware pill with a combined audio meter.
//!   - `clip`     — solid-mic pill for non-meeting recording sessions.
//!
//! The pill is used by meeting-aware recordings and Wispr-style voice
//! dictation. Plain Clips screen recordings use the left-edge toolbar as their
//! only recording indicator.
//!
//! Commands:
//!
//!   - `recording_pill_show(meeting_id?, mode)` — open at collapsed width.
//!   - `recording_pill_expand(expanded)`        — toggle to ~480 px wide so
//!     the live transcript stream fits.
//!   - `recording_pill_hide()`                  — destroy the window.
//!   - `recording_pill_save_position(x, y)`     — persist a user-dragged
//!     position so the next show reopens at the same spot.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow, WebviewWindowBuilder,
};

use crate::dlog;
use crate::util::{
    build_overlay_url, configure_overlay_behavior, raise_to_status_level, set_capture_excluded,
    show_without_activation, start_topmost_reassert_loop, tray_monitor_physical_rect,
};

const PILL_LABEL: &str = "recording-pill";
/// Supersedes stale pill topmost loops after window recreation.
static PILL_TOPMOST_GENERATION: AtomicU64 = AtomicU64::new(0);

/// Detached-mode flag. Toggled from JS via `recording_pill_set_detached` —
/// the renderer flips it when the main app loses focus. We store it as a
/// process-global atomic so `anchored_rect` can pick the right anchor +
/// dimensions on subsequent expand/show without the caller having to thread
/// it through every command.
static PILL_DETACHED: AtomicBool = AtomicBool::new(false);
static PILL_RIGHT_SIDE: AtomicBool = AtomicBool::new(false);
/// Mirrors the renderer's `expanded` React state so a re-show of an already
/// open pill (e.g. after the tray icon toggles the popover) resizes the
/// native window to match what's actually rendered instead of snapping it
/// back to the collapsed size while the webview still renders the expanded
/// layout.
static PILL_EXPANDED: AtomicBool = AtomicBool::new(false);

/// Hover-tracking loop control. macOS only feeds mouse-moved / hover events to
/// the *key* window, so the background pill's CSS `:hover` never fires while
/// another app is focused. We poll the global cursor position against the
/// pill's frame and emit `clips:pill-hover` so the renderer can drive the
/// hover styling itself. Gates the single polling task.
static PILL_HOVER_TRACKING: AtomicBool = AtomicBool::new(false);

/// Collapsed dimensions (logical px). The collapsed pill is a vertical capsule
/// — clips logo on top, waveform below — so it is taller than it is wide. The
/// expanded form stretches horizontally to fit the live-transcript area.
const PILL_W_LOGICAL: u32 = 38;
const PILL_W_EXPANDED_LOGICAL: u32 = 480;
/// Meeting mode uses the same focused transcript width as other recordings;
/// live notes are intentionally kept out of this compact overlay.
const PILL_W_EXPANDED_MEETING_LOGICAL: u32 = 480;
/// Keep this close to the rendered capsule's height. The window frame is what
/// hover is polled against, so slack here makes the pill light up while the
/// cursor is still nowhere near it.
const PILL_H_LOGICAL: u32 = 60;
const PILL_H_EXPANDED_LOGICAL: u32 = 340;
/// Bottom margin from the screen edge, logical px. 42 = the old 24px window
/// margin + the removed 18px shadow gutter, so the default capsule keeps the
/// exact on-screen spot it had before the native-shadow conversion.
const PILL_BOTTOM_MARGIN_LOGICAL: u32 = 42;

/// Detached / "floating" mode dimensions — anchored top-right of the primary
/// monitor when the user focuses another app. Smaller footprint so it
/// doesn't block content; matches the spec from `wispr-ux.md` round-3.
const PILL_DETACHED_W_LOGICAL: u32 = 180;
const PILL_DETACHED_H_LOGICAL: u32 = 40;
const PILL_DETACHED_TOP_MARGIN_LOGICAL: u32 = 24;
const PILL_DETACHED_RIGHT_MARGIN_LOGICAL: u32 = 24;
/// Gap between the visible capsule and the right screen edge, logical px.
const PILL_RIGHT_MARGIN_LOGICAL: u32 = 25;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PillMode {
    Meeting,
    #[default]
    Clip,
}

fn scale_factor(app: &AppHandle) -> f64 {
    app.get_webview_window("popover")
        .and_then(|w| w.scale_factor().ok())
        .unwrap_or(2.0)
}

/// Screen-edge margin for the visible capsule, physical px. The window is
/// sized to the capsule exactly (native shadow, no transparent gutter), so
/// the margin applies straight to the window frame.
fn edge_margin_physical(app: &AppHandle, logical: u32) -> i32 {
    (logical as f64 * scale_factor(app)) as i32
}

/// Persist the last-known pill position so the next `show` re-opens at the
/// user's chosen spot.
fn pill_position_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    if std::fs::create_dir_all(&dir).is_err() {
        return None;
    }
    Some(dir.join("pill-position.json"))
}

fn pill_meeting_position_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    if std::fs::create_dir_all(&dir).is_err() {
        return None;
    }
    Some(dir.join("pill-position-meeting.json"))
}

fn pill_expanded_size_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    if std::fs::create_dir_all(&dir).is_err() {
        return None;
    }
    Some(dir.join("pill-expanded-size.json"))
}

fn load_expanded_size(app: &AppHandle) -> Option<(u32, u32)> {
    let path = pill_expanded_size_path(app)?;
    let bytes = std::fs::read(&path).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let w = value.get("w")?.as_u64()? as u32;
    let h = value.get("h")?.as_u64()? as u32;
    Some((w, h))
}

/// Persist the user's chosen expanded-panel size (outer physical px). The
/// renderer calls this debounced from resize events while expanded.
#[tauri::command]
pub async fn recording_pill_save_expanded_size(
    app: AppHandle,
    w: u32,
    h: u32,
) -> Result<(), String> {
    let Some(path) = pill_expanded_size_path(&app) else {
        return Ok(());
    };
    let body =
        serde_json::to_vec(&serde_json::json!({ "w": w, "h": h })).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, &body).is_err() {
        return Ok(());
    }
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    Ok(())
}

fn pill_detached_position_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    if std::fs::create_dir_all(&dir).is_err() {
        return None;
    }
    Some(dir.join("pill-position-detached.json"))
}

#[derive(Deserialize)]
struct MeetingPillPosition {
    /// Meeting positions persist the right edge so width changes do not move the pill.
    x: i32,
    y: i32,
    #[serde(default)]
    anchor: Option<String>,
}

fn load_meeting_position(app: &AppHandle) -> Option<MeetingPillPosition> {
    let path = pill_meeting_position_path(app)?;
    let bytes = std::fs::read(&path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn save_meeting_position_to_disk(app: &AppHandle, x: i32, y: i32, width: u32) {
    let Some(path) = pill_meeting_position_path(app) else {
        return;
    };
    let body = match serde_json::to_vec(&serde_json::json!({
        "x": x + width as i32,
        "y": y,
        "anchor": "right",
    })) {
        Ok(b) => b,
        Err(_) => return,
    };
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, &body).is_err() {
        return;
    }
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
}

fn right_anchored_x(right_edge: i32, width: u32, min_x: i32, max_x: i32) -> i32 {
    (right_edge - width as i32).clamp(min_x, max_x)
}

fn meeting_position_x(position: &MeetingPillPosition, width: u32, min_x: i32, max_x: i32) -> i32 {
    right_anchored_x(position.x, width, min_x, max_x)
}

fn load_detached_position(app: &AppHandle) -> Option<(i32, i32)> {
    let path = pill_detached_position_path(app)?;
    let bytes = std::fs::read(&path).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let x = value.get("x")?.as_i64()? as i32;
    let y = value.get("y")?.as_i64()? as i32;
    Some((x, y))
}

fn save_detached_position_to_disk(app: &AppHandle, x: i32, y: i32) {
    let Some(path) = pill_detached_position_path(app) else {
        return;
    };
    let body = match serde_json::to_vec(&serde_json::json!({ "x": x, "y": y })) {
        Ok(b) => b,
        Err(_) => return,
    };
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, &body).is_err() {
        return;
    }
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
}

fn load_pill_position(app: &AppHandle) -> Option<(i32, i32)> {
    let path = pill_position_path(app)?;
    let bytes = std::fs::read(&path).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let x = value.get("x")?.as_i64()? as i32;
    let y = value.get("y")?.as_i64()? as i32;
    Some((x, y))
}

fn save_pill_position_to_disk(app: &AppHandle, x: i32, y: i32) {
    let Some(path) = pill_position_path(app) else {
        return;
    };
    let body = match serde_json::to_vec(&serde_json::json!({ "x": x, "y": y })) {
        Ok(b) => b,
        Err(_) => return,
    };
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, &body).is_err() {
        return;
    }
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
}

/// Default bottom-center anchor (physical px). Matches Granola: the pill
/// sits in the lower middle of the primary display, ~24 logical px above
/// the screen edge.
fn default_bottom_center(app: &AppHandle, w: u32, h: u32) -> (i32, i32) {
    let scale = scale_factor(app);
    let bottom_margin = (PILL_BOTTOM_MARGIN_LOGICAL as f64 * scale) as i32;
    let (mx, my, mw, mh) = tray_monitor_physical_rect(app);
    let x = (mx + (mw as i32 - w as i32) / 2).max(mx);
    let y = (my + mh as i32 - h as i32 - bottom_margin).max(my);
    (x, y)
}

fn default_center_right(app: &AppHandle, w: u32, h: u32) -> (i32, i32) {
    let right_margin = edge_margin_physical(app, PILL_RIGHT_MARGIN_LOGICAL);
    let (mx, my, mw, mh) = tray_monitor_physical_rect(app);
    let x = (mx + mw as i32 - w as i32 - right_margin).max(mx);
    // Center whatever is actually on screen — meetings now open collapsed, so
    // reserving the expanded height here would strand the capsule high up.
    // Expanding pins this top edge and grows downward (see `anchored_rect`),
    // clamped below so a tall panel still fits.
    let (_, h_exp) = pill_size_physical(app, true);
    let max_y_exp = (my + mh as i32 - h_exp as i32).max(my);
    let y = (my + (mh as i32 - h as i32) / 2).clamp(my, max_y_exp);
    (x, y)
}

/// Window size (physical px). The window is sized to the visible capsule
/// exactly — elevation is the native NSWindow shadow (see the builder's
/// `shadow(true)`), so there is no transparent shadow gutter to add here.
fn pill_size_physical(app: &AppHandle, expanded: bool) -> (u32, u32) {
    let scale = scale_factor(app);
    let detached = PILL_DETACHED.load(Ordering::Relaxed);
    // Detached mode ignores the `expanded` flag — the floating pill is a
    // fixed compact size that stays out of the way; users pop it back open
    // by clicking the drag handle (which un-detaches first).
    let (w_log, h_log) = if detached {
        (PILL_DETACHED_W_LOGICAL, PILL_DETACHED_H_LOGICAL)
    } else if expanded {
        // Meeting mode (right-side anchor) keeps a focused transcript-only
        // panel; plain clip recordings use the same width today.
        let w = if PILL_RIGHT_SIDE.load(Ordering::Relaxed) {
            PILL_W_EXPANDED_MEETING_LOGICAL
        } else {
            PILL_W_EXPANDED_LOGICAL
        };
        (w, PILL_H_EXPANDED_LOGICAL)
    } else {
        (PILL_W_LOGICAL, PILL_H_LOGICAL)
    };
    let w = (w_log as f64 * scale) as u32;
    let h = (h_log as f64 * scale) as u32;
    (w, h)
}

/// Default top-right anchor (physical px) for detached mode.
fn default_top_right(app: &AppHandle, w: u32, _h: u32) -> (i32, i32) {
    let top_margin = edge_margin_physical(app, PILL_DETACHED_TOP_MARGIN_LOGICAL);
    let right_margin = edge_margin_physical(app, PILL_DETACHED_RIGHT_MARGIN_LOGICAL);
    let (mx, my, mw, _mh) = tray_monitor_physical_rect(app);
    let x = (mx + mw as i32 - w as i32 - right_margin).max(mx);
    let y = (my + top_margin).max(my);
    (x, y)
}

/// Compute the pill's anchored rect. Honors a user-saved position if one
/// exists (clamped to the primary monitor so a stale saved position from a
/// disconnected external display can't strand the pill off-screen). On expand,
/// we keep the pill's bottom-center anchor relative to its previous position
/// so it grows UPWARD instead of pushing off the bottom of the screen.
fn anchored_rect(
    app: &AppHandle,
    expanded: bool,
    previous_position: Option<(i32, i32, u32, u32)>,
) -> (u32, u32, i32, i32) {
    let (mut w, mut h) = pill_size_physical(app, expanded);
    // Detached is the small floating footprint whatever `expanded` says —
    // `pill_size_physical` ignores the flag there, so applying the saved
    // expanded size would hand the floating pill a full panel-sized window.
    if expanded && !PILL_DETACHED.load(Ordering::Relaxed) {
        // The expanded panel is user-resizable; a saved size wins over the
        // default, clamped to the monitor below via max_x/max_y.
        if let Some((sw, sh)) = load_expanded_size(app) {
            let (_, _, mw, mh) = tray_monitor_physical_rect(app);
            w = sw.min(mw);
            h = sh.min(mh);
        }
    }
    let (mx, my, mw, mh) = tray_monitor_physical_rect(app);
    let max_x = (mx + mw as i32 - w as i32).max(mx);
    let max_y = (my + mh as i32 - h as i32).max(my);

    // Detached mode has its own persisted position file so the user can
    // drag the floating pill anywhere on the right edge / corner without
    // disturbing the bottom-center anchored position they prefer when the
    // main app is in front.
    if PILL_DETACHED.load(Ordering::Relaxed) {
        let (x, y) = match load_detached_position(app) {
            Some((sx, sy)) => (sx.clamp(mx, max_x), sy.clamp(my, max_y)),
            None => default_top_right(app, w, h),
        };
        return (w, h, x, y);
    }

    if PILL_RIGHT_SIDE.load(Ordering::Relaxed) {
        if let Some((px, py, prev_w, _prev_h)) = previous_position {
            // Top-right anchor: right edge and header stay fixed; pill grows
            // left and down on expand.
            let prev_right = px + prev_w as i32;
            let x = right_anchored_x(prev_right, w, mx, max_x);
            let y = py.clamp(my, max_y);
            return (w, h, x, y);
        }
        // Clamp saved Y to expanded height so first-show leaves room to grow down.
        let (_, h_exp) = pill_size_physical(app, true);
        let max_y_exp = (my + mh as i32 - h_exp as i32).max(my);
        let (x, y) = match load_meeting_position(app) {
            Some(position) if position.anchor.as_deref() == Some("right") => (
                meeting_position_x(&position, w, mx, max_x),
                position.y.clamp(my, max_y_exp),
            ),
            Some(position) => {
                let (expanded_w, _) = pill_size_physical(app, true);
                let right_margin = (PILL_RIGHT_MARGIN_LOGICAL as f64 * scale_factor(app)) as i32;
                let legacy_right_edge = position.x + expanded_w as i32;
                let monitor_right = mx + mw as i32;
                // Legacy coordinates are physical pixels, so scale the logical tolerance too.
                let migration_tolerance = edge_margin_physical(app, 4);
                if (legacy_right_edge - (monitor_right - right_margin)).abs() <= migration_tolerance
                {
                    save_meeting_position_to_disk(app, position.x, position.y, expanded_w);
                    (
                        right_anchored_x(legacy_right_edge, w, mx, max_x),
                        position.y.clamp(my, max_y_exp),
                    )
                } else {
                    (position.x.clamp(mx, max_x), position.y.clamp(my, max_y_exp))
                }
            }
            None => default_center_right(app, w, h),
        };
        return (w, h, x, y);
    }

    if let Some((px, py, prev_w, prev_h)) = previous_position {
        // Re-anchor on expand/collapse: keep the bottom-center of the pill
        // pinned. New top-left = (prev_center_x - new_w/2, prev_bottom - new_h).
        let prev_center_x = px + prev_w as i32 / 2;
        let prev_bottom = py + prev_h as i32;
        let x = (prev_center_x - w as i32 / 2).clamp(mx, max_x);
        let y = (prev_bottom - h as i32).clamp(my, max_y);
        return (w, h, x, y);
    }

    // First show — prefer the user's last persisted position, otherwise
    // default bottom-center.
    let (x, y) = match load_pill_position(app) {
        Some((sx, sy)) => (sx.clamp(mx, max_x), sy.clamp(my, max_y)),
        None => default_bottom_center(app, w, h),
    };
    (w, h, x, y)
}

#[tauri::command]
pub async fn recording_pill_prewarm(app: AppHandle) -> Result<(), String> {
    if app.get_webview_window(PILL_LABEL).is_some() {
        return Ok(());
    }
    // Built hidden and left that way: `recording_pill_show` takes the
    // already-alive branch afterwards, which re-anchors before showing, so a
    // prewarmed window never appears in the wrong place — or at all, if the
    // user dismisses the meeting instead of taking notes.
    // The webview mounts a fresh React tree, which renders collapsed. Anything
    // a previous session left in the flag would describe a pill that no longer
    // exists, and `recording_pill_show` trusts it on the already-alive branch.
    PILL_EXPANDED.store(false, Ordering::SeqCst);
    let win = build_pill_window(&app, false)?;
    let _ = win;
    Ok(())
}

/// Create the pill webview, positioned but not shown. Shared by the prewarm
/// path and the first `recording_pill_show` of a session.
fn build_pill_window(app: &AppHandle, expanded: bool) -> Result<WebviewWindow, String> {
    let (w, h, x, y) = anchored_rect(app, expanded, None);
    let url = build_overlay_url("recording-pill");
    let win = WebviewWindowBuilder::new(app, PILL_LABEL, url)
        .title("Recording")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        // Native elevation: on a transparent window macOS computes the
        // shadow from the drawn content's alpha, so the capsule gets a
        // correctly rounded OS shadow with the window sized to the capsule
        // exactly — no transparent CSS-shadow apron eating clicks.
        .shadow(true)
        .visible(false)
        .focused(false)
        .accept_first_mouse(true)
        .build()
        .map_err(|e| {
            eprintln!("[clips-tray] recording-pill build failed: {}", e);
            e.to_string()
        })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    set_capture_excluded(&win);
    Ok(win)
}

#[tauri::command]
pub async fn recording_pill_show(
    app: AppHandle,
    meeting_id: Option<String>,
    mode: Option<PillMode>,
) -> Result<(), String> {
    let mode = mode.unwrap_or_default();
    PILL_DETACHED.store(false, Ordering::SeqCst);
    PILL_RIGHT_SIDE.store(matches!(mode, PillMode::Meeting), Ordering::SeqCst);
    let mode_str = match mode {
        PillMode::Meeting => "meeting",
        PillMode::Clip => "clip",
    };
    dlog!(
        "[clips-tray] recording_pill_show mode={} meeting_id={:?}",
        mode_str,
        meeting_id
    );

    if let Some(existing) = app.get_webview_window(PILL_LABEL) {
        // Already alive — re-emit context and bring it back into view. Re-anchor
        // from the saved/default position for this mode, never from where the
        // window happens to sit: the pill window is reused across sessions, so
        // carrying the previous rect over pins a meeting pill to the last clip
        // recording's bottom-center spot. `previous` exists for expand/collapse,
        // where the anchor must not move.
        let expanded = PILL_EXPANDED.load(Ordering::Relaxed);
        let (w, h, x, y) = anchored_rect(&app, expanded, None);
        let _ = existing.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
        let _ = existing.set_position(PhysicalPosition::new(x, y));
        use tauri::Emitter;
        let _ = app.emit(
            "clips:pill-context",
            serde_json::json!({
                "meetingId": meeting_id,
                "mode": mode_str,
            }),
        );
        configure_overlay_behavior(&existing);
        show_without_activation(&existing);
        raise_to_status_level(&existing);
        start_pill_hover_tracking(&app);
        start_topmost_reassert_loop(&app, PILL_LABEL, &PILL_TOPMOST_GENERATION);
        return Ok(());
    }

    PILL_EXPANDED.store(false, Ordering::SeqCst);
    let win = build_pill_window(&app, false)?;
    configure_overlay_behavior(&win);
    show_without_activation(&win);
    raise_to_status_level(&win);
    start_pill_hover_tracking(&app);
    start_topmost_reassert_loop(&app, PILL_LABEL, &PILL_TOPMOST_GENERATION);

    // Tell the freshly-mounted React side which mode + meeting_id to render.
    use tauri::Emitter;
    let _ = app.emit(
        "clips:pill-context",
        serde_json::json!({
            "meetingId": meeting_id,
            "mode": mode_str,
        }),
    );

    Ok(())
}

/// True when the global cursor sits inside the pill window's frame. Cursor and
/// frame both come from Tauri (physical px, desktop top-left origin), so the
/// test is a plain point-in-rect with no AppKit hop. The window is sized to
/// the capsule exactly, so the frame IS the capsule the user actually sees.
fn cursor_inside_pill_frame(window: &WebviewWindow) -> bool {
    let (Ok(c), Ok(p), Ok(s)) = (
        window.cursor_position(),
        window.outer_position(),
        window.outer_size(),
    ) else {
        return false;
    };
    let right = p.x + s.width as i32;
    let bottom = p.y + s.height as i32;
    c.x >= p.x as f64 && c.x <= right as f64 && c.y >= p.y as f64 && c.y <= bottom as f64
}

/// Start polling the cursor against the pill frame and emitting
/// `clips:pill-hover` on transitions. Idempotent — a second call is a no-op
/// while a loop is already running.
fn start_pill_hover_tracking(app: &AppHandle) {
    if PILL_HOVER_TRACKING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri::Emitter;
        let mut prev = false;
        while PILL_HOVER_TRACKING.load(Ordering::Relaxed) {
            let Some(win) = app.get_webview_window(PILL_LABEL) else {
                break;
            };
            let inside = cursor_inside_pill_frame(&win);
            if inside != prev {
                prev = inside;
                let _ = win.emit("clips:pill-hover", serde_json::json!({ "hovered": inside }));
            }
            tokio::time::sleep(Duration::from_millis(80)).await;
        }
        PILL_HOVER_TRACKING.store(false, Ordering::SeqCst);
    });
}

fn stop_pill_hover_tracking() {
    PILL_HOVER_TRACKING.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub async fn recording_pill_expand(app: AppHandle, expanded: bool) -> Result<(), String> {
    PILL_EXPANDED.store(expanded, Ordering::SeqCst);
    let Some(window) = app.get_webview_window(PILL_LABEL) else {
        return Ok(());
    };
    let prev_size = window.outer_size().ok();
    let prev_pos = window.outer_position().ok();
    let previous = match (prev_pos, prev_size) {
        (Some(p), Some(s)) => Some((p.x, p.y, s.width, s.height)),
        _ => None,
    };
    let (w, h, x, y) = anchored_rect(&app, expanded, previous);
    let _ = window.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
    let _ = window.set_position(PhysicalPosition::new(x, y));
    // The expanded panel is a reading/chat surface the user may size to
    // taste; the collapsed capsule stays fixed. Frameless windows get native
    // edge grips from resizable alone.
    let _ = window.set_resizable(expanded);
    if expanded {
        let scale = window.scale_factor().unwrap_or(2.0);
        let _ = window.set_min_size(Some(tauri::Size::Physical(PhysicalSize::new(
            (360.0 * scale) as u32,
            (260.0 * scale) as u32,
        ))));
    } else {
        let _ = window.set_min_size(None::<tauri::Size>);
    }
    Ok(())
}

#[tauri::command]
pub async fn recording_pill_hide(app: AppHandle) -> Result<(), String> {
    stop_pill_hover_tracking();
    if let Some(w) = app.get_webview_window(PILL_LABEL) {
        let _ = w.close();
    }
    // The window is gone, so the flag describes nothing. It has to be cleared
    // here rather than on the next show: a prewarmed window is built outside
    // `recording_pill_show`, so the next show takes the already-alive branch
    // and would size a freshly-mounted (collapsed) pill from a stale expanded
    // flag — leaving a transparent 480x340 frame swallowing clicks around a
    // capsule drawn at its top.
    PILL_EXPANDED.store(false, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn recording_pill_save_position(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(PILL_LABEL) else {
        return Ok(());
    };
    let Ok(position) = window.outer_position() else {
        return Ok(());
    };

    if PILL_DETACHED.load(Ordering::Relaxed) {
        save_detached_position_to_disk(&app, position.x, position.y);
    } else if PILL_RIGHT_SIDE.load(Ordering::Relaxed) {
        if let Ok(size) = window.outer_size() {
            save_meeting_position_to_disk(&app, position.x, position.y, size.width);
        }
    } else {
        save_pill_position_to_disk(&app, position.x, position.y);
    }
    Ok(())
}

/// Toggle detached / floating mode. Called from the renderer when the
/// main app window loses or regains focus. On the way IN to detached mode
/// we resize + reposition to the saved (or default top-right) detached
/// anchor; on the way OUT we resize + reposition back to the user's saved
/// bottom-center anchor.
#[tauri::command]
pub async fn recording_pill_set_detached(app: AppHandle, detached: bool) -> Result<(), String> {
    let prev = PILL_DETACHED.swap(detached, Ordering::SeqCst);
    if prev == detached {
        return Ok(());
    }
    if let Some(window) = app.get_webview_window(PILL_LABEL) {
        // Snapshot the OLD anchor before flipping the mode flag matters
        // here, but `pill_size_physical` reads the atomic each call — so
        // by the time we hit `anchored_rect` below, the new flag has
        // already taken effect and we get the right size + position for
        // the destination mode. (The atomic was flipped above.)
        PILL_EXPANDED.store(false, Ordering::SeqCst);
        let (w, h, x, y) = anchored_rect(&app, false, None);
        let _ = window.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
        let _ = window.set_position(PhysicalPosition::new(x, y));
        // Tell the React side which mode it's in so it can show / hide the
        // drag handle and reflow its layout.
        use tauri::Emitter;
        let _ = app.emit(
            "clips:pill-detached",
            serde_json::json!({ "detached": detached }),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{meeting_position_x, MeetingPillPosition};

    #[test]
    fn meeting_restore_uses_current_width_after_expansion() {
        let position: MeetingPillPosition =
            serde_json::from_str(r#"{"x":1870,"y":100,"anchor":"right","width":960}"#).unwrap();

        assert_eq!(meeting_position_x(&position, 76, 0, 1844), 1794);
    }
}
