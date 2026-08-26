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

/// How often to sample the frontmost app.
const POLL_SECS: u64 = 2;

/// A live input stream held this long is a call, wherever its window sits.
const MIC_DWELL: Duration = Duration::from_secs(5);

/// Foreground-only dwell, used when the OS cannot report input state.
const FRONT_DWELL: Duration = Duration::from_secs(9);

/// A call app that just came forward gets this long to open an input stream
/// before a silent one counts as "not in a call". Joining muted, and the
/// seconds between the window appearing and the stream starting, both live
/// here: treating the first silent read as final is how a real call goes
/// undetected.
const JOIN_GRACE: Duration = Duration::from_secs(20);

/// A live stream that blips out for less than this is still the same call.
const MIC_DROP_GRACE: Duration = Duration::from_secs(8);

/// How long an unreadable input state keeps vouching for a stream that was live
/// a moment ago. Unreadable is not silence, so it must never end a call — but
/// it cannot vouch forever either, or a machine whose CoreAudio stopped
/// answering would hold a finished call open and never prompt again. Past this
/// the mic has nothing to say and the foreground fallback decides.
const MIC_UNREADABLE_GRACE: Duration = Duration::from_secs(45);

/// No live stream for this long ends the call, which releases the per-call
/// suppression so the next call gets its own prompt.
const CALL_END: Duration = Duration::from_secs(30);

/// Backstop for the fallback path, where there is no stream to signal the end
/// of a call. Short enough that a back-to-back block of calls still prompts.
const COOLDOWN_SECS: i64 = 8 * 60;

/// Soft guard: skip adhoc if a calendar reminder for the same platform fired
/// this recently.
const CALENDAR_SOFT_GUARD_SECS: i64 = 3 * 60;

/// How long a failed `create-meeting` waits before the same call tries again.
/// The evidence still says a call is underway, so without a backoff the retry
/// lands on the next tick and every tick after it.
const CREATE_RETRY_BACKOFF_SECS: i64 = 60;

/// How long an unresolved `create-meeting` attempt keeps forcing a reconcile
/// before the next attempt for the same call. Bounded on purpose: a doubt
/// pinned to a call whose end the watcher can no longer observe would
/// eventually let a *new* call adopt the old call's row. Long enough to cover
/// several backoff retries of a server outage, short enough that the window in
/// which that mis-adoption is possible stays narrow.
const CREATE_DOUBT_TTL_SECS: i64 = 5 * 60;

/// Slack on the reconcile window's edges. `scheduledStart` is stamped by this
/// process but read back through the server, so allow a little clock skew rather
/// than missing the row we are looking for by one second.
const RECONCILE_SKEW_SECS: i64 = 10;

/// Rows per reconcile page. The agenda view is ascending from the start of the
/// lookback, so the row a lost response created sits near the front of it; this
/// only has to exceed the number of meetings that can start inside one
/// reconcile window. A full page is treated as possibly truncated rather than
/// assumed complete, so raising this trades a bigger response for fewer
/// abandoned retries — it is not what makes the lookup correct.
const RECONCILE_PAGE_LIMIT: usize = 200;

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
    /// platform -> unix-seconds until which an auto-prompt is held back. This
    /// is the backstop for the fallback path, where nothing but the foreground
    /// can say a call is over.
    prompt_cooldown_until: HashMap<String, i64>,
    /// platform -> unix-seconds until which a user dismissal holds. Kept apart
    /// from the prompt backstop because the fallback's coarse "left the window"
    /// signal must not undo a choice the user made on purpose.
    dismissed_until: HashMap<String, i64>,
    /// platform -> what that platform has shown us so far.
    evidence: HashMap<String, CallEvidence>,
    /// Platforms already notified for the current call.
    session_notified: HashMap<String, bool>,
    /// platform -> unix-seconds of the earliest `create-meeting` attempt for
    /// the current call whose outcome could not be read. A lost response is not
    /// a failed write, so while an entry stands the next attempt must look for
    /// the row the last one may already have committed instead of inserting a
    /// second one. Earliest, not latest: any attempt in the run could be the
    /// one that landed, so the reconcile window has to reach back to the first.
    create_in_doubt_since: HashMap<String, i64>,
}

