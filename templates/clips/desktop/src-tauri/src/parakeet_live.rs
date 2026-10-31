//! Parakeet dictation that transcribes while the key is held, so the text is
//! ready moments after release. When the live pass fails, stalls or falls
//! behind, the whole recording is transcribed after release instead.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use transcribe_cpp::{CancelToken, Model};

use crate::transcribe_engine::{
    load_model, open_session, transcribe_parakeet, transcribe_parakeet_live, warm_up_parakeet,
};
use crate::whisper_speech::{DictationPass, DictationTranscript};

const SAMPLE_RATE: usize = 16_000;
/// The most audio handed to the stream at once. Each feed then covers about
/// one chunk, so a working pass shows progress at least that often.
const MAX_FEED_SAMPLES: usize = SAMPLE_RATE * 560 / 1_000;
const POLL: Duration = Duration::from_millis(20);
/// No progress for this long after release means the live pass is stuck.
const STALL_AFTER: Duration = Duration::from_secs(2);
/// More unheard audio than this at release means the live pass fell behind,
/// and one pass over the whole recording finishes sooner.
const MAX_BACKLOG_SAMPLES: usize = SAMPLE_RATE * 2;
/// How long a cancelled live pass gets to hand the model back before the
/// fallback loads a copy of its own.
const MODEL_HANDBACK_WAIT: Duration = Duration::from_millis(500);
/// The fallback transcribes long recordings in windows this long.
const FALLBACK_WINDOW_SAMPLES: usize = SAMPLE_RATE * 60;

/// `CLIPS_PARAKEET_LIVE_DEBUG=fail` makes every live pass fail on its first
/// audio, and `=stall` makes it hang once the key is released, so the
/// fallback can be tried in the real app.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DebugMode {
    Fail,
    Stall,
}

fn debug_mode(value: Option<&str>) -> Option<DebugMode> {
    match value?.trim() {
        "fail" => Some(DebugMode::Fail),
        "stall" => Some(DebugMode::Stall),
        _ => None,
    }
}

/// The capture side of a dictation: raw samples at `src_rate`, appended while
/// `running` is true.
pub(crate) struct AudioTap<'a> {
    pub buf: &'a Mutex<Vec<f32>>,
    pub src_rate: &'a AtomicU32,
    pub running: &'a AtomicBool,
}

enum Ending {
    Finished(Result<String, String>),
    Stalled,
    Behind,
}

struct LiveAudio {
    resample: Option<StreamingResample>,
    /// The whole dictation at 16 kHz, kept for the fallback.
    recording: Vec<f32>,
}

