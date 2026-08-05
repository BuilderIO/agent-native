//! System-audio capture via Apple's ScreenCaptureKit (macOS 13+).
//!
//! For Meetings we need to capture whatever the *other* party is saying — the
//! speaker output. This module taps that stream via `SCStream` +
//! `SCStreamConfiguration::with_captures_audio(true)`, mono-mixes each
//! `CMSampleBuffer` into an `AVAudioPCMBuffer`, and forwards the mono f32
//! samples to a caller-supplied callback. Transcription itself lives in the
//! local Whisper engine (`whisper_speech.rs`), which runs the system stream
//! and the mic stream as two parallel whisper.cpp workers — sidestepping
//! `SFSpeechRecognizer`'s one-task-per-process limit. Transcripts reach the
//! renderer's `LiveTranscript` tagged `source: "system"`.
//!
//! Uses the safe `screencapturekit` Rust crate. Its `SCStreamOutputTrait`
//! callback hands us a `CMSampleBuffer` per audio frame; each source is decoded
//! from its advertised format, normalized to 48 kHz, and mono-mixed.
//!
//! ## Tauri commands
//!
//! | Command                            | Purpose                                  |
//! | ---------------------------------- | ---------------------------------------- |
//! | `system_audio_request_permission`  | Probe + request Screen Recording perm.   |
//! | `system_audio_version_status`      | Report macOS SCK-audio support.          |
//! | `system_audio_open_privacy_settings`| Open the Screen Recording privacy pane.  |
//! | `audio_transcription_start`        | Start the Whisper mic + system capture.  |
//! | `audio_transcription_reset_timeline`| Rebase transcript timestamps to now.     |
//! | `audio_transcription_stop`         | Stop the capture.                         |
//!
//! `start_raw_system_capture` and `start_raw_meeting_capture` (in the `macos`
//! submodule) are the capture entry points the Whisper engine calls directly.
//!
//! ## Events
//!   - `voice:audio-level` `{ level, source: "system" }` — waveform meter.
//! Transcript events (`voice:partial-transcript` / `voice:final-transcript`,
//! `{ text, source }`) are emitted by `whisper_speech.rs`.

use serde::Serialize;
use tauri::AppHandle;

/// Structured macOS version status for the renderer. Returned by
/// `system_audio_version_status` so the Settings UI can display the right
/// affordance without having to parse error strings.
#[derive(Serialize, Clone, Debug)]
pub struct VersionStatus {
    /// `true` if the OS supports ScreenCaptureKit audio capture (macOS 13+
    /// on Apple silicon / Intel; non-macOS hosts always report `false`).
    pub supported: bool,
    /// Human-readable OS version, e.g. `"macOS 14.5"`. On non-macOS hosts
    /// this is the bare platform string (e.g. `"linux"`, `"windows"`).
    pub os_version: String,
    /// Optional reason when `supported = false`. Filled in when the host is
    /// macOS but below 13, or non-macOS.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[tauri::command]
pub fn system_audio_version_status() -> VersionStatus {
    #[cfg(target_os = "macos")]
    {
        macos::version_status()
    }
    #[cfg(not(target_os = "macos"))]
    {
        VersionStatus {
            supported: false,
            os_version: std::env::consts::OS.to_string(),
            reason: Some("System audio capture is only supported on macOS.".into()),
        }
    }
}

#[tauri::command]
pub async fn system_audio_request_permission() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        // Fail fast on macOS < 13 so the renderer can surface the right
        // affordance instead of silently falling back to mic-only.
        let status = macos::version_status();
        if !status.supported {
            return Err(status.reason.unwrap_or_else(|| {
                format!(
                    "ScreenCaptureKit is unavailable on this macOS version ({}).",
                    status.os_version
                )
            }));
        }
        macos::request_screen_capture_access().await
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("System audio capture is only supported on macOS.".into())
    }
}

/// Open the macOS Screen Recording privacy pane so the user can grant
/// permission. No-op on other platforms.
#[tauri::command]
pub fn system_audio_open_privacy_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::open_screen_recording_settings()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(())
    }
}

