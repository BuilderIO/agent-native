//! Silence-aware auto-stop heuristics for meeting recordings.
//!
//! This module subscribes to the existing `voice:audio-level` events emitted by
//! `native_speech.rs` (mic) and `system_audio.rs` (system audio) and tracks a
//! last meaningful level per source. When **both** sources have stayed below
//! the silence threshold for the configured silence duration, we emit
//! `meetings:silence-stop` to the renderer, which calls the
//! `stop-meeting-recording` action.
//!
//! Two additional auto-stop triggers also live here for parity:
//!
//!  * **System sleep** — `NSWorkspaceWillSleepNotification` via objc2.
//!    Emits `meetings:sleep-stop`.
//!  * **Call-end heuristic** — when a known conferencing app releases its
//!    microphone after using it for the active meeting, emit
//!    `meetings:call-ended` after a short system-audio confirmation. A
//!    foreground-to-background transition is deliberately not an end signal:
//!    people switch apps while calls are still live.
//!  * **Calendar end** — when the scheduled meeting end has passed and system
//!    audio has been quiet for the call-end window, emit the same event even if
//!    the conferencing app remains open.
//!
//! Renderer-side responsibility: subscribe via `silence-events.ts`, dispatch
//! the `stop-meeting-recording` action when any of the events fire.
//!
//! ## Tauri commands
//!
//! | Command                     | Purpose                                       |
//! | --------------------------- | --------------------------------------------- |
//! | `silence_detector_start`    | Begin tracking; takes thresholds in payload   |
//! | `silence_detector_stop`     | Stop tracking                                 |
//!
//! ## Algorithm
//!
//! Each `voice:audio-level` event carries `{ level: f32, source: "mic"|"system" }`.
//! We keep a per-source `last_loud_at: Instant`. On every level event:
//!   - if `level >= silence_threshold` -> reset `last_loud_at = now()`.
//!
//! A two-second supervisor task ticks. Call-end and calendar signals use system
//! audio only, because a user's local mic can stay noisy after a call ends.
//! The all-source silence stop remains the long safety backstop.
//!
//! Defaults: silence_threshold = 0.05, silence_duration = 15 minutes.
//! No raw "sliding window of samples" is needed — the `last_loud_at` Instant
//! trick is equivalent and uses constant memory.

use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Listener, Manager};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SilenceConfig {
    /// Peak-level (0.0..1.0) below which a sample is considered "silent".
    /// Default 0.05.
    #[serde(default = "default_threshold")]
    pub silence_threshold: f32,
    /// Milliseconds of continuous silence on BOTH sources before firing.
    /// Default 15 * 60 * 1000.
    #[serde(default = "default_silence_ms")]
    pub silence_ms: u64,
    /// Milliseconds of quiet system audio after the scheduled end before
    /// firing the call-ended event. Default 30 seconds.
    #[serde(default = "default_call_ended_ms")]
    pub call_ended_ms: u64,
    /// Whether to enable the system-sleep auto-stop.
    #[serde(default = "default_true")]
    pub watch_sleep: bool,
    /// Whether to enable the call-ended heuristic.
    #[serde(default = "default_true")]
    pub watch_call_ended: bool,
    /// Bundle IDs allowed to corroborate a call ending by releasing their
    /// microphone input. Restricting this to the meeting provider prevents an
    /// unrelated browser tab from affecting a live meeting session.
    #[serde(default)]
    pub call_app_bundle_ids: Option<Vec<String>>,
    /// Unix epoch milliseconds for the calendar event's scheduled end.
    /// Calendar-end stopping still requires quiet audio as confirmation.
    #[serde(default)]
    pub scheduled_end_ms: Option<u64>,
}

fn default_threshold() -> f32 {
    0.05
}
fn default_silence_ms() -> u64 {
    15 * 60 * 1000
}
fn default_call_ended_ms() -> u64 {
    30 * 1000
}
fn default_true() -> bool {
    true
}

#[derive(Debug)]
struct SourceState {
    last_loud_at: Instant,
    seen_audio: bool,
}

