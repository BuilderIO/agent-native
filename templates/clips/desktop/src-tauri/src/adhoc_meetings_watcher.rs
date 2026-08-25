//! Granola-style adhoc Zoom / Teams detection.
//!
//! Samples every known call app every few seconds and asks one question: is a
//! call underway? A live audio input stream held by Zoom or Teams answers yes
//! wherever their window sits, so the detection survives you joining and then
//! working in another app — the common case that foreground dwell alone missed
//! entirely. Foreground dwell remains the fallback for machines whose OS cannot
//! report input state at all. On a yes, creates a meeting row via
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

/// How often to sample call state.
const POLL_SECS: u64 = 4;

/// A live input stream held this long is a call, wherever its window sits.
const MIC_DWELL: Duration = Duration::from_secs(5);

/// Foreground-only dwell, used when the OS cannot report input state.
const FRONT_DWELL: Duration = Duration::from_secs(9);

/// A call app that just came forward gets this long to open an input stream
/// before a silent one counts as "not in a call". Joining muted, and the
/// seconds between the window appearing and the stream starting, both live in
/// here — at a 4-second sample rate, treating the first silent read as final is
/// how a real call goes undetected.
const JOIN_GRACE: Duration = Duration::from_secs(20);

/// A live stream that blips out for less than this is still the same call.
const MIC_DROP_GRACE: Duration = Duration::from_secs(8);

/// No live stream for this long ends the call, which releases the per-call
/// suppression so the next call gets its own prompt.
const CALL_END: Duration = Duration::from_secs(30);

/// Backstop for the fallback path, where there is no stream to signal the end
/// of a call. Short enough that a back-to-back block of calls still prompts.
const COOLDOWN_SECS: i64 = 8 * 60;

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
    /// platform -> what that platform has shown us so far.
    evidence: HashMap<String, CallEvidence>,
    /// Platforms already notified for the current call.
    session_notified: HashMap<String, bool>,
}

/// Whether a call is underway on one platform.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CallState {
    /// Confirmed: prompt for it.
    Live,
    /// Might still become a call — hold the accumulated evidence.
    Pending,
    /// No call, and no reason to keep waiting.
    Idle,
}

/// What one platform has shown us across the current run of ticks.
#[derive(Debug, Default, Clone, Copy)]
struct CallEvidence {
    /// When it became frontmost, in the current unbroken foreground run.
    front_since: Option<Instant>,
    /// When its live input stream first appeared in the current call.
    mic_since: Option<Instant>,
    /// The most recent tick that saw a live input stream.
    mic_last_true: Option<Instant>,
}

impl CallEvidence {
    fn observe(&mut self, now: Instant, mic: Option<bool>, frontmost: bool) {
        if frontmost {
            self.front_since.get_or_insert(now);
        } else {
            self.front_since = None;
        }
        if mic == Some(true) {
            self.mic_last_true = Some(now);
            self.mic_since.get_or_insert(now);
        } else if self
            .mic_lost_for(now)
            .is_some_and(|lost| lost >= MIC_DROP_GRACE)
        {
            // Keep `mic_last_true`: it is what dates the end of the call.
            self.mic_since = None;
        }
    }

    fn mic_lost_for(&self, now: Instant) -> Option<Duration> {
        self.mic_last_true
            .map(|last| now.saturating_duration_since(last))
    }

    fn mic_live(&self, now: Instant, mic: Option<bool>) -> bool {
        mic == Some(true)
            || self
                .mic_lost_for(now)
                .is_some_and(|lost| lost < MIC_DROP_GRACE)
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
            // The OS declined to answer — `kAudioProcessPropertyIsRunningInput`
            // is macOS 14+ — so foreground dwell is the only evidence there is.
            // Requiring a stream here would leave older machines detecting
            // nothing at all.
            None => {
                if front_for >= FRONT_DWELL {
                    CallState::Live
                } else {
                    CallState::Pending
                }
            }
            // A definite no. Wait out the join grace, then stop: past it, a
            // silent Zoom window is Zoom parked open, which is the noise that
            // got prompting muted in the first place.
            _ => {
                if front_for < JOIN_GRACE {
                    CallState::Pending
                } else {
                    CallState::Idle
                }
            }
        }
    }

    /// True once, when a live call has been gone long enough to count as over.
    fn take_call_ended(&mut self, now: Instant) -> bool {
        if self.mic_since.is_some() {
            return false;
        }
        let ended = self.mic_lost_for(now).is_some_and(|lost| lost >= CALL_END);
        if ended {
            self.mic_last_true = None;
        }
        ended
    }
}

