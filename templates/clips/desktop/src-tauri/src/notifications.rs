//! Native desktop notifications for upcoming meetings.
//!
//! Wraps `tauri-plugin-notification` (v2). The "join_url" in the payload is
//! intentionally NOT auto-opened by the notification system itself — the
//! `meetings:start-recording` Tauri event fires unconditionally so the
//! frontend can open the URL via `tauri-plugin-shell` while simultaneously
//! invoking `start-meeting-recording`. That keeps the side-effect surface
//! in TypeScript where it's easier to reason about.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

use crate::dlog;

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingNotificationPayload {
    pub meeting_id: String,
    pub title: String,
    pub starts_in_secs: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub join_url: Option<String>,
}

#[tauri::command]
pub async fn notify_meeting_starting(
    app: AppHandle,
    meeting_id: String,
    title: String,
    starts_in_secs: i64,
    join_url: Option<String>,
) -> Result<(), String> {
    let pretty_in = if starts_in_secs <= 0 {
        "now".to_string()
    } else if starts_in_secs < 90 {
        format!("in {}s", starts_in_secs)
    } else {
        format!("in {} min", (starts_in_secs / 60).max(1))
    };
    let body = if join_url.is_some() {
        format!("{} — Join + Record", pretty_in)
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

    // Fire the Tauri event regardless. The renderer's banner overlay
    // (`meeting-notification.tsx`) listens for `meetings:show-notification`
    // and renders the in-app card, and the popover listens for
    // `meetings:start-recording` to kick off the actual recording action.
    let _ = app.emit(
        "meetings:show-notification",
        serde_json::json!({
            "type": "calendar",
            "title": title,
            "subtitle": body,
            "meetingId": meeting_id,
        }),
    );
    let _ = app.emit(
        "meetings:start-recording",
        serde_json::json!({
            "meetingId": meeting_id,
            "joinUrl": join_url,
        }),
    );

    Ok(())
}