impl SourceState {
    fn fresh() -> Self {
        Self {
            last_loud_at: Instant::now(),
            seen_audio: false,
        }
    }
}

#[derive(Default)]
struct DetectorInner {
    /// Generation counter — bumped on every `start`/`stop` so old supervisor
    /// tasks know to exit.
    generation: u64,
    /// Whether tracking is currently active.
    active: bool,
    /// Config snapshot for the active session.
    config: Option<SilenceConfig>,
    /// Per-source last-loud timestamp.
    mic: Option<SourceState>,
    system: Option<SourceState>,
    /// Already fired an automatic stop event in this session?
    auto_stop_fired: bool,
    /// Calendar event end for the active session, if one is known.
    scheduled_end_ms: Option<u64>,
    /// Apps allowed to corroborate a call ending by releasing their microphone
    /// input. This varies by the calendar join URL for each session.
    call_app_bundle_ids: Vec<String>,
}

pub struct DetectorState {
    inner: Arc<Mutex<DetectorInner>>,
    /// One-shot wiring of the `voice:audio-level` listener — done lazily on
    /// the first `silence_detector_start` so we don't pay the cost when no
    /// meeting is active.
    listener_installed: OnceLock<()>,
}

impl Default for DetectorState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(DetectorInner::default())),
            listener_installed: OnceLock::new(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct AudioLevelPayload {
    level: f32,
    source: String,
}

#[tauri::command]
pub fn silence_detector_start(app: AppHandle, config: Option<SilenceConfig>) -> Result<(), String> {
    let state = app.state::<DetectorState>();
    let cfg = config.unwrap_or_else(|| SilenceConfig {
        silence_threshold: default_threshold(),
        silence_ms: default_silence_ms(),
        call_ended_ms: default_call_ended_ms(),
        watch_sleep: true,
        watch_call_ended: true,
        call_app_bundle_ids: None,
        scheduled_end_ms: None,
    });

    // Install the audio-level listener exactly once for the process.
    let inner_for_listener = state.inner.clone();
    state.listener_installed.get_or_init(|| {
        app.listen("voice:audio-level", move |event| {
            let payload = event.payload();
            let parsed: Result<AudioLevelPayload, _> = serde_json::from_str(payload);
            let Ok(p) = parsed else { return };
            let mut g = match inner_for_listener.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if !g.active {
                return;
            }
            let threshold = g
                .config
                .as_ref()
                .map(|c| c.silence_threshold)
                .unwrap_or_else(default_threshold);
            let now = Instant::now();
            let bucket = match p.source.as_str() {
                "mic" => &mut g.mic,
                "system" => &mut g.system,
                _ => return,
            };
            let entry = bucket.get_or_insert_with(SourceState::fresh);
            entry.seen_audio = true;
            if p.level >= threshold {
                entry.last_loud_at = now;
            }
        });
    });

    {
        let mut g = state
            .inner
            .lock()
            .map_err(|e| format!("silence detector lock poisoned: {e}"))?;
        g.generation = g.generation.wrapping_add(1);
        g.active = true;
        g.auto_stop_fired = false;
        g.config = Some(cfg.clone());
        g.scheduled_end_ms = cfg.scheduled_end_ms;
        g.call_app_bundle_ids = cfg
            .call_app_bundle_ids
            .clone()
            .unwrap_or_default()
            .into_iter()
            .map(|bundle_id| bundle_id.to_lowercase())
            .collect();
        // Seed both buckets with `now()` so we don't insta-fire on start
        // before any audio has streamed in yet.
        g.mic = Some(SourceState::fresh());
        g.system = Some(SourceState::fresh());
    }

    let generation_at_start = {
        let g = state.inner.lock().unwrap();
        g.generation
    };
    let inner_for_supervisor = state.inner.clone();
    let app_for_supervisor = app.clone();
    let silence_window = Duration::from_millis(cfg.silence_ms);
    let calendar_end_quiet_window = Duration::from_millis(cfg.call_ended_ms);
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        let stop_reason = {
            let g = match inner_for_supervisor.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if g.generation != generation_at_start || !g.active {
                return; // session ended or replaced — exit
            }
            if g.auto_stop_fired {
                None
            } else {
                let now = Instant::now();
                let mic_silent = g
                    .mic
                    .as_ref()
                    .map(|s| now.duration_since(s.last_loud_at) >= silence_window)
                    .unwrap_or(false);
                let system_silent = g
                    .system
                    .as_ref()
                    .map(|s| now.duration_since(s.last_loud_at) >= silence_window)
                    .unwrap_or(false);
                let system_quiet_for_calendar_end =
                    source_quiet_for(g.system.as_ref(), now, calendar_end_quiet_window);
                if calendar_end_stop_ready(
                    g.scheduled_end_ms,
                    unix_now_ms(),
                    system_quiet_for_calendar_end,
                ) {
                    Some("calendar")
                } else if mic_silent && system_silent {
                    Some("silence")
                } else {
                    None
                }
            }
        };
        if let Some(reason) = stop_reason {
            if claim_auto_stop(&inner_for_supervisor, generation_at_start) {
                let event = if reason == "calendar" {
                    "meetings:call-ended"
                } else {
                    "meetings:silence-stop"
                };
                let _ = app_for_supervisor.emit(event, ());
            }
        }
    });

    if cfg.watch_sleep {
        install_sleep_watcher(&app);
    }
    if cfg.watch_call_ended {
        install_call_ended_watcher(&app);
    }

    Ok(())
}

