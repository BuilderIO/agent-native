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
//! callback hands us a `CMSampleBuffer` per audio frame; SCK delivers stereo
//! 48 kHz float, which we mono-mix on the way out.
//!
//! ## Tauri commands
//!
//! | Command                            | Purpose                                  |
//! | ---------------------------------- | ---------------------------------------- |
//! | `system_audio_request_permission`  | Probe + request Screen Recording perm.   |
//! | `system_audio_version_status`      | Report macOS SCK-audio support.          |
//! | `system_audio_open_privacy_settings`| Open the Screen Recording privacy pane.  |
//! | `audio_transcription_start`        | Start the Whisper mic + system capture.  |
//! | `audio_transcription_stop`         | Stop the capture.                         |
//!
//! `start_raw_system_capture` (in the `macos` submodule) is the capture entry
//! point the Whisper engine calls directly.
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
    owner: Option<String>,
) -> Result<(), String> {
    let _ = meeting_id;
    crate::whisper_speech::whisper_transcription_start(
        app,
        locale,
        mic_device_id,
        mic_device_label,
        capture_system.unwrap_or(true),
        owner,
    )
    .await
}

#[tauri::command]
pub async fn audio_transcription_stop(app: AppHandle) -> Result<(), String> {
    crate::whisper_speech::whisper_transcription_stop(app).await
}

#[cfg(target_os = "macos")]
pub(crate) mod macos {
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::Arc;

