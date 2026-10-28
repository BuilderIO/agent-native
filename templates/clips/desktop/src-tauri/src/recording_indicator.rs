
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
static PILL_TOPMOST_GENERATION: AtomicU64 = AtomicU64::new(0);

static PILL_DETACHED: AtomicBool = AtomicBool::new(false);
static PILL_RIGHT_SIDE: AtomicBool = AtomicBool::new(false);
static PILL_EXPANDED: AtomicBool = AtomicBool::new(false);

static PILL_HOVER_TRACKING: AtomicBool = AtomicBool::new(false);

const PILL_W_LOGICAL: u32 = 38;
const PILL_W_EXPANDED_LOGICAL: u32 = 480;
const PILL_W_EXPANDED_MEETING_LOGICAL: u32 = 480;
const PILL_H_LOGICAL: u32 = 60;
const PILL_H_EXPANDED_LOGICAL: u32 = 340;
const PILL_BOTTOM_MARGIN_LOGICAL: u32 = 42;

const PILL_DETACHED_W_LOGICAL: u32 = 180;
const PILL_DETACHED_H_LOGICAL: u32 = 40;
const PILL_DETACHED_TOP_MARGIN_LOGICAL: u32 = 24;
const PILL_DETACHED_RIGHT_MARGIN_LOGICAL: u32 = 24;
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

fn monitor_scale_factor(app: &AppHandle, rect: (i32, i32, u32, u32)) -> f64 {
    let (x, y, width, height) = rect;
    app.get_webview_window("popover")
        .and_then(|window| window.available_monitors().ok())
        .and_then(|monitors| {
            monitors.into_iter().find(|monitor| {
                let position = monitor.position();
                let size = monitor.size();
                position.x == x && position.y == y && size.width == width && size.height == height
            })
        })
        .map(|monitor| monitor.scale_factor())
        .unwrap_or_else(|| scale_factor(app))
}

fn edge_margin_physical(app: &AppHandle, logical: u32) -> i32 {
    (logical as f64 * scale_factor(app)) as i32
}

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
    let (_, h_exp) = pill_size_physical(app, true);
    let max_y_exp = (my + mh as i32 - h_exp as i32).max(my);
    let y = (my + (mh as i32 - h as i32) / 2).clamp(my, max_y_exp);
    (x, y)
}

fn pill_size_physical(app: &AppHandle, expanded: bool) -> (u32, u32) {
    let scale = scale_factor(app);
    let detached = PILL_DETACHED.load(Ordering::Relaxed);
    let (w_log, h_log) = if detached {
        (PILL_DETACHED_W_LOGICAL, PILL_DETACHED_H_LOGICAL)
    } else if expanded {
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

fn default_top_right(app: &AppHandle, w: u32, _h: u32) -> (i32, i32) {
    let top_margin = edge_margin_physical(app, PILL_DETACHED_TOP_MARGIN_LOGICAL);
    let right_margin = edge_margin_physical(app, PILL_DETACHED_RIGHT_MARGIN_LOGICAL);
    let (mx, my, mw, _mh) = tray_monitor_physical_rect(app);
    let x = (mx + mw as i32 - w as i32 - right_margin).max(mx);
    let y = (my + top_margin).max(my);
    (x, y)
}

fn anchored_rect(
    app: &AppHandle,
    expanded: bool,
    previous_position: Option<(i32, i32, u32, u32)>,
) -> (u32, u32, i32, i32) {
    let (mut w, mut h) = pill_size_physical(app, expanded);
    if expanded && !PILL_DETACHED.load(Ordering::Relaxed) {
        if let Some((sw, sh)) = load_expanded_size(app) {
            let (_, _, mw, mh) = tray_monitor_physical_rect(app);
            w = sw.min(mw);
            h = sh.min(mh);
        }
    }
    let (mx, my, mw, mh) = tray_monitor_physical_rect(app);
    let max_x = (mx + mw as i32 - w as i32).max(mx);
    let max_y = (my + mh as i32 - h as i32).max(my);

    if PILL_DETACHED.load(Ordering::Relaxed) {
        let (x, y) = match load_detached_position(app) {
            Some((sx, sy)) => (sx.clamp(mx, max_x), sy.clamp(my, max_y)),
            None => default_top_right(app, w, h),
        };
        return (w, h, x, y);
    }

    if PILL_RIGHT_SIDE.load(Ordering::Relaxed) {
        if let Some((px, py, prev_w, _prev_h)) = previous_position {
            let prev_right = px + prev_w as i32;
            let x = right_anchored_x(prev_right, w, mx, max_x);
            let y = py.clamp(my, max_y);
            return (w, h, x, y);
        }
        let (_, h_exp) = pill_size_physical(app, true);
        let max_y_exp = (my + mh as i32 - h_exp as i32).max(my);
        let (x, y) = match load_meeting_position(app) {
            Some(position) if position.anchor.as_deref() == Some("right") => (
                meeting_position_x(&position, w, mx, max_x),
                position.y.clamp(my, max_y_exp),
            ),
            Some(position) => {
                let target_scale = monitor_scale_factor(app, (mx, my, mw, mh));
                let expanded_w =
                    (PILL_W_EXPANDED_MEETING_LOGICAL as f64 * scale_factor(app)) as u32;
                let right_margin = (PILL_RIGHT_MARGIN_LOGICAL as f64 * target_scale) as i32;
                let legacy_right_edge = position.x + expanded_w as i32;
                let monitor_right = mx + mw as i32;
                let migration_tolerance = (4.0 * target_scale) as i32;
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
        let prev_center_x = px + prev_w as i32 / 2;
        let prev_bottom = py + prev_h as i32;
        let x = (prev_center_x - w as i32 / 2).clamp(mx, max_x);
        let y = (prev_bottom - h as i32).clamp(my, max_y);
        return (w, h, x, y);
    }

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
    PILL_EXPANDED.store(false, Ordering::SeqCst);
    let win = build_pill_window(&app, false)?;
    let _ = win;
    Ok(())
}

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

#[tauri::command]
pub async fn recording_pill_set_detached(app: AppHandle, detached: bool) -> Result<(), String> {
    let prev = PILL_DETACHED.swap(detached, Ordering::SeqCst);
    if prev == detached {
        return Ok(());
    }
    if let Some(window) = app.get_webview_window(PILL_LABEL) {
        PILL_EXPANDED.store(false, Ordering::SeqCst);
        let (w, h, x, y) = anchored_rect(&app, false, None);
        let _ = window.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
        let _ = window.set_position(PhysicalPosition::new(x, y));
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