#[tauri::command]
pub fn silence_detector_stop(app: AppHandle) -> Result<(), String> {
    let state = app.state::<DetectorState>();
    let mut g = state
        .inner
        .lock()
        .map_err(|e| format!("silence detector lock poisoned: {e}"))?;
    g.generation = g.generation.wrapping_add(1);
    g.active = false;
    g.auto_stop_fired = false;
    g.mic = None;
    g.system = None;
    g.scheduled_end_ms = None;
    g.call_app_bundle_ids.clear();
    Ok(())
}

// --- system sleep ----------------------------------------------------------

#[cfg(target_os = "macos")]
fn install_sleep_watcher(app: &AppHandle) {
    static INSTALLED: OnceLock<()> = OnceLock::new();
    let app = app.clone();
    INSTALLED.get_or_init(|| {
        // We use a polling fallback instead of full objc2 plumbing so this
        // file stays self-contained and dependency-light. On macOS,
        // `IOPSGetTimeRemainingEstimate` would require IOKit bindings; the
        // simplest reliable signal is a clock-jump heuristic: if a 5-second
        // supervisor tick observes a wall-clock gap > 30s, the machine
        // almost certainly slept.
        std::thread::spawn(move || {
            let mut last_tick = Instant::now();
            loop {
                std::thread::sleep(Duration::from_secs(5));
                let now = Instant::now();
                let drift = now.duration_since(last_tick);
                last_tick = now;
                if drift > Duration::from_secs(30) {
                    // Only fire when a session is active to avoid noise.
                    let state = app.state::<DetectorState>();
                    let (active, generation, watch_sleep) = state
                        .inner
                        .lock()
                        .map(|g| {
                            (
                                g.active,
                                g.generation,
                                g.config
                                    .as_ref()
                                    .map(|config| config.watch_sleep)
                                    .unwrap_or(false),
                            )
                        })
                        .unwrap_or((false, 0, false));
                    if active && watch_sleep && claim_auto_stop(&state.inner, generation) {
                        let _ = app.emit("meetings:sleep-stop", ());
                    }
                }
            }
        });
    });
}

#[cfg(not(target_os = "macos"))]
fn install_sleep_watcher(_app: &AppHandle) {}

// --- call-ended heuristic --------------------------------------------------

const CALL_END_AUDIO_CONFIRM: Duration = Duration::from_secs(5);
const CALL_MIC_RELEASE_CONFIRM: Duration = Duration::from_secs(5);
#[cfg(target_os = "macos")]
const CALL_END_POLL: Duration = Duration::from_secs(2);