#[tauri::command]
pub async fn audio_transcription_start(
    app: AppHandle,
    meeting_id: Option<String>,
    locale: Option<String>,
    mic_device_id: Option<String>,
    mic_device_label: Option<String>,
    capture_system: Option<bool>,
    voice_processing: Option<bool>,
    emit_partials: Option<bool>,
    owner: Option<String>,
) -> Result<(), String> {
    let _ = meeting_id;
    crate::logfile::diagnostic("[meeting-audio] transcription engine start requested");
    let result = crate::whisper_speech::whisper_transcription_start(
        app,
        locale,
        mic_device_id,
        mic_device_label,
        capture_system.unwrap_or(true),
        // Fail safe for meeting/recording callers: an omitted flag must not
        // create a second VoiceProcessingIO stack beside a live call app.
        // Short dictation sessions opt in explicitly from the renderer.
        voice_processing.unwrap_or(false),
        // Existing meeting callers depend on live partials. Recording capture
        // explicitly opts out because it only persists final segments.
        emit_partials.unwrap_or(true),
        owner,
    )
    .await;
    if let Err(error) = &result {
        crate::logfile::diagnostic(&format!(
            "[meeting-audio] transcription engine start failed: {error}"
        ));
        eprintln!("[clips-tray] meeting transcription engine start failed: {error}");
    } else {
        crate::logfile::diagnostic("[meeting-audio] transcription engine started");
    }
    result
}

#[tauri::command]
pub async fn audio_transcription_stop(app: AppHandle) -> Result<(), String> {
    crate::whisper_speech::whisper_transcription_stop(app).await
}

#[tauri::command]
pub async fn audio_transcription_reset_timeline() -> Result<(), String> {
    crate::whisper_speech::whisper_transcription_reset_timeline().await
}

#[cfg(target_os = "macos")]
pub(crate) mod macos {
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    use objc2_foundation::NSProcessInfo;
    use serde::Serialize;
    use tauri::{AppHandle, Emitter};

    use screencapturekit::cm::CMSampleBuffer;
    use screencapturekit::shareable_content::SCShareableContent;
    use screencapturekit::stream::{
        configuration::SCStreamConfiguration, content_filter::SCContentFilter,
        output_type::SCStreamOutputType, sc_stream::SCStream,
    };

