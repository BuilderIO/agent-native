//! Background poller for upcoming meetings.
//!
//! Runs as a tokio task spawned from `lib.rs::run` setup. Every 30s it calls
//! the backend's `list-meetings` action for the next handful of live Google
//! Calendar meetings. For any meeting in the Granola-style reminder window
//! (1 minute before start through 5 minutes after) that we haven't already
//! alerted on, we fire the in-app banner overlay.
//!
//! ## Wire-up (from the popover renderer)
//!
//! On boot, the popover calls:
//!
//!   1. `meetings_watcher_set_server_url(serverUrl)` — once it knows the
//!      backend origin (read from `localStorage["clips:server-url"]`).
//!   2. `meetings_watcher_set_session(cookieString)` — passes
//!      `document.cookie` plus the desktop bearer token so the Rust-side
//!      fetch can authenticate. **Without this, the watcher hits 401 in
//!      production and silently never alerts on any meeting.** The renderer
//!      should re-push the session whenever it refreshes (e.g. after sign-in,
//!      after switching orgs, or on reconnect).
//!
//! On every successful poll the watcher emits `meetings:updated` with the
//! latest snapshot — `tray.rs` listens for this and rebuilds the tray menu
//! so the "Upcoming Meetings" submenu stays live.
//!
//! On 401 the watcher emits `meetings:auth-needed` so the renderer can
//! re-push a fresh cookie or surface a re-login prompt.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::config::{feature_config, MeetingTranscriptionMode};
use crate::dlog;
use crate::tray_meetings::MeetingItem as TrayMeetingItem;

const MEETING_POLL_LIMIT: u8 = 10;

/// Show the reminder starting this many seconds before meeting start.
const NOTIFY_LEAD_SECS: i64 = 60;

/// Keep reminding eligible (until dismissed / acted on) this many seconds
/// after the scheduled start. Overlay auto-hide mirrors this hold window.
const NOTIFY_HOLD_AFTER_START_SECS: i64 = 5 * 60;

/// Forget de-dupe / snooze entries once a meeting's start is this far past, so
/// the maps don't grow unbounded across a long-running session.
const STALE_AFTER_SECS: i64 = 30 * 60;

/// Seconds until the given RFC3339 instant (negative = past). Unparseable
/// strings sort as far-past so they get pruned.
fn parse_secs_until(rfc3339: &str, now: chrono::DateTime<chrono::Utc>) -> i64 {
    chrono::DateTime::parse_from_rfc3339(rfc3339)
        .map(|s| {
            s.with_timezone(&chrono::Utc)
                .signed_duration_since(now)
                .num_seconds()
        })
        .unwrap_or(i64::MIN)
}

/// Shared state for the watcher loop. Lives behind a Mutex; the watcher task
/// reads it on every tick. The frontend pokes `set_server_url` /
/// `set_session` to update.
#[derive(Default)]
pub struct MeetingsWatcherState {
    inner: Mutex<MeetingsWatcherInner>,
}

#[derive(Default)]
struct MeetingsWatcherInner {
    server_url: Option<String>,
    /// Raw `document.cookie` string forwarded from the renderer.
    session_cookie: Option<String>,
    /// Legacy framework session token persisted by the desktop renderer.
    auth_token: Option<String>,
    /// meetingId -> the scheduledStart we last alerted for. Keyed by start time
    /// so a rescheduled meeting (same id, new time) re-notifies instead of
    /// being suppressed forever; pruned once the start is well in the past.
    notified: HashMap<String, String>,
    /// meetingId -> unix-seconds deadline. While now < deadline the meeting is
    /// skipped; once it passes we re-fire the reminder exactly once.
    snoozed_until: HashMap<String, i64>,
    /// platform -> unix-seconds when a calendar reminder last fired. Soft
    /// guard so adhoc Zoom/Teams detection doesn't double-prompt right after
    /// a calendar banner for the same app.
    last_calendar_notify_at: HashMap<String, i64>,
}

