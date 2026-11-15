//! Silero VAD, which tells a dictation held in silence from one with speech
//! in it, so a silent one ends at release instead of waiting for a transcript
//! that never comes.
//!
//! The detector is its own small model on the CPU. It never shares the
//! Whisper or Parakeet model, whose live stream would refuse it as busy, and
//! it never waits on their compute lock.

use tauri::AppHandle;

#[cfg(target_os = "macos")]
pub(crate) use macos::{SpeechCheck, Verdict};

/// Fetches the detector while dictation is on, so the first dictation can use
/// it. Returns at once; the download runs in the background.
#[tauri::command]
pub fn speech_detector_prepare(app: AppHandle) {
    #[cfg(target_os = "macos")]
    macos::download_in_background(&app);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ops::Range;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
    use std::sync::mpsc;
    use std::sync::{Arc, Condvar, Mutex, OnceLock, PoisonError};
    use std::time::{Duration, Instant};

    use tauri::AppHandle;
    use transcribe_cpp::{Model, VadSession, VadSessionOptions};

    use crate::model_download::{download_verified, file_sha256, PinnedFile, VerifiedDownload};
    use crate::parakeet_live::StreamingResample;
    use crate::whisper_speech::Voice;

    pub(crate) const SILERO_VAD_MODEL: PinnedFile = PinnedFile {
        url: "https://huggingface.co/handy-computer/silero-vad-v6.2-gguf/resolve/a9b2d61c20ae4ddf3644edb34969e8185a485448/silero-vad-v6.2-F32.gguf",
        filename: "silero-vad-v6.2-F32.gguf",
        sha256: "0d871a800c420fdd5d1b17a3aea4296d1c39608f0ff4a9295eb76457eb1c88e6",
        size_bytes: 1_241_056,
        size_mb: 1,
    };

    /// A frame (32 ms) at or above this probability may be speech. Lower than
    /// Silero's usual 0.5 on purpose: steady noise of any loudness scores under
    /// 0.11, while a whisper over a loud fan can stay under 0.5. Missing a silence
    /// costs the old wait at release; missing speech would lose the dictation.
    const SPEECH_PROBABILITY: f32 = 0.2;
    /// This many such frames in a row count as someone speaking. A short word
    /// spans several.
    const SPEECH_RUN_FRAMES: u32 = 3;
    const POLL: Duration = Duration::from_millis(40);
    /// How long release waits for the verdict before the dictation takes the
    /// normal path without one.
    const VERDICT_WAIT: Duration = Duration::from_millis(250);
    const FRAME_MS: u64 = 32;

    static DOWNLOADING: AtomicBool = AtomicBool::new(false);
    static DOWNLOADED_BYTES: AtomicU64 = AtomicU64::new(0);
    static MODEL: Mutex<Option<(PathBuf, Model)>> = Mutex::new(None);

    pub(crate) fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
        Ok(crate::whisper_model::models_dir(app)?.join(SILERO_VAD_MODEL.filename))
    }

    fn is_complete_on_disk(path: &Path) -> bool {
        std::fs::metadata(path)
            .map(|m| m.len() == SILERO_VAD_MODEL.size_bytes)
            .unwrap_or(false)
    }

    /// Fetches the model in the background unless it is on disk or on its way.
    pub(crate) fn download_in_background(app: &AppHandle) {
        let path = match model_path(app) {
            Ok(path) => path,
            Err(error) => {
                eprintln!("[vad] no place for the model: {error}");
                return;
            }
        };
        if is_complete_on_disk(&path) || DOWNLOADING.swap(true, Ordering::SeqCst) {
            return;
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            DOWNLOADED_BYTES.store(0, Ordering::Relaxed);
            let result = download_verified(
                &app,
                &path,
                &VerifiedDownload {
                    url: SILERO_VAD_MODEL.url,
                    sha256: SILERO_VAD_MODEL.sha256,
                    size_bytes: SILERO_VAD_MODEL.size_bytes,
                    size_mb: SILERO_VAD_MODEL.size_mb,
                    progress_event: "vad:model-progress",
                    downloaded_bytes: &DOWNLOADED_BYTES,
                    cancel: None,
                    log_tag: "vad",
                },
            )
            .await;
            DOWNLOADING.store(false, Ordering::SeqCst);
            if let Err(error) = result {
                eprintln!("[vad] model download failed: {error}");
            }
        });
    }

    /// Runs when the file on disk turns out damaged, after it is deleted.
    type Repair = Box<dyn FnOnce() + Send>;

    /// The detector stays loaded once used; at about 1 MB it is not worth
    /// reloading for every dictation. The file is checked against its pinned
    /// SHA-256 before its first load: a download is checked as it lands, but a
    /// file already on disk was only checked for size, and damaged weights of
    /// the right size would load and give confident verdicts.
    fn resident_model(path: &Path, repair: Repair) -> Result<Model, String> {
        let mut slot = MODEL.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some((loaded, model)) = slot.as_ref() {
            if loaded == path {
                return Ok(model.clone());
            }
        }
        let digest = file_sha256(path)?;
        if digest != SILERO_VAD_MODEL.sha256 {
            eprintln!(
                "[vad] model file is damaged (checksum mismatch); deleting it to download again"
            );
            if let Err(error) = std::fs::remove_file(path) {
                eprintln!("[vad] could not delete the damaged model: {error}");
            }
            repair();
            return Err("checksum mismatch".to_owned());
        }
        let model = crate::transcribe_engine::load_cpu_model(path)?;
        *slot = Some((path.to_path_buf(), model.clone()));
        Ok(model)
    }

    /// Speech frames seen so far, and whether they add up to someone speaking.
    #[derive(Debug, Default, Clone, PartialEq, Eq)]
    struct Tally {
        frames: u64,
        speech_frames: u64,
        run: u32,
        heard: bool,
        /// The speech frames, as runs of frame indices.
        speech_runs: Vec<Range<u64>>,
    }

    impl Tally {
        fn observe(&mut self, probabilities: &[f32]) {
            for &probability in probabilities {
                let frame = self.frames;
                self.frames += 1;
                if probability >= SPEECH_PROBABILITY {
                    self.speech_frames += 1;
                    self.run += 1;
                    self.heard |= self.run >= SPEECH_RUN_FRAMES;
                    match self.speech_runs.last_mut() {
                        Some(run) if run.end == frame => run.end = frame + 1,
                        _ => self.speech_runs.push(frame..frame + 1),
                    }
                } else {
                    self.run = 0;
                }
            }
        }

        /// Silence needs audio that was scored and held no speech; with nothing
        /// scored there is no verdict.
        fn voice(&self) -> Voice {
            if self.heard {
                Voice::Heard
            } else if self.frames == 0 {
                Voice::Unchecked
            } else {
                Voice::Silent
            }
        }
    }

    /// A finished check: its verdict, and when the audio held frames that may
    /// be speech, timed from the first sample. A silent verdict can still have
    /// some, just never enough in a row to count as someone speaking.
    #[derive(Debug, Clone, PartialEq, Eq)]
    pub(crate) struct Verdict {
        pub voice: Voice,
        pub possible_speech: Vec<Range<Duration>>,
    }

    #[derive(Debug)]
    struct Outcome {
        tally: Tally,
        /// Why the check could not reach a verdict; `None` when it did.
        failure: Option<String>,
    }

    impl Outcome {
        fn voice(&self) -> Voice {
            match self.failure {
                Some(_) => Voice::Unchecked,
                None => self.tally.voice(),
            }
        }
    }

    struct Shared {
        pending: Mutex<Vec<f32>>,
        src_rate: AtomicU32,
        /// Set at release; the worker scores what is left and reports.
        closed: Mutex<bool>,
        close_signal: Condvar,
        /// Set once the verdict can no longer change, so capture stops copying.
        settled: AtomicBool,
        first_sample_at: OnceLock<Instant>,
    }

    /// One dictation's speech check, fed from the capture callback while the key
    /// is held and asked for a verdict at release.
    pub(crate) struct SpeechCheck {
        shared: Arc<Shared>,
        outcome: Mutex<mpsc::Receiver<Outcome>>,
        engine: &'static str,
        started_at: Instant,
        pressed_at: Option<Instant>,
    }

    impl SpeechCheck {
        /// Starts a check for a dictation on `engine`. With the model not yet on
        /// disk the check reports `Unchecked`, and the download starts so the
        /// next dictation has it.
        pub(crate) fn for_dictation(app: &AppHandle, engine: &'static str) -> Self {
            let path = model_path(app).and_then(|path| {
                if is_complete_on_disk(&path) {
                    Ok(path)
                } else {
                    download_in_background(app);
                    Err("the model is not downloaded yet".to_owned())
                }
            });
            let app = app.clone();
            Self::start(
                path,
                engine,
                crate::shortcuts::claim_voice_press(),
                Box::new(move || download_in_background(&app)),
            )
        }

        fn start(
            model_path: Result<PathBuf, String>,
            engine: &'static str,
            pressed_at: Option<Instant>,
            repair: Repair,
        ) -> Self {
            let shared = Arc::new(Shared {
                pending: Mutex::new(Vec::new()),
                src_rate: AtomicU32::new(0),
                closed: Mutex::new(false),
                close_signal: Condvar::new(),
                settled: AtomicBool::new(false),
                first_sample_at: OnceLock::new(),
            });
            let (sender, receiver) = mpsc::channel();
            let worker_shared = shared.clone();
            let spawned = std::thread::Builder::new()
                .name("clips-vad".into())
                .spawn(move || {
                    let outcome = match model_path {
                        Ok(path) => score(&worker_shared, &path, repair),
                        Err(failure) => Outcome {
                            tally: Tally::default(),
                            failure: Some(failure),
                        },
                    };
                    worker_shared.settled.store(true, Ordering::SeqCst);
                    let _ = sender.send(outcome);
                });
            if let Err(error) = spawned {
                eprintln!("[vad] could not start the check: {error}");
                shared.settled.store(true, Ordering::SeqCst);
            }
            Self {
                shared,
                outcome: Mutex::new(receiver),
                engine,
                started_at: Instant::now(),
                pressed_at,
            }
        }

        pub(crate) fn set_sample_rate(&self, rate: f64) {
            self.shared.src_rate.store(rate as u32, Ordering::SeqCst);
        }

        /// Called on the audio thread; it only copies.
        pub(crate) fn push(&self, samples: &[f32]) {
            if samples.is_empty() {
                return;
            }
            let _ = self.shared.first_sample_at.set(Instant::now());
            if self.shared.settled.load(Ordering::Relaxed) {
                return;
            }
            if let Ok(mut pending) = self.shared.pending.lock() {
                pending.extend_from_slice(samples);
            }
        }

        /// The verdict over everything pushed so far. Call it once capture has
        /// stopped. Anything short of a clean verdict is `Unchecked`, which keeps
        /// the dictation on its normal path.
        pub(crate) fn finish(&self) -> Verdict {
            let asked = Instant::now();
            self.close();
            let outcome = self
                .outcome
                .lock()
                .map_err(|_| "the check's lock was poisoned".to_owned())
                .and_then(|receiver| {
                    receiver
                        .recv_timeout(VERDICT_WAIT)
                        .map_err(|error| match error {
                            mpsc::RecvTimeoutError::Timeout => {
                                format!("no verdict within {} ms", VERDICT_WAIT.as_millis())
                            }
                            mpsc::RecvTimeoutError::Disconnected => {
                                "the check stopped early".to_owned()
                            }
                        })
                })
                .unwrap_or_else(|failure| Outcome {
                    tally: Tally::default(),
                    failure: Some(failure),
                });
            let voice = outcome.voice();
            eprintln!(
                "[vad] {} dictation: voice={}{} scored_ms={} speech_ms={} verdict_ms={}",
                self.engine,
                voice.as_str(),
                outcome
                    .failure
                    .as_deref()
                    .map(|failure| format!(" ({failure})"))
                    .unwrap_or_default(),
                outcome.tally.frames * FRAME_MS,
                outcome.tally.speech_frames * FRAME_MS,
                asked.elapsed().as_millis(),
            );
            let at = |frame: u64| Duration::from_millis(frame * FRAME_MS);
            Verdict {
                voice,
                possible_speech: outcome
                    .tally
                    .speech_runs
                    .iter()
                    .map(|run| at(run.start)..at(run.end))
                    .collect(),
            }
        }

        fn close(&self) {
            let mut closed = self
                .shared
                .closed
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            *closed = true;
            self.shared.close_signal.notify_all();
        }
    }

    impl Drop for SpeechCheck {
        fn drop(&mut self) {
            self.close();
            // Each dictation run has one check, so this is one line per run.
            let first_audio = self.shared.first_sample_at.get().copied();
            let until_first_audio = |from: Option<Instant>| match (from, first_audio) {
                (Some(from), Some(first_audio)) => first_audio
                    .saturating_duration_since(from)
                    .as_millis()
                    .to_string(),
                _ => "none".to_owned(),
            };
            eprintln!(
                "[dictation] {} press_to_first_audio_ms={} start_to_first_audio_ms={}",
                self.engine,
                until_first_audio(self.pressed_at),
                until_first_audio(Some(self.started_at)),
            );
        }
    }

    /// The worker: scores audio as it arrives and stops at the first speech, or
    /// at release with whatever is left.
    fn score(shared: &Shared, path: &Path, repair: Repair) -> Outcome {
        let mut tally = Tally::default();
        let fail = |tally: Tally, failure: String| Outcome {
            tally,
            failure: Some(failure),
        };
        let model = match resident_model(path, repair) {
            Ok(model) => model,
            Err(error) => return fail(tally, format!("load: {error}")),
        };
        let mut session = match model.vad_session_with(&VadSessionOptions { n_threads: 1 }) {
            Ok(session) => session,
            Err(error) => return fail(tally, format!("session: {error}")),
        };
        let mut resample: Option<StreamingResample> = None;
        let mut audio_16k = Vec::new();
        loop {
            let closed = {
                let closed = shared.closed.lock().unwrap_or_else(PoisonError::into_inner);
                if *closed {
                    true
                } else {
                    *shared
                        .close_signal
                        .wait_timeout(closed, POLL)
                        .unwrap_or_else(PoisonError::into_inner)
                        .0
                }
            };
            let src_rate = shared.src_rate.load(Ordering::SeqCst) as f64;
            if src_rate < 1.0 {
                if closed {
                    return fail(
                        tally,
                        "the capture never reported its sample rate".to_owned(),
                    );
                }
                continue;
            }
            let raw = std::mem::take(
                &mut *shared
                    .pending
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner),
            );
            if resample
                .as_ref()
                .is_some_and(|resampler| !resampler.has_rate(src_rate))
            {
                resample = None;
            }
            let resampler = resample.get_or_insert_with(|| StreamingResample::new(src_rate));
            audio_16k.clear();
            resampler.push(&raw, &mut audio_16k);
            if let Err(error) = feed(&mut session, &audio_16k, &mut tally) {
                return fail(tally, error);
            }
            if tally.heard {
                return Outcome {
                    tally,
                    failure: None,
                };
            }
            if closed {
                audio_16k.clear();
                if let Some(resampler) = resample.take() {
                    resampler.finish(&mut audio_16k);
                }
                if let Err(error) = feed(&mut session, &audio_16k, &mut tally) {
                    return fail(tally, error);
                }
                return match session.stream_flush() {
                    Ok(result) => {
                        tally.observe(&result.probs);
                        Outcome {
                            tally,
                            failure: None,
                        }
                    }
                    Err(error) => fail(tally, format!("flush: {error}")),
                };
            }
        }
    }

    fn feed(session: &mut VadSession, audio_16k: &[f32], tally: &mut Tally) -> Result<(), String> {
        if audio_16k.is_empty() {
            return Ok(());
        }
        let result = session
            .stream_feed(audio_16k)
            .map_err(|error| format!("feed: {error}"))?;
        tally.observe(&result.probs);
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn the_pinned_file_is_a_gguf_at_a_fixed_revision() {
            assert_eq!(SILERO_VAD_MODEL.sha256.len(), 64);
            assert!(SILERO_VAD_MODEL.filename.ends_with(".gguf"));
            assert!(SILERO_VAD_MODEL.url.ends_with(SILERO_VAD_MODEL.filename));
            assert!(SILERO_VAD_MODEL
                .url
                .contains("/resolve/a9b2d61c20ae4ddf3644edb34969e8185a485448/"));
            assert_eq!(
                SILERO_VAD_MODEL.size_mb,
                SILERO_VAD_MODEL.size_bytes / 1_000_000
            );
        }

        #[test]
        fn speech_needs_a_run_of_frames_not_one_spike() {
            let mut tally = Tally::default();
            tally.observe(&[0.05, 0.9, 0.1, 0.8, 0.05, 0.95, 0.1]);
            assert_eq!(tally.voice(), Voice::Silent);
            tally.observe(&[0.25, 0.3, 0.2]);
            assert_eq!(tally.voice(), Voice::Heard);
        }

        #[test]
        fn a_silent_tally_keeps_where_it_scored_possible_speech() {
            let mut tally = Tally::default();
            tally.observe(&[0.05, 0.9, 0.1]);
            tally.observe(&[0.3, 0.4, 0.05]);
            assert_eq!(tally.voice(), Voice::Silent);
            assert_eq!(tally.speech_runs, vec![1..2, 3..5]);
        }

        #[test]
        fn a_heard_verdict_does_not_go_back_to_silence() {
            let mut tally = Tally::default();
            tally.observe(&[0.9, 0.9, 0.9]);
            tally.observe(&[0.0; 200]);
            assert_eq!(tally.voice(), Voice::Heard);
        }

        #[test]
        fn nothing_scored_is_no_verdict_rather_than_silence() {
            assert_eq!(Tally::default().voice(), Voice::Unchecked);
        }

        #[test]
        fn a_check_that_cannot_run_is_never_silence() {
            let check = SpeechCheck::start(
                Err("the model is not downloaded yet".into()),
                "test",
                None,
                Box::new(|| {}),
            );
            check.set_sample_rate(16_000.0);
            check.push(&[0.0; 16_000]);
            assert_eq!(check.finish().voice, Voice::Unchecked);

            let missing = std::env::temp_dir().join("clips-vad-test-no-such-model.gguf");
            let check = SpeechCheck::start(Ok(missing), "test", None, Box::new(|| {}));
            check.set_sample_rate(16_000.0);
            check.push(&[0.0; 16_000]);
            assert_eq!(check.finish().voice, Voice::Unchecked);
        }

        #[test]
        fn a_damaged_model_of_the_right_size_is_deleted_and_fetched_again() {
            let dir = std::env::temp_dir().join(format!(
                "clips-vad-damaged-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join(SILERO_VAD_MODEL.filename);
            std::fs::write(&path, vec![0x47; SILERO_VAD_MODEL.size_bytes as usize]).unwrap();
            assert!(is_complete_on_disk(&path));

            let (repaired, repair_called) = mpsc::channel();
            let check = SpeechCheck::start(
                Ok(path.clone()),
                "test",
                None,
                Box::new(move || {
                    let _ = repaired.send(());
                }),
            );
            check.set_sample_rate(16_000.0);
            check.push(&[0.0; 16_000]);

            assert_eq!(check.finish().voice, Voice::Unchecked);
            repair_called
                .recv_timeout(Duration::from_secs(5))
                .expect("a damaged model must be fetched again");
            assert!(!path.exists(), "the damaged file must be deleted");
            assert!(MODEL
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .as_ref()
                .is_none_or(|(loaded, _)| loaded != &path));
            let _ = std::fs::remove_dir_all(&dir);
        }

        fn noise(len: usize, amplitude: f32) -> Vec<f32> {
            // This seed gave the whisper below its lowest scores of four tried.
            let mut state = 0x2545_f491_u32;
            (0..len)
                .map(|_| {
                    state ^= state << 13;
                    state ^= state >> 17;
                    state ^= state << 5;
                    (state as f32 / u32::MAX as f32 * 2.0 - 1.0) * amplitude
                })
                .collect()
        }

        fn upsample_3x(audio: &[f32]) -> Vec<f32> {
            audio
                .windows(2)
                .flat_map(|pair| {
                    let (a, b) = (pair[0], pair[1]);
                    [a, a + (b - a) / 3.0, a + (b - a) * 2.0 / 3.0]
                })
                .collect()
        }

        /// Feeds `audio` the way capture does, in 10 ms buffers.
        fn check(model: &Path, audio: &[f32], rate: f64) -> (Voice, Duration) {
            let check = SpeechCheck::start(Ok(model.to_path_buf()), "test", None, Box::new(|| {}));
            check.set_sample_rate(rate);
            let buffer = (rate / 100.0) as usize;
            for piece in audio.chunks(buffer) {
                check.push(piece);
                std::thread::sleep(Duration::from_millis(1));
            }
            let asked = Instant::now();
            let voice = check.finish().voice;
            (voice, asked.elapsed())
        }

        /// Runs the check on synthetic silence and noise, and on recordings made
        /// with `say` (`--data-format=LEI16@16000`, including `-v Whisper`). Set
        /// `CLIPS_TEST_VAD_MODEL` to the Silero GGUF and
        /// `CLIPS_TEST_VAD_SPEECH_WAVS` to a `:`-separated list of those WAVs.
        #[test]
        #[ignore = "needs the Silero model and speech recordings"]
        fn silero_tells_silence_and_noise_from_speech() {
            let model = PathBuf::from(
                std::env::var("CLIPS_TEST_VAD_MODEL").expect("set CLIPS_TEST_VAD_MODEL"),
            );
            let speech = std::env::var("CLIPS_TEST_VAD_SPEECH_WAVS")
                .expect("set CLIPS_TEST_VAD_SPEECH_WAVS");

            let loaded = Instant::now();
            resident_model(&model, Box::new(|| panic!("the test model is damaged"))).unwrap();
            eprintln!("model load: {} ms", loaded.elapsed().as_millis());

            let silent: [(&str, Vec<f32>); 4] = [
                ("digital silence", vec![0.0; 48_000]),
                ("room tone", noise(48_000, 0.002)),
                ("steady noise", noise(48_000, 0.05)),
                ("loud steady noise", noise(48_000, 0.2)),
            ];
            for (name, audio) in &silent {
                let (voice, took) = check(&model, audio, 16_000.0);
                eprintln!("{name}: {voice:?}, verdict in {} ms", took.as_millis());
                assert_eq!(voice, Voice::Silent, "{name}");
                let (voice, _) = check(&model, &upsample_3x(audio), 48_000.0);
                assert_eq!(voice, Voice::Silent, "{name} at 48 kHz");
            }
            for wav in speech.split(':').filter(|path| !path.is_empty()) {
                let audio = crate::transcribe_engine::tests::read_pcm16_wav(Path::new(wav));
                let name = Path::new(wav).file_name().unwrap().to_string_lossy();
                let (voice, took) = check(&model, &audio, 16_000.0);
                eprintln!("{name}: {voice:?}, verdict in {} ms", took.as_millis());
                assert_eq!(voice, Voice::Heard, "{name}");
                let (voice, _) = check(&model, &upsample_3x(&audio), 48_000.0);
                assert_eq!(voice, Voice::Heard, "{name} at 48 kHz");
                // About the whisper's own level, like a fan right by the mic.
                let mut noisy = noise(audio.len(), 0.05);
                for (sample, speech) in noisy.iter_mut().zip(&audio) {
                    *sample += speech;
                }
                let (voice, _) = check(&model, &noisy, 16_000.0);
                assert_eq!(voice, Voice::Heard, "{name} over steady noise");
            }
        }
    }
}
