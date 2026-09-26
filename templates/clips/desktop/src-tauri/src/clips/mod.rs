#[cfg(target_os = "macos")]
use objc2_foundation::{NSPoint, NSRect, NSSize};
use serde::{Deserialize, Serialize};
#[cfg(target_os = "macos")]
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
#[cfg(target_os = "macos")]
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Listener, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};

use crate::dlog;
use crate::state::{
    ActiveMeetingId, DictationActive, LastTranscript, MeetingActive, PopoverParked,
    RecordingActive, TrayAnchor, VoiceTargetBundle, VoiceTargetTextField, VoiceWakePopover,
};
use crate::util::{
    build_overlay_url, configure_overlay_behavior, hide_voice_wake_popover, is_recording_active,
    mark_popover_shown, present_interactive_window, raise_to_status_level, set_capture_excluded,
    set_capture_excluded_always, set_capture_included, set_window_opacity, show_without_activation,
    start_topmost_reassert_loop, tray_monitor_physical_rect,
};

const COUNTDOWN_LABEL: &str = "countdown";
const TOOLBAR_LABEL: &str = "toolbar";
static TOOLBAR_TOPMOST_GENERATION: AtomicU64 = AtomicU64::new(0);
const COUNTDOWN_CONTROL_OFFSET_X: f64 = 200.0;
const COUNTDOWN_CONTROL_DIAMETER: f64 = 64.0;
const COUNTDOWN_CONTROL_HIT_PAD: f64 = 8.0;
static COUNTDOWN_CONTROL_TRACKING: AtomicBool = AtomicBool::new(false);
static TOOLBAR_FINISHING: AtomicBool = AtomicBool::new(false);
const BUBBLE_LABEL: &str = "bubble";
const BUBBLE_DESTROYED_EVENT: &str = "clips:bubble-destroyed";
const PREPARING_LABEL: &str = "preparing";
const FINALIZING_LABEL: &str = "finalizing";
const FLOW_BAR_LABEL: &str = "flow-bar";
const REGION_GUIDES_LABEL: &str = "region-guides";
const REGION_GUIDE_EDITOR_LABEL: &str = "region-guide-editor";
const REGION_RECORD_BORDER_LABEL: &str = "region-record-border";
const MONITOR_PICKER_LABEL_PREFIX: &str = "monitor-picker-";
const OVERLAY_LABELS: &[&str] = &[
    COUNTDOWN_LABEL,
    TOOLBAR_LABEL,
    BUBBLE_LABEL,
    PREPARING_LABEL,
    FINALIZING_LABEL,
    FLOW_BAR_LABEL,
    REGION_GUIDES_LABEL,
    REGION_RECORD_BORDER_LABEL,
];

const BUBBLE_SIZE_SMALL: u32 = 360;
const BUBBLE_SIZE_MEDIUM: u32 = 504;
const POPOVER_DEFAULT_WIDTH_LOGICAL: f64 = 320.0;
const POPOVER_DEFAULT_HEIGHT_LOGICAL: f64 = 520.0;
const POPOVER_MIN_HEIGHT_LOGICAL: f64 = 260.0;
const POPOVER_SCREEN_MARGIN_LOGICAL: f64 = 16.0;
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

fn bubble_size_for_name(name: &str) -> u32 {
    match name {
        "medium" => BUBBLE_SIZE_MEDIUM,
        _ => BUBBLE_SIZE_SMALL,
    }
}

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

static BUBBLE_DRAGGING: AtomicBool = AtomicBool::new(false);

pub fn is_bubble_dragging() -> bool {
    BUBBLE_DRAGGING.load(Ordering::SeqCst)
}

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

fn load_bubble_position(app: &AppHandle) -> Option<(i32, i32)> {
    let path = bubble_position_path(app)?;
    let bytes = std::fs::read(&path).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let x = value.get("x")?.as_i64()? as i32;
    let y = value.get("y")?.as_i64()? as i32;
    Some((x, y))
}


#[tauri::command]
pub async fn show_countdown(app: AppHandle) -> Result<u64, String> {
    dlog!("[clips-tray] show_countdown invoked");
    mark_popover_shown(&app);
    if let Some(existing) = app.get_webview_window(COUNTDOWN_LABEL) {
        stop_countdown_control_tracking();
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
        .focused(true)
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
    let generation = match crate::shortcuts::prepare_countdown_shortcuts(app.clone()).await {
        Ok(generation) => generation,
        Err(error) => {
            let _ = win.close();
            return Err(error);
        }
    };
    present_interactive_window(&win);
    start_countdown_control_tracking(&app);
    dlog!("[clips-tray] countdown shown");
    Ok(generation)
}

#[tauri::command]
pub async fn finish_countdown_shortcuts(app: AppHandle, generation: u64) -> Result<(), String> {
    crate::shortcuts::finish_countdown_shortcuts(app, generation).await
}

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

#[tauri::command]
pub async fn show_preparing(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(PREPARING_LABEL) {
        let _ = existing.close();
    }
    let (mx, my, mw, mh) = tray_monitor_physical_rect(&app);
    let win = WebviewWindowBuilder::new(&app, PREPARING_LABEL, build_overlay_url("preparing"))
        .title("Preparing recording")
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .shadow(false)
        .visible(false)
        .focused(true)
        .build()
        .map_err(|error| format!("preparing window build failed: {error}"))?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(mw, mh)));
    let _ = win.set_position(PhysicalPosition::new(mx, my));
    let _ = win.set_ignore_cursor_events(true);
    set_capture_excluded(&win);
    configure_overlay_behavior(&win);
    present_interactive_window(&win);
    let _ = app.emit("clips:toolbar-preparing", true);
    // A newly-created webview needs one paint before the async preparation can
    // race ahead and replace it with the countdown. Without this brief yield,
    // fast machines can show only a disabled toolbar and never render the
    // promised textual readiness state.
    tokio::time::sleep(Duration::from_millis(120)).await;
    dlog!("[clips-tray] preparing recording shown");
    Ok(())
}

#[tauri::command]
pub async fn hide_preparing(app: AppHandle) -> Result<(), String> {
    let _ = app.emit("clips:toolbar-preparing", false);
    if let Some(window) = app.get_webview_window(PREPARING_LABEL) {
        let _ = window.close();
    }
    Ok(())
}