/// Why a `create-meeting` attempt failed — specifically, whether it could have
/// committed. Collapsing these two into one error is what turns a lost response
/// into a duplicate meeting row: the retry cannot tell "the write never
/// happened" from "the write happened and the answer went missing".
#[derive(Debug)]
enum CreateFailure {
    /// Rejected before any insert could run, so nothing was written.
    NotCommitted(String),
    /// Unreadable outcome: the row may or may not exist.
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
    /// Start of the current unbroken run of reads that say there is no stream.
    /// Only `Some(false)` lands here. An unreadable read is not evidence of
    /// silence, and silence is the only thing allowed to end a call.
    mic_silent_since: Option<Instant>,
    /// Start of the current unbroken run of unreadable (`None`) reads.
    mic_unreadable_since: Option<Instant>,
    /// Set at a call boundary, reported once by `take_call_ended`.
    call_ended: bool,
    /// Set once when a readable stream stops being able to speak for the call,
    /// reported by `take_mic_abstained`.
    mic_abstained: bool,
    /// Whether the stream was the authority as of the previous tick, so the
    /// moment it stops being one can be caught as an edge rather than a state.
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
                // A stream returning inside `CALL_END` is the same call coming
                // back, not the next one. `MIC_DROP_GRACE` having cleared
                // `mic_since` only restarts the dwell; treating that as a new
                // call would prompt a second time for one ordinary blip.
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
            // The OS could not answer. That is not a "no": the stream timers
            // stay where they are so an unreadable stretch neither starts a
            // call nor ends one. The silence run does break, though — time we
            // could not read is not time we watched go quiet, and counting it
            // would let one `Some(false)` afterwards satisfy `CALL_END` on its
            // own and end a call that may never have stopped.
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

    /// Close the current call: report the boundary once, and drop the evidence
    /// that only describes the call that just ended.
    fn end_call(&mut self, now: Instant) {
        self.call_ended = true;
        self.mic_since = None;
        self.mic_last_true = None;
        self.mic_silent_since = None;
        // A call that ended on the stream's own verdict has not lost its
        // authority — it exercised it. Only an unreadable stretch abstains.
        self.mic_was_authoritative = false;
        // The next call may start muted in this same still-frontmost window.
        // An untouched foreground age would be past `JOIN_GRACE` already and
        // read as a window merely parked open, so re-arm the grace here.
        if self.front_since.is_some() {
            self.front_since = Some(now);
        }
    }

    /// Whether a stream has spoken for this platform at all in the current
    /// call. While one has, the window is not evidence about anything.
    fn mic_ever_spoke(&self) -> bool {
        self.mic_last_true.is_some() || self.mic_since.is_some()
    }

    /// Whether the stream is still the authority on when this call ends. It is,
    /// right up until an unreadable run outlives its grace — at which point we
    /// genuinely do not know, and the coarse foreground signal is all that is
    /// left. Holding "authoritative" through an unbounded unreadable stretch is
    /// what would strand a platform: the flag that suppression hangs on has no
    /// clock of its own, so nothing would ever release it.
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
        // Only an established stream earns a grace period. A stream seen on one
        // tick and gone on the next is a device probe or a notification sound;
        // bridging that gap would let `mic_since` age past `MIC_DWELL` while
        // nothing was running and confirm a call that never happened.
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

    /// True once per call boundary: either a confirmed run of silence long
    /// enough to be the end of the call, or a fresh stream that can only be the
    /// next one. An unreadable input state is neither, so it never fires here —
    /// releasing the per-call suppression on a state we could not read is how
    /// the same call gets prompted twice.
    fn take_call_ended(&mut self) -> bool {
        std::mem::take(&mut self.call_ended)
    }

    /// True once, at the moment a readable stream becomes unreadable for longer
    /// than its grace. Not a call end — we do not know that — but a change of
    /// regime, after which only the foreground has anything to say.
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

    /// The current call is confirmed over: prompt again for the next one, even
    /// if the user dismissed this one.
    fn end_call_session(&mut self, platform: &str) {
        self.session_notified.remove(platform);
        self.prompt_cooldown_until.remove(platform);
        self.dismissed_until.remove(platform);
        // The doubt belonged to the call that just ended. Carrying it into the
        // next call would make that call adopt the previous call's row.
        self.create_in_doubt_since.remove(platform);
    }

