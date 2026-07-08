//! Granola-style adhoc Zoom / Teams detection.
//!
//! Polls the frontmost macOS app every few seconds. When Zoom or Teams stays
//! frontmost for a short dwell window, creates a meeting row via
//! `create-meeting` and shows the same meeting-notification overlay used for
//! calendar reminders — with `type: "adhoc"`.
//!
//! Reuses `MeetingsWatcherState` session (server URL + cookie + auth token)
//! so the popover only needs to push credentials once.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use crate::config::{feature_config, MeetingTranscriptionMode};
use crate::dlog;
use crate::meetings_watcher::MeetingsWatcherState;

/// How often to sample the frontmost app.
const POLL_SECS: u64 = 4;

/// Require this many consecutive frontmost seconds before firing.
const DWELL_SECS: u64 = 9;

/// After dismiss / fire, suppress re-prompts for this platform until the
/// cooldown elapses (or the VC app leaves front — see tick logic).
const COOLDOWN_SECS: i64 = 30 * 60;

/// Soft guard: skip adhoc if a calendar reminder for the same platform fired
/// this recently.
const CALENDAR_SOFT_GUARD_SECS: i64 = 3 * 60;

const STRONG_VC_BUNDLES: &[(&str, &str, &str)] = &[
    // (bundle_id, platform, display title)
    ("us.zoom.xos", "zoom", "Zoom meeting detected"),
    ("us.zoom.ZoomClips", "zoom", "Zoom meeting detected"),
    ("com.microsoft.teams2", "teams", "Teams meeting detected"),
    ("com.microsoft.teams", "teams", "Teams meeting detected"),
];

#[derive(Default)]
pub struct AdhocMeetingsWatcherState {
    inner: Mutex<AdhocMeetingsWatcherInner>,
}

#[derive(Default)]
struct AdhocMeetingsWatcherInner {
    /// platform -> unix-seconds when we last fired (or dismissed via cooldown).
    cooldown_until: HashMap<String, i64>,
    /// Current dwell: which platform is accumulating frontmost time.
    dwell_platform: Option<String>,
    dwell_since: Option<Instant>,
    /// Platforms already notified for the current continuous foreground session.
    session_notified: HashMap<String, bool>,
}

/// Spawn the long-running adhoc watcher. Idempotent — gated by OnceLock.
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
    let mut interval = tokio::time::interval(Duration::from_secs(POLL_SECS));
    // Skip the first tick — give the frontend time to push session creds.
    interval.tick().await;
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(err) => {
            eprintln!("[clips-tray] adhoc_meetings_watcher: reqwest build failed: {err}");
            return;
        }
    };
    loop {
        interval.tick().await;
        if let Err(err) = tick_once(&app, &client).await {
            eprintln!("[clips-tray] adhoc_meetings_watcher tick failed: {err}");
        }
    }
}

fn match_vc_bundle(bundle: &str) -> Option<(&'static str, &'static str)> {
    STRONG_VC_BUNDLES
        .iter()
        .find(|(id, _, _)| *id == bundle)
        .map(|(_, platform, title)| (*platform, *title))
}

async fn tick_once(app: &AppHandle, client: &reqwest::Client) -> Result<(), String> {
    let config = feature_config(app);
    if !config.meetings_enabled {
        reset_dwell(app);
        return Ok(());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, client);
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        tick_macos(app, client, &config).await
    }
}

