//! Local Whisper meeting transcription (whisper.cpp via `whisper-rs`).
//!
//! `SFSpeechRecognizer` can only run one recognition task per process — two
//! concurrent cloud recognizers collide ("no speech" 1110), and even
//! on-device they race over a shared resource. For meetings we need BOTH the
//! mic stream and the system-audio stream transcribed in parallel and tagged
//! by `source`. whisper.cpp has no such limit: we run one whisper context with
//! a per-stream worker thread, fully offline.
//!
//! Capture is reused from the existing modules:
//!   - mic    → `native_speech::macos::start_raw_mic_capture` (AVAudioEngine +
//!              VoiceProcessingIO AEC, other-audio ducking off)
//!   - system → `system_audio::macos::start_raw_system_capture` (ScreenCaptureKit)
//!
use tauri::AppHandle;

#[tauri::command]
pub async fn meeting_whisper_start(
    app: AppHandle,
    language: Option<String>,
    mic_device_id: Option<String>,
    mic_device_label: Option<String>,
) -> Result<(), String> {
    if !crate::config::feature_config(&app).whisper_model_enabled {
        return Err("whisper-model-disabled".into());
    }
    #[cfg(target_os = "macos")]
    {
        macos::start(app, language, mic_device_id, mic_device_label).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, language, mic_device_id, mic_device_label);
        Err("Whisper meeting transcription is only supported on macOS.".into())
    }
}

