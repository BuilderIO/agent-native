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

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindowBuilder,
};

use crate::dlog;
use crate::util::{build_overlay_url, primary_monitor_physical_size, set_capture_excluded, show_without_activation};

const PILL_LABEL: &str = "recording-pill";

/// Granola-fidelity collapsed dimensions (logical px). The expanded form
/// stretches to fit the live-transcript area.
const PILL_W_LOGICAL: u32 = 280;
const PILL_W_EXPANDED_LOGICAL: u32 = 480;
const PILL_H_LOGICAL: u32 = 44;
const PILL_H_EXPANDED_LOGICAL: u32 = 340;
/// Bottom margin from the screen edge, logical px. Granola uses ~24.
const PILL_BOTTOM_MARGIN_LOGICAL: u32 = 24;

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
    let w_log = if expanded {
        PILL_W_EXPANDED_LOGICAL
    } else {
        PILL_W_LOGICAL
    };
    let h_log = if expanded {
        PILL_H_EXPANDED_LOGICAL
    } else {
        PILL_H_LOGICAL
    };
    let w = (w_log as f64 * scale) as u32;
    let h = (h_log as f64 * scale) as u32;
    (w, h)
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
    save_pill_position_to_disk(&app, x, y);
    Ok(())
}