    /// A create failed. Let the same call try again, but not on the next tick:
    /// the evidence is untouched, so it reconfirms immediately.
    ///
    /// `ambiguous` is the part that matters. Backoff alone cannot make a
    /// non-idempotent create safe — it only decides *when* the duplicate is
    /// inserted — so an attempt that may have committed has to be remembered
    /// and reconciled before the next one runs.
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

    /// A create resolved: there is a row, and we know its id.
    fn note_create_resolved(&mut self, platform: &str) {
        self.create_in_doubt_since.remove(platform);
    }

    /// Hold back the platforms that lost this poll's tie-break, now that the
    /// selected platform has actually produced a meeting row.
    ///
    /// Deliberately not a prompt cooldown: these platforms were never prompted
    /// for. Giving them one would mute a live call for eight minutes on the
    /// strength of a different call winning a coin toss, which is the same
    /// defect one layer down. The bare flag is released by the platform's own
    /// call end — or, on the fallback path, by the boundaries that keep it from
    /// stranding — and either way what follows is the prompt it never got.
    fn defer_secondary_candidates(&mut self, platforms: &[&str]) {
        for platform in platforms {
            self.session_notified.insert((*platform).to_string(), true);
        }
    }

    /// The attempt timestamp a retry for this platform must reconcile against,
    /// or `None` when no attempt is outstanding.
    fn create_doubt_since(&self, platform: &str) -> Option<i64> {
        self.create_in_doubt_since.get(platform).copied()
    }

    /// Stop tracking calls entirely: the feature is off, or a meeting is
    /// already being transcribed.
    ///
    /// The evidence that would have released `session_notified` is going away,
    /// so that flag cannot stay as it is — nothing would ever clear it. It also
    /// cannot simply be dropped: transcription can stop while the call and its
    /// stream keep running, and a blank slate re-detects that call within one
    /// `MIC_DWELL` and prompts for it again. So it becomes the cooldown, which
    /// is bounded: a call that outlives transcription stays suppressed, and a
    /// platform is never suppressed for longer than the cooldown. A dismissal
    /// already has its own clock and is left alone.
    fn clear_tracking(&mut self, now_ts: i64) {
        self.evidence.clear();
        // Whatever call the doubt belonged to, we are no longer tracking it, so
        // there is nothing left to tie a found row to.
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

        // An attempt we never managed to settle must not quietly become a fresh
        // insert. Dropping the marker alone would do exactly that: the next tick
        // would find no doubt, skip the reconcile, and bare-insert a row that may
        // already exist. So expiry hands the platform a normal cooldown instead
        // — the write we cannot see stays un-duplicated, and the platform is
        // picked up again after it, by which point a new attempt is far more
        // likely to be a genuinely new call than a retry of this one.
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

/// One entry per platform, with the title its notification falls back to.
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
/// Scoped to the frontmost platform rather than every call app: Teams sitting
/// in a call must not vouch for a Zoom window that is merely open.
fn bundles_for_platform(platform: &str) -> Vec<String> {
    STRONG_VC_BUNDLES
        .iter()
        .filter(|(_, candidate, _)| *candidate == platform)
        .map(|(bundle_id, _, _)| bundle_id.to_lowercase())
        .collect()
}

/// What a dwell-confirmed detection is allowed to do under the current mode.
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

        // A finished call releases every suppression, so the next call in a
        // back-to-back block gets its own prompt instead of inheriting one.
        // This is the stream's verdict, and the only thing that clears the
        // cooldown: nothing below can prove a call ended, only that we stopped
        // being able to see it.
        if call_ended {
            g.end_call_session(platform);
        }
        // `session_notified` is the flag with no clock of its own, so it needs
        // releasing on evidence weaker than a call end or it strands the
        // platform. Both releases below leave the prompt cooldown standing,
        // which is what bounds a duplicate prompt in the meantime.
        //
        // Losing the window is not proof a call ended — on the fallback path,
        // switching to Slack mid-call looks exactly the same — so it may only
        // release the flag while the stream is not speaking for the call.
        if !mic_live && !frontmost && !mic_authoritative {
            g.session_notified.remove(platform);
        }
        // The stream just stopped being readable. The window may never change
        // again, so this edge is the only chance to hand the session to the
        // fallback; without it a later call in a still-frontmost window has no
        // boundary left that could ever release the flag.
        if mic_abstained {
            g.session_notified.remove(platform);
        }

        if call_state == CallState::Live && !g.is_suppressed(platform, now_ts) {
            if confirmed.is_none() {
                confirmed = Some((platform, fallback));
            } else {
                // One poll prompts for one call. A second platform holding a
                // stream at the same moment would otherwise be untouched here
                // and confirm on the very next tick, so a single moment of
                // overlap becomes a second meeting two seconds later.
                //
                // Only note it, though — suppressing it here would spend the
                // selected platform's failure on it. If the selected flow then
                // errors or is skipped by the calendar guard, the platform that
                // lost the tie is the only live call left, and marking it
                // already would have hidden it for the rest of its run.
                deferred.push(platform);
            }
        }
    }