#[tauri::command]
pub async fn show_finalizing(app: AppHandle) -> Result<(), String> {
    dlog!("[clips-tray] show_finalizing invoked");
    if let Some(existing) = app.get_webview_window(FINALIZING_LABEL) {
        let _ = existing.close();
    }
    let (mx, my, _mw, mh) = tray_monitor_physical_rect(&app);
    let scale = overlay_scale_factor(&app);
    let content_w: u32 = (336.0 * scale).round() as u32;
    let content_h: u32 = (86.0 * scale).round() as u32;
    let margin: i32 = (14.0 * scale).round() as i32;
    let gutter = overlay_shadow_gutter_physical(&app);
    let w = content_w + gutter * 2;
    let h = content_h + gutter * 2;
    let x = (mx + margin - gutter as i32).max(mx);
    let y = (my + mh as i32 - h as i32 - margin).max(my);
    dlog!("[clips-tray] finalizing target size {}x{} physical", w, h);
    #[allow(unused_mut)]
    let mut builder =
        WebviewWindowBuilder::new(&app, FINALIZING_LABEL, build_overlay_url("finalizing"))
            .title("Finalizing")
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
        eprintln!("[clips-tray] finalizing build failed: {}", e);
        e.to_string()
    })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    let _ = win.set_ignore_cursor_events(false);
    set_capture_excluded(&win);
    configure_overlay_behavior(&win);
    crate::util::show_without_activation(&win);
    dlog!("[clips-tray] finalizing shown");
    Ok(())
}

#[tauri::command]
pub async fn hide_finalizing(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(FINALIZING_LABEL) {
        let _ = w.close();
    }
    Ok(())
}

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

fn close_monitor_picker_windows(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with(MONITOR_PICKER_LABEL_PREFIX) {
            let _ = window.hide();
            let _ = window.close();
        }
    }
}

#[cfg(target_os = "macos")]
fn display_id_for_monitor_rect(x: i32, y: i32, width: u32, height: u32, scale: f64) -> Option<u32> {
    let cx_phys = x as f64 + width as f64 / 2.0;
    let cy_phys = y as f64 + height as f64 / 2.0;
    crate::native_screen::cg_display_id_at_physical_point(cx_phys, cy_phys, scale)
}

#[tauri::command]
pub async fn show_monitor_picker(app: AppHandle) -> Result<bool, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(false)
    }
    #[cfg(target_os = "macos")]
    {
        close_monitor_picker_windows(&app);
        crate::state::SelectedRecordingDisplay::set(&app, None);
        crate::state::SelectedRecordingWindow::set(&app, None);
        let monitors = app
            .get_webview_window("popover")
            .and_then(|w| w.available_monitors().ok())
            .unwrap_or_default();
        if monitors.len() <= 1 {
            return Ok(false);
        }
        let total = monitors.len();
        let mut last_window: Option<WebviewWindow> = None;
        for (index, monitor) in monitors.iter().enumerate() {
            let pos = monitor.position();
            let size = monitor.size();
            let scale = monitor.scale_factor().max(1.0);
            let Some(display_id) =
                display_id_for_monitor_rect(pos.x, pos.y, size.width, size.height, scale)
            else {
                eprintln!(
                    "[clips-tray] monitor picker: could not resolve a display id for monitor {index}"
                );
                close_monitor_picker_windows(&app);
                return Err("Could not identify one of the connected displays.".to_string());
            };
            let gutter = overlay_shadow_gutter_physical(&app);
            let content_w: u32 = (240.0 * scale).round() as u32;
            let content_h: u32 = (150.0 * scale).round() as u32;
            let w = content_w + gutter * 2;
            let h = content_h + gutter * 2;
            let x = pos.x + (size.width as i32 - w as i32) / 2;
            let y = pos.y + (size.height as i32 - h as i32) / 2;
            let label = format!("{MONITOR_PICKER_LABEL_PREFIX}{index}");
            let url = WebviewUrl::App(
                format!(
                    "index.html?index={}&total={}&displayId={}#monitor-picker",
                    index + 1,
                    total,
                    display_id
                )
                .into(),
            );
            let win = match WebviewWindowBuilder::new(&app, &label, url)
                .title("Choose a screen to record")
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .shadow(false)
                .visible(false)
                .focused(false)
                .accept_first_mouse(true)
                .build()
            {
                Ok(win) => win,
                Err(e) => {
                    eprintln!("[clips-tray] monitor picker build failed: {}", e);
                    close_monitor_picker_windows(&app);
                    return Err(e.to_string());
                }
            };
            let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
            let _ = win.set_position(PhysicalPosition::new(x, y));
            let _ = win.set_ignore_cursor_events(false);
            set_capture_excluded_always(&win);
            configure_overlay_behavior(&win);
            show_without_activation(&win);
            last_window = Some(win);
        }
        if let Some(win) = last_window {
            present_interactive_window(&win);
        }
        Ok(true)
    }
}

#[tauri::command]
pub async fn close_monitor_picker(app: AppHandle) -> Result<(), String> {
    close_monitor_picker_windows(&app);
    Ok(())
}

#[tauri::command]
pub async fn set_recording_display_override(
    app: AppHandle,
    display_id: Option<u32>,
) -> Result<(), String> {
    crate::state::SelectedRecordingDisplay::set(&app, display_id);
    crate::state::SelectedRecordingWindow::set(&app, None);
    Ok(())
}

fn toolbar_position_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    if std::fs::create_dir_all(&dir).is_err() {
        return None;
    }
    Some(dir.join("toolbar-pill-position.json"))
}

#[derive(Debug, Deserialize)]
struct ToolbarPositionPreference {
    x: i32,
    y: i32,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    location: Option<String>,
}

#[derive(Clone, Copy)]
struct ToolbarDragAnchor {
    cursor_x: i32,
    cursor_y: i32,
    win_x: i32,
    win_y: i32,
}

fn toolbar_drag_anchor() -> &'static Mutex<Option<ToolbarDragAnchor>> {
    static ANCHOR: OnceLock<Mutex<Option<ToolbarDragAnchor>>> = OnceLock::new();
    ANCHOR.get_or_init(|| Mutex::new(None))
}

#[derive(Clone, Debug, Serialize)]
pub struct ToolbarDockPreference {
    pub mode: String,
    pub location: Option<String>,
}

