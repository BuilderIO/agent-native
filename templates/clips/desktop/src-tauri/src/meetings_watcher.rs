//! Background poller for upcoming meetings.
//!
//! Runs as a tokio task spawned from `lib.rs::run` setup. Every 10s it calls
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
//!      fetch can authenticate. **Without this, the watcher has no
//!      credentials to send, skips its poll entirely, and silently never
//!      alerts on any meeting.** The renderer should re-push the session
//!      whenever it refreshes (e.g. after sign-in, after switching orgs, or
//!      on reconnect).
//!
//! On every successful poll the watcher emits `meetings:updated` with the
//! latest snapshot — `tray.rs` listens for this and rebuilds the tray menu
//! so the "Upcoming Meetings" submenu stays live.
//!
//! On 401 the watcher emits `meetings:auth-needed` so the renderer can
//! re-push a fresh cookie or surface a re-login prompt, then backs off
//! (`UnauthorizedRetry`) instead of retrying that same pair every tick — a
//! stuck install with a dead session would otherwise poll prod forever. A
//! renderer repush changes the credential pair, so it's retried on the very
//! next tick regardless of where the backoff is.

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
    /// The renderer's entitlement for the experimental meetings experience.
    /// Keep this off until a successful preference read enables it.
    lab_enabled: bool,
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

/// (session_cookie, auth_token) — the exact pair a poller sent on a request.
/// Comparing this pair (not just "did it fail") is what lets a renderer
/// repush be told apart from a repeat failure of the same stale session.
pub(crate) type SessionCredentials = (Option<String>, Option<String>);

/// Longest a poller waits before retrying the same failing credential pair,
/// so a stuck install still notices a silently-refreshed cookie eventually
/// instead of backing off forever.
const UNAUTHORIZED_RETRY_CAP: Duration = Duration::from_secs(5 * 60);

/// Tracks the last credential pair that got a 401 from a poller and when
/// that poller may next retry it. Shared by the meetings watcher (this
/// module) and the feature-flags watcher (`remote_flags.rs`), which both
/// authenticate with the same `(session_cookie, auth_token)` pair from
/// `MeetingsWatcherState::session_snapshot()`.
pub(crate) struct UnauthorizedRetry {
    credentials: SessionCredentials,
    backoff: Duration,
    next_attempt_at: std::time::Instant,
}

impl UnauthorizedRetry {
    /// Record a fresh 401 for `credentials`. Doubles `previous`'s backoff
    /// (capped) when it's the *same* pair failing again; a changed pair
    /// (renderer repush) always restarts at `base`.
    pub(crate) fn after(
        previous: Option<&UnauthorizedRetry>,
        credentials: SessionCredentials,
        base: Duration,
        now: std::time::Instant,
    ) -> Self {
        let backoff = match previous {
            Some(p) if p.credentials == credentials => (p.backoff * 2).min(UNAUTHORIZED_RETRY_CAP),
            _ => base,
        };
        Self {
            credentials,
            backoff,
            next_attempt_at: now + backoff,
        }
    }

    /// Whether a poller should skip its request for `credentials` this tick.
    pub(crate) fn should_skip(
        &self,
        credentials: &SessionCredentials,
        now: std::time::Instant,
    ) -> bool {
        &self.credentials == credentials && now < self.next_attempt_at
    }
}

/// Whether a poller should send its request this tick: `false` with no
/// credentials at all (a request would just 401), or while the same pair is
/// still backing off from an earlier 401. Both watchers gate on this single
/// function rather than inlining the two checks, so a regression that drops
/// the gate at a call site is a diff against a tested function, not a
/// silent inline deletion.
pub(crate) fn should_poll(
    retry: &Option<UnauthorizedRetry>,
    credentials: &SessionCredentials,
    now: std::time::Instant,
) -> bool {
    if *credentials == (None, None) {
        return false;
    }
    !retry
        .as_ref()
        .is_some_and(|r| r.should_skip(credentials, now))
}

impl MeetingsWatcherState {
    pub fn set_lab_enabled(&self, enabled: bool) -> Result<(), String> {
        let mut g = self.inner.lock().map_err(|e| e.to_string())?;
        g.lab_enabled = enabled;
        if !enabled {
            g.notified.clear();
            g.snoozed_until.clear();
            g.last_calendar_notify_at.clear();
        }
        Ok(())
    }

