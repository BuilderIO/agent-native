//! On-device speech models, run through transcribe.cpp.
//!
//! Every local model shares this one native library, and with it one copy of
//! ggml. A second crate that links its own static ggml would silently run on
//! whichever copy the linker kept, so new local engines belong here too.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, Once};

use transcribe_cpp::{
    Backend, CommitPolicy, Error, Model, ModelOptions, ParakeetBufferedStreamOptions, RunExtension,
    RunOptions, Session, SessionOptions, StreamExtension, StreamOptions, TimestampKind,
    WhisperRunOptions,
};

const SESSION_THREADS: i32 = 2;

/// Parakeet's live window, in ms of audio: 5.6 s of left context, 0.56 s
/// chunks and 0.56 s of lookahead. Every value must be one of the model's
/// trained `(L, C, R)` frame tuples (here `(70, 7, 7)` at 80 ms a frame);
/// anything else fails at stream start.
const PARAKEET_STREAM_LEFT_MS: i32 = 5_600;
const PARAKEET_STREAM_CHUNK_MS: i32 = 560;
const PARAKEET_STREAM_RIGHT_MS: i32 = 560;

/// The one resident local model. Whisper and Parakeet share it, so the app
/// never holds both in memory; asking for the other one swaps it.
pub(crate) static LOCAL_MODEL: ModelSlot = ModelSlot::new();

/// One loaded model file. Asking for a different path replaces it, so
/// switching models frees the previous one.
pub(crate) struct ModelSlot(Mutex<Option<(PathBuf, Model)>>);

impl ModelSlot {
    pub(crate) const fn new() -> Self {
        Self(Mutex::new(None))
    }

    /// The model at `path`, loaded on first use. The flag is true when this
    /// call did the loading.
    pub(crate) fn get_or_load(&self, path: &Path) -> Result<(Model, bool), String> {
        let mut slot = self.0.lock().map_err(|e| e.to_string())?;
        if let Some((loaded_path, model)) = slot.as_ref() {
            if loaded_path == path {
                return Ok((model.clone(), false));
            }
        }
        // Free the old model before loading the new one, so a swap never
        // briefly holds both.
        *slot = None;
        let model = load_model(path)?;
        *slot = Some((path.to_path_buf(), model.clone()));
        Ok((model, true))
    }

    pub(crate) fn holds(&self, path: &Path) -> bool {
        self.0.lock().is_ok_and(|slot| {
            slot.as_ref()
                .is_some_and(|(loaded_path, _)| loaded_path == path)
        })
    }

    /// Unloads the model at `path` if it is the resident one. Sessions that
    /// still hold it keep it alive until they finish.
    pub(crate) fn release(&self, path: &Path) -> Result<bool, String> {
        let mut slot = self.0.lock().map_err(|e| e.to_string())?;
        if slot
            .as_ref()
            .is_some_and(|(loaded_path, _)| loaded_path == path)
        {
            *slot = None;
            return Ok(true);
        }
        Ok(false)
    }

    /// Loads `path` only when no model is resident, so a background prewarm
    /// never evicts a model someone asked for. `None` means it left the slot
    /// alone.
    pub(crate) fn load_if_empty(&self, path: &Path) -> Result<Option<Model>, String> {
        let mut slot = self.0.lock().map_err(|e| e.to_string())?;
        if slot.is_some() {
            return Ok(None);
        }
        let model = load_model(path)?;
        *slot = Some((path.to_path_buf(), model.clone()));
        Ok(Some(model))
    }
}

pub(crate) fn load_model(path: &Path) -> Result<Model, String> {
    load_on(
        path,
        if cfg!(target_arch = "aarch64") {
            Backend::Auto
        } else {
            Backend::Cpu
        },
    )
}

/// Loads a small model that must stay off the GPU queue the speech model
/// runs on, like the voice activity detector.
pub(crate) fn load_cpu_model(path: &Path) -> Result<Model, String> {
    load_on(path, Backend::Cpu)
}