pub(crate) struct LiveDictation {
    model: Model,
    model_path: PathBuf,
    needs_warm_up: bool,
    cancel: CancelToken,
    debug: Option<DebugMode>,
    audio: Mutex<LiveAudio>,
    fed_samples: AtomicUsize,
    partials: AtomicU32,
    /// Set once a partial held words, which outweighs a silent verdict.
    heard_words: AtomicBool,
    progress_at: Mutex<Instant>,
    outcome: Mutex<Option<Result<String, String>>>,
    outcome_set: Condvar,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl LiveDictation {
    pub(crate) fn new(model: Model, model_path: PathBuf, needs_warm_up: bool) -> Self {
        Self {
            model,
            model_path,
            needs_warm_up,
            cancel: CancelToken::new(),
            debug: debug_mode(std::env::var("CLIPS_PARAKEET_LIVE_DEBUG").ok().as_deref()),
            audio: Mutex::new(LiveAudio {
                resample: None,
                recording: Vec::new(),
            }),
            fed_samples: AtomicUsize::new(0),
            partials: AtomicU32::new(0),
            heard_words: AtomicBool::new(false),
            progress_at: Mutex::new(Instant::now()),
            outcome: Mutex::new(None),
            outcome_set: Condvar::new(),
        }
    }

    /// Runs the live pass until the recording ends or the pass is cancelled.
    /// Call it on the dictation's worker thread.
    pub(crate) fn run(&self, tap: &AudioTap<'_>, mut on_partial: impl FnMut(&str)) {
        let result = self.run_live(tap, &mut on_partial);
        if let Err(error) = &result {
            if !self.cancel.is_cancelled() {
                eprintln!("[parakeet] live pass failed: {error}");
            }
        }
        *lock(&self.outcome) = Some(result);
        self.outcome_set.notify_all();
    }

    fn run_live(
        &self,
        tap: &AudioTap<'_>,
        on_partial: &mut impl FnMut(&str),
    ) -> Result<String, String> {
        if let Some(mode) = self.debug {
            eprintln!("[parakeet] CLIPS_PARAKEET_LIVE_DEBUG forces the live pass to {mode:?}");
        }
        self.note_progress();
        if self.needs_warm_up {
            warm_up_parakeet(&self.model)?;
        }
        let mut session = open_session(&self.model)?;
        session.set_cancel_token(&self.cancel);
        let mut cursor = 0;
        transcribe_parakeet_live(
            &mut session,
            || self.next_block(tap, &mut cursor),
            |text| {
                self.note_progress();
                self.partials.fetch_add(1, Ordering::Relaxed);
                if !text.is_empty() {
                    self.heard_words.store(true, Ordering::SeqCst);
                }
                on_partial(text);
            },
        )
    }

    /// The next unheard audio, waiting for capture if there is none yet.
    /// `None` once capture has stopped and everything has been heard.
    fn next_block(
        &self,
        tap: &AudioTap<'_>,
        cursor: &mut usize,
    ) -> Result<Option<Vec<f32>>, String> {
        loop {
            self.note_progress();
            if self.cancel.is_cancelled() {
                return Err("live pass cancelled".into());
            }
            if self.debug == Some(DebugMode::Fail) {
                return Err("live pass failed on purpose (CLIPS_PARAKEET_LIVE_DEBUG=fail)".into());
            }
            // Read before pulling: capture drops audio once `running` is
            // false, so a pull after that read has heard everything.
            let capturing = tap.running.load(Ordering::SeqCst);
            if !capturing && self.debug == Some(DebugMode::Stall) {
                while !self.cancel.is_cancelled() {
                    std::thread::sleep(POLL);
                }
                return Err("live pass cancelled".into());
            }
            let audio = self.pull(tap, !capturing);
            let available = audio.recording.len().saturating_sub(*cursor);
            if available > 0 {
                let take = available.min(MAX_FEED_SAMPLES);
                let block = audio.recording[*cursor..*cursor + take].to_vec();
                *cursor += take;
                self.fed_samples.store(*cursor, Ordering::SeqCst);
                return Ok(Some(block));
            }
            if !capturing {
                return Ok(None);
            }
            drop(audio);
            std::thread::sleep(POLL);
        }
    }

    /// Moves captured audio into the 16 kHz recording; `finish` also
    /// resamples the last samples, which need no later neighbour.
    fn pull(&self, tap: &AudioTap<'_>, finish: bool) -> MutexGuard<'_, LiveAudio> {
        // Holding the recording lock while emptying the capture buffer keeps
        // two pulls from appending their audio out of order.
        let mut audio = lock(&self.audio);
        let raw = std::mem::take(&mut *lock(tap.buf));
        let src_rate = tap.src_rate.load(Ordering::SeqCst) as f64;
        let LiveAudio {
            resample,
            recording,
        } = &mut *audio;
        if resample.as_ref().is_some_and(|r| !r.has_rate(src_rate)) {
            if let Some(previous) = resample.take() {
                previous.finish(recording);
            }
        }
        let current = resample.get_or_insert_with(|| StreamingResample::new(src_rate));
        current.push(&raw, recording);
        if finish {
            if let Some(current) = resample.take() {
                current.finish(recording);
            }
        }
        audio
    }

    fn note_progress(&self) {
        *lock(&self.progress_at) = Instant::now();
    }

    pub(crate) fn has_heard_words(&self) -> bool {
        self.heard_words.load(Ordering::SeqCst)
    }

    /// Stops the live pass without transcribing what is left.
    pub(crate) fn discard(&self) {
        self.cancel.cancel();
    }

    /// Waits for the live pass to end after release, and transcribes the
    /// whole recording if it fails, stalls or has fallen behind. `worker_done`
    /// turns true once the worker thread has let go of the model.
    pub(crate) fn finish(
        &self,
        tap: &AudioTap<'_>,
        released: Instant,
        worker_done: &AtomicBool,
    ) -> Result<DictationTranscript, String> {
        let backlog = {
            let audio = self.pull(tap, false);
            audio
                .recording
                .len()
                .saturating_sub(self.fed_samples.load(Ordering::SeqCst))
        };
        let finished = lock(&self.outcome).take();
        let ending = match finished {
            Some(result) => Ending::Finished(result),
            None if backlog > MAX_BACKLOG_SAMPLES => Ending::Behind,
            None => self.await_ending(released),
        };
        let fallback_reason = match ending {
            Ending::Finished(Ok(text)) => {
                return Ok(self.report(text, DictationPass::Live, released))
            }
            Ending::Finished(Err(error)) => format!("failed ({error})"),
            Ending::Stalled => "stalled".to_owned(),
            Ending::Behind => format!("fell {} ms behind", backlog * 1_000 / SAMPLE_RATE),
        };
        eprintln!("[parakeet] live pass {fallback_reason}; transcribing the whole recording");
        self.cancel.cancel();
        let recording = self.pull(tap, true).recording.clone();
        let text = self.transcribe_recording(&recording, worker_done)?;
        Ok(self.report(text, DictationPass::Fallback, released))
    }

    fn report(&self, text: String, pass: DictationPass, released: Instant) -> DictationTranscript {
        let audio_ms = (lock(&self.audio).recording.len() * 1_000 / SAMPLE_RATE) as u64;
        let release_to_text_ms = released.elapsed().as_millis() as u64;
        eprintln!(
            "[parakeet] dictation transcribed: pass={} audio_ms={audio_ms} release_to_text_ms={release_to_text_ms} partials={}",
            pass.as_str(),
            self.partials.load(Ordering::Relaxed),
        );
        DictationTranscript {
            text,
            pass,
            release_to_text_ms,
            audio_ms,
        }
    }

    fn await_ending(&self, released: Instant) -> Ending {
        let mut outcome = lock(&self.outcome);
        loop {
            if let Some(result) = outcome.take() {
                return Ending::Finished(result);
            }
            let last_progress = (*lock(&self.progress_at)).max(released);
            let idle = last_progress.elapsed();
            if idle >= STALL_AFTER {
                return Ending::Stalled;
            }
            outcome = self
                .outcome_set
                .wait_timeout(outcome, STALL_AFTER - idle)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
    }

    fn transcribe_recording(
        &self,
        samples: &[f32],
        worker_done: &AtomicBool,
    ) -> Result<String, String> {
        let deadline = Instant::now() + MODEL_HANDBACK_WAIT;
        while !worker_done.load(Ordering::SeqCst) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(10));
        }
        // A live stream holds the model until it ends, and the model refuses
        // other work meanwhile; a stuck one never hands it back.
        let model = if worker_done.load(Ordering::SeqCst) {
            self.model.clone()
        } else {
            eprintln!("[parakeet] the live pass still holds the model; loading a second copy");
            load_model(&self.model_path).map_err(|e| format!("parakeet {e}"))?
        };
        let mut session = open_session(&model)?;
        let mut parts = Vec::new();
        for window in samples.chunks(FALLBACK_WINDOW_SAMPLES) {
            for (_, _, text) in transcribe_parakeet(&mut session, window)? {
                let text = text.trim();
                if !text.is_empty() {
                    parts.push(text.to_owned());
                }
            }
        }
        Ok(parts.join(" "))
    }
}

/// Linear resampling to 16 kHz of audio that arrives in pieces. Its output
/// matches resampling the whole input at once, sample for sample.
pub(crate) struct StreamingResample {
    src_rate: f64,
    ratio: f64,
    /// Raw samples not yet fully used, starting at absolute index `raw_start`.
    raw: Vec<f32>,
    raw_start: usize,
    raw_total: usize,
    next_out: usize,
}

impl StreamingResample {
    pub(crate) fn new(src_rate: f64) -> Self {
        let src_rate = src_rate.max(1.0);
        Self {
            src_rate,
            ratio: 16_000.0 / src_rate,
            raw: Vec::new(),
            raw_start: 0,
            raw_total: 0,
            next_out: 0,
        }
    }