    let Some((platform, fallback_title)) = confirmed else {
        return Ok(());
    };

    // Soft guard against double-prompting after a calendar reminder.
    if let Some(state) = app.try_state::<MeetingsWatcherState>() {
        if state.recent_calendar_notify(platform, CALENDAR_SOFT_GUARD_SECS) {
            dlog!(
                "[clips-tray] adhoc skip: recent calendar notify for {}",
                platform
            );
            // The calendar reminder owns this call, so record it as handled
            // rather than just skipping the tick. Leaving it unmarked keeps the
            // call eligible on every later tick, and the moment the guard
            // expires the same call prompts again — the double-prompt this
            // guard exists to prevent, three minutes late.
            //
            // Recorded exactly like a prompt, cooldown included. The flag alone
            // is released by the window changing, which on a machine with no
            // readable stream is just the user checking Slack — so without the
            // cooldown the guard lasts only until they come back.
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
            // Retry, but not on the very next tick. The evidence is untouched,
            // so the call reconfirms immediately and would re-submit every two
            // seconds for as long as the call runs. Backoff only spaces the
            // attempts out, though — an attempt whose outcome we could not read
            // is recorded as such so the next one reconciles instead of
            // inserting a second row for the same call.
            if let Some(state) = app.try_state::<AdhocMeetingsWatcherState>() {
                if let Ok(mut g) = state.inner.lock() {
                    g.note_create_failed(platform, now_ts, failure.is_ambiguous());
                }
            }
            return Err(failure.message().to_string());
        }
    };

    // The selected flow produced a row, so the tie-break above is now settled
    // and the platforms that lost it can be held back. Their own call end
    // releases them again.
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
        // Awaiting the notification above orders the *events*, but it cannot
        // make a webview that has not mounted yet receive one. A cold overlay
        // misses both the show and the hide, then hydrates `pending` on mount
        // and asks "Take notes?" about a meeting already recording. Nothing is
        // being asked here, so the stored payload goes away with the question.
        crate::notifications::clear_pending_meeting_notification(app, &meeting.id);
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

    /// `Instant` has no constructor, and subtracting past boot panics, so age
    /// every fixture from a single `now` and clamp.
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
        // The whole point: join a call, switch to Slack, and detection still
        // lands. Foreground dwell alone missed this entirely.
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
        // A notification sound or a device probe holds the input for one tick.
        // The drop grace used to bridge it while `mic_since` kept ageing, so at
        // t=6 the dwell looked satisfied and a meeting was created for a stream
        // that ran for two seconds.
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
        // The counterpart: once a stream has run long enough to be confirmed, a
        // short gap must not drop it back out.
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
        // CoreAudio returning `None` mid-call is a read failure, not silence.
        // Ending the call here releases the per-call suppression, so the same
        // call gets prompted a second time once readable samples resume.
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
        // Unreadable cannot vouch for a live stream forever, or a machine whose
        // CoreAudio stopped answering would hold a finished call open. Past the
        // grace the mic abstains and foreground dwell decides — but it still
        // reports no call end, because nothing confirmed one.
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
        // `CALL_END` is what separates two calls. A stream returning inside it
        // is one call blipping, so it must not report a boundary — that would
        // release the suppression and prompt a second time for one call.
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
        // The window must not pre-empt the stream. `mic_live` goes false after
        // 8s of silence, but the call is not over until 30s — releasing
        // suppression in between lets one call prompt twice.
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
        // Past the unreadable grace we genuinely do not know. The prompt
        // cooldown expires on its own, so it can stay; `session_notified`
        // cannot, so it must go or the platform is stranded for good.
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
        // Zoom never left the foreground, so without re-arming the grace the
        // next call reads as a window parked open and stays Idle forever.
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
        // On the fallback path, switching to Slack mid-call is indistinguishable
        // from the call ending. Releasing the cooldown there would re-prompt
        // the same still-running call the moment the user came back, so only a
        // confirmed call end may clear it.
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
        // Transcription starts, so the watcher stops sampling. The per-call flag
        // cannot stay (nothing would be left to release it) and cannot simply
        // go (stopping notes mid-call would re-prompt the call still running),
        // so it becomes the cooldown, which expires on its own.
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
        // The evidence still says a call is underway, so the retry lands on the
        // next two-second tick and every tick after it — and a create that
        // committed but lost its response leaves a row per attempt.
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
        // Any attempt in the run could be the one that landed, so the window has
        // to reach back to the earliest — a later timestamp would look right past
        // the row the first attempt created.
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
        // Otherwise the next call reconciles against the previous call's row and
        // adopts it, attaching this call's notes to the wrong meeting.
        let now_ts = 1_000;
        let mut state = AdhocMeetingsWatcherInner::default();
        state.note_create_failed("zoom", now_ts, true);