fn normalized_toolbar_dock_preference(
    saved: Option<&ToolbarPositionPreference>,
) -> ToolbarDockPreference {
    let location = saved
        .and_then(|value| value.location.as_deref())
        .filter(|value| matches!(*value, "left" | "right" | "top" | "bottom"))
        .map(str::to_string);
    let mode = if saved
        .and_then(|value| value.mode.as_deref())
        .is_some_and(|value| value == "docked")
        && location.is_some()
    {
        "docked"
    } else {
        "floating"
    }
    .to_string();
    ToolbarDockPreference { mode, location }
}

fn load_toolbar_position(app: &AppHandle) -> Option<ToolbarPositionPreference> {
    let path = toolbar_position_path(app)?;
    let bytes = std::fs::read(&path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn save_toolbar_position_file(
    app: &AppHandle,
    x: i32,
    y: i32,
    mode: &str,
    location: Option<&str>,
) -> Result<(), String> {
    let Some(path) = toolbar_position_path(app) else {
        return Ok(());
    };
    let body = serde_json::to_vec(&serde_json::json!({
        "x": x,
        "y": y,
        "mode": mode,
        "location": location,
    }))
    .map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    if std::fs::write(&tmp, &body).is_err() {
        return Ok(());
    }
    if std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    Ok(())
}

#[tauri::command]
pub async fn toolbar_save_position(
    app: AppHandle,
    x: i32,
    y: i32,
    mode: Option<String>,
    location: Option<String>,
) -> Result<(), String> {
    save_toolbar_position_file(
        &app,
        x,
        y,
        &mode.unwrap_or_else(|| "floating".to_string()),
        location.as_deref(),
    )
}

#[tauri::command]
pub async fn toolbar_get_dock_preference(app: AppHandle) -> Result<ToolbarDockPreference, String> {
    Ok(normalized_toolbar_dock_preference(
        load_toolbar_position(&app).as_ref(),
    ))
}

#[cfg(target_os = "macos")]
fn appkit_frame_for_physical_bounds(
    current_frame: NSRect,
    current_x: i32,
    current_y: i32,
    target_x: i32,
    target_y: i32,
    target_width: u32,
    target_height: u32,
    scale: f64,
) -> NSRect {
    let scale = scale.max(1.0);
    let width = target_width as f64 / scale;
    let height = target_height as f64 / scale;
    let delta_x = (target_x - current_x) as f64 / scale;
    let delta_y = (target_y - current_y) as f64 / scale;
    NSRect::new(
        NSPoint::new(
            current_frame.origin.x + delta_x,
            current_frame.origin.y + current_frame.size.height - height - delta_y,
        ),
        NSSize::new(width, height),
    )
}

#[tauri::command]
pub async fn toolbar_set_bounds(
    app: AppHandle,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(TOOLBAR_LABEL) else {
        return Ok(());
    };

    #[cfg(target_os = "macos")]
    {
        let current_position = window.outer_position().map_err(|err| err.to_string())?;
        let scale = window.scale_factor().map_err(|err| err.to_string())?;
        let win = window.clone();
        let (tx, rx) = tokio::sync::oneshot::channel();
        win.clone()
            .run_on_main_thread(move || {
                let result = (|| -> Result<(), String> {
                    let ns_window_ptr = win.ns_window().map_err(|err| err.to_string())?;
                    if ns_window_ptr.is_null() {
                        return Err("toolbar NSWindow is unavailable".to_string());
                    }
                    // SAFETY: Tauri owns this live NSWindow and the closure is
                    // executing on AppKit's main thread. `setFrame:display:`
                    // updates origin and size in one transaction.
                    unsafe {
                        let obj = ns_window_ptr as *mut objc2::runtime::AnyObject;
                        let current_frame: NSRect = objc2::msg_send![&*obj, frame];
                        let target_frame = appkit_frame_for_physical_bounds(
                            current_frame,
                            current_position.x,
                            current_position.y,
                            x,
                            y,
                            width,
                            height,
                            scale,
                        );
                        let _: () = objc2::msg_send![&*obj, setFrame: target_frame, display: true];
                    }
                    Ok(())
                })();
                let _ = tx.send(result);
            })
            .map_err(|err| err.to_string())?;
        return rx
            .await
            .map_err(|_| "toolbar frame update was cancelled".to_string())?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        window
            .set_size(tauri::Size::Physical(PhysicalSize::new(width, height)))
            .map_err(|err| err.to_string())?;
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|err| err.to_string())?;
        Ok(())
    }
}

fn toolbar_monitor_for_cursor(
    window: &WebviewWindow,
    cursor_x: i32,
    cursor_y: i32,
) -> Option<(i32, i32, u32, u32)> {
    let monitors = window.available_monitors().ok()?;
    monitors
        .iter()
        .find(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            cursor_x >= position.x
                && cursor_x < position.x + size.width as i32
                && cursor_y >= position.y
                && cursor_y < position.y + size.height as i32
        })
        .or_else(|| monitors.first())
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            (position.x, position.y, size.width, size.height)
        })
}

#[tauri::command]
pub async fn toolbar_drag_start(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(TOOLBAR_LABEL) else {
        return Ok(());
    };
    let (Ok(cursor), Ok(position)) = (window.cursor_position(), window.outer_position()) else {
        return Ok(());
    };
    *toolbar_drag_anchor()
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(ToolbarDragAnchor {
        cursor_x: cursor.x.round() as i32,
        cursor_y: cursor.y.round() as i32,
        win_x: position.x,
        win_y: position.y,
    });
    Ok(())
}

