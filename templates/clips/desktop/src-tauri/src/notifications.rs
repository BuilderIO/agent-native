//! Native desktop notifications for upcoming meetings.
//!
//! Wraps `tauri-plugin-notification` (v2). The "join_url" in the payload is
//! intentionally NOT auto-opened by the notification system itself. The
//! frontend owns the "Start notes" click so consent/control stays visible.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::dlog;
use crate::util::{
    build_overlay_url, configure_overlay_behavior, primary_monitor_physical_size,
    show_without_activation,
};

const MEETING_NOTIFICATION_LABEL: &str = "meeting-notif";
// Window is wider than the 440px card so the card's drop shadow (~32px each
// side) renders inside the transparent window instead of being clipped. The
// right margin is pulled in to keep the card near the top-right corner.
const NOTIFICATION_W_LOGICAL: u32 = 504;
const NOTIFICATION_H_LOGICAL: u32 = 120;
const NOTIFICATION_TOP_MARGIN_LOGICAL: u32 = 44;
const NOTIFICATION_RIGHT_MARGIN_LOGICAL: u32 = 0;

#[derive(Default)]
pub struct MeetingNotificationState(pub Mutex<Option<Value>>);

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingNotificationPayload {
    pub meeting_id: String,
    pub title: String,
    pub starts_in_secs: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub join_url: Option<String>,
}

fn scale_factor(app: &AppHandle) -> f64 {
    app.get_webview_window("popover")
        .and_then(|w| w.scale_factor().ok())
        .unwrap_or(2.0)
}

fn notification_rect(app: &AppHandle) -> (u32, u32, i32, i32) {
    let scale = scale_factor(app);
    let w = (NOTIFICATION_W_LOGICAL as f64 * scale) as u32;
    let h = (NOTIFICATION_H_LOGICAL as f64 * scale) as u32;
    let top = (NOTIFICATION_TOP_MARGIN_LOGICAL as f64 * scale) as i32;
    let right = (NOTIFICATION_RIGHT_MARGIN_LOGICAL as f64 * scale) as i32;
    let (mw, _mh) = primary_monitor_physical_size(app).unwrap_or((2880, 1800));
    let x = (mw as i32 - w as i32 - right).max(0);
    (w, h, x, top.max(0))
}

static MEETING_NOTIF_HOVER_TRACKING: AtomicBool = AtomicBool::new(false);

/// True when the global cursor sits inside the notification window's frame.
/// Mirrors `cursor_inside_pill_frame` in `recording_indicator.rs`: cursor and
/// frame both come from Tauri (physical px, desktop top-left origin), so the
/// test is a plain point-in-rect with no AppKit hop.
fn cursor_inside_notification_frame(window: &WebviewWindow) -> bool {
    let (Ok(c), Ok(p), Ok(s)) = (
        window.cursor_position(),
        window.outer_position(),
        window.outer_size(),
    ) else {
        return false;
    };
    c.x >= p.x as f64
        && c.x <= (p.x + s.width as i32) as f64
        && c.y >= p.y as f64
        && c.y <= (p.y + s.height as i32) as f64
}

/// Poll the cursor against the notification frame and emit
/// `meetings:notification-hover` on transitions. The window never becomes key
/// (`show_without_activation` uses `orderFrontRegardless`, not
/// `makeKeyAndOrderFront:`), so CSS `:hover`/`onMouseEnter` only fires once
/// the user's first click makes it key — this poll is the fallback that
/// reveals the close button on real hover before that click, same pattern as
/// `start_pill_hover_tracking`. Idempotent — a second call is a no-op while a
/// loop is already running.
fn start_meeting_notification_hover_tracking(app: &AppHandle) {
    if MEETING_NOTIF_HOVER_TRACKING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut prev = false;
        while MEETING_NOTIF_HOVER_TRACKING.load(Ordering::Relaxed) {
            let Some(win) = app.get_webview_window(MEETING_NOTIFICATION_LABEL) else {
                break;
            };
            // The window is reused across notifications (hidden/shown from
            // the frontend, never destroyed), so this loop runs for the rest
            // of the app session. Skip the cursor/frame queries entirely
            // while hidden — no notification is on screen to hover — and
            // back off to a slower idle tick until it's shown again.
            if !win.is_visible().unwrap_or(false) {
                if prev {
                    prev = false;
                    let _ = win.emit(
                        "meetings:notification-hover",
                        serde_json::json!({ "hovered": false }),
                    );
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
                continue;
            }
            let inside = cursor_inside_notification_frame(&win);
            if inside != prev {
                prev = inside;
                let _ = win.emit(
                    "meetings:notification-hover",
                    serde_json::json!({ "hovered": inside }),
                );
            }
            tokio::time::sleep(Duration::from_millis(80)).await;
        }
        MEETING_NOTIF_HOVER_TRACKING.store(false, Ordering::SeqCst);
    });
}