        state.end_call_session("zoom");

        assert_eq!(state.create_doubt_since("zoom"), None);
    }

    #[test]
    fn an_unresolved_create_doubt_expires_into_a_cooldown() {
        // The doubt is pinned to one call. On the fallback path the watcher may
        // never see that call end, so the marker needs a clock of its own — but
        // expiring it on its own would let the next tick skip the reconcile and
        // bare-insert a row that may already exist.
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
        // Both platforms confirmed on one poll. Until the selected platform
        // actually produces a meeting, the loser must stay eligible — if the
        // selected flow errors or the calendar guard skips it, the loser is the
        // only live call left and it is the one the user wants.
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

        // The selected platform's create failed, so the deferral never happens.
        state.note_create_failed("zoom", now_ts, true);

        assert!(
            !state.is_suppressed("teams", now_ts),
            "the other live call must still be promptable on the next tick"
        );
    }

    #[test]
    fn a_calendar_guarded_platform_yields_the_next_poll_to_the_other_call() {
        // The guard records the skip exactly like a prompt, cooldown included,
        // so the guarded platform stops being first in line. A concurrent call
        // on the other platform is selected one tick later, not starved.
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

    /// The attempt that went unanswered, and the retry reading back a minute on.
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
        // The row predates the attempt, so it belongs to an earlier call.
        // Adopting it would file this call's notes under that meeting.
        let meetings = parse_meetings(&serde_json::json!({
            "meetings": [adhoc_row("old-row", "zoom", "2026-08-19T09:30:00Z")],
        }));

        assert!(pick_recent_adhoc_meeting(&meetings, "zoom", ts(ATTEMPT), ts(RETRY)).is_none());
    }

    #[test]
    fn reconcile_ignores_a_scheduled_future_row() {
        // The agenda view runs from the lookback "onward" with no upper bound,
        // so a future ad-hoc row for this platform comes back too — and on
        // recency alone it would beat the row this call actually created.
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
        // `scheduledStart` is stamped here but read back through the server.
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
        // The defect this guards: `parse_meetings` flattens an unknown envelope
        // to an empty vector, so a 200 error payload would read as a checked
        // "no such meeting" and the retry would insert the duplicate.
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
        // Ascending agenda order means a truncated page proves only what it
        // reached. Concluding "no row" from it would insert the duplicate.
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
        // The window may never change again, so the moment the stream stops
        // being readable is the only boundary left to release the flag on.
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
        // The unreadable stretch may have been full of audio. Counting it would
        // let the first `Some(false)` afterwards satisfy CALL_END on its own and
        // end a call that never stopped.
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

    // A previous attempt for this same call may have committed before its
    // response went missing. `create-meeting` is only idempotent on its
    // `calendarEventId` path (that one claims the event row atomically); the
    // ad-hoc path is a bare insert, so nothing server-side collapses a second
    // attempt into the first. Until it has an idempotency key, the only way not
    // to leave one row per attempt is to go looking for the first row.
    //
    // Before the calendar lookup, not after. A retry whose calendar match has
    // since become resolvable would otherwise return that calendar meeting, and
    // the caller would clear the doubt against it — stranding the ad-hoc row the
    // earlier attempt actually wrote, with nothing left that would ever find it.
    // An outstanding write is settled first; enrichment is what happens on a
    // call that has no row yet.
    //
    // A lookup that fails is not a lookup that found nothing. Treating an
    // unreadable reconcile as "no existing row" would insert the duplicate this
    // whole path exists to avoid, so it abandons the attempt and stays in doubt
    // for the next tick instead.
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

    // The native watcher knows which conferencing app is active, but not the
    // calendar event title. Resolve the nearest joinable event first so a
    // calendar-backed meeting keeps its title, URL, and scheduled span. A
    // disconnected calendar only loses that enrichment and still gets an
    // adhoc meeting below.
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
        // A request that never opened a connection cannot have written
        // anything. Everything else here — a timeout above all — may have been
        // answered by a handler that had already committed.
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
        // A 4xx is the action refusing the request, so no row exists. A 5xx can
        // be raised after the insert committed — by the app-state write or the
        // read-back that follows it — so it has to be treated as unresolved.
        return Err(if status.is_client_error() {
            CreateFailure::NotCommitted(message)
        } else {
            CreateFailure::Ambiguous(message)
        });
    }
    // Past here the server returned success, so a row exists. Anything we then
    // fail to read about it leaves us holding a committed write we cannot name.
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