/// Snapshot of auth fields the adhoc watcher needs to POST create-meeting.
#[derive(Clone, Default)]
pub struct MeetingsSessionSnapshot {
    pub server_url: Option<String>,
    pub session_cookie: Option<String>,
    pub auth_token: Option<String>,
}

impl MeetingsWatcherState {
    pub fn session_snapshot(&self) -> MeetingsSessionSnapshot {
        let Ok(g) = self.inner.lock() else {
            return MeetingsSessionSnapshot::default();
        };
        MeetingsSessionSnapshot {
            server_url: g.server_url.clone(),
            session_cookie: g.session_cookie.clone(),
            auth_token: g.auth_token.clone(),
        }
    }

    pub fn note_calendar_notify(&self, platform: Option<&str>) {
        let Some(platform) = platform.map(str::trim).filter(|p| !p.is_empty()) else {
            return;
        };
        if let Ok(mut g) = self.inner.lock() {
            g.last_calendar_notify_at
                .insert(platform.to_lowercase(), chrono::Utc::now().timestamp());
        }
    }

    /// True if a calendar reminder for `platform` fired within `within_secs`.
    pub fn recent_calendar_notify(&self, platform: &str, within_secs: i64) -> bool {
        let Ok(g) = self.inner.lock() else {
            return false;
        };
        let key = platform.to_lowercase();
        let Some(at) = g.last_calendar_notify_at.get(&key).copied() else {
            return false;
        };
        chrono::Utc::now().timestamp() - at <= within_secs
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct MeetingItem {
    id: String,
    title: Option<String>,
    #[serde(default, alias = "scheduledStart")]
    scheduled_start: Option<String>,
    #[serde(default, alias = "scheduledEnd")]
    scheduled_end: Option<String>,
    #[serde(default, alias = "joinUrl")]
    join_url: Option<String>,
    #[serde(default)]
    platform: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ListMeetingsResponse {
    #[serde(default)]
    meetings: Option<Vec<MeetingItem>>,
    #[serde(default)]
    items: Option<Vec<MeetingItem>>,
    #[serde(default, rename = "upcoming")]
    upcoming: Option<Vec<MeetingItem>>,
}

#[tauri::command]
pub async fn meetings_watcher_set_server_url(
    state: tauri::State<'_, MeetingsWatcherState>,
    server_url: String,
) -> Result<(), String> {
    let trimmed = server_url.trim_end_matches('/').to_string();
    dlog!(
        "[clips-tray] meetings_watcher_set_server_url -> {}",
        trimmed
    );
    if let Ok(mut g) = state.inner.lock() {
        g.server_url = Some(trimmed);
    }
    Ok(())
}

/// Forward the renderer's `document.cookie` to the Rust fetch loop. Called
/// from the popover on boot and after any sign-in change. Empty strings
/// clear the cookie (forces 401 → `meetings:auth-needed` → renderer
/// re-pushes).
#[tauri::command]
pub async fn meetings_watcher_set_session(
    state: tauri::State<'_, MeetingsWatcherState>,
    cookie: String,
    auth_token: Option<String>,
) -> Result<(), String> {
    let trimmed = cookie.trim().to_string();
    let trimmed_token = auth_token.unwrap_or_default().trim().to_string();
    dlog!(
        "[clips-tray] meetings_watcher_set_session -> {} cookie bytes, token={}",
        trimmed.len(),
        if trimmed_token.is_empty() {
            "no"
        } else {
            "yes"
        }
    );
    if let Ok(mut g) = state.inner.lock() {
        g.session_cookie = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        };
        g.auth_token = if trimmed_token.is_empty() {
            None
        } else {
            Some(trimmed_token)
        };
    }
    Ok(())
}

/// Snooze an upcoming-meeting reminder for `minutes` (default 5). Recorded in
/// the watcher so the next tick skips the meeting until the deadline, then
/// re-fires once. The renderer just invokes this and closes the banner — a
/// `setTimeout` inside the overlay webview would die when the window closes.
#[tauri::command]
pub async fn meetings_snooze(
    state: tauri::State<'_, MeetingsWatcherState>,
    meeting_id: String,
    minutes: Option<i64>,
) -> Result<(), String> {
    let mins = minutes.unwrap_or(5).clamp(1, 120);
    let until = chrono::Utc::now().timestamp() + mins * 60;
    if let Ok(mut g) = state.inner.lock() {
        g.snoozed_until.insert(meeting_id.clone(), until);
        // Clear the de-dupe entry so it can alert again after the snooze.
        g.notified.remove(&meeting_id);
    }
    Ok(())
}

/// Spawn the long-running watcher task. Idempotent in practice — gated on
/// a static OnceLock so a double-call from setup is safe.
pub fn spawn_watcher(app: AppHandle) {
    use std::sync::OnceLock;
    static STARTED: OnceLock<()> = OnceLock::new();
    if STARTED.set(()).is_err() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        run_watcher(app).await;
    });
}