pub fn show_meeting_notification_window(app: &AppHandle) -> Result<(), String> {
    let (w, h, x, y) = notification_rect(app);
    if let Some(existing) = app.get_webview_window(MEETING_NOTIFICATION_LABEL) {
        let _ = existing.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
        let _ = existing.set_position(PhysicalPosition::new(x, y));
        configure_overlay_behavior(&existing);
        show_without_activation(&existing);
        start_meeting_notification_hover_tracking(&app);
        return Ok(());
    }

    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(
        app,
        MEETING_NOTIFICATION_LABEL,
        build_overlay_url("meeting-notif"),
    )
    .title("Meeting")
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .shadow(false)
    .visible(false)
    .focused(false);
    // The reminder remains non-activating, but its first click should still
    // reach the webview instead of only activating the window.
    #[cfg(target_os = "macos")]
    {
        builder = builder.accept_first_mouse(true);
    }
    let win = builder.build().map_err(|e| {
        eprintln!("[clips-tray] meeting notification build failed: {e}");
        e.to_string()
    })?;
    let _ = win.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    // Intentionally NOT capture-excluded: this is a "your meeting is starting,
    // record it" reminder — it should behave like a normal macOS notification
    // and stay visible, including in any screen recording in progress. (Clips's
    // own recording chrome is still excluded elsewhere so it won't leak.)
    configure_overlay_behavior(&win);
    show_without_activation(&win);
    start_meeting_notification_hover_tracking(&app);
    Ok(())
}

fn store_pending_meeting_notification(app: &AppHandle, payload: &Value) {
    if let Some(state) = app.try_state::<MeetingNotificationState>() {
        if let Ok(mut pending) = state.0.lock() {
            *pending = Some(payload.clone());
        }
    }
}

#[tauri::command]
pub fn take_pending_meeting_notification(app: AppHandle) -> Result<Option<Value>, String> {
    let state = app.state::<MeetingNotificationState>();
    let mut pending = state
        .0
        .lock()
        .map_err(|_| "meeting notification state lock poisoned".to_string())?;
    Ok(pending.take())
}

fn format_time_range_subtitle(
    scheduled_start: Option<&str>,
    scheduled_end: Option<&str>,
    starts_in_secs: i64,
) -> String {
    let Some(start_str) = scheduled_start else {
        return fallback_starts_subtitle(starts_in_secs);
    };
    let Ok(start) = chrono::DateTime::parse_from_rfc3339(start_str) else {
        return fallback_starts_subtitle(starts_in_secs);
    };
    let local_start = start.with_timezone(&chrono::Local);
    let start_label = local_start.format("%-I:%M %p").to_string();
    if let Some(end_str) = scheduled_end {
        if let Ok(end) = chrono::DateTime::parse_from_rfc3339(end_str) {
            let end_label = end.with_timezone(&chrono::Local).format("%-I:%M %p");
            return format!("{start_label} - {end_label}");
        }
    }
    start_label
}

fn fallback_starts_subtitle(starts_in_secs: i64) -> String {
    if starts_in_secs <= 0 {
        "Started".to_string()
    } else if starts_in_secs < 90 {
        format!("Starts in {}s", starts_in_secs)
    } else {
        format!("Starts in {} min", (starts_in_secs / 60).max(1))
    }
}

#[tauri::command]
pub async fn notify_meeting_starting(
    app: AppHandle,
    meeting_id: String,
    title: String,
    starts_in_secs: i64,
    join_url: Option<String>,
    scheduled_start: Option<String>,
    scheduled_end: Option<String>,
    platform: Option<String>,
    auto_start: Option<bool>,
    notification_type: Option<String>,
) -> Result<(), String> {
    let kind = notification_type
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("calendar");
    let is_adhoc = kind == "adhoc";
    let body = if is_adhoc {
        "Take notes?".to_string()
    } else {
        format_time_range_subtitle(
            scheduled_start.as_deref(),
            scheduled_end.as_deref(),
            starts_in_secs,
        )
    };
    dlog!(
        "[clips-tray] notify_meeting_starting type={} id={} title={} body={}",
        kind,
        meeting_id,
        title,
        body
    );

    // Keep the latest payload available for cold overlay windows, then emit
    // for already-mounted listeners.
    let payload = serde_json::json!({
        "type": kind,
        "title": title,
        "subtitle": body,
        "meetingId": meeting_id,
        "joinUrl": join_url,
        "platform": platform,
        "scheduledStart": scheduled_start,
        "scheduledEnd": scheduled_end,
        "autoStart": auto_start.unwrap_or(false),
    });
    store_pending_meeting_notification(&app, &payload);
    let _ = app.emit("meetings:show-notification", payload.clone());

    // Ensure the overlay window exists / is visible for cold starts.
    if let Err(err) = show_meeting_notification_window(&app) {
        eprintln!("[clips-tray] show meeting notification failed: {err}");
    }

    Ok(())
}
