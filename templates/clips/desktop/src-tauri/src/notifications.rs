
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
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
const NOTIFICATION_W_LOGICAL: u32 = 504;
const NOTIFICATION_H_LOGICAL: u32 = 120;
const NOTIFICATION_TOP_MARGIN_LOGICAL: u32 = 44;
const NOTIFICATION_RIGHT_MARGIN_LOGICAL: u32 = 0;
const DISMISSAL_TOMBSTONE_SECS: i64 = 30 * 60;
const ACK_TOMBSTONE_SECS: i64 = 10 * 60;

#[derive(Default)]
pub struct MeetingNotificationState(Mutex<MeetingNotificationStateInner>);

#[derive(Default)]
struct MeetingNotificationStateInner {
    pending: Option<Value>,
    dismissed_until: HashMap<String, i64>,
    acknowledged_until: HashMap<String, i64>,
}

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
    configure_overlay_behavior(&win);
    show_without_activation(&win);
    start_meeting_notification_hover_tracking(&app);
    Ok(())
}

#[tauri::command]
pub fn take_pending_meeting_notification(app: AppHandle) -> Result<Option<Value>, String> {
    let state = app.state::<MeetingNotificationState>();
    let mut state = state
        .0
        .lock()
        .map_err(|_| "meeting notification state lock poisoned".to_string())?;
    let now = chrono::Utc::now().timestamp();
    state.dismissed_until.retain(|_, until| *until > now);
    state.acknowledged_until.retain(|_, until| *until > now);
    if state.pending.as_ref().is_some_and(|payload| {
        state
            .dismissed_until
            .contains_key(&notification_key(payload))
    }) {
        state.pending = None;
    }
    if state.pending.as_ref().is_some_and(|payload| {
        payload
            .get("meetingId")
            .and_then(Value::as_str)
            .is_some_and(|id| state.acknowledged_until.contains_key(id))
    }) {
        state.pending = None;
    }
    Ok(state.pending.take())
}

fn notification_key(payload: &Value) -> String {
    format!(
        "{}|{}|{}",
        payload
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("calendar"),
        payload
            .get("meetingId")
            .and_then(Value::as_str)
            .unwrap_or_default(),
        payload
            .get("scheduledStart")
            .and_then(Value::as_str)
            .unwrap_or_default(),
    )
}

fn notification_key_from_parts(
    notification_type: &str,
    meeting_id: &str,
    scheduled_start: Option<&str>,
) -> String {
    format!(
        "{}|{}|{}",
        notification_type,
        meeting_id,
        scheduled_start.unwrap_or_default()
    )
}

pub fn watch_meeting_notification_acks(app: &AppHandle) {
    use tauri::Listener;

    let handle = app.clone();
    app.listen("meetings:hide-notification", move |event| {
        let Some(meeting_id) = serde_json::from_str::<Value>(event.payload())
            .ok()
            .as_ref()
            .and_then(|payload| payload.get("meetingId"))
            .and_then(Value::as_str)
            .map(str::to_string)
        else {
            return;
        };
        acknowledge_meeting_notification(&handle, &meeting_id);
    });
}

fn acknowledge_meeting_notification(app: &AppHandle, meeting_id: &str) {
    let Some(state) = app.try_state::<MeetingNotificationState>() else {
        return;
    };
    let Ok(mut state) = state.0.lock() else {
        return;
    };
    let now = chrono::Utc::now().timestamp();
    state.acknowledged_until.retain(|_, until| *until > now);
    state
        .acknowledged_until
        .insert(meeting_id.to_string(), now + ACK_TOMBSTONE_SECS);
    if clear_pending_notification(&mut state.pending, meeting_id) {
        dlog!(
            "[clips-tray] cleared pending meeting notification for {}",
            meeting_id
        );
    }
}