fn load_on(path: &Path, backend: Backend) -> Result<Model, String> {
    static LOGGING: Once = Once::new();
    LOGGING.call_once(transcribe_cpp::init_logging);

    let options = ModelOptions {
        backend,
        ..ModelOptions::default()
    };
    Model::load_with(path, &options).map_err(|e| format!("model load failed: {e}"))
}

pub(crate) fn open_session(model: &Model) -> Result<Session, String> {
    let options = SessionOptions {
        n_threads: SESSION_THREADS,
        ..SessionOptions::default()
    };
    model
        .session_with(&options)
        .map_err(|e| format!("session init failed: {e}"))
}

/// A window the model rates more likely than this to hold no speech is
/// dropped, which keeps silence and steady noise from coming back as text.
const MAX_NO_SPEECH_PROBABILITY: f32 = 0.72;

/// Greedy decoding of 16 kHz mono PCM, with each 30 s window decoded on its
/// own (no previous-text prompt). Returns `(start_ms, end_ms, text)` segments
/// relative to the start of `samples`; `language: None` auto-detects.
pub(crate) fn transcribe_whisper(
    session: &mut Session,
    samples: &[f32],
    language: Option<&str>,
) -> Result<Vec<(i64, i64, String)>, String> {
    let options = RunOptions {
        timestamps: TimestampKind::Segment,
        language: language.map(str::to_owned),
        family: Some(RunExtension::Whisper(WhisperRunOptions {
            condition_on_prev_tokens: Some(false),
            temperature: Some(0.0),
            // transcribe.cpp drops a window only when it is both likely
            // silent and below `logprob_thold`, and the same threshold
            // decides whether a window is retried at a higher temperature.
            // An infinite threshold lets the no-speech probability decide
            // alone, which needs the retries off: no window could pass the
            // threshold, so every one would end on the hottest retry.
            temperature_inc: Some(0.0),
            no_speech_thold: Some(MAX_NO_SPEECH_PROBABILITY),
            logprob_thold: Some(f32::INFINITY),
            ..WhisperRunOptions::default()
        })),
        ..RunOptions::default()
    };
    // An early stop comes with the text decoded before it, but the speech
    // after it is lost. Returning that text would pass a cut-off transcript
    // off as a whole one, so an early stop fails the run.
    let transcript = session.run(samples, &options).map_err(|e| match e {
        Error::OutputTruncated { .. } => {
            "whisper stopped early: decoding hit its token limit".to_owned()
        }
        Error::OutputRepetition { .. } => {
            "whisper stopped early: the output began repeating".to_owned()
        }
        e => format!("whisper inference failed: {e}"),
    })?;
    Ok(transcript
        .segments
        .into_iter()
        .map(|segment| (segment.t0_ms, segment.t1_ms, segment.text))
        .collect())
}

fn parakeet_run_options(timestamps: TimestampKind) -> RunOptions {
    RunOptions {
        timestamps,
        language: Some("en".to_owned()),
        ..RunOptions::default()
    }
}

/// English Parakeet decoding of 16 kHz mono PCM in one pass. Returns
/// `(start_ms, end_ms, text)` segments relative to the start of `samples`.
pub(crate) fn transcribe_parakeet(
    session: &mut Session,
    samples: &[f32],
) -> Result<Vec<(i64, i64, String)>, String> {
    let transcript = session
        .run(samples, &parakeet_run_options(TimestampKind::Segment))
        .map_err(|e| format!("parakeet inference failed: {e}"))?;
    Ok(transcript
        .segments
        .into_iter()
        .map(|segment| (segment.t0_ms, segment.t1_ms, segment.text))
        .collect())
}