#[tauri::command]
pub async fn toolbar_drag_move(app: AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(TOOLBAR_LABEL) else {
        return Ok(());
    };
    let Ok(cursor) = window.cursor_position() else {
        return Ok(());
    };
    let anchor = *toolbar_drag_anchor()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let Some(anchor) = anchor else {
        return Ok(());
    };
    let Ok(size) = window.outer_size() else {
        return Ok(());
    };
    let cursor_x = cursor.x.round() as i32;
    let cursor_y = cursor.y.round() as i32;
    let target_x = anchor.win_x + cursor_x - anchor.cursor_x;
    let target_y = anchor.win_y + cursor_y - anchor.cursor_y;
    let Some((monitor_x, monitor_y, monitor_width, monitor_height)) =
        toolbar_monitor_for_cursor(&window, cursor_x, cursor_y)
    else {
        return Ok(());
    };
    let gutter = (16.0 * window.scale_factor().unwrap_or(2.0)).round() as i32;
    let min_x = monitor_x + gutter;
    let min_y = monitor_y + gutter;
    let max_x = (monitor_x + monitor_width as i32 - size.width as i32 - gutter).max(min_x);
    let max_y = (monitor_y + monitor_height as i32 - size.height as i32 - gutter).max(min_y);
    let x = target_x.clamp(min_x, max_x);
    let y = target_y.clamp(min_y, max_y);
    let _ = window.set_position(PhysicalPosition::new(x, y));
    Ok(())
}

#[tauri::command]
pub async fn toolbar_drag_end() -> Result<(), String> {
    *toolbar_drag_anchor()
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = None;
    Ok(())
}

/// Hold or release the stop-flow toolbar preservation described on
/// `TOOLBAR_FINISHING`. The pill sets the hold synchronously before emitting
/// `clips:recorder-stop` so the recorder's teardown cannot race it.
#[tauri::command]
pub async fn set_toolbar_finishing(hold: bool) -> Result<(), String> {
    TOOLBAR_FINISHING.store(hold, Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
pub async fn show_toolbar(app: AppHandle) -> Result<(), String> {
    dlog!("[clips-tray] show_toolbar invoked");
    TOOLBAR_FINISHING.store(false, Ordering::SeqCst);
    mark_popover_shown(&app);
    let (mx, my, mw, mh) = tray_monitor_physical_rect(&app);
    let scale = overlay_scale_factor(&app);
    let saved = load_toolbar_position(&app);
    let preference = normalized_toolbar_dock_preference(saved.as_ref());
    let vertical = preference.mode == "docked"
        && matches!(preference.location.as_deref(), Some("left" | "right"));
    let w: u32 = ((if vertical { 42.0 } else { 150.0 }) * scale).round() as u32;
    let h: u32 = ((if vertical { 118.0 } else { 42.0 }) * scale).round() as u32;
    let gutter = (16.0 * scale).round() as i32;
    let default_x: i32 = mx + (mw as i32 - w as i32) / 2;
    let default_y: i32 = my + mh as i32 - h as i32 - (20.0 * scale).round() as i32;
    let (x, y) = match saved {
        Some(saved) => (
            saved
                .x
                .clamp(mx + gutter, mx + mw as i32 - w as i32 - gutter),
            saved
                .y
                .clamp(my + gutter, my + mh as i32 - h as i32 - gutter),
        ),
        None => (default_x, default_y),
    };
    dlog!("[clips-tray] toolbar pos=({},{}) size={}x{}", x, y, w, h);
    if let Some(existing) = app.get_webview_window(TOOLBAR_LABEL) {
        let _ = existing.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
        let _ = existing.set_position(PhysicalPosition::new(x, y));
        set_capture_excluded(&existing);
        configure_overlay_behavior(&existing);
        raise_to_status_level(&existing);
        start_topmost_reassert_loop(&app, TOOLBAR_LABEL, &TOOLBAR_TOPMOST_GENERATION);
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
        .shadow(true)
        .visible(false)
        .focused(false);
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
    raise_to_status_level(&win);
    dlog!("[clips-tray] toolbar created (hidden until renderer is ready)");

    Ok(())
}

#[tauri::command]
pub async fn toolbar_set_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    let Some(win) = app.get_webview_window(TOOLBAR_LABEL) else {
        return Ok(());
    };
    if visible {
        raise_to_status_level(&win);
        start_topmost_reassert_loop(&app, TOOLBAR_LABEL, &TOOLBAR_TOPMOST_GENERATION);
        crate::util::show_without_activation(&win);
    } else {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn show_bubble(app: AppHandle) -> Result<(), String> {
    dlog!("[clips-tray] show_bubble invoked");
    mark_popover_shown(&app);
    if let Some(existing) = app.get_webview_window(BUBBLE_LABEL) {
        clamp_existing_bubble_window(&app, &existing);
        crate::util::show_without_activation(&existing);
        dlog!("[clips-tray] bubble reused");
        return Ok(());
    }
    let size_name = load_bubble_size_name(&app);
    let size: u32 = bubble_size_for_name(&size_name);
    let gutter = overlay_shadow_gutter_physical(&app);
    let (win_w, win_h) = bubble_window_size_for(&app, size);

    let (mon_x, mon_y, mon_w, mon_h) = tray_monitor_physical_rect(&app);

    let default_x: i32 = mon_x + 48 - gutter as i32;
    let default_y: i32 = mon_y + mon_h as i32 - win_h as i32;
    let (default_x, default_y) =
        clamp_bubble_window_position(&app, default_x, default_y, win_w, win_h);
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
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = app_for_bounds.emit(BUBBLE_DESTROYED_EVENT, ());
            return;
        }
        if matches!(
            event,
            tauri::WindowEvent::Moved(_)
                | tauri::WindowEvent::Resized(_)
                | tauri::WindowEvent::ScaleFactorChanged { .. }
        ) {
            if BUBBLE_DRAGGING.load(Ordering::SeqCst) {
                return;
            }
            clamp_existing_bubble_window(&app_for_bounds, &win_for_bounds);
        }
    });
    configure_overlay_behavior(&win);
    crate::util::show_without_activation(&win);
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

fn overlay_labels_to_hide(preserve_finalizing: bool) -> impl Iterator<Item = &'static str> {
    let preserve_toolbar = TOOLBAR_FINISHING.load(Ordering::SeqCst);
    OVERLAY_LABELS.iter().copied().filter(move |label| {
        if preserve_finalizing && *label == FINALIZING_LABEL {
            return false;
        }
        if preserve_toolbar && *label == TOOLBAR_LABEL {
            return false;
        }
        true
    })
}

#[tauri::command]
pub async fn hide_overlays(
    app: AppHandle,
    preserve_finalizing: Option<bool>,
) -> Result<(), String> {
    stop_countdown_control_tracking();
    close_monitor_picker_windows(&app);
    for label in overlay_labels_to_hide(preserve_finalizing.unwrap_or(false)) {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.close();
        }
    }
    if !crate::util::is_meeting_active(&app) {
        let _ = crate::recording_indicator::recording_pill_hide(app).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_recording_chrome(
    app: AppHandle,
    preserve_display_override: Option<bool>,
    preserve_window_override: Option<bool>,
) -> Result<(), String> {
    stop_countdown_control_tracking();
    let g = crate::config::feature_config(&app).region_guides;
    let keep_region_guides = g.always_visible && g.enabled && !g.rects.is_empty();
    let mut labels: Vec<&str> = vec![COUNTDOWN_LABEL, REGION_RECORD_BORDER_LABEL];
    if !TOOLBAR_FINISHING.load(Ordering::SeqCst) {
        labels.push(TOOLBAR_LABEL);
    }
    if !keep_region_guides {
        labels.push(REGION_GUIDES_LABEL);
    }
    for label in labels {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.close();
        }
    }
    if !preserve_display_override.unwrap_or(false) {
        crate::state::SelectedRecordingDisplay::set(&app, None);
    }
    if !preserve_window_override.unwrap_or(false) {
        crate::state::SelectedRecordingWindow::set(&app, None);
    }
    let app_for_pill = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
        if !crate::util::is_recording_active(&app_for_pill) {
            let _ = crate::recording_indicator::recording_pill_hide(app_for_pill).await;
        }
    });
    Ok(())
}