#[cfg(target_os = "macos")]
fn install_call_ended_watcher(app: &AppHandle) {
    static INSTALLED: OnceLock<()> = OnceLock::new();
    let app = app.clone();
    INSTALLED.get_or_init(|| {
        std::thread::spawn(move || {
            let mut call_app_used_microphone = false;
            let mut microphone_released_at: Option<Instant> = None;
            let mut generation: Option<u64> = None;
            loop {
                std::thread::sleep(CALL_END_POLL);
                let state = app.state::<DetectorState>();
                let (active, active_generation, configured_bundle_ids, watch_call_ended, fired) =
                    state
                        .inner
                        .lock()
                        .map(|g| {
                            (
                                g.active,
                                g.generation,
                                g.call_app_bundle_ids.clone(),
                                g.config
                                    .as_ref()
                                    .map(|config| config.watch_call_ended)
                                    .unwrap_or(false),
                                g.auto_stop_fired,
                            )
                        })
                        .unwrap_or((false, 0, Vec::new(), false, true));
                if !active || !watch_call_ended {
                    call_app_used_microphone = false;
                    microphone_released_at = None;
                    continue;
                }
                if generation != Some(active_generation) {
                    call_app_used_microphone = false;
                    microphone_released_at = None;
                    generation = Some(active_generation);
                }
                if fired {
                    continue;
                }
                let call_app_bundle_ids = if configured_bundle_ids.is_empty() {
                    crate::call_activity::default_call_app_bundle_ids()
                } else {
                    configured_bundle_ids
                };

                // CoreAudio reports whether the provider still has an active
                // microphone stream. Only accept a true -> false transition
                // that stays stable for a few seconds; this tolerates device
                // handoffs without waiting minutes after a real call ends.
                match crate::call_activity::call_app_uses_microphone(&call_app_bundle_ids) {
                    Some(true) => {
                        call_app_used_microphone = true;
                        microphone_released_at = None;
                    }
                    Some(false) if call_app_used_microphone => {
                        microphone_released_at.get_or_insert_with(Instant::now);
                    }
                    None => {
                        // CoreAudio could not confirm the provider state, so
                        // a release window must start over on the next known
                        // false result.
                        microphone_released_at = None;
                    }
                    _ => {}
                }

                // Local mic noise is expected after a meeting ends, so only
                // system audio corroborates a released call input. If system
                // capture is unavailable, the stable provider transition is
                // still the best native end signal we have.
                let audio_quiet = audio_recently_silent(&state, CALL_END_AUDIO_CONFIRM);

                let microphone_released = microphone_release_stop_ready(
                    call_app_used_microphone,
                    microphone_released_at.map(|at| Instant::now().duration_since(at)),
                ) && audio_quiet;

                if microphone_released && claim_auto_stop(&state.inner, active_generation) {
                    let _ = app.emit("meetings:call-ended", ());
                }
            }
        });
    });
}

#[cfg(not(target_os = "macos"))]
fn install_call_ended_watcher(_app: &AppHandle) {}

fn microphone_release_stop_ready(
    app_used_microphone: bool,
    released_for: Option<Duration>,
) -> bool {
    app_used_microphone
        && released_for
            .map(|elapsed| elapsed >= CALL_MIC_RELEASE_CONFIRM)
            .unwrap_or(false)
}

fn scheduled_end_reached(scheduled_end_ms: Option<u64>, now_ms: u64) -> bool {
    scheduled_end_ms
        .map(|end_ms| now_ms >= end_ms)
        .unwrap_or(false)
}

fn calendar_end_stop_ready(scheduled_end_ms: Option<u64>, now_ms: u64, audio_quiet: bool) -> bool {
    scheduled_end_reached(scheduled_end_ms, now_ms) && audio_quiet
}

fn source_quiet_for(source: Option<&SourceState>, now: Instant, window: Duration) -> bool {
    source
        .map(|state| state.seen_audio && now.duration_since(state.last_loud_at) >= window)
        .unwrap_or(false)
}

