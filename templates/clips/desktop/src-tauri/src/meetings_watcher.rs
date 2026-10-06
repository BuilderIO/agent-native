//! Background poller for upcoming meetings.
//!
//! Runs as a tokio task spawned from `lib.rs::run` setup. Every 5 minutes it
//! calls the backend's `list-meetings` action for the live Google Calendar
//! meetings in the next hour and caches them. A separate 1s local check fires
//! the in-app banner overlay for any cached meeting in the Granola-style
//! reminder window (1 minute before start through 5 minutes after) that we
//! haven't already alerted on, so alert timing never waits on the network.
//!
//! The cache is refreshed early when the lab or meetings setting turns on, the
//! session or server changes, or the popover opens with a stale cache; a failed
//! fetch retries after `FETCH_RETRY_SECS`. Fetches are scheduled in wall-clock
//! time, so one that came due while the Mac slept runs on the first tick after
//! wake. Each fetch also schedules the next one no later than
//! `PRE_ALERT_REFRESH_SECS` before the earliest cached start, so a last-minute
//! move or cancellation lands before the banner fires.
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
//! (`UnauthorizedRetry`) instead of retrying that same pair every tick, and
//! after `UNAUTHORIZED_PAUSE_AFTER` rejections in a row stops polling that
//! pair entirely — a stuck install with a dead session would otherwise poll
//! prod forever. A renderer repush that changes the credential pair (sign-in)
//! is retried on the very next tick, and `meetings_watcher_resume_polling`
//! (the popover opening with a live session) clears every pause.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::config::{feature_config, MeetingTranscriptionMode};
use crate::dlog;
use crate::tray_meetings::MeetingItem as TrayMeetingItem;

const MEETING_POLL_LIMIT: u8 = 10;

const FETCH_HORIZON_MIN: i64 = 60;

const FETCH_INTERVAL_SECS: i64 = 5 * 60;

const FETCH_RETRY_SECS: i64 = 30;

/// Opening the popover refetches only a cache older than this, so flipping the
/// popover open and closed doesn't turn into a request per open.
const RESUME_REFRESH_MIN_AGE_SECS: i64 = 60;

/// How long before a cached meeting starts the watcher refetches it. Must stay
/// above `NOTIFY_LEAD_SECS` with room for the 10s request timeout, or the
/// refreshed list arrives after the banner already fired.
const PRE_ALERT_REFRESH_SECS: i64 = 2 * 60;

/// A fetch this close to a meeting's pre-alert point already reflects
/// last-minute changes, so no separate pre-alert fetch is scheduled.
const PRE_ALERT_FRESH_SECS: i64 = 30;

const ALERT_CHECK_INTERVAL: Duration = Duration::from_secs(1);

/// A scheduled fetch this far past due means the Mac slept through it, so the
/// cache may predate moves or cancellations and the tick fetches before it
/// alerts.
const OVERDUE_FETCH_SECS: i64 = 30;

const NOTIFY_LEAD_SECS: i64 = 60;

const NOTIFY_HOLD_AFTER_START_SECS: i64 = 5 * 60;

const STALE_AFTER_SECS: i64 = 30 * 60;

fn parse_secs_until(rfc3339: &str, now: chrono::DateTime<chrono::Utc>) -> i64 {
    chrono::DateTime::parse_from_rfc3339(rfc3339)
        .map(|s| {
            s.with_timezone(&chrono::Utc)
                .signed_duration_since(now)
                .num_seconds()
        })
        .unwrap_or(i64::MIN)
}

#[derive(Default)]
pub struct MeetingsWatcherState {
    inner: Mutex<MeetingsWatcherInner>,
}

#[derive(Default)]
struct MeetingsWatcherInner {
    server_url: Option<String>,
    session_cookie: Option<String>,
    auth_token: Option<String>,
    lab_enabled: bool,
    notified: HashMap<String, String>,
    snoozed_until: HashMap<String, i64>,
    last_calendar_notify_at: HashMap<String, i64>,
    unauthorized: HashMap<Poller, UnauthorizedRetry>,
    cached_meetings: Vec<MeetingItem>,
    /// Wall-clock unix seconds; `None` means fetch on the next tick.
    next_fetch_at: Option<i64>,
    last_fetch_ok_at: Option<i64>,
    /// Bumped by `invalidate_cache` so a fetch that was in flight when the
    /// session, server, or lab changed can't store another identity's result.
    fetch_generation: u64,
    /// Set by `invalidate_cache` so the next tick empties the tray menu, which
    /// otherwise keeps the previous identity's meetings until a fetch succeeds.
    tray_needs_clear: bool,
}