impl AdhocMeetingsWatcherInner {
    fn refresh_suppression(&mut self, platform: &str, now_ts: i64) {
        self.session_notified.insert(platform.to_string(), true);
        self.cooldown_until
            .insert(platform.to_string(), now_ts + COOLDOWN_SECS);
    }

    fn is_suppressed(&self, platform: &str, now_ts: i64) -> bool {
        self.cooldown_until.get(platform).copied().unwrap_or(0) > now_ts
            || self
                .session_notified
                .get(platform)
                .copied()
                .unwrap_or(false)
    }

    /// The current call is over: prompt again for the next one.
    fn end_call_session(&mut self, platform: &str) {
        self.session_notified.remove(platform);
        self.cooldown_until.remove(platform);
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
    g.refresh_suppression(&platform, chrono::Utc::now().timestamp());
    Ok(())
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

/// One entry per platform, with the title its notification should carry.
fn platform_titles() -> Vec<(&'static str, &'static str)> {
    let mut out: Vec<(&'static str, &'static str)> = Vec::new();
    for (_, platform, title) in STRONG_VC_BUNDLES {
        if !out.iter().any(|(known, _)| known == platform) {
            out.push((*platform, *title));
        }
    }
    out
}

/// Bundle ids belonging to one platform, lowercased for CoreAudio comparison.
///
/// Scoped per platform rather than every call app: Teams sitting in a call must
/// not vouch for a Zoom window that is merely open.
fn bundles_for_platform(platform: &str) -> Vec<String> {
    STRONG_VC_BUNDLES
        .iter()
        .filter(|(_, candidate, _)| *candidate == platform)
        .map(|(bundle_id, _, _)| bundle_id.to_lowercase())
        .collect()
}

/// What a confirmed detection is allowed to do under the current mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct AdhocNotificationPlan {
    /// Surface the meeting-notification overlay so the user can accept.
    show_widget: bool,
    /// Begin transcription without waiting for a click.
    auto_start: bool,
}

/// Ask must surface the overlay. Collapsing this gate to `mode == Auto` is the
/// regression that shipped in b00c38db4: Ask is the shipped default, so ad-hoc
/// detection produced neither a prompt nor a capture and went silently dead.
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
    // Skip while already transcribing a meeting.
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

    // Read every platform, not just the frontmost one. A call holds its input
    // stream open while you take notes elsewhere, read Slack, or share a doc,
    // so that stream is the evidence that survives leaving the meeting window.
    let mut confirmed: Option<(&'static str, &'static str)> = None;
    for (platform, title) in platform_titles() {
        let mic = crate::call_activity::call_app_uses_microphone(&bundles_for_platform(platform));
        let frontmost = front_platform == Some(platform);

        let state = app
            .try_state::<AdhocMeetingsWatcherState>()
            .ok_or_else(|| "no AdhocMeetingsWatcherState".to_string())?;
        let mut g = state.inner.lock().map_err(|e| e.to_string())?;
        g.cooldown_until.retain(|_, until| *until > now_ts);

        let (call_state, call_ended, mic_live) = {
            let evidence = g.evidence.entry(platform.to_string()).or_default();
            evidence.observe(now, mic, frontmost);
            (
                evidence.classify(now, mic, frontmost),
                evidence.take_call_ended(now),
                evidence.mic_live(now, mic),
            )
        };

        // A finished call releases both suppressions, so the next call in a
        // back-to-back block gets its own prompt instead of inheriting one.
        if call_ended {
            g.end_call_session(platform);
        }
        // No stream and not even in the foreground: whatever we prompted for is
        // over. This is also the only session-end signal on a machine that
        // cannot report input state.
        if !mic_live && !frontmost {
            g.session_notified.remove(platform);
        }

        if confirmed.is_none()
            && call_state == CallState::Live
            && !g.is_suppressed(platform, now_ts)
        {
            confirmed = Some((platform, title));
        }
    }

    let Some((platform, title)) = confirmed else {
        return Ok(());
    };

    // Soft guard against double-prompting after a calendar reminder.
    if let Some(state) = app.try_state::<MeetingsWatcherState>() {
        if state.recent_calendar_notify(platform, CALENDAR_SOFT_GUARD_SECS) {
            dlog!(
                "[clips-tray] adhoc skip: recent calendar notify for {}",
                platform
            );
            return Ok(());
        }
    }

