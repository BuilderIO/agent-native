//! Granola-style adhoc Zoom / Teams detection.
//!
//! Samples every known call app every few seconds and asks one question: is a
//! call underway? A live audio input stream held by Zoom or Teams answers yes
//! wherever their window sits, so detection survives joining a call and then
//! working in another app — the common case that foreground dwell alone missed
//! entirely. Foreground dwell remains the fallback for machines whose OS cannot
//! report input state at all. On a yes, creates a meeting row via
//! `create-meeting` (matched to a calendar event when one lines up) and shows
//! the same meeting-notification overlay used for calendar reminders.
//!
//! Reuses `MeetingsWatcherState` session (server URL + cookie + auth token)
//! so the popover only needs to push credentials once.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use crate::config::{feature_config, MeetingTranscriptionMode};
use crate::dlog;
use crate::meetings_watcher::{
    find_matching_calendar_meeting, parse_meetings, MeetingItem, MeetingsWatcherState,
    CALENDAR_MATCH_WINDOW_MINUTES,
};

const POLL_SECS: u64 = 2;

const MIC_DWELL: Duration = Duration::from_secs(5);

const FRONT_DWELL: Duration = Duration::from_secs(9);

const JOIN_GRACE: Duration = Duration::from_secs(20);

const MIC_DROP_GRACE: Duration = Duration::from_secs(8);

const MIC_UNREADABLE_GRACE: Duration = Duration::from_secs(45);

const CALL_END: Duration = Duration::from_secs(30);

const COOLDOWN_SECS: i64 = 8 * 60;

const CALENDAR_SOFT_GUARD_SECS: i64 = 3 * 60;

const CREATE_RETRY_BACKOFF_SECS: i64 = 60;

const CREATE_DOUBT_TTL_SECS: i64 = 5 * 60;

const RECONCILE_SKEW_SECS: i64 = 10;

const RECONCILE_PAGE_LIMIT: usize = 200;

const RECONCILE_MAX_PAGES: usize = 5;

const STRONG_VC_BUNDLES: &[(&str, &str, &str)] = &[
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
    prompt_cooldown_until: HashMap<String, i64>,
    dismissed_until: HashMap<String, i64>,
    evidence: HashMap<String, CallEvidence>,
    session_notified: HashMap<String, bool>,
    create_in_doubt_since: HashMap<String, i64>,
}

#[derive(Debug)]
enum CreateFailure {
    NotCommitted(String),
    Ambiguous(String),
}

impl CreateFailure {
    fn message(&self) -> &str {
        match self {
            CreateFailure::NotCommitted(m) | CreateFailure::Ambiguous(m) => m,
        }
    }

