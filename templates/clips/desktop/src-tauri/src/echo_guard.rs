//! Speaker-bleed detection for the meeting microphone stream.
//!
//! Without headphones the microphone re-records whatever the speakers play, so
//! the remote side reaches Whisper twice: once cleanly on the system stream and
//! once, mangled, on the mic. Downstream text de-duplication can only catch the
//! copies that happen to transcribe alike, and echo is exactly the audio
//! Whisper transcribes worst — so the leak is cut here instead. Mic audio whose
//! loudness envelope tracks the system-audio envelope at a constant delay is
//! playback bleed, not speech, and never reaches inference.
//!
//! Dropping real speech is far worse here than letting echo through, so the
//! gate is built to fail open:
//!   - With headphones the reference is just as loud but uncorrelated with the
//!     mic, so it stays open without any output-device detection.
//!   - During double-talk the user's own voice is energy the reference cannot
//!     explain, which breaks the correlation and keeps the utterance.
//!   - The verdict is taken per one-second window and every window has to
//!     agree, so a single sentence of the user's cannot be outvoted by the
//!     minute of remote speech it interrupted.
//!
//! Envelopes, not waveforms: the speaker→mic path adds room reverb, clipping,
//! and device resampling that destroy sample-level correlation but leave the
//! loudness contour intact.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Envelope resolution. Short enough to follow syllables, long enough that a
/// capture buffer lands in one or two frames.
const FRAME_MS: u64 = 20;
/// Longest speaker→microphone round trip we search for. Covers output device
/// buffering plus room propagation.
const MAX_ECHO_DELAY_MS: u64 = 400;
/// Playback older than this can never explain a mic utterance we are about to
/// finalize, so the reference ring never needs to grow past it.
const REFERENCE_RETENTION: Duration = Duration::from_secs(30);
/// An utterance is judged one window at a time rather than as a whole, and is
/// only suppressed when every window is echo. Whisper keeps buffering until it
/// hears a pause, so an utterance can run for tens of seconds — long enough
/// that a whole-buffer verdict would let a wall of remote speech outvote the
/// second in which the user cut in. One second is the shortest window whose
/// envelope still carries enough syllables to correlate.
const WINDOW_FRAMES: usize = 1000 / FRAME_MS as usize;
/// A window with less speech than this has nothing to explain, so it neither
/// confirms nor denies echo.
const MIN_VOICED_FRAMES: usize = 100 / FRAME_MS as usize;
/// Mic frames quieter than this are not speech and do not need explaining.
/// Matches the whisper worker's own voice-activity threshold.
const VOICED_RMS: f32 = 0.006;
/// Reference frames quieter than this count as "nothing was playing".
const PLAYBACK_RMS: f32 = 0.002;
/// Share of voiced mic frames that must coincide with playback. A single
/// stretch of the user talking into silence drops the utterance below this.
const MIN_COVERAGE: f32 = 0.9;
/// Pearson correlation of the two dB envelopes at the best delay.
const MIN_CORRELATION: f32 = 0.7;
/// Both envelopes must actually vary, otherwise correlation is measuring noise
/// between two near-constant lines. Steady background playback fails this and
/// the utterance is kept.
const MIN_DB_DEVIATION: f32 = 3.0;

const MAX_LAG_FRAMES: usize = MAX_ECHO_DELAY_MS as usize / FRAME_MS as usize;

/// Loudness of one capture buffer, kept with the wall-clock window it covers so
/// mic and system streams can be aligned without a shared sample clock.
#[derive(Clone, Copy)]
struct ReferenceSpan {
    start: Instant,
    end: Instant,
    rms: f32,
}

/// Rolling record of what the speakers have been playing.
pub(crate) struct EchoGuard {
    spans: Mutex<VecDeque<ReferenceSpan>>,
}

impl EchoGuard {
    pub(crate) fn new() -> Self {
        Self {
            spans: Mutex::new(VecDeque::new()),
        }
    }

