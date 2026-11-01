use serde::Serialize;
use tauri::AppHandle;

/// Which on-device model a transcription runs on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LocalEngine {
    Whisper,
    Parakeet,
}

/// A dictation that asks for Parakeet always gets it here: whether the model
/// can take it is the dictation start's call, which turns it away to Apple
/// Speech with a reason and starts Parakeet's recovery. A meeting uses
/// Parakeet once the file is on disk, and Whisper until then.
pub(crate) fn resolve_local_engine(
    requested: Option<&str>,
    dictation: bool,
    meeting_can_use_parakeet: impl FnOnce() -> bool,
) -> Result<LocalEngine, &'static str> {
    match requested {
        Some("parakeet") if dictation || meeting_can_use_parakeet() => Ok(LocalEngine::Parakeet),
        Some("parakeet") | Some("whisper") | None => Ok(LocalEngine::Whisper),
        Some(_) => Err("unknown-transcription-engine"),
    }
}

/// How a Parakeet dictation got its text: transcribed while the key was held,
/// or from the whole recording after release.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DictationPass {
    Live,
    Fallback,
}

impl DictationPass {
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            DictationPass::Live => "live",
            DictationPass::Fallback => "fallback",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationTranscript {
    pub text: String,
    pub pass: DictationPass,
    pub release_to_text_ms: u64,
    pub audio_ms: u64,
}

/// Whether a dictation's audio held speech, from the voice activity check
/// that runs while the key is held.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Voice {
    Heard,
    Silent,
    /// The check could not run or reach a verdict, so the dictation takes
    /// the normal path. Never treated as silence.
    Unchecked,
}

impl Voice {
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Voice::Heard => "heard",
            Voice::Silent => "silent",
            Voice::Unchecked => "unchecked",
        }
    }
}

/// Whether a Whisper dictation's words stand, decided at stop. Whisper sends
/// each utterance as it ends, so these are words the dictation already has.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Words {
    Keep,
    /// The hold was silent, and no word came from audio the speech check
    /// scored as possible speech: Whisper made them up from room noise.
    Discard,
}

/// What stopping an Apple Speech dictation returns: the speech check's verdict.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationStop {
    pub voice: Voice,
}

/// The first failure reported for a stopped run: a microphone that sent no
/// usable audio, or a transcription that failed. Either way the run's
/// transcript is missing speech, so whoever saves it must carry `failure`.
/// A Parakeet dictation's text comes back in `dictation`, a dictation's
/// speech check verdict in `voice`, and whether a Whisper dictation's words
/// stand in `words`.
#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperStopResult {
    pub failure: Option<String>,
    pub dictation: Option<DictationTranscript>,
    pub voice: Option<Voice>,
    pub words: Option<Words>,
}

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
    emit_partials: bool,
    owner: Option<String>,
    run_id: Option<u64>,
    engine: Option<String>,
) -> Result<(), String> {
    let dictation = owner.as_deref() != Some("meeting");
    let engine = resolve_local_engine(engine.as_deref(), dictation, || {
        crate::parakeet_model::meeting_can_use(&app)
    })
    .map_err(str::to_owned)?;
    if engine == LocalEngine::Whisper && !crate::config::feature_config(&app).whisper_model_enabled
    {
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
            emit_partials,
            macos::SessionOwner::from_param(owner),
            run_id,
            engine,
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
            emit_partials,
            owner,
            run_id,
            engine,
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

/// Stops a transcription. A dictation returns whether it heard speech, and a
/// Parakeet one its text, unless `discard` is set because the user cancelled.
#[tauri::command]
pub async fn whisper_transcription_stop(
    app: AppHandle,
    owner: Option<String>,
    run_id: Option<u64>,
    discard: bool,
) -> Result<WhisperStopResult, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            macos::stop(
                &app,
                owner.map(|owner| macos::SessionOwner::from_param(Some(owner))),
                run_id,
                false,
                discard,
            )
        })
        .await
        .map_err(|e| format!("transcription stop task failed: {e}"))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, owner, run_id, discard);
        Ok(WhisperStopResult::default())
    }
}

