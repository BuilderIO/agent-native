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
            ..WhisperRunOptions::default()
        })),
        ..RunOptions::default()
    };
    let transcript = match session.run(samples, &options) {
        Ok(transcript) => transcript,
        // The decoder stopped early on a looping or overlong window. What came
        // before it is real speech, so keep it rather than drop the utterance.
        Err(
            Error::OutputRepetition {
                partial: Some(partial),
                message,
            }
            | Error::OutputTruncated {
                partial: Some(partial),
                message,
            },
        ) => {
            eprintln!("[transcribe] keeping the transcript before an early stop: {message}");
            *partial
        }
        Err(e) => return Err(format!("whisper inference failed: {e}")),
    };
    Ok(transcript
        .segments
        .into_iter()
        .map(|segment| (segment.t0_ms, segment.t1_ms, segment.text))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Transcribes a real recording with a downloaded model. Run with
    /// `CLIPS_TEST_WHISPER_MODEL=<model .gguf> CLIPS_TEST_WHISPER_WAV=<16 kHz
    /// mono 16-bit .wav> cargo test --lib transcribe_engine -- --ignored`.
    #[test]
    #[ignore = "needs a downloaded Whisper model and a WAV file"]
    fn transcribes_a_wav_file_with_a_downloaded_whisper_model() {
        let model_path = std::env::var("CLIPS_TEST_WHISPER_MODEL")
            .expect("set CLIPS_TEST_WHISPER_MODEL to a Whisper model file");
        let wav_path = std::env::var("CLIPS_TEST_WHISPER_WAV")
            .expect("set CLIPS_TEST_WHISPER_WAV to a 16 kHz mono 16-bit WAV");
        let samples = read_pcm16_wav(Path::new(&wav_path));

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
            "[{}] {:.1}s of audio in {} ms: {text}",
            model.backend(),
            samples.len() as f32 / 16_000.0,
            started.elapsed().as_millis()
        );

        assert!(!text.is_empty());
        let audio_ms = samples.len() as i64 * 1000 / 16_000;
        for (start_ms, end_ms, _) in &segments {
            assert!(0 <= *start_ms && start_ms <= end_ms && *end_ms <= audio_ms + 1000);
        }
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
