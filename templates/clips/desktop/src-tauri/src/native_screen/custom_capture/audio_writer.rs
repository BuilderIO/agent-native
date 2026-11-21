//! The mic and system sound tracks' fMP4 writers (see `audio_track` for what
//! the files hold). The flattened recording's stream hands each of its audio
//! buffers to `RichAudioTaps` on its own queue; a tap only retimes the buffer
//! and passes it on, never waiting, and each track encodes on a thread of its
//! own. A track whose encoder falls behind ends there and is listed
//! incomplete, while the recording goes on.

use super::track_writer::{retimed, track_time, TrackMedia, TrackWriter};
use super::{av_audio_output_settings, ObjcCMTime};
use crate::native_screen::audio_track::{
    AudioSource, AudioTimeline, AudioTrackReport, AUDIO_TRACK_SAMPLE_RATE,
};
use crate::native_screen::rich_recording::{FrameTime, RecordingClock};
use crate::native_screen::track_upload::TrackUploadCtrl;

use screencapturekit::cm::CMSampleBuffer;
use screencapturekit::stream::output_type::SCStreamOutputType;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::{Duration, Instant};

/// Buffers a track may have waiting for its encoder: about five seconds of
/// the stream's audio.
const QUEUE_DEPTH: usize = 256;
/// How long the encoder may turn one buffer away before the track gives up.
const NOT_READY_WAIT: Duration = Duration::from_millis(500);

#[link(name = "CoreMedia", kind = "framework")]
extern "C" {
    fn CMSampleBufferGetDuration(sbuf: *mut std::ffi::c_void) -> ObjcCMTime;
}

/// Where the flattened recording's stream sends its audio for a rich
/// recording's mic and system sound tracks. The pipeline's writer keeps it, so
/// every stream it starts, a resumed one too, reaches the same tracks.
#[derive(Default)]
pub(in crate::native_screen) struct RichAudioTaps {
    mic: RwLock<Option<Arc<Shared>>>,
    system: RwLock<Option<Arc<Shared>>>,
}

impl RichAudioTaps {
    fn slot(&self, source: AudioSource) -> &RwLock<Option<Arc<Shared>>> {
        match source {
            AudioSource::Mic => &self.mic,
            AudioSource::System => &self.system,
        }
    }

    /// Hands one of the stream's audio buffers to its track, if it has one.
    /// Runs on the stream's queue, so it never waits on the encoder.
    pub(super) fn offer(&self, sample: &CMSampleBuffer, of_type: SCStreamOutputType) {
        let source = match of_type {
            SCStreamOutputType::Microphone => AudioSource::Mic,
            SCStreamOutputType::Audio => AudioSource::System,
            _ => return,
        };
        let track = self
            .slot(source)
            .read()
            .ok()
            .and_then(|slot| slot.as_ref().map(Arc::clone));
        if let Some(track) = track {
            track.offer(sample);
        }
    }
}

/// A retimed buffer on its way to the encoder.
struct Queued {
    sample: CMSampleBuffer,
    at: f64,
    duration_secs: f64,
}

// SAFETY: a sample buffer is not changed once made, and CoreMedia retains and
// releases it from any thread.
unsafe impl Send for Queued {}

/// The writer, handed to the encoder's thread, the only one that uses it.
struct EncoderWriter(TrackWriter);

// SAFETY: only the encoder's thread uses the writer once it starts, and
// AVAssetWriter allows use from any one thread at a time.
unsafe impl Send for EncoderWriter {}

impl EncoderWriter {
    fn into_inner(self) -> TrackWriter {
        self.0
    }
}

struct Shared {
    recording_id: String,
    source: AudioSource,
    clock: RecordingClock,
    upload: Arc<TrackUploadCtrl>,
    /// Buffers on their way to the encoder. Taken when the track closes, so
    /// the encoder writes what is queued and then closes the file.
    queue: Mutex<Option<SyncSender<Queued>>>,
    closing: AtomicBool,
    stopped_early: Mutex<Option<String>>,
    report: Mutex<AudioTrackReport>,
}

/// A running mic or system sound track. Every method returns at once; the
/// file closes on the encoder's thread.
pub(in crate::native_screen) struct AudioCapture {
    shared: Arc<Shared>,
}