/// For quitting: ends the live transcription and cancels every dictation
/// still producing its text and every native run in flight. Workers hand
/// their models back as they stop; the caller waits for that on the slot.
pub fn shutdown(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        crate::transcribe_engine::quit_token().cancel();
        if let Err(error) = macos::stop(app, None, None, false, true) {
            eprintln!("[whisper] shutdown stop failed: {error}");
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[tauri::command]
pub async fn whisper_transcription_reset_timeline(
    owner: Option<String>,
    run_id: Option<u64>,
    offset_ms: u64,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::reset_timeline(
            owner.map(|owner| macos::SessionOwner::from_param(Some(owner))),
            run_id,
            std::time::Duration::from_millis(offset_ms),
        );
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (owner, run_id, offset_ms);
    Ok(())
}

#[cfg(target_os = "macos")]
mod macos {
    use std::collections::HashSet;
    use std::ops::Range;
    use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc, Mutex, MutexGuard, OnceLock, PoisonError};
    use std::time::{Duration, Instant};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter};

    use super::{LocalEngine, Voice};
    use crate::capture_audio_bus::{
        try_subscribe, AudioSources, AudioSubscription, SubscriptionAttempt,
    };
    use crate::echo_guard::EchoGuard;
    use crate::native_speech::mic_capture::MicCapture;
    use crate::parakeet_live::{AudioTap, LiveDictation};
    use crate::silero_vad::{SpeechCheck, Verdict};
    use crate::speech_capture_ownership::{
        claim as claim_speech_capture, SpeechCaptureEngine, SpeechCaptureLease, SpeechCaptureOwner,
    };
    use crate::system_audio::macos::{
        start_raw_meeting_capture, start_raw_system_capture, supports_sck_microphone_capture,
        RawSckAudioCapture,
    };
    use crate::transcribe_engine::{
        model_error, open_session, transcribe_parakeet, transcribe_whisper, RunLease, LOCAL_MODEL,
        MODEL_HANDBACK_WAIT, QUITTING,
    };
    use crate::whisper_model::{ensure_model, model_file, remove_superseded_legacy_model};

    const MEETING_AUDIO_OWNER: &str = "meeting-whisper";
    const PARTIAL_TRANSCRIPT: &str = "voice:partial-transcript";
    const FINAL_TRANSCRIPT: &str = "voice:final-transcript";
    const START_SUPERSEDED: &str = "speech-engine-start-superseded";

    const SHARED_LEVEL_EVERY: u32 = 3;

    fn shared_level_tap(
        app: AppHandle,
        source: &'static str,
        run_id: Option<u64>,
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
                serde_json::json!({ "level": level, "source": source, "runId": run_id }),
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
    #[serde(rename_all = "camelCase")]
    struct TranscriptPayload {
        text: String,
        source: &'static str,
        segments: Vec<Segment>,
        #[serde(skip_serializing_if = "Option::is_none")]
        run_id: Option<u64>,
    }

    struct StreamTimeline {
        stream_start: Instant,
        buffer_start: Instant,
    }

    /// Whisper for one-shot runs. Drop the lease only after every session
    /// opened on its model.
    fn whisper_lease(app: &AppHandle) -> Result<RunLease<'static>, String> {
        let path = model_file(app)?;
        let (lease, loaded) = LOCAL_MODEL
            .lease_for_run(&path)
            .map_err(|e| model_error("whisper", e))?;
        if loaded {
            remove_superseded_legacy_model(app, &path);
        }
        Ok(lease)
    }

    /// Loads Whisper at launch unless another model got there first, so a
    /// Parakeet user is not left holding both.
    pub fn prewarm(app: &AppHandle) -> Result<(), String> {
        let path = model_file(app)?;
        let Some(lease) = LOCAL_MODEL
            .load_if_empty(&path)
            .map_err(|e| format!("whisper {e}"))?
        else {
            return Ok(());
        };
        remove_superseded_legacy_model(app, &path);
        open_session(lease.model()).map_err(|e| format!("whisper {e}"))?;
        Ok(())
    }

    pub(super) fn transcribe_offline_file_samples(
        app: &AppHandle,
        samples: &[f32],
        language: Option<&str>,
    ) -> Result<Vec<super::OfflineTranscriptSegment>, String> {
        const CHUNK_SAMPLES: usize = 25 * 16_000;

        let lease = whisper_lease(app)?;
        let mut session = open_session(lease.model()).map_err(|e| format!("whisper {e}"))?;
        let mut segments = Vec::new();
        for (chunk_index, chunk) in samples.chunks(CHUNK_SAMPLES).enumerate() {
            let chunk_offset_ms = chunk_index as i64 * 25_000;
            segments.extend(
                infer(&mut session, LocalEngine::Whisper, chunk, language)?
                    .into_iter()
                    .map(|(start_ms, end_ms, text)| super::OfflineTranscriptSegment {
                        start_ms: chunk_offset_ms.saturating_add(start_ms),
                        end_ms: chunk_offset_ms.saturating_add(end_ms),
                        text,
                    }),
            );
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

    /// Whether a dictation's last pass runs, and its words stand. A silent
    /// verdict at release skips the pass and discards the words, unless a
    /// word was recognized in audio the speech check scored as possible
    /// speech: the verdict is then wrong, and the last pass is what keeps the
    /// end of the dictation. Words from audio it scored as silence are
    /// Whisper's own invention, and never outweigh the verdict.
    #[derive(Default)]
    struct LastPass {
        /// Set at release by a silent verdict, to where it heard possible speech.
        silent_verdict: OnceLock<Vec<Range<Duration>>>,
        /// Where the recognized words were said, from each segment's timestamps.
        worded: Mutex<Vec<Range<Duration>>>,
    }

    impl LastPass {
        /// The text a pass over `heard` recognized, if any. Each segment with
        /// words is noted where it falls in `heard`: a whole pass would let a
        /// moment of possible speech vouch for every word around it.
        fn recognize(
            &self,
            raw_segs: &[(i64, i64, String)],
            engine: LocalEngine,
            heard: Range<Duration>,
        ) -> Option<String> {
            let joined: String = raw_segs
                .iter()
                .map(|(_, _, t)| t.trim())
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            let clean = clean_transcript(&joined, engine)?;
            let at = |offset_ms: i64| {
                let offset = Duration::from_millis(offset_ms.max(0) as u64);
                (heard.start + offset).min(heard.end)
            };
            let mut worded = self.worded.lock().unwrap_or_else(PoisonError::into_inner);
            for (start_ms, end_ms, text) in raw_segs {
                if clean_transcript(text, engine).is_none() {
                    continue;
                }
                let said = at(*start_ms)..at(*end_ms);
                // Partials re-read one growing buffer, so most segments land on
                // one already noted.
                match worded
                    .iter_mut()
                    .find(|noted| noted.start <= said.end && said.start <= noted.end)
                {
                    Some(noted) => {
                        noted.start = noted.start.min(said.start);
                        noted.end = noted.end.max(said.end);
                    }
                    None => worded.push(said),
                }
            }
            Some(clean)
        }

        fn note_silent_verdict(&self, possible_speech: Vec<Range<Duration>>) {
            let _ = self.silent_verdict.set(possible_speech);
        }

        fn runs(&self) -> bool {
            let Some(possible_speech) = self.silent_verdict.get() else {
                return true;
            };
            let worded = self.worded.lock().unwrap_or_else(PoisonError::into_inner);
            worded.iter().any(|heard| {
                possible_speech
                    .iter()
                    .any(|speech| speech.start < heard.end && heard.start < speech.end)
            })
        }
    }

    pub(crate) struct WhisperStream {
        source: &'static str,
        engine: LocalEngine,
        /// Set for a Parakeet dictation, which transcribes as audio arrives.
        live: Option<Arc<LiveDictation>>,
        /// Set for a dictation's mic, so release can tell a silent hold.
        speech_check: Option<Arc<SpeechCheck>>,
        last_pass: LastPass,
        run_id: Option<u64>,
        src_rate: AtomicU32,
        language: Option<String>,
        buf: Mutex<Vec<f32>>,
        /// How many samples have been drained or cleared from `buf`, so
        /// `buf[0]` is that sample of the recording. Changes only with `buf` locked.
        buf_origin: AtomicUsize,
        running: Arc<AtomicBool>,
        done: Arc<AtomicBool>,
        app: AppHandle,
        timeline: Mutex<StreamTimeline>,
        reset_generation: AtomicU32,
        emit_partials: bool,
        echo_guard: Option<Arc<EchoGuard>>,
        failure: OnceLock<String>,
    }

    /// What a stream's worker transcribes with: a Parakeet dictation's live
    /// pass, or one-shot runs on a leased model.
    enum StreamWork {
        Live(Arc<LiveDictation>),
        Runs(RunLease<'static>),
        /// Runs on a model still loading, handed over once it is ready. The
        /// stream buffers what it hears meanwhile.
        Pending(mpsc::Receiver<RunLease<'static>>),
    }

    impl WhisperStream {
        fn new(
            app: AppHandle,
            source: &'static str,
            src_rate: f64,
            language: Option<String>,
            work: StreamWork,
            engine: LocalEngine,
            speech_check: Option<Arc<SpeechCheck>>,
            stream_start: Instant,
            emit_partials: bool,
            echo_guard: Option<Arc<EchoGuard>>,
            run_id: Option<u64>,
        ) -> Arc<Self> {
            let done = Arc::new(AtomicBool::new(false));
            let stream = Arc::new(WhisperStream {
                source,
                engine,
                live: match &work {
                    StreamWork::Live(live) => Some(live.clone()),
                    StreamWork::Runs(_) | StreamWork::Pending(_) => None,
                },
                speech_check,
                last_pass: LastPass::default(),
                run_id,
                src_rate: AtomicU32::new(src_rate as u32),
                language,
                buf: Mutex::new(Vec::new()),
                buf_origin: AtomicUsize::new(0),
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
                failure: OnceLock::new(),
            });
            let worker_stream = stream.clone();
            std::thread::spawn(move || {
                match work {
                    StreamWork::Live(live) => live_worker(&worker_stream, &live),
                    StreamWork::Runs(lease) => worker(worker_stream, lease),
                    // A start that failed drops the sender without a lease.
                    StreamWork::Pending(lease) => {
                        if let Ok(lease) = lease.recv() {
                            worker(worker_stream, lease);
                        }
                    }
                }
                done.store(true, Ordering::SeqCst);
            });
            stream
        }

        fn audio_tap(&self) -> AudioTap<'_> {
            AudioTap {
                buf: &self.buf,
                src_rate: &self.src_rate,
                running: &self.running,
            }
        }

        fn set_src_rate(&self, rate: f64) {
            self.src_rate.store(rate as u32, Ordering::SeqCst);
            if let Some(check) = &self.speech_check {
                check.set_sample_rate(rate);
            }
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
            if let Some(check) = &self.speech_check {
                check.push(frames);
            }
        }

        fn stop(&self) {
            self.running.store(false, Ordering::SeqCst);
        }

        /// Where the first `len` samples of `buf` fall in the recording, timed
        /// from its first sample. Call it with `buf` locked.
        fn buffered_span(&self, len: usize) -> Range<Duration> {
            let rate = f64::from(self.src_rate.load(Ordering::SeqCst)).max(1.0);
            let origin = self.buf_origin.load(Ordering::SeqCst);
            let at = |sample: usize| Duration::from_secs_f64(sample as f64 / rate);
            at(origin)..at(origin + len)
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
                PARTIAL_TRANSCRIPT,
                serde_json::json!({
                    "text": "",
                    "source": self.source,
                    "runId": self.run_id,
                }),
            );
        }

        fn reset_timeline(&self, offset: Duration) {
            // The generation moves while the buffer's lock is held, so a
            // reader holding that lock sees a buffer and generation that agree.
            let mut buf = self
                .buf
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            self.buf_origin.fetch_add(buf.len(), Ordering::SeqCst);
            buf.clear();
            let now = Instant::now();
            if let Ok(mut timeline) = self.timeline.lock() {
                timeline.stream_start = timeline_start_for_offset(now, offset);
                timeline.buffer_start = now;
            }
            self.reset_generation.fetch_add(1, Ordering::SeqCst);
        }

        /// `heard` is the audio the pass transcribed.
        fn emit_inference(
            &self,
            event: &'static str,
            heard: Range<Duration>,
            result: Result<Vec<(i64, i64, String)>, String>,
        ) {
            match result {
                Ok(segments) => self.emit_transcript(event, heard, &segments, self.offset_ms()),
                Err(error) => {
                    eprintln!("[whisper-{}] {error}", self.source);
                    // The next partial replaces a failed one, but the audio
                    // behind a failed final is dropped, so it must not pass
                    // for silence.
                    if event == FINAL_TRANSCRIPT {
                        self.report_failure(&error);
                    }
                }
            }
        }

        fn report_failure(&self, error: &str) {
            let _ = self.failure.set(error.to_owned());
            let _ = self.app.emit(
                "pill:error",
                serde_json::json!({ "error": format!("Transcription worker ({}) failed: {error}", self.source) }),
            );
            let _ = self.app.emit(
                "voice:speech-error",
                serde_json::json!({
                    "error": error,
                    "source": self.source,
                    "runId": self.run_id,
                }),
            );
        }

        fn emit_transcript(
            &self,
            event: &'static str,
            heard: Range<Duration>,
            raw_segs: &[(i64, i64, String)],
            offset_ms: i64,
        ) {
            let Some(clean) = self.last_pass.recognize(raw_segs, self.engine, heard) else {
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
                    run_id: self.run_id,
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
        session: &mut transcribe_cpp::Session,
        engine: LocalEngine,
        samples: &[f32],
        language: Option<&str>,
    ) -> Result<Vec<(i64, i64, String)>, String> {
        let mut segments = match engine {
            LocalEngine::Whisper => transcribe_whisper(session, samples, language)?,
            LocalEngine::Parakeet => transcribe_parakeet(session, samples)?,
        };
        segments.retain(|(_, _, text)| is_speech(text));
        Ok(segments)
    }

    fn live_worker(stream: &WhisperStream, live: &LiveDictation) {
        live.run(&stream.audio_tap(), |text| {
            let _ = stream.app.emit(
                PARTIAL_TRANSCRIPT,
                serde_json::json!({
                    "text": text,
                    "source": stream.source,
                    "runId": stream.run_id,
                }),
            );
        });
        eprintln!("[parakeet-{}] worker stopped", stream.source);
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
    const MIN_MIC_VAD_PROBABILITY: f32 = 0.6;

    fn mic_voice_detected(rms: f32, vad_probability: Option<f32>) -> bool {
        rms > VOICE_RMS_THRESHOLD
            && vad_probability.is_none_or(|probability| probability >= MIN_MIC_VAD_PROBABILITY)
    }

    /// Whether the audio after the first `polled` samples of `raw` holds
    /// voice, judged the way the worker's loop judges each new stretch.
    fn unpolled_voice(
        raw: &[f32],
        polled: usize,
        sample_rate: f32,
        vad: Option<&mut MicVoiceActivity>,
    ) -> bool {
        let Some(tail) = raw.get(polled..).filter(|tail| !tail.is_empty()) else {
            return false;
        };
        let rms = (tail.iter().map(|x| x * x).sum::<f32>() / tail.len() as f32).sqrt();
        mic_voice_detected(rms, vad.and_then(|vad| vad.observe(tail, sample_rate)))
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

    fn last_pass_due(had_voice: bool, last_pass: &LastPass, samples_16k: usize) -> bool {
        had_voice && last_pass.runs() && samples_16k as f32 / SAMPLE_RATE_16K > 0.3
    }

    fn utterance_finalize_due(have_secs: f32, silence: Duration) -> bool {
        (have_secs > 0.4 && silence > Duration::from_millis(800)) || have_secs > 25.0
    }

    /// Drops `lease` only after its session, which is what keeps a live
    /// stream off the copy until this worker's last run is done.
    fn worker(stream: Arc<WhisperStream>, lease: RunLease<'static>) {
        let mut session = match open_session(lease.model()) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[whisper-{}] {e}", stream.source);
                stream.report_failure(&e);
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
                    let heard = match stream.buf.lock() {
                        Ok(b) => {
                            resample_state.sync(&b, src_rate);
                            n_processed = b.len();
                            stream.buffered_span(n_processed)
                        }
                        Err(_) => continue,
                    };
                    if stream.reset_generation.load(Ordering::SeqCst) != seen_reset_generation {
                        continue;
                    }
                    if stream.is_playback_echo(resample_state.samples()) {
                        eprintln!("[whisper-mic] suppressed {have_secs:.1}s of speaker bleed");
                        stream.clear_partial();
                    } else {
                        stream.emit_inference(
                            FINAL_TRANSCRIPT,
                            heard,
                            infer(&mut session, stream.engine, resample_state.samples(), lang),
                        );
                    }
                }
                let mut pending = 0usize;
                if let Ok(mut b) = stream.buf.lock() {
                    let to_drain = n_processed.min(b.len());
                    b.drain(..to_drain);
                    stream.buf_origin.fetch_add(to_drain, Ordering::SeqCst);
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
                let heard = match stream.buf.lock() {
                    Ok(b) => {
                        resample_state.sync(&b, src_rate);
                        stream.buffered_span(b.len())
                    }
                    Err(_) => continue,
                };
                if stream.reset_generation.load(Ordering::SeqCst) != seen_reset_generation {
                    continue;
                }
                let inference_ran = if stream.is_playback_echo(resample_state.samples()) {
                    stream.clear_partial();
                    false
                } else {
                    stream.emit_inference(
                        PARTIAL_TRANSCRIPT,
                        heard,
                        infer(&mut session, stream.engine, resample_state.samples(), lang),
                    );
                    true
                };
                last_infer = partial_inference_timestamp(last_infer, inference_ran, Instant::now());
            }
        }

        let (raw, heard, reset_since_poll) = stream
            .buf
            .lock()
            .map(|b| {
                let generation = stream.reset_generation.load(Ordering::SeqCst);
                (
                    b.clone(),
                    stream.buffered_span(b.len()),
                    generation != seen_reset_generation,
                )
            })
            .unwrap_or_default();
        let src_rate = stream.src_rate.load(Ordering::SeqCst) as f64;
        // Stopping delivers the capture's last buffers after the loop's final
        // poll, so speech heard only there must still count.
        // A reset since the last poll discarded the audio `had_voice` judged.
        let (had_voice, polled) = if reset_since_poll {
            if let Some(vad) = mic_voice_activity.as_mut() {
                vad.reset();
            }
            (false, 0)
        } else {
            (had_voice, last_raw_len)
        };
        let had_voice = had_voice
            || unpolled_voice(
                &raw,
                polled,
                src_rate.max(1.0) as f32,
                mic_voice_activity.as_mut(),
            );
        let samples = resample_to_16k(&raw, src_rate);
        if last_pass_due(had_voice, &stream.last_pass, samples.len())
            && !stream.is_playback_echo(&samples)
        {
            stream.emit_inference(
                FINAL_TRANSCRIPT,
                heard,
                infer(&mut session, stream.engine, &samples, lang),
            );
        }
        eprintln!("[whisper-{}] worker stopped", stream.source);
    }

    fn clean_transcript(text: &str, engine: LocalEngine) -> Option<String> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }
        // Whisper invents these phrases over silence; Parakeet does not, so
        // from Parakeet they are real speech.
        if engine == LocalEngine::Parakeet {
            return Some(trimmed.to_string());
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

    fn session_start_error(active: SessionOwner, requested: SessionOwner) -> Option<&'static str> {
        match (active, requested) {
            (SessionOwner::Meeting, SessionOwner::Dictation) => Some("speech-engine-busy-meeting"),
            (SessionOwner::Dictation, SessionOwner::Meeting) => {
                Some("speech-engine-busy-dictation")
            }
            _ => None,
        }
    }

    fn should_use_combined_sck_capture(
        owner: SessionOwner,
        microphone_capture_supported: bool,
    ) -> bool {
        owner == SessionOwner::Meeting && microphone_capture_supported
    }

    struct Session {
        app: AppHandle,
        mic_cap: Option<MicCapture>,
        sys_cap: Option<RawSckAudioCapture>,
        _shared_audio: Option<AudioSubscription>,
        temporary_audio: Option<crate::screen_memory::TemporaryAudioLease>,
        mic: Arc<WhisperStream>,
        sys: Option<Arc<WhisperStream>>,
        owner: SessionOwner,
        run_id: Option<u64>,
        _capture_lease: SpeechCaptureLease,
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

    fn latest_run_id_slot() -> &'static Mutex<RunAuthority> {
        static SLOT: OnceLock<Mutex<RunAuthority>> = OnceLock::new();
        SLOT.get_or_init(|| Mutex::new(RunAuthority::default()))
    }

    #[derive(Default)]
    struct RunAuthority {
        latest_run_id: Option<u64>,
        latest_owner: Option<SessionOwner>,
        cancelled_run_ids: HashSet<u64>,
    }

    fn active_run_owner_conflict(
        authority: &RunAuthority,
        owner: SessionOwner,
        run_id: u64,
    ) -> Option<SessionOwner> {
        let active_run_id = authority.latest_run_id?;
        if active_run_id > run_id || authority.cancelled_run_ids.contains(&active_run_id) {
            return None;
        }

        authority
            .latest_owner
            .filter(|active_owner| *active_owner != owner)
    }

    fn begin_run_authority(authority: &mut RunAuthority, owner: SessionOwner, run_id: u64) -> bool {
        if authority
            .latest_run_id
            .is_some_and(|current| current > run_id)
            || (authority.latest_run_id == Some(run_id)
                && (authority.latest_owner != Some(owner)
                    || authority.cancelled_run_ids.contains(&run_id)))
        {
            return false;
        }
        authority.latest_run_id = Some(run_id);
        authority.latest_owner = Some(owner);
        authority
            .cancelled_run_ids
            .retain(|cancelled| *cancelled >= run_id);
        true
    }

    fn cancel_run_authority(
        authority: &mut RunAuthority,
        owner: SessionOwner,
        run_id: u64,
    ) -> bool {
        if active_run_owner_conflict(authority, owner, run_id).is_some()
            || authority
                .latest_run_id
                .is_some_and(|latest| latest > run_id)
            || (authority.latest_run_id == Some(run_id) && authority.latest_owner != Some(owner))
        {
            return false;
        }
        if authority.latest_run_id != Some(run_id) {
            authority.latest_run_id = Some(run_id);
            authority.latest_owner = Some(owner);
            authority
                .cancelled_run_ids
                .retain(|cancelled| *cancelled >= run_id);
        }
        authority.cancelled_run_ids.insert(run_id);
        true
    }

    fn begin_run_result(
        authority: &mut RunAuthority,
        owner: SessionOwner,
        run_id: u64,
    ) -> Result<(), &'static str> {
        if begin_run_authority(authority, owner, run_id) {
            Ok(())
        } else {
            Err(START_SUPERSEDED)
        }
    }

    fn begin_run(owner: SessionOwner, run_id: Option<u64>) -> Result<(), &'static str> {
        let Some(run_id) = run_id else {
            return Ok(());
        };
        let mut latest = latest_run_id_slot()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        begin_run_result(&mut latest, owner, run_id)
    }

    fn run_is_current(authority: &RunAuthority, owner: SessionOwner, run_id: u64) -> bool {
        authority.latest_run_id == Some(run_id)
            && authority.latest_owner == Some(owner)
            && !authority.cancelled_run_ids.contains(&run_id)
    }

    fn run_is_current_now(owner: SessionOwner, run_id: Option<u64>) -> bool {
        let Some(run_id) = run_id else {
            return true;
        };
        let authority = latest_run_id_slot()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        run_is_current(&authority, owner, run_id)
    }

    fn start_native_capture_without_authority_lock<T>(
        authority: Option<MutexGuard<'_, RunAuthority>>,
        start: impl FnOnce() -> T,
    ) -> T {
        drop(authority);
        start()
    }

    /// A Whisper dictation's mic, opened before its model is ready so the
    /// first words are buffered while it loads. Dropped before the stream
    /// joins a session, it closes the mic and ends the stream.
    struct EarlyCapture {
        mic: Arc<WhisperStream>,
        cap: Option<MicCapture>,
        lease: mpsc::Sender<RunLease<'static>>,
    }

    impl EarlyCapture {
        fn start(
            app: &AppHandle,
            mic_device_id: Option<&str>,
            mic_device_label: Option<&str>,
            emit_partials: bool,
            run_id: Option<u64>,
        ) -> Result<Self, String> {
            let (lease, pending) = mpsc::channel();
            let mic = WhisperStream::new(
                app.clone(),
                "mic",
                48000.0,
                None,
                StreamWork::Pending(pending),
                LocalEngine::Whisper,
                Some(Arc::new(SpeechCheck::for_dictation(app, "whisper"))),
                Instant::now(),
                emit_partials,
                None,
                run_id,
            );
            let mic_for_capture = mic.clone();
            let cap = MicCapture::start(
                app.clone(),
                mic_device_id,
                mic_device_label,
                run_id,
                Arc::new(move |samples: &[f32], sample_rate: f64| {
                    mic_for_capture.set_src_rate(sample_rate);
                    mic_for_capture.push(samples);
                }),
            );
            match cap {
                Ok(cap) => Ok(Self {
                    mic,
                    cap: Some(cap),
                    lease,
                }),
                Err(e) => {
                    mic.stop();
                    Err(format!("mic capture failed: {e}"))
                }
            }
        }

        /// Hands the loaded model to the stream's worker, which transcribes
        /// from the first buffered sample.
        fn begin(&self, lease: RunLease<'static>) -> Result<(), String> {
            self.lease
                .send(lease)
                .map_err(|_| "the transcription worker ended before its model was ready".to_owned())
        }

        fn into_capture(mut self) -> Option<MicCapture> {
            self.cap.take()
        }
    }

    impl Drop for EarlyCapture {
        fn drop(&mut self) {
            if let Some(cap) = self.cap.take() {
                drop(cap);
                self.mic.stop();
            }
        }
    }

    pub async fn start(
        app: AppHandle,
        language: Option<String>,
        mic_device_id: Option<String>,
        mic_device_label: Option<String>,
        capture_system: bool,
        emit_partials: bool,
        owner: SessionOwner,
        run_id: Option<u64>,
        engine: LocalEngine,
    ) -> Result<(), String> {
        let capture_lease = claim_speech_capture(
            match owner {
                SessionOwner::Dictation => SpeechCaptureOwner::Dictation,
                SessionOwner::Meeting => SpeechCaptureOwner::Meeting,
            },
            SpeechCaptureEngine::Whisper,
        )
        .map_err(str::to_owned)?;
        {
            let slot = session_slot().lock().map_err(|e| e.to_string())?;
            if let Some(prev) = slot.as_ref() {
                if let Some(error) = session_start_error(prev.owner, owner) {
                    return Err(error.into());
                }
            }
        }
        begin_run(owner, run_id).map_err(str::to_owned)?;

        if let Err(error) = stop(&app, Some(owner), run_id, true, true) {
            eprintln!("[whisper] stopping the previous transcription failed: {error}");
        }

        let mut engine = engine;
        if engine == LocalEngine::Whisper {
            ensure_whisper(&app).await?;
        }
        if !run_is_current_now(owner, run_id) {
            return Err(START_SUPERSEDED.into());
        }
        let pill_error = |e: String| {
            let _ = app.emit("pill:error", serde_json::json!({ "error": e }));
            e
        };
        // The model file is on disk by now, so this waits only on loading it.
        let captures_early =
            engine == LocalEngine::Whisper && owner == SessionOwner::Dictation && !capture_system;
        let early = if captures_early {
            Some(EarlyCapture::start(
                &app,
                mic_device_id.as_deref(),
                mic_device_label.as_deref(),
                emit_partials,
                run_id,
            )?)
        } else {
            None
        };
        // A Parakeet dictation only ever starts on a warmed-up model nothing
        // else holds, taken without waiting; otherwise it is turned away
        // before any audio is captured and dictates with Apple Speech. A
        // meeting may wait for Parakeet to load, and uses Whisper if it can't.
        let (mic_work, sys_lease) = match (engine, owner) {
            (LocalEngine::Parakeet, SessionOwner::Dictation) => {
                if capture_system {
                    return Err("a Parakeet dictation does not transcribe system audio".into());
                }
                let lease = crate::parakeet_model::dictation_lease(&app)?;
                open_session(lease.model()).map_err(|e| pill_error(format!("parakeet {e}")))?;
                let live = LiveDictation::new(lease, crate::parakeet_model::model_path(&app)?);
                (StreamWork::Live(Arc::new(live)), None)
            }
            (LocalEngine::Parakeet, SessionOwner::Meeting) => {
                let lease = match crate::parakeet_model::meeting_lease(&app).await {
                    Ok(lease) => lease,
                    Err(error) if error == QUITTING => return Err(error),
                    Err(error) => {
                        eprintln!("[whisper] {error}; the meeting transcribes with Whisper");
                        if !crate::config::feature_config(&app).whisper_model_enabled {
                            return Err("whisper-model-disabled".into());
                        }
                        engine = LocalEngine::Whisper;
                        ensure_whisper(&app).await?;
                        whisper_lease(&app).map_err(pill_error)?
                    }
                };
                open_session(lease.model()).map_err(|e| pill_error(format!("whisper {e}")))?;
                let sys_lease = capture_system.then(|| lease.share()).transpose()?;
                (StreamWork::Runs(lease), sys_lease)
            }
            (LocalEngine::Whisper, _) => {
                let lease = whisper_lease(&app).map_err(pill_error)?;
                open_session(lease.model()).map_err(|e| pill_error(format!("whisper {e}")))?;
                let sys_lease = capture_system.then(|| lease.share()).transpose()?;
                (StreamWork::Runs(lease), sys_lease)
            }
        };
        if !run_is_current_now(owner, run_id) {
            return Err(START_SUPERSEDED.into());
        }
        eprintln!("[whisper] {owner:?} transcription runs on {engine:?}");

        let _ = language;
        let lang: Option<String> = None;

        let session_start = Instant::now();
        let echo_guard = capture_system.then(|| Arc::new(EchoGuard::new()));
        let mic_stream = if let Some(early) = &early {
            let StreamWork::Runs(lease) = mic_work else {
                return Err("an early mic capture only transcribes on a Whisper model".into());
            };
            early.begin(lease)?;
            early.mic.clone()
        } else {
            let speech_check = (owner == SessionOwner::Dictation).then(|| {
                Arc::new(SpeechCheck::for_dictation(
                    &app,
                    match engine {
                        LocalEngine::Whisper => "whisper",
                        LocalEngine::Parakeet => "parakeet",
                    },
                ))
            });
            WhisperStream::new(
                app.clone(),
                "mic",
                48000.0,
                lang.clone(),
                mic_work,
                engine,
                speech_check,
                session_start,
                emit_partials,
                echo_guard.clone(),
                run_id,
            )
        };
        let sys_stream = sys_lease.map(|lease| {
            WhisperStream::new(
                app.clone(),
                "system",
                48000.0,
                lang.clone(),
                StreamWork::Runs(lease),
                engine,
                None,
                session_start,
                emit_partials,
                echo_guard.clone(),
                run_id,
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
            let mic_level = shared_level_tap(app.clone(), "mic", run_id);
            let shared_mic = Arc::new(move |samples: &[f32], sample_rate: f64| {
                mic_for_shared.set_src_rate(sample_rate);
                mic_for_shared.push(samples);
                mic_level(samples);
            });
            let shared_system = sys_stream.as_ref().map(|stream| {
                let stream = stream.clone();
                let system_level = shared_level_tap(app.clone(), "system", run_id);
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

        let capture_authority = run_id.map(|_| {
            latest_run_id_slot()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
        });
        if let Some(run_id) = run_id {
            let authority = capture_authority
                .as_ref()
                .expect("a run ID requires capture authority");
            if !run_is_current(authority, owner, run_id) {
                drop(shared_audio);
                release_temporary_audio(&app, temporary_audio);
                mic_stream.stop();
                if let Some(sys_stream) = &sys_stream {
                    sys_stream.stop();
                }
                return Err(START_SUPERSEDED.into());
            }
        }

        let capture_result = start_native_capture_without_authority_lock(capture_authority, || {
            if let Some(early) = early {
                return Ok((early.into_capture(), None));
            }
            let combined_cap = if shared_audio.is_none()
                && should_use_combined_sck_capture(owner, supports_sck_microphone_capture())
            {
                match start_raw_meeting_capture(
                    app.clone(),
                    mic_device_id.clone(),
                    mic_device_label.clone(),
                    capture_system,
                    run_id,
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

            if shared_audio.is_some() {
                eprintln!("[whisper] using shared Rewind microphone/system PCM producer");
                Ok((None, None))
            } else if let Some(combined_cap) = combined_cap {
                mic_stream.set_src_rate(48000.0);
                Ok((None, Some(combined_cap)))
            } else {
                let mic_for_capture = mic_stream.clone();
                let mic_cap = MicCapture::start(
                    app.clone(),
                    mic_device_id.as_deref(),
                    mic_device_label.as_deref(),
                    run_id,
                    Arc::new(move |samples: &[f32], sample_rate: f64| {
                        mic_for_capture.set_src_rate(sample_rate);
                        mic_for_capture.push(samples);
                    }),
                )
                .map_err(|e| {
                    mic_stream.stop();
                    if let Some(sys_stream) = &sys_stream {
                        sys_stream.stop();
                    }
                    format!("mic capture failed: {e}")
                })?;

                let sys_cap = if let Some(system_callback) = system_callback {
                    match start_raw_system_capture(app.clone(), system_callback, run_id) {
                        Ok(cap) => Some(cap),
                        Err(e) => {
                            if let Some(sys_stream) = &sys_stream {
                                sys_stream.stop();
                            }
                            mic_stream.stop();
                            drop(mic_cap);
                            return Err(format!("system capture failed: {e}"));
                        }
                    }
                } else {
                    None
                };
                Ok((Some(mic_cap), sys_cap))
            }
        });
        let (mic_cap, sys_cap) = match capture_result {
            Ok(captures) => captures,
            Err(error) => {
                drop(shared_audio);
                release_temporary_audio(&app, temporary_audio);
                mic_stream.stop();
                if let Some(sys_stream) = &sys_stream {
                    sys_stream.stop();
                }
                return Err(error);
            }
        };

        let run_authority = match latest_run_id_slot().lock() {
            Ok(latest) => latest,
            Err(error) => {
                drop(shared_audio);
                release_temporary_audio(&app, temporary_audio);
                mic_stream.stop();
                if let Some(sys_stream) = &sys_stream {
                    sys_stream.stop();
                }
                drop(mic_cap);
                if let Some(sys_cap) = sys_cap {
                    sys_cap.stop();
                }
                return Err(error.to_string());
            }
        };
        if run_id.is_some_and(|id| !run_is_current(&run_authority, owner, id)) {
            drop(run_authority);
            drop(shared_audio);
            release_temporary_audio(&app, temporary_audio);
            mic_stream.stop();
            if let Some(sys_stream) = &sys_stream {
                sys_stream.stop();
            }
            drop(mic_cap);
            if let Some(sys_cap) = sys_cap {
                sys_cap.stop();
            }
            return Err(START_SUPERSEDED.into());
        }
        let mut slot = match session_slot().lock() {
            Ok(slot) => slot,
            Err(error) => {
                drop(shared_audio);
                release_temporary_audio(&app, temporary_audio);
                mic_stream.stop();
                if let Some(sys_stream) = &sys_stream {
                    sys_stream.stop();
                }
                drop(mic_cap);
                if let Some(sys_cap) = sys_cap {
                    sys_cap.stop();
                }
                return Err(error.to_string());
            }
        };
        if let Some(error) = slot
            .as_ref()
            .and_then(|current| session_start_error(current.owner, owner))
        {
            drop(slot);
            drop(run_authority);
            drop(shared_audio);
            release_temporary_audio(&app, temporary_audio);
            mic_stream.stop();
            if let Some(sys_stream) = &sys_stream {
                sys_stream.stop();
            }
            drop(mic_cap);
            if let Some(sys_cap) = sys_cap {
                sys_cap.stop();
            }
            return Err(error.into());
        }
        *slot = Some(Session {
            app: app.clone(),
            mic_cap,
            sys_cap,
            _shared_audio: shared_audio,
            temporary_audio,
            mic: mic_stream,
            sys: sys_stream,
            owner,
            run_id,
            _capture_lease: capture_lease,
        });
        eprintln!(
            "[whisper] transcription started on {engine:?} (mic{})",
            if capture_system { " + system" } else { "" }
        );
        Ok(())
    }

    async fn ensure_whisper(app: &AppHandle) -> Result<(), String> {
        ensure_model(app).await.map(|_| ()).map_err(|e| {
            let _ = app.emit("pill:error", serde_json::json!({ "error": e }));
            e
        })
    }

    pub fn reset_timeline(owner: Option<SessionOwner>, run_id: Option<u64>, offset: Duration) {
        let session = match session_slot().lock() {
            Ok(slot) => slot
                .as_ref()
                .filter(|session| {
                    owner.map_or(true, |owner| session.owner == owner)
                        && run_id.map_or(true, |run_id| session.run_id == Some(run_id))
                })
                .map(|session| {
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

    /// Whether a stop aimed at `target` reaches a run started as `current`.
    fn stop_reaches(target: Option<u64>, current: Option<u64>, replace_older: bool) -> bool {
        match (target, current) {
            (Some(id), Some(current_id)) => current_id == id || (replace_older && current_id < id),
            (Some(_), None) => false,
            (None, _) => true,
        }
    }

    /// Run IDs and dictations, for [`finalizing_slot`].
    type FinalizingRuns = Mutex<Vec<(Option<u64>, Arc<LiveDictation>)>>;

    /// Parakeet dictations past release that are still producing their text.
    /// They have left the session slot, so a cancel looks for them here.
    fn finalizing_slot() -> &'static FinalizingRuns {
        static SLOT: OnceLock<FinalizingRuns> = OnceLock::new();
        SLOT.get_or_init(|| Mutex::new(Vec::new()))
    }

    /// Keeps one dictation in [`finalizing_slot`] until its text is ready.
    struct Finalizing(Arc<LiveDictation>);

    impl Drop for Finalizing {
        fn drop(&mut self) {
            finalizing_slot()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .retain(|(_, live)| !Arc::ptr_eq(live, &self.0));
        }
    }

    pub fn stop(
        app: &AppHandle,
        owner: Option<SessionOwner>,
        run_id: Option<u64>,
        replace_older: bool,
        discard: bool,
    ) -> Result<super::WhisperStopResult, String> {
        let released = Instant::now();
        let mut latest = match latest_run_id_slot().lock() {
            Ok(latest) => latest,
            Err(poisoned) => poisoned.into_inner(),
        };
        let mut slot = session_slot()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // Done under the session lock, which a release holds while it moves
        // its dictation here, so a cancel can't slip between the two. It comes
        // before the run checks below: a cancelled dictation can still be
        // finalizing after a newer run has begun.
        if discard && owner != Some(SessionOwner::Meeting) {
            for (finalizing_run, live) in finalizing_slot()
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .iter()
            {
                if stop_reaches(run_id, *finalizing_run, replace_older) {
                    live.discard();
                }
            }
        }
        if let Some(run_id) = run_id {
            if replace_older {
                if latest.latest_run_id != Some(run_id)
                    || owner.is_some_and(|owner| latest.latest_owner != Some(owner))
                {
                    return Ok(super::WhisperStopResult::default());
                }
            } else {
                let Some(owner) = owner.or(latest.latest_owner) else {
                    return Ok(super::WhisperStopResult::default());
                };
                if slot
                    .as_ref()
                    .is_some_and(|current| current.owner != owner || current.run_id != Some(run_id))
                {
                    return Ok(super::WhisperStopResult::default());
                }
                if !cancel_run_authority(&mut latest, owner, run_id) {
                    return Ok(super::WhisperStopResult::default());
                }
            }
        }
        let session = if slot.as_ref().is_some_and(|current| {
            owner.map_or(true, |owner| current.owner == owner)
                && stop_reaches(run_id, current.run_id, replace_older)
        }) {
            slot.take()
        } else {
            None
        };
        let finalizing = session
            .as_ref()
            .and_then(|session| session.mic.live.clone().map(|live| (session.run_id, live)))
            .filter(|_| !discard)
            .map(|(run_id, live)| {
                finalizing_slot()
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner())
                    .push((run_id, live.clone()));
                Finalizing(live)
            });
        drop(slot);
        drop(latest);
        let Some(mut session) = session else {
            return Ok(super::WhisperStopResult::default());
        };
        // Captures go first: stopping one delivers the buffers it already
        // queued, and a stream drops whatever arrives after its own stop. The
        // speech check has then heard every sample before it is asked.
        let mic_failure = session
            .mic_cap
            .take()
            .and_then(|mic_cap| mic_cap.stop().err());
        if let Some(error) = &mic_failure {
            session.mic.report_failure(error);
        }
        if let Some(sys_cap) = session.sys_cap.take() {
            sys_cap.stop();
        }
        drop(session._shared_audio.take());
        let verdict = match &session.mic.speech_check {
            None => None,
            Some(_) if discard => None,
            // Silence from a mic that then failed is not a silent hold.
            Some(_) if mic_failure.is_some() => Some(Verdict {
                voice: Voice::Unchecked,
                possible_speech: Vec::new(),
            }),
            Some(check) => Some(check.finish()),
        };
        let voice = verdict.as_ref().map(|verdict| verdict.voice);
        if let Some(Verdict {
            voice: Voice::Silent,
            possible_speech,
        }) = verdict
        {
            // Read by the worker after its loop ends, which `mic.stop()` below
            // causes, so a partial it is still running counts too.
            session.mic.last_pass.note_silent_verdict(possible_speech);
        }
        session.mic.stop();
        if let Some(sys) = &session.sys {
            sys.stop();
        }
        release_temporary_audio(app, session.temporary_audio.take());
        if let Some(live) = session.mic.live.clone() {
            if discard {
                live.discard();
                return Ok(super::WhisperStopResult::default());
            }
            // The stop call returns a Parakeet dictation's text, so a mic that
            // sent nothing must fail it here rather than come back empty.
            if let Some(error) = mic_failure {
                live.discard();
                return Err(error);
            }
            let voice = voice.unwrap_or(Voice::Unchecked);
            if voice == Voice::Silent && !live.has_heard_words() {
                live.discard();
                // The model goes back as the worker ends; a dictation started
                // right after this returns would otherwise find it held.
                let deadline = Instant::now() + MODEL_HANDBACK_WAIT;
                while !session.mic.done.load(Ordering::SeqCst) && Instant::now() < deadline {
                    std::thread::sleep(Duration::from_millis(10));
                }
                return Ok(super::WhisperStopResult {
                    failure: None,
                    dictation: None,
                    voice: Some(voice),
                    words: None,
                });
            }
            if voice == Voice::Silent {
                eprintln!(
                    "[parakeet] kept the dictation: words were recognized despite a silent verdict"
                );
            }
            let transcript = live.finish(&session.mic.audio_tap(), released);
            drop(finalizing);
            return transcript.map(|dictation| super::WhisperStopResult {
                failure: None,
                dictation: Some(dictation),
                voice: Some(voice),
                words: None,
            });
        }
        let workers_done = || {
            session.mic.done.load(Ordering::SeqCst)
                && session
                    .sys
                    .as_ref()
                    .map_or(true, |s| s.done.load(Ordering::SeqCst))
        };
        let deadline = Instant::now() + Duration::from_secs(4);
        while !workers_done() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        let workers_done = workers_done();
        eprintln!("[whisper] {:?} transcription stopped", session.owner);
        // Only a dictation has a verdict. Read once the worker is done, so a
        // pass it was still running has had its words noted.
        let words = voice.map(|_| {
            if session.mic.last_pass.runs() {
                super::Words::Keep
            } else {
                super::Words::Discard
            }
        });
        match (voice, words) {
            (Some(Voice::Silent), Some(super::Words::Keep)) => eprintln!(
                "[whisper] kept the dictation: words were recognized in possible speech despite a silent verdict"
            ),
            (_, Some(super::Words::Discard)) => eprintln!(
                "[whisper] discarded the dictation: the hold was silent and no word came from possible speech"
            ),
            _ => {}
        }
        let failure = session
            .mic
            .failure
            .get()
            .or_else(|| session.sys.as_ref().and_then(|sys| sys.failure.get()))
            .cloned()
            .or_else(|| {
                let engine = match session.mic.engine {
                    LocalEngine::Whisper => "Local Whisper",
                    LocalEngine::Parakeet => "Parakeet",
                };
                (!workers_done).then(|| {
                    format!("{engine} was still transcribing when the recording stopped, so the end of the transcript may be missing.")
                })
            });
        Ok(super::WhisperStopResult {
            failure,
            dictation: None,
            voice,
            words,
        })
    }

    #[cfg(test)]
    mod tests {
        use std::ops::Range;
        use std::time::{Duration, Instant};

        use super::{
            begin_run_authority, begin_run_result, buffer_start_after_drain, cancel_run_authority,
            clean_transcript, last_pass_due, partial_inference_due, partial_inference_timestamp,
            resample_to_16k, run_is_current, session_start_error, should_use_combined_sck_capture,
            start_native_capture_without_authority_lock, stop_reaches, timeline_start_for_offset,
            utterance_finalize_due, IncrementalResample, LastPass, LocalEngine, RunAuthority,
            SessionOwner, START_SUPERSEDED,
        };

        fn segment(text: &str) -> Vec<(i64, i64, String)> {
            vec![(0, 900, text.to_owned())]
        }

        fn said(start_ms: i64, end_ms: i64, text: &str) -> Vec<(i64, i64, String)> {
            vec![(start_ms, end_ms, text.to_owned())]
        }

        fn ms(range: Range<u64>) -> Range<Duration> {
            Duration::from_millis(range.start)..Duration::from_millis(range.end)
        }

        #[test]
        fn a_silent_verdict_keeps_the_last_pass_once_words_were_recognized_in_possible_speech() {
            let last_pass = LastPass::default();
            // Partials with words while the key is held, over quiet speech
            // Silero scored too briefly to call heard, then the release tail.
            assert!(last_pass
                .recognize(
                    &said(300, 800, " and the second "),
                    LocalEngine::Whisper,
                    ms(0..800)
                )
                .is_some());
            assert!(last_pass
                .recognize(
                    &said(300, 1_200, " and the second point "),
                    LocalEngine::Whisper,
                    ms(0..1_200)
                )
                .is_some());
            assert!(last_pass
                .recognize(&segment(""), LocalEngine::Whisper, ms(0..1_400))
                .is_none());
            let tail_16k = 8_000;
            last_pass.note_silent_verdict(vec![ms(960..1_024)]);
            assert!(last_pass_due(true, &last_pass, tail_16k));
        }

        #[test]
        fn a_silent_verdict_skips_the_last_pass_when_words_came_only_from_silence() {
            let last_pass = LastPass::default();
            assert!(last_pass.runs());
            // Whisper's stock phrase over silence is filtered out; "Okay" is
            // not on that list, but Silero scored that audio as silence.
            assert!(last_pass
                .recognize(&segment(" Thank you. "), LocalEngine::Whisper, ms(0..900))
                .is_none());
            assert!(last_pass
                .recognize(&segment(" Okay. "), LocalEngine::Whisper, ms(0..1_500))
                .is_some());
            last_pass.note_silent_verdict(vec![ms(1_600..1_632)]);
            assert!(!last_pass.runs());
            assert!(!last_pass_due(true, &last_pass, 8_000));
        }

        #[test]
        fn a_blip_of_possible_speech_does_not_vouch_for_words_said_after_it() {
            let last_pass = LastPass::default();
            // A cough early in the buffer, then a second of room noise that
            // Whisper turned into a word.
            assert!(last_pass
                .recognize(
                    &said(1_100, 1_900, " Okay. "),
                    LocalEngine::Whisper,
                    ms(0..2_000)
                )
                .is_some());
            last_pass.note_silent_verdict(vec![ms(96..160)]);
            assert!(!last_pass.runs());

            // The same blip under a segment that covers it does count.
            let spoken = LastPass::default();
            assert!(spoken
                .recognize(&said(40, 700, " No. "), LocalEngine::Whisper, ms(0..2_000))
                .is_some());
            spoken.note_silent_verdict(vec![ms(96..160)]);
            assert!(spoken.runs());
        }

        #[test]
        fn a_segment_is_placed_by_where_its_buffer_starts_in_the_recording() {
            let last_pass = LastPass::default();
            // An utterance finalized earlier drained the first 4 s.
            assert!(last_pass
                .recognize(
                    &said(0, 600, " Done. "),
                    LocalEngine::Whisper,
                    ms(4_000..5_000)
                )
                .is_some());
            last_pass.note_silent_verdict(vec![ms(200..264)]);
            assert!(!last_pass.runs());

            let later = LastPass::default();
            assert!(later
                .recognize(
                    &said(0, 600, " Done. "),
                    LocalEngine::Whisper,
                    ms(4_000..5_000)
                )
                .is_some());
            later.note_silent_verdict(vec![ms(4_200..4_264)]);
            assert!(later.runs());
        }

        #[test]
        fn a_stop_reaches_its_own_run_and_replaces_only_older_ones() {
            assert!(stop_reaches(Some(7), Some(7), false));
            assert!(!stop_reaches(Some(7), Some(6), false));
            assert!(stop_reaches(Some(7), Some(6), true));
            assert!(!stop_reaches(Some(7), Some(8), true));
            assert!(!stop_reaches(Some(7), None, true));
            // Shutdown stops with no run ID and reaches everything.
            assert!(stop_reaches(None, Some(7), false));
            assert!(stop_reaches(None, None, false));
        }

        #[test]
        fn a_failed_dictation_start_does_not_block_a_later_meeting_start() {
            let mut authority = RunAuthority::default();
            assert!(begin_run_authority(
                &mut authority,
                SessionOwner::Dictation,
                10
            ));

            assert!(begin_run_authority(
                &mut authority,
                SessionOwner::Meeting,
                11
            ));
            assert!(!run_is_current(&authority, SessionOwner::Dictation, 10));
            assert!(run_is_current(&authority, SessionOwner::Meeting, 11));
            assert_eq!(
                session_start_error(SessionOwner::Dictation, SessionOwner::Meeting),
                Some("speech-engine-busy-dictation")
            );
        }

        #[test]
        fn stale_whisper_start_returns_a_typed_failure() {
            let mut authority = RunAuthority::default();
            assert!(begin_run_authority(
                &mut authority,
                SessionOwner::Dictation,
                12
            ));

            assert_eq!(
                begin_run_result(&mut authority, SessionOwner::Dictation, 11),
                Err(START_SUPERSEDED)
            );
            assert!(run_is_current(&authority, SessionOwner::Dictation, 12));
        }

        #[test]
        fn cancelled_run_cannot_be_restarted_after_stop_wins() {
            let mut authority = RunAuthority::default();
            assert!(begin_run_authority(
                &mut authority,
                SessionOwner::Meeting,
                10
            ));
            assert!(cancel_run_authority(
                &mut authority,
                SessionOwner::Meeting,
                10
            ));
            assert!(!begin_run_authority(
                &mut authority,
                SessionOwner::Meeting,
                10
            ));
            assert!(!begin_run_authority(
                &mut authority,
                SessionOwner::Dictation,
                10
            ));
            assert!(begin_run_authority(
                &mut authority,
                SessionOwner::Dictation,
                11
            ));
        }

        #[test]
        fn stop_can_cancel_while_native_capture_initializes() {
            use std::sync::{mpsc, Arc, Mutex};
            use std::thread;

            let authority = Arc::new(Mutex::new(RunAuthority::default()));
            assert!(begin_run_authority(
                &mut authority.lock().unwrap(),
                SessionOwner::Meeting,
                10
            ));

            let capture_authority = Some(authority.lock().unwrap());
            let stop_authority = Arc::clone(&authority);
            let (startup_started_tx, startup_started_rx) = mpsc::channel();
            let (stop_finished_tx, stop_finished_rx) = mpsc::channel();
            let stop_thread = thread::spawn(move || {
                startup_started_rx
                    .recv_timeout(Duration::from_secs(3))
                    .expect("native capture startup should begin");
                let mut latest = stop_authority.lock().unwrap();
                let cancelled = cancel_run_authority(&mut latest, SessionOwner::Meeting, 10);
                stop_finished_tx.send(cancelled).unwrap();
            });

            let cancelled = start_native_capture_without_authority_lock(capture_authority, || {
                startup_started_tx.send(()).unwrap();
                stop_finished_rx
                    .recv_timeout(Duration::from_secs(3))
                    .expect("stop waited for native capture initialization")
            });

            assert!(cancelled);
            stop_thread.join().unwrap();
            assert!(!run_is_current(
                &authority.lock().unwrap(),
                SessionOwner::Meeting,
                10
            ));
        }

        #[test]
        fn stop_before_start_registration_cancels_the_pending_run() {
            let mut authority = RunAuthority::default();

            assert!(cancel_run_authority(
                &mut authority,
                SessionOwner::Dictation,
                10
            ));
            assert!(!begin_run_authority(
                &mut authority,
                SessionOwner::Dictation,
                10
            ));
            assert!(!run_is_current(&authority, SessionOwner::Dictation, 10));
            assert!(begin_run_authority(
                &mut authority,
                SessionOwner::Dictation,
                11
            ));
        }

        #[test]
        fn stopping_a_never_started_meeting_run_preserves_dictation_authority() {
            let mut authority = RunAuthority::default();
            assert!(begin_run_authority(
                &mut authority,
                SessionOwner::Dictation,
                10
            ));

            assert!(!cancel_run_authority(
                &mut authority,
                SessionOwner::Meeting,
                11
            ));

            assert!(run_is_current(&authority, SessionOwner::Dictation, 10));
            assert_eq!(authority.latest_run_id, Some(10));
            assert_eq!(authority.latest_owner, Some(SessionOwner::Dictation));
        }

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
        fn mic_voice_gate_requires_speech_probability_on_supported_captures() {
            assert!(!super::mic_voice_detected(0.02, Some(0.59)));
            assert!(!super::mic_voice_detected(0.004, Some(0.99)));
            assert!(super::mic_voice_detected(0.02, Some(0.6)));
            assert!(super::mic_voice_detected(0.02, None));
        }

        #[test]
        fn speech_delivered_after_the_last_poll_counts_as_voice() {
            let polled = 4_800;
            let mut raw = vec![0.0; polled];
            raw.extend((0..4_800).map(|i| if i % 2 == 0 { 0.1 } else { -0.1 }));
            assert!(super::unpolled_voice(&raw, polled, 48_000.0, None));

            let quiet_tail = vec![0.0; polled * 2];
            assert!(!super::unpolled_voice(&quiet_tail, polled, 48_000.0, None));
            assert!(!super::unpolled_voice(&raw, raw.len(), 48_000.0, None));
            assert!(!super::unpolled_voice(&raw, raw.len() + 1, 48_000.0, None));
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
            assert_eq!(
                clean_transcript("ご視聴ありがとうございました", LocalEngine::Whisper),
                None
            );
            assert_eq!(
                clean_transcript("Thanks for the update", LocalEngine::Whisper),
                Some("Thanks for the update".to_string())
            );
        }

        #[test]
        fn keeps_phrases_from_parakeet_that_whisper_invents_over_silence() {
            assert_eq!(clean_transcript("Thank you.", LocalEngine::Whisper), None);
            assert_eq!(
                clean_transcript("Thank you.", LocalEngine::Parakeet),
                Some("Thank you.".to_string())
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{resolve_local_engine, LocalEngine, Voice, WhisperStopResult, Words};

    /// A dictation always reaches the start that can turn it away with a
    /// reason and recover Parakeet, however the model is doing.
    #[test]
    fn a_parakeet_dictation_always_reaches_the_parakeet_start() {
        assert_eq!(
            resolve_local_engine(Some("parakeet"), true, || panic!("not a meeting")),
            Ok(LocalEngine::Parakeet)
        );
    }

    #[test]
    fn meetings_use_whisper_until_parakeet_is_on_disk() {
        assert_eq!(
            resolve_local_engine(Some("parakeet"), false, || true),
            Ok(LocalEngine::Parakeet)
        );
        assert_eq!(
            resolve_local_engine(Some("parakeet"), false, || false),
            Ok(LocalEngine::Whisper)
        );
        assert_eq!(
            resolve_local_engine(None, false, || true),
            Ok(LocalEngine::Whisper)
        );
    }

    #[test]
    fn an_unknown_engine_is_an_error_not_whisper() {
        assert_eq!(
            resolve_local_engine(Some("parakeat"), true, || true),
            Err("unknown-transcription-engine")
        );
    }

    #[test]
    fn a_stop_result_always_says_whether_the_run_failed() {
        assert_eq!(
            serde_json::to_value(WhisperStopResult::default()).unwrap(),
            serde_json::json!({
                "failure": null,
                "dictation": null,
                "voice": null,
                "words": null
            })
        );
        assert_eq!(
            serde_json::to_value(WhisperStopResult {
                failure: Some("Microphone AirPods sent no audio in 2.3 s.".into()),
                dictation: None,
                voice: Some(Voice::Unchecked),
                words: Some(Words::Keep),
            })
            .unwrap(),
            serde_json::json!({
                "failure": "Microphone AirPods sent no audio in 2.3 s.",
                "dictation": null,
                "voice": "unchecked",
                "words": "keep"
            })
        );
        assert_eq!(
            serde_json::to_value(Words::Discard).unwrap(),
            serde_json::json!("discard")
        );
    }
}