impl MeetingsWatcherInner {
    fn request_refresh(&mut self) {
        self.next_fetch_at = None;
    }

    fn invalidate_cache(&mut self) {
        self.cached_meetings.clear();
        self.last_fetch_ok_at = None;
        self.fetch_generation += 1;
        self.tray_needs_clear = true;
        self.request_refresh();
    }
}

#[derive(Clone, Default)]
pub struct MeetingsSessionSnapshot {
    pub server_url: Option<String>,
    pub session_cookie: Option<String>,
    pub auth_token: Option<String>,
}

pub(crate) type SessionCredentials = (Option<String>, Option<String>);

const UNAUTHORIZED_RETRY_CAP: Duration = Duration::from_secs(5 * 60);

/// More than one, so a single 401 during a deploy can't stop polling until
/// the user happens to sign in again.
const UNAUTHORIZED_PAUSE_AFTER: u32 = 3;

/// Every background caller that authenticates with the session this state
/// holds. Each gets its own rejection budget so one poller's pause never
/// hides another's first attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Poller {
    Meetings,
    FeatureFlags,
    AdhocMeetings,
}

pub(crate) struct UnauthorizedRetry {
    credentials: SessionCredentials,
    backoff: Duration,
    next_attempt_at: std::time::Instant,
    rejections: u32,
}

impl UnauthorizedRetry {
    pub(crate) fn after(
        previous: Option<&UnauthorizedRetry>,
        credentials: SessionCredentials,
        base: Duration,
        now: std::time::Instant,
    ) -> Self {
        let (backoff, rejections) = match previous {
            Some(p) if p.credentials == credentials => (
                (p.backoff * 2).min(UNAUTHORIZED_RETRY_CAP),
                p.rejections + 1,
            ),
            _ => (base, 1),
        };
        Self {
            credentials,
            backoff,
            next_attempt_at: now + backoff,
            rejections,
        }
    }

    pub(crate) fn is_paused(&self) -> bool {
        self.rejections >= UNAUTHORIZED_PAUSE_AFTER
    }

    pub(crate) fn should_skip(
        &self,
        credentials: &SessionCredentials,
        now: std::time::Instant,
    ) -> bool {
        &self.credentials == credentials && (self.is_paused() || now < self.next_attempt_at)
    }
}

pub(crate) fn should_poll(
    retry: Option<&UnauthorizedRetry>,
    credentials: &SessionCredentials,
    now: std::time::Instant,
) -> bool {
    if *credentials == (None, None) {
        return false;
    }
    !retry.is_some_and(|r| r.should_skip(credentials, now))
}

impl MeetingsWatcherState {
    pub fn set_lab_enabled(&self, enabled: bool) -> Result<(), String> {
        let mut g = self.inner.lock().map_err(|e| e.to_string())?;
        if g.lab_enabled == enabled {
            return Ok(());
        }
        g.lab_enabled = enabled;
        if !enabled {
            g.notified.clear();
            g.snoozed_until.clear();
            g.last_calendar_notify_at.clear();
        }
        g.invalidate_cache();
        Ok(())
    }

    pub fn invalidate_cache(&self) {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.invalidate_cache();
    }

    fn fetch_overdue(&self, now_ts: i64) -> bool {
        let g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.next_fetch_at
            .is_some_and(|at| now_ts - at > OVERDUE_FETCH_SECS)
    }

    fn fetch_due(&self, now_ts: i64) -> Option<u64> {
        let g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.next_fetch_at
            .is_none_or(|at| now_ts >= at)
            .then_some(g.fetch_generation)
    }

