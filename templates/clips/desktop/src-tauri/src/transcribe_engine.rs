//! On-device speech models, run through transcribe.cpp.
//!
//! Every local model shares this one native library, and with it one copy of
//! ggml. A second crate that links its own static ggml would silently run on
//! whichever copy the linker kept, so new local engines belong here too.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, Once};

use transcribe_cpp::{
    Backend, Error, Model, ModelOptions, RunExtension, RunOptions, Session, SessionOptions,
    TimestampKind, WhisperRunOptions,
};

const SESSION_THREADS: i32 = 2;

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
        let model = load_model(path)?;
        *slot = Some((path.to_path_buf(), model.clone()));
        Ok((model, true))
    }
}

pub(crate) fn load_model(path: &Path) -> Result<Model, String> {
    static LOGGING: Once = Once::new();
    LOGGING.call_once(transcribe_cpp::init_logging);

    let options = ModelOptions {
        backend: if cfg!(target_arch = "aarch64") {
            Backend::Auto
        } else {
            Backend::Cpu
        },
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

#[cfg(test)]
mod tests {
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

    fn read_pcm16_wav(path: &Path) -> Vec<f32> {
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
