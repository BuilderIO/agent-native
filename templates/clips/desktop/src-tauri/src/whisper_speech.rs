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

#[tauri::command]
pub async fn whisper_transcription_start(
    app: AppHandle,
    language: Option<String>,
    mic_device_id: Option<String>,
    mic_device_label: Option<String>,
    capture_system: bool,
    voice_processing: bool,
    emit_partials: bool,
    owner: Option<String>,
) -> Result<(), String> {
    if !crate::config::feature_config(&app).whisper_model_enabled {
        return Err("whisper-model-disabled".into());
    }
    #[cfg(target_os = "macos")]
    {
        macos::start(
            app,
            language,
            mic_device_id,
            mic_device_label,
            capture_system,
            voice_processing,
            emit_partials,
            macos::SessionOwner::from_param(owner),
        )
        .await
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
            emit_partials,
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
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
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
        /// Per-segment real timestamps (empty for the SFSpeech fallback path).
        segments: Vec<Segment>,
    }

    struct StreamTimeline {
        stream_start: Instant,
        buffer_start: Instant,
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
        let mut params = WhisperContextParameters::default();
        // The `metal` Cargo feature defaults `use_gpu` to true for every mac
        // (Intel included) via whisper-rs's `_gpu` cfg. Metal offload only
        // pays off on Apple Silicon's unified-memory GPU, so pin this
        // explicitly instead of trusting that default — Intel Macs keep
        // today's CPU decode path.
        params.use_gpu(cfg!(target_arch = "aarch64"));
        let ctx = WhisperContext::new_with_params(path_str, params)
            .map_err(|e| format!("whisper model load failed: {e}"))?;
        let ctx = Arc::new(ctx);
        *guard = Some(ctx.clone());
        Ok(ctx)
    }

    pub fn prewarm(app: &AppHandle) -> Result<(), String> {
        let ctx = context(app)?;
        ctx.create_state()
            .map_err(|e| format!("whisper state init failed: {e}"))?;
        Ok(())
    }

    // ---- resampling -------------------------------------------------------

    /// One linearly-interpolated 16 kHz output sample at output index `i`,
    /// given `ratio = 16000 / src_rate`. Shared by `resample_to_16k` (one-shot,
    /// full buffer) and `IncrementalResample` (append-only, growing buffer) so
    /// both produce byte-identical values for the same input.
    fn resample_linear_at(input: &[f32], ratio: f64, i: usize) -> f32 {
        let src_pos = i as f64 / ratio;
        let idx = src_pos as usize;
        let frac = (src_pos - idx as f64) as f32;
        let a = input.get(idx).copied().unwrap_or(0.0);
        let b = input.get(idx + 1).copied().unwrap_or(a);
        a + (b - a) * frac
    }

    /// Linear-resample mono f32 to 16 kHz (Whisper's required rate). Per-buffer
    /// resampling introduces negligible boundary error for speech. One-shot —
    /// used only for the final flush on stop. The hot per-utterance path (an
    /// utterance can be resampled repeatedly as it grows toward the 25 s cap)
    /// uses `IncrementalResample` instead so it doesn't redo the whole buffer
    /// every time.
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
            out.push(resample_linear_at(input, ratio, i));
        }
        out
    }

    /// Incrementally maintains a 16 kHz resample of a growing raw-sample
    /// buffer so repeated inference calls (partials, then the final) within
    /// one utterance only resample the audio that arrived since the last
    /// call, not the whole utterance from scratch. Lives entirely on the
    /// worker thread — not shared, no locking needed.
    struct IncrementalResample {
        src_rate: f32,
        /// 16 kHz samples resampled so far. A prefix of what
        /// `resample_to_16k(raw, src_rate)` would produce for the current
        /// `raw`; `sync` extends it in place.
        out: Vec<f32>,
        /// Length of `out` that's permanent: every sample up to this point
        /// used two real interpolation neighbors (never the same-sample
        /// fallback `resample_to_16k` falls back to at the true tail), so it
        /// can never change as more raw samples arrive. `sync` recomputes
        /// anything past this on every call.
        committed_len: usize,
    }

    impl IncrementalResample {
        fn new() -> Self {
            Self {
                src_rate: -1.0,
                out: Vec::new(),
                committed_len: 0,
            }
        }

        /// Discard all cached state. Call this everywhere the raw buffer it
        /// tracks is cleared or front-drained (finalize, timeline reset) —
        /// after either, raw sample indices no longer line up with what's
        /// cached here, so the cheapest correct move is a clean rebuild on
        /// the next `sync` (bounded by however little raw audio is left).
        fn drop_all(&mut self) {
            self.out.clear();
            self.committed_len = 0;
        }

        /// Extend the cached resample to cover all of `raw`, byte-identical to
        /// calling `resample_to_16k(raw, src_rate)` fresh. Only the samples
        /// that arrived since the last call are actually resampled.
        fn sync(&mut self, raw: &[f32], src_rate: f32) {
            if (src_rate - self.src_rate).abs() > 0.5 {
                self.src_rate = src_rate;
                self.drop_all();
            }
            // Drop the small uncommitted tail from the previous call (its
            // fallback neighbor may since have become a real sample) before
            // recomputing it with the now-current buffer.
            self.out.truncate(self.committed_len);

            if raw.is_empty() {
                return;
            }
            if (src_rate as f64 - 16000.0).abs() < 1.0 {
                if raw.len() > self.out.len() {
                    self.out.extend_from_slice(&raw[self.out.len()..]);
                }
                self.committed_len = self.out.len();
                return;
            }

            let ratio = 16000.0 / src_rate as f64;
            let full_len = ((raw.len() as f64) * ratio).floor() as usize;
            while self.out.len() < full_len {
                let i = self.out.len();
                self.out.push(resample_linear_at(raw, ratio, i));
            }
            // Reserve the last couple of raw samples as lookahead: an output
            // sample this close to the end may have used the same-sample
            // fallback above because its true second neighbor hasn't arrived
            // yet. Only commit up to where both neighbors are guaranteed
            // real, so that sample gets redone (cheaply) once more audio
            // confirms it instead of freezing the fallback value forever.
            let safe_raw_len = raw.len().saturating_sub(2);
            let safe_len = ((safe_raw_len as f64) * ratio).floor() as usize;
            self.committed_len = safe_len.min(self.out.len());
        }

        fn samples(&self) -> &[f32] {
            &self.out
        }
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
        ///
        /// Native recordings can warm this capture before the countdown ends;
        /// they reset this timeline when ScreenCaptureKit actually attaches the
        /// recording output so transcript timestamps stay video-relative.
        timeline: Mutex<StreamTimeline>,
        /// Incremented when the timeline and buffer are reset. The worker has
        /// local counters that must be reset after the realtime callback clears
        /// the shared sample buffer.
        reset_generation: AtomicU32,
        /// Whether this consumer renders live partial transcript updates.
        /// Recording capture only persists finals and disables this expensive
        /// repeated inference; meeting capture keeps it enabled.
        emit_partials: bool,
    }

    impl WhisperStream {
        fn new(
            app: AppHandle,
            source: &'static str,
            src_rate: f64,
            language: Option<String>,
            ctx: Arc<WhisperContext>,
            stream_start: Instant,
            emit_partials: bool,
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
                timeline: Mutex::new(StreamTimeline {
                    stream_start,
                    buffer_start: stream_start,
                }),
                reset_generation: AtomicU32::new(0),
                emit_partials,
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
            self.timeline
                .lock()
                .map(|timeline| {
                    timeline
                        .buffer_start
                        .saturating_duration_since(timeline.stream_start)
                        .as_millis() as i64
                })
                .unwrap_or(0)
        }

        /// Mark the start of a fresh buffer (called when the buffer is cleared
        /// on finalize) so the next utterance's whisper timestamps offset
        /// correctly onto the meeting timeline.
        fn reset_buffer_start(&self) {
            if let Ok(mut timeline) = self.timeline.lock() {
                timeline.buffer_start = Instant::now();
            }
        }

        /// Rebase timestamps to "now" and discard any audio captured while the
        /// recorder was warming up/counting down.
        fn reset_timeline(&self) {
            if let Ok(mut buf) = self.buf.lock() {
                buf.clear();
            }
            let now = Instant::now();
            if let Ok(mut timeline) = self.timeline.lock() {
                timeline.stream_start = now;
                timeline.buffer_start = now;
            }
            self.reset_generation.fetch_add(1, Ordering::SeqCst);
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
        params.set_n_threads(2);
        params.set_language(language);
        params.set_translate(false);
        params.set_no_context(true);
        params.set_suppress_nst(true);
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
            if !is_speech(&text) || segment.no_speech_probability() >= MAX_NO_SPEECH_PROBABILITY {
                continue;
            }
            // Low average token confidence means whisper was guessing —
            // typically a mis-detected-language hallucination that reads
            // fluently but scores poorly. Drop it.
            let confidence = segment_confidence(&segment);
            if confidence < MIN_AVG_TOKEN_PROBABILITY {
                continue;
            }
            // whisper timestamps are in centiseconds → ms.
            out.push((
                segment.start_timestamp() * 10,
                segment.end_timestamp() * 10,
                text,
            ));
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
    /// A second, model-level gate for ambient/no-speech Whisper segments.
    const MAX_NO_SPEECH_PROBABILITY: f32 = 0.72;
    /// Minimum average per-token probability for a segment to count as real
    /// speech. On noisy/near-silent audio whisper mis-detects the language and
    /// decodes fluent-looking gibberish in another language — but those tokens
    /// are low-confidence under the hood. Dropping segments below this cutoff
    /// removes that wrong-language garbage while keeping genuine multilingual
    /// speech (which decodes with high confidence).
    const MIN_AVG_TOKEN_PROBABILITY: f32 = 0.55;

    /// Average the model's per-token probability across a segment. Returns 0.0
    /// for an empty segment so it is treated as low-confidence. Special tokens
    /// (timestamps, `[_BEG_]`, …) render as `[_…]` and are skipped so they
    /// don't skew the average toward the text tokens we actually care about.
    fn segment_confidence(segment: &whisper_rs::WhisperSegment<'_>) -> f32 {
        let mut sum = 0.0f32;
        let mut count = 0u32;
        for i in 0..segment.n_tokens() {
            let Some(token) = segment.get_token(i) else {
                continue;
            };
            let is_special = token
                .to_str_lossy()
                .map(|t| t.starts_with("[_"))
                .unwrap_or(false);
            if is_special {
                continue;
            }
            sum += token.token_probability();
            count += 1;
        }
        if count == 0 {
            return 0.0;
        }
        sum / count as f32
    }

    fn partial_inference_due(
        emit_partials: bool,
        had_voice: bool,
        have_secs: f32,
        since_last_infer: Duration,
    ) -> bool {
        emit_partials
            && had_voice
            && have_secs > 0.5
            && since_last_infer > Duration::from_millis(1200)
    }

    fn utterance_finalize_due(have_secs: f32, silence: Duration) -> bool {
        (have_secs > 0.4 && silence > Duration::from_millis(800)) || have_secs > 25.0
    }

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
        let mut last_raw_len = 0usize;
        let mut last_infer = Instant::now() - Duration::from_secs(10);
        let mut last_voice = Instant::now();
        // Whether the CURRENT utterance buffer ever crossed the voice
        // threshold. Whisper hallucinates filler ("you", "thank you") on
        // silent audio, so we NEVER run inference on a buffer with no voice.
        let mut had_voice = false;
        let mut seen_reset_generation = stream.reset_generation.load(Ordering::SeqCst);
        // Growing-utterance resample cache — see `IncrementalResample`.
        let mut resample_state = IncrementalResample::new();

        while stream.running.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(250));

            let reset_generation = stream.reset_generation.load(Ordering::SeqCst);
            if reset_generation != seen_reset_generation {
                seen_reset_generation = reset_generation;
                last_raw_len = 0;
                last_voice = Instant::now();
                last_infer = Instant::now() - Duration::from_secs(10);
                had_voice = false;
                resample_state.drop_all();
                continue;
            }

            // Voice activity only needs the samples that arrived since the last
            // poll. Inspect that tail in place instead of cloning + resampling
            // the entire growing utterance four times per second. Full snapshots
            // are reserved for an inference that is actually due.
            let (raw_len, new_rms) = match stream.buf.lock() {
                Ok(b) => {
                    let raw_len = b.len();
                    let new_rms = if raw_len > last_raw_len {
                        let new = &b[last_raw_len..];
                        Some((new.iter().map(|x| x * x).sum::<f32>() / new.len() as f32).sqrt())
                    } else {
                        None
                    };
                    (raw_len, new_rms)
                }
                Err(_) => continue,
            };
            if stream.reset_generation.load(Ordering::SeqCst) != seen_reset_generation {
                continue;
            }
            if let Some(rms) = new_rms {
                if rms > VOICE_RMS_THRESHOLD {
                    last_voice = Instant::now();
                    had_voice = true;
                }
            }
            last_raw_len = raw_len;

            let src_rate = (stream.src_rate.load(Ordering::SeqCst) as f32).max(1.0);
            let have_secs = raw_len as f32 / src_rate;
            let silence = last_voice.elapsed();

            // Finalize on a real pause (>0.8 s silence with >0.4 s speech) or
            // when the buffer grows too long to keep as one utterance.
            if utterance_finalize_due(have_secs, silence) {
                // Only transcribe if the utterance actually contained voice —
                // otherwise we'd feed whisper silence and get a hallucinated
                // "you" / "Thank you.".
                let mut n_processed = raw_len;
                if had_voice && have_secs > 0.4 {
                    match stream.buf.lock() {
                        Ok(b) => {
                            // Hold the lock only long enough to extend the
                            // resample cache with the new tail (cheap) — NOT
                            // through inference, so the realtime capture
                            // callback (`push`) never blocks on whisper.
                            resample_state.sync(&b, src_rate);
                            n_processed = b.len();
                        }
                        Err(_) => continue,
                    }
                    if stream.reset_generation.load(Ordering::SeqCst) != seen_reset_generation {
                        continue;
                    }
                    let segs = infer(&mut state, resample_state.samples(), lang);
                    stream.emit_transcript("voice:final-transcript", &segs, stream.offset_ms());
                }
                if let Ok(mut b) = stream.buf.lock() {
                    let to_drain = n_processed.min(b.len());
                    b.drain(..to_drain);
                }
                // Raw indices shift after the drain above (front-truncated),
                // so the resample cache is invalid regardless of whether this
                // utterance ran inference — rebuild fresh from whatever's left.
                resample_state.drop_all();
                // New buffer begins now — advance the timeline offset so the
                // next utterance's whisper timestamps map correctly.
                stream.reset_buffer_start();
                last_raw_len = 0;
                had_voice = false;
                last_infer = Instant::now();
                continue;
            }

            // Partial while speech is still accruing (only once real voice has
            // been heard in this utterance).
            if partial_inference_due(
                stream.emit_partials,
                had_voice,
                have_secs,
                last_infer.elapsed(),
            ) {
                match stream.buf.lock() {
                    Ok(b) => resample_state.sync(&b, src_rate),
                    Err(_) => continue,
                }
                if stream.reset_generation.load(Ordering::SeqCst) != seen_reset_generation {
                    continue;
                }
                let segs = infer(&mut state, resample_state.samples(), lang);
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
        owner == SessionOwner::Meeting && microphone_capture_supported
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
        emit_partials: bool,
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
        let session_start = Instant::now();
        let mic_stream = WhisperStream::new(
            app.clone(),
            "mic",
            48000.0,
            lang.clone(),
            ctx.clone(),
            session_start,
            emit_partials,
        );
        let sys_stream = capture_system.then(|| {
            WhisperStream::new(
                app.clone(),
                "system",
                48000.0,
                lang.clone(),
                ctx.clone(),
                session_start,
                emit_partials,
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
        // Wait up to 4 s for both workers to finish their final flush so
        // trailing speech is not lost when the frontend unregisters listeners.
        let deadline = Instant::now() + Duration::from_secs(4);
        while Instant::now() < deadline {
            let sys_done = session
                .sys
                .as_ref()
                .map_or(true, |s| s.done.load(Ordering::SeqCst));
            if session.mic.done.load(Ordering::SeqCst) && sys_done {
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        eprintln!("[whisper] meeting transcription stopped");
    }

    #[cfg(test)]
    mod tests {
        use std::time::Duration;

        use super::{
            partial_inference_due, resample_to_16k, should_use_combined_sck_capture,
            split_mic_capture_options, utterance_finalize_due, IncrementalResample, SessionOwner,
        };
        use crate::native_speech::macos::MicVoiceProcessingMode;

        #[test]
        fn incremental_resample_matches_one_shot_resample_as_buffer_grows() {
            let mut state = IncrementalResample::new();
            let src_rate = 48000.0_f32;
            let mut raw: Vec<f32> = Vec::new();
            // Simulate audio arriving in small chunks and syncing after each —
            // mirrors the worker polling `stream.buf` every 250 ms. A non-integer
            // chunk size (137) deliberately avoids landing on a 48k/16k=3 boundary.
            for chunk in 0..40u32 {
                for i in 0..137u32 {
                    raw.push(((chunk * 137 + i) as f32 * 0.013).sin());
                }
                state.sync(&raw, src_rate);
                let expected = resample_to_16k(&raw, src_rate as f64);
                assert_eq!(
                    state.samples(),
                    expected.as_slice(),
                    "diverged after {} raw samples",
                    raw.len()
                );
            }
        }

        #[test]
        fn incremental_resample_rebuilds_cleanly_after_drop_all() {
            let mut state = IncrementalResample::new();
            let src_rate = 44100.0_f32;
            let mut raw: Vec<f32> = (0..2_000).map(|i| (i as f32 * 0.02).sin()).collect();
            state.sync(&raw, src_rate);
            assert_eq!(
                state.samples(),
                resample_to_16k(&raw, src_rate as f64).as_slice()
            );

            // Utterance finalize: raw buffer is front-drained (indices shift),
            // so the cache must be dropped, not incrementally patched.
            raw.drain(..1_500);
            state.drop_all();
            state.sync(&raw, src_rate);
            assert_eq!(
                state.samples(),
                resample_to_16k(&raw, src_rate as f64).as_slice()
            );
        }

        #[test]
        fn recording_mode_never_runs_live_partial_inference() {
            assert!(!partial_inference_due(
                false,
                true,
                10.0,
                Duration::from_secs(10)
            ));
        }

        #[test]
        fn meeting_mode_keeps_existing_partial_inference_cadence() {
            assert!(partial_inference_due(
                true,
                true,
                1.0,
                Duration::from_millis(1201)
            ));
            assert!(!partial_inference_due(
                true,
                true,
                1.0,
                Duration::from_millis(1200)
            ));
        }

        #[test]
        fn recording_mode_keeps_silence_and_long_utterance_finalization() {
            assert!(utterance_finalize_due(1.0, Duration::from_millis(801)));
            assert!(utterance_finalize_due(25.1, Duration::ZERO));
            assert!(!utterance_finalize_due(25.0, Duration::from_millis(100)));
        }

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
