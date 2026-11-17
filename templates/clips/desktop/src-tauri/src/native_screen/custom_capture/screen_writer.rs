//! The screen track's own ScreenCaptureKit stream and fMP4 writer (see
//! `screen_track` for what the file holds). Separate from the flattened
//! recording's stream, queue and encoder: anything failing here, or the encoder
//! falling behind, ends only this track, which is then listed incomplete.
//!
//! Pausing stops the stream and resuming starts a new one, so the first frame
//! after a pause is a complete picture of the screen. Callbacks from a stream
//! that was stopped are told apart by a generation number and ignored; as in
//! the flattened writer, a callback checks it under an admission lock that
//! moving the generation on waits for, so no callback that passed the check
//! is still running once the clock it reads changes.

use super::{
    av_class_named, av_dict, av_dict_set, av_ns_string_from, av_number_bool, av_number_i64,
    av_writer_error_suffix, describe_objc_exception, CMSampleBufferCreateCopyWithNewTiming,
    ObjcCMSampleTimingInfo, ObjcCMTime, SegmentSink, SegmentWriterDelegate,
    AV_WRITER_STATUS_COMPLETED, OUTPUT_SEGMENT_INTERVAL_SECONDS,
};
use crate::native_screen::rich_recording::{FrameTime, RecordingClock};
use crate::native_screen::screen_track::{
    screen_track_bit_rate, FrameTimeline, ScreenArea, ScreenTrackReport, SCREEN_TRACK_MAX_FPS,
    SCREEN_TRACK_MAX_KEYFRAME_SECONDS, SCREEN_TRACK_TIMESCALE,
};
use crate::native_screen::track_upload::TrackUploadCtrl;

use objc2::msg_send;
use objc2::rc::{Allocated, Retained};
use objc2::runtime::AnyObject;
use screencapturekit::cg::CGRect;
use screencapturekit::cm::{CMSampleBuffer, SCFrameStatus};
use screencapturekit::dispatch_queue::{DispatchQoS, DispatchQueue};
use screencapturekit::error::SCError;
use screencapturekit::shareable_content::SCShareableContent;
use screencapturekit::stream::configuration::{
    PixelFormat, SCCaptureResolutionType, SCStreamConfiguration,
};
use screencapturekit::stream::content_filter::SCContentFilter;
use screencapturekit::stream::delegate_trait::SCStreamDelegateTrait;
use screencapturekit::stream::output_trait::SCStreamOutputTrait;
use screencapturekit::stream::output_type::SCStreamOutputType;
use screencapturekit::stream::sc_stream::SCStream;
use std::panic::AssertUnwindSafe;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, RwLock, Weak};
use std::time::{Duration, Instant};

/// Frames the encoder turned away in a row before the track gives up on it:
/// about two seconds of a screen changing at full rate.
const NOT_READY_LIMIT: u32 = 120;
const FINISH_TIMEOUT: Duration = Duration::from_secs(15);
/// How long the end of the track waits to write a frame the encoder last
/// turned away.
const HELD_FRAME_WAIT: Duration = Duration::from_millis(500);
/// Frames ScreenCaptureKit may have waiting for this track's queue.
const STREAM_QUEUE_DEPTH: u32 = 6;

struct Writer {
    writer: Retained<AnyObject>,
    input: Retained<AnyObject>,
    sink: Arc<SegmentSink>,
    _delegate: Retained<SegmentWriterDelegate>,
}

/// A frame waiting to be written: one from before the recording's first frame
/// (`at` is `None`, so it goes at zero), or one the encoder wasn't ready for.
struct HeldFrame {
    sample: CMSampleBuffer,
    at: Option<f64>,
}

struct WriterState {
    writer: Option<Writer>,
    started: bool,
    accepting: bool,
    timeline: FrameTimeline,
    held: Option<HeldFrame>,
    not_ready: u32,
    stopped_early: Option<String>,
}

// SAFETY: the AVFoundation objects and sample buffers are only used under the
// state lock, one thread at a time; AVAssetWriter allows that from any thread.
unsafe impl Send for WriterState {}

enum Append {
    Done,
    NotReady,
    Failed(String),
}

struct Shared {
    recording_id: String,
    display_id: u32,
    area: ScreenArea,
    clock: RecordingClock,
    upload: Arc<TrackUploadCtrl>,
    /// The stream whose frames are taken; bumped to ignore an old one.
    generation: AtomicU64,
    /// Held to read by every callback while it runs; held to write while the
    /// generation moves on for a pause or a new stream.
    admission: RwLock<()>,
    closing: AtomicBool,
    state: Mutex<WriterState>,
    stream: Mutex<Option<(SCStream, DispatchQueue)>>,
    report: Mutex<ScreenTrackReport>,
}