fn close_bubble_window(app: &AppHandle) {
    let _ = app.emit("clips:release-camera", ());
    if let Some(w) = app.get_webview_window(BUBBLE_LABEL) {
        let _ = w.hide();
        dlog!("[clips-tray] close_bubble - destroying bubble webview");
        let _ = w.close();
    } else {
        dlog!("[clips-tray] close_bubble - no bubble window to close");
    }
}

async fn close_bubble_window_and_wait(app: &AppHandle) -> Result<(), String> {
    let (closed_tx, closed_rx) = tokio::sync::oneshot::channel();
    let listener = app.once(BUBBLE_DESTROYED_EVENT, move |_| {
        let _ = closed_tx.send(());
    });
    if app.get_webview_window(BUBBLE_LABEL).is_none() {
        app.unlisten(listener);
        return Ok(());
    }

    close_bubble_window(app);
    closed_rx
        .await
        .map_err(|_| "camera bubble destruction acknowledgement was dropped".to_string())
}

pub fn close_bubble_if_idle(app: &AppHandle) {
    if is_recording_active(app) {
        return;
    }
    close_bubble_window(app);
}

#[tauri::command]
pub async fn close_bubble(app: AppHandle) -> Result<(), String> {
    close_bubble_window(&app);
    Ok(())
}

fn clamp_popover_logical_size(
    height: f64,
    width: Option<f64>,
    work_area: PhysicalSize<u32>,
    scale: f64,
) -> (f64, f64) {
    let scale = scale.max(1.0);
    let max_height =
        (work_area.height as f64 / scale - POPOVER_SCREEN_MARGIN_LOGICAL).clamp(1.0, 820.0);
    let max_width =
        (work_area.width as f64 / scale - POPOVER_SCREEN_MARGIN_LOGICAL).clamp(1.0, 960.0);
    (
        width
            .unwrap_or(POPOVER_DEFAULT_WIDTH_LOGICAL)
            .clamp(POPOVER_DEFAULT_WIDTH_LOGICAL.min(max_width), max_width),
        height.clamp(POPOVER_MIN_HEIGHT_LOGICAL.min(max_height), max_height),
    )
}

fn physical_rect_center(rect: tauri::Rect) -> (i32, i32) {
    let (x, y) = match rect.position {
        tauri::Position::Physical(p) => (p.x, p.y),
        tauri::Position::Logical(p) => (p.x as i32, p.y as i32),
    };
    let (width, height) = match rect.size {
        tauri::Size::Physical(s) => (s.width as i32, s.height as i32),
        tauri::Size::Logical(s) => (s.width as i32, s.height as i32),
    };
    (x + width / 2, y + height / 2)
}

fn monitor_containing_point(window: &WebviewWindow, x: i32, y: i32) -> Option<tauri::Monitor> {
    window
        .available_monitors()
        .ok()?
        .into_iter()
        .find(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            x >= position.x
                && x < position.x + size.width as i32
                && y >= position.y
                && y < position.y + size.height as i32
        })
}

#[tauri::command]
pub async fn resize_popover(app: AppHandle, height: f64, width: Option<f64>) -> Result<(), String> {
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
        let tray_center = app
            .try_state::<TrayAnchor>()
            .and_then(|anchor| anchor.0.lock().ok().and_then(|guard| *guard))
            .map(physical_rect_center);
        let monitor = tray_center
            .and_then(|(x, y)| monitor_containing_point(&w, x, y))
            .or_else(|| w.current_monitor().ok().flatten())
            .or_else(|| w.primary_monitor().ok().flatten());
        let (width, clamped) = monitor
            .as_ref()
            .map(|monitor| {
                clamp_popover_logical_size(
                    height,
                    width,
                    monitor.work_area().size,
                    monitor.scale_factor(),
                )
            })
            .unwrap_or_else(|| {
                clamp_popover_logical_size(height, width, PhysicalSize::new(976, 836), 1.0)
            });
        let (window_width, window_height) = (width, clamped);
        let _ = w.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
            width, clamped,
        )));
        let target_scale = monitor
            .as_ref()
            .map(|monitor| monitor.scale_factor())
            .unwrap_or_else(|| w.scale_factor().unwrap_or(1.0))
            .max(1.0);
        let target_physical = PhysicalSize::new(
            (window_width * target_scale).round() as u32,
            (window_height * target_scale).round() as u32,
        );
        position_popover_with_size(&app, &w, target_physical);
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
            "camera" => "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Camera",
            "microphone" => {
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Microphone"
            }
            "screen" => {
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture"
            }
            "speech" => {
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_SpeechRecognition"
            }
            "accessibility" => {
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility"
            }
            "input-monitoring" => {
                "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ListenEvent"
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindExcludedApplication {
    bundle_id: String,
    name: String,
    path: Option<String>,
    installed: bool,
}

#[cfg(target_os = "macos")]
fn app_bundle_id(path: &str) -> Option<String> {
    let output = Command::new("/usr/bin/mdls")
        .args(["-name", "kMDItemCFBundleIdentifier", "-raw", path])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let bundle_id = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!bundle_id.is_empty() && bundle_id != "(null)").then_some(bundle_id)
}