#[cfg(target_os = "macos")]
async fn tick_macos(
    app: &AppHandle,
    client: &reqwest::Client,
    config: &crate::config::FeatureConfig,
) -> Result<(), String> {
    let front = crate::util::frontmost_bundle_id();
    let matched = front.as_deref().and_then(match_vc_bundle);

    let Some((platform, title)) = matched else {
        // VC app left front — clear session dedupe so a later re-focus can
        // fire again (cooldown still applies).
        clear_session_if_left(app, None);
        reset_dwell(app);
        return Ok(());
    };

    clear_session_if_left(app, Some(platform));

    // Skip while already transcribing a meeting.
    if crate::util::is_meeting_active(app) {
        reset_dwell(app);
        return Ok(());
    }

    if config.meeting_transcription_mode == MeetingTranscriptionMode::Manual
        && !config.show_meeting_widget_enabled
    {
        reset_dwell(app);
        return Ok(());
    }

    // Soft guard against double-prompting after a calendar reminder.
    if let Some(state) = app.try_state::<MeetingsWatcherState>() {
        if state.recent_calendar_notify(platform, CALENDAR_SOFT_GUARD_SECS) {
            dlog!(
                "[clips-tray] adhoc skip: recent calendar notify for {}",
                platform
            );
            reset_dwell(app);
            return Ok(());
        }
    }

    let now_ts = chrono::Utc::now().timestamp();
    let should_fire = {
        let state = app
            .try_state::<AdhocMeetingsWatcherState>()
            .ok_or_else(|| "no AdhocMeetingsWatcherState".to_string())?;
        let mut g = state.inner.lock().map_err(|e| e.to_string())?;

        // Prune expired cooldowns.
        g.cooldown_until.retain(|_, until| *until > now_ts);

        if g.cooldown_until.get(platform).copied().unwrap_or(0) > now_ts {
            return Ok(());
        }
        if g.session_notified.get(platform).copied().unwrap_or(false) {
            return Ok(());
        }

        match (g.dwell_platform.as_deref(), g.dwell_since) {
            (Some(p), Some(since)) if p == platform => {
                if since.elapsed() >= Duration::from_secs(DWELL_SECS) {
                    g.session_notified.insert(platform.to_string(), true);
                    g.cooldown_until
                        .insert(platform.to_string(), now_ts + COOLDOWN_SECS);
                    g.dwell_platform = None;
                    g.dwell_since = None;
                    true
                } else {
                    false
                }
            }
            _ => {
                g.dwell_platform = Some(platform.to_string());
                g.dwell_since = Some(Instant::now());
                false
            }
        }
    };

    if !should_fire {
        return Ok(());
    }

    dlog!(
        "[clips-tray] adhoc dwell met for {} — creating meeting",
        platform
    );

    let meeting_id = match create_adhoc_meeting(app, client, platform).await {
        Ok(id) => id,
        Err(err) => {
            // Allow retry on next dwell if create failed.
            if let Some(state) = app.try_state::<AdhocMeetingsWatcherState>() {
                if let Ok(mut g) = state.inner.lock() {
                    g.session_notified.remove(platform);
                    g.cooldown_until.remove(platform);
                }
            }
            return Err(err);
        }
    };

    let auto_start = config.meeting_transcription_mode == MeetingTranscriptionMode::Auto;
    let show_widget = config.show_meeting_widget_enabled
        || config.meeting_transcription_mode == MeetingTranscriptionMode::Ask
        || auto_start;

    if show_widget {
        let app_clone = app.clone();
        let id_clone = meeting_id.clone();
        let title_clone = title.to_string();
        let platform_clone = platform.to_string();
        let scheduled_start = chrono::Utc::now().to_rfc3339();
        tauri::async_runtime::spawn(async move {
            let _ = crate::notifications::notify_meeting_starting(
                app_clone,
                id_clone,
                title_clone,
                0,
                None,
                Some(scheduled_start),
                None,
                Some(platform_clone),
                Some(auto_start),
                Some("adhoc".to_string()),
            )
            .await;
        });
    }

    if auto_start {
        let _ = app.emit(
            "meetings:start-transcription",
            serde_json::json!({
                "meetingId": meeting_id,
                "joinUrl": null,
                "reason": "adhoc-auto",
            }),
        );
    }

    Ok(())
}

fn reset_dwell(app: &AppHandle) {
    if let Some(state) = app.try_state::<AdhocMeetingsWatcherState>() {
        if let Ok(mut g) = state.inner.lock() {
            g.dwell_platform = None;
            g.dwell_since = None;
        }
    }
}

/// When the frontmost VC platform changes (or clears), drop session_notified
/// for platforms that are no longer front. Keep `cooldown_until` so leaving
/// and re-focusing Zoom within the cooldown does not spam another popup.
fn clear_session_if_left(app: &AppHandle, current: Option<&str>) {
    if let Some(state) = app.try_state::<AdhocMeetingsWatcherState>() {
        if let Ok(mut g) = state.inner.lock() {
            g.session_notified
                .retain(|platform, _| current == Some(platform.as_str()));
        }
    }
}

async fn create_adhoc_meeting(
    app: &AppHandle,
    client: &reqwest::Client,
    platform: &str,
) -> Result<String, String> {
    let session = app
        .try_state::<MeetingsWatcherState>()
        .map(|s| s.session_snapshot())
        .unwrap_or_default();
    let Some(server_url) = session.server_url else {
        return Err("no server_url for create-meeting".to_string());
    };

    let url = format!("{}/_agent-native/actions/create-meeting", server_url);
    let row_title = if platform == "zoom" {
        "Zoom meeting"
    } else {
        "Teams meeting"
    };
    let body = serde_json::json!({
        "title": row_title,
        "platform": platform,
        "source": "adhoc",
        "scheduledStart": chrono::Utc::now().to_rfc3339(),
    });

    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("X-Request-Source", "clips-desktop")
        .json(&body);
    if let Some(c) = session.session_cookie.as_deref() {
        req = req.header("Cookie", c);
    }
    if let Some(token) = session.auth_token.as_deref() {
        req = req.bearer_auth(token);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("create-meeting fetch: {e}"))?;
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        let _ = app.emit("meetings:auth-needed", serde_json::json!({}));
        return Err("create-meeting http 401".to_string());
    }
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!(
            "create-meeting http {} — {}",
            status,
            text.chars().take(180).collect::<String>()
        ));
    }
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    extract_meeting_id(&body).ok_or_else(|| {
        format!(
            "create-meeting response missing meeting id: {}",
            body.to_string().chars().take(200).collect::<String>()
        )
    })
}

fn extract_meeting_id(body: &serde_json::Value) -> Option<String> {
    // Framework wraps action returns as `{ result: { meeting, created } }`.
    let meeting = body
        .get("result")
        .and_then(|r| r.get("meeting"))
        .or_else(|| body.get("meeting"))
        .or_else(|| body.get("result"));
    meeting
        .and_then(|m| m.get("id"))
        .and_then(|id| id.as_str())
        .map(|s| s.to_string())
}