/// The running screen track. Every method returns at once; the stream starts,
/// stops and the file closes on threads of their own.
pub(in crate::native_screen) struct ScreenCapture {
    shared: Arc<Shared>,
}

/// Starts the screen track writing `path`. The stream itself starts on its
/// own thread; if it can't, the track ends empty and is not listed.
pub(in crate::native_screen) fn start_screen_capture(
    path: &Path,
    display_id: u32,
    area: ScreenArea,
    clock: RecordingClock,
    upload: Arc<TrackUploadCtrl>,
    recording_id: &str,
) -> Result<ScreenCapture, String> {
    // SAFETY: builds and configures a writer that nothing else holds yet.
    let writer = unsafe { create_writer(path, &area)? };
    let shared = Arc::new(Shared {
        recording_id: recording_id.to_string(),
        display_id,
        area,
        clock,
        upload,
        generation: AtomicU64::new(0),
        admission: RwLock::new(()),
        closing: AtomicBool::new(false),
        state: Mutex::new(WriterState {
            writer: Some(writer),
            started: false,
            accepting: true,
            timeline: FrameTimeline::default(),
            held: None,
            not_ready: 0,
            stopped_early: None,
        }),
        stream: Mutex::new(None),
        report: Mutex::new(ScreenTrackReport::default()),
    });
    Shared::start_stream(&shared);
    eprintln!(
        "[rich-tracks] {recording_id}: screen track {}x{} px at {}x",
        area.width_px, area.height_px, area.scale
    );
    Ok(ScreenCapture { shared })
}

impl ScreenCapture {
    pub(in crate::native_screen) fn area(&self) -> ScreenArea {
        self.shared.area
    }

    pub(in crate::native_screen) fn report(&self) -> ScreenTrackReport {
        lock(&self.shared.report).clone()
    }

    pub(in crate::native_screen) fn pause(&self) {
        if self.shared.closing.load(Ordering::SeqCst) {
            return;
        }
        self.shared.next_generation();
        let stream = lock(&self.shared.stream).take();
        if let Some(stream) = stream {
            stop_stream_in_background(&self.shared.recording_id, stream);
        }
    }

    pub(in crate::native_screen) fn resume(&self) {
        Shared::start_stream(&self.shared);
    }

    /// Stopped while paused, the file ends where the pause began: the
    /// recording's own end, though no frame came since.
    pub(in crate::native_screen) fn stop(&self) {
        let stopped_secs = self.shared.clock.position_ms().map(|ms| ms / 1000.0);
        Shared::close(&self.shared, stopped_secs);
    }
}

