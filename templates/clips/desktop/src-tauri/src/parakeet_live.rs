//! Parakeet dictation that transcribes while the key is held, so the text is
//! ready moments after release. When the live pass fails, stalls or falls
//! behind, the whole recording is transcribed after release instead.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use transcribe_cpp::CancelToken;

use crate::transcribe_engine::{
    open_session, transcribe_parakeet, transcribe_parakeet_live, ModelSlot, StreamLease,
    LOCAL_MODEL,
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

/// What `finish` returns when the user cancelled the dictation: an error, so a
/// cancelled run can never pass for one that heard nothing.
pub(crate) const DISCARDED: &str = "parakeet-dictation-discarded";

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
    Discarded,
}

struct LiveAudio {
    resample: Option<StreamingResample>,
    /// The whole dictation at 16 kHz, kept for the fallback.
    recording: Vec<f32>,
}

pub(crate) struct LiveDictation {
    /// The model, lent to this dictation's live stream alone. The worker
    /// drops it as it ends, which is what hands the model back.
    lease: Mutex<Option<StreamLease>>,
    /// Where the whole-recording pass gets its model.
    slot: &'static ModelSlot,
    model_path: PathBuf,
    /// Ends the live pass.
    stop_live: CancelToken,
    /// Set when the user cancels: it ends the live pass and the fallback, and
    /// `finish` transcribes nothing.
    discarded: CancelToken,
    debug: Option<DebugMode>,
    audio: Mutex<LiveAudio>,
    fed_samples: AtomicUsize,
    partials: AtomicU32,
    progress_at: Mutex<Instant>,
    outcome: Mutex<Option<Result<String, String>>>,
    outcome_set: Condvar,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl LiveDictation {
    /// `lease` must hold a model that has warmed up.
    pub(crate) fn new(lease: StreamLease, model_path: PathBuf) -> Self {
        Self {
            lease: Mutex::new(Some(lease)),
            slot: &LOCAL_MODEL,
            model_path,
            stop_live: CancelToken::new(),
            discarded: CancelToken::new(),
            debug: debug_mode(std::env::var("CLIPS_PARAKEET_LIVE_DEBUG").ok().as_deref()),
            audio: Mutex::new(LiveAudio {
                resample: None,
                recording: Vec::new(),
            }),
            fed_samples: AtomicUsize::new(0),
            partials: AtomicU32::new(0),
            progress_at: Mutex::new(Instant::now()),
            outcome: Mutex::new(None),
            outcome_set: Condvar::new(),
        }
    }

    /// Runs the live pass until the recording ends or the pass is cancelled.
    /// Call it on the dictation's worker thread.
    pub(crate) fn run(&self, tap: &AudioTap<'_>, mut on_partial: impl FnMut(&str)) {
        let lease = lock(&self.lease).take();
        let result = match &lease {
            Some(lease) => self.run_live(lease, tap, &mut on_partial),
            None => Err("the live pass ran twice".to_owned()),
        };
        // Hand the model back before reporting, so a fallback woken by the
        // outcome finds it free.
        drop(lease);
        if let Err(error) = &result {
            if !self.stop_live.is_cancelled() {
                eprintln!("[parakeet] live pass failed: {error}");
            }
        }
        *lock(&self.outcome) = Some(result);
        self.outcome_set.notify_all();
    }

    fn run_live(
        &self,
        lease: &StreamLease,
        tap: &AudioTap<'_>,
        on_partial: &mut impl FnMut(&str),
    ) -> Result<String, String> {
        if let Some(mode) = self.debug {
            eprintln!("[parakeet] CLIPS_PARAKEET_LIVE_DEBUG forces the live pass to {mode:?}");
        }
        self.note_progress();
        let mut session = open_session(lease.model())?;
        session.set_cancel_token(&self.stop_live);
        let mut cursor = 0;
        transcribe_parakeet_live(
            &mut session,
            || self.next_block(tap, &mut cursor),
            |text| {
                self.note_progress();
                self.partials.fetch_add(1, Ordering::Relaxed);
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
            if self.stop_live.is_cancelled() {
                return Err("live pass cancelled".into());
            }
            if self.debug == Some(DebugMode::Fail) {
                return Err("live pass failed on purpose (CLIPS_PARAKEET_LIVE_DEBUG=fail)".into());
            }
            // Read before pulling: capture drops audio once `running` is
            // false, so a pull after that read has heard everything.
            let capturing = tap.running.load(Ordering::SeqCst);
            if !capturing && self.debug == Some(DebugMode::Stall) {
                while !self.stop_live.is_cancelled() {
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

    /// Drops the dictation: the live pass stops, and a `finish` already
    /// waiting on it, or already transcribing the whole recording, returns
    /// [`DISCARDED`] instead of text.
    pub(crate) fn discard(&self) {
        self.discarded.cancel();
        self.stop_live.cancel();
        // Taking the lock orders this wake-up after `finish` checks the flag,
        // so it can't be missed.
        let _outcome = lock(&self.outcome);
        self.outcome_set.notify_all();
    }

    fn is_discarded(&self) -> bool {
        self.discarded.is_cancelled()
    }

    /// Waits for the live pass to end after release, and transcribes the
    /// whole recording if it fails, stalls or has fallen behind.
    pub(crate) fn finish(
        &self,
        tap: &AudioTap<'_>,
        released: Instant,
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
            _ if self.is_discarded() => Ending::Discarded,
            Some(result) => Ending::Finished(result),
            None if backlog > MAX_BACKLOG_SAMPLES => Ending::Behind,
            None => self.await_ending(released),
        };
        let fallback_reason = match ending {
            Ending::Discarded => return Err(DISCARDED.to_owned()),
            Ending::Finished(Ok(text)) => {
                return Ok(self.report(text, DictationPass::Live, released))
            }
            Ending::Finished(Err(error)) => format!("failed ({error})"),
            Ending::Stalled => "stalled".to_owned(),
            Ending::Behind => format!("fell {} ms behind", backlog * 1_000 / SAMPLE_RATE),
        };
        eprintln!("[parakeet] live pass {fallback_reason}; transcribing the whole recording");
        self.stop_live.cancel();
        let recording = self.pull(tap, true).recording.clone();
        let text = self.transcribe_recording(&recording)?;
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
            if self.is_discarded() {
                return Ending::Discarded;
            }
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

    /// One offline run over the whole recording. transcribe.cpp cuts long
    /// audio at pauses itself, so no word is split at a fixed window edge.
    fn transcribe_recording(&self, samples: &[f32]) -> Result<String, String> {
        // The slot hands over a copy only once no live stream holds it, and
        // retires one a stuck stream never gives back.
        let (model, loaded) = self
            .slot
            .get_or_load(&self.model_path)
            .map_err(|e| format!("parakeet {e}"))?;
        if loaded {
            eprintln!("[parakeet] loaded a fresh copy for the whole-recording pass");
        }
        let mut session = open_session(&model)?;
        session.set_cancel_token(&self.discarded);
        let result = transcribe_parakeet(&mut session, samples);
        if self.is_discarded() {
            return Err(DISCARDED.to_owned());
        }
        Ok(result?
            .into_iter()
            .map(|(_, _, text)| text.trim().to_owned())
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join(" "))
    }
}

/// Linear resampling to 16 kHz of audio that arrives in pieces. Its output
/// matches resampling the whole input at once, sample for sample.
struct StreamingResample {
    src_rate: f64,
    ratio: f64,
    /// Raw samples not yet fully used, starting at absolute index `raw_start`.
    raw: Vec<f32>,
    raw_start: usize,
    raw_total: usize,
    next_out: usize,
}

impl StreamingResample {
    fn new(src_rate: f64) -> Self {
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

    fn has_rate(&self, src_rate: f64) -> bool {
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

    fn push(&mut self, input: &[f32], out: &mut Vec<f32>) {
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

    fn finish(mut self, out: &mut Vec<f32>) {
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

    use crate::transcribe_engine::tests::{read_pcm16_wav, test_env, word_error_rate};
    use crate::transcribe_engine::{load_model, warm_up_parakeet};

    /// A dictation's capture, played into it from a thread like the mic would.
    struct Capture {
        buf: Arc<Mutex<Vec<f32>>>,
        src_rate: Arc<AtomicU32>,
        running: Arc<AtomicBool>,
    }

    impl Capture {
        fn new() -> Self {
            Self {
                buf: Arc::new(Mutex::new(Vec::new())),
                src_rate: Arc::new(AtomicU32::new(48_000)),
                running: Arc::new(AtomicBool::new(true)),
            }
        }

        fn tap(&self) -> AudioTap<'_> {
            AudioTap {
                buf: &self.buf,
                src_rate: &self.src_rate,
                running: &self.running,
            }
        }
    }

    /// Starts `live`'s worker on its own thread, as the app does.
    fn spawn_worker(live: &Arc<LiveDictation>, capture: &Capture) -> std::thread::JoinHandle<()> {
        let live = live.clone();
        let (buf, src_rate, running) = (
            capture.buf.clone(),
            capture.src_rate.clone(),
            capture.running.clone(),
        );
        std::thread::spawn(move || {
            let tap = AudioTap {
                buf: &buf,
                src_rate: &src_rate,
                running: &running,
            };
            live.run(&tap, |_| {});
        })
    }

    /// 16 kHz speech upsampled to the 48 kHz capture runs at, so the
    /// resampler is part of every test.
    fn as_captured(speech: &[f32]) -> Vec<f32> {
        (0..speech.len() * 3)
            .map(|i| {
                let a = speech[i / 3];
                let b = speech.get(i / 3 + 1).copied().unwrap_or(a);
                a + (b - a) * (i % 3) as f32 / 3.0
            })
            .collect()
    }

    /// Feeds 48 kHz audio in 10 ms blocks, `speed` times faster than real
    /// time, then releases the key.
    fn speak(capture: &Capture, captured: &[f32], speed: u64) {
        let started = Instant::now();
        for (i, block) in captured.chunks(480).enumerate() {
            let due = started + Duration::from_micros(10_000 * i as u64 / speed);
            std::thread::sleep(due.saturating_duration_since(Instant::now()));
            lock(&capture.buf).extend_from_slice(block);
        }
        capture.running.store(false, Ordering::SeqCst);
    }

    struct TestModel {
        slot: &'static ModelSlot,
        path: PathBuf,
        speech: Vec<f32>,
        reference: String,
    }

    /// The Parakeet model warmed up in a slot of the test's own, and the
    /// recording and reference text the tests play. See
    /// `CLIPS_TEST_PARAKEET_*` in the tests' doc comments.
    fn test_model() -> TestModel {
        load_test_model("CLIPS_TEST_PARAKEET_WAV", "CLIPS_TEST_PARAKEET_TEXT")
    }

    fn load_test_model(wav: &str, text: &str) -> TestModel {
        let slot: &'static ModelSlot = Box::leak(Box::new(ModelSlot::new(load_model)));
        let path = PathBuf::from(test_env("CLIPS_TEST_PARAKEET_MODEL"));
        let lease = slot.lease_for_stream(&path).unwrap();
        warm_up_parakeet(lease.model()).unwrap();
        lease.mark_warm();
        TestModel {
            slot,
            path,
            speech: read_pcm16_wav(std::path::Path::new(&test_env(wav))),
            reference: test_env(text),
        }
    }

    impl Drop for TestModel {
        fn drop(&mut self) {
            self.slot.clear();
        }
    }

    impl TestModel {
        fn dictation(&self, debug: Option<DebugMode>) -> Arc<LiveDictation> {
            let lease = self.slot.try_lease_warm(&self.path).unwrap();
            let mut live = LiveDictation::new(lease, self.path.clone());
            live.slot = self.slot;
            live.debug = debug;
            Arc::new(live)
        }
    }

    /// Plays the recording into a dictation at real-time pace, once per mode:
    /// live, live failing, live stalling. Every pass must return the words
    /// the recording says. Run with `CLIPS_TEST_PARAKEET_MODEL=<gguf>
    /// CLIPS_TEST_PARAKEET_WAV=<16 kHz mono 16-bit wav>
    /// CLIPS_TEST_PARAKEET_TEXT=<what it says> cargo test --release --lib
    /// parakeet_live -- --ignored --nocapture --test-threads=1`. Prints
    /// timings and word error rates, never the text.
    #[test]
    #[ignore = "needs the Parakeet model and a WAV file"]
    fn a_dictation_falls_back_to_the_whole_recording_when_the_live_pass_breaks() {
        let model = test_model();
        let captured = as_captured(&model.speech);

        for (debug, expected_pass) in [
            (None, DictationPass::Live),
            (Some(DebugMode::Fail), DictationPass::Fallback),
            (Some(DebugMode::Stall), DictationPass::Fallback),
        ] {
            let live = model.dictation(debug);
            let capture = Capture::new();
            let worker = spawn_worker(&live, &capture);
            speak(&capture, &captured, 1);
            let transcript = live.finish(&capture.tap(), Instant::now()).unwrap();
            worker.join().unwrap();

            let wer = word_error_rate(&model.reference, &transcript.text);
            eprintln!(
                "{debug:?}: {} pass, {} ms of audio, text {} ms after release, WER {:.1}%",
                transcript.pass.as_str(),
                transcript.audio_ms,
                transcript.release_to_text_ms,
                wer * 100.0
            );
            assert_eq!(transcript.pass, expected_pass, "{debug:?}");
            assert!(wer <= 0.05, "{debug:?}: WER {wer:.3}");
            assert_eq!(
                transcript.audio_ms,
                (model.speech.len() * 1_000 / SAMPLE_RATE) as u64
            );
        }
    }

    /// Dictation A stalls after release and is cancelled while it waits; B
    /// starts right after and is released half a second later, well before
    /// A's stall would have been noticed. B must get its own words. Uses the
    /// same variables as the test above.
    #[test]
    #[ignore = "needs the Parakeet model and a WAV file"]
    fn cancelling_a_finalizing_dictation_leaves_the_model_free_for_the_next() {
        let model = test_model();
        let captured = as_captured(&model.speech);

        let a = model.dictation(Some(DebugMode::Stall));
        let a_capture = Capture::new();
        let a_worker = spawn_worker(&a, &a_capture);
        speak(&a_capture, &captured[..captured.len().min(48_000 * 2)], 4);
        let a_finish = {
            let (a, buf, src_rate, running) = (
                a.clone(),
                a_capture.buf.clone(),
                a_capture.src_rate.clone(),
                a_capture.running.clone(),
            );
            std::thread::spawn(move || {
                let tap = AudioTap {
                    buf: &buf,
                    src_rate: &src_rate,
                    running: &running,
                };
                a.finish(&tap, Instant::now()).map(|t| t.text)
            })
        };
        std::thread::sleep(Duration::from_millis(200));
        let cancelled = Instant::now();
        a.discard();
        // Matched rather than compared so a failure can't print the text.
        match a_finish.join().unwrap() {
            Err(error) => assert_eq!(error, DISCARDED),
            Ok(_) => panic!("the cancelled dictation returned a transcript"),
        }
        a_worker.join().unwrap();
        eprintln!(
            "A: discarded {} ms after the cancel",
            cancelled.elapsed().as_millis()
        );

        let b = model.dictation(None);
        let b_capture = Capture::new();
        let b_worker = spawn_worker(&b, &b_capture);
        speak(&b_capture, &captured, 1);
        let transcript = b.finish(&b_capture.tap(), Instant::now()).unwrap();
        b_worker.join().unwrap();
        let wer = word_error_rate(&model.reference, &transcript.text);
        eprintln!(
            "B: {} pass, text {} ms after release, WER {:.1}%",
            transcript.pass.as_str(),
            transcript.release_to_text_ms,
            wer * 100.0
        );
        assert_eq!(transcript.pass, DictationPass::Live);
        assert!(wer <= 0.05, "WER {wer:.3}");
    }

    /// A live pass stuck for good never hands its copy back. The next
    /// dictation is told the model isn't ready (it dictates with Apple
    /// Speech), the reload retires the stuck copy, and the one after runs on
    /// a fresh copy. Uses the same variables as the tests above.
    #[test]
    #[ignore = "needs the Parakeet model and a WAV file"]
    fn a_stuck_live_pass_is_retired_instead_of_blocking_later_dictations() {
        let model = test_model();
        let captured = as_captured(&model.speech);
        let stuck = model.slot.try_lease_warm(&model.path).unwrap();

        assert_eq!(
            model.slot.try_lease_warm(&model.path).err(),
            Some(crate::transcribe_engine::LeaseRefused::InUse)
        );
        let started = Instant::now();
        let fresh = model.slot.lease_for_stream(&model.path).unwrap();
        assert!(!fresh.is_warm());
        warm_up_parakeet(fresh.model()).unwrap();
        fresh.mark_warm();
        drop(fresh);
        eprintln!(
            "reload after a stuck pass: {} ms",
            started.elapsed().as_millis()
        );

        let next = model.dictation(None);
        let capture = Capture::new();
        let worker = spawn_worker(&next, &capture);
        speak(&capture, &captured, 1);
        let transcript = next.finish(&capture.tap(), Instant::now()).unwrap();
        worker.join().unwrap();
        let wer = word_error_rate(&model.reference, &transcript.text);
        eprintln!(
            "next dictation: {} pass, WER {:.1}%",
            transcript.pass.as_str(),
            wer * 100.0
        );
        assert!(wer <= 0.05, "WER {wer:.3}");
        drop(stuck);
    }

    /// The whole-recording pass on a recording longer than a minute, with a
    /// word spoken across the 60 s mark, must keep every word there; cutting
    /// the audio into fixed one-minute windows loses or repeats words at the
    /// cut. Run with `CLIPS_TEST_PARAKEET_LONG_WAV=<16 kHz mono 16-bit wav
    /// over 60 s> CLIPS_TEST_PARAKEET_LONG_TEXT=<what it says>` and the model
    /// variable above. Prints timings and word error rates, never the text.
    #[test]
    #[ignore = "needs the Parakeet model and a recording over a minute long"]
    fn the_whole_recording_pass_keeps_the_words_across_the_minute_mark() {
        let model = load_test_model(
            "CLIPS_TEST_PARAKEET_LONG_WAV",
            "CLIPS_TEST_PARAKEET_LONG_TEXT",
        );
        assert!(
            model.speech.len() > SAMPLE_RATE * 60,
            "the recording must pass 60 s"
        );
        let live = model.dictation(None);
        // The lease is never used for a live pass here; dropping it hands
        // the model to the whole-recording pass.
        drop(lock(&live.lease).take());

        let started = Instant::now();
        let text = live.transcribe_recording(&model.speech).unwrap();
        let wer = word_error_rate(&model.reference, &text);
        eprintln!(
            "whole recording: {:.1}s of audio in {} ms, WER {:.1}%",
            model.speech.len() as f64 / SAMPLE_RATE as f64,
            started.elapsed().as_millis(),
            wer * 100.0
        );
        assert!(wer <= 0.01, "WER {wer:.3}");
    }
}
