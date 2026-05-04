//! Background poller for upcoming meetings.
//!
//! Runs as a tokio task spawned from `lib.rs::run` setup. Every 30s it calls
//! the backend's `list-meetings` action with `upcomingWithinMin=10`. For any
//! meeting starting in the next 5 minutes we haven't already alerted on, we
//! fire a native notification + the in-app banner overlay.
//!
//! ## Wire-up (from the popover renderer)
//!
//! On boot, the popover calls:
//!
//!   1. `meetings_watcher_set_server_url(serverUrl)` — once it knows the
//!      backend origin (read from `localStorage["clips:server-url"]`).
//!   2. `meetings_watcher_set_session(cookieString)` — passes
//!      `document.cookie` so the Rust-side fetch can attach the Better Auth
//!      session cookie. **Without this, the watcher hits 401 in production
//!      and silently never alerts on any meeting.** The renderer should
//!      re-push the cookie whenever it refreshes (e.g. after sign-in,
//!      after switching orgs, or on reconnect).
//!
//! On every successful poll the watcher emits `meetings:updated` with the
//! latest snapshot — `tray.rs` listens for this and rebuilds the tray menu
//! so the "Upcoming Meetings" submenu stays live.
//!
//! On 401 the watcher emits `meetings:auth-needed` so the renderer can
//! re-push a fresh cookie or surface a re-login prompt.

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::dlog;
use crate::tray_meetings::MeetingItem as TrayMeetingItem;

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
    notified_meeting_ids: HashSet<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct MeetingItem {
    id: String,
    title: Option<String>,
    #[serde(default, alias = "scheduledStart")]
    scheduled_start: Option<String>,
    #[serde(default, alias = "joinUrl")]
    join_url: Option<String>,
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
) -> Result<(), String> {
    let trimmed = cookie.trim().to_string();
    dlog!(
        "[clips-tray] meetings_watcher_set_session -> {} bytes",
        trimmed.len()
    );
    if let Ok(mut g) = state.inner.lock() {
        g.session_cookie = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        };
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
    let (server_url, cookie) = {
        let state = app
            .try_state::<MeetingsWatcherState>()
            .ok_or_else(|| "no MeetingsWatcherState".to_string())?;
        let g = state.inner.lock().map_err(|e| e.to_string())?;
        (g.server_url.clone(), g.session_cookie.clone())
    };
    let Some(server_url) = server_url else {
        return Ok(());
    };

    let url = format!(
        "{}/_agent-native/actions/list-meetings?upcomingWithinMin=10",
        server_url
    );
    let mut req = client.get(&url);
    if let Some(c) = cookie.as_deref() {
        req = req.header("Cookie", c);
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
    for m in meetings {
        let Some(start_str) = m.scheduled_start.as_deref() else {
            continue;
        };
        let Ok(start) = chrono::DateTime::parse_from_rfc3339(start_str) else {
            continue;
        };
        let secs_until = start
            .with_timezone(&chrono::Utc)
            .signed_duration_since(now)
            .num_seconds();
        if !(0..=300).contains(&secs_until) {
            continue;
        }
        // Have we already alerted on this meeting?
        let already = {
            let state = app.state::<MeetingsWatcherState>();
            let mut g = state.inner.lock().map_err(|e| e.to_string())?;
            !g.notified_meeting_ids.insert(m.id.clone())
        };
        if already {
            continue;
        }
        let title = m.title.clone().unwrap_or_else(|| "Meeting".to_string());
        let join_url = m.join_url.clone();
        let _ = app.emit(
            "meetings:show-notification",
            serde_json::json!({
                "type": "calendar",
                "title": title,
                "subtitle": format!("Starting in {} min", (secs_until / 60).max(1)),
                "meetingId": m.id,
                "joinUrl": join_url,
            }),
        );
        let app_clone = app.clone();
        let id_clone = m.id.clone();
        let title_clone = title.clone();
        let join_clone = join_url.clone();
        tauri::async_runtime::spawn(async move {
            let _ = crate::notifications::notify_meeting_starting(
                app_clone,
                id_clone,
                title_clone,
                secs_until,
                join_clone,
            )
            .await;
        });
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