impl Drop for ScreenCapture {
    fn drop(&mut self) {
        Shared::close(&self.shared, None);
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn stop_stream_in_background(recording_id: &str, stream: (SCStream, DispatchQueue)) {
    let id = recording_id.to_string();
    let _ = std::thread::Builder::new()
        .name("clips-screen-track-stream-stop".into())
        .spawn(move || {
            if let Err(error) = stream.0.stop_capture() {
                eprintln!("[rich-tracks] {id}: screen track stream did not stop cleanly: {error}");
            }
        });
}

impl Shared {
    /// Moves the generation on once no callback is running, so none that
    /// passed the check outlives it. Never from a callback; `close` runs in
    /// them, and stays safe without this through `accepting`.
    fn next_generation(&self) -> u64 {
        let _admission = self
            .admission
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Whether a stream started for `generation` is still the one wanted.
    /// `closing` counts as well as the generation: a resume that passed its
    /// check before `close` can still take a new generation after it.
    fn wants_stream(&self, generation: u64) -> bool {
        !self.closing.load(Ordering::SeqCst) && self.generation.load(Ordering::SeqCst) == generation
    }

    /// Starts a new stream on its own thread, replacing any earlier one.
    fn start_stream(this: &Arc<Self>) {
        if this.closing.load(Ordering::SeqCst) {
            return;
        }
        let generation = this.next_generation();
        let shared = Arc::clone(this);
        let spawned = std::thread::Builder::new()
            .name("clips-screen-track-stream-start".into())
            .spawn(move || {
                if let Err(error) = Self::run_stream(&shared, generation) {
                    if shared.wants_stream(generation) {
                        let mut state = lock(&shared.state);
                        Self::end_early(&shared, &mut state, error);
                    }
                }
            });
        if let Err(error) = spawned {
            let mut state = lock(&this.state);
            Self::end_early(
                this,
                &mut state,
                format!("its stream could not start: {error}"),
            );
        }
    }

    fn run_stream(this: &Arc<Self>, generation: u64) -> Result<(), String> {
        let content = SCShareableContent::get()
            .map_err(|error| format!("shareable content lookup failed: {error:?}"))?;
        let displays = content.displays();
        let display = displays
            .iter()
            .find(|display| display.display_id() == this.display_id)
            .ok_or_else(|| format!("display {} is no longer available", this.display_id))?;
        let source_rect = this
            .area
            .source_rect_pt
            .map(|rect| CGRect::new(rect.x, rect.y, rect.width, rect.height));
        let builder = SCContentFilter::create()
            .with_display(display)
            .with_excluding_windows(&[]);
        let filter = match source_rect {
            Some(rect) => builder.with_content_rect(rect).build(),
            None => builder.build(),
        };
        let mut config = SCStreamConfiguration::new()
            .with_width(this.area.width_px)
            .with_height(this.area.height_px)
            .with_preserves_aspect_ratio(true)
            .with_capture_resolution_type(SCCaptureResolutionType::Best)
            .with_fps(SCREEN_TRACK_MAX_FPS)
            .with_queue_depth(STREAM_QUEUE_DEPTH)
            .with_shows_cursor(false);
        config.set_pixel_format(PixelFormat::YCbCr_420v);
        if let Some(rect) = source_rect {
            config.set_source_rect(rect);
        }
        config.set_stream_name(Some("Clips rich recording screen track"));

        let delegate = StreamDelegate {
            shared: Arc::downgrade(this),
            generation,
        };
        let mut stream = SCStream::new_with_delegate(&filter, &config, delegate);
        // Below the flattened recording's own stream, which keeps the default.
        let queue = DispatchQueue::new(
            "com.clips.rich-recording.screen-track",
            DispatchQoS::Utility,
        );
        let handler = FrameHandler {
            shared: Arc::downgrade(this),
            generation,
        };
        stream
            .add_output_handler_with_queue(handler, SCStreamOutputType::Screen, Some(&queue))
            .ok_or_else(|| "its stream output could not be added".to_string())?;
        stream
            .start_capture()
            .map_err(|error| format!("its stream did not start: {error}"))?;
        // Kept only if nothing paused or stopped the track while it started;
        // checked under the slot's lock, which `pause` takes after moving the
        // generation on and `close` after setting `closing`, so a stream is
        // either in the slot when they empty it or never kept.
        let mut slot = lock(&this.stream);
        if this.wants_stream(generation) {
            *slot = Some((stream, queue));
        } else {
            drop(slot);
            let _ = stream.stop_capture();
        }
        Ok(())
    }

    fn on_frame(this: &Arc<Self>, sample: CMSampleBuffer, pts_secs: f64) {
        let mut state = lock(&this.state);
        if !state.accepting {
            return;
        }
        let at = match this.clock.frame_time(pts_secs) {
            FrameTime::Paused | FrameTime::AfterStop => return,
            FrameTime::BeforeStart => {
                state.held = Some(HeldFrame { sample, at: None });
                return;
            }
            FrameTime::At(secs) => secs,
        };
        if let Some(held) = state.held.take() {
            // Not ready: the frame in hand is newer and replaces it.
            if let Append::Failed(error) =
                Self::append(&mut state, &held.sample, held.at.unwrap_or(0.0))
            {
                return Self::end_early(this, &mut state, error);
            }
        }
        match Self::append(&mut state, &sample, at) {
            Append::Done => state.not_ready = 0,
            Append::NotReady => {
                state.held = Some(HeldFrame {
                    sample,
                    at: Some(at),
                });
                state.not_ready += 1;
                if state.not_ready >= NOT_READY_LIMIT {
                    Self::end_early(this, &mut state, "the encoder fell behind".into());
                }
            }
            Append::Failed(error) => Self::end_early(this, &mut state, error),
        }
    }

    fn append(state: &mut WriterState, sample: &CMSampleBuffer, at: f64) -> Append {
        let Some((writer, input)) = state.writer.as_ref().map(|writer| {
            (
                Retained::clone(&writer.writer),
                Retained::clone(&writer.input),
            )
        }) else {
            return Append::Failed("the writer is closed".into());
        };
        // SAFETY: the writer and its input are live and used only under the
        // state lock; exceptions are caught.
        unsafe {
            if !state.started {
                if let Err(error) = start_writing(&writer) {
                    return Append::Failed(error);
                }
                state.started = true;
            }
            let ready: bool = msg_send![&*input, isReadyForMoreMediaData];
            if !ready {
                return Append::NotReady;
            }
            let place = state.timeline.place(at);
            let copy = match sample_at(sample, place) {
                Ok(copy) => copy,
                Err(error) => return Append::Failed(error),
            };
            let input_ptr = &*input as *const AnyObject;
            let appended = objc2::exception::catch(AssertUnwindSafe(|| {
                let appended: bool = msg_send![&*input_ptr, appendSampleBuffer: copy.as_ptr()];
                appended
            }));
            match appended {
                Ok(true) => {
                    state.timeline.commit(place);
                    Append::Done
                }
                Ok(false) => Append::Failed(format!(
                    "appendSampleBuffer failed{}",
                    av_writer_error_suffix(&writer)
                )),
                Err(exception) => Append::Failed(format!(
                    "appendSampleBuffer raised: {}",
                    describe_objc_exception(exception)
                )),
            }
        }
    }

    /// The track stops before the recording does; the rest of the recording
    /// goes on without it.
    fn end_early(this: &Arc<Self>, state: &mut WriterState, reason: String) {
        if state.stopped_early.is_none() {
            eprintln!(
                "[rich-tracks] {}: screen track stopped early: {reason}",
                this.recording_id
            );
            state.stopped_early = Some(reason);
        }
        state.accepting = false;
        let stopped_secs = this.clock.position_ms().map(|ms| ms / 1000.0);
        Self::close(this, stopped_secs);
    }

    /// Stops the stream and closes the file on a thread of its own, once.
    fn close(this: &Arc<Self>, stopped_secs: Option<f64>) {
        if this.closing.swap(true, Ordering::SeqCst) {
            return;
        }
        this.generation.fetch_add(1, Ordering::SeqCst);
        let shared = Arc::clone(this);
        let spawned = std::thread::Builder::new()
            .name("clips-screen-track-close".into())
            .spawn(move || {
                let stream = lock(&shared.stream).take();
                if let Some((stream, _queue)) = stream {
                    if let Err(error) = stream.stop_capture() {
                        eprintln!(
                            "[rich-tracks] {}: screen track stream did not stop cleanly: {error}",
                            shared.recording_id
                        );
                    }
                }
                shared.finish(stopped_secs);
            });
        if let Err(error) = spawned {
            eprintln!(
                "[rich-tracks] {}: screen track could not close its file: {error}",
                this.recording_id
            );
            this.upload
                .fail_source(format!("its file could not be closed: {error}"));
            this.upload.close_source();
        }
    }

    fn finish(&self, stopped_secs: Option<f64>) {
        let mut state = lock(&self.state);
        state.accepting = false;
        if let Some(held) = state.held.take() {
            let deadline = Instant::now() + HELD_FRAME_WAIT;
            loop {
                match Self::append(&mut state, &held.sample, held.at.unwrap_or(0.0)) {
                    Append::NotReady if Instant::now() < deadline => {
                        std::thread::sleep(Duration::from_millis(10));
                    }
                    Append::Failed(error) if state.stopped_early.is_none() => {
                        state.stopped_early = Some(error);
                        break;
                    }
                    _ => break,
                }
            }
        }
        let writer = state.writer.take();
        let started = state.started;
        let end_secs = state.timeline.end_secs(stopped_secs);
        let mut error = None;
        if let (Some(writer), true) = (writer.as_ref(), started) {
            // SAFETY: the writer is no longer reachable from the frame path.
            if let Err(finish_error) = unsafe { writer.finish(end_secs) } {
                error = Some(finish_error);
            }
        }
        if let Some(sink_error) = writer.as_ref().and_then(|writer| writer.sink.failure()) {
            error.get_or_insert(sink_error);
        }
        if let Some(error) = error {
            eprintln!(
                "[rich-tracks] {}: screen track file did not close cleanly: {error}",
                self.recording_id
            );
            state.stopped_early.get_or_insert(error);
        }
        let init = writer.as_ref().and_then(|writer| {
            writer
                .sink
                .state
                .lock()
                .ok()
                .and_then(|sink| sink.init_segment.clone())
        });
        let report = ScreenTrackReport {
            init,
            frames: state.timeline.frames(),
            start_ms: state.timeline.start_ms(),
            end_ms: started.then(|| (end_secs * 1000.0).round().max(0.0) as u64),
            stopped_early: state.stopped_early.clone(),
            closed: true,
        };
        drop(state);
        eprintln!(
            "[rich-tracks] {}: screen track closed after {} frame(s){}",
            self.recording_id,
            report.frames,
            report
                .stopped_early
                .as_deref()
                .map(|reason| format!(" (stopped early: {reason})"))
                .unwrap_or_default()
        );
        *lock(&self.report) = report;
        if let Some(error) = writer.as_ref().and_then(|writer| writer.sink.failure()) {
            self.upload
                .fail_source(format!("its file could not be written: {error}"));
        }
        self.upload.close_source();
    }
}

struct FrameHandler {
    shared: Weak<Shared>,
    generation: u64,
}

impl SCStreamOutputTrait for FrameHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if !matches!(of_type, SCStreamOutputType::Screen) {
            return;
        }
        let Some(shared) = self.shared.upgrade() else {
            return;
        };
        let Ok(_admission) = shared.admission.read() else {
            return;
        };
        if shared.generation.load(Ordering::SeqCst) != self.generation {
            return;
        }
        // Idle frames repeat the last picture; only changes are written.
        if !matches!(
            sample.frame_status(),
            Some(SCFrameStatus::Complete | SCFrameStatus::Started)
        ) || sample.image_buffer().is_none()
        {
            return;
        }
        let Some(pts_secs) = sample
            .sample_timing_info(0)
            .ok()
            .and_then(|timing| timing.presentation_time_stamp.as_seconds())
        else {
            return;
        };
        let outcome = std::panic::catch_unwind(AssertUnwindSafe(|| {
            objc2::exception::catch(AssertUnwindSafe(|| {
                Shared::on_frame(&shared, sample, pts_secs)
            }))
        }));
        let failure = match outcome {
            Ok(Ok(())) => return,
            Ok(Err(exception)) => {
                format!("the writer raised: {}", describe_objc_exception(exception))
            }
            Err(_) => "the frame handler panicked".to_string(),
        };
        let mut state = lock(&shared.state);
        Shared::end_early(&shared, &mut state, failure);
    }
}

struct StreamDelegate {
    shared: Weak<Shared>,
    generation: u64,
}

impl StreamDelegate {
    fn stopped(&self, reason: String) {
        let Some(shared) = self.shared.upgrade() else {
            return;
        };
        let Ok(_admission) = shared.admission.read() else {
            return;
        };
        if shared.generation.load(Ordering::SeqCst) != self.generation {
            return;
        }
        let mut state = lock(&shared.state);
        Shared::end_early(&shared, &mut state, reason);
    }
}

impl SCStreamDelegateTrait for StreamDelegate {
    fn did_stop_with_error(&self, error: SCError) {
        self.stopped(format!("its stream stopped with an error: {error}"));
    }