    use objc2::rc::Retained;
    use objc2::AnyThread;
    use objc2_avf_audio::{AVAudioFormat, AVAudioPCMBuffer};
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
        let url = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
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
        speech_format: Retained<AVAudioFormat>,
        app: AppHandle,
        cancelled: Arc<AtomicBool>,
        level_tick: Arc<AtomicU32>,
    }

    // SAFETY: `Retained<SFSpeech*>` and `Retained<AVAudioFormat>` wrap
    // refcounted ObjC objects that Apple documents as message-thread-safe.
    // SCK calls our handler from its own dispatch queue; we never alias
    // these via `&` across threads.
    unsafe impl Send for RawAudioForwarder {}
    unsafe impl Sync for RawAudioForwarder {}

    impl screencapturekit::stream::output_trait::SCStreamOutputTrait for RawAudioForwarder {
        fn did_output_sample_buffer(
            &self,
            sample_buffer: CMSampleBuffer,
            of_type: SCStreamOutputType,
        ) {
            if of_type != SCStreamOutputType::Audio {
                return;
            }
            if self.cancelled.load(Ordering::SeqCst) {
                return;
            }
            let Some(buf) = build_pcm_buffer_from_sample(&sample_buffer, &self.speech_format)
            else {
                return;
            };
            // Hand channel 0 (mono mix) to the callback continuously — no level
            // gate, so the Whisper buffer stays a contiguous stream.
            let frames = unsafe { buf.frameLength() } as usize;
            if frames > 0 {
                let ch_ptr = unsafe { buf.floatChannelData() };
                if !ch_ptr.is_null() {
                    let slice = unsafe { std::slice::from_raw_parts((*ch_ptr).as_ptr(), frames) };
                    (self.on_samples)(slice);
                }
                let n = self.level_tick.fetch_add(1, Ordering::Relaxed);
                if n % 3 == 0 {
                    let level = crate::native_speech::macos::peak_level_for_pcm(&buf);
                    let _ = self.app.emit(
                        "voice:audio-level",
                        AudioLevelPayload {
                            level,
                            source: "system",
                        },
                    );
                }
            }
        }
    }

    /// Handle for a running raw system capture. `stop()` ends the SCK stream.
    pub(crate) struct RawSystemCapture {
        stream: SCStream,
        cancelled: Arc<AtomicBool>,
    }

    // SAFETY: `SCStream` is `Send` (the crate marks it so); the atomic is
    // trivially `Send`. We only move the handle through ownership.
    unsafe impl Send for RawSystemCapture {}

    impl RawSystemCapture {
        pub(crate) fn stop(self) {
            self.cancelled.store(true, Ordering::SeqCst);
            let _ = self.stream.stop_capture();
        }
    }

    /// Start system-audio capture via SCK and forward every mono f32 buffer
    /// (48 kHz) to `on_samples`. No recognizer wiring.
    pub(crate) fn start_raw_system_capture(
        app: AppHandle,
        on_samples: Arc<dyn Fn(&[f32]) + Send + Sync>,
    ) -> Result<RawSystemCapture, String> {
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

        let config = SCStreamConfiguration::new()
            .with_captures_audio(true)
            .with_excludes_current_process_audio(true)
            .with_sample_rate(48000)
            .with_channel_count(2)
            .with_width(2)
            .with_height(2);

        // Mono float32 @ 48 kHz destination format for the mono-mix.
        let speech_format = unsafe {
            let allocated = AVAudioFormat::alloc();
            AVAudioFormat::initStandardFormatWithSampleRate_channels(allocated, 48000.0, 1)
        }
        .ok_or_else(|| "AVAudioFormat init failed for raw system capture".to_string())?;

        let cancelled = Arc::new(AtomicBool::new(false));
        let mut stream = SCStream::new(&filter, &config);
        let forwarder = RawAudioForwarder {
            on_samples,
            speech_format,
            app: app.clone(),
            cancelled: cancelled.clone(),
            level_tick: Arc::new(AtomicU32::new(0)),
        };
        stream.add_output_handler(forwarder, SCStreamOutputType::Audio);

        if let Err(e) = stream.start_capture() {
            cancelled.store(true, Ordering::SeqCst);
            return Err(format!("SCStream start_capture failed: {e:?}"));
        }

        Ok(RawSystemCapture { stream, cancelled })
    }

    #[derive(Serialize, Clone)]
    struct AudioLevelPayload {
        level: f32,
        source: &'static str,
    }

    /// Pull the PCM bytes out of a SCK CMSampleBuffer and copy them into a
    /// freshly-allocated AVAudioPCMBuffer matching `speech_format`
    /// (single-channel float32 at the SCK sample rate). SCK delivers stereo
    /// non-interleaved float32 by default — we mono-mix by averaging the
    /// two channels. Returns `None` if the sample buffer's audio layout
    /// can't be interpreted (rare; only happens if SCK changes its output
    /// shape mid-stream).
    fn build_pcm_buffer_from_sample(
        sample: &CMSampleBuffer,
        speech_format: &AVAudioFormat,
    ) -> Option<Retained<AVAudioPCMBuffer>> {
        let num_samples = sample.num_samples();
        if num_samples == 0 {
            return None;
        }
        let abl = sample.audio_buffer_list()?;
        let n_buffers = abl.num_buffers();
        if n_buffers == 0 {
            return None;
        }

        // Allocate the destination buffer.
        // SAFETY: standard AVAudioPCMBuffer init; we control the format and
        // capacity.
        #[allow(clippy::cast_possible_truncation)]
        let frame_capacity = num_samples as u32;
        let allocated = AVAudioPCMBuffer::alloc();
        let dest = unsafe {
            AVAudioPCMBuffer::initWithPCMFormat_frameCapacity(
                allocated,
                speech_format,
                frame_capacity,
            )
        }?;
        unsafe { dest.setFrameLength(frame_capacity) };

        // SAFETY: the format is the one we constructed below — float, mono,
        // non-interleaved — so `floatChannelData` is non-null and points at
        // `channelCount=1` pointers, each to `frame_capacity` floats.
        let dest_ch_ptr = unsafe { dest.floatChannelData() };
        if dest_ch_ptr.is_null() {
            return None;
        }
        let dest_slice =
            unsafe { std::slice::from_raw_parts_mut((*dest_ch_ptr).as_ptr(), num_samples) };

        if n_buffers >= 2 {
            // Stereo non-interleaved — average the two channels.
            let l = abl.get(0)?;
            let r = abl.get(1)?;
            let l_bytes = l.data();
            let r_bytes = r.data();
            // Treat as f32 little-endian (host byte order on every Apple
            // platform we ship).
            let l_floats = bytes_as_f32(l_bytes);
            let r_floats = bytes_as_f32(r_bytes);
            let n = num_samples.min(l_floats.len()).min(r_floats.len());
            for i in 0..n {
                dest_slice[i] = 0.5 * (l_floats[i] + r_floats[i]);
            }
            for v in dest_slice.iter_mut().take(num_samples).skip(n) {
                *v = 0.0;
            }
        } else {
            // Mono — just copy.
            let only = abl.get(0)?;
            let src = bytes_as_f32(only.data());
            let n = num_samples.min(src.len());
            dest_slice[..n].copy_from_slice(&src[..n]);
            for v in dest_slice.iter_mut().take(num_samples).skip(n) {
                *v = 0.0;
            }
        }

        Some(dest)
    }

    /// Reinterpret a `&[u8]` as `&[f32]`. Length is rounded down to the
    /// nearest multiple of 4. Safe because `f32` has no invalid
    /// bit-patterns and the caller only uses the elements they're
    /// indexing into.
    fn bytes_as_f32(b: &[u8]) -> &[f32] {
        let n = b.len() / 4;
        if n == 0 {
            return &[];
        }
        // SAFETY: `f32` is plain old data with alignment 4; CoreAudio's
        // AudioBuffer pointers are 16-byte aligned in practice. We cap the
        // length at `n` so we never read past the end.
        unsafe { std::slice::from_raw_parts(b.as_ptr().cast::<f32>(), n) }
    }
}