#[tauri::command]
pub async fn meeting_whisper_stop(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::stop(&app);
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::{Arc, Mutex, OnceLock};
    use std::time::{Duration, Instant};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter};
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    use crate::native_speech::macos::{start_raw_mic_capture, RawMicCapture};
    use crate::system_audio::macos::{start_raw_system_capture, RawSystemCapture};
    use crate::whisper_model::{custom_model_override, ensure_model, model_file};

    /// One transcript segment with real timestamps from whisper, already
    /// offset onto the meeting timeline (ms since capture start).
    #[derive(Serialize, Clone)]
    #[serde(rename_all = "camelCase")]
    struct Segment {
        start_ms: i64,
        end_ms: i64,
        text: String,
    }

    #[derive(Serialize, Clone)]
    struct TranscriptPayload {
        /// Joined text of all segments (back-compat for the live overlay).
        text: String,
        source: &'static str,
        /// Per-segment real timestamps (empty for the SFSpeech fallback path).
        segments: Vec<Segment>,
    }

    /// Process-wide whisper context, loaded once and reused across meetings.
    fn context(app: &AppHandle) -> Result<Arc<WhisperContext>, String> {
        // Route whisper.cpp + ggml's chatty stderr logs (model load dump,
        // system-info, per-inference timing) into whisper-rs's logging facade.
        // We don't enable the `log_backend` / `tracing_backend` features, so
        // this discards them rather than printing to stderr. Idempotent — only
        // the first call takes effect.
        whisper_rs::install_logging_hooks();

        static CTX: OnceLock<Mutex<Option<Arc<WhisperContext>>>> = OnceLock::new();
        let slot = CTX.get_or_init(|| Mutex::new(None));
        let mut guard = slot.lock().map_err(|e| e.to_string())?;
        if let Some(ctx) = guard.as_ref() {
            return Ok(ctx.clone());
        }
        let path = model_file(app)?;
        let path_str = path
            .to_str()
            .ok_or_else(|| "model path is not valid UTF-8".to_string())?;
        let ctx = WhisperContext::new_with_params(path_str, WhisperContextParameters::default())
            .map_err(|e| format!("whisper model load failed: {e}"))?;
        let ctx = Arc::new(ctx);
        *guard = Some(ctx.clone());
        Ok(ctx)
    }

    // ---- resampling -------------------------------------------------------

    /// Linear-resample mono f32 to 16 kHz (Whisper's required rate). Per-buffer
    /// resampling introduces negligible boundary error for speech.
    fn resample_to_16k(input: &[f32], src_rate: f64) -> Vec<f32> {
        if input.is_empty() {
            return Vec::new();
        }
        if (src_rate - 16000.0).abs() < 1.0 {
            return input.to_vec();
        }
        let ratio = 16000.0 / src_rate;
        let out_len = ((input.len() as f64) * ratio).floor() as usize;
        let mut out = Vec::with_capacity(out_len);
        for i in 0..out_len {
            let src_pos = i as f64 / ratio;
            let idx = src_pos as usize;
            let frac = (src_pos - idx as f64) as f32;
            let a = input.get(idx).copied().unwrap_or(0.0);
            let b = input.get(idx + 1).copied().unwrap_or(a);
            out.push(a + (b - a) * frac);
        }
        out
    }

    // ---- per-stream worker ------------------------------------------------

    /// One transcription stream (mic or system). Buffers raw capture samples
    /// and runs whisper inference on its own worker thread. Resampling to
    /// 16 kHz happens on the worker, NOT in the realtime capture callback.
    pub(crate) struct WhisperStream {
        source: &'static str,
        /// Hardware capture rate of the raw samples sitting in `buf`.
        src_rate: AtomicU32,
        /// Whisper language code (e.g. "en"); `None` = auto-detect.
        language: Option<String>,
        /// Raw mono f32 at `src_rate` — the worker resamples to 16 kHz.
        buf: Mutex<Vec<f32>>,
        running: Arc<AtomicBool>,
        done: Arc<AtomicBool>,
        app: AppHandle,
        /// Capture start — t=0 of the meeting timeline. Mic and system streams
        /// start within a few ms of each other, so their segment timestamps
        /// share one timeline.
        stream_start: Instant,
        /// When the CURRENT buffer began (reset on each finalize/clear). Whisper
        /// timestamps are relative to the buffer, so this is the offset onto the
        /// meeting timeline.
        buffer_start: Mutex<Instant>,
    }

    impl WhisperStream {
        fn new(
            app: AppHandle,
            source: &'static str,
            src_rate: f64,
            language: Option<String>,
            ctx: Arc<WhisperContext>,
            stream_start: Instant,
        ) -> Arc<Self> {
            let done = Arc::new(AtomicBool::new(false));
            let stream = Arc::new(WhisperStream {
                source,
                src_rate: AtomicU32::new(src_rate as u32),
                language,
                buf: Mutex::new(Vec::new()),
                running: Arc::new(AtomicBool::new(true)),
                done: done.clone(),
                app,
                stream_start,
                buffer_start: Mutex::new(stream_start),
            });
            let worker_stream = stream.clone();
            std::thread::spawn(move || {
                worker(worker_stream, ctx);
                done.store(true, Ordering::SeqCst);
            });
            stream
        }

        fn set_src_rate(&self, rate: f64) {
            self.src_rate.store(rate as u32, Ordering::SeqCst);
        }

        /// Called from the realtime capture callback. Keep this cheap — just
        /// append raw samples under the lock. Resampling (which allocates) is
        /// deliberately deferred to the worker so we never allocate/compute on
        /// the realtime audio thread.
        fn push(&self, frames: &[f32]) {
            if let Ok(mut buf) = self.buf.lock() {
                buf.extend_from_slice(frames);
            }
        }

        fn stop(&self) {
            self.running.store(false, Ordering::SeqCst);
        }

        /// Offset (ms) of the current buffer onto the meeting timeline.
        fn offset_ms(&self) -> i64 {
            self.buffer_start
                .lock()
                .map(|b| b.duration_since(self.stream_start).as_millis() as i64)
                .unwrap_or(0)
        }

        /// Mark the start of a fresh buffer (called when the buffer is cleared
        /// on finalize) so the next utterance's whisper timestamps offset
        /// correctly onto the meeting timeline.
        fn reset_buffer_start(&self) {
            if let Ok(mut b) = self.buffer_start.lock() {
                *b = Instant::now();
            }
        }

        /// Clean an inference result and, if it survives, emit it on `event`
        /// (`voice:partial-transcript` / `voice:final-transcript`) tagged with
        /// this stream's source. `raw_segs` are whisper segments with
        /// buffer-relative ms; `offset_ms` shifts them onto the meeting timeline.
        fn emit_transcript(
            &self,
            event: &'static str,
            raw_segs: &[(i64, i64, String)],
            offset_ms: i64,
        ) {
            if raw_segs.is_empty() {
                return;
            }
            let joined: String = raw_segs
                .iter()
                .map(|(_, _, t)| t.trim())
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            // Drop a whole-output hallucination ("you", "thank you", …).
            let Some(clean) = clean_transcript(&joined) else {
                return;
            };
            let segments = raw_segs
                .iter()
                .map(|(s, e, t)| Segment {
                    start_ms: offset_ms + s,
                    end_ms: offset_ms + e,
                    text: t.trim().to_string(),
                })
                .collect();
            let _ = self.app.emit(
                event,
                TranscriptPayload {
                    text: clean,
                    source: self.source,
                    segments,
                },
            );
        }
    }

    /// Run whisper over `samples` (16 kHz mono f32), returning each speech
    /// segment as `(start_ms, end_ms, text)` with buffer-relative timestamps.
    /// `language` is the forced language code (e.g. "en"); `None` lets whisper
    /// auto-detect (used for custom/multilingual models).
    fn infer(
        state: &mut whisper_rs::WhisperState,
        samples: &[f32],
        language: Option<&str>,
    ) -> Vec<(i64, i64, String)> {
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(4);
        params.set_language(language);
        params.set_translate(false);
        params.set_no_context(true);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        if state.full(params, samples).is_err() {
            return Vec::new();
        }
        let mut out = Vec::new();
        for segment in state.as_iter() {
            let text = segment.to_string();
            if is_speech(&text) {
                // whisper timestamps are in centiseconds → ms.
                out.push((
                    segment.start_timestamp() * 10,
                    segment.end_timestamp() * 10,
                    text,
                ));
            }
        }
        out
    }

    /// Whisper emits non-speech placeholders on silence/music —
    /// `[BLANK_AUDIO]`, `(silence)`, `[Music]`, bare `...`, `*`, etc. Reject
    /// anything that's empty, has no alphanumeric content, or is wholly wrapped
    /// in brackets/parens (a sound annotation, not spoken words).
    fn is_speech(text: &str) -> bool {
        let t = text.trim();
        if t.is_empty() {
            return false;
        }
        if !t.chars().any(|c| c.is_alphanumeric()) {
            return false;
        }
        if (t.starts_with('[') && t.ends_with(']')) || (t.starts_with('(') && t.ends_with(')')) {
            return false;
        }
        true
    }

    const SAMPLE_RATE_16K: f32 = 16000.0;
    /// RMS above this counts as speech for the silence/end-of-utterance timer.
    const VOICE_RMS_THRESHOLD: f32 = 0.006;

    fn worker(stream: Arc<WhisperStream>, ctx: Arc<WhisperContext>) {
        let mut state = match ctx.create_state() {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[whisper-{}] create_state failed: {e}", stream.source);
                let _ = stream.app.emit(
                    "pill:error",
                    serde_json::json!({ "error": format!("Transcription worker ({}) failed: {e}", stream.source) }),
                );
                return;
            }
        };
        let lang = stream.language.as_deref();
        let mut last_len = 0usize;
        let mut last_infer = Instant::now() - Duration::from_secs(10);
        let mut last_voice = Instant::now();
        // Whether the CURRENT utterance buffer ever crossed the voice
        // threshold. Whisper hallucinates filler ("you", "thank you") on
        // silent audio, so we NEVER run inference on a buffer with no voice.
        let mut had_voice = false;

        while stream.running.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(250));

            // Clone the raw buffer (cheap relative to inference), then resample
            // to 16 kHz here on the worker rather than on the audio thread.
            let raw = match stream.buf.lock() {
                Ok(b) => b.clone(),
                Err(_) => continue,
            };
            let src_rate = stream.src_rate.load(Ordering::SeqCst) as f64;
            let samples = resample_to_16k(&raw, src_rate);
            let len = samples.len();

            // Track voice activity over the newly-arrived region.
            if len > last_len {
                let new = &samples[last_len..];
                let rms = (new.iter().map(|x| x * x).sum::<f32>() / new.len() as f32).sqrt();
                if rms > VOICE_RMS_THRESHOLD {
                    last_voice = Instant::now();
                    had_voice = true;
                }
                last_len = len;
            }

            let have_secs = len as f32 / SAMPLE_RATE_16K;
            let silence = last_voice.elapsed();

            // Finalize on a real pause (>0.8 s silence with >0.4 s speech) or
            // when the buffer grows too long to keep as one utterance.
            if (have_secs > 0.4 && silence > Duration::from_millis(800)) || have_secs > 25.0 {
                // Only transcribe if the utterance actually contained voice —
                // otherwise we'd feed whisper silence and get a hallucinated
                // "you" / "Thank you.".
                if had_voice && have_secs > 0.4 {
                    let segs = infer(&mut state, &samples, lang);
                    stream.emit_transcript("voice:final-transcript", &segs, stream.offset_ms());
                }
                let n_processed = raw.len();
                if let Ok(mut b) = stream.buf.lock() {
                    let to_drain = n_processed.min(b.len());
                    b.drain(..to_drain);
                }
                // New buffer begins now — advance the timeline offset so the
                // next utterance's whisper timestamps map correctly.
                stream.reset_buffer_start();
                last_len = 0;
                had_voice = false;
                last_infer = Instant::now();
                continue;
            }

            // Partial while speech is still accruing (only once real voice has
            // been heard in this utterance).
            if had_voice && have_secs > 0.5 && last_infer.elapsed() > Duration::from_millis(1200) {
                let segs = infer(&mut state, &samples, lang);
                stream.emit_transcript("voice:partial-transcript", &segs, stream.offset_ms());
                last_infer = Instant::now();
            }
        }

        // Flush a final transcript for any trailing speech on stop.
        let raw = stream.buf.lock().map(|b| b.clone()).unwrap_or_default();
        let src_rate = stream.src_rate.load(Ordering::SeqCst) as f64;
        let samples = resample_to_16k(&raw, src_rate);
        if had_voice && samples.len() as f32 / SAMPLE_RATE_16K > 0.3 {
            let segs = infer(&mut state, &samples, lang);
            stream.emit_transcript("voice:final-transcript", &segs, stream.offset_ms());
        }
        eprintln!("[whisper-{}] worker stopped", stream.source);
    }

    /// Trim the inference output and drop it entirely if it's empty or a known
    /// whisper silence hallucination. Returns the cleaned text to emit, or
    /// `None` to suppress. The denylist only matches when the hallucination is
    /// the WHOLE output (so a real "...you?" inside a sentence still passes).
    fn clean_transcript(text: &str) -> Option<String> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }
        let normalized = trimmed
            .trim_matches(|c: char| !c.is_alphanumeric())
            .to_ascii_lowercase();
        // Only list phrases whisper fabricates on silence/near-silence. We
        // deliberately do NOT list real one-word replies ("okay", "so",
        // "thanks", "bye") — those are legitimate meeting utterances, and the
        // RMS voice gate (`had_voice`) is the primary defense against silence
        // hallucinations. Keep this list to the unambiguous YouTube-caption
        // artifacts whisper emits.
        const HALLUCINATIONS: &[&str] = &[
            "you",
            "thank you",
            "thank you very much",
            "thanks for watching",
            "thank you for watching",
            "please subscribe",
        ];
        if HALLUCINATIONS.contains(&normalized.as_str()) {
            return None;
        }
        Some(trimmed.to_string())
    }

    // ---- session ----------------------------------------------------------

    struct Session {
        mic_cap: RawMicCapture,
        sys_cap: RawSystemCapture,
        mic: Arc<WhisperStream>,
        sys: Arc<WhisperStream>,
    }

    // SAFETY: the capture handles hold refcounted ObjC objects (already
    // `Send`); the streams are `Arc` over `Send + Sync` interiors. We only move
    // the session through the `Mutex`, never alias across threads.
    unsafe impl Send for Session {}

    fn session_slot() -> &'static Mutex<Option<Session>> {
        static SLOT: OnceLock<Mutex<Option<Session>>> = OnceLock::new();
        SLOT.get_or_init(|| Mutex::new(None))
    }

    pub async fn start(
        app: AppHandle,
        language: Option<String>,
        mic_device_id: Option<String>,
        mic_device_label: Option<String>,
    ) -> Result<(), String> {
        // Tear down any prior session first.
        stop(&app);

        // Download (first run) + load the model before opening any capture so a
        // model failure doesn't leave half-open audio streams.
        ensure_model(&app).await.map_err(|e| {
            let _ = app.emit("pill:error", serde_json::json!({ "error": e }));
            e
        })?;
        let ctx = context(&app).map_err(|e| {
            let _ = app.emit("pill:error", serde_json::json!({ "error": e }));
            e
        })?;
        // Preflight: verify a WhisperState can be created before opening any
        // captures. Fails fast with a visible error instead of a silent worker
        // that exits immediately after launch.
        ctx.create_state().map_err(|e| {
            let msg = format!("whisper state init failed: {e}");
            let _ = app.emit("pill:error", serde_json::json!({ "error": msg }));
            msg
        })?;

        // Custom/multilingual models always get auto-detect regardless of the
        // supplied locale — forcing "en" onto a multilingual model when the
        // meeting is in another language produces poor transcripts. The bundled
        // ggml-base.en ignores the language field entirely, so forcing "en" is
        // only useful for it (and harmless for other en-only models).
        let lang: Option<String> = if custom_model_override() {
            None
        } else {
            match language.as_deref() {
                Some(l) if !l.trim().is_empty() => Some(
                    l.split(['-', '_'])
                        .next()
                        .unwrap_or("en")
                        .to_ascii_lowercase(),
                ),
                _ => Some("en".to_string()),
            }
        };

        // Mic stream + capture. The real hardware rate is read back from the
        // capture handle and pushed into the stream (default 48 kHz until then).
        let session_start = Instant::now();
        let mic_stream = WhisperStream::new(app.clone(), "mic", 48000.0, lang.clone(), ctx.clone(), session_start);
        let mic_for_cb = mic_stream.clone();
        let mic_cap = start_raw_mic_capture(
            app.clone(),
            mic_device_id,
            mic_device_label,
            Arc::new(move |s: &[f32]| mic_for_cb.push(s)),
        )
        .map_err(|e| {
            mic_stream.stop();
            format!("mic capture failed: {e}")
        })?;
        mic_stream.set_src_rate(mic_cap.sample_rate());

        // System stream + capture (SCK delivers 48 kHz).
        let sys_stream =
            WhisperStream::new(app.clone(), "system", 48000.0, lang.clone(), ctx.clone(), session_start);
        let sys_for_cb = sys_stream.clone();
        let sys_cap = match start_raw_system_capture(
            app.clone(),
            Arc::new(move |s: &[f32]| sys_for_cb.push(s)),
        ) {
            Ok(cap) => cap,
            Err(e) => {
                // Roll back the mic side so we don't leave a half-open meeting.
                sys_stream.stop();
                mic_stream.stop();
                mic_cap.stop();
                return Err(format!("system capture failed: {e}"));
            }
        };

        let mut slot = session_slot().lock().map_err(|e| e.to_string())?;
        *slot = Some(Session {
            mic_cap,
            sys_cap,
            mic: mic_stream,
            sys: sys_stream,
        });
        eprintln!("[whisper] meeting transcription started (mic + system)");
        Ok(())
    }

    pub fn stop(_app: &AppHandle) {
        let session = match session_slot().lock() {
            Ok(mut slot) => slot.take(),
            Err(_) => return,
        };
        let Some(session) = session else {
            return;
        };
        // Signal workers to stop. They flush a final transcript after the loop.
        session.mic.stop();
        session.sys.stop();
        // Stop captures so no more samples arrive while workers flush.
        session.mic_cap.stop();
        session.sys_cap.stop();
        // Wait up to 4 s for both workers to finish their final flush so
        // trailing speech is not lost when the frontend unregisters listeners.
        let deadline = Instant::now() + Duration::from_secs(4);
        while Instant::now() < deadline {
            if session.mic.done.load(Ordering::SeqCst)
                && session.sys.done.load(Ordering::SeqCst)
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        eprintln!("[whisper] meeting transcription stopped");
    }
}
