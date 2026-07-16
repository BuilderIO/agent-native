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
//!              optional VoiceProcessingIO AEC, other-audio ducking off)
//!   - meetings on macOS 15+ → one ScreenCaptureKit stream with independent
//!              microphone + system-audio outputs
//!   - legacy system audio → `system_audio::macos::start_raw_system_capture`
//!
use tauri::AppHandle;

/// Final transcripts emitted since the current session started — logged at
/// stop so a silent session (0 finals despite real speech) is visible in
/// tray-timings.log.
pub(crate) static FINALS_EMITTED: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);
/// Raw audio samples pushed by the mic / system capture callbacks since the
/// current session started. Zero at stop = the capture callbacks never fired
/// (permission/stream problem); nonzero with zero finals = whisper saw only
/// silence or the workers failed downstream.
pub(crate) static MIC_SAMPLES: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);
pub(crate) static SYSTEM_SAMPLES: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);
/// Peak absolute amplitude per stream (stored as milli-units, 0..=1000).
/// Distinguishes real audio from digital silence when sample counts are
/// nonzero but whisper emits nothing.
pub(crate) static MIC_PEAK_MILLI: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);
pub(crate) static SYSTEM_PEAK_MILLI: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

#[tauri::command]
pub async fn whisper_transcription_start(
    app: AppHandle,
    language: Option<String>,
    mic_device_id: Option<String>,
    mic_device_label: Option<String>,
    capture_system: bool,
    voice_processing: bool,
    owner: Option<String>,
) -> Result<(), String> {
    if !crate::config::feature_config(&app).whisper_model_enabled {
        return Err("whisper-model-disabled".into());
    }
    #[cfg(target_os = "macos")]
    {
        crate::diag::tray_diag(
            &app,
            serde_json::json!({
                "event": "whisper-start-requested",
                "captureSystem": capture_system,
                "owner": owner,
            }),
        );
        let prior_mic = MIC_SAMPLES.load(std::sync::atomic::Ordering::Relaxed);
        if prior_mic > 0 {
            crate::diag::tray_diag(
                &app,
                serde_json::json!({
                    "event": "whisper-session-superseded",
                    "finalsEmitted": FINALS_EMITTED
                        .load(std::sync::atomic::Ordering::Relaxed),
                    "micSamples": prior_mic,
                    "systemSamples": SYSTEM_SAMPLES
                        .load(std::sync::atomic::Ordering::Relaxed),
                    "micPeakMilli": MIC_PEAK_MILLI
                        .load(std::sync::atomic::Ordering::Relaxed),
                    "systemPeakMilli": SYSTEM_PEAK_MILLI
                        .load(std::sync::atomic::Ordering::Relaxed),
                }),
            );
        }
        FINALS_EMITTED.store(0, std::sync::atomic::Ordering::Relaxed);
        MIC_SAMPLES.store(0, std::sync::atomic::Ordering::Relaxed);
        SYSTEM_SAMPLES.store(0, std::sync::atomic::Ordering::Relaxed);
        MIC_PEAK_MILLI.store(0, std::sync::atomic::Ordering::Relaxed);
        SYSTEM_PEAK_MILLI.store(0, std::sync::atomic::Ordering::Relaxed);
        let diag_app = app.clone();
        let result = macos::start(
            app,
            language,
            mic_device_id,
            mic_device_label,
            capture_system,
            voice_processing,
            macos::SessionOwner::from_param(owner),
        )
        .await;
        crate::diag::tray_diag(
            &diag_app,
            serde_json::json!({
                "event": "whisper-start-result",
                "ok": result.is_ok(),
                "error": result.as_ref().err().cloned(),
            }),
        );
        result
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (
            app,
            language,
            mic_device_id,
            mic_device_label,
            capture_system,
            voice_processing,
            owner,
        );
        Err("Whisper transcription is only supported on macOS.".into())
    }
}