    fn is_ambiguous(&self) -> bool {
        matches!(self, CreateFailure::Ambiguous(_))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CallState {
    Live,
    Pending,
    Idle,
}

#[derive(Debug, Default, Clone, Copy)]
struct CallEvidence {
    front_since: Option<Instant>,
    mic_since: Option<Instant>,
    mic_last_true: Option<Instant>,
    mic_silent_since: Option<Instant>,
    mic_unreadable_since: Option<Instant>,
    call_ended: bool,
    mic_abstained: bool,
    mic_was_authoritative: bool,
}

impl CallEvidence {
    fn observe(&mut self, now: Instant, mic: Option<bool>, frontmost: bool) {
        if frontmost {
            self.front_since.get_or_insert(now);
        } else {
            self.front_since = None;
        }
        match mic {
            Some(true) => {
                self.mic_last_true = Some(now);
                self.mic_since.get_or_insert(now);
                self.mic_silent_since = None;
                self.mic_unreadable_since = None;
            }
            Some(false) => {
                self.mic_unreadable_since = None;
                let silent_since = *self.mic_silent_since.get_or_insert(now);
                let silent_for = now.saturating_duration_since(silent_since);
                if silent_for >= MIC_DROP_GRACE {
                    self.mic_since = None;
                }
                if self.mic_last_true.is_some() && silent_for >= CALL_END {
                    self.end_call(now);
                }
            }
            None => {
                self.mic_unreadable_since.get_or_insert(now);
                self.mic_silent_since = None;
            }
        }
        let authoritative = self.mic_is_authoritative(now);
        if self.mic_was_authoritative && !authoritative {
            self.mic_abstained = true;
        }
        self.mic_was_authoritative = authoritative;
    }

    fn end_call(&mut self, now: Instant) {
        self.call_ended = true;
        self.mic_since = None;
        self.mic_last_true = None;
        self.mic_silent_since = None;
        self.mic_was_authoritative = false;
        if self.front_since.is_some() {
            self.front_since = Some(now);
        }
    }

    fn mic_ever_spoke(&self) -> bool {
        self.mic_last_true.is_some() || self.mic_since.is_some()
    }

    fn mic_is_authoritative(&self, now: Instant) -> bool {
        self.mic_ever_spoke()
            && !self
                .mic_unreadable_since
                .is_some_and(|since| now.saturating_duration_since(since) >= MIC_UNREADABLE_GRACE)
    }

    fn mic_live(&self, now: Instant, mic: Option<bool>) -> bool {
        if mic == Some(true) {
            return true;
        }
        let (Some(since), Some(last)) = (self.mic_since, self.mic_last_true) else {
            return false;
        };
        if last.saturating_duration_since(since) < MIC_DWELL {
            return false;
        }
        if self
            .mic_silent_since
            .is_some_and(|since| now.saturating_duration_since(since) >= MIC_DROP_GRACE)
        {
            return false;
        }
        !self
            .mic_unreadable_since
            .is_some_and(|since| now.saturating_duration_since(since) >= MIC_UNREADABLE_GRACE)
    }

    fn classify(&self, now: Instant, mic: Option<bool>, frontmost: bool) -> CallState {
        if self.mic_live(now, mic) {
            let since = self.mic_since.unwrap_or(now);
            return if now.saturating_duration_since(since) >= MIC_DWELL {
                CallState::Live
            } else {
                CallState::Pending
            };
        }
        let Some(front_since) = self.front_since.filter(|_| frontmost) else {
            return CallState::Idle;
        };
        let front_for = now.saturating_duration_since(front_since);
        match mic {
            None => {
                if front_for >= FRONT_DWELL {
                    CallState::Live
                } else {
                    CallState::Pending
                }
            }
            _ => {
                if front_for < JOIN_GRACE {
                    CallState::Pending
                } else {
                    CallState::Idle
                }
            }
        }
    }

    fn take_call_ended(&mut self) -> bool {
        std::mem::take(&mut self.call_ended)
    }

    fn take_mic_abstained(&mut self) -> bool {
        std::mem::take(&mut self.mic_abstained)
    }
}

impl AdhocMeetingsWatcherInner {
    fn note_prompted(&mut self, platform: &str, now_ts: i64) {
        self.session_notified.insert(platform.to_string(), true);
        self.prompt_cooldown_until
            .insert(platform.to_string(), now_ts + COOLDOWN_SECS);
    }

    fn note_dismissed(&mut self, platform: &str, now_ts: i64) {
        self.session_notified.insert(platform.to_string(), true);
        self.dismissed_until
            .insert(platform.to_string(), now_ts + COOLDOWN_SECS);
    }

    fn end_call_session(&mut self, platform: &str) {
        self.session_notified.remove(platform);
        self.prompt_cooldown_until.remove(platform);
        self.dismissed_until.remove(platform);
        self.create_in_doubt_since.remove(platform);
    }

    fn note_create_failed(&mut self, platform: &str, now_ts: i64, ambiguous: bool) {
        self.session_notified.remove(platform);
        self.prompt_cooldown_until
            .insert(platform.to_string(), now_ts + CREATE_RETRY_BACKOFF_SECS);
        if ambiguous {
            self.create_in_doubt_since
                .entry(platform.to_string())
                .or_insert(now_ts);
        }
    }

    fn note_create_resolved(&mut self, platform: &str) {
        self.create_in_doubt_since.remove(platform);
    }

    fn defer_secondary_candidates(&mut self, platforms: &[&str]) {
        for platform in platforms {
            self.session_notified.insert((*platform).to_string(), true);
        }
    }

    fn create_doubt_since(&self, platform: &str) -> Option<i64> {
        self.create_in_doubt_since.get(platform).copied()
    }

    fn clear_tracking(&mut self, now_ts: i64) {
        self.evidence.clear();
        self.create_in_doubt_since.clear();
        let notified: Vec<String> = self.session_notified.drain().map(|(p, _)| p).collect();
        for platform in notified {
            let until = now_ts + COOLDOWN_SECS;
            self.prompt_cooldown_until
                .entry(platform)
                .and_modify(|existing| *existing = (*existing).max(until))
                .or_insert(until);
        }
    }

    fn retain_live_cooldowns(&mut self, now_ts: i64) {
        self.prompt_cooldown_until
            .retain(|_, until| *until > now_ts);
        self.dismissed_until.retain(|_, until| *until > now_ts);

        let expired: Vec<String> = self
            .create_in_doubt_since
            .iter()
            .filter(|(_, since)| *since + CREATE_DOUBT_TTL_SECS <= now_ts)
            .map(|(platform, _)| platform.clone())
            .collect();
        for platform in expired {
            self.create_in_doubt_since.remove(&platform);
            let until = now_ts + COOLDOWN_SECS;
            self.prompt_cooldown_until
                .entry(platform)
                .and_modify(|existing| *existing = (*existing).max(until))
                .or_insert(until);
        }
    }

    fn is_suppressed(&self, platform: &str, now_ts: i64) -> bool {
        self.prompt_cooldown_until
            .get(platform)
            .copied()
            .unwrap_or(0)
            > now_ts
            || self.dismissed_until.get(platform).copied().unwrap_or(0) > now_ts
            || self
                .session_notified
                .get(platform)
                .copied()
                .unwrap_or(false)
    }
}

pub fn refresh_dismissal_suppression(app: &AppHandle, platform: &str) -> Result<(), String> {
    let platform = platform.trim().to_lowercase();
    if platform.is_empty() {
        return Ok(());
    }
    let state = app
        .try_state::<AdhocMeetingsWatcherState>()
        .ok_or_else(|| "no AdhocMeetingsWatcherState".to_string())?;
    let mut g = state.inner.lock().map_err(|e| e.to_string())?;
    g.note_dismissed(&platform, chrono::Utc::now().timestamp());
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

async fn run_watcher(app: AppHandle) {
    let mut interval = tokio::time::interval(Duration::from_secs(POLL_SECS));
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

fn platform_titles() -> Vec<(&'static str, &'static str)> {
    let mut out: Vec<(&'static str, &'static str)> = Vec::new();
    for (_, platform, title) in STRONG_VC_BUNDLES {
        if !out.iter().any(|(known, _)| known == platform) {
            out.push((*platform, *title));
        }
    }
    out
}

fn bundles_for_platform(platform: &str) -> Vec<String> {
    STRONG_VC_BUNDLES
        .iter()
        .filter(|(_, candidate, _)| *candidate == platform)
        .map(|(bundle_id, _, _)| bundle_id.to_lowercase())
        .collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct AdhocNotificationPlan {
    show_widget: bool,
    auto_start: bool,
}

fn adhoc_notification_plan(config: &crate::config::FeatureConfig) -> AdhocNotificationPlan {
    let auto_start = config.meeting_transcription_mode == MeetingTranscriptionMode::Auto;
    AdhocNotificationPlan {
        show_widget: config.show_meeting_widget_enabled
            || config.meeting_transcription_mode == MeetingTranscriptionMode::Ask
            || auto_start,
        auto_start,
    }
}

async fn tick_once(app: &AppHandle, client: &reqwest::Client) -> Result<(), String> {
    let config = feature_config(app);
    if !config.meetings_enabled {
        reset_evidence(app);
        return Ok(());
    }

    let meetings_state = app
        .try_state::<MeetingsWatcherState>()
        .ok_or_else(|| "no MeetingsWatcherState".to_string())?;
    if !meetings_state.lab_enabled()? {
        reset_evidence(app);
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
    if crate::util::is_meeting_active(app) {
        reset_evidence(app);
        return Ok(());
    }

    if config.meeting_transcription_mode == MeetingTranscriptionMode::Manual
        && !config.show_meeting_widget_enabled
    {
        reset_evidence(app);
        return Ok(());
    }

    let front = crate::util::frontmost_bundle_id();
    let front_platform = front.as_deref().and_then(match_vc_bundle).map(|(p, _)| p);
    let now = Instant::now();
    let now_ts = chrono::Utc::now().timestamp();

    let mut confirmed: Option<(&'static str, &'static str)> = None;
    let mut deferred: Vec<&'static str> = Vec::new();
    for (platform, fallback) in platform_titles() {
        let mic = crate::call_activity::call_app_uses_microphone(&bundles_for_platform(platform));
        let frontmost = front_platform == Some(platform);

        let state = app
            .try_state::<AdhocMeetingsWatcherState>()
            .ok_or_else(|| "no AdhocMeetingsWatcherState".to_string())?;
        let mut g = state.inner.lock().map_err(|e| e.to_string())?;
        g.retain_live_cooldowns(now_ts);

        let (call_state, call_ended, mic_abstained, mic_live, mic_authoritative) = {
            let evidence = g.evidence.entry(platform.to_string()).or_default();
            evidence.observe(now, mic, frontmost);
            (
                evidence.classify(now, mic, frontmost),
                evidence.take_call_ended(),
                evidence.take_mic_abstained(),
                evidence.mic_live(now, mic),
                evidence.mic_is_authoritative(now),
            )
        };

        if call_ended {
            g.end_call_session(platform);
        }
        if !mic_live && !frontmost && !mic_authoritative {
            g.session_notified.remove(platform);
        }
        if mic_abstained {
            g.session_notified.remove(platform);
        }

        if call_state == CallState::Live && !g.is_suppressed(platform, now_ts) {
            if confirmed.is_none() {
                confirmed = Some((platform, fallback));
            } else {
                deferred.push(platform);
            }
        }
    }

    let Some((platform, fallback_title)) = confirmed else {
        return Ok(());
    };

    if let Some(state) = app.try_state::<MeetingsWatcherState>() {
        if state.recent_calendar_notify(platform, CALENDAR_SOFT_GUARD_SECS) {
            dlog!(
                "[clips-tray] adhoc skip: recent calendar notify for {}",
                platform
            );
            if let Some(adhoc) = app.try_state::<AdhocMeetingsWatcherState>() {
                if let Ok(mut g) = adhoc.inner.lock() {
                    g.note_prompted(platform, now_ts);
                }
            }
            return Ok(());
        }
    }

    let reconcile_since = {
        let state = app
            .try_state::<AdhocMeetingsWatcherState>()
            .ok_or_else(|| "no AdhocMeetingsWatcherState".to_string())?;
        let mut g = state.inner.lock().map_err(|e| e.to_string())?;
        g.note_prompted(platform, now_ts);
        g.create_doubt_since(platform)
    };

    dlog!(
        "[clips-tray] adhoc call confirmed for {} — creating meeting",
        platform
    );

    let meeting = match create_adhoc_meeting(app, client, platform, reconcile_since).await {
        Ok(meeting) => meeting,
        Err(failure) => {
            if let Some(state) = app.try_state::<AdhocMeetingsWatcherState>() {
                if let Ok(mut g) = state.inner.lock() {
                    g.note_create_failed(platform, now_ts, failure.is_ambiguous());
                }
            }
            return Err(failure.message().to_string());
        }
    };

    if !deferred.is_empty() {
        if let Some(state) = app.try_state::<AdhocMeetingsWatcherState>() {
            if let Ok(mut g) = state.inner.lock() {
                g.defer_secondary_candidates(&deferred);
            }
        }
    }

    {
        let state = app
            .try_state::<AdhocMeetingsWatcherState>()
            .ok_or_else(|| "no AdhocMeetingsWatcherState".to_string())?;
        let mut g = state.inner.lock().map_err(|e| e.to_string())?;
        g.note_create_resolved(platform);
    }

    let AdhocNotificationPlan {
        show_widget,
        auto_start,
    } = adhoc_notification_plan(config);

    // Awaited, not spawned. `meetings:hide-notification` is dropped by the
    // overlay unless it already holds the matching payload, so auto-start
    // emitting first would race the card into existence *after* the only event
    // that clears it — leaving a "Take notes?" prompt stuck over a meeting that
    // is already recording. Installing the payload before startup is announced
    // makes that ordering impossible rather than unlikely.
    if show_widget {
        let title = meeting
            .title
            .clone()
            .unwrap_or_else(|| fallback_title.to_string());
        let notify_platform = meeting
            .platform
            .clone()
            .unwrap_or_else(|| platform.to_string());
        let scheduled_start = meeting
            .scheduled_start
            .clone()
            .or_else(|| Some(chrono::Utc::now().to_rfc3339()));
        if let Err(err) = crate::notifications::notify_meeting_starting(
            app.clone(),
            meeting.id.clone(),
            title,
            0,
            meeting.join_url.clone(),
            scheduled_start,
            meeting.scheduled_end.clone(),
            Some(notify_platform),
            Some(auto_start),
            meeting.source.clone().or_else(|| Some("adhoc".to_string())),
        )
        .await
        {
            dlog!(
                "[clips-tray] adhoc notification failed for {}: {}",
                meeting.id,
                err
            );
        }
    }

    if auto_start {
        let _ = app.emit(
            "meetings:start-transcription",
            serde_json::json!({
                "meetingId": meeting.id,
                "joinUrl": meeting.join_url,
                "reason": "adhoc-auto",
                "scheduledStart": meeting.scheduled_start,
            }),
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with(
        mode: MeetingTranscriptionMode,
        show_meeting_widget_enabled: bool,
    ) -> crate::config::FeatureConfig {
        crate::config::FeatureConfig {
            meeting_transcription_mode: mode,
            show_meeting_widget_enabled,
            ..Default::default()
        }
    }

    #[test]
    fn platform_bundles_do_not_vouch_for_each_other() {
        let zoom = bundles_for_platform("zoom");
        assert!(zoom.contains(&"us.zoom.xos".to_string()));
        assert!(zoom.contains(&"us.zoom.zoomclips".to_string()));
        assert!(!zoom.iter().any(|id| id.contains("teams")));

        let teams = bundles_for_platform("teams");
        assert!(teams.contains(&"com.microsoft.teams2".to_string()));
        assert!(!teams.iter().any(|id| id.contains("zoom")));

        assert!(bundles_for_platform("webex").is_empty());
    }

    fn ago(now: Instant, secs: u64) -> Instant {
        now.checked_sub(Duration::from_secs(secs)).unwrap_or(now)
    }

    #[test]
    fn every_platform_is_sampled_once() {
        let platforms = platform_titles();
        assert_eq!(platforms.len(), 2);
        assert!(platforms.iter().any(|(p, _)| *p == "zoom"));
        assert!(platforms.iter().any(|(p, _)| *p == "teams"));
    }

    #[test]
    fn a_live_stream_confirms_a_call_from_the_background() {
        let now = Instant::now();
        let evidence = CallEvidence {
            front_since: None,
            mic_since: Some(ago(now, 6)),
            mic_last_true: Some(now),
            ..Default::default()
        };
        assert_eq!(evidence.classify(now, Some(true), false), CallState::Live);
    }

    #[test]
    fn a_live_stream_still_debounces() {
        let now = Instant::now();
        let evidence = CallEvidence {
            front_since: None,
            mic_since: Some(ago(now, 2)),
            mic_last_true: Some(now),
            ..Default::default()
        };
        assert_eq!(
            evidence.classify(now, Some(true), false),
            CallState::Pending
        );
    }

    #[test]
    fn a_single_live_sample_is_not_a_call() {
        let now = Instant::now();
        let mut evidence = CallEvidence::default();
        evidence.observe(ago(now, 6), Some(true), false);
        evidence.observe(ago(now, 4), Some(false), false);
        evidence.observe(ago(now, 2), Some(false), false);
        evidence.observe(now, Some(false), false);

        assert!(!evidence.mic_live(now, Some(false)));
        assert_eq!(
            evidence.classify(now, Some(false), false),
            CallState::Idle,
            "one live sample never becomes a confirmed call"
        );
    }

    #[test]
    fn an_established_stream_still_gets_its_drop_grace() {
        let now = Instant::now();
        let mut evidence = CallEvidence::default();
        evidence.observe(ago(now, 20), Some(true), false);
        evidence.observe(ago(now, 14), Some(true), false);
        evidence.observe(now, Some(false), false);

        assert!(evidence.mic_live(now, Some(false)));
        assert_eq!(evidence.classify(now, Some(false), false), CallState::Live);
    }

    #[test]
    fn a_stream_that_blips_out_does_not_restart_the_dwell() {
        let now = Instant::now();
        let mut evidence = CallEvidence::default();
        evidence.observe(ago(now, 20), Some(true), false);
        evidence.observe(ago(now, 4), Some(true), false);
        evidence.observe(now, Some(false), false);
        assert_eq!(
            evidence.classify(now, Some(false), false),
            CallState::Live,
            "one silent read inside the drop grace is still the same call"
        );
    }

    #[test]
    fn a_freshly_opened_window_waits_out_the_join_grace() {
        let now = Instant::now();
        let joining = CallEvidence {
            front_since: Some(ago(now, 4)),
            ..Default::default()
        };
        assert_eq!(joining.classify(now, Some(false), true), CallState::Pending);

        let parked = CallEvidence {
            front_since: Some(ago(now, 60)),
            ..Default::default()
        };
        assert_eq!(
            parked.classify(now, Some(false), true),
            CallState::Idle,
            "past the grace window a silent window is Zoom parked open"
        );
    }

    #[test]
    fn an_unreadable_input_state_falls_back_to_foreground_dwell() {
        let now = Instant::now();
        let dwelled = CallEvidence {
            front_since: Some(ago(now, 10)),
            ..Default::default()
        };
        assert_eq!(dwelled.classify(now, None, true), CallState::Live);

        let fresh = CallEvidence {
            front_since: Some(ago(now, 3)),
            ..Default::default()
        };
        assert_eq!(fresh.classify(now, None, true), CallState::Pending);
        assert_eq!(dwelled.classify(now, None, false), CallState::Idle);
    }

    #[test]
    fn a_finished_call_releases_the_suppression_for_the_next_one() {
        let now = Instant::now();
        let mut evidence = CallEvidence::default();
        evidence.observe(ago(now, 90), Some(true), true);
        evidence.observe(ago(now, 60), Some(false), true);
        evidence.observe(now, Some(false), true);

        assert!(
            evidence.take_call_ended(),
            "no stream for 30s ends the call even with the window still front"
        );
        assert!(
            !evidence.take_call_ended(),
            "the end of a call fires once, not on every later tick"
        );

        let mut state = AdhocMeetingsWatcherInner::default();
        state.note_prompted("zoom", 1_000);
        assert!(state.is_suppressed("zoom", 1_001));
        state.end_call_session("zoom");
        assert!(
            !state.is_suppressed("zoom", 1_001),
            "back-to-back calls each get their own prompt"
        );
    }

    #[test]
    fn an_unreadable_read_does_not_end_a_live_call() {
        let now = Instant::now();
        let mut evidence = CallEvidence::default();
        evidence.observe(ago(now, 60), Some(true), false);
        for secs in (1..=50).rev() {
            evidence.observe(ago(now, secs), None, false);
            assert!(
                !evidence.take_call_ended(),
                "an unreadable read must never end a call"
            );
        }
        evidence.observe(now, Some(true), false);

        assert!(
            !evidence.take_call_ended(),
            "a stream that was never confirmed gone is still the same call"
        );
        assert_eq!(
            evidence.mic_since,
            Some(ago(now, 60)),
            "the original dwell survives the unreadable stretch"
        );
        assert_eq!(evidence.classify(now, Some(true), false), CallState::Live);
    }

    #[test]
    fn an_unreadable_stretch_hands_back_to_the_foreground_fallback() {
        let now = Instant::now();
        let mut evidence = CallEvidence::default();
        evidence.observe(ago(now, 300), Some(true), true);
        evidence.observe(ago(now, 200), None, true);
        evidence.observe(now, None, true);

        assert!(!evidence.mic_live(now, None));
        assert!(
            !evidence.take_call_ended(),
            "a state we could not read is not a confirmed call end"
        );
        assert_eq!(
            evidence.classify(now, None, true),
            CallState::Live,
            "foreground dwell is the only evidence left"
        );
        assert_eq!(evidence.classify(now, None, false), CallState::Idle);
    }

    #[test]
    fn a_stream_returning_inside_the_end_threshold_is_the_same_call() {
        let now = Instant::now();
        let mut evidence = CallEvidence::default();
        evidence.observe(ago(now, 40), Some(true), false);
        evidence.observe(ago(now, 20), Some(false), false);
        evidence.observe(ago(now, 12), Some(false), false);
        evidence.observe(ago(now, 10), Some(true), false);

        assert!(
            !evidence.take_call_ended(),
            "a 10s gap is a blip, not the end of the call"
        );
        assert!(
            evidence.mic_is_authoritative(now),
            "a readable stream still decides when this call ends"
        );
    }

    #[test]
    fn a_backgrounded_call_keeps_its_suppression_until_the_confirmed_end() {
        let now = Instant::now();
        let mut evidence = CallEvidence::default();
        evidence.observe(ago(now, 60), Some(true), false);
        evidence.observe(ago(now, 12), Some(false), false);

        assert!(!evidence.mic_live(now, Some(false)));
        assert!(
            evidence.mic_is_authoritative(now),
            "a readable silence run is the stream's business, not the window's"
        );
        assert!(!evidence.take_call_ended());
    }

    #[test]
    fn an_unreadable_background_call_gives_up_only_the_clockless_suppression() {
        let now = Instant::now();
        let mut evidence = CallEvidence::default();
        evidence.observe(ago(now, 300), Some(true), false);
        evidence.observe(ago(now, 200), None, false);
        evidence.observe(now, None, false);

        assert!(evidence.mic_ever_spoke());
        assert!(
            !evidence.mic_is_authoritative(now),
            "an unreadable run past its grace is no longer an authority"
        );
        assert!(!evidence.take_call_ended());

        let mut state = AdhocMeetingsWatcherInner::default();
        state.note_prompted("zoom", 1_000);
        state.session_notified.remove("zoom");
        assert!(
            state.is_suppressed("zoom", 1_000 + COOLDOWN_SECS - 1),
            "the cooldown still guards against a duplicate prompt"
        );
        assert!(
            !state.is_suppressed("zoom", 1_000 + COOLDOWN_SECS),
            "and it expires, so the platform is never stranded"
        );
    }

    #[test]
    fn a_platform_with_no_stream_evidence_is_the_only_one_the_window_ends() {
        let now = Instant::now();
        let mut fallback = CallEvidence::default();
        fallback.observe(ago(now, 30), None, true);
        fallback.observe(now, None, true);
        assert!(
            !fallback.mic_ever_spoke(),
            "macOS 13 never records a stream, so the window is all there is"
        );
        assert!(!fallback.mic_is_authoritative(now));
    }

    #[test]
    fn a_second_muted_call_in_the_same_window_gets_a_fresh_join_grace() {
        let now = Instant::now();
        let mut evidence = CallEvidence::default();
        evidence.observe(ago(now, 600), Some(true), true);
        evidence.observe(ago(now, 100), Some(false), true);
        evidence.observe(ago(now, 10), Some(false), true);
        assert!(evidence.take_call_ended());

        assert_eq!(
            evidence.classify(now, Some(false), true),
            CallState::Pending,
            "joining the next call muted still gets its join grace"
        );
    }

    #[test]
    fn losing_the_window_never_releases_the_prompt_cooldown() {
        let now_ts = 1_000;
        let mut state = AdhocMeetingsWatcherInner::default();
        state.note_prompted("zoom", now_ts);

        state.session_notified.remove("zoom");
        assert!(
            state.is_suppressed("zoom", now_ts + 1),
            "the same call must not prompt again on returning to the window"
        );
        assert!(
            !state.is_suppressed("zoom", now_ts + COOLDOWN_SECS),
            "and the cooldown still expires, so the platform is never stranded"
        );

        state.end_call_session("zoom");
        assert!(
            !state.is_suppressed("zoom", now_ts + 1),
            "a confirmed call end is what frees the next call"
        );
    }

    #[test]
    fn abandoning_evidence_converts_suppression_into_a_bounded_one() {
        let now_ts = 1_000;
        let mut state = AdhocMeetingsWatcherInner::default();
        state.note_prompted("zoom", now_ts);
        state.note_dismissed("teams", now_ts);
        state
            .evidence
            .insert("zoom".to_string(), CallEvidence::default());

        state.clear_tracking(now_ts + 30);

        assert!(state.evidence.is_empty());
        assert!(
            state.session_notified.is_empty(),
            "the clockless flag never survives the evidence that releases it"
        );
        assert!(
            state.is_suppressed("zoom", now_ts + 31),
            "a call that outlives transcription is not prompted for twice"
        );
        assert!(
            !state.is_suppressed("zoom", now_ts + 30 + COOLDOWN_SECS),
            "and the suppression is bounded, so it can never strand"
        );
        assert!(
            state.is_suppressed("teams", now_ts + 31),
            "a dismissal has its own clock and is not ours to discard"
        );
    }

    #[test]
    fn a_failed_create_backs_off_instead_of_retrying_every_tick() {
        let now_ts = 1_000;
        let mut state = AdhocMeetingsWatcherInner::default();
        state.note_prompted("zoom", now_ts);

        state.note_create_failed("zoom", now_ts, false);

        assert!(
            state.is_suppressed("zoom", now_ts + CREATE_RETRY_BACKOFF_SECS - 1),
            "the same call must not resubmit on the next tick"
        );
        assert!(
            !state.is_suppressed("zoom", now_ts + CREATE_RETRY_BACKOFF_SECS),
            "but the call is retried rather than abandoned"
        );
        assert!(
            CREATE_RETRY_BACKOFF_SECS < COOLDOWN_SECS,
            "a failed create retries sooner than a successful prompt repeats"
        );
    }

    #[test]
    fn a_create_that_could_not_have_committed_does_not_force_a_reconcile() {
        let now_ts = 1_000;
        let mut state = AdhocMeetingsWatcherInner::default();

        state.note_create_failed("zoom", now_ts, false);

        assert_eq!(
            state.create_doubt_since("zoom"),
            None,
            "a rejected request wrote nothing, so there is no row to look for"
        );
    }

    #[test]
    fn an_unreadable_create_outcome_makes_the_next_attempt_reconcile() {
        let now_ts = 1_000;
        let mut state = AdhocMeetingsWatcherInner::default();

        state.note_create_failed("zoom", now_ts, true);

        assert_eq!(
            state.create_doubt_since("zoom"),
            Some(now_ts),
            "the attempt may have committed, so the retry must look before inserting"
        );
        assert_eq!(
            state.create_doubt_since("teams"),
            None,
            "doubt is per platform"
        );
    }

    #[test]
    fn a_run_of_unreadable_attempts_reconciles_against_the_first_one() {
        let now_ts = 1_000;
        let mut state = AdhocMeetingsWatcherInner::default();

        state.note_create_failed("zoom", now_ts, true);
        state.note_create_failed("zoom", now_ts + CREATE_RETRY_BACKOFF_SECS, true);

        assert_eq!(state.create_doubt_since("zoom"), Some(now_ts));
    }

    #[test]
    fn a_resolved_create_stops_reconciling() {
        let now_ts = 1_000;
        let mut state = AdhocMeetingsWatcherInner::default();
        state.note_create_failed("zoom", now_ts, true);

        state.note_create_resolved("zoom");

        assert_eq!(state.create_doubt_since("zoom"), None);
    }

    #[test]
    fn a_finished_call_drops_the_doubt_from_the_call_that_ended() {
        let now_ts = 1_000;
        let mut state = AdhocMeetingsWatcherInner::default();
        state.note_create_failed("zoom", now_ts, true);

        state.end_call_session("zoom");

        assert_eq!(state.create_doubt_since("zoom"), None);
    }

    #[test]
    fn an_unresolved_create_doubt_expires_into_a_cooldown() {
        let now_ts = 1_000;
        let mut state = AdhocMeetingsWatcherInner::default();
        state.note_create_failed("zoom", now_ts, true);

        state.retain_live_cooldowns(now_ts + CREATE_DOUBT_TTL_SECS - 1);
        assert_eq!(state.create_doubt_since("zoom"), Some(now_ts));

        let expiry = now_ts + CREATE_DOUBT_TTL_SECS;
        state.retain_live_cooldowns(expiry);
        assert_eq!(state.create_doubt_since("zoom"), None);
        assert!(
            state.is_suppressed("zoom", expiry),
            "an unsettled write must not fall through to a fresh insert"
        );
        assert!(
            state.is_suppressed("zoom", expiry + COOLDOWN_SECS - 1),
            "the pause runs a full cooldown"
        );
        assert!(
            !state.is_suppressed("zoom", expiry + COOLDOWN_SECS),
            "and is bounded, so the platform is never suppressed forever"
        );
    }

    #[test]
    fn abandoning_tracking_drops_the_doubt_too() {
        let now_ts = 1_000;
        let mut state = AdhocMeetingsWatcherInner::default();
        state.note_create_failed("zoom", now_ts, true);

        state.clear_tracking(now_ts);

        assert_eq!(
            state.create_doubt_since("zoom"),
            None,
            "there is no tracked call left to tie a found row to"
        );
    }

    #[test]
    fn a_deferred_platform_is_suppressed_only_once_the_winner_has_a_row() {
        let now_ts = 1_000;
        let mut state = AdhocMeetingsWatcherInner::default();
        state.note_prompted("zoom", now_ts);

        assert!(
            !state.is_suppressed("teams", now_ts),
            "losing the tie-break is not grounds for suppression on its own"
        );

        state.defer_secondary_candidates(&["teams"]);

        assert!(
            state.is_suppressed("teams", now_ts),
            "once the winner has a row, one poll has prompted for one call"
        );
    }

    #[test]
    fn a_deferred_platform_survives_the_winners_failure() {
        let now_ts = 1_000;
        let mut state = AdhocMeetingsWatcherInner::default();
        state.note_prompted("zoom", now_ts);

        state.note_create_failed("zoom", now_ts, true);

        assert!(
            !state.is_suppressed("teams", now_ts),
            "the other live call must still be promptable on the next tick"
        );
    }

    #[test]
    fn a_calendar_guarded_platform_yields_the_next_poll_to_the_other_call() {
        let now_ts = 1_000;
        let mut state = AdhocMeetingsWatcherInner::default();

        state.note_prompted("zoom", now_ts);

        let next_tick = now_ts + POLL_SECS as i64;
        assert!(
            state.is_suppressed("zoom", next_tick),
            "the guarded platform is no longer eligible to be picked first"
        );
        assert!(
            !state.is_suppressed("teams", next_tick),
            "so the other live call becomes this poll's candidate"
        );
    }

    #[test]
    fn a_deferred_platform_is_released_by_its_own_call_end() {
        let now_ts = 1_000;
        let mut state = AdhocMeetingsWatcherInner::default();
        state.defer_secondary_candidates(&["teams"]);
        assert!(state.is_suppressed("teams", now_ts));

        state.end_call_session("teams");

        assert!(
            !state.is_suppressed("teams", now_ts),
            "a deferral carries no cooldown, so the next call prompts immediately"
        );
    }

    fn adhoc_row(id: &str, platform: &str, start: &str) -> serde_json::Value {
        serde_json::json!({
            "id": id,
            "platform": platform,
            "source": "adhoc",
            "scheduledStart": start,
        })
    }

    fn ts(rfc3339: &str) -> i64 {
        chrono::DateTime::parse_from_rfc3339(rfc3339)
            .unwrap()
            .timestamp()
    }

    const ATTEMPT: &str = "2026-08-19T10:00:00Z";
    const RETRY: &str = "2026-08-19T10:01:00Z";

    #[test]
    fn reconcile_adopts_the_row_a_lost_response_left_behind() {
        let meetings = parse_meetings(&serde_json::json!({
            "meetings": [adhoc_row("zoom-row", "zoom", "2026-08-19T10:00:05Z")],
        }));

        let found = pick_recent_adhoc_meeting(&meetings, "zoom", ts(ATTEMPT), ts(RETRY));

        assert_eq!(found.map(|m| m.id), Some("zoom-row".to_string()));
    }

    #[test]
    fn reconcile_ignores_a_previous_calls_row() {
        let meetings = parse_meetings(&serde_json::json!({
            "meetings": [adhoc_row("old-row", "zoom", "2026-08-19T09:30:00Z")],
        }));

        assert!(pick_recent_adhoc_meeting(&meetings, "zoom", ts(ATTEMPT), ts(RETRY)).is_none());
    }

    #[test]
    fn reconcile_ignores_a_scheduled_future_row() {
        let meetings = parse_meetings(&serde_json::json!({
            "meetings": [
                adhoc_row("this-call", "zoom", "2026-08-19T10:00:05Z"),
                adhoc_row("scheduled-later", "zoom", "2026-08-19T15:00:00Z"),
            ],
        }));

        assert_eq!(
            pick_recent_adhoc_meeting(&meetings, "zoom", ts(ATTEMPT), ts(RETRY)).map(|m| m.id),
            Some("this-call".to_string()),
            "a meeting that has not happened yet is not the row we just wrote"
        );
    }

    #[test]
    fn reconcile_stays_on_its_own_platform_and_source() {
        let meetings = parse_meetings(&serde_json::json!({
            "meetings": [
                adhoc_row("teams-row", "teams", "2026-08-19T10:00:05Z"),
                {
                    "id": "calendar-row",
                    "platform": "zoom",
                    "source": "calendar",
                    "scheduledStart": "2026-08-19T10:00:05Z",
                },
            ],
        }));

        assert!(
            pick_recent_adhoc_meeting(&meetings, "zoom", ts(ATTEMPT), ts(RETRY)).is_none(),
            "a Teams row and a calendar row are both the wrong meeting to adopt"
        );
    }

    #[test]
    fn reconcile_takes_the_newest_row_when_attempts_already_duplicated() {
        let meetings = parse_meetings(&serde_json::json!({
            "meetings": [
                adhoc_row("first", "zoom", "2026-08-19T10:00:05Z"),
                adhoc_row("second", "zoom", "2026-08-19T10:00:50Z"),
            ],
        }));

        assert_eq!(
            pick_recent_adhoc_meeting(&meetings, "zoom", ts(ATTEMPT), ts(RETRY)).map(|m| m.id),
            Some("second".to_string())
        );
    }

    #[test]
    fn reconcile_tolerates_clock_skew_on_both_window_edges() {
        let just_before = parse_meetings(&serde_json::json!({
            "meetings": [adhoc_row("zoom-row", "zoom", "2026-08-19T09:59:55Z")],
        }));
        assert_eq!(
            pick_recent_adhoc_meeting(&just_before, "zoom", ts(ATTEMPT), ts(RETRY)).map(|m| m.id),
            Some("zoom-row".to_string()),
            "a few seconds of skew must not hide the row we just created"
        );

        let just_after = parse_meetings(&serde_json::json!({
            "meetings": [adhoc_row("zoom-row", "zoom", "2026-08-19T10:01:05Z")],
        }));
        assert_eq!(
            pick_recent_adhoc_meeting(&just_after, "zoom", ts(ATTEMPT), ts(RETRY)).map(|m| m.id),
            Some("zoom-row".to_string()),
            "nor may it hide a row stamped a moment ahead of our clock"
        );

        assert!(
            RECONCILE_SKEW_SECS < CALL_END.as_secs() as i64,
            "the skew allowance must not reach into a previous call"
        );
    }

    #[test]
    fn an_unparseable_start_is_not_treated_as_a_match() {
        let meetings = parse_meetings(&serde_json::json!({
            "meetings": [
                { "id": "no-start", "platform": "zoom", "source": "adhoc" },
                adhoc_row("bad-start", "zoom", "not-a-timestamp"),
            ],
        }));

        assert!(
            pick_recent_adhoc_meeting(&meetings, "zoom", 0, ts(RETRY)).is_none(),
            "a row whose start cannot be read is not a row we can place in the window"
        );
    }

    #[test]
    fn a_body_that_is_not_a_meetings_list_is_unreadable_not_empty() {
        use crate::meetings_watcher::try_parse_meetings;

        assert!(
            try_parse_meetings(&serde_json::json!({ "error": "boom" })).is_none(),
            "an error payload says nothing about whether a row exists"
        );
        assert!(
            try_parse_meetings(&serde_json::json!({ "rows": [] })).is_none(),
            "a changed envelope is not an empty list"
        );
        assert_eq!(
            try_parse_meetings(&serde_json::json!({ "meetings": [] })).map(|rows| rows.len()),
            Some(0),
            "an actual empty list is the one answer that permits a create"
        );
        assert!(
            parse_meetings(&serde_json::json!({ "error": "boom" })).is_empty(),
            "read-only callers keep their lenient behavior"
        );
    }

    #[test]
    fn a_short_page_covers_the_reconcile_window() {
        let meetings = parse_meetings(&serde_json::json!({
            "meetings": [adhoc_row("only", "zoom", "2026-08-19T10:00:05Z")],
        }));

        assert!(
            reconcile_window_was_covered(&meetings, ts(RETRY)),
            "a page shorter than the limit is the whole result"
        );
    }

    #[test]
    fn a_full_page_ending_early_does_not_cover_the_window() {
        let rows: Vec<serde_json::Value> = (0..RECONCILE_PAGE_LIMIT)
            .map(|i| adhoc_row(&format!("row-{i}"), "teams", "2026-08-19T09:55:00Z"))
            .collect();
        let meetings = parse_meetings(&serde_json::json!({ "meetings": rows }));

        assert_eq!(meetings.len(), RECONCILE_PAGE_LIMIT);
        assert!(
            !reconcile_window_was_covered(&meetings, ts(RETRY)),
            "the row we want could sit past the cut"
        );
    }

    #[test]
    fn a_full_page_reaching_past_the_window_still_covers_it() {
        let mut rows: Vec<serde_json::Value> = (0..RECONCILE_PAGE_LIMIT - 1)
            .map(|i| adhoc_row(&format!("row-{i}"), "teams", "2026-08-19T09:55:00Z"))
            .collect();
        rows.push(adhoc_row("future", "teams", "2026-08-19T18:00:00Z"));
        let meetings = parse_meetings(&serde_json::json!({ "meetings": rows }));

        assert!(
            reconcile_window_was_covered(&meetings, ts(RETRY)),
            "the page ran past the window, so nothing inside it was cut off"
        );
    }

    #[test]
    fn an_unreadable_stream_hands_the_session_over_exactly_once() {
        let now = Instant::now();
        let mut evidence = CallEvidence::default();
        evidence.observe(ago(now, 300), Some(true), true);
        assert!(!evidence.take_mic_abstained());

        evidence.observe(ago(now, 200), None, true);
        assert!(
            !evidence.take_mic_abstained(),
            "inside the grace the stream still speaks for the call"
        );

        evidence.observe(now, None, true);
        assert!(
            evidence.take_mic_abstained(),
            "past the grace the session is handed to the fallback"
        );
        assert!(
            !evidence.take_mic_abstained(),
            "and handed over once, not on every later tick"
        );
    }

    #[test]
    fn a_confirmed_call_end_is_not_an_abstention() {
        let now = Instant::now();
        let mut evidence = CallEvidence::default();
        evidence.observe(ago(now, 90), Some(true), true);
        evidence.observe(ago(now, 60), Some(false), true);
        evidence.observe(now, Some(false), true);

        assert!(evidence.take_call_ended());
        assert!(
            !evidence.take_mic_abstained(),
            "the stream exercised its authority rather than losing it"
        );
    }

    #[test]
    fn unreadable_time_does_not_count_as_confirmed_silence() {
        let now = Instant::now();
        let mut evidence = CallEvidence::default();
        evidence.observe(ago(now, 120), Some(true), false);
        evidence.observe(ago(now, 118), Some(false), false);
        evidence.observe(ago(now, 100), None, false);
        evidence.observe(ago(now, 10), None, false);
        evidence.observe(now, Some(false), false);

        assert!(
            !evidence.take_call_ended(),
            "the silence clock restarts after time we could not read"
        );
    }

    #[test]
    fn ask_mode_prompts_without_auto_starting() {
        let plan = adhoc_notification_plan(&config_with(MeetingTranscriptionMode::Ask, false));
        assert!(plan.show_widget);
        assert!(!plan.auto_start);
    }

    #[test]
    fn auto_mode_prompts_and_starts() {
        let plan = adhoc_notification_plan(&config_with(MeetingTranscriptionMode::Auto, false));
        assert!(plan.show_widget);
        assert!(plan.auto_start);
    }

    #[test]
    fn manual_mode_stays_silent_only_when_the_widget_is_disabled() {
        let hidden = adhoc_notification_plan(&config_with(MeetingTranscriptionMode::Manual, false));
        assert!(!hidden.show_widget);
        assert!(!hidden.auto_start);

        let shown = adhoc_notification_plan(&config_with(MeetingTranscriptionMode::Manual, true));
        assert!(shown.show_widget);
        assert!(!shown.auto_start);
    }

    #[test]
    fn dismissal_suppresses_the_rest_of_the_call() {
        let now_ts = 1_000;
        let mut state = AdhocMeetingsWatcherInner::default();

        state.note_dismissed("zoom", now_ts);
        state.session_notified.remove("zoom");

        assert!(state.is_suppressed("zoom", now_ts + COOLDOWN_SECS - 1));
        assert!(!state.is_suppressed("zoom", now_ts + COOLDOWN_SECS));
    }

    #[test]
    fn dismissal_suppression_remains_platform_scoped() {
        let now_ts = 1_000;
        let mut state = AdhocMeetingsWatcherInner::default();

        state.note_dismissed("zoom", now_ts);

        assert!(state.is_suppressed("zoom", now_ts));
        assert!(!state.is_suppressed("teams", now_ts));
    }
}

fn reset_evidence(app: &AppHandle) {
    if let Some(state) = app.try_state::<AdhocMeetingsWatcherState>() {
        if let Ok(mut g) = state.inner.lock() {
            g.clear_tracking(chrono::Utc::now().timestamp());
        }
    }
}

async fn create_adhoc_meeting(
    app: &AppHandle,
    client: &reqwest::Client,
    platform: &str,
    reconcile_since: Option<i64>,
) -> Result<MeetingItem, CreateFailure> {
    let session = app
        .try_state::<MeetingsWatcherState>()
        .map(|s| s.session_snapshot())
        .unwrap_or_default();
    let Some(server_url) = session.server_url.as_deref() else {
        return Err(CreateFailure::NotCommitted(
            "no server_url for create-meeting".to_string(),
        ));
    };

    if let Some(since) = reconcile_since {
        match find_recent_adhoc_meeting(app, client, server_url, &session, platform, since).await {
            Ok(Some(existing)) => {
                dlog!(
                    "[clips-tray] adhoc reconciled to existing meeting {} for {}",
                    existing.id,
                    platform
                );
                return Ok(existing);
            }
            Ok(None) => {}
            Err(error) => {
                return Err(CreateFailure::Ambiguous(format!(
                    "adhoc reconcile unreadable for {platform}, not retrying create: {error}"
                )));
            }
        }
    }

    match find_calendar_meeting(app, client, server_url, &session, platform).await {
        Ok(Some(meeting)) => {
            dlog!(
                "[clips-tray] adhoc matched calendar meeting {} for {}",
                meeting.id,
                platform
            );
            return Ok(meeting);
        }
        Ok(None) => {}
        Err(error) => dlog!(
            "[clips-tray] adhoc calendar title lookup skipped for {}: {}",
            platform,
            error
        ),
    }

    let url = format!("{}/_agent-native/actions/create-meeting", server_url);
    let row_title = if platform == "zoom" {
        "Zoom meeting"
    } else {
        "Teams meeting"
    };
    let scheduled_start = chrono::Utc::now().to_rfc3339();
    let body = serde_json::json!({
        "title": row_title,
        "platform": platform,
        "source": "adhoc",
        "scheduledStart": scheduled_start,
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

    let resp = req.send().await.map_err(|e| {
        let message = format!("create-meeting fetch: {e}");
        if e.is_connect() || e.is_builder() {
            CreateFailure::NotCommitted(message)
        } else {
            CreateFailure::Ambiguous(message)
        }
    })?;
    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        let _ = app.emit("meetings:auth-needed", serde_json::json!({}));
        return Err(CreateFailure::NotCommitted(
            "create-meeting http 401".to_string(),
        ));
    }
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        let message = format!(
            "create-meeting http {} — {}",
            status,
            text.chars().take(180).collect::<String>()
        );
        return Err(if status.is_client_error() {
            CreateFailure::NotCommitted(message)
        } else {
            CreateFailure::Ambiguous(message)
        });
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| CreateFailure::Ambiguous(format!("create-meeting response: {e}")))?;
    let id = extract_meeting_id(&body).ok_or_else(|| {
        CreateFailure::Ambiguous(format!(
            "create-meeting response missing meeting id: {}",
            body.to_string().chars().take(200).collect::<String>()
        ))
    })?;
    Ok(MeetingItem {
        id,
        title: Some(row_title.to_string()),
        scheduled_start: Some(scheduled_start),
        scheduled_end: None,
        join_url: None,
        platform: Some(platform.to_string()),
        source: Some("adhoc".to_string()),
    })
}

async fn find_recent_adhoc_meeting(
    app: &AppHandle,
    client: &reqwest::Client,
    server_url: &str,
    session: &crate::meetings_watcher::MeetingsSessionSnapshot,
    platform: &str,
    since_ts: i64,
) -> Result<Option<MeetingItem>, String> {
    let now_ts = chrono::Utc::now().timestamp();
    let lookback_min = (((now_ts - since_ts).max(0) / 60) + 2).to_string();

    for page in 0..RECONCILE_MAX_PAGES {
        let offset = page * RECONCILE_PAGE_LIMIT;
        let rows = fetch_agenda_page(
            app,
            client,
            server_url,
            session,
            lookback_min.as_str(),
            offset,
        )
        .await?;

        if let Some(found) = pick_recent_adhoc_meeting(&rows, platform, since_ts, now_ts) {
            return Ok(Some(found));
        }
        if reconcile_window_was_covered(&rows, now_ts) {
            return Ok(None);
        }
    }

    Err(format!(
        "list-meetings did not reach the reconcile window within {RECONCILE_MAX_PAGES} pages"
    ))
}

async fn fetch_agenda_page(
    app: &AppHandle,
    client: &reqwest::Client,
    server_url: &str,
    session: &crate::meetings_watcher::MeetingsSessionSnapshot,
    lookback_min: &str,
    offset: usize,
) -> Result<Vec<MeetingItem>, String> {
    let page_limit = RECONCILE_PAGE_LIMIT.to_string();
    let offset = offset.to_string();
    let url = format!("{server_url}/_agent-native/actions/list-meetings");
    let mut req = client
        .get(url)
        .query(&[
            ("view", "agenda"),
            ("agendaLookbackMin", lookback_min),
            ("includeLiveCalendar", "false"),
            ("limit", page_limit.as_str()),
            ("offset", offset.as_str()),
        ])
        .header("X-Request-Source", "clips-desktop");
    if let Some(cookie) = session.session_cookie.as_deref() {
        req = req.header("Cookie", cookie);
    }
    if let Some(token) = session.auth_token.as_deref() {
        req = req.bearer_auth(token);
    }
    let response = req
        .send()
        .await
        .map_err(|error| format!("list-meetings fetch: {error}"))?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        let _ = app.emit("meetings:auth-needed", serde_json::json!({}));
        return Err("list-meetings http 401".to_string());
    }
    if !response.status().is_success() {
        return Err(format!("list-meetings http {}", response.status()));
    }
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("list-meetings response: {error}"))?;
    crate::meetings_watcher::try_parse_meetings(&body).ok_or_else(|| {
        format!(
            "list-meetings response was not a meetings list: {}",
            body.to_string().chars().take(200).collect::<String>()
        )
    })
}

fn reconcile_window_was_covered(meetings: &[MeetingItem], now_ts: i64) -> bool {
    if meetings.len() < RECONCILE_PAGE_LIMIT {
        return true;
    }
    let newest = meetings
        .iter()
        .filter_map(|m| m.scheduled_start.as_deref())
        .filter_map(|start| chrono::DateTime::parse_from_rfc3339(start).ok())
        .map(|start| start.timestamp())
        .max();
    newest.is_some_and(|newest| newest >= now_ts + RECONCILE_SKEW_SECS)
}

fn pick_recent_adhoc_meeting(
    meetings: &[MeetingItem],
    platform: &str,
    since_ts: i64,
    now_ts: i64,
) -> Option<MeetingItem> {
    let floor = since_ts - RECONCILE_SKEW_SECS;
    let ceiling = now_ts + RECONCILE_SKEW_SECS;
    meetings
        .iter()
        .filter(|m| m.source.as_deref() == Some("adhoc"))
        .filter(|m| {
            m.platform
                .as_deref()
                .is_some_and(|p| p.eq_ignore_ascii_case(platform))
        })
        .filter_map(|m| {
            let start = m.scheduled_start.as_deref()?;
            let ts = chrono::DateTime::parse_from_rfc3339(start)
                .ok()?
                .timestamp();
            (ts >= floor && ts <= ceiling).then_some((ts, m))
        })
        .max_by_key(|(ts, _)| *ts)
        .map(|(_, m)| m.clone())
}

async fn find_calendar_meeting(
    app: &AppHandle,
    client: &reqwest::Client,
    server_url: &str,
    session: &crate::meetings_watcher::MeetingsSessionSnapshot,
    platform: &str,
) -> Result<Option<MeetingItem>, String> {
    let url = format!("{server_url}/_agent-native/actions/list-meetings");
    let upcoming_within_min = CALENDAR_MATCH_WINDOW_MINUTES.to_string();
    let mut req = client.get(url).query(&[
        ("view", "upcoming"),
        ("limit", "20"),
        ("upcomingWithinMin", upcoming_within_min.as_str()),
        ("includeStartedWithinMin", "15"),
        ("excludePersonalSoloEvents", "true"),
        ("excludeDeclinedEvents", "true"),
    ]);
    req = req.header("X-Request-Source", "clips-desktop");
    if let Some(cookie) = session.session_cookie.as_deref() {
        req = req.header("Cookie", cookie);
    }
    if let Some(token) = session.auth_token.as_deref() {
        req = req.bearer_auth(token);
    }
    let response = req
        .send()
        .await
        .map_err(|error| format!("list-meetings fetch: {error}"))?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        let _ = app.emit("meetings:auth-needed", serde_json::json!({}));
        return Err("list-meetings http 401".to_string());
    }
    if !response.status().is_success() {
        return Err(format!("list-meetings http {}", response.status()));
    }
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("list-meetings response: {error}"))?;
    Ok(find_matching_calendar_meeting(
        &parse_meetings(&body),
        platform,
        chrono::Utc::now(),
    ))
}

fn extract_meeting_id(body: &serde_json::Value) -> Option<String> {
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
