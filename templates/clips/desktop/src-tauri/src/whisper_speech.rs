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

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct OfflineTranscriptSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

pub(crate) fn transcribe_offline_file_samples(
    app: &AppHandle,
    samples: &[f32],
    language: Option<&str>,
) -> Result<Vec<OfflineTranscriptSegment>, String> {
    #[cfg(target_os = "macos")]
    {
        macos::transcribe_offline_file_samples(app, samples, language)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, samples, language);
        Err("local Whisper file transcription is supported on macOS only".to_owned())
    }
}

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

pub fn shutdown(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    macos::stop(app);
}

#[tauri::command]
pub async fn whisper_transcription_reset_timeline(offset_ms: u64) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::reset_timeline(std::time::Duration::from_millis(offset_ms));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = offset_ms;
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::sync::{Arc, Mutex, OnceLock};
    use std::time::{Duration, Instant};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter};
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    use crate::capture_audio_bus::{
        try_subscribe, AudioSources, AudioSubscription, SubscriptionAttempt,
    };
    use crate::echo_guard::EchoGuard;
    use crate::native_speech::macos::{
        start_raw_mic_capture, MicVoiceProcessingMode, RawMicCapture,
    };
    use crate::system_audio::macos::{
        start_raw_meeting_capture, start_raw_system_capture, supports_sck_microphone_capture,
        RawSckAudioCapture,
    };
    use crate::whisper_model::{ensure_model, model_file};

    const MEETING_AUDIO_OWNER: &str = "meeting-whisper";

    const SHARED_LEVEL_EVERY: u32 = 3;

    fn shared_level_tap(
        app: AppHandle,
        source: &'static str,
    ) -> impl Fn(&[f32]) + Send + Sync + 'static {
        let tick = Arc::new(AtomicU32::new(0));
        move |samples: &[f32]| {
            if tick.fetch_add(1, Ordering::Relaxed) % SHARED_LEVEL_EVERY != 0 {
                return;
            }
            let step = (samples.len() / 64).max(1);
            let level = samples
                .iter()
                .step_by(step)
                .fold(0.0f32, |peak, sample| peak.max(sample.abs()))
                .min(1.0);
            let _ = app.emit(
                "voice:audio-level",
                serde_json::json!({ "level": level, "source": source }),
            );
        }
    }

    #[derive(Serialize, Clone)]
    #[serde(rename_all = "camelCase")]
    struct Segment {
        start_ms: i64,
        end_ms: i64,
        text: String,
    }

    #[derive(Serialize, Clone)]
    struct TranscriptPayload {
        text: String,
        source: &'static str,
        segments: Vec<Segment>,
    }

    struct StreamTimeline {
        stream_start: Instant,
        buffer_start: Instant,
    }

    fn context(app: &AppHandle) -> Result<Arc<WhisperContext>, String> {
        whisper_rs::install_logging_hooks();

        struct CachedContext {
            model_path: PathBuf,
            context: Arc<WhisperContext>,
        }

        static CTX: OnceLock<Mutex<Option<CachedContext>>> = OnceLock::new();
        let slot = CTX.get_or_init(|| Mutex::new(None));
        let mut guard = slot.lock().map_err(|e| e.to_string())?;
        let path = model_file(app)?;
        if let Some(cached) = guard.as_ref() {
            if cached.model_path == path {
                return Ok(cached.context.clone());
            }
        }
        let path_str = path
            .to_str()
            .ok_or_else(|| "model path is not valid UTF-8".to_string())?;
        let mut params = WhisperContextParameters::default();
        params.use_gpu(cfg!(target_arch = "aarch64"));
        let ctx = WhisperContext::new_with_params(path_str, params)
            .map_err(|e| format!("whisper model load failed: {e}"))?;
        let context = Arc::new(ctx);
        *guard = Some(CachedContext {
            model_path: path,
            context: context.clone(),
        });
        Ok(context)
    }

    pub fn prewarm(app: &AppHandle) -> Result<(), String> {
        let ctx = context(app)?;
        ctx.create_state()
            .map_err(|e| format!("whisper state init failed: {e}"))?;
        Ok(())
    }

    pub(super) fn transcribe_offline_file_samples(
        app: &AppHandle,
        samples: &[f32],
        language: Option<&str>,
    ) -> Result<Vec<super::OfflineTranscriptSegment>, String> {
        const CHUNK_SAMPLES: usize = 25 * 16_000;

        let ctx = context(app)?;
        let mut state = ctx
            .create_state()
            .map_err(|e| format!("whisper state init failed: {e}"))?;
        let mut segments = Vec::new();
        for (chunk_index, chunk) in samples.chunks(CHUNK_SAMPLES).enumerate() {
            let chunk_offset_ms = chunk_index as i64 * 25_000;
            segments.extend(infer(&mut state, chunk, language).into_iter().map(
                |(start_ms, end_ms, text)| super::OfflineTranscriptSegment {
                    start_ms: chunk_offset_ms.saturating_add(start_ms),
                    end_ms: chunk_offset_ms.saturating_add(end_ms),
                    text,
                },
            ));
        }
        Ok(segments)
    }


    fn resample_linear_at(input: &[f32], ratio: f64, i: usize) -> f32 {
        let src_pos = i as f64 / ratio;
        let idx = src_pos as usize;
        let frac = (src_pos - idx as f64) as f32;
        let a = input.get(idx).copied().unwrap_or(0.0);
        let b = input.get(idx + 1).copied().unwrap_or(a);
        a + (b - a) * frac
    }

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

    struct IncrementalResample {
        src_rate: f32,
        out: Vec<f32>,
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

        fn drop_all(&mut self) {
            self.out.clear();
            self.committed_len = 0;
        }

        fn sync(&mut self, raw: &[f32], src_rate: f32) {
            if (src_rate - self.src_rate).abs() > 0.5 {
                self.src_rate = src_rate;
                self.drop_all();
            }
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
            let safe_raw_len = raw.len().saturating_sub(2);
            let safe_len = ((safe_raw_len as f64) * ratio).floor() as usize;
            self.committed_len = safe_len.min(self.out.len());
        }

        fn samples(&self) -> &[f32] {
            &self.out
        }
    }


    pub(crate) struct WhisperStream {
        source: &'static str,
        src_rate: AtomicU32,
        language: Option<String>,
        buf: Mutex<Vec<f32>>,
        running: Arc<AtomicBool>,
        done: Arc<AtomicBool>,
        app: AppHandle,
        timeline: Mutex<StreamTimeline>,
        reset_generation: AtomicU32,
        emit_partials: bool,
        echo_guard: Option<Arc<EchoGuard>>,
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
            echo_guard: Option<Arc<EchoGuard>>,
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
                echo_guard,
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

        fn push(&self, frames: &[f32]) {
            if !self.running.load(Ordering::SeqCst) {
                return;
            }
            if self.source == "system" {
                if let Some(guard) = &self.echo_guard {
                    guard.note_playback(frames, self.src_rate.load(Ordering::SeqCst) as f64);
                }
            }
            if let Ok(mut buf) = self.buf.lock() {
                buf.extend_from_slice(frames);
            }
        }

        fn stop(&self) {
            self.running.store(false, Ordering::SeqCst);
        }

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

        fn reset_buffer_start(&self, pending: Duration) {
            let now = Instant::now();
            if let Ok(mut timeline) = self.timeline.lock() {
                timeline.buffer_start = buffer_start_after_drain(now, pending);
            }
        }

        fn buffer_start(&self) -> Instant {
            self.timeline
                .lock()
                .map(|timeline| timeline.buffer_start)
                .unwrap_or_else(|_| Instant::now())
        }

        fn is_playback_echo(&self, samples: &[f32]) -> bool {
            if self.source != "mic" {
                return false;
            }
            self.echo_guard
                .as_ref()
                .is_some_and(|guard| guard.is_playback_echo(samples, self.buffer_start()))
        }

        fn clear_partial(&self) {
            let _ = self.app.emit(
                "voice:partial-transcript",
                serde_json::json!({ "text": "", "source": self.source }),
            );
        }

        fn reset_timeline(&self, offset: Duration) {
            if let Ok(mut buf) = self.buf.lock() {
                buf.clear();
            }
            let now = Instant::now();
            if let Ok(mut timeline) = self.timeline.lock() {
                timeline.stream_start = timeline_start_for_offset(now, offset);
                timeline.buffer_start = now;
            }
            self.reset_generation.fetch_add(1, Ordering::SeqCst);
        }

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

    struct MicVoiceActivity {
        state: Box<nnnoiseless::DenoiseState<'static>>,
        pending: Vec<f32>,
    }

    impl MicVoiceActivity {
        const SAMPLE_RATE: f32 = 48_000.0;
        const INPUT_SCALE: f32 = 32_768.0;

        fn new() -> Self {
            Self {
                state: nnnoiseless::DenoiseState::new(),
                pending: Vec::new(),
            }
        }

        fn reset(&mut self) {
            self.state = nnnoiseless::DenoiseState::new();
            self.pending.clear();
        }

        fn observe(&mut self, samples: &[f32], sample_rate: f32) -> Option<f32> {
            if (sample_rate - Self::SAMPLE_RATE).abs() > 1.0 {
                self.reset();
                return None;
            }

            self.pending.extend(samples.iter().map(|sample| {
                (sample * Self::INPUT_SCALE).clamp(-Self::INPUT_SCALE, Self::INPUT_SCALE)
            }));

            let frame_size = nnnoiseless::DenoiseState::FRAME_SIZE;
            let mut highest_probability: f32 = 0.0;
            while self.pending.len() >= frame_size {
                let mut denoised = [0.0_f32; nnnoiseless::DenoiseState::FRAME_SIZE];
                let probability = self
                    .state
                    .process_frame(&mut denoised, &self.pending[..frame_size]);
                highest_probability = highest_probability.max(probability);
                self.pending.drain(..frame_size);
            }
            Some(highest_probability)
        }
    }

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
            let confidence = segment_confidence(&segment);
            if confidence < MIN_AVG_TOKEN_PROBABILITY {
                continue;
            }
            out.push((
                segment.start_timestamp() * 10,
                segment.end_timestamp() * 10,
                text,
            ));
        }
        out
    }

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
    const VOICE_RMS_THRESHOLD: f32 = 0.006;
    const MAX_NO_SPEECH_PROBABILITY: f32 = 0.72;
    const MIN_MIC_VAD_PROBABILITY: f32 = 0.6;
    const MIN_AVG_TOKEN_PROBABILITY: f32 = 0.55;

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

    fn mic_voice_detected(rms: f32, vad_probability: Option<f32>) -> bool {
        rms > VOICE_RMS_THRESHOLD
            && vad_probability.is_none_or(|probability| probability >= MIN_MIC_VAD_PROBABILITY)
    }

    fn buffer_start_after_drain(now: Instant, pending: Duration) -> Instant {
        now.checked_sub(pending).unwrap_or(now)
    }

    fn timeline_start_for_offset(now: Instant, offset: Duration) -> Instant {
        now.checked_sub(offset).unwrap_or(now)
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

    fn partial_inference_timestamp(
        previous: Instant,
        inference_ran: bool,
        now: Instant,
    ) -> Instant {
        if inference_ran {
            now
        } else {
            previous
        }
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
        let mut had_voice = false;
        let mut seen_reset_generation = stream.reset_generation.load(Ordering::SeqCst);
        let mut resample_state = IncrementalResample::new();
        let mut mic_voice_activity = (stream.source == "mic").then(MicVoiceActivity::new);

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
                if let Some(vad) = mic_voice_activity.as_mut() {
                    vad.reset();
                }
                continue;
            }

            let (raw_len, new_rms, new_mic_samples) = match stream.buf.lock() {
                Ok(b) => {
                    let raw_len = b.len();
                    let (new_rms, new_mic_samples) = if raw_len > last_raw_len {
                        let new = &b[last_raw_len..];
                        (
                            Some(
                                (new.iter().map(|x| x * x).sum::<f32>() / new.len() as f32).sqrt(),
                            ),
                            (stream.source == "mic").then(|| new.to_vec()),
                        )
                    } else {
                        (None, None)
                    };
                    (raw_len, new_rms, new_mic_samples)
                }
                Err(_) => continue,
            };
            if stream.reset_generation.load(Ordering::SeqCst) != seen_reset_generation {
                continue;
            }
            let src_rate = (stream.src_rate.load(Ordering::SeqCst) as f32).max(1.0);
            if let Some(rms) = new_rms {
                let vad_probability = mic_voice_activity
                    .as_mut()
                    .zip(new_mic_samples.as_deref())
                    .and_then(|(vad, samples)| vad.observe(samples, src_rate));
                if mic_voice_detected(rms, vad_probability) {
                    last_voice = Instant::now();
                    had_voice = true;
                }
            }
            last_raw_len = raw_len;

            let have_secs = raw_len as f32 / src_rate;
            let silence = last_voice.elapsed();

            if utterance_finalize_due(have_secs, silence) {
                let mut n_processed = raw_len;
                if had_voice && have_secs > 0.4 {
                    match stream.buf.lock() {
                        Ok(b) => {
                            resample_state.sync(&b, src_rate);
                            n_processed = b.len();
                        }
                        Err(_) => continue,
                    }
                    if stream.reset_generation.load(Ordering::SeqCst) != seen_reset_generation {
                        continue;
                    }
                    if stream.is_playback_echo(resample_state.samples()) {
                        eprintln!("[whisper-mic] suppressed {have_secs:.1}s of speaker bleed");
                        stream.clear_partial();
                    } else {
                        let segs = infer(&mut state, resample_state.samples(), lang);
                        stream.emit_transcript("voice:final-transcript", &segs, stream.offset_ms());
                    }
                }
                let mut pending = 0usize;
                if let Ok(mut b) = stream.buf.lock() {
                    let to_drain = n_processed.min(b.len());
                    b.drain(..to_drain);
                    pending = b.len();
                }
                resample_state.drop_all();
                if let Some(vad) = mic_voice_activity.as_mut() {
                    vad.reset();
                }
                stream.reset_buffer_start(Duration::from_secs_f32(pending as f32 / src_rate));
                last_raw_len = 0;
                had_voice = false;
                last_infer = Instant::now();
                continue;
            }

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
                let inference_ran = if stream.is_playback_echo(resample_state.samples()) {
                    stream.clear_partial();
                    false
                } else {
                    let segs = infer(&mut state, resample_state.samples(), lang);
                    stream.emit_transcript("voice:partial-transcript", &segs, stream.offset_ms());
                    true
                };
                last_infer = partial_inference_timestamp(last_infer, inference_ran, Instant::now());
            }
        }

        let raw = stream.buf.lock().map(|b| b.clone()).unwrap_or_default();
        let src_rate = stream.src_rate.load(Ordering::SeqCst) as f64;
        let samples = resample_to_16k(&raw, src_rate);
        if had_voice
            && samples.len() as f32 / SAMPLE_RATE_16K > 0.3
            && !stream.is_playback_echo(&samples)
        {
            let segs = infer(&mut state, &samples, lang);
            stream.emit_transcript("voice:final-transcript", &segs, stream.offset_ms());
        }
        eprintln!("[whisper-{}] worker stopped", stream.source);
    }

    fn clean_transcript(text: &str) -> Option<String> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }
        let normalized = trimmed
            .trim_matches(|c: char| !c.is_alphanumeric())
            .to_ascii_lowercase();
        const HALLUCINATIONS: &[&str] = &[
            "you",
            "thank you",
            "thank you very much",
            "thanks for watching",
            "thank you for watching",
            "ご視聴ありがとうございました",
            "please subscribe",
        ];
        if HALLUCINATIONS.contains(&normalized.as_str()) {
            return None;
        }
        Some(trimmed.to_string())
    }


    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub(crate) enum SessionOwner {
        Dictation,
        Meeting,
    }

    impl SessionOwner {
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
        app: AppHandle,
        mic_cap: Option<RawMicCapture>,
        sys_cap: Option<RawSckAudioCapture>,
        _shared_audio: Option<AudioSubscription>,
        temporary_audio: Option<crate::screen_memory::TemporaryAudioLease>,
        mic: Arc<WhisperStream>,
        sys: Option<Arc<WhisperStream>>,
        owner: SessionOwner,
    }

    impl Drop for Session {
        fn drop(&mut self) {
            drop(self._shared_audio.take());
            release_temporary_audio(&self.app, self.temporary_audio.take());
        }
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
        {
            let slot = session_slot().lock().map_err(|e| e.to_string())?;
            if let Some(prev) = slot.as_ref() {
                if prev.owner == SessionOwner::Meeting && owner == SessionOwner::Dictation {
                    return Err("speech-engine-busy-meeting".into());
                }
            }
        }

        stop(&app);

        ensure_model(&app).await.map_err(|e| {
            let _ = app.emit("pill:error", serde_json::json!({ "error": e }));
            e
        })?;
        let ctx = context(&app).map_err(|e| {
            let _ = app.emit("pill:error", serde_json::json!({ "error": e }));
            e
        })?;
        ctx.create_state().map_err(|e| {
            let msg = format!("whisper state init failed: {e}");
            let _ = app.emit("pill:error", serde_json::json!({ "error": msg }));
            msg
        })?;

        let _ = language;
        let lang: Option<String> = None;

        let session_start = Instant::now();
        let echo_guard = capture_system.then(|| Arc::new(EchoGuard::new()));
        let mic_stream = WhisperStream::new(
            app.clone(),
            "mic",
            48000.0,
            lang.clone(),
            ctx.clone(),
            session_start,
            emit_partials,
            echo_guard.clone(),
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
                echo_guard.clone(),
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

        let temporary_audio = if owner == SessionOwner::Meeting {
            match crate::screen_memory::acquire_temporary_audio_consumer(
                &app,
                MEETING_AUDIO_OWNER,
                crate::capture_graph::CaptureConsumer::Meeting,
                true,
                capture_system,
            ) {
                Ok(lease) => lease,
                Err(error) => {
                    mic_stream.stop();
                    if let Some(sys_stream) = &sys_stream {
                        sys_stream.stop();
                    }
                    return Err(error);
                }
            }
        } else {
            None
        };

        let shared_audio = if owner == SessionOwner::Meeting {
            let mic_for_shared = mic_stream.clone();
            let mic_level = shared_level_tap(app.clone(), "mic");
            let shared_mic = Arc::new(move |samples: &[f32], sample_rate: f64| {
                mic_for_shared.set_src_rate(sample_rate);
                mic_for_shared.push(samples);
                mic_level(samples);
            });
            let shared_system = sys_stream.as_ref().map(|stream| {
                let stream = stream.clone();
                let system_level = shared_level_tap(app.clone(), "system");
                Arc::new(move |samples: &[f32], sample_rate: f64| {
                    stream.set_src_rate(sample_rate);
                    stream.push(samples);
                    system_level(samples);
                }) as crate::capture_audio_bus::AudioCallback
            });
            match try_subscribe(
                AudioSources::new(true, capture_system),
                Some(shared_mic),
                shared_system,
            ) {
                Ok(SubscriptionAttempt::Subscribed(subscription)) => Some(subscription),
                Ok(SubscriptionAttempt::NoProducer) => {
                    if temporary_audio.is_some() {
                        release_temporary_audio(&app, temporary_audio);
                        mic_stream.stop();
                        if let Some(sys_stream) = &sys_stream {
                            sys_stream.stop();
                        }
                        return Err("shared-audio-producer-unavailable-after-upgrade".into());
                    }
                    None
                }
                Err(error) => {
                    release_temporary_audio(&app, temporary_audio);
                    mic_stream.stop();
                    if let Some(sys_stream) = &sys_stream {
                        sys_stream.stop();
                    }
                    return Err(error.to_string());
                }
            }
        } else {
            None
        };

        let combined_cap = if shared_audio.is_none()
            && should_use_combined_sck_capture(owner, supports_sck_microphone_capture())
        {
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

        let (mic_cap, sys_cap) = if shared_audio.is_some() {
            eprintln!("[whisper] using shared Rewind microphone/system PCM producer");
            (None, None)
        } else if let Some(combined_cap) = combined_cap {
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

        let mut slot = match session_slot().lock() {
            Ok(slot) => slot,
            Err(error) => {
                drop(shared_audio);
                release_temporary_audio(&app, temporary_audio);
                mic_stream.stop();
                if let Some(sys_stream) = &sys_stream {
                    sys_stream.stop();
                }
                if let Some(mic_cap) = mic_cap {
                    mic_cap.stop();
                }
                if let Some(sys_cap) = sys_cap {
                    sys_cap.stop();
                }
                return Err(error.to_string());
            }
        };
        *slot = Some(Session {
            app: app.clone(),
            mic_cap,
            sys_cap,
            _shared_audio: shared_audio,
            temporary_audio,
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

    pub fn reset_timeline(offset: Duration) {
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
        mic.reset_timeline(offset);
        if let Some(sys) = sys {
            sys.reset_timeline(offset);
        }
        eprintln!(
            "[whisper] transcription timeline reset to {}ms",
            offset.as_millis()
        );
    }

    fn release_temporary_audio(
        app: &AppHandle,
        lease: Option<crate::screen_memory::TemporaryAudioLease>,
    ) {
        if let Some(lease) = lease {
            if let Err(error) = crate::screen_memory::release_temporary_audio_consumer(app, lease) {
                eprintln!("[whisper] Rewind audio lease release failed: {error}");
            }
        }
    }

    pub fn stop(app: &AppHandle) {
        let session = match session_slot().lock() {
            Ok(mut slot) => slot.take(),
            Err(poisoned) => poisoned.into_inner().take(),
        };
        let Some(mut session) = session else {
            return;
        };
        session.mic.stop();
        if let Some(sys) = &session.sys {
            sys.stop();
        }
        if let Some(mic_cap) = session.mic_cap.take() {
            mic_cap.stop();
        }
        if let Some(sys_cap) = session.sys_cap.take() {
            sys_cap.stop();
        }
        drop(session._shared_audio.take());
        release_temporary_audio(app, session.temporary_audio.take());
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
        use std::time::{Duration, Instant};

        use super::{
            buffer_start_after_drain, clean_transcript, partial_inference_due,
            partial_inference_timestamp, resample_to_16k, should_use_combined_sck_capture,
            split_mic_capture_options, timeline_start_for_offset, utterance_finalize_due,
            IncrementalResample, SessionOwner,
        };
        use crate::native_speech::macos::MicVoiceProcessingMode;

        #[test]
        fn incremental_resample_matches_one_shot_resample_as_buffer_grows() {
            let mut state = IncrementalResample::new();
            let src_rate = 48000.0_f32;
            let mut raw: Vec<f32> = Vec::new();
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

            raw.drain(..1_500);
            state.drop_all();
            state.sync(&raw, src_rate);
            assert_eq!(
                state.samples(),
                resample_to_16k(&raw, src_rate as f64).as_slice()
            );
        }

        #[test]
        fn buffer_start_accounts_for_audio_captured_during_inference() {
            let now = Instant::now();
            let pending = Duration::from_millis(750);

            assert_eq!(
                buffer_start_after_drain(now, pending),
                now.checked_sub(pending).unwrap()
            );
        }

        #[test]
        fn resumed_timeline_starts_at_the_accumulated_recording_offset() {
            let now = Instant::now();
            let offset = Duration::from_millis(12_345);
            let started_at = timeline_start_for_offset(now, offset);

            assert_eq!(now.duration_since(started_at), offset);
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
        fn echo_suppressed_partial_does_not_reset_retry_cadence() {
            let previous = Instant::now();
            let now = previous + Duration::from_secs(2);

            assert_eq!(partial_inference_timestamp(previous, false, now), previous);
            assert_eq!(partial_inference_timestamp(previous, true, now), now);
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

        #[test]
        fn mic_voice_gate_requires_speech_probability_on_supported_captures() {
            assert!(!super::mic_voice_detected(0.02, Some(0.59)));
            assert!(!super::mic_voice_detected(0.004, Some(0.99)));
            assert!(super::mic_voice_detected(0.02, Some(0.6)));
            assert!(super::mic_voice_detected(0.02, None));
        }

        #[test]
        fn rnnoise_vad_rejects_steady_ambient_noise() {
            let mut vad = super::MicVoiceActivity::new();
            let samples: Vec<f32> = (0..(nnnoiseless::DenoiseState::FRAME_SIZE * 8))
                .map(|index| {
                    let value = index.wrapping_mul(1_103_515_245usize).wrapping_add(12_345);
                    (((value >> 16) & 0x7fff) as f32 / 16_384.0 - 1.0) * 0.012
                })
                .collect();

            let probability = vad.observe(&samples, 48_000.0).unwrap();
            assert!(
                probability < super::MIN_MIC_VAD_PROBABILITY,
                "ambient noise was classified as speech: {probability:.3}"
            );
        }

        #[test]
        fn filters_multilingual_caption_hallucinations() {
            assert_eq!(clean_transcript("ご視聴ありがとうございました"), None);
            assert_eq!(
                clean_transcript("Thanks for the update"),
                Some("Thanks for the update".to_string())
            );
        }
    }
}
