//! Silence-aware auto-stop heuristics for meeting recordings.
//!
//! This module subscribes to the existing `voice:audio-level` events emitted by
//! `native_speech.rs` (mic) and `system_audio.rs` (system audio) and tracks a
//! rolling window of peak levels per source. When **both** sources have stayed
//! below the silence threshold for the configured silence duration, we emit
//! `meetings:silence-stop` to the renderer, which calls the
//! `stop-meeting-recording` action.
//!
//! Two additional auto-stop triggers also live here for parity:
//!
//!  * **System sleep** — `NSWorkspaceWillSleepNotification` via objc2.
//!    Emits `meetings:sleep-stop`.
//!  * **Call-end heuristic** — best-effort: when a known conferencing app
//!    releases its microphone after using it for the active meeting, emit
//!    `meetings:call-ended`. Falling back to a foreground-to-background
//!    transition keeps the detector useful on macOS versions that do not
//!    expose per-process input activity.
//!  * **Calendar end** — when the scheduled meeting end has passed and both
//!    audio sources have been quiet for the call-end window, emit the same
//!    event even if the conferencing app remains frontmost.
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
//! A 5-second supervisor task ticks; on each tick, if **all known sources**
//! have `now - last_loud_at > silence_duration`, fire `meetings:silence-stop`
//! exactly once and clear the active flag.
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
    /// Milliseconds of background-state (video-conferencing app no longer
    /// foreground) before firing the call-ended event. Default 2 minutes.
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
    2 * 60 * 1000
}
fn default_true() -> bool {
    true
}

#[derive(Debug)]
struct SourceState {
    last_loud_at: Instant,
}