    pub(crate) fn has_rate(&self, src_rate: f64) -> bool {
        (self.src_rate - src_rate.max(1.0)).abs() < 0.5
    }

    fn is_passthrough(&self) -> bool {
        (self.src_rate - 16_000.0).abs() < 1.0
    }

    fn sample_at(&self, out_index: usize) -> f32 {
        let src_pos = out_index as f64 / self.ratio;
        let idx = src_pos as usize;
        let frac = (src_pos - idx as f64) as f32;
        let at = |i: usize| {
            i.checked_sub(self.raw_start)
                .and_then(|i| self.raw.get(i))
                .copied()
        };
        let a = at(idx).unwrap_or(0.0);
        let b = at(idx + 1).unwrap_or(a);
        a + (b - a) * frac
    }

    pub(crate) fn push(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if self.is_passthrough() {
            out.extend_from_slice(input);
            self.raw_total += input.len();
            self.next_out = self.raw_total;
            self.raw_start = self.raw_total;
            return;
        }
        self.raw.extend_from_slice(input);
        self.raw_total += input.len();
        let available = ((self.raw_total as f64) * self.ratio).floor() as usize;
        while self.next_out < available {
            let idx = (self.next_out as f64 / self.ratio) as usize;
            if idx + 1 >= self.raw_total {
                break;
            }
            out.push(self.sample_at(self.next_out));
            self.next_out += 1;
        }
        let needed_from =
            ((self.next_out as f64 / self.ratio) as usize).saturating_sub(self.raw_start);
        let used = needed_from.min(self.raw.len());
        self.raw.drain(..used);
        self.raw_start += used;
    }