    /// Record one system-audio capture buffer. Called from the realtime audio
    /// callback: one pass over the samples, one push, no allocation beyond the
    /// ring's amortized growth.
    pub(crate) fn note_playback(&self, samples: &[f32], src_rate: f64) {
        if samples.is_empty() || src_rate <= 0.0 {
            return;
        }
        let end = Instant::now();
        let duration = Duration::from_secs_f64(samples.len() as f64 / src_rate);
        let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
        let mut spans = self
            .spans
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        spans.push_back(ReferenceSpan {
            start: end.checked_sub(duration).unwrap_or(end),
            end,
            rms,
        });
        while spans
            .front()
            .is_some_and(|span| end.saturating_duration_since(span.end) > REFERENCE_RETENTION)
        {
            spans.pop_front();
        }
    }

    /// Whether `samples` (16 kHz mono, captured starting at `buffer_start`) is
    /// the speakers bleeding back into the microphone rather than speech.
    pub(crate) fn is_playback_echo(&self, samples: &[f32], buffer_start: Instant) -> bool {
        let mic = envelope_16k(samples);
        if mic.len() < WINDOW_FRAMES {
            return false;
        }
        // The reference has to start MAX_LAG_FRAMES early so every candidate
        // delay has real playback to line up against.
        let lag = Duration::from_millis(MAX_LAG_FRAMES as u64 * FRAME_MS);
        let reference_start = buffer_start.checked_sub(lag).unwrap_or(buffer_start);
        let reference = self.reference_envelope(reference_start, mic.len() + MAX_LAG_FRAMES);
        is_echo(&mic, &reference)
    }

    /// Sample the playback envelope onto the same `FRAME_MS` grid the mic uses,
    /// taking the loudest overlapping span for each frame.
    fn reference_envelope(&self, from: Instant, frames: usize) -> Vec<f32> {
        let mut envelope = vec![0.0f32; frames];
        let spans: Vec<ReferenceSpan> = {
            let spans = self
                .spans
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            spans.iter().copied().collect()
        };
        let frame = Duration::from_millis(FRAME_MS);
        let until = from + frame * frames as u32;
        for span in spans {
            if span.end <= from || span.start >= until {
                continue;
            }
            let first = span.start.saturating_duration_since(from).as_nanos() / frame.as_nanos();
            let end = span.end.saturating_duration_since(from).as_nanos();
            let end_exclusive = end.div_ceil(frame.as_nanos());
            for slot in envelope
                .iter_mut()
                .take((end_exclusive as usize).min(frames))
                .skip((first as usize).min(frames))
            {
                *slot = slot.max(span.rms);
            }
        }
        envelope
    }
}

/// Per-frame RMS of 16 kHz mono samples. A trailing partial frame is dropped —
/// its loudness is not comparable to a full one.
fn envelope_16k(samples: &[f32]) -> Vec<f32> {
    let frame = (16_000 * FRAME_MS as usize) / 1000;
    samples
        .chunks_exact(frame)
        .map(|chunk| (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len() as f32).sqrt())
        .collect()
}

/// Decide whether `mic` is playback bleed. `reference` is the playback envelope
/// on the same grid but starting `MAX_LAG_FRAMES` earlier, so a window of `mic`
/// at offset `o` is judged against `reference[o..o + WINDOW_FRAMES + lag]`.
///
/// Every speech-carrying window has to look like echo. One window that does not
/// keeps the whole utterance, because that window is the user talking.
///
/// Split out from `EchoGuard` so the decision is testable without audio devices
/// or wall-clock timing.
fn is_echo(mic: &[f32], reference: &[f32]) -> bool {
    if mic.len() < WINDOW_FRAMES || reference.len() < mic.len() + MAX_LAG_FRAMES {
        return false;
    }
    let mut judged = 0u32;
    for offset in window_offsets(mic.len()) {
        let window = &mic[offset..offset + WINDOW_FRAMES];
        if window.iter().filter(|&&level| level > VOICED_RMS).count() < MIN_VOICED_FRAMES {
            continue;
        }
        judged += 1;
        let reference = &reference[offset..offset + WINDOW_FRAMES + MAX_LAG_FRAMES];
        if !meets_echo_thresholds(
            playback_coverage(window, reference),
            best_delay_correlation(window, reference),
        ) {
            return false;
        }
    }
    judged > 0
}