/// Starts `source`'s track writing `path`, fed through `taps`.
pub(in crate::native_screen) fn start_audio_capture(
    path: &Path,
    source: AudioSource,
    taps: &RichAudioTaps,
    clock: RecordingClock,
    upload: Arc<TrackUploadCtrl>,
    recording_id: &str,
) -> Result<AudioCapture, String> {
    // SAFETY: builds and configures a writer that nothing else holds yet.
    let writer = unsafe {
        let settings = av_audio_output_settings()?;
        TrackWriter::create(
            path,
            TrackMedia::Audio {
                sample_rate: AUDIO_TRACK_SAMPLE_RATE as i32,
            },
            &settings,
        )?
    };
    let (tx, rx) = std::sync::mpsc::sync_channel(QUEUE_DEPTH);
    let shared = Arc::new(Shared {
        recording_id: recording_id.to_string(),
        source,
        clock,
        upload,
        queue: Mutex::new(Some(tx)),
        closing: AtomicBool::new(false),
        stopped_early: Mutex::new(None),
        report: Mutex::new(AudioTrackReport::default()),
    });
    let encoder = Arc::clone(&shared);
    let writer = EncoderWriter(writer);
    std::thread::Builder::new()
        .name(format!("clips-{}-track-encoder", source.track_id()))
        .spawn(move || encoder.encode(writer.into_inner(), rx))
        .map_err(|error| format!("its encoder could not start: {error}"))?;
    *taps
        .slot(source)
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(Arc::clone(&shared));
    eprintln!(
        "[rich-tracks] {recording_id}: {} track from the recording's stream",
        source.track_id()
    );
    Ok(AudioCapture { shared })
}

impl AudioCapture {
    pub(in crate::native_screen) fn report(&self) -> AudioTrackReport {
        lock(&self.shared.report).clone()
    }

    pub(in crate::native_screen) fn stop(&self) {
        self.shared.close();
    }
}