    pub fn lab_enabled(&self) -> Result<bool, String> {
        let g = self.inner.lock().map_err(|e| e.to_string())?;
        Ok(g.lab_enabled)
    }

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

#[tauri::command]
pub async fn meetings_watcher_set_lab_enabled(
    state: tauri::State<'_, MeetingsWatcherState>,
    enabled: bool,
) -> Result<(), String> {
    state.set_lab_enabled(enabled)
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub(crate) struct MeetingItem {
    pub(crate) id: String,
    pub(crate) title: Option<String>,
    #[serde(default, alias = "scheduledStart")]
    pub(crate) scheduled_start: Option<String>,
    #[serde(default, alias = "scheduledEnd")]
    pub(crate) scheduled_end: Option<String>,
    #[serde(default, alias = "joinUrl")]
    pub(crate) join_url: Option<String>,
    #[serde(default)]
    pub(crate) platform: Option<String>,
    #[serde(default)]
    pub(crate) source: Option<String>,
}

pub(crate) const CALENDAR_MATCH_WINDOW_MINUTES: i64 = 15;
const CALENDAR_MATCH_AMBIGUITY_MARGIN_SECS: i64 = 60;

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
/// clear the cookie, which makes the watcher skip its poll entirely (no
/// credentials to send) rather than hit the server and 401.
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

/// Base delay before retrying a newly-failing credential pair. Matches the
/// tick cadence — no point waiting longer than a tick before the first
/// retry attempt.
const MEETINGS_UNAUTHORIZED_RETRY_BASE: Duration = Duration::from_secs(10);

async fn run_watcher(app: AppHandle) {
    let mut interval = tokio::time::interval(Duration::from_secs(10));
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
    let mut unauthorized_retry: Option<UnauthorizedRetry> = None;
    loop {
        // The scheduled deadline, not wall-clock time: consecutive ticks are
        // exactly `period` apart this way, so a backoff computed from `now`
        // here (see `MEETINGS_UNAUTHORIZED_RETRY_BASE`) lines up with the
        // next tick's `now` instead of drifting by however long this tick's
        // work took to run.
        let now = interval.tick().await.into_std();
        if let Err(err) = tick_once(&app, &client, &mut unauthorized_retry, now).await {
            eprintln!("[clips-tray] meetings_watcher tick failed: {err}");
        }
    }
}

async fn tick_once(
    app: &AppHandle,
    client: &reqwest::Client,
    unauthorized_retry: &mut Option<UnauthorizedRetry>,
    now: std::time::Instant,
) -> Result<(), String> {
    let config = feature_config(app);
    if !config.meetings_enabled {
        return Ok(());
    }

    let state = app
        .try_state::<MeetingsWatcherState>()
        .ok_or_else(|| "no MeetingsWatcherState".to_string())?;
    if !state.lab_enabled()? {
        return Ok(());
    }

    let (server_url, cookie, auth_token) = {
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
    let credentials: SessionCredentials = (cookie.clone(), auth_token.clone());
    if !should_poll(unauthorized_retry, &credentials, now) {
        // No session pushed yet (or a genuine sign-out; a request would just
        // 401), or this exact pair is still backing off from an earlier 401.
        // Wait for the renderer's next push, or the backoff to elapse.
        return Ok(());
    }

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
        ("excludeDeclinedEvents", "true"),
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
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        // Tell the renderer to re-push a fresh cookie or surface a re-login
        // prompt, then back off this exact pair (see `UnauthorizedRetry`) —
        // a repush changes `credentials` and is retried next tick regardless.
        let _ = app.emit("meetings:auth-needed", serde_json::json!({}));
        *unauthorized_retry = Some(UnauthorizedRetry::after(
            unauthorized_retry.as_ref(),
            credentials,
            MEETINGS_UNAUTHORIZED_RETRY_BASE,
            now,
        ));
        return Err(format!(
            "list-meetings http {} — meetings:auth-needed emitted",
            status.as_u16()
        ));
    }
    if !status.is_success() {
        return Err(format!("list-meetings http {}", status));
    }
    *unauthorized_retry = None;
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
        if !is_calendar_reminder_candidate(&m) {
            continue;
        }
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
            let auto_start = config.meeting_transcription_mode == MeetingTranscriptionMode::Auto;
            // Awaited, not spawned. The stored payload has to exist before
            // auto-start is announced below: startup acknowledges itself with
            // `meetings:hide-notification`, and an acknowledgement that arrives
            // before the payload was stored clears nothing, leaving a spawned
            // task free to install a "Take notes?" card over a meeting that is
            // already recording. Ordering it here makes that impossible rather
            // than unlikely, and matches the ad-hoc path.
            if let Err(err) = crate::notifications::notify_meeting_starting(
                app.clone(),
                m.id.clone(),
                title.clone(),
                secs_until,
                join_url.clone(),
                m.scheduled_start.clone(),
                m.scheduled_end.clone(),
                m.platform.clone(),
                Some(auto_start),
                None,
            )
            .await
            {
                dlog!(
                    "[clips-tray] calendar notification failed for {}: {}",
                    m.id,
                    err
                );
            }
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

fn is_calendar_reminder_candidate(meeting: &MeetingItem) -> bool {
    meeting.source.as_deref() != Some("adhoc")
}

pub(crate) fn find_matching_calendar_meeting(
    meetings: &[MeetingItem],
    platform: &str,
    started_at: chrono::DateTime<chrono::Utc>,
) -> Option<MeetingItem> {
    let mut candidates: Vec<_> = meetings
        .iter()
        .filter_map(|meeting| {
            if !is_calendar_reminder_candidate(meeting)
                || meeting
                    .platform
                    .as_deref()
                    .is_none_or(|value| !value.eq_ignore_ascii_case(platform))
                || meeting.join_url.as_deref().is_none_or(str::is_empty)
            {
                return None;
            }
            let scheduled_start = meeting
                .scheduled_start
                .as_deref()
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())?
                .with_timezone(&chrono::Utc);
            let distance = (scheduled_start - started_at).num_seconds().abs();
            (distance <= CALENDAR_MATCH_WINDOW_MINUTES * 60).then(|| (distance, meeting))
        })
        .collect();
    candidates.sort_by_key(|(distance, _)| *distance);
    let Some((distance, meeting)) = candidates.first() else {
        return None;
    };
    if candidates.get(1).is_some_and(|(next_distance, _)| {
        next_distance - distance <= CALENDAR_MATCH_AMBIGUITY_MARGIN_SECS
    }) {
        return None;
    }
    Some((*meeting).clone())
}

/// `parse_meetings`, but able to say "this was not a meetings list at all".
///
/// `None` means no recognized list key and not a bare array — a changed
/// envelope, or a 200 carrying an error payload. A caller that is about to
/// *write* based on the answer needs that apart from `Some(vec![])`: an empty
/// list is a checked "no such meeting", while an unreadable body says nothing,
/// and treating the second as the first is how a duplicate row gets inserted.
pub(crate) fn try_parse_meetings(body: &serde_json::Value) -> Option<Vec<MeetingItem>> {
    let payload = body.get("result").unwrap_or(body);
    if let Ok(parsed) = serde_json::from_value::<ListMeetingsResponse>(payload.clone()) {
        if let Some(v) = parsed.upcoming {
            return Some(v);
        }
        if let Some(v) = parsed.meetings {
            return Some(v);
        }
        if let Some(v) = parsed.items {
            return Some(v);
        }
    }
    serde_json::from_value::<Vec<MeetingItem>>(payload.clone()).ok()
}

/// Read-only callers, where "no meetings" and "cannot tell" lead to the same
/// harmless outcome: nothing to remind about, nothing to enrich with.
pub(crate) fn parse_meetings(body: &serde_json::Value) -> Vec<MeetingItem> {
    try_parse_meetings(body).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use chrono::{TimeZone, Utc};

    use super::{
        find_matching_calendar_meeting, is_calendar_reminder_candidate, parse_meetings,
        should_poll, MeetingsWatcherState, UnauthorizedRetry,
    };

    #[test]
    fn should_poll_skips_with_no_credentials_at_all() {
        let now = Instant::now();
        assert!(!should_poll(&None, &(None, None), now));
    }

    #[test]
    fn should_poll_allows_a_fresh_pair_with_no_backoff_state() {
        let now = Instant::now();
        let creds = (Some("cookie".to_string()), None);
        assert!(should_poll(&None, &creds, now));
    }

    #[test]
    fn should_poll_skips_the_same_pair_during_backoff_and_allows_it_after() {
        let now = Instant::now();
        let creds = (Some("cookie".to_string()), None);
        let retry = Some(UnauthorizedRetry::after(
            None,
            creds.clone(),
            Duration::from_secs(10),
            now,
        ));

        assert!(!should_poll(&retry, &creds, now + Duration::from_secs(5)));
        assert!(should_poll(&retry, &creds, now + Duration::from_secs(10)));
    }

    #[test]
    fn should_poll_ignores_backoff_when_credentials_change() {
        let now = Instant::now();
        let stale = (Some("stale-cookie".to_string()), None);
        let fresh = (Some("fresh-cookie".to_string()), None);
        let retry = Some(UnauthorizedRetry::after(
            None,
            stale,
            Duration::from_secs(300),
            now,
        ));

        assert!(should_poll(&retry, &fresh, now));
    }

    #[test]
    fn unauthorized_retry_skips_the_same_pair_until_backoff_elapses() {
        let now = Instant::now();
        let creds = (Some("cookie".to_string()), None);
        let retry = UnauthorizedRetry::after(None, creds.clone(), Duration::from_secs(10), now);

        assert!(retry.should_skip(&creds, now));
        assert!(retry.should_skip(&creds, now + Duration::from_secs(9)));
        assert!(!retry.should_skip(&creds, now + Duration::from_secs(10)));
    }

    #[test]
    fn unauthorized_retry_ignores_backoff_when_credentials_change() {
        let now = Instant::now();
        let stale = (Some("stale-cookie".to_string()), None);
        let fresh = (Some("fresh-cookie".to_string()), None);
        let retry = UnauthorizedRetry::after(None, stale, Duration::from_secs(300), now);

        // A renderer repush produces a different pair — never skipped, no
        // matter where `now` falls relative to the stale pair's backoff.
        assert!(!retry.should_skip(&fresh, now));
    }

    #[test]
    fn unauthorized_retry_doubles_and_caps_at_five_minutes() {
        let now = Instant::now();
        let creds = (Some("cookie".to_string()), Some("token".to_string()));
        let base = Duration::from_secs(10);

        let mut retry = UnauthorizedRetry::after(None, creds.clone(), base, now);
        assert_eq!(retry.backoff, base);
        for _ in 0..10 {
            retry = UnauthorizedRetry::after(Some(&retry), creds.clone(), base, now);
        }
        assert_eq!(retry.backoff, Duration::from_secs(5 * 60));
    }

    #[test]
    fn meetings_lab_defaults_off_and_can_be_toggled() {
        let state = MeetingsWatcherState::default();

        assert!(!state.lab_enabled().expect("state lock"));
        state.set_lab_enabled(true).expect("state lock");
        assert!(state.lab_enabled().expect("state lock"));
        state.set_lab_enabled(false).expect("state lock");
        assert!(!state.lab_enabled().expect("state lock"));
    }

    #[test]
    fn excludes_adhoc_meetings_from_calendar_reminders() {
        let meetings = parse_meetings(&serde_json::json!({
            "meetings": [
                {
                    "id": "adhoc-meeting",
                    "scheduledStart": "2026-07-22T19:10:00Z",
                    "source": "adhoc"
                },
                {
                    "id": "calendar-meeting",
                    "scheduledStart": "2026-07-22T19:10:00Z",
                    "source": "calendar"
                }
            ]
        }));

        assert_eq!(meetings.len(), 2);
        assert!(!is_calendar_reminder_candidate(&meetings[0]));
        assert!(is_calendar_reminder_candidate(&meetings[1]));
    }

    #[test]
    fn keeps_meetings_without_source_eligible_for_legacy_payloads() {
        let meetings = parse_meetings(&serde_json::json!({
            "meetings": [
                {
                    "id": "legacy-meeting",
                    "scheduledStart": "2026-07-22T19:10:00Z"
                }
            ]
        }));

        assert_eq!(meetings.len(), 1);
        assert!(is_calendar_reminder_candidate(&meetings[0]));
    }

    #[test]
    fn finds_the_nearest_joinable_calendar_meeting_for_adhoc_detection() {
        let meetings = parse_meetings(&serde_json::json!({
            "result": {
                "meetings": [
                    {
                        "id": "too-far",
                        "title": "Later Zoom",
                        "scheduledStart": "2026-07-22T19:40:00Z",
                        "joinUrl": "https://zoom.us/j/2",
                        "platform": "zoom",
                        "source": "calendar"
                    },
                    {
                        "id": "nearest",
                        "title": "Product sync",
                        "scheduledStart": "2026-07-22T19:11:00Z",
                        "joinUrl": "https://zoom.us/j/1",
                        "platform": "zoom",
                        "source": "calendar"
                    },
                    {
                        "id": "adhoc",
                        "title": "Zoom meeting",
                        "scheduledStart": "2026-07-22T19:10:00Z",
                        "joinUrl": "https://zoom.us/j/3",
                        "platform": "zoom",
                        "source": "adhoc"
                    }
                ]
            }
        }));

        let started_at = Utc.with_ymd_and_hms(2026, 7, 22, 19, 10, 0).unwrap();
        let matched = find_matching_calendar_meeting(&meetings, "zoom", started_at);

        assert_eq!(
            matched.as_ref().map(|meeting| meeting.id.as_str()),
            Some("nearest")
        );
        assert_eq!(
            matched.and_then(|meeting| meeting.title),
            Some("Product sync".to_string())
        );
    }

    #[test]
    fn avoids_ambiguous_same_platform_calendar_matches() {
        let meetings = parse_meetings(&serde_json::json!({
            "meetings": [
                {
                    "id": "first",
                    "scheduledStart": "2026-07-22T19:09:00Z",
                    "joinUrl": "https://zoom.us/j/1",
                    "platform": "zoom",
                    "source": "calendar"
                },
                {
                    "id": "second",
                    "scheduledStart": "2026-07-22T19:11:00Z",
                    "joinUrl": "https://zoom.us/j/2",
                    "platform": "zoom",
                    "source": "calendar"
                }
            ]
        }));

        let started_at = Utc.with_ymd_and_hms(2026, 7, 22, 19, 10, 0).unwrap();
        assert!(find_matching_calendar_meeting(&meetings, "zoom", started_at).is_none());
    }
}