/// Warm the process-wide whisper context off the recording-start path.
///
/// Loading the ~142 MB model into memory (`WhisperContext::new`) is synchronous
/// and costs hundreds of ms on first use. Without this, the very first
/// recording pays that cost between the user's Record gesture and audio
/// actually capturing — the perceived "start lag". Call this at app startup
/// (after the model file is downloaded) so the context is already cached.
///
/// Blocking work — call from a `spawn_blocking` context, not the async runtime.
#[cfg(target_os = "macos")]
pub fn prewarm_context(app: &AppHandle) -> Result<(), String> {
    macos::prewarm(app)
}

#[cfg(not(target_os = "macos"))]
pub fn prewarm_context(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn whisper_transcription_stop(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::stop(&app);
        crate::diag::tray_diag(
            &app,
            serde_json::json!({
                "event": "whisper-stopped",
                "finalsEmitted": FINALS_EMITTED
                    .load(std::sync::atomic::Ordering::Relaxed),
                "micSamples": MIC_SAMPLES
                    .load(std::sync::atomic::Ordering::Relaxed),
                "systemSamples": SYSTEM_SAMPLES
                    .load(std::sync::atomic::Ordering::Relaxed),
                "micPeakMilli": MIC_PEAK_MILLI
                    .load(std::sync::atomic::Ordering::Relaxed),
                "systemPeakMilli": SYSTEM_PEAK_MILLI
                    .load(std::sync::atomic::Ordering::Relaxed),
            }),
        );
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
pub async fn whisper_transcription_reset_timeline() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::reset_timeline();
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
    use std::sync::{Arc, Mutex, OnceLock};
    use std::time::{Duration, Instant};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter};
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    use crate::native_speech::macos::{
        start_raw_mic_capture, MicVoiceProcessingMode, RawMicCapture,
    };
    use crate::system_audio::macos::{
        start_raw_meeting_capture, start_raw_system_capture, supports_sck_microphone_capture,
        RawSckAudioCapture,
    };
    use crate::whisper_model::{ensure_model, model_file};

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
        /// Sentence-ish segments (words grouped at sentence punctuation) —
        /// the granularity meeting notes and the live overlay expect.
        segments: Vec<Segment>,
        /// Word-level timestamps (whisper token timestamps, max_len=1). The
        /// recording transcript stores THESE so the editors can highlight,
        /// seek, and delete at word precision like Descript.
        words: Vec<Segment>,
    }

    /// Process-wide whisper context, reused across meetings. Keyed by model
    /// path: switching the model in settings drops the old context on the
    /// next load (freeing its RAM once running streams finish) and loads the
    /// newly chosen model instead.
    fn context(app: &AppHandle) -> Result<Arc<WhisperContext>, String> {
        // Route whisper.cpp + ggml's chatty stderr logs (model load dump,
        // system-info, per-inference timing) into whisper-rs's logging facade.
        // We don't enable the `log_backend` / `tracing_backend` features, so
        // this discards them rather than printing to stderr. Idempotent — only
        // the first call takes effect.
        whisper_rs::install_logging_hooks();

        static CTX: OnceLock<Mutex<Option<(std::path::PathBuf, Arc<WhisperContext>)>>> =
            OnceLock::new();
        let slot = CTX.get_or_init(|| Mutex::new(None));
        let mut guard = slot.lock().map_err(|e| e.to_string())?;
        let path = model_file(app)?;
        if let Some((loaded_path, ctx)) = guard.as_ref() {
            if *loaded_path == path {
                return Ok(ctx.clone());
            }
            eprintln!(
                "[whisper] model changed ({} → {}) — reloading context",
                loaded_path.display(),
                path.display()
            );
        }
        let path_str = path
            .to_str()
            .ok_or_else(|| "model path is not valid UTF-8".to_string())?;
        let ctx = WhisperContext::new_with_params(path_str, WhisperContextParameters::default())
            .map_err(|e| format!("whisper model load failed: {e}"))?;
        let ctx = Arc::new(ctx);
        *guard = Some((path, ctx.clone()));
        Ok(ctx)
    }

    pub fn prewarm(app: &AppHandle) -> Result<(), String> {
        let ctx = context(app)?;
        ctx.create_state()
            .map_err(|e| format!("whisper state init failed: {e}"))?;
        Ok(())
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
        /// Raw samples (at `src_rate`) already drained from `buf` by finalized
        /// utterances since the last timeline reset. The current buffer's
        /// offset onto the meeting/recording timeline is derived from THIS
        /// count, not wall clocks: inference takes real time, and stamping the
        /// next buffer with "now after inference" shifted every subsequent
        /// utterance late — the error accumulated to seconds over a long
        /// recording (mic and system streams drifted apart independently).
        /// Sample counts are exact.
        ///
        /// Native recordings can warm this capture before the countdown ends;
        /// they reset the timeline (buffer + this count) when ScreenCaptureKit
        /// actually attaches the recording output so transcript timestamps
        /// stay video-relative.
        drained_samples: AtomicU64,
        /// Incremented when the timeline and buffer are reset. The worker has
        /// local counters that must be reset after the realtime callback clears
        /// the shared sample buffer.
        reset_generation: AtomicU32,
    }

    impl WhisperStream {
        fn new(
            app: AppHandle,
            source: &'static str,
            src_rate: f64,
            language: Option<String>,
            ctx: Arc<WhisperContext>,
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
                drained_samples: AtomicU64::new(0),
                reset_generation: AtomicU32::new(0),
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
            let (counter, peak) = if self.source == "mic" {
                (
                    &crate::whisper_speech::MIC_SAMPLES,
                    &crate::whisper_speech::MIC_PEAK_MILLI,
                )
            } else {
                (
                    &crate::whisper_speech::SYSTEM_SAMPLES,
                    &crate::whisper_speech::SYSTEM_PEAK_MILLI,
                )
            };
            counter.fetch_add(frames.len() as u64, Ordering::Relaxed);
            let mut max = 0f32;
            for f in frames {
                let a = f.abs();
                if a > max {
                    max = a;
                }
            }
            let milli = (max.min(1.0) * 1000.0) as u64;
            peak.fetch_max(milli, Ordering::Relaxed);
            if let Ok(mut buf) = self.buf.lock() {
                buf.extend_from_slice(frames);
            }
        }

        fn stop(&self) {
            self.running.store(false, Ordering::SeqCst);
        }

        /// Offset (ms) of the current buffer onto the meeting timeline —
        /// derived from the exact count of samples drained by earlier
        /// finalized utterances, so inference latency can never skew it.
        fn offset_ms(&self) -> i64 {
            let rate = self.src_rate.load(Ordering::SeqCst) as u64;
            if rate == 0 {
                return 0;
            }
            let drained = self.drained_samples.load(Ordering::SeqCst);
            (drained * 1000 / rate) as i64
        }

        /// Account for samples removed from the buffer by a finalized
        /// utterance — the next utterance's whisper timestamps offset by the
        /// drained duration.
        fn note_drained(&self, samples: usize) {
            self.drained_samples
                .fetch_add(samples as u64, Ordering::SeqCst);
        }

        /// Rebase timestamps to "now" and discard any audio captured while the
        /// recorder was warming up/counting down.
        fn reset_timeline(&self) {
            if let Ok(mut buf) = self.buf.lock() {
                buf.clear();
            }
            self.drained_samples.store(0, Ordering::SeqCst);
            self.reset_generation.fetch_add(1, Ordering::SeqCst);
        }

        /// Clean an inference result and, if it survives, emit it on `event`
        /// (`voice:partial-transcript` / `voice:final-transcript`) tagged with
        /// this stream's source. `raw_segs` are per-WORD whisper segments
        /// (token timestamps, max_len=1) with buffer-relative ms; `offset_ms`
        /// shifts them onto the meeting timeline.
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
            let words: Vec<Segment> = raw_segs
                .iter()
                .filter(|(_, _, t)| !t.trim().is_empty())
                .map(|(s, e, t)| Segment {
                    start_ms: offset_ms + s,
                    end_ms: offset_ms + e,
                    text: t.trim().to_string(),
                })
                .collect();
            let segments = group_words_into_sentences(&words);
            crate::whisper_speech::FINALS_EMITTED
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let _ = self.app.emit(
                event,
                TranscriptPayload {
                    text: clean,
                    source: self.source,
                    segments,
                    words,
                },
            );
        }
    }

    /// Group word-level segments into sentence-ish chunks: close a chunk at
    /// sentence-final punctuation or once it spans 12 s. Meeting notes, the
    /// live overlay, and summaries expect this granularity; the editors take
    /// the raw words instead.
    fn group_words_into_sentences(words: &[Segment]) -> Vec<Segment> {
        const MAX_SENTENCE_SPAN_MS: i64 = 12_000;
        let mut out: Vec<Segment> = Vec::new();
        let mut chunk: Vec<&Segment> = Vec::new();
        let flush = |chunk: &mut Vec<&Segment>, out: &mut Vec<Segment>| {
            if chunk.is_empty() {
                return;
            }
            out.push(Segment {
                start_ms: chunk[0].start_ms,
                end_ms: chunk[chunk.len() - 1].end_ms,
                text: chunk
                    .iter()
                    .map(|w| w.text.as_str())
                    .collect::<Vec<_>>()
                    .join(" "),
            });
            chunk.clear();
        };
        for word in words {
            chunk.push(word);
            let ends_sentence = word
                .text
                .chars()
                .last()
                .is_some_and(|c| matches!(c, '.' | '!' | '?' | '…' | '。' | '！' | '？'));
            let span = word.end_ms - chunk[0].start_ms;
            if ends_sentence || span > MAX_SENTENCE_SPAN_MS {
                flush(&mut chunk, &mut out);
            }
        }
        flush(&mut chunk, &mut out);
        out
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
        // Word-level output: token timestamps + one word per segment. The
        // chunk-level 2-6s segments whisper emits otherwise cap the editors'
        // highlight/click/delete precision at whole sentences.
        params.set_token_timestamps(true);
        params.set_max_len(1);
        params.set_split_on_word(true);
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
                crate::diag::tray_diag(
                    &stream.app,
                    serde_json::json!({
                        "event": "whisper-worker-failed",
                        "source": stream.source,
                        "error": format!("{e}"),
                    }),
                );
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
        let mut seen_reset_generation = stream.reset_generation.load(Ordering::SeqCst);

        while stream.running.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(250));

            let reset_generation = stream.reset_generation.load(Ordering::SeqCst);
            if reset_generation != seen_reset_generation {
                seen_reset_generation = reset_generation;
                last_len = 0;
                last_voice = Instant::now();
                last_infer = Instant::now() - Duration::from_secs(10);
                had_voice = false;
                continue;
            }

            // Clone the raw buffer (cheap relative to inference), then resample
            // to 16 kHz here on the worker rather than on the audio thread.
            let raw = match stream.buf.lock() {
                Ok(b) => b.clone(),
                Err(_) => continue,
            };
            let src_rate = stream.src_rate.load(Ordering::SeqCst) as f64;
            let samples = resample_to_16k(&raw, src_rate);
            if stream.reset_generation.load(Ordering::SeqCst) != seen_reset_generation {
                continue;
            }
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
                    // Advance the timeline offset by exactly the drained
                    // duration so the next utterance's whisper timestamps map
                    // correctly (sample-count based; see `drained_samples`).
                    stream.note_drained(to_drain);
                }
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

    /// Who owns an in-flight whisper `Session`. Mirrors
    /// `native_speech::macos::SessionOwner` — meeting beats dictation; all
    /// other combinations (same owner replacing itself, or a meeting evicting
    /// a dictation session) keep the original unconditional stop+replace
    /// behavior.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub(crate) enum SessionOwner {
        Dictation,
        Meeting,
    }

    impl SessionOwner {
        /// Parses the Tauri command's `owner` string param, defaulting to
        /// `Dictation` for back-compat with callers that omit it.
        pub(crate) fn from_param(owner: Option<String>) -> Self {
            match owner.as_deref() {
                Some("meeting") => SessionOwner::Meeting,
                _ => SessionOwner::Dictation,
            }
        }
    }

    fn should_use_combined_sck_capture(
        owner: SessionOwner,
        microphone_capture_supported: bool,
    ) -> bool {
        // DISABLED (2026-07-14): the combined SCK mic+system capture came in
        // with the upstream merge and produces audio whisper cannot use for
        // recording sessions on macOS 26 (sessions emit zero finals from
        // full-length, speech-level streams; the mic output also measures
        // ~44.1 kHz against the hardcoded 48 kHz src_rate). The split path
        // below (AVAudioEngine mic + separate SCK system stream) is the
        // pre-merge behavior that provably worked and is the same mic path
        // dictation uses today. Re-enable only after the combined path is
        // verified end-to-end on Tahoe alongside a recorder SCStream.
        let _ = (owner, microphone_capture_supported);
        false
    }

    #[derive(Debug, PartialEq, Eq)]
    struct SplitMicCaptureOptions {
        voice_processing: MicVoiceProcessingMode,
        reuse_voice_processing_engine: bool,
    }

    fn split_mic_capture_options(
        owner: SessionOwner,
        capture_system: bool,
        requested_voice_processing: bool,
    ) -> SplitMicCaptureOptions {
        let voice_processing = match owner {
            // If SCK microphone capture is unavailable or fails, keep a VPIO
            // allocation so Zoom/Meet/Teams cannot starve Clips of mic buffers,
            // but bypass its uplink processing to preserve call volume/quality.
            SessionOwner::Meeting => MicVoiceProcessingMode::Bypassed,
            SessionOwner::Dictation if requested_voice_processing => {
                MicVoiceProcessingMode::Enabled
            }
            SessionOwner::Dictation => MicVoiceProcessingMode::Disabled,
        };
        SplitMicCaptureOptions {
            voice_processing,
            reuse_voice_processing_engine: owner == SessionOwner::Dictation
                && !capture_system
                && voice_processing == MicVoiceProcessingMode::Enabled,
        }
    }

    struct Session {
        // macOS 15+ meetings use a combined SCK capture, so there is no
        // competing AVAudioEngine / VoiceProcessingIO mic input to stop.
        mic_cap: Option<RawMicCapture>,
        // System capture is optional — skipped when the user turns system
        // audio off, so neither the recording nor the transcript include it.
        sys_cap: Option<RawSckAudioCapture>,
        mic: Arc<WhisperStream>,
        sys: Option<Arc<WhisperStream>>,
        /// Who started this session — see `SessionOwner`.
        owner: SessionOwner,
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
        capture_system: bool,
        voice_processing: bool,
        owner: SessionOwner,
    ) -> Result<(), String> {
        // Priority rule (D10): a meeting-owned session must never be
        // silently evicted by a dictation takeover. Check (without taking)
        // BEFORE calling `stop()`, so a refused dictation start leaves the
        // meeting's session completely untouched.
        {
            let slot = session_slot().lock().map_err(|e| e.to_string())?;
            if let Some(prev) = slot.as_ref() {
                if prev.owner == SessionOwner::Meeting && owner == SessionOwner::Dictation {
                    return Err("speech-engine-busy-meeting".into());
                }
            }
        }

        // Tear down any prior session first. (Any other owner combination —
        // same-owner replacement, or meeting evicting dictation — keeps this
        // unconditional stop+replace behavior.)
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

        // Recording language should follow the spoken audio, not the UI/browser
        // locale. The bundled ggml-base model is multilingual, so let
        // whisper.cpp detect the language for every recording/meeting stream.
        let _ = language;
        let lang: Option<String> = None;

        // Create both Whisper streams first. On macOS 15+ meetings, one
        // ScreenCaptureKit stream feeds both callbacks without opening a
        // competing VoiceProcessingIO mic input. Older macOS versions (and a
        // failed SCK start) keep the existing split-capture fallback.
        let mic_stream = WhisperStream::new(app.clone(), "mic", 48000.0, lang.clone(), ctx.clone());
        let sys_stream = capture_system.then(|| {
            WhisperStream::new(
                app.clone(),
                "system",
                48000.0,
                lang.clone(),
                ctx.clone(),
            )
        });
        let mic_for_cb = mic_stream.clone();
        let mic_callback: Arc<dyn Fn(&[f32]) + Send + Sync> =
            Arc::new(move |samples: &[f32]| mic_for_cb.push(samples));
        let system_callback: Option<Arc<dyn Fn(&[f32]) + Send + Sync>> =
            sys_stream.as_ref().map(|stream| {
                let stream = stream.clone();
                Arc::new(move |samples: &[f32]| stream.push(samples))
                    as Arc<dyn Fn(&[f32]) + Send + Sync>
            });

        let combined_cap = if should_use_combined_sck_capture(
            owner,
            supports_sck_microphone_capture(),
        ) {
            match start_raw_meeting_capture(
                app.clone(),
                mic_device_id.clone(),
                mic_device_label.clone(),
                capture_system,
                mic_callback.clone(),
                system_callback.clone(),
            ) {
                Ok(cap) => {
                    eprintln!("[whisper] using combined ScreenCaptureKit mic + system capture");
                    Some(cap)
                }
                Err(e) => {
                    eprintln!(
                        "[whisper] combined ScreenCaptureKit meeting capture failed: {e}; falling back to split capture"
                    );
                    None
                }
            }
        } else {
            None
        };

        let (mic_cap, sys_cap) = if let Some(combined_cap) = combined_cap {
            // Both SCK outputs are configured at 48 kHz.
            mic_stream.set_src_rate(48000.0);
            (None, Some(combined_cap))
        } else {
            let mic_options = split_mic_capture_options(owner, capture_system, voice_processing);
            let mic_cap = start_raw_mic_capture(
                app.clone(),
                mic_device_id,
                mic_device_label,
                mic_options.voice_processing,
                mic_options.reuse_voice_processing_engine,
                mic_callback,
            )
            .map_err(|e| {
                mic_stream.stop();
                if let Some(sys_stream) = &sys_stream {
                    sys_stream.stop();
                }
                format!("mic capture failed: {e}")
            })?;
            mic_stream.set_src_rate(mic_cap.sample_rate());

            let sys_cap = if let Some(system_callback) = system_callback {
                match start_raw_system_capture(app.clone(), system_callback) {
                    Ok(cap) => Some(cap),
                    Err(e) => {
                        if let Some(sys_stream) = &sys_stream {
                            sys_stream.stop();
                        }
                        mic_stream.stop();
                        mic_cap.stop();
                        return Err(format!("system capture failed: {e}"));
                    }
                }
            } else {
                None
            };
            (Some(mic_cap), sys_cap)
        };

        let mut slot = session_slot().lock().map_err(|e| e.to_string())?;
        *slot = Some(Session {
            mic_cap,
            sys_cap,
            mic: mic_stream,
            sys: sys_stream,
            owner,
        });
        eprintln!(
            "[whisper] transcription started (mic{})",
            if capture_system { " + system" } else { "" }
        );
        Ok(())
    }

    pub fn reset_timeline() {
        let session = match session_slot().lock() {
            Ok(slot) => slot.as_ref().map(|session| {
                (
                    session.mic.clone(),
                    session.sys.as_ref().map(|stream| stream.clone()),
                )
            }),
            Err(_) => None,
        };
        let Some((mic, sys)) = session else {
            return;
        };
        mic.reset_timeline();
        if let Some(sys) = sys {
            sys.reset_timeline();
        }
        eprintln!("[whisper] transcription timeline reset");
    }

    pub fn stop(app: &AppHandle) {
        let session = match session_slot().lock() {
            Ok(mut slot) => slot.take(),
            Err(_) => return,
        };
        let Some(session) = session else {
            return;
        };
        // Signal workers to stop. They flush a final transcript after the loop.
        session.mic.stop();
        if let Some(sys) = &session.sys {
            sys.stop();
        }
        // Stop captures so no more samples arrive while workers flush.
        if let Some(mic_cap) = session.mic_cap {
            mic_cap.stop();
        }
        if let Some(sys_cap) = session.sys_cap {
            sys_cap.stop();
        }
        // Wait for both workers to finish their final flush so trailing
        // speech is not lost when the frontend unregisters listeners. The
        // flush runs a full whisper pass over the remaining buffer — with a
        // large model and a long recording that can take tens of seconds.
        // The old 4s deadline expired routinely for recordings, so their
        // finals were emitted after the transcript had already been saved
        // empty ("No speech was captured" with real audio). The stop command
        // is awaited off the hot path, so a generous drain is safe.
        let drain_started = Instant::now();
        let deadline = drain_started + Duration::from_secs(45);
        let mut drained = false;
        while Instant::now() < deadline {
            let sys_done = session
                .sys
                .as_ref()
                .map_or(true, |s| s.done.load(Ordering::SeqCst));
            if session.mic.done.load(Ordering::SeqCst) && sys_done {
                drained = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        crate::diag::tray_diag(
            app,
            serde_json::json!({
                "event": "whisper-drain",
                "ms": drain_started.elapsed().as_millis() as u64,
                "drained": drained,
            }),
        );
        eprintln!("[whisper] meeting transcription stopped");
    }

    #[cfg(test)]
    mod tests {
        use super::{should_use_combined_sck_capture, split_mic_capture_options, SessionOwner};
        use crate::native_speech::macos::MicVoiceProcessingMode;

        #[test]
        fn combined_sck_capture_is_only_selected_for_supported_meetings() {
            assert!(should_use_combined_sck_capture(SessionOwner::Meeting, true));
            assert!(!should_use_combined_sck_capture(
                SessionOwner::Meeting,
                false
            ));
            assert!(!should_use_combined_sck_capture(
                SessionOwner::Dictation,
                true
            ));
        }

        #[test]
        fn meeting_split_capture_uses_bypassed_voice_processing() {
            assert_eq!(
                split_mic_capture_options(SessionOwner::Meeting, true, false),
                super::SplitMicCaptureOptions {
                    voice_processing: MicVoiceProcessingMode::Bypassed,
                    reuse_voice_processing_engine: false,
                }
            );
            assert_eq!(
                split_mic_capture_options(SessionOwner::Meeting, false, true),
                super::SplitMicCaptureOptions {
                    voice_processing: MicVoiceProcessingMode::Bypassed,
                    reuse_voice_processing_engine: false,
                }
            );
        }

        #[test]
        fn dictation_split_capture_preserves_requested_processing() {
            assert_eq!(
                split_mic_capture_options(SessionOwner::Dictation, false, true),
                super::SplitMicCaptureOptions {
                    voice_processing: MicVoiceProcessingMode::Enabled,
                    reuse_voice_processing_engine: true,
                }
            );
            assert_eq!(
                split_mic_capture_options(SessionOwner::Dictation, true, false),
                super::SplitMicCaptureOptions {
                    voice_processing: MicVoiceProcessingMode::Disabled,
                    reuse_voice_processing_engine: false,
                }
            );
            assert_eq!(
                split_mic_capture_options(SessionOwner::Dictation, true, true),
                super::SplitMicCaptureOptions {
                    voice_processing: MicVoiceProcessingMode::Enabled,
                    reuse_voice_processing_engine: false,
                }
            );
        }
    }
}