    /// Stores a fetch result and schedules the next fetch. Returns the tray
    /// snapshot to emit, or `None` when nothing new was cached (including a
    /// result dropped because the cache was invalidated while it was in flight).
    fn finish_fetch(
        &self,
        generation: u64,
        now_ts: i64,
        outcome: Result<FetchOutcome, ()>,
    ) -> Option<Vec<TrayMeetingItem>> {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if g.fetch_generation != generation {
            return None;
        }
        match outcome {
            Ok(FetchOutcome::NotReady) => None,
            Ok(FetchOutcome::Disabled) => {
                g.cached_meetings.clear();
                g.next_fetch_at = Some(now_ts + FETCH_INTERVAL_SECS);
                None
            }
            Ok(FetchOutcome::Fetched(meetings)) => {
                let pre_alert_at = meetings
                    .iter()
                    .filter(|m| is_calendar_reminder_candidate(m))
                    .filter_map(|m| m.scheduled_start.as_deref())
                    .filter_map(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|start| start.timestamp() - PRE_ALERT_REFRESH_SECS)
                    .filter(|at| *at > now_ts + PRE_ALERT_FRESH_SECS)
                    .min();
                let next = now_ts + FETCH_INTERVAL_SECS;
                g.next_fetch_at = Some(pre_alert_at.map_or(next, |at| at.min(next)));
                g.last_fetch_ok_at = Some(now_ts);
                g.cached_meetings = meetings;
                Some(tray_snapshot(&g.cached_meetings))
            }
            Err(()) => {
                g.next_fetch_at = Some(now_ts + FETCH_RETRY_SECS);
                None
            }
        }
    }

    fn take_tray_clear(&self) -> bool {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        std::mem::take(&mut g.tray_needs_clear)
    }

    /// Returns the cached meetings whose banner is due now, with their seconds
    /// until start. Callers mark them with `mark_notified` only once they know
    /// the banner will be delivered, so a skipped one stays due.
    fn due_alerts(&self, now: chrono::DateTime<chrono::Utc>) -> DueAlerts {
        let now_ts = now.timestamp();
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let inner = &mut *g;
        inner
            .notified
            .retain(|_, s| parse_secs_until(s, now) > -STALE_AFTER_SECS);
        inner
            .snoozed_until
            .retain(|_, until| *until > now_ts - STALE_AFTER_SECS);

        let mut due = Vec::new();
        for m in &inner.cached_meetings {
            if !is_calendar_reminder_candidate(m) {
                continue;
            }
            let Some(start) = m.scheduled_start.as_deref() else {
                continue;
            };
            let secs_until = parse_secs_until(start, now);
            let in_window =
                secs_until <= NOTIFY_LEAD_SECS && secs_until >= -NOTIFY_HOLD_AFTER_START_SECS;

            let eligible = match inner.snoozed_until.get(&m.id).copied() {
                Some(until) if now_ts < until => false, // still snoozed
                Some(_) => {
                    inner.snoozed_until.remove(&m.id);
                    in_window
                }
                None => in_window,
            };
            // already alerted for this exact start time
            if !eligible || inner.notified.get(&m.id).map(String::as_str) == Some(start) {
                continue;
            }
            due.push((m.clone(), secs_until));
        }
        DueAlerts {
            generation: inner.fetch_generation,
            alerts: due,
        }
    }

    /// Marks the alerts about to be delivered and returns them. Drops all of
    /// them if the cache was invalidated after `due_alerts` ran, so a previous
    /// account's meeting never alerts, and drops any the user snoozed since, so
    /// the snooze isn't overwritten.
    fn mark_notified(&self, due: DueAlerts, now_ts: i64) -> Vec<(MeetingItem, i64)> {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if g.fetch_generation != due.generation {
            return Vec::new();
        }
        let mut delivered = Vec::with_capacity(due.alerts.len());
        for (m, secs_until) in due.alerts {
            if g.snoozed_until
                .get(&m.id)
                .is_some_and(|until| now_ts < *until)
            {
                continue;
            }
            if let Some(start) = m.scheduled_start.clone() {
                g.notified.insert(m.id.clone(), start);
            }
            delivered.push((m, secs_until));
        }
        delivered
    }

    pub(crate) fn should_poll(
        &self,
        poller: Poller,
        credentials: &SessionCredentials,
        now: std::time::Instant,
    ) -> bool {
        let g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        should_poll(g.unauthorized.get(&poller), credentials, now)
    }

    /// Returns true when this rejection paused the poller.
    pub(crate) fn note_unauthorized(
        &self,
        poller: Poller,
        credentials: SessionCredentials,
        base: Duration,
        now: std::time::Instant,
    ) -> bool {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let retry = UnauthorizedRetry::after(g.unauthorized.get(&poller), credentials, base, now);
        let paused = retry.is_paused();
        g.unauthorized.insert(poller, retry);
        if paused {
            dlog!(
                "[clips-tray] {:?} paused after {} rejections with the same session",
                poller,
                UNAUTHORIZED_PAUSE_AFTER
            );
        }
        paused
    }

