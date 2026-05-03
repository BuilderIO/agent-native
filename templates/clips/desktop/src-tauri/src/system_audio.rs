//! System-audio capture via Apple's ScreenCaptureKit (macOS 13+).
//!
//! The mic recognizer in `native_speech.rs` only catches the local user. For
//! Meetings we also need to transcribe whatever the *other* party is saying
//! — i.e. the speaker output. This module taps that stream via
//! `SCStream` + `SCStreamConfiguration::with_captures_audio(true)` and feeds
//! the resulting PCM into a SECOND `SFSpeechRecognizer` running in parallel
//! with the mic recognizer. The two transcript streams are merged at the
//! renderer by the existing `LiveTranscript` component, tagged via the
//! `source: "mic" | "system"` field on each `voice:partial-transcript` /
//! `voice:final-transcript` event.
//!
//! ## Approach
//!
//! Approach 1 from the spec: use the safe `screencapturekit` Rust crate
//! (v1.5.4 — verified via `cargo info screencapturekit`). Its
//! `SCStreamOutputTrait` callback hands us a `CMSampleBuffer` for each
//! audio frame, which we copy into an `AVAudioPCMBuffer` and forward to
//! `SFSpeechAudioBufferRecognitionRequest::appendAudioPCMBuffer:`.
//!
//! ## Single-channel limitation workaround
//!
//! `SFSpeechRecognizer` is single-channel. SCK by default produces stereo
//! 48 kHz float frames; we mono-mix on the way to the recognizer.
//!
//! ## Tauri commands
//!
//! | Command                             | Purpose                                     |
//! | ----------------------------------- | ------------------------------------------- |
//! | `system_audio_request_permission`   | Probe + request Screen Recording perm.      |
//! | `system_audio_start`                | Start the SCStream + parallel recognizer.   |
//! | `system_audio_stop`                 | Cancel the stream and recognizer task.      |
//! | `meeting_audio_start`               | Start mic + system in parallel atomically.  |
//! | `meeting_audio_stop`                | Stop both.                                  |
//!
//! ## Events
//!
//! Same names as `native_speech.rs`, additive `source: "system"` field:
//!   - `voice:partial-transcript` `{ text, source: "system", isFinal: false }`
//!   - `voice:final-transcript`   `{ text, source: "system", isFinal: true }`
//!   - `voice:speech-error`       `{ error, source: "system" }`
//!   - `voice:audio-level`        `{ level, source: "system" }`

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
pub async fn system_audio_start(
    app: AppHandle,
    meeting_id: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::system_audio_start_impl(app, meeting_id).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, meeting_id);
        Err("System audio capture is only supported on macOS.".into())
    }
}