    {
        let state = app
            .try_state::<AdhocMeetingsWatcherState>()
            .ok_or_else(|| "no AdhocMeetingsWatcherState".to_string())?;
        let mut g = state.inner.lock().map_err(|e| e.to_string())?;
        g.refresh_suppression(platform, now_ts);
    }

    dlog!(
        "[clips-tray] adhoc call confirmed for {} — creating meeting",
        platform
    );

    let meeting_id = match create_adhoc_meeting(app, client, platform).await {
        Ok(id) => id,
        Err(err) => {
            // Allow retry on the next tick if create failed.
            if let Some(state) = app.try_state::<AdhocMeetingsWatcherState>() {
                if let Ok(mut g) = state.inner.lock() {
                    g.end_call_session(platform);
                }
            }
            return Err(err);
        }
    };

    let AdhocNotificationPlan {
        show_widget,
        auto_start,
    } = adhoc_notification_plan(config);

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

    /// `Instant` has no constructor, and subtracting past boot panics, so age
    /// every fixture from a single `now` and clamp.
    fn ago(now: Instant, secs: u64) -> Instant {
        now.checked_sub(Duration::from_secs(secs)).unwrap_or(now)
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

    #[test]
    fn every_platform_is_sampled_once() {
        let platforms = platform_titles();
        assert_eq!(platforms.len(), 2);
        assert!(platforms.iter().any(|(p, _)| *p == "zoom"));
        assert!(platforms.iter().any(|(p, _)| *p == "teams"));
    }

    #[test]
    fn a_live_stream_confirms_a_call_from_the_background() {
        // The whole point of the rewrite: join a call, switch to Slack, and the
        // detection still lands. Foreground dwell alone missed this entirely.
        let now = Instant::now();
        let evidence = CallEvidence {
            front_since: None,
            mic_since: Some(ago(now, 6)),
            mic_last_true: Some(now),
        };
        assert_eq!(
            evidence.classify(now, Some(true), false),
            CallState::Live,
            "a backgrounded call app holding a live input stream is a call"
        );
    }

    #[test]
    fn a_live_stream_still_debounces() {
        let now = Instant::now();
        let evidence = CallEvidence {
            front_since: None,
            mic_since: Some(ago(now, 2)),
            mic_last_true: Some(now),
        };
        assert_eq!(
            evidence.classify(now, Some(true), false),
            CallState::Pending
        );
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
        // Joining muted, and the seconds before Zoom opens its input, both read
        // as Some(false). Treating the first one as final is a missed meeting.
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
        // `kAudioProcessPropertyIsRunningInput` is macOS 14+. Requiring a
        // stream would leave every older machine detecting nothing at all.
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
        evidence.observe(now, Some(false), true);

        assert!(
            evidence.take_call_ended(now),
            "no stream for 30s ends the call even with the window still front"
        );
        assert!(
            !evidence.take_call_ended(now),
            "the end of a call fires once, not on every later tick"
        );

        let mut state = AdhocMeetingsWatcherInner::default();
        state.refresh_suppression("zoom", 1_000);
        assert!(state.is_suppressed("zoom", 1_001));
        state.end_call_session("zoom");
        assert!(
            !state.is_suppressed("zoom", 1_001),
            "back-to-back calls each get their own prompt"
        );
    }

    #[test]
    fn ask_mode_prompts_without_auto_starting() {
        // The b00c38db4 regression: Ask is the shipped default, so if this
        // stops surfacing the overlay, ad-hoc detection is dead for everyone
        // who never opened Settings.
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

        state.refresh_suppression("zoom", now_ts);

        assert!(state.is_suppressed("zoom", now_ts + COOLDOWN_SECS - 1));
        assert!(
            state.is_suppressed("zoom", now_ts + COOLDOWN_SECS),
            "an expired cooldown must not re-prompt inside the same call"
        );
        state.session_notified.remove("zoom");
        assert!(!state.is_suppressed("zoom", now_ts + COOLDOWN_SECS));
    }

    #[test]
    fn dismissal_suppression_remains_platform_scoped() {
        let now_ts = 1_000;
        let mut state = AdhocMeetingsWatcherInner::default();

        state.refresh_suppression("zoom", now_ts);

        assert!(state.is_suppressed("zoom", now_ts));
        assert!(!state.is_suppressed("teams", now_ts));
    }
}

fn reset_evidence(app: &AppHandle) {
    if let Some(state) = app.try_state::<AdhocMeetingsWatcherState>() {
        if let Ok(mut g) = state.inner.lock() {
            g.evidence.clear();
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