/// Look for the ad-hoc row an earlier unanswered attempt may already have
/// created for this call.
///
/// Reads persisted rows only: a live calendar event cannot be what a
/// `create-meeting` insert left behind, and asking for them would make this
/// lookup depend on the calendar being reachable.
async fn find_recent_adhoc_meeting(
    app: &AppHandle,
    client: &reqwest::Client,
    server_url: &str,
    session: &crate::meetings_watcher::MeetingsSessionSnapshot,
    platform: &str,
    since_ts: i64,
) -> Result<Option<MeetingItem>, String> {
    let now_ts = chrono::Utc::now().timestamp();
    // Reach back to the earliest attempt still in doubt, plus a minute so the
    // window cannot close on the row it is looking for.
    let lookback_min = (((now_ts - since_ts).max(0) / 60) + 2).to_string();
    let page_limit = RECONCILE_PAGE_LIMIT.to_string();
    let url = format!("{server_url}/_agent-native/actions/list-meetings");
    let mut req = client
        .get(url)
        .query(&[
            ("view", "agenda"),
            ("agendaLookbackMin", lookback_min.as_str()),
            ("includeLiveCalendar", "false"),
            ("limit", page_limit.as_str()),
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
    // A 200 whose body is not a meetings list — an error payload, or a changed
    // envelope — is unreadable, not empty. `parse_meetings` flattens both to an
    // empty vector, and this caller is deciding whether to insert a row, so it
    // has to see the difference.
    let rows = crate::meetings_watcher::try_parse_meetings(&body).ok_or_else(|| {
        format!(
            "list-meetings response was not a meetings list: {}",
            body.to_string().chars().take(200).collect::<String>()
        )
    })?;

    if let Some(found) = pick_recent_adhoc_meeting(&rows, platform, since_ts, now_ts) {
        return Ok(Some(found));
    }
    // Found nothing — but "nothing on the page we read" is only "no such row" if
    // the page actually covered the window. The agenda view is ascending from
    // the start of the lookback, so a full page tells us only that we saw
    // everything up to its newest row; the row we want could sit past the cut.
    if !reconcile_window_was_covered(&rows, now_ts) {
        return Err(format!(
            "list-meetings returned a full page ending before the reconcile window closed ({} rows)",
            rows.len()
        ));
    }
    Ok(None)
}

/// Whether a returned page can be trusted to answer "no such row".
///
/// A short page is the whole result, so it can. A full page was truncated, and
/// only covers up to its newest row — if that is still behind the window's
/// ceiling, the row a lost response created may be one page further on, and
/// concluding "no row exists" from it would insert the duplicate.
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

/// The ad-hoc row a lost `create-meeting` response would have left behind: same
/// platform, `source == "adhoc"`, and scheduled inside the attempt window.
///
/// Bounded at both ends. Rows older than the attempt belong to a previous call,
/// and the agenda view runs "from the lookback onward" with no upper bound of
/// its own, so it also returns *future* ad-hoc rows — a scheduled one would
/// otherwise win on recency and collect this call's notes. Within the window the
/// newest wins, so a run of attempts that duplicated before this guard existed
/// still lands on the row the call is actually using.
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