/// Window start frames covering all of `frames`. The last window is anchored to
/// the end rather than dropped, so speech in a trailing part-window — a "hang
/// on, actually" right before the pause that ended the utterance — is still
/// judged on its own instead of inheriting the verdict of the echo before it.
fn window_offsets(frames: usize) -> Vec<usize> {
    let Some(last) = frames.checked_sub(WINDOW_FRAMES) else {
        return Vec::new();
    };
    let mut offsets: Vec<usize> = (0..=last).step_by(WINDOW_FRAMES).collect();
    if offsets.last() != Some(&last) {
        offsets.push(last);
    }
    offsets
}

fn meets_echo_thresholds(coverage: f32, correlation: f32) -> bool {
    coverage >= MIN_COVERAGE && correlation >= MIN_CORRELATION
}

/// Share of the mic's voiced frames that had playback somewhere inside the echo
/// delay window. Voice arriving while the speakers were silent cannot be echo.
fn playback_coverage(mic: &[f32], reference: &[f32]) -> f32 {
    let mut voiced = 0u32;
    let mut covered = 0u32;
    for (i, &level) in mic.iter().enumerate() {
        if level <= VOICED_RMS {
            continue;
        }
        voiced += 1;
        if reference[i..=i + MAX_LAG_FRAMES]
            .iter()
            .any(|&r| r > PLAYBACK_RMS)
        {
            covered += 1;
        }
    }
    if voiced == 0 {
        return 0.0;
    }
    covered as f32 / voiced as f32
}

/// Best Pearson correlation between the mic and reference dB envelopes across
/// every candidate echo delay.
fn best_delay_correlation(mic: &[f32], reference: &[f32]) -> f32 {
    let mic_db: Vec<f32> = mic.iter().copied().map(decibels).collect();
    let reference_db: Vec<f32> = reference.iter().copied().map(decibels).collect();
    (0..=MAX_LAG_FRAMES)
        .map(|delay| {
            let offset = MAX_LAG_FRAMES - delay;
            correlation(&mic_db, &reference_db[offset..offset + mic_db.len()])
        })
        .fold(0.0f32, f32::max)
}

fn decibels(rms: f32) -> f32 {
    20.0 * rms.max(1e-6).log10()
}

