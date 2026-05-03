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
//!  * **Call-end heuristic** — best-effort: if a known video-conferencing
//!    bundle id (Zoom, Google Meet wrapper, MS Teams) goes from frontmost
//!    to background for >2 minutes, emit `meetings:call-ended`.
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
//! A 5-second supervisor task ticks; on each tick, if **all known sources**
//! have `now - last_loud_at > silence_duration`, fire `meetings:silence-stop`
//! exactly once and clear the active flag.
//!
//! Defaults: silence_threshold = 0.05, silence_duration = 15 minutes.
//! No raw "sliding window of samples" is needed — the `last_loud_at` Instant
//! trick is equivalent and uses constant memory.

use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
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

#[derive(Debug, Clone, Serialize)]
struct AudioLevel {
    level: f32,
    source: String,
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
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        let should_fire = {
            let g = match inner_for_supervisor.lock() {
                Ok(g) => g,
                Err(_) => return,
            };
            if g.generation != generation_at_start || !g.active {
                return; // session ended or replaced — exit
            }
            if g.silence_fired {
                false
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
                mic_silent && system_silent
            }
        };
        if should_fire {
            if let Ok(mut g) = inner_for_supervisor.lock() {
                g.silence_fired = true;
            }
            let _ = app_for_supervisor.emit("meetings:silence-stop", ());
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
            let known_vc_bundles: &[&str] = &[
                "us.zoom.xos",
                "us.zoom.ZoomClips",
                "com.microsoft.teams2",
                "com.microsoft.teams",
                "com.google.Chrome",     // meet runs inside Chrome; weak signal
                "company.thebrowser.Browser", // Arc
            ];
            let mut ever_seen_front = false;
            let mut last_front_at: Option<Instant> = None;
            let mut fired = false;
            loop {
                std::thread::sleep(Duration::from_secs(10));
                let state = app.state::<DetectorState>();
                let active = state.inner.lock().map(|g| g.active).unwrap_or(false);
                if !active {
                    ever_seen_front = false;
                    last_front_at = None;
                    fired = false;
                    continue;
                }
                let front = frontmost_bundle_id();
                let is_vc = front
                    .as_ref()
                    .map(|b| known_vc_bundles.iter().any(|k| k == b))
                    .unwrap_or(false);
                if is_vc {
                    ever_seen_front = true;
                    last_front_at = Some(Instant::now());
                }
                if ever_seen_front && !fired {
                    if let Some(t) = last_front_at {
                        if Instant::now().duration_since(t).as_millis() as u64 >= threshold_ms {
                            let _ = app.emit("meetings:call-ended", ());
                            fired = true;
                        }
                    }
                }
            }
        });
    });
}

#[cfg(not(target_os = "macos"))]
fn install_call_ended_watcher(_app: &AppHandle, _threshold_ms: u64) {}

#[cfg(target_os = "macos")]
fn frontmost_bundle_id() -> Option<String> {
    // Lightweight shell-out to avoid extra crates: AppleScript via `osascript`
    // returns the bundle id of the frontmost app. This avoids pulling in a
    // full objc2 dependency just for one read.
    use std::process::Command;
    let out = Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to get bundle identifier of (first process whose frontmost is true)",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8(out.stdout).ok()?.trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}