impl Drop for AudioCapture {
    fn drop(&mut self) {
        self.shared.close();
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// How long a buffer's sound lasts, in seconds; zero when CoreMedia can't say.
fn buffer_duration_secs(sample: &CMSampleBuffer) -> f64 {
    // SAFETY: only reads the timing of a live sample buffer.
    let duration = unsafe { CMSampleBufferGetDuration(sample.as_ptr()) };
    if duration.flags & 1 == 0 || duration.timescale <= 0 {
        return 0.0;
    }
    duration.value as f64 / f64::from(duration.timescale)
}

impl Shared {
    fn offer(&self, sample: &CMSampleBuffer) {
        if self.closing.load(Ordering::SeqCst) {
            return;
        }
        let Some(timing) = sample
            .sample_timing_info(0)
            .ok()
            .filter(|timing| timing.presentation_time_stamp.is_valid())
        else {
            return;
        };
        let Some(pts_secs) = timing.presentation_time_stamp.as_seconds() else {
            return;
        };
        // Before the first frame, while paused or after Stop: no recording time.
        let FrameTime::At(at) = self.clock.stream_frame_time(pts_secs) else {
            return;
        };
        if at < 0.0 {
            return;
        }
        // At the buffer's own timescale, keeping each sample's duration, as
        // the flattened writer retimes its audio.
        let timescale = timing.presentation_time_stamp.timescale.max(1);
        let queued = match retimed(
            sample,
            track_time(at, timescale),
            ObjcCMTime::from(timing.duration),
        ) {
            Ok(copy) => Queued {
                sample: copy,
                at,
                duration_secs: buffer_duration_secs(sample),
            },
            Err(error) => return self.end_early(error),
        };
        let queue = lock(&self.queue);
        let Some(tx) = queue.as_ref() else {
            return;
        };
        if let Err(TrySendError::Full(_)) = tx.try_send(queued) {
            drop(queue);
            self.end_early("the encoder fell behind".into());
        }
    }

    /// The track stops before the recording does; the rest of the recording
    /// goes on without it.
    fn end_early(&self, reason: String) {
        {
            let mut stopped_early = lock(&self.stopped_early);
            if stopped_early.is_none() {
                eprintln!(
                    "[rich-tracks] {}: {} track stopped early: {reason}",
                    self.recording_id,
                    self.source.track_id()
                );
                *stopped_early = Some(reason);
            }
        }
        self.close();
    }

    /// Stops taking buffers. The encoder writes what is queued, then closes
    /// the file.
    fn close(&self) {
        if self.closing.swap(true, Ordering::SeqCst) {
            return;
        }
        lock(&self.queue).take();
    }

    /// The encoder's thread: writes each buffer in turn until the track
    /// closes, then closes the file.
    fn encode(self: Arc<Self>, writer: TrackWriter, rx: Receiver<Queued>) {
        let mut timeline = AudioTimeline::default();
        let mut started = false;
        let mut failed = false;
        for queued in rx.iter() {
            if failed || !timeline.admits(queued.at) {
                continue;
            }
            // SAFETY: only this thread uses the writer.
            match unsafe { write(&writer, &mut started, &queued.sample) } {
                Ok(()) => timeline.commit(queued.at, queued.duration_secs),
                Err(error) => {
                    failed = true;
                    self.end_early(error);
                }
            }
        }
        self.finish(&writer, started, &timeline);
    }

    fn finish(&self, writer: &TrackWriter, started: bool, timeline: &AudioTimeline) {
        let end_secs = timeline.end_secs();
        let mut error = None;
        if started {
            // SAFETY: the encoder is done with the writer.
            if let Err(finish_error) = unsafe { writer.finish(end_secs.unwrap_or(0.0)) } {
                error = Some(finish_error);
            }
        }
        if let Some(sink_error) = writer.sink_failure() {
            error.get_or_insert(sink_error);
        }
        let mut stopped_early = lock(&self.stopped_early).clone();
        if let Some(error) = error {
            eprintln!(
                "[rich-tracks] {}: {} track file did not close cleanly: {error}",
                self.recording_id,
                self.source.track_id()
            );
            stopped_early.get_or_insert(error);
        }
        let report = AudioTrackReport {
            init: writer.init_segment(),
            buffers: timeline.buffers(),
            start_ms: timeline.start_ms(),
            end_ms: end_secs.map(|secs| (secs * 1000.0).round().max(0.0) as u64),
            stopped_early,
            closed: true,
        };
        eprintln!(
            "[rich-tracks] {}: {} track closed after {} buffer(s){}",
            self.recording_id,
            self.source.track_id(),
            report.buffers,
            report
                .stopped_early
                .as_deref()
                .map(|reason| format!(" (stopped early: {reason})"))
                .unwrap_or_default()
        );
        *lock(&self.report) = report;
        if let Some(error) = writer.sink_failure() {
            self.upload
                .fail_source(format!("its file could not be written: {error}"));
        }
        self.upload.close_source();
    }
}

/// Writes one buffer, starting the file with the first. Waits a little for an
/// encoder that is not ready: dropping sound would leave a gap.
unsafe fn write(
    writer: &TrackWriter,
    started: &mut bool,
    sample: &CMSampleBuffer,
) -> Result<(), String> {
    if !*started {
        writer.start()?;
        *started = true;
    }
    let deadline = Instant::now() + NOT_READY_WAIT;
    while !writer.is_ready() {
        if Instant::now() >= deadline {
            return Err("the encoder fell behind".into());
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    writer.append(sample)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_screen::track_upload::TrackSendGate;
    use std::sync::atomic::AtomicU64;

    fn clock_at(start_secs: f64) -> RecordingClock {
        RecordingClock::new(
            Arc::new(AtomicU64::new(start_secs.to_bits())),
            Arc::new(AtomicU64::new(0.0_f64.to_bits())),
            (1, 1),
        )
    }

    /// A track with no AVFoundation writer behind its queue: enough for
    /// stopping and closing.
    fn idle_track(depth: usize) -> (Arc<Shared>, Receiver<Queued>) {
        let (tx, rx) = std::sync::mpsc::sync_channel(depth);
        let shared = Arc::new(Shared {
            recording_id: "rec-idle".into(),
            source: AudioSource::Mic,
            clock: clock_at(100.0),
            upload: Arc::new(TrackUploadCtrl::new(
                Arc::new(AtomicBool::new(false)),
                Arc::new(TrackSendGate::new(|| Some(0))),
            )),
            queue: Mutex::new(Some(tx)),
            closing: AtomicBool::new(false),
            stopped_early: Mutex::new(None),
            report: Mutex::new(AudioTrackReport::default()),
        });
        (shared, rx)
    }

    #[test]
    fn stopping_lets_the_encoder_drain_and_end() {
        let (track, rx) = idle_track(4);
        let capture = AudioCapture {
            shared: Arc::clone(&track),
        };
        capture.stop();
        assert!(track.closing.load(Ordering::SeqCst));
        // The sender is gone, so the encoder's loop ends once it has read
        // what was queued.
        assert!(rx.recv().is_err());
        // Stopping again does nothing more.
        capture.stop();
        assert_eq!(*lock(&track.stopped_early), None);
    }

    #[test]
    fn a_track_that_stops_early_keeps_its_first_reason() {
        let (track, _rx) = idle_track(4);
        track.end_early("the encoder fell behind".into());
        track.end_early("appendSampleBuffer failed".into());
        assert_eq!(
            lock(&track.stopped_early).as_deref(),
            Some("the encoder fell behind")
        );
        assert!(lock(&track.queue).is_none());
    }
}