/// Pearson correlation, or 0 when either series is too flat to correlate
/// meaningfully.
fn correlation(left: &[f32], right: &[f32]) -> f32 {
    let n = left.len() as f32;
    let left_mean = left.iter().sum::<f32>() / n;
    let right_mean = right.iter().sum::<f32>() / n;
    let mut covariance = 0.0f32;
    let mut left_variance = 0.0f32;
    let mut right_variance = 0.0f32;
    for (&l, &r) in left.iter().zip(right) {
        let l = l - left_mean;
        let r = r - right_mean;
        covariance += l * r;
        left_variance += l * l;
        right_variance += r * r;
    }
    let left_deviation = (left_variance / n).sqrt();
    let right_deviation = (right_variance / n).sqrt();
    if left_deviation < MIN_DB_DEVIATION || right_deviation < MIN_DB_DEVIATION {
        return 0.0;
    }
    covariance / (n * left_deviation * right_deviation)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FRAMES: usize = 150;
    const DELAY: usize = 5;

    /// Speech-like envelope: alternating loud and quiet stretches.
    fn speech(frames: usize, seed: usize) -> Vec<f32> {
        (0..frames)
            .map(|i| {
                let phase = (i + seed * 7) % 40;
                if phase < 24 {
                    0.02 + 0.02 * ((i * (seed + 3)) % 5) as f32 / 5.0
                } else {
                    0.0005
                }
            })
            .collect()
    }

    /// Place `mic` inside a reference track delayed by `DELAY` frames and
    /// attenuated the way a speaker→mic path attenuates.
    fn reference_echoing(mic: &[f32], gain: f32) -> Vec<f32> {
        let mut reference = vec![0.0f32; mic.len() + MAX_LAG_FRAMES];
        for (i, &level) in mic.iter().enumerate() {
            reference[i + MAX_LAG_FRAMES - DELAY] = level / gain;
        }
        reference
    }

    #[test]
    fn speaker_bleed_is_detected_as_echo() {
        let mic = speech(FRAMES, 1);
        let reference = reference_echoing(&mic, 8.0);
        assert!(is_echo(&mic, &reference));
    }

    #[test]
    fn headphones_keep_the_utterance_even_though_playback_is_loud() {
        // Reference is continuously loud (remote side talking into the user's
        // headphones) but its contour is unrelated to the mic.
        let mic = speech(FRAMES, 1);
        let mut reference = vec![0.0f32; mic.len() + MAX_LAG_FRAMES];
        for (i, level) in speech(reference.len(), 9).into_iter().enumerate() {
            reference[i] = level;
        }
        assert!(!is_echo(&mic, &reference));
    }

    #[test]
    fn double_talk_keeps_the_utterance() {
        // Echo plus the user speaking through the reference's quiet stretches.
        let remote = speech(FRAMES, 1);
        let reference = reference_echoing(&remote, 8.0);
        let mic: Vec<f32> = remote
            .iter()
            .enumerate()
            .map(|(i, &level)| if i % 40 >= 24 { 0.05 } else { level })
            .collect();
        assert!(!is_echo(&mic, &reference));
    }

    #[test]
    fn silent_playback_keeps_the_utterance() {
        let mic = speech(FRAMES, 1);
        let reference = vec![0.0f32; mic.len() + MAX_LAG_FRAMES];
        assert!(!is_echo(&mic, &reference));
    }

    #[test]
    fn steady_playback_is_never_mistaken_for_echo() {
        // Constant tone under a constant mic level: coverage is total, but
        // neither envelope varies so there is nothing to correlate.
        let mic = vec![0.03f32; FRAMES];
        let reference = vec![0.004f32; FRAMES + MAX_LAG_FRAMES];
        assert!(!is_echo(&mic, &reference));
    }

    #[test]
    fn short_utterances_are_always_kept() {
        let mic = speech(WINDOW_FRAMES - 1, 1);
        let reference = reference_echoing(&mic, 8.0);
        assert!(!is_echo(&mic, &reference));
    }

    #[test]
    fn a_late_interruption_saves_the_whole_utterance() {
        // Eight seconds of the remote side echoing off the speakers, then the
        // user cuts in for the last second. A whole-buffer verdict would let
        // the echo outvote the interruption and discard both.
        let remote = speech(400, 1);
        let reference = reference_echoing(&remote, 8.0);
        let mut mic = remote;
        for frame in mic.iter_mut().skip(350) {
            *frame = 0.05;
        }
        assert!(!is_echo(&mic, &reference));
    }

    #[test]
    fn window_offsets_always_reach_the_end_of_the_utterance() {
        let offsets = window_offsets(WINDOW_FRAMES * 2 + 7);
        assert_eq!(offsets.first(), Some(&0));
        assert_eq!(offsets.last(), Some(&(WINDOW_FRAMES + 7)));
    }

    #[test]
    fn window_offsets_are_empty_for_short_input() {
        assert!(window_offsets(WINDOW_FRAMES - 1).is_empty());
    }

    #[test]
    fn poisoned_reference_lock_does_not_disable_the_guard() {
        let guard = std::sync::Arc::new(EchoGuard::new());
        let poisoning_guard = guard.clone();
        assert!(std::thread::spawn(move || {
            let _spans = poisoning_guard.spans.lock().unwrap();
            panic!("poison reference lock");
        })
        .join()
        .is_err());

        guard.note_playback(&[0.5; 480], 48_000.0);
        assert_eq!(
            guard
                .spans
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .len(),
            1
        );
    }

    #[test]
    fn reference_envelope_aligns_playback_onto_the_mic_frame_grid() {
        let guard = EchoGuard::new();
        let from = Instant::now();
        guard.spans.lock().unwrap().push_back(ReferenceSpan {
            start: from + Duration::from_millis(5),
            end: from + Duration::from_millis(25),
            rms: 0.5,
        });

        assert_eq!(guard.reference_envelope(from, 3), vec![0.5, 0.5, 0.0]);
    }

    #[test]
    fn echo_thresholds_reject_values_just_below_the_boundaries() {
        assert!(!meets_echo_thresholds(
            f32::from_bits(MIN_COVERAGE.to_bits() - 1),
            MIN_CORRELATION,
        ));
        assert!(!meets_echo_thresholds(
            MIN_COVERAGE,
            f32::from_bits(MIN_CORRELATION.to_bits() - 1),
        ));
        assert!(meets_echo_thresholds(MIN_COVERAGE, MIN_CORRELATION));
    }
}
