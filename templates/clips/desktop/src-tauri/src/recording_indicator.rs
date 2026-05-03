//! Floating recording indicator pill (Granola-style).
//!
//! A small floating window anchored bottom-center of the primary display by
//! default — matching Granola exactly. The user can drag it anywhere; we
//! persist the chosen position to disk so it survives restarts. Always-on-top,
//! transparent, no decorations, skip-taskbar, and capture-excluded
//! (`NSWindowSharingNone`) so it never appears in the user's own screen
//! recording — even when they record a full display.
//!
//! Two visual modes (driven entirely from the React side via the URL hash):
//!
//!   - `meeting`  — meeting-aware pill with mic + speaker waveforms.
//!   - `clip`     — solid-mic pill for plain Clips screen-recording sessions.
//!
//! The pill is the SINGLE recording indicator across the app — used for
//! Clips screen recordings, Meetings, AND Wispr-style voice dictation.
//! Anything that owns a recording lifecycle should call `recording_pill_show`
//! at the start and `recording_pill_hide` at the end.
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
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindowBuilder,
};

use crate::dlog;
use crate::util::{build_overlay_url, primary_monitor_physical_size, set_capture_excluded, show_without_activation};

const PILL_LABEL: &str = "recording-pill";

/// Detached-mode flag. Toggled from JS via `recording_pill_set_detached` —
/// the renderer flips it when the main app loses focus. We store it as a
/// process-global atomic so `anchored_rect` can pick the right anchor +
/// dimensions on subsequent expand/show without the caller having to thread
/// it through every command.
static PILL_DETACHED: AtomicBool = AtomicBool::new(false);

/// Granola-fidelity collapsed dimensions (logical px). The expanded form
/// stretches to fit the live-transcript area.
const PILL_W_LOGICAL: u32 = 280;
const PILL_W_EXPANDED_LOGICAL: u32 = 480;
const PILL_H_LOGICAL: u32 = 44;
const PILL_H_EXPANDED_LOGICAL: u32 = 340;
/// Bottom margin from the screen edge, logical px. Granola uses ~24.
const PILL_BOTTOM_MARGIN_LOGICAL: u32 = 24;

/// Detached / "floating" mode dimensions — anchored top-right of the primary
/// monitor when the user focuses another app. Smaller footprint so it
/// doesn't block content; matches the spec from `wispr-ux.md` round-3.
const PILL_DETACHED_W_LOGICAL: u32 = 180;
const PILL_DETACHED_H_LOGICAL: u32 = 40;
const PILL_DETACHED_TOP_MARGIN_LOGICAL: u32 = 24;
const PILL_DETACHED_RIGHT_MARGIN_LOGICAL: u32 = 24;

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

/// Persist the last-known pill position so the next `show` re-opens at the
/// user's chosen spot.
fn pill_position_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    if std::fs::create_dir_all(&dir).is_err() {
        return None;
    }
    Some(dir.join("pill-position.json"))
}

fn pill_detached_position_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    if std::fs::create_dir_all(&dir).is_err() {
        return None;
    }
    Some(dir.join("pill-position-detached.json"))
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
    let (mw, mh) = primary_monitor_physical_size(app).unwrap_or((2880, 1800));
    let x = ((mw as i32 - w as i32) / 2).max(0);
    let y = (mh as i32 - h as i32 - bottom_margin).max(0);
    (x, y)
}

fn pill_size_physical(app: &AppHandle, expanded: bool) -> (u32, u32) {
    let scale = scale_factor(app);
    let detached = PILL_DETACHED.load(Ordering::Relaxed);
    // Detached mode ignores the `expanded` flag — the floating pill is a
    // fixed compact size that stays out of the way; users pop it back open
    // by clicking the drag handle (which un-detaches first).
    let (w_log, h_log) = if detached {
        (PILL_DETACHED_W_LOGICAL, PILL_DETACHED_H_LOGICAL)
    } else if expanded {
        (PILL_W_EXPANDED_LOGICAL, PILL_H_EXPANDED_LOGICAL)
    } else {
        (PILL_W_LOGICAL, PILL_H_LOGICAL)
    };
    let w = (w_log as f64 * scale) as u32;
    let h = (h_log as f64 * scale) as u32;
    (w, h)
}