    // CoreGraphics screen-capture preflight / request APIs. These exist as
    // raw C symbols in the CoreGraphics framework — there's no objc2 wrapper
    // for them in the deps we already pull in, so we declare them inline.
    // Both functions return a Boolean: `true` if the calling process is
    // authorized to capture the screen / window contents.
    //
    // `CGRequestScreenCaptureAccess` triggers the macOS permission prompt
    // the first time it's called — subsequent calls just return the cached
    // answer. ScreenCaptureKit's audio tap is gated by the same TCC bucket
    // ("Screen Recording") so this is the right preflight for SCK too.
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }

    /// Runtime OS version probe. ScreenCaptureKit's audio-capture API
    /// (`SCStreamConfiguration::with_captures_audio`) requires macOS 13
    /// (Ventura) or later. Build-time feature gating in the
    /// `screencapturekit` crate (`macos_13_0`) only ensures the API is
    /// linked — at runtime we still need to confirm the host kernel
    /// supports it before we attempt to call into SCK.
    pub fn version_status() -> super::VersionStatus {
        // SAFETY: `processInfo` is a singleton; `operatingSystemVersion`
        // returns a plain struct of i64s.
        let info = NSProcessInfo::processInfo();
        let v = info.operatingSystemVersion();
        let os_version = format!(
            "macOS {}.{}.{}",
            v.majorVersion, v.minorVersion, v.patchVersion
        );
        if v.majorVersion >= 13 {
            super::VersionStatus {
                supported: true,
                os_version,
                reason: None,
            }
        } else {
            super::VersionStatus {
                supported: false,
                reason: Some(format!(
                    "ScreenCaptureKit is unavailable on macOS {} — requires macOS 13 or later.",
                    v.majorVersion
                )),
                os_version,
            }
        }
    }

    /// Best-effort open of the macOS Screen Recording privacy pane. We
    /// `open` the well-known pref URL via `osascript` to avoid pulling in
    /// extra crates; if the URL scheme changes in a future macOS this
    /// silently no-ops, which is the correct fallback (the user can still
    /// open System Settings manually).
    pub fn open_screen_recording_settings() -> Result<(), String> {
        use std::process::Command;
        let url = "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_ScreenCapture";
        Command::new("open")
            .arg(url)
            .status()
            .map_err(|e| format!("failed to open System Settings: {e}"))?;
        Ok(())
    }

    pub async fn request_screen_capture_access() -> Result<bool, String> {
        // SAFETY: both functions are pure C calls into CoreGraphics; no
        // arguments, no out-pointers. They return a Boolean.
        let granted = unsafe {
            if CGPreflightScreenCaptureAccess() {
                true
            } else {
                CGRequestScreenCaptureAccess()
            }
        };
        Ok(granted)
    }

    // ----------------------------------------------------------------------
    // System-audio capture via ScreenCaptureKit. Forwards every mono
    // channel-0 f32 buffer to a caller-supplied callback (the Whisper meeting
    // engine in `whisper_speech.rs`).
    // ----------------------------------------------------------------------
    struct RawAudioForwarder {
        on_samples: Arc<dyn Fn(&[f32]) + Send + Sync>,
        app: AppHandle,
        cancelled: Arc<AtomicBool>,
        level_tick: Arc<AtomicU32>,
        output_type: SCStreamOutputType,
        source: &'static str,
    }

    // SAFETY: SCK calls this handler from its dispatch queue; all shared
    // fields are immutable handles or atomics.
    unsafe impl Send for RawAudioForwarder {}
    unsafe impl Sync for RawAudioForwarder {}

    impl screencapturekit::stream::output_trait::SCStreamOutputTrait for RawAudioForwarder {
        fn did_output_sample_buffer(
            &self,
            sample_buffer: CMSampleBuffer,
            of_type: SCStreamOutputType,
        ) {
            if of_type != self.output_type {
                return;
            }
            if self.cancelled.load(Ordering::SeqCst) {
                return;
            }
            let Some(samples) =
                crate::native_screen::extract_mono_audio(&sample_buffer, self.source)
            else {
                return;
            };
            if samples.is_empty() {
                return;
            }
            (self.on_samples)(&samples);
            let n = self.level_tick.fetch_add(1, Ordering::Relaxed);
            if n % 3 == 0 {
                let level = samples
                    .iter()
                    .copied()
                    .map(f32::abs)
                    .fold(0.0_f32, f32::max)
                    .min(1.0);
                let _ = self.app.emit(
                    "voice:audio-level",
                    AudioLevelPayload {
                        level,
                        source: self.source,
                    },
                );
            }
        }
    }

    /// `SCStream::stop_capture()` occasionally never returns when the stream's
    /// underlying connection was already interrupted (same ScreenCaptureKit
    /// flakiness `native_screen::run_bounded_capture_stop` bounds for the video
    /// stream). This capture has no delegate to observe that ahead of time, so
    /// bound the stop call itself — otherwise a hung stop blocks the
    /// `audio_transcription_stop` Tauri command, which blocks the recorder's
    /// finalize await, forever.
    const SYSTEM_AUDIO_SCK_STOP_TIMEOUT: Duration = Duration::from_secs(3);

    /// Handle for a running raw SCK audio capture. A meeting capture can carry
    /// both system and microphone output handlers on this one stream.
    pub(crate) struct RawSckAudioCapture {
        stream: SCStream,
        cancelled: Arc<AtomicBool>,
    }

    // SAFETY: `SCStream` is `Send` (the crate marks it so); the atomic is
    // trivially `Send`. We only move the handle through ownership.
    unsafe impl Send for RawSckAudioCapture {}

    impl RawSckAudioCapture {
        pub(crate) fn stop(self) {
            self.cancelled.store(true, Ordering::SeqCst);
            let stream = self.stream;
            if let Err(err) = crate::native_screen::run_bounded_capture_stop(
                move || {
                    stream
                        .stop_capture()
                        .map_err(|e| format!("system audio SCStream stop failed: {e:?}"))
                },
                SYSTEM_AUDIO_SCK_STOP_TIMEOUT,
            ) {
                eprintln!("[system-audio] bounded stop_capture: {err}");
            }
        }
    }

    /// Start system-audio capture via SCK and forward every mono f32 buffer
    /// (48 kHz) to `on_samples`. No recognizer wiring.
    pub(crate) fn start_raw_system_capture(
        app: AppHandle,
        on_samples: Arc<dyn Fn(&[f32]) + Send + Sync>,
    ) -> Result<RawSckAudioCapture, String> {
        start_raw_sck_audio_capture(app, true, None, None, Some(on_samples), None)
    }

    /// Whether this macOS version supports ScreenCaptureKit's independent
    /// microphone output (`SCStreamOutputType::Microphone`).
    pub(crate) fn supports_sck_microphone_capture() -> bool {
        let version = NSProcessInfo::processInfo().operatingSystemVersion();
        version.majorVersion >= 15
    }

    /// Start one ScreenCaptureKit stream with independent system-audio and
    /// microphone callbacks. This avoids opening a second AVAudioEngine /
    /// VoiceProcessingIO input while Zoom, Meet, or Teams owns the live-call
    /// microphone uplink.
    pub(crate) fn start_raw_meeting_capture(
        app: AppHandle,
        mic_device_id: Option<String>,
        mic_device_label: Option<String>,
        capture_system: bool,
        on_mic_samples: Arc<dyn Fn(&[f32]) + Send + Sync>,
        on_system_samples: Option<Arc<dyn Fn(&[f32]) + Send + Sync>>,
    ) -> Result<RawSckAudioCapture, String> {
        if !supports_sck_microphone_capture() {
            return Err("ScreenCaptureKit microphone capture requires macOS 15 or later.".into());
        }
        start_raw_sck_audio_capture(
            app,
            capture_system,
            mic_device_id,
            mic_device_label,
            on_system_samples,
            Some(on_mic_samples),
        )
    }

    fn start_raw_sck_audio_capture(
        app: AppHandle,
        capture_system: bool,
        mic_device_id: Option<String>,
        mic_device_label: Option<String>,
        on_system_samples: Option<Arc<dyn Fn(&[f32]) + Send + Sync>>,
        on_mic_samples: Option<Arc<dyn Fn(&[f32]) + Send + Sync>>,
    ) -> Result<RawSckAudioCapture, String> {
        let granted = unsafe { CGPreflightScreenCaptureAccess() };
        if !granted {
            let granted_now = unsafe { CGRequestScreenCaptureAccess() };
            if !granted_now {
                return Err(
                    "Screen Recording permission denied. Open System Settings > Privacy & Security > Screen Recording, enable Clips, then try again."
                        .into(),
                );
            }
        }

        let content = SCShareableContent::get()
            .map_err(|e| format!("SCShareableContent::get failed: {e:?}"))?;
        let displays = content.displays();
        let display = displays
            .first()
            .ok_or_else(|| "No displays available for system audio capture".to_string())?;
        let filter = SCContentFilter::create()
            .with_display(display)
            .with_excluding_windows(&[])
            .build();

        let capture_microphone = on_mic_samples.is_some();
        let selected_mic = if capture_microphone {
            crate::native_screen::resolve_microphone_capture_device(
                mic_device_id.as_deref(),
                mic_device_label.as_deref(),
            )?
        } else {
            None
        };
        let mut config = SCStreamConfiguration::new()
            .with_captures_audio(capture_system)
            .with_captures_microphone(capture_microphone)
            .with_excludes_current_process_audio(true)
            .with_sample_rate(48000)
            .with_channel_count(2)
            .with_width(2)
            .with_height(2);
        if let Some(device) = selected_mic.as_ref() {
            config.set_microphone_capture_device_id(&device.id);
            eprintln!(
                "[whisper] ScreenCaptureKit meeting microphone pinned to {} ({})",
                device.name, device.id
            );
        }

        let cancelled = Arc::new(AtomicBool::new(false));
        let mut stream = SCStream::new(&filter, &config);
        if let Some(on_samples) = on_system_samples {
            let forwarder = RawAudioForwarder {
                on_samples,
                app: app.clone(),
                cancelled: cancelled.clone(),
                level_tick: Arc::new(AtomicU32::new(0)),
                output_type: SCStreamOutputType::Audio,
                source: "system",
            };
            stream.add_output_handler(forwarder, SCStreamOutputType::Audio);
        }
        if let Some(on_samples) = on_mic_samples {
            let forwarder = RawAudioForwarder {
                on_samples,
                app: app.clone(),
                cancelled: cancelled.clone(),
                level_tick: Arc::new(AtomicU32::new(0)),
                output_type: SCStreamOutputType::Microphone,
                source: "mic",
            };
            stream.add_output_handler(forwarder, SCStreamOutputType::Microphone);
        }

        if let Err(e) = stream.start_capture() {
            cancelled.store(true, Ordering::SeqCst);
            return Err(format!("SCStream start_capture failed: {e:?}"));
        }

        Ok(RawSckAudioCapture { stream, cancelled })
    }

    #[derive(Serialize, Clone)]
    struct AudioLevelPayload {
        level: f32,
        source: &'static str,
    }
}
