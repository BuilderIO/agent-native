//! Native desktop notifications for upcoming meetings.
//!
//! Wraps `tauri-plugin-notification` (v2). The "join_url" in the payload is
//! intentionally NOT auto-opened by the notification system itself. The
//! frontend owns the "Start notes" click so consent/control stays visible.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;

use crate::dlog;
use crate::util::{
    build_overlay_url, primary_monitor_physical_size, set_capture_excluded, show_without_activation,
};

const MEETING_NOTIFICATION_LABEL: &str = "meeting-notif";
const NOTIFICATION_W_LOGICAL: u32 = 380;
const NOTIFICATION_H_LOGICAL: u32 = 132;
const NOTIFICATION_TOP_MARGIN_LOGICAL: u32 = 44;
const NOTIFICATION_RIGHT_MARGIN_LOGICAL: u32 = 24;

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

fn show_meeting_notification_window(app: &AppHandle) -> Result<(), String> {
    let (w, h, x, y) = notification_rect(app);
    if let Some(existing) = app.get_webview_window(MEETING_NOTIFICATION_LABEL) {
        let _ = existing.set_size(tauri::Size::Physical(PhysicalSize::new(w, h)));
        let _ = existing.set_position(PhysicalPosition::new(x, y));
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
    set_capture_excluded(&win);
    show_without_activation(&win);
    Ok(())
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

    let result = app
        .notification()
        .builder()
        .title(format!("Meeting: {}", title))
        .body(&body)
        .show();

    if let Err(err) = result {
        eprintln!("[clips-tray] notify_meeting_starting failed: {err}");
        // Don't return Err — we still want to fire the in-app banner so the
        // user sees something even if macOS blocks notifications.
    }

    if let Err(err) = show_meeting_notification_window(&app) {
        eprintln!("[clips-tray] show meeting notification failed: {err}");
    }

    // Fire the Tauri event regardless. The renderer's banner overlay listens
    // for `meetings:show-notification` and renders the in-app card. Emit once
    // immediately and once after the just-created webview has mounted so a
    // cold notification window cannot miss its first payload.
    let payload = serde_json::json!({
        "type": "calendar",
        "title": title,
        "subtitle": body,
        "meetingId": meeting_id,
        "joinUrl": join_url,
        "autoStart": auto_start.unwrap_or(false),
    });
    let _ = app.emit("meetings:show-notification", payload.clone());
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        let _ = app_clone.emit("meetings:show-notification", payload);
    });

    Ok(())
}