    pub(crate) fn note_authorized(&self, poller: Poller, credentials: &SessionCredentials) {
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let matches = g
            .unauthorized
            .get(&poller)
            .is_some_and(|retry| &retry.credentials == credentials);
        if matches {
            g.unauthorized.remove(&poller);
        }
    }

    pub fn resume_polling(&self) {
        let now_ts = chrono::Utc::now().timestamp();
        let mut g = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        g.unauthorized.clear();
        if g.last_fetch_ok_at
            .is_none_or(|at| now_ts - at >= RESUME_REFRESH_MIN_AGE_SECS)
        {
            g.request_refresh();
        }
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

/// Called when the popover opens with a session the server still accepts, so a
/// poller paused by rejections during a deploy blip picks back up.
#[tauri::command]
pub async fn meetings_watcher_resume_polling(
    state: tauri::State<'_, MeetingsWatcherState>,
) -> Result<(), String> {
    state.resume_polling();
    Ok(())
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
        if g.server_url.as_deref() != Some(trimmed.as_str()) {
            g.server_url = Some(trimmed);
            g.invalidate_cache();
        }
    }
    Ok(())
}

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
        let credentials: SessionCredentials = (
            (!trimmed.is_empty()).then_some(trimmed),
            (!trimmed_token.is_empty()).then_some(trimmed_token),
        );
        if (g.session_cookie.clone(), g.auth_token.clone()) != credentials {
            (g.session_cookie, g.auth_token) = credentials;
            g.invalidate_cache();
        }
    }
    Ok(())
}

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
        g.notified.remove(&meeting_id);
    }
    Ok(())
}

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

const MEETINGS_UNAUTHORIZED_RETRY_BASE: Duration = Duration::from_secs(10);

async fn run_watcher(app: AppHandle) {
    let mut interval = tokio::time::interval(ALERT_CHECK_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
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
        let now = interval.tick().await.into_std();
        if let Err(err) = tick_once(&app, &client, now, chrono::Utc::now()).await {
            eprintln!("[clips-tray] meetings_watcher tick failed: {err}");
        }
    }
}

struct DueAlerts {
    generation: u64,
    alerts: Vec<(MeetingItem, i64)>,
}

enum FetchOutcome {
    /// No server URL, no credentials, or an unauthorized backoff is active.
    NotReady,
    /// Meetings are turned off in the desktop feature config.
    Disabled,
    Fetched(Vec<MeetingItem>),
}

async fn tick_once(
    app: &AppHandle,
    client: &reqwest::Client,
    now: std::time::Instant,
    now_utc: chrono::DateTime<chrono::Utc>,
) -> Result<(), String> {
    let state = app
        .try_state::<MeetingsWatcherState>()
        .ok_or_else(|| "no MeetingsWatcherState".to_string())?;
    if state.take_tray_clear() {
        let _ = app.emit("meetings:updated", serde_json::json!({ "meetings": [] }));
    }
    if !state.lab_enabled()? {
        return Ok(());
    }

    // Normally alert from the cache before fetching: a fetch can take up to the
    // 10s request timeout, and the banner must not wait on it. After sleep the
    // cache is stale, so fetch first; a failed fetch still alerts from it.
    let fetch_first = state.fetch_overdue(now_utc.timestamp());
    if !fetch_first {
        notify_due_meetings(app, &state, state.due_alerts(now_utc)).await;
    }

    let mut fetch_error = None;
    if let Some(generation) = state.fetch_due(now_utc.timestamp()) {
        let outcome = fetch_meetings(app, client, &state, now)
            .await
            .map_err(|err| fetch_error = Some(err));
        if let Some(snapshot) = state.finish_fetch(generation, now_utc.timestamp(), outcome) {
            let _ = app.emit(
                "meetings:updated",
                serde_json::json!({ "meetings": snapshot }),
            );
        }
    }

    if fetch_first {
        notify_due_meetings(app, &state, state.due_alerts(now_utc)).await;
    }
    fetch_error.map_or(Ok(()), Err)
}