impl SourceState {
    fn fresh() -> Self {
        Self {
            last_loud_at: Instant::now(),
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
    /// Already fired the silence-stop event in this session?
    silence_fired: bool,
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
        g.silence_fired = false;
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
        std::thread::sleep(Duration::from_secs(5));
        let stop_reason = {
            let g = match inner_for_supervisor.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if g.generation != generation_at_start || !g.active {
                return; // session ended or replaced — exit
            }
            if g.silence_fired {
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
                let mic_quiet_for_calendar_end = g
                    .mic
                    .as_ref()
                    .map(|s| now.duration_since(s.last_loud_at) >= calendar_end_quiet_window)
                    .unwrap_or(false);
                let system_quiet_for_calendar_end = g
                    .system
                    .as_ref()
                    .map(|s| now.duration_since(s.last_loud_at) >= calendar_end_quiet_window)
                    .unwrap_or(false);
                if calendar_end_stop_ready(
                    g.scheduled_end_ms,
                    unix_now_ms(),
                    mic_quiet_for_calendar_end && system_quiet_for_calendar_end,
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
            if let Ok(mut g) = inner_for_supervisor.lock() {
                g.silence_fired = true;
            }
            let event = if reason == "calendar" {
                "meetings:call-ended"
            } else {
                "meetings:silence-stop"
            };
            let _ = app_for_supervisor.emit(event, ());
        }
    });

    if cfg.watch_sleep {
        install_sleep_watcher(&app);
    }
    if cfg.watch_call_ended {
        install_call_ended_watcher(&app, cfg.call_ended_ms);
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
    g.silence_fired = false;
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
                    let active = state.inner.lock().map(|g| g.active).unwrap_or(false);
                    if active {
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

#[cfg(target_os = "macos")]
fn install_call_ended_watcher(app: &AppHandle, threshold_ms: u64) {
    static INSTALLED: OnceLock<()> = OnceLock::new();
    let app = app.clone();
    INSTALLED.get_or_init(|| {
        std::thread::spawn(move || {
            // Best-effort: poll the frontmost-app bundle id every 10s and
            // track when a known video-conferencing bundle was last in front.
            // If it was front during this session and has been background for
            // > threshold_ms, fire `meetings:call-ended`. On the first session
            // tick we just record state and wait.
            // Native VC clients are a strong signal on their own: a Zoom/Teams
            // window backgrounding for a while means the user almost
            // certainly left the call. Generic browsers are NOT included
            // here — Meet/Zoom-web/Teams-web all run inside Chrome/Arc, so
            // "Chrome was frontmost" just means the user was in some tab, not
            // that any call ended. Browser-hosted calls fall back to
            // `strong_vc_bundles` below only when corroborated by the
            // mic+system silence tracking this same detector already keeps
            // (DetectorInner.mic/system), never on the frontmost-app poll
            // alone — matching the granola-ux.md "transcript length +
            // calendar times" model instead of raw frontmost tracking.
            let generic_browser_bundles: &[&str] = &[
                "com.google.chrome",
                "company.thebrowser.browser", // Arc
            ];
            let mut ever_seen_front = false;
            let mut last_front_at: Option<Instant> = None;
            let mut fired = false;
            let mut last_front_was_generic_browser = false;
            let mut call_app_used_microphone = false;
            let mut microphone_released_at: Option<Instant> = None;
            let mut generation: Option<u64> = None;
            loop {
                std::thread::sleep(Duration::from_secs(10));
                let state = app.state::<DetectorState>();
                let (active, active_generation, configured_bundle_ids) = state
                    .inner
                    .lock()
                    .map(|g| (g.active, g.generation, g.call_app_bundle_ids.clone()))
                    .unwrap_or((false, 0, Vec::new()));
                if !active {
                    ever_seen_front = false;
                    last_front_at = None;
                    fired = false;
                    last_front_was_generic_browser = false;
                    call_app_used_microphone = false;
                    microphone_released_at = None;
                    continue;
                }
                if generation != Some(active_generation) {
                    ever_seen_front = false;
                    last_front_at = None;
                    fired = false;
                    last_front_was_generic_browser = false;
                    call_app_used_microphone = false;
                    microphone_released_at = None;
                    generation = Some(active_generation);
                }
                let call_app_bundle_ids = if configured_bundle_ids.is_empty() {
                    default_call_app_bundle_ids()
                } else {
                    configured_bundle_ids
                };
                let front = crate::util::frontmost_bundle_id();
                let is_strong_vc = front
                    .as_ref()
                    .map(|bundle_id| {
                        let bundle_id = bundle_id.to_lowercase();
                        call_app_bundle_ids
                            .iter()
                            .any(|candidate| candidate == &bundle_id)
                    })
                    .unwrap_or(false);
                let is_generic_browser = front
                    .as_ref()
                    .map(|bundle_id| {
                        let bundle_id = bundle_id.to_lowercase();
                        generic_browser_bundles.contains(&bundle_id.as_str())
                            && call_app_bundle_ids
                                .iter()
                                .any(|candidate| candidate == &bundle_id)
                    })
                    .unwrap_or(false);
                if is_strong_vc || is_generic_browser {
                    ever_seen_front = true;
                    last_front_at = Some(Instant::now());
                    last_front_was_generic_browser = is_generic_browser;
                }
                if fired {
                    continue;
                }

                // A native call application remains frontmost on its post-call
                // screen, so foreground tracking alone cannot tell that the
                // meeting ended. CoreAudio reports whether the provider still
                // has an active microphone stream. Only accept a true -> false
                // transition that stays stable for 30 seconds; this tolerates
                // a device handoff while avoiding a stop before the call has
                // actually acquired its microphone.
                match call_app_uses_microphone(&call_app_bundle_ids) {
                    Some(true) => {
                        call_app_used_microphone = true;
                        microphone_released_at = None;
                    }
                    Some(false) if call_app_used_microphone => {
                        microphone_released_at.get_or_insert_with(Instant::now);
                    }
                    _ => {}
                }

                let microphone_released = microphone_release_stop_ready(
                    call_app_used_microphone,
                    microphone_released_at.map(|at| Instant::now().duration_since(at)),
                );

                let frontmost_call_ended = ever_seen_front
                    && last_front_at
                        .map(|t| {
                            Instant::now().duration_since(t).as_millis() as u64 >= threshold_ms
                        })
                        .unwrap_or(false)
                    // Require audio corroboration for browser-hosted calls:
                    // backgrounding Chrome/Arc alone does not prove that the
                    // Meet tab ended. Use the last known conference app, not
                    // the unrelated app now in front.
                    && (!last_front_was_generic_browser
                        || audio_recently_silent(&state, threshold_ms));

                if microphone_released || frontmost_call_ended {
                    let _ = app.emit("meetings:call-ended", ());
                    fired = true;
                }
            }
        });
    });
}

#[cfg(not(target_os = "macos"))]
fn install_call_ended_watcher(_app: &AppHandle, _threshold_ms: u64) {}

#[cfg(target_os = "macos")]
fn default_call_app_bundle_ids() -> Vec<String> {
    [
        "us.zoom.xos",
        "us.zoom.ZoomClips",
        "com.microsoft.teams2",
        "com.microsoft.teams",
    ]
    .into_iter()
    .map(|bundle_id| bundle_id.to_lowercase())
    .collect()
}

fn microphone_release_stop_ready(
    app_used_microphone: bool,
    released_for: Option<Duration>,
) -> bool {
    app_used_microphone
        && released_for
            .map(|elapsed| elapsed >= Duration::from_secs(30))
            .unwrap_or(false)
}

/// Returns whether one of the target conferencing apps currently has a live
/// CoreAudio input stream. `None` means the OS could not provide a reliable
/// answer, so callers must keep the existing conservative fallbacks.
#[cfg(target_os = "macos")]
fn call_app_uses_microphone(bundle_ids: &[String]) -> Option<bool> {
    use core_foundation::base::TCFType;
    use core_foundation::string::CFString;
    use objc2_core_audio::{
        kAudioHardwareNoError, kAudioHardwarePropertyProcessObjectList,
        kAudioObjectPropertyElementMain, kAudioObjectPropertyScopeGlobal, kAudioObjectSystemObject,
        kAudioProcessPropertyBundleID, kAudioProcessPropertyIsRunningInput,
        AudioObjectGetPropertyData, AudioObjectGetPropertyDataSize, AudioObjectID,
        AudioObjectPropertyAddress,
    };
    use std::ffi::c_void;
    use std::mem::size_of;
    use std::ptr::NonNull;

    let mut list_address = AudioObjectPropertyAddress {
        mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    };
    let mut data_size = 0;
    let list_status = unsafe {
        AudioObjectGetPropertyDataSize(
            kAudioObjectSystemObject as AudioObjectID,
            NonNull::from(&mut list_address),
            0,
            std::ptr::null(),
            NonNull::from(&mut data_size),
        )
    };
    if list_status != kAudioHardwareNoError || data_size == 0 {
        return None;
    }

    let mut processes = vec![0 as AudioObjectID; data_size as usize / size_of::<AudioObjectID>()];
    let list_status = unsafe {
        AudioObjectGetPropertyData(
            kAudioObjectSystemObject as AudioObjectID,
            NonNull::from(&mut list_address),
            0,
            std::ptr::null(),
            NonNull::from(&mut data_size),
            NonNull::new(processes.as_mut_ptr().cast::<c_void>())?,
        )
    };
    if list_status != kAudioHardwareNoError {
        return None;
    }

    for process in processes {
        let mut bundle_address = AudioObjectPropertyAddress {
            mSelector: kAudioProcessPropertyBundleID,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        };
        let mut bundle_ref: *const c_void = std::ptr::null();
        let mut bundle_size = size_of::<*const c_void>() as u32;
        let bundle_status = unsafe {
            AudioObjectGetPropertyData(
                process,
                NonNull::from(&mut bundle_address),
                0,
                std::ptr::null(),
                NonNull::from(&mut bundle_size),
                NonNull::new((&mut bundle_ref as *mut *const c_void).cast::<c_void>())?,
            )
        };
        if bundle_status != kAudioHardwareNoError || bundle_ref.is_null() {
            continue;
        }
        let bundle_id = unsafe {
            CFString::wrap_under_get_rule(bundle_ref as core_foundation::string::CFStringRef)
        }
        .to_string()
        .to_lowercase();
        if !bundle_ids.iter().any(|candidate| candidate == &bundle_id) {
            continue;
        }

        let mut input_address = AudioObjectPropertyAddress {
            mSelector: kAudioProcessPropertyIsRunningInput,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain,
        };
        let mut input_running: u32 = 0;
        let mut input_size = size_of::<u32>() as u32;
        let input_status = unsafe {
            AudioObjectGetPropertyData(
                process,
                NonNull::from(&mut input_address),
                0,
                std::ptr::null(),
                NonNull::from(&mut input_size),
                NonNull::new((&mut input_running as *mut u32).cast::<c_void>())?,
            )
        };
        if input_status == kAudioHardwareNoError && input_running != 0 {
            return Some(true);
        }
    }

    Some(false)
}

fn scheduled_end_reached(scheduled_end_ms: Option<u64>, now_ms: u64) -> bool {
    scheduled_end_ms
        .map(|end_ms| now_ms >= end_ms)
        .unwrap_or(false)
}

fn calendar_end_stop_ready(scheduled_end_ms: Option<u64>, now_ms: u64, audio_quiet: bool) -> bool {
    scheduled_end_reached(scheduled_end_ms, now_ms) && audio_quiet
}

fn unix_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Corroboration check for the generic-browser call-ended signal: true only
/// if BOTH mic and system audio have been quiet for at least `threshold_ms`.
/// Reuses the same per-source `last_loud_at` tracking the silence-stop
/// supervisor already maintains — no new subsystem, no new lock ordering
/// beyond the existing `DetectorState.inner` mutex. Missing/never-seen
/// sources count as "not corroborating" (conservative — when in doubt, keep
/// recording rather than auto-stop).
#[cfg(target_os = "macos")]
fn audio_recently_silent(state: &tauri::State<'_, DetectorState>, threshold_ms: u64) -> bool {
    let Ok(g) = state.inner.lock() else {
        return false;
    };
    let window = Duration::from_millis(threshold_ms);
    let now = Instant::now();
    let mic_silent = g
        .mic
        .as_ref()
        .map(|s| now.duration_since(s.last_loud_at) >= window)
        .unwrap_or(false);
    let system_silent = g
        .system
        .as_ref()
        .map(|s| now.duration_since(s.last_loud_at) >= window)
        .unwrap_or(false);
    mic_silent && system_silent
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::{calendar_end_stop_ready, microphone_release_stop_ready, scheduled_end_reached};

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
            Some(Duration::from_secs(29))
        ));
        assert!(microphone_release_stop_ready(
            true,
            Some(Duration::from_secs(30))
        ));
    }
}