async fn run_watcher(app: AppHandle) {
    let mut interval = tokio::time::interval(Duration::from_secs(30));
    // Skip the first tick — gives the frontend time to push us a server URL.
    interval.tick().await;
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(err) => {
            eprintln!("[clips-tray] meetings_watcher: reqwest build failed: {err}");
            return;
        }
    };
    loop {
        interval.tick().await;
        if let Err(err) = tick_once(&app, &client).await {
            eprintln!("[clips-tray] meetings_watcher tick failed: {err}");
        }
    }
}

async fn tick_once(app: &AppHandle, client: &reqwest::Client) -> Result<(), String> {
    let config = feature_config(app);
    if !config.meetings_enabled {
        return Ok(());
    }

    let (server_url, cookie, auth_token) = {
        let state = app
            .try_state::<MeetingsWatcherState>()
            .ok_or_else(|| "no MeetingsWatcherState".to_string())?;
        let g = state.inner.lock().map_err(|e| e.to_string())?;
        (
            g.server_url.clone(),
            g.session_cookie.clone(),
            g.auth_token.clone(),
        )
    };
    let Some(server_url) = server_url else {
        return Ok(());
    };

    let url = format!("{}/_agent-native/actions/list-meetings", server_url);
    let limit = MEETING_POLL_LIMIT.to_string();
    // Include meetings that started within the hold window so a late-open
    // desktop still surfaces the reminder until 5 minutes after start.
    let within_min = ((NOTIFY_LEAD_SECS + NOTIFY_HOLD_AFTER_START_SECS) / 60 + 1).to_string();
    let mut req = client.get(&url).query(&[
        ("view", "upcoming"),
        ("limit", limit.as_str()),
        ("upcomingWithinMin", within_min.as_str()),
        // list-meetings also uses this for the lower bound when we widen the
        // upcoming window to include recently-started events (see action).
        ("includeStartedWithinMin", "5"),
        ("excludePersonalSoloEvents", "true"),
    ]);
    req = req.header("X-Request-Source", "clips-desktop");
    if let Some(c) = cookie.as_deref() {
        req = req.header("Cookie", c);
    }
    if let Some(token) = auth_token.as_deref() {
        req = req.bearer_auth(token);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("fetch meetings: {e}"))?;
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        // Tell the renderer to re-push a fresh cookie or surface a
        // re-login prompt. We keep silently retrying every 30s — once
        // the renderer pushes a new cookie via
        // `meetings_watcher_set_session` we'll succeed on the next tick.
        let _ = app.emit("meetings:auth-needed", serde_json::json!({}));
        return Err("list-meetings http 401 — meetings:auth-needed emitted".to_string());
    }
    if !status.is_success() {
        return Err(format!("list-meetings http {}", status));
    }
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let meetings = parse_meetings(&body);

    // Push the snapshot to listeners (tray.rs uses this to rebuild its
    // menu so the "Upcoming Meetings" submenu stays current).
    let snapshot: Vec<TrayMeetingItem> = meetings
        .iter()
        .take(3)
        .map(|m| TrayMeetingItem {
            id: m.id.clone(),
            title: m.title.clone().unwrap_or_else(|| "Meeting".to_string()),
            when_label: m.scheduled_start.clone(),
        })
        .collect();
    let _ = app.emit(
        "meetings:updated",
        serde_json::json!({ "meetings": snapshot }),
    );

    let now = chrono::Utc::now();
    let now_ts = now.timestamp();
    for m in meetings {
        let Some(start_str) = m.scheduled_start.as_deref() else {
            continue;
        };
        if chrono::DateTime::parse_from_rfc3339(start_str).is_err() {
            continue;
        }
        let current_start = start_str.to_string();
        let secs_until = parse_secs_until(start_str, now);

        // Decide whether to alert, under a single lock: honor snooze, prune
        // stale entries, and de-dupe on (meetingId, scheduledStart) so a moved
        // meeting re-notifies instead of being suppressed forever.
        let should_notify = {
            let state = app.state::<MeetingsWatcherState>();
            let mut g = state.inner.lock().map_err(|e| e.to_string())?;

            g.notified
                .retain(|_, s| parse_secs_until(s, now) > -STALE_AFTER_SECS);
            g.snoozed_until
                .retain(|_, until| *until > now_ts - STALE_AFTER_SECS);

            // Eligible from 1 min before start through 5 min after start.
            // secs_until > 0 => still upcoming; negative => already started.
            let in_window =
                secs_until <= NOTIFY_LEAD_SECS && secs_until >= -NOTIFY_HOLD_AFTER_START_SECS;

            let eligible = match g.snoozed_until.get(&m.id).copied() {
                Some(until) if now_ts < until => false, // still snoozed
                Some(_) => {
                    // Snooze elapsed — re-fire if still inside the hold window.
                    g.snoozed_until.remove(&m.id);
                    in_window
                }
                None => in_window,
            };

            if !eligible {
                false
            } else if g.notified.get(&m.id).map(String::as_str) == Some(current_start.as_str()) {
                false // already alerted for this exact start time
            } else {
                g.notified.insert(m.id.clone(), current_start.clone());
                true
            }
        };
        if !should_notify {
            continue;
        }
        if config.meeting_transcription_mode == MeetingTranscriptionMode::Manual
            && !config.show_meeting_widget_enabled
        {
            continue;
        }
        let title = m.title.clone().unwrap_or_else(|| "Meeting".to_string());
        let join_url = m.join_url.clone();
        if config.show_meeting_widget_enabled
            || config.meeting_transcription_mode == MeetingTranscriptionMode::Auto
        {
            if let Some(state) = app.try_state::<MeetingsWatcherState>() {
                state.note_calendar_notify(m.platform.as_deref());
            }
            let app_clone = app.clone();
            let id_clone = m.id.clone();
            let title_clone = title.clone();
            let join_clone = join_url.clone();
            let start_clone = m.scheduled_start.clone();
            let end_clone = m.scheduled_end.clone();
            let platform_clone = m.platform.clone();
            let auto_start = config.meeting_transcription_mode == MeetingTranscriptionMode::Auto;
            tauri::async_runtime::spawn(async move {
                let _ = crate::notifications::notify_meeting_starting(
                    app_clone,
                    id_clone,
                    title_clone,
                    secs_until,
                    join_clone,
                    start_clone,
                    end_clone,
                    platform_clone,
                    Some(auto_start),
                    None,
                )
                .await;
            });
        }
        if config.meeting_transcription_mode == MeetingTranscriptionMode::Auto {
            let _ = app.emit(
                "meetings:start-transcription",
                serde_json::json!({
                    "meetingId": m.id.clone(),
                    "joinUrl": join_url.clone(),
                    "reason": "calendar-auto",
                }),
            );
        }
    }

    Ok(())
}

fn parse_meetings(body: &serde_json::Value) -> Vec<MeetingItem> {
    if let Ok(parsed) = serde_json::from_value::<ListMeetingsResponse>(body.clone()) {
        if let Some(v) = parsed.upcoming {
            return v;
        }
        if let Some(v) = parsed.meetings {
            return v;
        }
        if let Some(v) = parsed.items {
            return v;
        }
    }
    if let Ok(arr) = serde_json::from_value::<Vec<MeetingItem>>(body.clone()) {
        return arr;
    }
    Vec::new()
}