#[cfg(target_os = "macos")]
fn app_name_from_path(path: &str) -> String {
    std::path::Path::new(path)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("Application")
        .to_string()
}

fn fallback_app_name(bundle_id: &str) -> String {
    match bundle_id {
        "com.1password.1password" | "com.agilebits.onepassword7" => "1Password".to_string(),
        "com.bitwarden.desktop" => "Bitwarden".to_string(),
        "com.dashlane.dashlane" => "Dashlane".to_string(),
        "com.lastpass.lastpass" => "LastPass".to_string(),
        _ => bundle_id
            .rsplit('.')
            .next()
            .filter(|name| !name.is_empty())
            .unwrap_or("Application")
            .to_string(),
    }
}

#[cfg(target_os = "macos")]
fn find_installed_app(bundle_id: &str) -> Option<String> {
    let query = format!("kMDItemCFBundleIdentifier == '{bundle_id}'");
    let output = Command::new("/usr/bin/mdfind").arg(query).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find(|path| path.ends_with(".app"))
        .map(str::to_string)
}

#[tauri::command]
pub fn resolve_rewind_excluded_apps(
    bundle_ids: Vec<String>,
) -> Result<Vec<RewindExcludedApplication>, String> {
    #[cfg(target_os = "macos")]
    {
        return Ok(bundle_ids
            .into_iter()
            .map(|bundle_id| {
                let path = find_installed_app(&bundle_id);
                let name = path
                    .as_deref()
                    .map(app_name_from_path)
                    .unwrap_or_else(|| fallback_app_name(&bundle_id));
                RewindExcludedApplication {
                    bundle_id,
                    name,
                    installed: path.is_some(),
                    path,
                }
            })
            .collect());
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(bundle_ids
            .into_iter()
            .map(|bundle_id| RewindExcludedApplication {
                name: fallback_app_name(&bundle_id),
                bundle_id,
                path: None,
                installed: false,
            })
            .collect())
    }
}

#[cfg(target_os = "macos")]
fn choose_rewind_excluded_apps_blocking() -> Result<Vec<RewindExcludedApplication>, String> {
    let script = r#"
set chosenApps to choose application with prompt "Choose apps Rewind should never remember" with multiple selections allowed
set chosenPaths to {}
repeat with chosenApp in chosenApps
    set end of chosenPaths to POSIX path of (chosenApp as alias)
end repeat
set AppleScript's text item delimiters to linefeed
return chosenPaths as text
"#;
    let output = Command::new("/usr/bin/osascript")
        .args(["-e", script])
        .output()
        .map_err(|error| format!("Could not open the application picker: {error}"))?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr);
        if error.contains("-128") || error.to_ascii_lowercase().contains("canceled") {
            return Ok(Vec::new());
        }
        return Err(format!("Could not choose applications: {}", error.trim()));
    }
    let mut apps = Vec::new();
    for path in String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        let Some(bundle_id) = app_bundle_id(path) else {
            continue;
        };
        apps.push(RewindExcludedApplication {
            bundle_id,
            name: app_name_from_path(path),
            path: Some(path.to_string()),
            installed: true,
        });
    }
    Ok(apps)
}