async fn fetch_meetings(
    app: &AppHandle,
    client: &reqwest::Client,
    state: &MeetingsWatcherState,
    now: std::time::Instant,
) -> Result<FetchOutcome, String> {
    let MeetingsSessionSnapshot {
        server_url,
        session_cookie: cookie,
        auth_token,
    } = state.session_snapshot();
    let Some(server_url) = server_url else {
        return Ok(FetchOutcome::NotReady);
    };
    let credentials: SessionCredentials = (cookie.clone(), auth_token.clone());
    if !state.should_poll(Poller::Meetings, &credentials, now) {
        return Ok(FetchOutcome::NotReady);
    }
    if !feature_config(app).meetings_enabled {
        return Ok(FetchOutcome::Disabled);
    }

    let url = format!("{}/_agent-native/actions/list-meetings", server_url);
    let limit = MEETING_POLL_LIMIT.to_string();
    let within_min = FETCH_HORIZON_MIN.to_string();
    let mut req = client.get(&url).query(&[
        ("view", "upcoming"),
        ("limit", limit.as_str()),
        ("upcomingWithinMin", within_min.as_str()),
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
        let _ = app.emit("meetings:auth-needed", serde_json::json!({}));
        state.note_unauthorized(
            Poller::Meetings,
            credentials,
            MEETINGS_UNAUTHORIZED_RETRY_BASE,
            now,
        );
        return Err(format!(
            "list-meetings http {} — meetings:auth-needed emitted",
            status.as_u16()
        ));
    }
    if !status.is_success() {
        return Err(format!("list-meetings http {}", status));
    }
    state.note_authorized(Poller::Meetings, &credentials);
    let body: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    try_parse_meetings(&body)
        .map(FetchOutcome::Fetched)
        .ok_or_else(|| "list-meetings returned an unreadable payload".to_string())
}

fn tray_snapshot(meetings: &[MeetingItem]) -> Vec<TrayMeetingItem> {
    meetings
        .iter()
        .take(3)
        .map(|m| TrayMeetingItem {
            id: m.id.clone(),
            title: m.title.clone().unwrap_or_else(|| "Meeting".to_string()),
            when_label: m.scheduled_start.clone(),
        })
        .collect()
}

async fn notify_due_meetings(app: &AppHandle, state: &MeetingsWatcherState, due: DueAlerts) {
    if due.alerts.is_empty() {
        return;
    }
    // Read from disk only when a banner is due, not on every 1s tick.
    let config = feature_config(app);
    if !config.meetings_enabled {
        return;
    }
    let now_ts = chrono::Utc::now().timestamp();
    for (m, secs_until) in state.mark_notified(due, now_ts) {
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
            state.note_calendar_notify(m.platform.as_deref());
            let auto_start = config.meeting_transcription_mode == MeetingTranscriptionMode::Auto;
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

pub(crate) fn parse_meetings(body: &serde_json::Value) -> Vec<MeetingItem> {
    try_parse_meetings(body).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use chrono::{TimeZone, Utc};

    use super::{
        find_matching_calendar_meeting, is_calendar_reminder_candidate, parse_meetings,
        should_poll, FetchOutcome, MeetingItem, MeetingsWatcherState, Poller, UnauthorizedRetry,
        FETCH_INTERVAL_SECS, FETCH_RETRY_SECS, OVERDUE_FETCH_SECS, PRE_ALERT_FRESH_SECS,
        PRE_ALERT_REFRESH_SECS, RESUME_REFRESH_MIN_AGE_SECS,
    };

    #[test]
    fn should_poll_skips_with_no_credentials_at_all() {
        let now = Instant::now();
        assert!(!should_poll(None, &(None, None), now));
    }

    #[test]
    fn should_poll_allows_a_fresh_pair_with_no_backoff_state() {
        let now = Instant::now();
        let creds = (Some("cookie".to_string()), None);
        assert!(should_poll(None, &creds, now));
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

        assert!(!should_poll(
            retry.as_ref(),
            &creds,
            now + Duration::from_secs(5)
        ));
        assert!(should_poll(
            retry.as_ref(),
            &creds,
            now + Duration::from_secs(10)
        ));
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

        assert!(should_poll(retry.as_ref(), &fresh, now));
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
    fn unauthorized_retry_pauses_the_same_pair_after_three_rejections() {
        let now = Instant::now();
        let creds = (Some("cookie".to_string()), None);
        let base = Duration::from_secs(10);

        let first = UnauthorizedRetry::after(None, creds.clone(), base, now);
        let second = UnauthorizedRetry::after(Some(&first), creds.clone(), base, now);
        assert!(!second.is_paused(), "two rejections still retry");
        assert!(!second.should_skip(&creds, now + Duration::from_secs(60 * 60)));

        let third = UnauthorizedRetry::after(Some(&second), creds.clone(), base, now);
        assert!(third.is_paused());
        assert!(
            third.should_skip(&creds, now + Duration::from_secs(24 * 60 * 60)),
            "a paused pair is never retried on a timer"
        );
        assert!(
            !third.should_skip(&(Some("fresh".to_string()), None), now),
            "signing in again resumes"
        );
    }

    #[test]
    fn a_rejection_with_new_credentials_restarts_the_count() {
        let now = Instant::now();
        let stale = (Some("stale".to_string()), None);
        let fresh = (Some("fresh".to_string()), None);
        let base = Duration::from_secs(10);

        let mut retry = UnauthorizedRetry::after(None, stale.clone(), base, now);
        retry = UnauthorizedRetry::after(Some(&retry), stale, base, now);
        retry = UnauthorizedRetry::after(Some(&retry), fresh, base, now);
        assert_eq!(retry.rejections, 1);
        assert!(!retry.is_paused());
    }

    #[test]
    fn pollers_pause_independently_and_resume_together() {
        let state = MeetingsWatcherState::default();
        let now = Instant::now();
        let creds = (Some("cookie".to_string()), None);
        let base = Duration::from_secs(10);

        assert!(!state.note_unauthorized(Poller::Meetings, creds.clone(), base, now));
        assert!(!state.note_unauthorized(Poller::Meetings, creds.clone(), base, now));
        assert!(state.note_unauthorized(Poller::Meetings, creds.clone(), base, now));

        let later = now + Duration::from_secs(60 * 60);
        assert!(!state.should_poll(Poller::Meetings, &creds, later));
        assert!(state.should_poll(Poller::FeatureFlags, &creds, later));

        state.resume_polling();
        assert!(state.should_poll(Poller::Meetings, &creds, now));
    }

    #[test]
    fn a_successful_adhoc_create_clears_the_rejection_count() {
        let state = MeetingsWatcherState::default();
        let now = Instant::now();
        let creds = (Some("cookie".to_string()), None);
        let base = Duration::from_secs(10);

        state.note_unauthorized(Poller::AdhocMeetings, creds.clone(), base, now);
        state.note_unauthorized(Poller::AdhocMeetings, creds.clone(), base, now);
        state.note_authorized(Poller::AdhocMeetings, &creds);

        assert!(!state.note_unauthorized(Poller::AdhocMeetings, creds, base, now));
    }

    #[test]
    fn a_successful_feature_flags_refresh_clears_the_rejection_count() {
        let state = MeetingsWatcherState::default();
        let now = Instant::now();
        let creds = (Some("cookie".to_string()), None);
        let base = Duration::from_secs(10);

        state.note_unauthorized(Poller::FeatureFlags, creds.clone(), base, now);
        state.note_unauthorized(Poller::FeatureFlags, creds.clone(), base, now);
        state.note_authorized(Poller::FeatureFlags, &creds);

        assert!(!state.note_unauthorized(Poller::FeatureFlags, creds, base, now));
    }

    #[test]
    fn stale_authorized_result_does_not_clear_a_new_session_rejection() {
        let state = MeetingsWatcherState::default();
        let now = Instant::now();
        let stale = (Some("stale-cookie".to_string()), None);
        let current = (Some("current-cookie".to_string()), None);
        let base = Duration::from_secs(10);

        for _ in 0..super::UNAUTHORIZED_PAUSE_AFTER {
            state.note_unauthorized(Poller::Meetings, stale.clone(), base, now);
        }
        for _ in 0..super::UNAUTHORIZED_PAUSE_AFTER {
            state.note_unauthorized(Poller::Meetings, current.clone(), base, now);
        }

        state.note_authorized(Poller::Meetings, &stale);
        assert!(!state.should_poll(Poller::Meetings, &current, now));

        state.note_authorized(Poller::Meetings, &current);
        assert!(state.should_poll(Poller::Meetings, &current, now));
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

    fn meeting(id: &str, start: Option<chrono::DateTime<Utc>>) -> MeetingItem {
        MeetingItem {
            id: id.to_string(),
            title: None,
            scheduled_start: start.map(|s| s.to_rfc3339()),
            scheduled_end: None,
            join_url: None,
            platform: None,
            source: Some("calendar".to_string()),
        }
    }

    fn state_with_cache(meetings: Vec<MeetingItem>, fetched_at: i64) -> MeetingsWatcherState {
        let state = MeetingsWatcherState::default();
        let generation = state.fetch_due(fetched_at).expect("due");
        state.finish_fetch(generation, fetched_at, Ok(FetchOutcome::Fetched(meetings)));
        state
    }

    fn cached_len(state: &MeetingsWatcherState) -> usize {
        state
            .inner
            .lock()
            .expect("state lock")
            .cached_meetings
            .len()
    }

    #[test]
    fn fetches_immediately_then_waits_a_full_interval() {
        let now_ts = 1_000_000;
        let state = state_with_cache(vec![meeting("a", None)], now_ts);

        assert_eq!(cached_len(&state), 1);
        assert!(state.fetch_due(now_ts + FETCH_INTERVAL_SECS - 1).is_none());
        assert!(state.fetch_due(now_ts + FETCH_INTERVAL_SECS).is_some());
    }

    #[test]
    fn a_failed_fetch_keeps_the_cache_and_retries_sooner() {
        let now_ts = 1_000_000;
        let state = state_with_cache(vec![meeting("a", None)], now_ts);

        let later = now_ts + FETCH_INTERVAL_SECS;
        let generation = state.fetch_due(later).expect("due");
        state.finish_fetch(generation, later, Err(()));

        assert_eq!(cached_len(&state), 1);
        assert!(state.fetch_due(later + FETCH_RETRY_SECS - 1).is_none());
        assert!(state.fetch_due(later + FETCH_RETRY_SECS).is_some());
    }

    #[test]
    fn an_invalidation_mid_fetch_drops_the_stale_result() {
        let state = MeetingsWatcherState::default();
        let now_ts = 1_000_000;
        let generation = state.fetch_due(now_ts).expect("due");

        state.set_lab_enabled(true).expect("state lock");

        let stale = Ok(FetchOutcome::Fetched(vec![meeting("stale", None)]));
        assert!(state.finish_fetch(generation, now_ts, stale).is_none());
        assert_eq!(cached_len(&state), 0);
        assert!(state.fetch_due(now_ts).is_some());
    }

    #[test]
    fn a_refresh_request_keeps_an_in_flight_result() {
        let state = MeetingsWatcherState::default();
        let now_ts = 1_000_000;
        let generation = state.fetch_due(now_ts).expect("due");

        state.resume_polling();

        let fresh = Ok(FetchOutcome::Fetched(vec![meeting("a", None)]));
        assert!(state.finish_fetch(generation, now_ts, fresh).is_some());
        assert_eq!(cached_len(&state), 1);
    }

    #[test]
    fn disabling_the_lab_clears_the_cache_and_enabling_refetches() {
        let now_ts = 1_000_000;
        let state = state_with_cache(vec![meeting("a", None)], now_ts);
        state.set_lab_enabled(true).expect("state lock");
        let generation = state.fetch_due(now_ts).expect("due");
        let fetched = Ok(FetchOutcome::Fetched(vec![meeting("a", None)]));
        state.finish_fetch(generation, now_ts, fetched);

        state.set_lab_enabled(false).expect("state lock");
        assert_eq!(cached_len(&state), 0);

        state.set_lab_enabled(true).expect("state lock");
        assert!(state.fetch_due(now_ts + 1).is_some());
    }

    #[test]
    fn popover_open_refetches_only_a_stale_cache() {
        let now_ts = Utc::now().timestamp();
        let state = state_with_cache(vec![meeting("a", None)], now_ts);
        state.resume_polling();
        assert!(state.fetch_due(now_ts + 1).is_none());

        let stale = state_with_cache(
            vec![meeting("a", None)],
            now_ts - RESUME_REFRESH_MIN_AGE_SECS,
        );
        stale.resume_polling();
        assert!(stale
            .fetch_due(now_ts - RESUME_REFRESH_MIN_AGE_SECS + 1)
            .is_some());
    }

    #[test]
    fn disabled_meetings_clear_the_cache_and_back_off_a_full_interval() {
        let now_ts = 1_000_000;
        let state = state_with_cache(vec![meeting("a", None)], now_ts);

        let later = now_ts + FETCH_INTERVAL_SECS;
        let generation = state.fetch_due(later).expect("due");
        state.finish_fetch(generation, later, Ok(FetchOutcome::Disabled));

        assert_eq!(cached_len(&state), 0);
        assert!(state.fetch_due(later + FETCH_INTERVAL_SECS - 1).is_none());
    }

    #[test]
    fn schedules_a_refetch_shortly_before_the_next_meeting() {
        let now = Utc.with_ymd_and_hms(2026, 9, 30, 10, 0, 0).unwrap();
        let start = now + chrono::Duration::minutes(4);
        let state = state_with_cache(vec![meeting("m", Some(start))], now.timestamp());

        let pre_alert_at = start.timestamp() - PRE_ALERT_REFRESH_SECS;
        assert!(state.fetch_due(pre_alert_at - 1).is_none());
        assert!(state.fetch_due(pre_alert_at).is_some());
    }

    #[test]
    fn a_fetch_just_before_the_pre_alert_point_counts_as_it() {
        let now = Utc.with_ymd_and_hms(2026, 9, 30, 10, 0, 0).unwrap();
        let start = now + chrono::Duration::seconds(PRE_ALERT_REFRESH_SECS + PRE_ALERT_FRESH_SECS);
        let state = state_with_cache(vec![meeting("m", Some(start))], now.timestamp());

        assert!(state
            .fetch_due(now.timestamp() + FETCH_INTERVAL_SECS - 1)
            .is_none());
    }

    #[test]
    fn alerts_once_per_start_time() {
        let now = Utc.with_ymd_and_hms(2026, 9, 30, 10, 0, 0).unwrap();
        let start = now + chrono::Duration::seconds(30);
        let state = state_with_cache(vec![meeting("m", Some(start))], now.timestamp());

        let due = state.due_alerts(now);
        assert_eq!(due.alerts.len(), 1);
        assert_eq!(state.mark_notified(due, now.timestamp()).len(), 1);
        assert!(state.due_alerts(now).alerts.is_empty());

        let moved = start + chrono::Duration::seconds(15);
        let generation = state.inner.lock().expect("state lock").fetch_generation;
        state.finish_fetch(
            generation,
            now.timestamp(),
            Ok(FetchOutcome::Fetched(vec![meeting("m", Some(moved))])),
        );
        assert_eq!(state.due_alerts(now).alerts.len(), 1);
    }

    #[test]
    fn a_snooze_after_the_due_check_wins() {
        let now = Utc.with_ymd_and_hms(2026, 9, 30, 10, 0, 0).unwrap();
        let start = now + chrono::Duration::seconds(30);
        let state = state_with_cache(vec![meeting("m", Some(start))], now.timestamp());

        let due = state.due_alerts(now);
        state
            .inner
            .lock()
            .expect("state lock")
            .snoozed_until
            .insert("m".to_string(), now.timestamp() + 60);

        assert!(state.mark_notified(due, now.timestamp()).is_empty());
        let later = now + chrono::Duration::seconds(60);
        assert_eq!(state.due_alerts(later).alerts.len(), 1);
    }

    #[test]
    fn an_invalidation_after_the_due_check_drops_the_alert() {
        let now = Utc.with_ymd_and_hms(2026, 9, 30, 10, 0, 0).unwrap();
        let start = now + chrono::Duration::seconds(30);
        let state = state_with_cache(vec![meeting("m", Some(start))], now.timestamp());

        let due = state.due_alerts(now);
        state.invalidate_cache();

        assert!(state.mark_notified(due, now.timestamp()).is_empty());
    }

    #[test]
    fn a_fetch_slept_through_is_overdue_but_one_just_due_is_not() {
        let now_ts = 1_000_000;
        let state = state_with_cache(vec![meeting("a", None)], now_ts);
        let due_at = now_ts + FETCH_INTERVAL_SECS;

        assert!(!state.fetch_overdue(due_at));
        assert!(!state.fetch_overdue(due_at + OVERDUE_FETCH_SECS));
        assert!(state.fetch_overdue(due_at + OVERDUE_FETCH_SECS + 1));
        assert!(!MeetingsWatcherState::default().fetch_overdue(now_ts));
    }

    #[test]
    fn an_undelivered_alert_stays_due() {
        let now = Utc.with_ymd_and_hms(2026, 9, 30, 10, 0, 0).unwrap();
        let start = now + chrono::Duration::seconds(30);
        let state = state_with_cache(vec![meeting("m", Some(start))], now.timestamp());

        assert_eq!(state.due_alerts(now).alerts.len(), 1);
        assert_eq!(state.due_alerts(now).alerts.len(), 1);
    }

    #[test]
    fn invalidating_the_cache_clears_the_tray_once() {
        let state = state_with_cache(vec![meeting("a", None)], 1_000_000);
        assert!(!state.take_tray_clear());

        state.set_lab_enabled(true).expect("state lock");

        assert!(state.take_tray_clear());
        assert!(!state.take_tray_clear());
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