fn call_end_audio_quiet_for(source: Option<&SourceState>, now: Instant, window: Duration) -> bool {
    source
        .map(|state| !state.seen_audio || source_quiet_for(Some(state), now, window))
        .unwrap_or(true)
}

fn claim_auto_stop(inner: &Arc<Mutex<DetectorInner>>, generation: u64) -> bool {
    let Ok(mut g) = inner.lock() else {
        return false;
    };
    if g.generation != generation || !g.active || g.auto_stop_fired {
        return false;
    }
    g.auto_stop_fired = true;
    true
}

fn unix_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Corroboration check for the call-ended signal. The provider's mic transition
/// is the primary signal, so only system audio needs to be quiet here. Local
/// mic noise is not evidence that a call is still live.
#[cfg(target_os = "macos")]
fn audio_recently_silent(state: &tauri::State<'_, DetectorState>, window: Duration) -> bool {
    let Ok(g) = state.inner.lock() else {
        return false;
    };
    let now = Instant::now();
    call_end_audio_quiet_for(g.system.as_ref(), now, window)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{
        calendar_end_stop_ready, call_end_audio_quiet_for, claim_auto_stop,
        microphone_release_stop_ready, scheduled_end_reached, source_quiet_for, DetectorInner,
        SourceState,
    };
    use std::sync::{Arc, Mutex};

    #[test]
    fn calendar_end_requires_a_known_end_and_allows_the_exact_boundary() {
        assert!(!scheduled_end_reached(None, 10_000));
        assert!(!scheduled_end_reached(Some(10_001), 10_000));
        assert!(scheduled_end_reached(Some(10_000), 10_000));
        assert!(scheduled_end_reached(Some(9_999), 10_000));
    }

    #[test]
    fn calendar_end_stop_also_requires_quiet_audio() {
        assert!(!calendar_end_stop_ready(Some(9_999), 10_000, false));
        assert!(calendar_end_stop_ready(Some(9_999), 10_000, true));
        assert!(!calendar_end_stop_ready(Some(10_001), 10_000, true));
    }

    #[test]
    fn microphone_release_only_stops_after_an_observed_call_input_ends() {
        assert!(!microphone_release_stop_ready(
            false,
            Some(Duration::from_secs(60))
        ));
        assert!(!microphone_release_stop_ready(true, None));
        assert!(!microphone_release_stop_ready(
            true,
            Some(Duration::from_secs(4))
        ));
        assert!(microphone_release_stop_ready(
            true,
            Some(Duration::from_secs(5))
        ));
    }

    #[test]
    fn call_end_audio_confirmation_ignores_local_mic_noise() {
        let now = std::time::Instant::now();
        let system_quiet = SourceState {
            last_loud_at: now - Duration::from_secs(6),
            seen_audio: true,
        };
        let mic_loud = SourceState {
            last_loud_at: now,
            seen_audio: true,
        };

        assert!(source_quiet_for(
            Some(&system_quiet),
            now,
            Duration::from_secs(5)
        ));
        assert!(!source_quiet_for(
            Some(&mic_loud),
            now,
            Duration::from_secs(5)
        ));
        assert!(!source_quiet_for(
            Some(&SourceState::fresh()),
            now,
            Duration::from_secs(5)
        ));
        assert!(call_end_audio_quiet_for(
            Some(&SourceState::fresh()),
            now,
            Duration::from_secs(5)
        ));
        assert!(call_end_audio_quiet_for(None, now, Duration::from_secs(5)));
    }

    #[test]
    fn auto_stop_claim_is_one_shot_for_the_active_generation() {
        let inner = Arc::new(Mutex::new(DetectorInner {
            active: true,
            ..DetectorInner::default()
        }));

        assert!(claim_auto_stop(&inner, 0));
        assert!(!claim_auto_stop(&inner, 0));
        assert!(!claim_auto_stop(&inner, 1));
    }
}