    fn stream_did_stop(&self, error: Option<String>) {
        self.stopped(format!(
            "its stream stopped: {}",
            error.unwrap_or_else(|| "no detail".into())
        ));
    }
}

/// A copy of `sample` at `secs` of the file's timeline.
fn sample_at(sample: &CMSampleBuffer, secs: f64) -> Result<CMSampleBuffer, String> {
    let invalid = ObjcCMTime {
        value: 0,
        timescale: 0,
        flags: 0,
        epoch: 0,
    };
    let timing = ObjcCMSampleTimingInfo {
        duration: invalid,
        presentation_time_stamp: track_time(secs),
        decode_time_stamp: invalid,
    };
    let mut out: *mut std::ffi::c_void = std::ptr::null_mut();
    // SAFETY: `sample` is a live sample buffer and `out` receives a new one
    // the wrapper below owns.
    let status = unsafe {
        CMSampleBufferCreateCopyWithNewTiming(
            std::ptr::null(),
            sample.as_ptr(),
            1,
            &timing,
            &mut out,
        )
    };
    if status != 0 || out.is_null() {
        return Err(format!(
            "CMSampleBufferCreateCopyWithNewTiming failed (status={status})"
        ));
    }
    CMSampleBuffer::from_raw(out).ok_or_else(|| "retimed sample buffer wrap failed".to_string())
}

fn track_time(secs: f64) -> ObjcCMTime {
    ObjcCMTime {
        value: (secs * f64::from(SCREEN_TRACK_TIMESCALE)).round() as i64,
        timescale: SCREEN_TRACK_TIMESCALE,
        flags: 1,
        epoch: 0,
    }
}

/// Starts writing with the session at zero: the recording's first frame, so
/// media time is recording time.
unsafe fn start_writing(writer: &AnyObject) -> Result<(), String> {
    let writer_ptr = writer as *const AnyObject;
    let zero = track_time(0.0);
    let outcome = objc2::exception::catch(AssertUnwindSafe(|| unsafe {
        let ok: bool = msg_send![&*writer_ptr, startWriting];
        if ok {
            let _: () = msg_send![&*writer_ptr, startSessionAtSourceTime: zero];
        }
        ok
    }));
    match outcome {
        Ok(true) => Ok(()),
        Ok(false) => Err(format!(
            "startWriting failed{}",
            av_writer_error_suffix(writer)
        )),
        Err(exception) => Err(format!(
            "startWriting raised: {}",
            describe_objc_exception(exception)
        )),
    }
}

impl Writer {
    unsafe fn finish(&self, end_secs: f64) -> Result<(), String> {
        use block2::RcBlock;

        let writer = &*self.writer as *const AnyObject;
        let input = &*self.input as *const AnyObject;
        let (tx, rx) = std::sync::mpsc::sync_channel::<()>(1);
        let block = RcBlock::new(move || {
            let _ = tx.send(());
        });
        let end = track_time(end_secs);
        let requested = objc2::exception::catch(AssertUnwindSafe(|| unsafe {
            let _: () = msg_send![&*writer, endSessionAtSourceTime: end];
            let _: () = msg_send![&*input, markAsFinished];
            let _: () = msg_send![&*writer, finishWritingWithCompletionHandler: &*block];
        }));
        if let Err(exception) = requested {
            return Err(format!(
                "finishing raised: {}",
                describe_objc_exception(exception)
            ));
        }
        if rx.recv_timeout(FINISH_TIMEOUT).is_err() {
            let _: () = msg_send![&*self.writer, cancelWriting];
            return Err("finishing timed out".into());
        }
        let status: i64 = msg_send![&*self.writer, status];
        if status != AV_WRITER_STATUS_COMPLETED {
            return Err(format!(
                "finishing failed (status={status}{})",
                av_writer_error_suffix(&self.writer)
            ));
        }
        Ok(())
    }
}

/// An fMP4 writer in one-second fragments that hands its segments to a
/// `SegmentSink` on `path`, as the flattened recording's live-upload writer
/// does. AVAssetWriter makes the first frame of each fragment a keyframe.
unsafe fn create_writer(path: &Path, area: &ScreenArea) -> Result<Writer, String> {
    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {
        static AVMediaTypeVideo: *const AnyObject;
        static AVFileTypeProfileMPEG4AppleHLS: *const AnyObject;
    }

    let writer_cls =
        av_class_named("AVAssetWriter").ok_or_else(|| "AVAssetWriter missing".to_string())?;
    let input_cls = av_class_named("AVAssetWriterInput")
        .ok_or_else(|| "AVAssetWriterInput missing".to_string())?;
    let ident = av_ns_string_from("public.mpeg-4")
        .ok_or_else(|| "NSString for UTType failed".to_string())?;
    let ut_cls = av_class_named("UTType").ok_or_else(|| "UTType missing".to_string())?;
    // `alloc` hands over an `Allocated` the `init` consumes, so an `init` that
    // returns nil, having released its receiver, never has it released again.
    let created = objc2::exception::catch(AssertUnwindSafe(|| unsafe {
        let ut: Option<Retained<AnyObject>> = msg_send![ut_cls, typeWithIdentifier: &*ident];
        let ut = ut.ok_or_else(|| "UTType public.mpeg-4 unavailable".to_string())?;
        let allocated: Allocated<AnyObject> = msg_send![writer_cls, alloc];
        let writer: Option<Retained<AnyObject>> = msg_send![allocated, initWithContentType: &*ut];
        let writer =
            writer.ok_or_else(|| "AVAssetWriter initWithContentType failed".to_string())?;
        let settings = video_settings(area.width_px, area.height_px)?;
        let input: Option<Retained<AnyObject>> = msg_send![
            input_cls,
            assetWriterInputWithMediaType: AVMediaTypeVideo,
            outputSettings: &*settings
        ];
        let input = input.ok_or_else(|| "AVAssetWriterInput allocation failed".to_string())?;
        Ok::<_, String>((writer, input))
    }));
    let (writer, input) = match created {
        Ok(created) => created?,
        Err(exception) => {
            return Err(format!(
                "writer creation raised: {}",
                describe_objc_exception(exception)
            ))
        }
    };

    let sink = SegmentSink::create_with(path, false)?;
    let delegate = SegmentWriterDelegate::new(Arc::clone(&sink));
    let writer_ptr = &*writer as *const AnyObject;
    let input_ptr = &*input as *const AnyObject;
    let configured = objc2::exception::catch(AssertUnwindSafe(|| unsafe {
        let interval = ObjcCMTime {
            value: OUTPUT_SEGMENT_INTERVAL_SECONDS,
            timescale: 1,
            flags: 1,
            epoch: 0,
        };
        let _: () = msg_send![&*writer_ptr, setPreferredOutputSegmentInterval: interval];
        let _: () = msg_send![&*writer_ptr, setInitialSegmentStartTime: track_time(0.0)];
        let _: () =
            msg_send![&*writer_ptr, setOutputFileTypeProfile: AVFileTypeProfileMPEG4AppleHLS];
        let _: () = msg_send![&*writer_ptr, setDelegate: &*delegate];
        let _: () = msg_send![&*input_ptr, setExpectsMediaDataInRealTime: true];
        let _: () = msg_send![&*input_ptr, setMediaTimeScale: SCREEN_TRACK_TIMESCALE];
        let can_add: bool = msg_send![&*writer_ptr, canAddInput: &*input_ptr];
        if can_add {
            let _: () = msg_send![&*writer_ptr, addInput: &*input_ptr];
        }
        can_add
    }));
    match configured {
        Ok(true) => Ok(Writer {
            writer,
            input,
            sink,
            _delegate: delegate,
        }),
        Ok(false) => Err("AVAssetWriter cannot add the screen input".into()),
        Err(exception) => Err(format!(
            "writer setup raised: {}",
            describe_objc_exception(exception)
        )),
    }
}

/// H.264 High at the area's native size, the bit rate sized by its pixels.
unsafe fn video_settings(width: u32, height: u32) -> Result<Retained<AnyObject>, String> {
    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {
        static AVVideoCodecKey: *const AnyObject;
        static AVVideoCodecTypeH264: *const AnyObject;
        static AVVideoHeightKey: *const AnyObject;
        static AVVideoWidthKey: *const AnyObject;
        static AVVideoCompressionPropertiesKey: *const AnyObject;
        static AVVideoAllowFrameReorderingKey: *const AnyObject;
        static AVVideoAverageBitRateKey: *const AnyObject;
        static AVVideoExpectedSourceFrameRateKey: *const AnyObject;
        static AVVideoMaxKeyFrameIntervalDurationKey: *const AnyObject;
        static AVVideoProfileLevelKey: *const AnyObject;
        static AVVideoProfileLevelH264HighAutoLevel: *const AnyObject;
    }
    let number = |value: i64| av_number_i64(value).ok_or_else(|| "NSNumber failed".to_string());

    let settings = av_dict()?;
    av_dict_set(&settings, AVVideoCodecKey, &*AVVideoCodecTypeH264);
    av_dict_set(&settings, AVVideoWidthKey, &*number(i64::from(width))?);
    av_dict_set(&settings, AVVideoHeightKey, &*number(i64::from(height))?);

    let compression = av_dict()?;
    av_dict_set(
        &compression,
        AVVideoProfileLevelKey,
        &*AVVideoProfileLevelH264HighAutoLevel,
    );
    let no_reordering =
        av_number_bool(false).ok_or_else(|| "NSNumber reordering flag failed".to_string())?;
    av_dict_set(&compression, AVVideoAllowFrameReorderingKey, &no_reordering);
    av_dict_set(
        &compression,
        AVVideoAverageBitRateKey,
        &*number(screen_track_bit_rate(width, height))?,
    );
    av_dict_set(
        &compression,
        AVVideoExpectedSourceFrameRateKey,
        &*number(i64::from(SCREEN_TRACK_MAX_FPS))?,
    );
    let keyframe_seconds: *mut AnyObject = msg_send![
        objc2::class!(NSNumber),
        numberWithDouble: SCREEN_TRACK_MAX_KEYFRAME_SECONDS
    ];
    let keyframe_seconds = Retained::retain(keyframe_seconds)
        .ok_or_else(|| "NSNumber keyframe interval failed".to_string())?;
    av_dict_set(
        &compression,
        AVVideoMaxKeyFrameIntervalDurationKey,
        &keyframe_seconds,
    );
    av_dict_set(&settings, AVVideoCompressionPropertiesKey, &compression);
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::super::rebased_time;
    use super::*;
    use crate::native_screen::track_upload::TrackSendGate;

    /// A screen track with no stream and no AVFoundation writer: enough for
    /// the generation, the slot check and closing.
    fn idle_track(clock: RecordingClock) -> Arc<Shared> {
        Arc::new(Shared {
            recording_id: "rec-idle".into(),
            display_id: 1,
            area: ScreenArea {
                source_rect_pt: None,
                width_px: 64,
                height_px: 64,
                scale: 1.0,
            },
            clock,
            upload: Arc::new(TrackUploadCtrl::new(
                Arc::new(AtomicBool::new(false)),
                Arc::new(TrackSendGate::new(|| Some(0))),
            )),
            generation: AtomicU64::new(0),
            admission: RwLock::new(()),
            closing: AtomicBool::new(false),
            state: Mutex::new(WriterState {
                writer: None,
                started: false,
                accepting: true,
                timeline: FrameTimeline::default(),
                held: None,
                not_ready: 0,
                stopped_early: None,
            }),
            stream: Mutex::new(None),
            report: Mutex::new(ScreenTrackReport::default()),
        })
    }

    fn clock_at(start_secs: f64) -> RecordingClock {
        RecordingClock::new(
            Arc::new(AtomicU64::new(start_secs.to_bits())),
            Arc::new(AtomicU64::new(0.0_f64.to_bits())),
            (1, 1),
        )
    }

    fn wait_until_closed(track: &Shared) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !track.upload.source_closed() {
            assert!(Instant::now() < deadline, "the track never closed");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn a_stream_started_once_the_track_is_closing_is_never_kept() {
        let track = idle_track(clock_at(100.0));
        let started = track.next_generation();
        assert!(track.wants_stream(started));
        // Paused while it started: the generation moved on.
        track.next_generation();
        assert!(!track.wants_stream(started));

        // A resume passes its `closing` check, the track closes (its upload
        // failed for good), and only then does the resume take a generation.
        assert!(!track.closing.load(Ordering::SeqCst));
        Shared::close(&track, None);
        let resumed = track.next_generation();
        assert!(!track.wants_stream(resumed));
        wait_until_closed(&track);
    }

    #[test]
    fn a_track_stopped_while_paused_ends_where_the_pause_began() {
        let clock = clock_at(100.0);
        let track = idle_track(clock.clone());
        // One frame 2 s in, then nothing changed on screen.
        {
            let mut state = lock(&track.state);
            state.started = true;
            state.timeline.commit(2.0);
        }
        // Paused 20 s in and stopped while still paused.
        clock.pause_at(120_000_000_000);
        let capture = ScreenCapture {
            shared: Arc::clone(&track),
        };
        capture.stop();
        wait_until_closed(&track);
        assert_eq!(capture.report().end_ms, Some(20_000));
    }

    #[test]
    fn screen_frames_land_where_the_flattened_writer_puts_its_own() {
        let start = Arc::new(AtomicU64::new(f64::NAN.to_bits()));
        let offset = Arc::new(AtomicU64::new(0.0_f64.to_bits()));
        let clock = RecordingClock::new(Arc::clone(&start), Arc::clone(&offset), (125, 3));
        let host = |secs: f64| screencapturekit::cm::CMTime {
            value: (secs * 1e9).round() as i64,
            timescale: 1_000_000_000,
            flags: 1,
            epoch: 0,
        };
        // The flattened writer's first frame, as it stores it.
        let first = host(5_000.25);
        assert_eq!(clock.frame_time(5_000.0), FrameTime::BeforeStart);
        start.store(5_000.25_f64.to_bits(), Ordering::SeqCst);

        let mut timeline = FrameTimeline::default();
        let mut check = |pts: f64, offset_secs: f64| {
            let flat = rebased_time(host(pts), (first.value, first.timescale), offset_secs);
            let flat_secs = flat.value as f64 / f64::from(flat.timescale);
            let FrameTime::At(secs) = clock.frame_time(pts) else {
                panic!("no recording time for {pts}");
            };
            assert!((secs - flat_secs).abs() < 1e-6, "{secs} vs {flat_secs}");
            let place = timeline.place(secs);
            timeline.commit(place);
            let at = track_time(place);
            assert_eq!(at.timescale, SCREEN_TRACK_TIMESCALE);
            at.value
        };
        // 1.5 s in: media time 1.5 s.
        assert_eq!(check(5_001.75, 0.0), 135_000);
        // Paused at 3 s for 4.2 s: no frame has a time meanwhile.
        offset.store(0.0_f64.to_bits(), Ordering::SeqCst);
        clock.pause_at(host_nanos(5_003.25));
        assert_eq!(clock.frame_time(5_004.0), FrameTime::Paused);
        // Resumed with the pipeline's offset grown by the pause: the next frame
        // follows on from 3 s, not from 7.2.
        offset.store(4.2_f64.to_bits(), Ordering::SeqCst);
        clock.resume_at(host_nanos(5_007.45));
        assert_eq!(check(5_007.55, 4.2), 279_000);
        assert_eq!(timeline.start_ms(), Some(1_500));
    }

    fn host_nanos(secs: f64) -> u64 {
        (secs * 1e9).round() as u64
    }
}