/// Default top-right anchor (physical px) for detached mode.
fn default_top_right(app: &AppHandle, w: u32, h: u32) -> (i32, i32) {
    let scale = scale_factor(app);
    let top_margin = (PILL_DETACHED_TOP_MARGIN_LOGICAL as f64 * scale) as i32;
    let right_margin = (PILL_DETACHED_RIGHT_MARGIN_LOGICAL as f64 * scale) as i32;
    let (mw, _mh) = primary_monitor_physical_size(app).unwrap_or((2880, 1800));
    let x = (mw as i32 - w as i32 - right_margin).max(0);
    let y = top_margin.max(0);
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
    let (w, h) = pill_size_physical(app, expanded);
    let (mw, mh) = primary_monitor_physical_size(app).unwrap_or((2880, 1800));
    let max_x = (mw as i32 - w as i32).max(0);
    let max_y = (mh as i32 - h as i32).max(0);

    // Detached mode has its own persisted position file so the user can
    // drag the floating pill anywhere on the right edge / corner without
    // disturbing the bottom-center anchored position they prefer when the
    // main app is in front.
    if PILL_DETACHED.load(Ordering::Relaxed) {
        let (x, y) = match load_detached_position(app) {
            Some((sx, sy)) => (sx.clamp(0, max_x), sy.clamp(0, max_y)),
            None => default_top_right(app, w, h),
        };
        return (w, h, x, y);
    }

    if let Some((px, py, prev_w, prev_h)) = previous_position {
        // Re-anchor on expand/collapse: keep the bottom-center of the pill
        // pinned. New top-left = (prev_center_x - new_w/2, prev_bottom - new_h).
        let prev_center_x = px + prev_w as i32 / 2;
        let prev_bottom = py + prev_h as i32;
        let x = (prev_center_x - w as i32 / 2).clamp(0, max_x);
        let y = (prev_bottom - h as i32).clamp(0, max_y);
        return (w, h, x, y);
    }

    // First show — prefer the user's last persisted position, otherwise
    // default bottom-center.
    let (x, y) = match load_pill_position(app) {
        Some((sx, sy)) => (sx.clamp(0, max_x), sy.clamp(0, max_y)),
        None => default_bottom_center(app, w, h),
    };
    (w, h, x, y)
}

#[tauri::command]
pub async fn recording_pill_show(
    app: AppHandle,
    meeting_id: Option<String>,
    mode: Option<PillMode>,
) -> Result<(), String> {
    let mode = mode.unwrap_or_default();
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
        // Already alive — re-emit context and bring it back into view.
        let prev_size = existing.outer_size().ok();
        let prev_pos = existing.outer_position().ok();
        let previous = match (prev_pos, prev_size) {
            (Some(p), Some(s)) => Some((p.x, p.y, s.width, s.height)),
            _ => None,
        };
        let (w, h, x, y) = anchored_rect(&app, false, previous);
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
        show_without_activation(&existing);
        return Ok(());
    }

    let (w, h, x, y) = anchored_rect(&app, false, None);

    let url = build_overlay_url("recording-pill");
    let win = WebviewWindowBuilder::new(&app, PILL_LABEL, url)
        .title("Recording")
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
            eprintln!("[clips-tray] recording-pill build failed: {}", e);
            e.to_string()
        })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    set_capture_excluded(&win);
    show_without_activation(&win);

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

#[tauri::command]
pub async fn recording_pill_expand(app: AppHandle, expanded: bool) -> Result<(), String> {
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
    Ok(())
}

#[tauri::command]
pub async fn recording_pill_hide(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(PILL_LABEL) {
        // Snapshot current position before close so the next show re-opens
        // at the user's chosen spot.
        if let Ok(pos) = w.outer_position() {
            save_pill_position_to_disk(&app, pos.x, pos.y);
        }
        let _ = w.close();
    }
    Ok(())
}

/// Persist the pill's current position. Called by the React side after the
/// user drag-moves it (mouseup) so the next `show` reopens at the chosen
/// spot.
#[tauri::command]
pub async fn recording_pill_save_position(
    app: AppHandle,
    x: i32,
    y: i32,
) -> Result<(), String> {
    // Persist to the right slot — detached drags shouldn't overwrite the
    // user's preferred bottom-center position and vice versa.
    if PILL_DETACHED.load(Ordering::Relaxed) {
        save_detached_position_to_disk(&app, x, y);
    } else {
        save_pill_position_to_disk(&app, x, y);
    }
    Ok(())
}

/// Toggle detached / floating mode. Called from the renderer when the
/// main app window loses or regains focus. On the way IN to detached mode
/// we resize + reposition to the saved (or default top-right) detached
/// anchor; on the way OUT we resize + reposition back to the user's saved
/// bottom-center anchor.
#[tauri::command]
pub async fn recording_pill_set_detached(
    app: AppHandle,
    detached: bool,
) -> Result<(), String> {
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