fn clear_pending_notification(pending: &mut Option<Value>, meeting_id: &str) -> bool {
    let matches = pending
        .as_ref()
        .and_then(|payload| payload.get("meetingId"))
        .and_then(Value::as_str)
        == Some(meeting_id);
    if matches {
        *pending = None;
    }
    matches
}

#[tauri::command]
pub fn dismiss_meeting_notification(
    app: AppHandle,
    meeting_id: String,
    notification_type: String,
    join_url: Option<String>,
    platform: Option<String>,
    scheduled_start: Option<String>,
    scheduled_end: Option<String>,
) -> Result<(), String> {
    let state = app.state::<MeetingNotificationState>();
    let mut state = state
        .0
        .lock()
        .map_err(|_| "meeting notification state lock poisoned".to_string())?;
    let now = chrono::Utc::now().timestamp();
    state.dismissed_until.retain(|_, until| *until > now);
    state.dismissed_until.insert(
        notification_key_from_parts(&notification_type, &meeting_id, scheduled_start.as_deref()),
        now + DISMISSAL_TOMBSTONE_SECS,
    );
    clear_pending_notification(&mut state.pending, &meeting_id);
    drop(state);

    let suppression_platform = platform.as_deref().or_else(|| {
        join_url.as_deref().and_then(|url| {
            let url = url.to_ascii_lowercase();
            if url.contains("zoom") {
                Some("zoom")
            } else if url.contains("teams.microsoft") || url.contains("teams") {
                Some("teams")
            } else {
                None
            }
        })
    });
    if let Some(platform) = suppression_platform {
        crate::adhoc_meetings_watcher::refresh_dismissal_suppression(&app, platform)?;
    }

    dlog!(
        "[clips-tray] meeting notification dismissed type={} id={} platform={:?} start={:?} end={:?}",
        notification_type,
        meeting_id,
        platform,
        scheduled_start,
        scheduled_end
    );
    Ok(())
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

    let payload = serde_json::json!({
        "type": kind,
        "title": title,
        "subtitle": body,
        "meetingId": meeting_id.clone(),
        "joinUrl": join_url,
        "platform": platform,
        "scheduledStart": scheduled_start,
        "scheduledEnd": scheduled_end,
        "autoStart": auto_start.unwrap_or(false),
    });
    let state = app.state::<MeetingNotificationState>();
    let should_show = {
        let mut state = state
            .0
            .lock()
            .map_err(|_| "meeting notification state lock poisoned".to_string())?;
        let now = chrono::Utc::now().timestamp();
        state.dismissed_until.retain(|_, until| *until > now);
        if state
            .dismissed_until
            .get(&notification_key(&payload))
            .copied()
            .unwrap_or_default()
            > now
        {
            false
        } else {
            state.pending = Some(payload.clone());
            true
        }
    };
    if !should_show {
        dlog!(
            "[clips-tray] skipped dismissed meeting notification id={}",
            meeting_id
        );
        return Ok(());
    }
    let _ = app.emit("meetings:show-notification", payload.clone());

    if let Err(err) = show_meeting_notification_window(&app) {
        eprintln!("[clips-tray] show meeting notification failed: {err}");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clears_only_the_matching_pending_notification() {
        let mut pending = Some(serde_json::json!({
            "meetingId": "meeting-1",
            "type": "adhoc"
        }));

        assert!(!clear_pending_notification(&mut pending, "meeting-2"));
        assert!(pending.is_some());
        assert!(clear_pending_notification(&mut pending, "meeting-1"));
        assert!(pending.is_none());
    }

    #[test]
    fn dismissal_key_changes_when_a_meeting_is_rescheduled() {
        let first = serde_json::json!({
            "type": "calendar",
            "meetingId": "meeting-1",
            "scheduledStart": "2026-07-23T17:00:00Z"
        });
        let moved = serde_json::json!({
            "type": "calendar",
            "meetingId": "meeting-1",
            "scheduledStart": "2026-07-23T18:00:00Z"
        });

        assert_ne!(notification_key(&first), notification_key(&moved));
    }
}