    pub(crate) fn finish(mut self, out: &mut Vec<f32>) {
        if self.is_passthrough() {
            return;
        }
        let total = ((self.raw_total as f64) * self.ratio).floor() as usize;
        while self.next_out < total {
            out.push(self.sample_at(self.next_out));
            self.next_out += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    fn resample_at_once(input: &[f32], src_rate: f64) -> Vec<f32> {
        let mut out = Vec::new();
        let mut resample = StreamingResample::new(src_rate);
        resample.push(input, &mut out);
        resample.finish(&mut out);
        out
    }

    fn reference(input: &[f32], src_rate: f64) -> Vec<f32> {
        let ratio = 16_000.0 / src_rate;
        let len = ((input.len() as f64) * ratio).floor() as usize;
        (0..len)
            .map(|i| {
                let src_pos = i as f64 / ratio;
                let idx = src_pos as usize;
                let frac = (src_pos - idx as f64) as f32;
                let a = input.get(idx).copied().unwrap_or(0.0);
                let b = input.get(idx + 1).copied().unwrap_or(a);
                a + (b - a) * frac
            })
            .collect()
    }

    fn tone(len: usize) -> Vec<f32> {
        (0..len).map(|i| (i as f32 * 0.013).sin()).collect()
    }

    #[test]
    fn resampling_in_pieces_matches_resampling_at_once() {
        for src_rate in [48_000.0, 44_100.0, 24_000.0, 16_000.0] {
            let input = tone(10_007);
            let expected = reference(&input, src_rate);
            assert_eq!(resample_at_once(&input, src_rate), expected, "{src_rate}");
            for piece in [1, 7, 480, 1_024, 4_096] {
                let mut out = Vec::new();
                let mut resample = StreamingResample::new(src_rate);
                for chunk in input.chunks(piece) {
                    resample.push(chunk, &mut out);
                }
                resample.finish(&mut out);
                assert_eq!(out, expected, "{src_rate} Hz in pieces of {piece}");
            }
        }
    }

    #[test]
    fn resampling_keeps_only_the_samples_it_still_needs() {
        let mut out = Vec::new();
        let mut resample = StreamingResample::new(48_000.0);
        for chunk in tone(48_000).chunks(480) {
            resample.push(chunk, &mut out);
            assert!(resample.raw.len() <= 480 + 3, "kept {}", resample.raw.len());
        }
    }

    #[test]
    fn the_debug_switch_accepts_only_its_two_modes() {
        assert_eq!(debug_mode(Some("fail")), Some(DebugMode::Fail));
        assert_eq!(debug_mode(Some(" stall\n")), Some(DebugMode::Stall));
        assert_eq!(debug_mode(Some("1")), None);
        assert_eq!(debug_mode(None), None);
    }

    /// Plays a WAV into a dictation at real-time pace, once per mode: live,
    /// live failing, live stalling. Run with `CLIPS_TEST_PARAKEET_MODEL=<gguf>
    /// CLIPS_TEST_PARAKEET_WAV=<16 kHz mono 16-bit wav> cargo test --lib
    /// parakeet_live -- --ignored --nocapture`.
    #[test]
    #[ignore = "needs the Parakeet model and a WAV file"]
    fn a_dictation_falls_back_to_the_whole_recording_when_the_live_pass_breaks() {
        let model_path = PathBuf::from(
            std::env::var("CLIPS_TEST_PARAKEET_MODEL").expect("set CLIPS_TEST_PARAKEET_MODEL"),
        );
        let wav = std::env::var("CLIPS_TEST_PARAKEET_WAV").expect("set CLIPS_TEST_PARAKEET_WAV");
        let speech = crate::transcribe_engine::tests::read_pcm16_wav(std::path::Path::new(&wav));
        let speech = &speech[..speech.len().min(SAMPLE_RATE * 12)];
        // Capture runs at 48 kHz, so the resampler is part of the test.
        let captured: Vec<f32> = (0..speech.len() * 3)
            .map(|i| {
                let a = speech[i / 3];
                let b = speech.get(i / 3 + 1).copied().unwrap_or(a);
                a + (b - a) * (i % 3) as f32 / 3.0
            })
            .collect();
        let model = load_model(&model_path).unwrap();
        warm_up_parakeet(&model).unwrap();

        for (debug, expected_pass) in [
            (None, DictationPass::Live),
            (Some(DebugMode::Fail), DictationPass::Fallback),
            (Some(DebugMode::Stall), DictationPass::Fallback),
        ] {
            let mut live = LiveDictation::new(model.clone(), model_path.clone(), false);
            live.debug = debug;
            let live = Arc::new(live);
            let buf = Arc::new(Mutex::new(Vec::new()));
            let src_rate = Arc::new(AtomicU32::new(48_000));
            let running = Arc::new(AtomicBool::new(true));
            let done = Arc::new(AtomicBool::new(false));
            let worker = {
                let (live, buf, src_rate, running, done) = (
                    live.clone(),
                    buf.clone(),
                    src_rate.clone(),
                    running.clone(),
                    done.clone(),
                );
                std::thread::spawn(move || {
                    let tap = AudioTap {
                        buf: &buf,
                        src_rate: &src_rate,
                        running: &running,
                    };
                    live.run(&tap, |_| {});
                    done.store(true, Ordering::SeqCst);
                })
            };

            let started = Instant::now();
            for (i, block) in captured.chunks(480).enumerate() {
                let due = started + Duration::from_millis(10 * i as u64);
                std::thread::sleep(due.saturating_duration_since(Instant::now()));
                lock(&buf).extend_from_slice(block);
            }
            running.store(false, Ordering::SeqCst);
            let tap = AudioTap {
                buf: &buf,
                src_rate: &src_rate,
                running: &running,
            };
            let transcript = live.finish(&tap, Instant::now(), &done).unwrap();
            worker.join().unwrap();

            eprintln!(
                "{debug:?}: {} pass, {} ms of audio, text {} ms after release: {}",
                transcript.pass.as_str(),
                transcript.audio_ms,
                transcript.release_to_text_ms,
                transcript.text
            );
            assert_eq!(transcript.pass, expected_pass, "{debug:?}");
            assert!(!transcript.text.is_empty(), "{debug:?}");
            assert_eq!(
                transcript.audio_ms,
                (speech.len() * 1_000 / SAMPLE_RATE) as u64
            );
        }
    }
}