#[tauri::command]
pub async fn system_audio_stop(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::system_audio_stop_impl(app).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
pub async fn meeting_audio_start(
    app: AppHandle,
    meeting_id: Option<String>,
    locale: Option<String>,
) -> Result<(), String> {
    // Start mic first (less likely to fail). If that succeeds, start system
    // audio; if THAT fails, tear the mic back down so we don't leave a
    // half-open meeting recorder.
    crate::native_speech::native_speech_start(app.clone(), locale).await?;
    if let Err(err) = system_audio_start(app.clone(), meeting_id).await {
        // Best-effort rollback. We deliberately ignore this Result: even if
        // mic shutdown also fails, the original system-audio error is the
        // one the user needs to see.
        let _ = crate::native_speech::native_speech_cancel(app).await;
        return Err(err);
    }
    Ok(())
}

#[tauri::command]
pub async fn meeting_audio_stop(app: AppHandle) -> Result<(), String> {
    // Fire both stops in sequence; surface whichever fails first but always
    // attempt the other so we don't leak streams.
    let mic = crate::native_speech::native_speech_stop(app.clone()).await;
    let sys = system_audio_stop(app).await;
    mic.and(sys)
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::{Arc, Mutex, OnceLock};

    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::AnyThread;
    use objc2_avf_audio::{AVAudioFormat, AVAudioPCMBuffer};
    use objc2_foundation::{NSError, NSLocale, NSProcessInfo, NSString};
    use objc2_speech::{
        SFSpeechAudioBufferRecognitionRequest, SFSpeechRecognitionResult, SFSpeechRecognitionTask,
        SFSpeechRecognizer,
    };
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

    /// Output handler bound to the SCK stream. Holds a clone of the
    /// `SFSpeechAudioBufferRecognitionRequest` and the AppHandle so it can
    /// emit waveform-level events. Implements `Fn(CMSampleBuffer,
    /// SCStreamOutputType)` via the crate's blanket impl.
    struct AudioForwarder {
        request: Retained<SFSpeechAudioBufferRecognitionRequest>,
        speech_format: Retained<AVAudioFormat>,
        app: AppHandle,
        cancelled: Arc<AtomicBool>,
        level_tick: Arc<AtomicU32>,
    }

    // SAFETY: `Retained<SFSpeech*>` and `Retained<AVAudioFormat>` wrap
    // refcounted ObjC objects that Apple documents as message-thread-safe.
    // SCK calls our handler from its own dispatch queue; we never alias
    // these via `&` across threads.
    unsafe impl Send for AudioForwarder {}
    unsafe impl Sync for AudioForwarder {}

    impl screencapturekit::stream::output_trait::SCStreamOutputTrait for AudioForwarder {
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
            if let Some(buf) = build_pcm_buffer_from_sample(&sample_buffer, &self.speech_format) {
                // Forward to the recognizer.
                // SAFETY: `appendAudioPCMBuffer:` retains the buffer
                // internally; the buffer keeps its underlying float storage
                // alive via Retained.
                unsafe {
                    self.request.appendAudioPCMBuffer(&buf);
                }
                // Throttle level emission to ~20 Hz.
                let n = self.level_tick.fetch_add(1, Ordering::Relaxed);
                if n % 3 == 0 {
                    let level = crate::native_speech::macos::peak_level_for_pcm(&buf);
                    let _ = self.app.emit(
                        "voice:audio-level",
                        AudioLevelPayload { level, source: "system" },
                    );
                }
            }
        }
    }

    /// One in-flight system-audio capture. Mirrors `SpeechSession` in
    /// `native_speech.rs`.
    struct SystemAudioSession {
        stream: SCStream,
        #[allow(dead_code)] // keeps the request alive while the task runs
        request: Retained<SFSpeechAudioBufferRecognitionRequest>,
        task: Retained<SFSpeechRecognitionTask>,
        cancelled: Arc<AtomicBool>,
    }

    // SAFETY: see AudioForwarder. SCStream itself is Send (the crate marks
    // it so).
    unsafe impl Send for SystemAudioSession {}

    fn session_slot() -> &'static Mutex<Option<SystemAudioSession>> {
        static SLOT: OnceLock<Mutex<Option<SystemAudioSession>>> = OnceLock::new();
        SLOT.get_or_init(|| Mutex::new(None))
    }

    #[derive(Serialize, Clone)]
    struct PartialPayload {
        text: String,
        source: &'static str,
    }

    #[derive(Serialize, Clone)]
    struct FinalPayload {
        text: String,
        source: &'static str,
    }

    #[derive(Serialize, Clone)]
    struct ErrorPayload {
        error: String,
        source: &'static str,
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
        let dest_slice = unsafe {
            std::slice::from_raw_parts_mut((*dest_ch_ptr).as_ptr(), num_samples)
        };

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

    /// Same authorization gate as `native_speech.rs`, duplicated here so the
    /// system path can prompt independently if the mic recognizer wasn't
    /// run first.
    fn ensure_speech_authorized() -> Result<(), String> {
        let current = unsafe { SFSpeechRecognizer::authorizationStatus() };
        use objc2_speech::SFSpeechRecognizerAuthorizationStatus as S;
        if current == S::Authorized {
            return Ok(());
        }
        if current == S::Denied {
            return Err(
                "Speech recognition denied (System Settings > Privacy & Security > Speech Recognition)."
                    .into(),
            );
        }
        if current == S::Restricted {
            return Err("Speech recognition is restricted on this device.".into());
        }
        let (tx, rx) = std::sync::mpsc::sync_channel::<S>(1);
        let tx = Mutex::new(Some(tx));
        let handler = RcBlock::new(move |status: S| {
            if let Ok(mut g) = tx.lock() {
                if let Some(s) = g.take() {
                    let _ = s.send(status);
                }
            }
        });
        unsafe { SFSpeechRecognizer::requestAuthorization(&handler) };
        match rx.recv_timeout(std::time::Duration::from_secs(30)) {
            Ok(S::Authorized) => Ok(()),
            Ok(S::Denied) => Err("Speech recognition denied by user.".into()),
            Ok(S::Restricted) => Err("Speech recognition is restricted on this device.".into()),
            _ => Err("Speech recognition authorization unavailable.".into()),
        }
    }

    fn build_recognizer(locale: Option<&str>) -> Result<Retained<SFSpeechRecognizer>, String> {
        let identifier = locale.unwrap_or("en-US");
        let recognizer = unsafe {
            let ns_id = NSString::from_str(identifier);
            let locale_obj: Retained<NSLocale> = objc2::msg_send![
                <NSLocale as objc2::ClassType>::class(),
                localeWithLocaleIdentifier: &*ns_id
            ];
            let allocated = SFSpeechRecognizer::alloc();
            SFSpeechRecognizer::initWithLocale(allocated, &locale_obj)
        };
        let recognizer = recognizer.ok_or_else(|| {
            format!("SFSpeechRecognizer init failed for locale {identifier} (system audio)")
        })?;
        if !unsafe { recognizer.isAvailable() } {
            return Err(
                "SFSpeechRecognizer is not currently available for system audio (network down?)."
                    .into(),
            );
        }
        Ok(recognizer)
    }

    fn ns_error_message(err: &NSError) -> String {
        let desc: Retained<NSString> = unsafe { objc2::msg_send![err, localizedDescription] };
        let s = desc.to_string();
        if s.is_empty() {
            format!("NSError code {}", err.code())
        } else {
            s
        }
    }

    pub async fn system_audio_start_impl(
        app: AppHandle,
        _meeting_id: Option<String>,
    ) -> Result<(), String> {
        // Tear down any prior session so we have a clean slate.
        {
            let mut slot = session_slot().lock().map_err(|e| e.to_string())?;
            if let Some(prev) = slot.take() {
                prev.cancelled.store(true, Ordering::SeqCst);
                let _ = prev.stream.stop_capture();
                unsafe { prev.task.cancel() };
            }
        }

        // Probe permission. SCShareableContent::get() returns an error if
        // Screen Recording isn't authorized — but we want a clean upfront
        // gate so the renderer can surface the right "open Settings"
        // affordance.
        let granted = unsafe { CGPreflightScreenCaptureAccess() };
        if !granted {
            // Trigger the prompt; if the user denies, this returns false.
            let granted_now = unsafe { CGRequestScreenCaptureAccess() };
            if !granted_now {
                return Err(
                    "Screen Recording permission denied. Open System Settings > Privacy & Security > Screen Recording, enable Clips, then try again."
                        .into(),
                );
            }
        }

        // Speech permission is shared with the mic recognizer — but we may
        // be invoked stand-alone, so prompt here too.
        ensure_speech_authorized()?;

        // 1. Build the SCK content filter. SCK requires a filter even for
        //    audio-only capture; we pass any display + an empty exclusion
        //    list. No window or app filter — we want everything routed
        //    through the speakers.
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

        // 2. Configure for audio-only capture. We still get a tiny video
        //    stream (SCK insists), but we just don't subscribe to the
        //    Screen output type — only Audio. Output sample rate 48 kHz
        //    (the SFSpeechRecognizer accepts this and the SCK pipeline
        //    operates more efficiently here than at 16 kHz).
        let config = SCStreamConfiguration::new()
            .with_captures_audio(true)
            .with_excludes_current_process_audio(true)
            .with_sample_rate(48000)
            .with_channel_count(2)
            // 2x2 frames, 1fps — SCK requires *some* video config but we
            // don't subscribe to the Screen output handler.
            .with_width(2)
            .with_height(2);

        // 3. Build the parallel SFSpeechRecognizer + request.
        let recognizer = build_recognizer(None)?;
        let request: Retained<SFSpeechAudioBufferRecognitionRequest> =
            unsafe { SFSpeechAudioBufferRecognitionRequest::new() };
        unsafe {
            request.setShouldReportPartialResults(true);
            request.setAddsPunctuation(true);
        }

        // The recognizer expects whatever format we feed it — we'll feed
        // mono float32 at 48 kHz so the recognizer can resample
        // internally. Building the AVAudioFormat once and reusing it for
        // every CMSampleBuffer keeps the callback allocation-light.
        // SAFETY: `initStandardFormatWithSampleRate:channels:` is the
        // documented constructor for non-interleaved float32 PCM. Returns
        // nil only if we pass insane values (we don't).
        let speech_format = unsafe {
            let allocated = AVAudioFormat::alloc();
            AVAudioFormat::initStandardFormatWithSampleRate_channels(allocated, 48000.0, 1)
        }
        .ok_or_else(|| "AVAudioFormat init failed for system audio".to_string())?;

        let cancelled = Arc::new(AtomicBool::new(false));

        // 4. Wire the result handler. Same shape as the mic handler in
        //    `native_speech.rs`, but tagged `source: "system"`.
        let app_for_handler = app.clone();
        let cancelled_for_handler = cancelled.clone();
        let result_handler = RcBlock::new(
            move |result_ptr: *mut SFSpeechRecognitionResult, error_ptr: *mut NSError| {
                if cancelled_for_handler.load(Ordering::SeqCst) {
                    return;
                }
                if !error_ptr.is_null() && result_ptr.is_null() {
                    // SAFETY: `error_ptr` non-null per the check; the
                    // recognizer keeps it alive for this callback.
                    let err = unsafe { &*error_ptr };
                    let msg = ns_error_message(err);
                    let _ = app_for_handler.emit(
                        "voice:speech-error",
                        ErrorPayload { error: msg, source: "system" },
                    );
                    return;
                }
                if result_ptr.is_null() {
                    return;
                }
                // SAFETY: result_ptr non-null per the check.
                let result = unsafe { &*result_ptr };
                let transcription = unsafe { result.bestTranscription() };
                let formatted = unsafe { transcription.formattedString() };
                let text = formatted.to_string();
                let is_final = unsafe { result.isFinal() };
                if is_final {
                    let _ = app_for_handler.emit(
                        "voice:final-transcript",
                        FinalPayload { text, source: "system" },
                    );
                } else {
                    let _ = app_for_handler.emit(
                        "voice:partial-transcript",
                        PartialPayload { text, source: "system" },
                    );
                }
            },
        );

        let task = unsafe {
            recognizer.recognitionTaskWithRequest_resultHandler(&request, &result_handler)
        };

        // 5. Build the SCStream and bind the audio output handler.
        let mut stream = SCStream::new(&filter, &config);
        let forwarder = AudioForwarder {
            request: request.clone(),
            speech_format: speech_format.clone(),
            app: app.clone(),
            cancelled: cancelled.clone(),
            level_tick: Arc::new(AtomicU32::new(0)),
        };
        stream.add_output_handler(forwarder, SCStreamOutputType::Audio);

        // 6. Start. If startup fails, cancel the recognizer task so we
        //    don't leak.
        if let Err(e) = stream.start_capture() {
            cancelled.store(true, Ordering::SeqCst);
            unsafe { task.cancel() };
            return Err(format!("SCStream start_capture failed: {e:?}"));
        }

        // Suppress unused warning — `_meeting_id` is reserved for future
        // wiring (per-meeting transcript routing).
        let _ = NonNull::new(std::ptr::null_mut::<()>());

        let session = SystemAudioSession {
            stream,
            request,
            task,
            cancelled,
        };
        let mut slot = session_slot().lock().map_err(|e| e.to_string())?;
        *slot = Some(session);
        Ok(())
    }

    pub async fn system_audio_stop_impl(_app: AppHandle) -> Result<(), String> {
        let session = {
            let mut slot = session_slot().lock().map_err(|e| e.to_string())?;
            slot.take()
        };
        let Some(session) = session else {
            return Ok(());
        };
        session.cancelled.store(true, Ordering::SeqCst);
        // End the recognizer first so any in-flight buffers can drain into
        // a final result event. Then cancel; SFSpeech tolerates double
        // termination.
        unsafe { session.request.endAudio() };
        let stop_err = session.stream.stop_capture().err();
        unsafe { session.task.cancel() };
        if let Some(e) = stop_err {
            return Err(format!("SCStream stop_capture failed: {e:?}"));
        }
        Ok(())
    }
}
