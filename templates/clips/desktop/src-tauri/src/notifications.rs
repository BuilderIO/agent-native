//! Native desktop notifications for upcoming meetings.
//!
//! Wraps `tauri-plugin-notification` (v2). The "join_url" in the payload is
//! intentionally NOT auto-opened by the notification system itself. The
//! frontend owns the "Start notes" click so consent/control stays visible.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindowBuilder};

use crate::dlog;
use crate::util::{
    build_overlay_url, configure_overlay_behavior, primary_monitor_physical_size,
    show_without_activation,
};

const MEETING_NOTIFICATION_LABEL: &str = "meeting-notif";
const NOTIFICATION_W_LOGICAL: u32 = 380;
const NOTIFICATION_H_LOGICAL: u32 = 132;
const NOTIFICATION_TOP_MARGIN_LOGICAL: u32 = 44;
const NOTIFICATION_RIGHT_MARGIN_LOGICAL: u32 = 24;

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

pub fn show_meeting_notification_window(app: &AppHandle) -> Result<(), String> {
    let (w, h, x, y) = notification_rect(app);
    if let Some(existing) = app.get_webview_window(MEETING_NOTIFICATION_LABEL) {
        let _ = existing.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
        let _ = existing.set_position(PhysicalPosition::new(x, y));
        configure_overlay_behavior(&existing);
        show_without_activation(&existing);
        return Ok(());
    }

    let win = WebviewWindowBuilder::new(
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
    .focused(false)
    .build()
    .map_err(|e| {
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

#[tauri::command]
pub async fn notify_meeting_starting(
    app: AppHandle,
    meeting_id: String,
    title: String,
    starts_in_secs: i64,
    join_url: Option<String>,
    auto_start: Option<bool>,
) -> Result<(), String> {
    let pretty_in = if starts_in_secs <= 0 {
        "now".to_string()
    } else if starts_in_secs < 90 {
        format!("in {}s", starts_in_secs)
    } else {
        format!("in {} min", (starts_in_secs / 60).max(1))
    };
    let body = if join_url.is_some() {
        format!("{} — Start notes", pretty_in)
    } else {
        format!("Starts {}", pretty_in)
    };
    dlog!(
        "[clips-tray] notify_meeting_starting id={} title={} body={}",
        meeting_id,
        title,
        body
    );

    // Keep the latest payload available for cold overlay windows, then emit
    // for already-mounted listeners.
    let payload = serde_json::json!({
        "type": "calendar",
        "title": title,
        "subtitle": body,
        "meetingId": meeting_id,
        "joinUrl": join_url,
        "autoStart": auto_start.unwrap_or(false),
    });
    store_pending_meeting_notification(&app, &payload);
    let _ = app.emit("meetings:show-notification", payload.clone());

    Ok(())
}