/// Transcribes Parakeet audio as it arrives. `next_audio` returns the next
/// 16 kHz mono samples, waiting for them if needed, and `None` once the
/// recording has ended; the stream is then finalized and its text returned.
/// The session's model refuses offline runs until this returns, so a caller
/// that gives up on it must cancel the session first.
pub(crate) fn transcribe_parakeet_live(
    session: &mut Session,
    mut next_audio: impl FnMut() -> Result<Option<Vec<f32>>, String>,
    mut on_partial: impl FnMut(&str),
) -> Result<String, String> {
    let stream_options = StreamOptions {
        commit_policy: CommitPolicy::Auto,
        family: Some(StreamExtension::ParakeetBuffered(
            ParakeetBufferedStreamOptions {
                left_ms: Some(PARAKEET_STREAM_LEFT_MS),
                chunk_ms: Some(PARAKEET_STREAM_CHUNK_MS),
                right_ms: Some(PARAKEET_STREAM_RIGHT_MS),
            },
        )),
        ..StreamOptions::default()
    };
    let mut stream = session
        .stream(&parakeet_run_options(TimestampKind::None), &stream_options)
        .map_err(|e| format!("parakeet stream start failed: {e}"))?;
    while let Some(samples) = next_audio()? {
        if samples.is_empty() {
            continue;
        }
        let update = stream
            .feed(&samples)
            .map_err(|e| format!("parakeet stream feed failed: {e}"))?;
        if update.result_changed {
            on_partial(stream.text().display().trim());
        }
    }
    stream
        .finalize()
        .map_err(|e| format!("parakeet stream finalize failed: {e}"))?;
    Ok(stream.text().full.trim().to_owned())
}

