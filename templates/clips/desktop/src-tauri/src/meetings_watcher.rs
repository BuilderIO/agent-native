//! Background poller for upcoming meetings.
//!
//! Runs as a tokio task spawned from `lib.rs::run` setup. Every 30s it calls
//! the backend's `list-meetings` action with `upcomingWithinMin=10`. For any
//! meeting starting in the next 5 minutes we haven't already alerted on, we
//! fire a native notification + the top-right banner overlay.
//!
//! The server URL is provided by the frontend (it lives in `localStorage`
//! under `clips:server-url`) — the popover calls
//! `meetings_watcher_set_server_url` on boot. Until that fires we just no-op
//! the polling loop.

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::dlog;

/// Shared state for the watcher loop. Lives behind a Mutex; the watcher task
/// reads it on every tick. The frontend pokes `set_server_url` to update.
#[derive(Default)]
pub struct MeetingsWatcherState {
    inner: Mutex<MeetingsWatcherInner>,
}

#[derive(Default)]
struct MeetingsWatcherInner {
    server_url: Option<String>,
    notified_meeting_ids: HashSet<String>,
}

#[derive(Debug, Deserialize)]
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
    dlog!("[clips-tray] meetings_watcher_set_server_url -> {}", trimmed);
    if let Ok(mut g) = state.inner.lock() {
        g.server_url = Some(trimmed);
    }
    Ok(())
}

/// Spawn the long-running watcher task. Idempotent in practice — if called
/// twice the second loop just runs in parallel; we gate on a static OnceLock
/// to keep things tidy.
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
    let server_url = {
        let state = app
            .try_state::<MeetingsWatcherState>()
            .ok_or_else(|| "no MeetingsWatcherState".to_string())?;
        let g = state.inner.lock().map_err(|e| e.to_string())?;
        g.server_url.clone()
    };
    let Some(server_url) = server_url else {
        return Ok(());
    };

    let url = format!(
        "{}/_agent-native/actions/list-meetings?upcomingWithinMin=10",
        server_url
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("fetch meetings: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("list-meetings http {}", resp.status()));
    }
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let meetings = parse_meetings(&body);

    let now = chrono::Utc::now();
    for m in meetings {
        let Some(start_str) = m.scheduled_start.as_deref() else {
            continue;
        };
        let Ok(start) = chrono::DateTime::parse_from_rfc3339(start_str) else {
            continue;
        };
        let secs_until = start.with_timezone(&chrono::Utc).signed_duration_since(now).num_seconds();
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
        // Fire the notification + banner overlay.
        let _ = app.emit(
            "meetings:show-notification",
            serde_json::json!({
                "type": "calendar",
                "title": title,
                "subtitle": format!("Starting in {} min", (secs_until / 60).max(1)),
                "meetingId": m.id,
            }),
        );
        // Delegate to notifications module for the OS banner.
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
    // Be liberal in what we accept — the action might return
    // `{ meetings: [...] }`, `{ items: [...] }`, `{ upcoming: [...] }`, or a
    // bare array.
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