#[tauri::command]
pub async fn choose_rewind_excluded_apps() -> Result<Vec<RewindExcludedApplication>, String> {
    #[cfg(target_os = "macos")]
    {
        return tauri::async_runtime::spawn_blocking(choose_rewind_excluded_apps_blocking)
            .await
            .map_err(|error| format!("The application picker stopped unexpectedly: {error}"))?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Choosing excluded applications is currently available on macOS only.".to_string())
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

#[tauri::command]
pub async fn show_flow_bar(app: AppHandle) -> Result<(), String> {
    dlog!("[clips-tray] show_flow_bar invoked");

    let (mx, my, mw, mh) = tray_monitor_physical_rect(&app);
    let scale = overlay_scale_factor(&app);
    let w: u32 = (300.0 * scale).round() as u32;
    let h: u32 = (80.0 * scale).round() as u32;
    let bottom_margin: i32 = (32.0 * scale).round() as i32;
    let x: i32 = (mx + (mw as i32 - w as i32) / 2).max(mx);
    let y: i32 = (my + mh as i32 - h as i32 - bottom_margin).max(my);

    if let Some(existing) = app.get_webview_window(FLOW_BAR_LABEL) {
        let _ = existing.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
        let _ = existing.set_position(PhysicalPosition::new(x, y));
        let _ = existing.set_ignore_cursor_events(false);
        configure_overlay_behavior(&existing);
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
        .shadow(true)
        .visible(false)
        .focused(false)
        .build()
        .map_err(|e| {
            eprintln!("[clips-tray] flow bar build failed: {}", e);
            e.to_string()
        })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    let _ = win.set_ignore_cursor_events(false);
    set_capture_excluded(&win);
    configure_overlay_behavior(&win);
    crate::util::show_without_activation(&win);
    let app_for_timeout = app.clone();
    thread::spawn(move || {
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
    crate::shortcuts::set_dictation_active_and_sync_escape(&app, false);
    if let Some(w) = app.get_webview_window(FLOW_BAR_LABEL) {
        let _ = w.hide();
    }
    hide_voice_wake_popover(&app);
    Ok(())
}

const MESSAGING_APP_BUNDLES: &[&str] = &[
    "com.tinyspeck.slackmacgap", // Slack
    "com.apple.MobileSMS",       // Messages
    "com.apple.iChat",           // Messages (legacy bundle id)
    "net.whatsapp.WhatsApp",
    "com.hnc.Discord",
    "ru.keepcoder.Telegram",
];

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
pub async fn complete_voice_dictation(app: AppHandle, text: String) -> Result<String, String> {
    let trimmed = text.trim().to_string();
    if trimmed.is_empty() {
        eprintln!("[clips-tray] complete_voice_dictation: empty text — nothing to paste");
        return Ok("inserted".into());
    }
    if let Some(last) = app.try_state::<LastTranscript>() {
        if let Ok(mut g) = last.0.lock() {
            *g = Some(trimmed.clone());
        }
    }
    crate::tray::rebuild_tray_menu(&app);
    #[cfg(target_os = "macos")]
    {
        let had_text_field_at_start = app
            .try_state::<VoiceTargetTextField>()
            .and_then(|state| state.0.lock().ok().and_then(|g| *g))
            .unwrap_or_else(crate::accessibility::focused_text_field_available);
        if !had_text_field_at_start {
            write_clipboard(&trimmed)?;
            eprintln!(
                "[clips-tray] complete_voice_dictation: no focused text field — copied to clipboard"
            );
            return Ok("copied".into());
        }
    }

    insert_text_for_frontmost(&app, &trimmed, "complete_voice_dictation")?;
    Ok("inserted".into())
}

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
        TextInsertionStrategy::ClipboardPaste => {
            let prior_clipboard = read_clipboard();
            write_clipboard(&trimmed)?;
            paste_clipboard(voice_target_bundle_id, trimmed.clone(), prior_clipboard);
        }
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
        let has_text_field = crate::accessibility::focused_text_field_available();
        if let Some(state) = app.try_state::<VoiceTargetBundle>() {
            if let Ok(mut g) = state.0.lock() {
                *g = target;
            }
        }
        if let Some(state) = app.try_state::<VoiceTargetTextField>() {
            if let Ok(mut g) = state.0.lock() {
                *g = Some(has_text_field);
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
        clamp_popover_logical_size, overlay_labels_to_hide, strip_trailing_period_for_messaging,
        text_insertion_strategy, TextInsertionStrategy, BUBBLE_LABEL, FINALIZING_LABEL,
    };
    use tauri::PhysicalSize;

    #[test]
    fn popover_size_uses_work_area_and_preserves_recorder_controls() {
        assert_eq!(
            clamp_popover_logical_size(120.0, Some(1_000.0), PhysicalSize::new(800, 600), 1.0),
            (784.0, 260.0)
        );
        assert_eq!(
            clamp_popover_logical_size(1_000.0, None, PhysicalSize::new(1_600, 1_200), 2.0),
            (320.0, 584.0)
        );
        assert_eq!(
            clamp_popover_logical_size(260.0, Some(320.0), PhysicalSize::new(200, 180), 1.0),
            (184.0, 164.0)
        );
    }

    #[test]
    fn overlay_cleanup_can_preserve_finalizing_progress() {
        assert!(!overlay_labels_to_hide(true).any(|label| label == FINALIZING_LABEL));
        assert!(overlay_labels_to_hide(false).any(|label| label == FINALIZING_LABEL));
        assert!(overlay_labels_to_hide(false).any(|label| label == BUBBLE_LABEL));
    }

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
        use super::super::{
            appkit_frame_for_physical_bounds, chunk_graphemes_by_utf16_units,
            utf8_pasteboard_command,
        };
        use objc2_foundation::{NSPoint, NSRect, NSSize};
        use std::ffi::OsStr;

        fn assert_close(actual: f64, expected: f64) {
            assert!((actual - expected).abs() < 0.001, "{actual} != {expected}");
        }

        #[test]
        fn atomic_toolbar_bounds_preserve_the_requested_screen_anchor() {
            let current = NSRect::new(NSPoint::new(50.0, 300.0), NSSize::new(176.0, 176.0));

            let right_anchored =
                appkit_frame_for_physical_bounds(current, 100, 200, 368, 200, 84, 352, 2.0);
            assert_close(
                right_anchored.origin.x + right_anchored.size.width,
                current.origin.x + current.size.width,
            );

            let bottom_anchored =
                appkit_frame_for_physical_bounds(current, 100, 200, 100, 468, 352, 84, 2.0);
            assert_close(bottom_anchored.origin.y, current.origin.y);
        }

        #[test]
        fn pasteboard_commands_force_utf8_for_gui_launches() {
            let command = utf8_pasteboard_command("pbcopy");
            let env_value = |key: &str| {
                command
                    .get_envs()
                    .find(|(name, _)| *name == OsStr::new(key))
                    .and_then(|(_, value)| value)
            };
            assert_eq!(env_value("LANG"), Some(OsStr::new("en_US.UTF-8")));
            assert_eq!(env_value("LC_ALL"), Some(OsStr::new("en_US.UTF-8")));
        }

        #[test]
        fn never_splits_a_zwj_family_emoji_across_chunks() {
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
fn utf8_pasteboard_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command
        .env("LANG", "en_US.UTF-8")
        .env("LC_ALL", "en_US.UTF-8");
    command
}

#[cfg(target_os = "macos")]
fn write_clipboard(text: &str) -> Result<(), String> {
    let mut child = utf8_pasteboard_command("pbcopy")
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

#[cfg(not(target_os = "macos"))]
fn write_clipboard(_text: &str) -> Result<(), String> {
    Err("voice dictation is currently macOS-only".to_string())
}

#[cfg(target_os = "macos")]
fn read_clipboard() -> Option<String> {
    let out = utf8_pasteboard_command("pbpaste").output().ok()?;
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
    for _ in 0..20 {
        if frontmost_bundle_identifier().as_deref() == Some(bundle_id) {
            return;
        }
        thread::sleep(Duration::from_millis(30));
    }
}

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
            thread::sleep(Duration::from_millis(2));
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn type_text_unicode(_text: &str) {}

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

#[tauri::command]
pub async fn release_recording_state(app: AppHandle) -> Result<(), String> {
    dlog!("[clips-tray] release_recording_state");
    if let Some(state) = app.try_state::<RecordingActive>() {
        if let Ok(mut g) = state.0.lock() {
            *g = false;
        }
    }
    crate::tray::rebuild_tray_menu(&app);
    close_bubble_window_and_wait(&app).await
}

#[tauri::command]
pub async fn set_meeting_active(
    app: AppHandle,
    active: bool,
    meeting_id: Option<String>,
) -> Result<(), String> {
    dlog!(
        "[clips-tray] set_meeting_active active={} meeting_id={:?}",
        active,
        meeting_id
    );
    if let Some(state) = app.try_state::<MeetingActive>() {
        if let Ok(mut g) = state.0.lock() {
            *g = active;
        }
    }
    if let Some(state) = app.try_state::<ActiveMeetingId>() {
        if let Ok(mut g) = state.0.lock() {
            *g = if active { meeting_id } else { None };
        }
    }
    crate::tray::rebuild_tray_menu(&app);
    Ok(())
}

#[tauri::command]
pub async fn get_active_meeting_id(app: AppHandle) -> Result<Option<String>, String> {
    Ok(app
        .try_state::<ActiveMeetingId>()
        .and_then(|s| s.0.lock().ok().and_then(|g| g.clone())))
}

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

#[tauri::command]
pub async fn reset_state(app: AppHandle) -> Result<(), String> {
    eprintln!("[clips-tray] reset_state invoked — clearing recording flag + showing popover");
    if let Some(state) = app.try_state::<RecordingActive>() {
        if let Ok(mut g) = state.0.lock() {
            *g = false;
        }
    }
    if let Some(state) = app.try_state::<MeetingActive>() {
        if let Ok(mut g) = state.0.lock() {
            *g = false;
        }
    }
    if let Some(state) = app.try_state::<ActiveMeetingId>() {
        if let Ok(mut g) = state.0.lock() {
            *g = None;
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

#[tauri::command]
pub async fn load_bubble_size(app: AppHandle) -> Result<String, String> {
    Ok(load_bubble_size_name(&app))
}

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

#[tauri::command]
pub async fn save_bubble_position(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    let Some(path) = bubble_position_path(&app) else {
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
        let _ = std::fs::remove_file(&tmp);
        return Ok(());
    }
    Ok(())
}

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
    mark_popover_shown(&app);
    Ok(())
}

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

#[tauri::command]
pub async fn bubble_drag_end(app: AppHandle) -> Result<(), String> {
    *bubble_drag_anchor()
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = None;
    BUBBLE_DRAGGING.store(false, Ordering::SeqCst);
    if let Some(window) = app.get_webview_window(BUBBLE_LABEL) {
        clamp_existing_bubble_window(&app, &window);
    }
    crate::schedule_popover_dismissal(&app);
    Ok(())
}

#[tauri::command]
pub async fn show_popover(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("popover") {
        present_popover(&app, &window);
    }
    Ok(())
}

pub fn hide_popover(app: &AppHandle) {
    set_popover_parked(app, false);
    if let Some(window) = app.get_webview_window("popover") {
        let _ = window.hide();
    }
    close_bubble_if_idle(app);
    let _ = app.emit("clips:popover-visible", false);
}

#[tauri::command]
pub async fn park_popover_offscreen(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("popover") {
        set_popover_parked(&app, true);
        set_capture_excluded(&window);
        let _ = window.set_ignore_cursor_events(true);
        let _ = window.set_position(PhysicalPosition::new(-10_000_i32, -10_000_i32));
        set_window_opacity(&window, 0.0);
    }
    Ok(())
}


fn clear_voice_wake_state(app: &AppHandle) {
    if let Some(state) = app.try_state::<VoiceWakePopover>() {
        if let Ok(mut g) = state.0.lock() {
            *g = false;
        }
    }
}

fn set_popover_parked(app: &AppHandle, parked: bool) {
    if let Some(state) = app.try_state::<PopoverParked>() {
        state.0.store(parked, std::sync::atomic::Ordering::SeqCst);
    }
}

pub fn popover_is_parked(app: &AppHandle) -> bool {
    app.try_state::<PopoverParked>()
        .map(|state| state.0.load(std::sync::atomic::Ordering::SeqCst))
        .unwrap_or(false)
}

fn is_pinhole_popover(window: &WebviewWindow) -> bool {
    window
        .outer_size()
        .map(|size| size.width <= 4 || size.height <= 4)
        .unwrap_or(false)
}

fn present_popover(app: &AppHandle, window: &WebviewWindow) {
    set_popover_parked(app, false);
    clear_voice_wake_state(app);
    set_window_opacity(window, 1.0);
    let _ = window.set_ignore_cursor_events(false);
    set_capture_excluded(window);
    configure_overlay_behavior(window);
    let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(
        POPOVER_DEFAULT_WIDTH_LOGICAL,
        POPOVER_DEFAULT_HEIGHT_LOGICAL,
    )));
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
    let voice_woken = app
        .try_state::<VoiceWakePopover>()
        .and_then(|s| s.0.lock().ok().map(|g| *g))
        .unwrap_or(false);
    let user_visible =
        window.is_visible().unwrap_or(false) && !voice_woken && !is_pinhole_popover(&window);
    if user_visible {
        hide_popover(app);
        return;
    }
    present_popover(app, &window);
}

pub fn position_popover(app: &AppHandle, window: &WebviewWindow) {
    let win_size = window.outer_size().unwrap_or(PhysicalSize::new(360, 440));
    position_popover_with_size(app, window, win_size);
}

pub fn position_popover_with_size(
    app: &AppHandle,
    window: &WebviewWindow,
    win_size: PhysicalSize<u32>,
) {
    let anchor = app.state::<TrayAnchor>();
    let tray_rect = anchor.0.lock().ok().and_then(|g| *g);

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
    let work_area = monitor.work_area();
    let mon_size = &work_area.size;
    let mon_pos = &work_area.position;

    if let Some(rect) = tray_rect {
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

        let mut x = icon_x + icon_w / 2 - (win_size.width as i32) / 2;
        let mut y = icon_y + icon_h;

        let tray_monitor =
            monitor_containing_point(window, icon_x + icon_w / 2, icon_y + icon_h / 2);
        let (clamp_pos, clamp_size) = tray_monitor
            .map(|m| {
                let work_area = m.work_area();
                (work_area.position, work_area.size)
            })
            .unwrap_or((*mon_pos, *mon_size));

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

    let scale = monitor.scale_factor();
    let margin_right = (12.0 * scale) as i32;
    let margin_top = (36.0 * scale) as i32;
    let min_x = mon_pos.x + 8;
    let max_x = mon_pos.x + mon_size.width as i32 - win_size.width as i32 - 8;
    let min_y = mon_pos.y + 8;
    let max_y = mon_pos.y + mon_size.height as i32 - win_size.height as i32 - 8;
    let x = (mon_pos.x + mon_size.width as i32 - win_size.width as i32 - margin_right)
        .clamp(min_x, max_x.max(min_x));
    let y = (mon_pos.y + margin_top).clamp(min_y, max_y.max(min_y));
    let _ = window.set_position(PhysicalPosition::new(x, y));
}