/// Runs a second of silence through a live stream and an offline pass, so the
/// backend's first-use setup happens now rather than in the first dictation.
pub(crate) fn warm_up_parakeet(model: &Model) -> Result<(), String> {
    let silence = vec![0.0; 16_000];
    let mut session = open_session(model)?;
    let mut fed = false;
    transcribe_parakeet_live(
        &mut session,
        || Ok((!std::mem::replace(&mut fed, true)).then(|| silence.clone())),
        |_| {},
    )?;
    transcribe_parakeet(&mut session, &silence)?;
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Transcribes a recording with a downloaded model, either a GGUF or a
    /// whisper.cpp `.bin`. Run with `CLIPS_TEST_WHISPER_MODEL=<model file>
    /// CLIPS_TEST_WHISPER_WAV=<16 kHz mono 16-bit .wav>
    /// CLIPS_TEST_WHISPER_TEXT=<what the recording says> cargo test --lib
    /// transcribe_engine -- --ignored`.
    #[test]
    #[ignore = "needs a downloaded Whisper model and a WAV file"]
    fn transcribes_a_wav_file_with_a_downloaded_whisper_model() {
        let model_path = test_env("CLIPS_TEST_WHISPER_MODEL");
        let samples = read_pcm16_wav(Path::new(&test_env("CLIPS_TEST_WHISPER_WAV")));
        let expected = test_env("CLIPS_TEST_WHISPER_TEXT");

        let slot = ModelSlot::new();
        let (model, loaded) = slot.get_or_load(Path::new(&model_path)).unwrap();
        assert!(loaded);
        assert!(!slot.get_or_load(Path::new(&model_path)).unwrap().1);
        assert_eq!(model.arch(), "whisper");

        let mut session = open_session(&model).unwrap();
        let started = std::time::Instant::now();
        let segments = transcribe_whisper(&mut session, &samples, None).unwrap();
        let text = segments
            .iter()
            .map(|(_, _, text)| text.trim())
            .collect::<Vec<_>>()
            .join(" ");
        eprintln!(
            "[{}] {:.1}s of audio in {} ms: {segments:?}",
            model.backend(),
            samples.len() as f32 / 16_000.0,
            started.elapsed().as_millis(),
        );

        assert_eq!(words(&text), words(&expected));

        // A slip in time units shows up as times ten times too large or small.
        let audio_ms = samples.len() as i64 * 1000 / 16_000;
        let mut previous_start = 0;
        for (start_ms, end_ms, _) in &segments {
            assert!(previous_start <= *start_ms && start_ms <= end_ms);
            previous_start = *start_ms;
        }
        let last_end_ms = segments.last().unwrap().1;
        assert!(
            audio_ms / 2 < last_end_ms && last_end_ms <= audio_ms + 500,
            "speech ends at {last_end_ms} ms in {audio_ms} ms of audio"
        );
    }

    /// Silence and steady noise must come back empty, not as a hallucinated
    /// "you". Uses `CLIPS_TEST_WHISPER_MODEL` like the test above.
    #[test]
    #[ignore = "needs a downloaded Whisper model"]
    fn drops_silence_and_steady_noise() {
        let model = load_model(Path::new(&test_env("CLIPS_TEST_WHISPER_MODEL"))).unwrap();
        let mut session = open_session(&model).unwrap();
        let mut seed = 0x2545_f491_u32;
        let noise = (0..5 * 16_000)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                (seed as f32 / u32::MAX as f32 - 0.5) * 0.04
            })
            .collect::<Vec<_>>();

        for (name, samples) in [("silence", vec![0.0; 5 * 16_000]), ("noise", noise)] {
            let segments = transcribe_whisper(&mut session, &samples, None).unwrap();
            assert!(segments.is_empty(), "{name}: {segments:?}");
        }
    }

    fn test_env(name: &str) -> String {
        std::env::var(name).unwrap_or_else(|_| panic!("set {name}; see the test's doc comment"))
    }

    fn words(text: &str) -> Vec<String> {
        text.split(|c: char| !c.is_alphanumeric())
            .filter(|word| !word.is_empty())
            .map(str::to_lowercase)
            .collect()
    }

    /// Transcribes a real recording with the downloaded Parakeet model, once in
    /// one pass and once live, fed as fast as it was spoken. Run with
    /// `CLIPS_TEST_PARAKEET_MODEL=<model .gguf> CLIPS_TEST_PARAKEET_WAV=<16 kHz
    /// mono 16-bit .wav> cargo test --lib transcribe_engine -- --ignored
    /// --nocapture`; add `CLIPS_TEST_PARAKEET_PACE=fast` to feed it at once.
    #[test]
    #[ignore = "needs the downloaded Parakeet model and a WAV file"]
    fn transcribes_a_wav_file_with_parakeet_offline_and_live() {
        use std::time::{Duration, Instant};

        let model_path = std::env::var("CLIPS_TEST_PARAKEET_MODEL")
            .expect("set CLIPS_TEST_PARAKEET_MODEL to the Parakeet model file");
        let wav_path = std::env::var("CLIPS_TEST_PARAKEET_WAV")
            .expect("set CLIPS_TEST_PARAKEET_WAV to a 16 kHz mono 16-bit WAV");
        let realtime = std::env::var("CLIPS_TEST_PARAKEET_PACE").as_deref() != Ok("fast");
        let samples = read_pcm16_wav(Path::new(&wav_path));
        let audio = Duration::from_secs_f64(samples.len() as f64 / 16_000.0);

        let started = Instant::now();
        let model = load_model(Path::new(&model_path)).unwrap();
        assert_eq!(model.arch(), "parakeet");
        let loaded = started.elapsed();
        warm_up_parakeet(&model).unwrap();
        eprintln!(
            "[{}] loaded in {} ms, warmed up in {} ms",
            model.backend(),
            loaded.as_millis(),
            (started.elapsed() - loaded).as_millis()
        );

        let mut session = open_session(&model).unwrap();
        let started = Instant::now();
        let segments = transcribe_parakeet(&mut session, &samples).unwrap();
        let offline_text = segments
            .iter()
            .map(|(_, _, text)| text.trim())
            .collect::<Vec<_>>()
            .join(" ");
        eprintln!(
            "offline: {:.1}s of audio in {} ms: {offline_text}",
            audio.as_secs_f64(),
            started.elapsed().as_millis()
        );

        let started = Instant::now();
        let mut fed = 0;
        let mut partials = 0;
        let live_text = transcribe_parakeet_live(
            &mut session,
            || {
                if fed == samples.len() {
                    return Ok(None);
                }
                loop {
                    let spoken = if realtime {
                        ((started.elapsed().as_secs_f64() * 16_000.0) as usize).min(samples.len())
                    } else {
                        samples.len()
                    };
                    if spoken >= fed + 1_600 || spoken == samples.len() {
                        let block = samples[fed..spoken].to_vec();
                        fed = spoken;
                        return Ok(Some(block));
                    }
                    std::thread::sleep(Duration::from_millis(20));
                }
            },
            |_| partials += 1,
        )
        .unwrap();
        let after_audio =
            started
                .elapsed()
                .saturating_sub(if realtime { audio } else { Duration::ZERO });
        eprintln!(
            "live ({}): final text {} ms after the audio ended, {partials} partials: {live_text}",
            if realtime { "real-time" } else { "fast" },
            after_audio.as_millis()
        );

        assert!(!offline_text.is_empty());
        assert!(!live_text.is_empty());
        let audio_ms = audio.as_millis() as i64;
        for (start_ms, end_ms, _) in &segments {
            assert!(0 <= *start_ms && start_ms <= end_ms && *end_ms <= audio_ms + 1000);
        }
    }

    /// The Rust half of `scripts/dictation-wer.ts`, which sets these
    /// variables and reads the JSON it writes. Transcribes each 16 kHz WAV
    /// listed in `CLIPS_WER_MANIFEST` the way dictation does: Parakeet through
    /// its live stream, Whisper in 25 s windows.
    #[test]
    #[ignore = "run by scripts/dictation-wer.ts"]
    fn transcribes_clips_for_the_wer_harness() {
        let var = |name: &str| std::env::var(name).unwrap_or_else(|_| panic!("set {name}"));
        let engine = var("CLIPS_WER_ENGINE");
        let model = load_model(Path::new(&var("CLIPS_WER_MODEL"))).unwrap();
        let manifest = std::fs::read_to_string(var("CLIPS_WER_MANIFEST")).unwrap();
        if engine == "parakeet" {
            warm_up_parakeet(&model).unwrap();
        }
        let mut results = Vec::new();
        for wav in manifest.lines().filter(|line| !line.trim().is_empty()) {
            let samples = read_pcm16_wav(Path::new(wav));
            let mut session = open_session(&model).unwrap();
            let started = std::time::Instant::now();
            let text = match engine.as_str() {
                "parakeet" => {
                    let mut blocks = samples.chunks(8_960).map(<[f32]>::to_vec);
                    transcribe_parakeet_live(&mut session, || Ok(blocks.next()), |_| {}).unwrap()
                }
                "whisper" => samples
                    .chunks(25 * 16_000)
                    .flat_map(|window| transcribe_whisper(&mut session, window, None).unwrap())
                    .map(|(_, _, text)| text.trim().to_owned())
                    .filter(|text| !text.is_empty())
                    .collect::<Vec<_>>()
                    .join(" "),
                other => panic!("unknown CLIPS_WER_ENGINE {other}"),
            };
            results.push(serde_json::json!({
                "wav": wav,
                "text": text,
                "ms": started.elapsed().as_millis() as u64,
            }));
        }
        std::fs::write(
            var("CLIPS_WER_OUTPUT"),
            serde_json::to_vec(&serde_json::json!({ "engine": engine, "results": results }))
                .unwrap(),
        )
        .unwrap();
    }

    pub(crate) fn read_pcm16_wav(path: &Path) -> Vec<f32> {
        let bytes = std::fs::read(path).unwrap();
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        let mut offset = 12;
        let mut format_checked = false;
        while offset + 8 <= bytes.len() {
            let id = &bytes[offset..offset + 4];
            let len =
                u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap()) as usize;
            let body = &bytes[offset + 8..(offset + 8 + len).min(bytes.len())];
            if id == b"fmt " {
                let format = u16::from_le_bytes([body[0], body[1]]);
                let channels = u16::from_le_bytes([body[2], body[3]]);
                let rate = u32::from_le_bytes(body[4..8].try_into().unwrap());
                let bits = u16::from_le_bytes([body[14], body[15]]);
                assert_eq!((format, channels, rate, bits), (1, 1, 16_000, 16));
                format_checked = true;
            } else if id == b"data" {
                assert!(format_checked, "WAV data chunk came before its format");
                return body
                    .chunks_exact(2)
                    .map(|pair| i16::from_le_bytes([pair[0], pair[1]]) as f32 / 32_768.0)
                    .collect();
            }
            offset += 8 + len + (len & 1);
        }
        panic!("no data chunk in {}", path.display());
    }
}
