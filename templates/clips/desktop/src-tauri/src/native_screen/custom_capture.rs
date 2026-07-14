//! Custom ScreenCaptureKit capture engine.
//!
//! Owns everything between "SCStream hands us a sample buffer" and "a
//! fragmented MP4 grows on disk": the AVAssetWriter wrapper
//! (`CustomScreenCaptureWriter`), the realtime `LiveAudioMixer` that combines
//! mic + system audio into one track, the PCM decode/resample helpers, the
//! AVFoundation/CoreMedia FFI glue, and the capture watchdog that rebuilds a
//! stopped/stalled SCStream in place. Session management and live upload stay
//! in the parent `native_screen` module and the `live_upload` sibling.

use super::*;
use screencapturekit::error::SCError;
use screencapturekit::stream::delegate_trait::SCStreamDelegateTrait;

/// `AVAssetWriter.status` raw value for `.completed`.
const AV_WRITER_STATUS_COMPLETED: i64 = 2;
/// `kAudioFormatMPEG4AAC` FourCC ('aac ') for the writer's audio output.
const AUDIO_FORMAT_AAC: i64 = 0x6161_6320;
/// Cadence of delegate-produced output segments in segmented mode (seconds of
/// media time). Smaller = data becomes uploadable sooner, at a small
/// container-overhead cost.
const OUTPUT_SEGMENT_INTERVAL_SECONDS: i64 = 1;
/// Capture-time H.264 budget in bits per pixel per frame. 0.15 bpp matches
/// Cap's "instant" quality tier (~3.3 Mbps at 1280x720@24) and keeps most
/// recordings small enough to upload without a post-capture transcode.
const CAPTURE_VIDEO_BPP: f64 = 0.15;

// Self-healing capture watchdog. ScreenCaptureKit can silently stop feeding a
// display stream when the captured display changes Spaces (virtual desktops),
// a full-screen app takes over, or the display config changes — sometimes with
// a `did_stop_with_error` callback, sometimes by just going quiet. Either way
// the recording file stops growing with no app-level signal. The watchdog
// notices the gap and rebuilds the SCStream in place so recording continues.
//
// How long without any delivered sample buffer before we treat the stream as
// dead and rebuild it. Generous enough not to trip on a momentarily idle
// screen (SCK still delivers idle frames, which count as activity here).
const CAPTURE_STALL_TIMEOUT: Duration = Duration::from_secs(4);
// Watchdog poll cadence.
const CAPTURE_WATCHDOG_POLL: Duration = Duration::from_millis(1000);
// Consecutive failed restarts (rebuild or start error, or an immediate
// re-stall) before giving up and finalizing whatever was captured. A single
// successful stretch of frames resets the counter.
const CAPTURE_MAX_RESTARTS: u32 = 5;

/// Liveness state shared between the SCK output handler (which records that a
/// sample arrived), the stream delegate (which records an OS-reported stop),
/// and the watchdog thread (which reads both to decide when to rebuild the
/// stream).
pub(crate) struct CaptureWatch {
    /// Wall-clock time of the most recent delivered sample buffer.
    last_activity: Mutex<Instant>,
    /// Set by the stream delegate when ScreenCaptureKit reports the stream
    /// stopped. Consumed by the watchdog to force an immediate rebuild.
    stream_stopped: Mutex<Option<String>>,
    /// The user stopped capture through macOS itself (menu-bar "Stop
    /// Sharing", SCStreamError code -3817). The watchdog must treat this as
    /// a clean stop request, never as a failure to rebuild from.
    user_stopped: AtomicBool,
    /// True between pause and resume. The capture source (SCStream) is
    /// intentionally stopped while the writer/file/uploader stay alive, so
    /// the watchdog must not read the silence as a stall and rebuild — resume
    /// brings a fresh stream back and clears this.
    paused: AtomicBool,
}

impl CaptureWatch {
    fn new() -> Self {
        Self {
            last_activity: Mutex::new(Instant::now()),
            stream_stopped: Mutex::new(None),
            user_stopped: AtomicBool::new(false),
            paused: AtomicBool::new(false),
        }
    }

    fn note_activity(&self) {
        if let Ok(mut guard) = self.last_activity.lock() {
            *guard = Instant::now();
        }
    }

    fn since_activity(&self) -> Duration {
        self.last_activity
            .lock()
            .map(|t| t.elapsed())
            .unwrap_or_default()
    }

    fn note_stream_stopped(&self, reason: String) {
        if let Ok(mut guard) = self.stream_stopped.lock() {
            if guard.is_none() {
                *guard = Some(reason);
            }
        }
    }

    fn take_stream_stopped(&self) -> Option<String> {
        self.stream_stopped.lock().ok().and_then(|mut g| g.take())
    }

    fn note_user_stopped(&self) {
        self.user_stopped.store(true, Ordering::SeqCst);
    }

    fn user_stopped(&self) -> bool {
        self.user_stopped.load(Ordering::SeqCst)
    }

    fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::SeqCst);
    }

    fn is_paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }
}

// ---------------------------------------------------------------------------
// Segmented output (live-upload mode)
//
// With `movieFragmentInterval` + a writer-owned file, `finishWriting`
// DEFRAGMENTS the file in place (fragmented layout -> classic mdat+moov), so
// byte ranges streamed to the server during recording no longer match the
// final file and the uploaded clip comes back corrupt. The fix is Apple's
// segment API: the writer is created WITHOUT an output URL, produces discrete
// fMP4 segments through `AVAssetWriterDelegate`, and WE append them to the
// local file ourselves. AVFoundation never owns the file, so nothing is ever
// rewritten — the file is append-only by construction and the live uploader
// can safely tail it forever.
// ---------------------------------------------------------------------------

/// Owns the local recording file in segmented mode. The ObjC delegate appends
/// every segment it receives; append order matches delivery order (delegate
/// callbacks are serial, and the file mutex serializes any stragglers).
pub(super) struct SegmentSink {
    file: Mutex<std::fs::File>,
    /// First write error, if any; surfaced by `finish()` so a failing disk
    /// turns into a reported error instead of a silently truncated file.
    failed: Mutex<Option<String>>,
    segments: AtomicU64,
}

impl SegmentSink {
    fn create(path: &Path) -> Result<Arc<Self>, String> {
        let file = std::fs::File::create(path)
            .map_err(|e| format!("could not create recording file {}: {e}", path.display()))?;
        Ok(Arc::new(Self {
            file: Mutex::new(file),
            failed: Mutex::new(None),
            segments: AtomicU64::new(0),
        }))
    }

    fn append(&self, bytes: &[u8]) {
        use std::io::Write;
        let Ok(mut file) = self.file.lock() else {
            return;
        };
        if let Err(err) = file.write_all(bytes) {
            if let Ok(mut failed) = self.failed.lock() {
                if failed.is_none() {
                    eprintln!("[mixer] segment write failed: {err}");
                    *failed = Some(format!("segment write failed: {err}"));
                }
            }
            return;
        }
        let n = self.segments.fetch_add(1, Ordering::Relaxed) + 1;
        if n == 1 {
            eprintln!(
                "[mixer] first output segment written ({} bytes)",
                bytes.len()
            );
        }
    }

    fn failure(&self) -> Option<String> {
        self.failed.lock().ok().and_then(|guard| guard.clone())
    }
}

/// Instance variables for the segment delegate: just the shared sink.
struct SegmentDelegateIvars {
    sink: Arc<SegmentSink>,
}

objc2::define_class!(
    // SAFETY: NSObject has no subclassing requirements and the type has no
    // Drop impl. Methods are called by AVFoundation on its own serial queue.
    #[unsafe(super(objc2::runtime::NSObject))]
    #[name = "ClipsSegmentWriterDelegate"]
    #[ivars = SegmentDelegateIvars]
    struct SegmentWriterDelegate;

    impl SegmentWriterDelegate {
        /// `AVAssetWriterDelegate` — receives each fMP4 segment (type 1 =
        /// initialization, 2 = separable media) as it is produced.
        #[unsafe(method(assetWriter:didOutputSegmentData:segmentType:))]
        fn did_output_segment(
            &self,
            _writer: *mut objc2::runtime::AnyObject,
            data: *mut objc2::runtime::AnyObject,
            _segment_type: isize,
        ) {
            // Crossing the ObjC boundary: a Rust panic here would abort the
            // whole process, so contain it.
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                if data.is_null() {
                    return;
                }
                let (ptr, len): (*const std::ffi::c_void, usize) = unsafe {
                    (
                        objc2::msg_send![&*data, bytes],
                        objc2::msg_send![&*data, length],
                    )
                };
                if ptr.is_null() || len == 0 {
                    return;
                }
                let bytes = unsafe { std::slice::from_raw_parts(ptr as *const u8, len) };
                use objc2::DefinedClass;
                self.ivars().sink.append(bytes);
            }));
        }
    }
);

impl SegmentWriterDelegate {
    fn new(sink: Arc<SegmentSink>) -> objc2::rc::Retained<Self> {
        use objc2::AllocAnyThread;
        let this = Self::alloc().set_ivars(SegmentDelegateIvars { sink });
        unsafe { objc2::msg_send![super(this), init] }
    }
}

/// Cheap-to-clone handle around one `AVAssetWriter` producing a fragmented
/// MP4. SCK callbacks append through it from multiple dispatch queues; the
/// stop path calls [`Self::finish`]. All clones share the same underlying
/// state (everything inside is an `Arc`).
pub(crate) struct CustomScreenCaptureWriter {
    inner: Arc<Mutex<CustomScreenCaptureWriterState>>,
    /// Present only in live-mixing mode; combines the two incoming audio
    /// streams into the one track written to `mixed_audio_input`. Lives on its
    /// own lock so PCM mixing on the audio callbacks never blocks video frame
    /// appends (which only need `inner`). Lock order is always `mixer` →
    /// `inner`; never take `mixer` while holding `inner`.
    mixer: Option<Arc<Mutex<LiveAudioMixer>>>,
    /// The writer session has started (first video frame ran
    /// `startSessionAtSourceTime:`). Written under the `inner` lock, read
    /// lock-free by the audio callbacks.
    started: Arc<AtomicBool>,
    /// Source-time (seconds, as f64 bits) the writer session started at.
    /// `f64::NAN` until known; mixed audio earlier than this must be dropped
    /// or the writer rejects it. Written before `started` flips true.
    session_start_bits: Arc<AtomicU64>,
    /// Once true the writer accepts no more samples — set on stop, cancel, and
    /// any append failure.
    appends_closed: Arc<AtomicBool>,
    /// Samples skipped because an AVAssetWriterInput wasn't ready; logged
    /// periodically so realtime backpressure is visible.
    dropped_samples: Arc<AtomicU64>,
    /// Accumulated pause time (seconds, as f64 bits) to subtract from the
    /// zero-based session timeline so a pause/resume leaves no gap in the
    /// append-only file. Zero until the first resume. Read by the video
    /// retime path and the live audio mixer.
    pause_offset_bits: Arc<AtomicU64>,
}

/// The lock-guarded half of the writer: the retained AVFoundation objects
/// plus lifecycle flags. Every Objective-C call on these handles happens
/// while holding this state's mutex (see the SAFETY note below).
struct CustomScreenCaptureWriterState {
    writer: objc2::rc::Retained<objc2::runtime::AnyObject>,
    video_input: objc2::rc::Retained<objc2::runtime::AnyObject>,
    system_audio_input: Option<objc2::rc::Retained<objc2::runtime::AnyObject>>,
    mic_audio_input: Option<objc2::rc::Retained<objc2::runtime::AnyObject>>,
    /// Single output track used when mic + system audio are mixed live into one
    /// stream. Mutually exclusive with `system_audio_input` / `mic_audio_input`.
    mixed_audio_input: Option<objc2::rc::Retained<objc2::runtime::AnyObject>>,
    /// Segmented (delegate-fed) output mode; see the "Segmented output"
    /// section. When true, `initialSegmentStartTime` must be set before
    /// `startWriting`.
    segmented: bool,
    /// Local-file writer for segmented mode (we own the file, not
    /// AVFoundation). `None` in plain file mode.
    segment_sink: Option<Arc<SegmentSink>>,
    /// Keeps the ObjC delegate alive — `AVAssetWriter.delegate` is weak.
    #[allow(dead_code)]
    segment_delegate: Option<objc2::rc::Retained<SegmentWriterDelegate>>,
    /// First video frame's PTS as (value, timescale). In segmented mode the
    /// writer session starts at ZERO and every sample is rebased against this
    /// — the segment API preserves source timestamps verbatim, so appending
    /// raw host-clock PTS would give the clip a media timeline starting at
    /// "seconds since boot" (browsers then show wall-clock-like times).
    session_start_time: Option<(i64, i32)>,
    finished: bool,
    failed: Option<String>,
}

// SAFETY: `Retained<AnyObject>` is `!Send`/`!Sync` by default because objc2
// cannot know an arbitrary object's threading contract. Here every
// Objective-C call on the retained writer/input handles (`startWriting`,
// `startSessionAtSourceTime:`, `appendSampleBuffer:`, `markAsFinished`,
// `finishWriting…`, `status`/`error` reads) happens while holding the `inner`
// mutex, so access is serialized even though callbacks arrive on multiple SCK
// dispatch queues. The remaining shared fields are lock-free atomics
// (`started`, `session_start_bits`, `appends_closed`, `dropped_samples`), and
// the mixer holds no Objective-C state and lives behind its own mutex.
// Objective-C retain/release itself is atomic, so moving the retained
// pointers across threads is sound.
unsafe impl Send for CustomScreenCaptureWriter {}
unsafe impl Sync for CustomScreenCaptureWriter {}
unsafe impl Send for CustomScreenCaptureWriterState {}

#[derive(Clone)]
/// The `SCStreamOutputTrait` sink registered for all three output types
/// (screen / system audio / microphone). One instance is shared across the
/// registrations and across watchdog stream rebuilds, so the same writer
/// keeps receiving samples over the whole recording.
struct CustomScreenCaptureOutputHandler {
    writer: CustomScreenCaptureWriter,
    recording_enabled: Arc<AtomicBool>,
    mic_ready: Option<Arc<AtomicBool>>,
    watch: Arc<CaptureWatch>,
}

impl Clone for CustomScreenCaptureWriter {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
            mixer: self.mixer.clone(),
            started: Arc::clone(&self.started),
            session_start_bits: Arc::clone(&self.session_start_bits),
            appends_closed: Arc::clone(&self.appends_closed),
            dropped_samples: Arc::clone(&self.dropped_samples),
            pause_offset_bits: Arc::clone(&self.pause_offset_bits),
        }
    }
}

impl SCStreamOutputTrait for CustomScreenCaptureOutputHandler {
    fn did_output_sample_buffer(
        &self,
        sample_buffer: screencapturekit::cm::CMSampleBuffer,
        of_type: SCStreamOutputType,
    ) {
        if matches!(of_type, SCStreamOutputType::Microphone) {
            if let Some(mic_ready) = &self.mic_ready {
                mic_ready.store(true, Ordering::Relaxed);
            }
        }
        if !self.recording_enabled.load(Ordering::SeqCst) {
            return;
        }
        // A delivered buffer (even a content-less idle frame) proves the stream
        // is still alive; record it so the watchdog can tell a genuinely stalled
        // stream apart from a quiet one.
        self.watch.note_activity();
        if self.writer.appends_closed.load(Ordering::SeqCst) {
            return;
        }
        // Append every screen frame that carries an image buffer, INCLUDING
        // idle/blank ones. On a static screen (e.g. after switching to another
        // Space) ScreenCaptureKit delivers Idle frames; dropping them starves
        // the video track, and fragmented-MP4 interleaving then can't complete
        // a fragment — the file stops growing even though audio keeps flowing.
        // Idle frames still reference the current surface, and the encoder
        // turns repeats into tiny P-frames, so appending them is cheap. Only
        // frames with no image buffer are skipped (nothing to encode).
        if matches!(of_type, SCStreamOutputType::Screen) {
            use std::sync::atomic::AtomicU64;
            static SCREEN_SEEN: AtomicU64 = AtomicU64::new(0);
            static SCREEN_BUFFERLESS: AtomicU64 = AtomicU64::new(0);
            let seen = SCREEN_SEEN.fetch_add(1, Ordering::Relaxed) + 1;
            if sample_buffer.image_buffer().is_none() {
                let skipped = SCREEN_BUFFERLESS.fetch_add(1, Ordering::Relaxed) + 1;
                if skipped == 1 || skipped % 100 == 0 {
                    eprintln!(
                        "[mixer] screen frame without image buffer skipped ({skipped} so far, status={:?})",
                        sample_buffer.frame_status()
                    );
                }
                return;
            }
            if seen == 1 || seen % 512 == 0 {
                eprintln!(
                    "[mixer] screen frames delivered: seen={seen} bufferless={} status_now={:?}",
                    SCREEN_BUFFERLESS.load(Ordering::Relaxed),
                    sample_buffer.frame_status()
                );
            }
        }
        // ScreenCaptureKit invokes this from its own dispatch queues through an
        // Objective-C boundary. Two failure modes can abort the whole process:
        //   - an Objective-C exception (e.g. AVFoundation), which `catch_unwind`
        //     CANNOT catch ("Rust cannot catch foreign exceptions"), so we wrap
        //     the body in `objc2::exception::catch` first; and
        //   - a Rust panic, contained by the outer `catch_unwind`.
        // Either way we log the cause and cancel the capture instead of dying.
        let panic_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let exc_result = objc2::exception::catch(std::panic::AssertUnwindSafe(|| {
                self.writer.append_sample(&sample_buffer, of_type);
            }));
            if let Err(exc) = exc_result {
                let detail = describe_objc_exception(exc);
                eprintln!(
                    "[mixer] append_sample raised Objective-C exception for {of_type:?}: {detail}; cancelling capture"
                );
                self.writer.appends_closed.store(true, Ordering::SeqCst);
            }
        }));
        if panic_result.is_err() {
            eprintln!("[mixer] panic while appending {of_type:?} sample; cancelling capture");
            self.writer.appends_closed.store(true, Ordering::SeqCst);
        }
    }
}

impl CustomScreenCaptureWriter {
    /// Build the `AVAssetWriter` + inputs for one recording file. With live
    /// mixing (mic + system) a single mixed audio track is created;
    /// otherwise each captured source gets its own track. In live-upload
    /// mode the writer produces movie fragments (append-only file); without
    /// it, a regular MP4 with faststart.
    fn new(
        output_path: &Path,
        width: u32,
        height: u32,
        capture_system_audio: bool,
        include_audio: bool,
        mix_live: bool,
    ) -> Result<Self, String> {
        use objc2::msg_send;
        use objc2::runtime::AnyObject;

        #[link(name = "AVFoundation", kind = "framework")]
        extern "C" {
            static AVFileTypeMPEG4: *const AnyObject;
            static AVMediaTypeVideo: *const AnyObject;
            static AVFileTypeProfileMPEG4AppleHLS: *const AnyObject;
        }
        // Force-load UniformTypeIdentifiers so the runtime UTType lookup in
        // segmented mode resolves.
        #[link(name = "UniformTypeIdentifiers", kind = "framework")]
        extern "C" {}

        let segmented = crate::remote_flags::current().custom_sck_pipeline_live_upload_enabled;
        unsafe {
            let writer_cls = av_class_named("AVAssetWriter")
                .ok_or_else(|| "AVAssetWriter missing".to_string())?;

            let (writer, segment_sink, segment_delegate) = if segmented {
                // Segmented mode: the writer has NO output URL. It produces
                // discrete fMP4 segments through the delegate, and WE append
                // them to the local file — so the file is append-only by
                // construction and `finishWriting` cannot defragment/rewrite
                // it (which would invalidate live-uploaded byte ranges).
                let ident = av_ns_string_from("public.mpeg-4")
                    .ok_or_else(|| "NSString for UTType failed".to_string())?;
                let ut_cls =
                    av_class_named("UTType").ok_or_else(|| "UTType missing".to_string())?;
                let ut: *mut AnyObject = msg_send![ut_cls, typeWithIdentifier: &*ident];
                if ut.is_null() {
                    return Err("UTType public.mpeg-4 unavailable".into());
                }
                let allocated: *mut AnyObject = msg_send![writer_cls, alloc];
                let writer_raw: *mut AnyObject = msg_send![allocated, initWithContentType: ut];
                if writer_raw.is_null() {
                    if !allocated.is_null() {
                        let _ = objc2::rc::Retained::from_raw(allocated);
                    }
                    return Err("AVAssetWriter initWithContentType failed".into());
                }
                let writer = objc2::rc::Retained::from_raw(writer_raw)
                    .ok_or_else(|| "AVAssetWriter retain failed".to_string())?;

                let interval = ObjcCMTime {
                    value: OUTPUT_SEGMENT_INTERVAL_SECONDS,
                    timescale: 1,
                    flags: 1,
                    epoch: 0,
                };
                let _: () = msg_send![&*writer, setPreferredOutputSegmentInterval: interval];
                let _: () =
                    msg_send![&*writer, setOutputFileTypeProfile: AVFileTypeProfileMPEG4AppleHLS];

                let sink = SegmentSink::create(output_path)?;
                let delegate = SegmentWriterDelegate::new(Arc::clone(&sink));
                // `AVAssetWriter.delegate` is weak — the Retained delegate is
                // stored in the writer state to keep it alive.
                let _: () = msg_send![&*writer, setDelegate: &*delegate];
                (writer, Some(sink), Some(delegate))
            } else {
                // Plain file mode: AVFoundation owns the file; faststart is
                // safe because nothing tails the file during recording.
                let url = av_file_url(output_path).ok_or_else(|| {
                    format!("could not build output URL for {}", output_path.display())
                })?;
                let allocated: *mut AnyObject = msg_send![writer_cls, alloc];
                let mut err_ptr: *mut AnyObject = std::ptr::null_mut();
                let writer_raw: *mut AnyObject = msg_send![
                    allocated,
                    initWithURL: &*url,
                    fileType: AVFileTypeMPEG4,
                    error: &mut err_ptr
                ];
                if writer_raw.is_null() {
                    let detail = av_error_suffix(err_ptr);
                    if !allocated.is_null() {
                        let _ = objc2::rc::Retained::from_raw(allocated);
                    }
                    return Err(format!("AVAssetWriter init failed{detail}"));
                }
                let writer = objc2::rc::Retained::from_raw(writer_raw)
                    .ok_or_else(|| "AVAssetWriter retain failed".to_string())?;
                let _: () = msg_send![&*writer, setShouldOptimizeForNetworkUse: true];
                (writer, None, None)
            };
            let input_cls = av_class_named("AVAssetWriterInput")
                .ok_or_else(|| "AVAssetWriterInput missing".to_string())?;
            let video_settings = av_video_output_settings(width, height)?;
            let video_raw: *mut AnyObject = msg_send![
                input_cls,
                assetWriterInputWithMediaType: AVMediaTypeVideo,
                outputSettings: &*video_settings
            ];
            if video_raw.is_null() {
                return Err("AVAssetWriterInput video allocation failed".into());
            }
            let video_input = objc2::rc::Retained::retain(video_raw)
                .ok_or_else(|| "AVAssetWriterInput video retain failed".to_string())?;
            let _: () = msg_send![&*video_input, setExpectsMediaDataInRealTime: true];
            let can_add_video: bool = msg_send![&*writer, canAddInput: &*video_input];
            if !can_add_video {
                return Err("AVAssetWriter cannot add video input".into());
            }
            let _: () = msg_send![&*writer, addInput: &*video_input];

            // Live-mixing mode writes one combined audio track; otherwise each
            // captured source gets its own track (mixed later by ffmpeg, or
            // left as the single captured source).
            let (system_audio_input, mic_audio_input, mixed_audio_input, mixer) = if mix_live {
                let mixed = av_make_audio_writer_input(input_cls, &writer)?;
                (
                    None,
                    None,
                    Some(mixed),
                    Some(LiveAudioMixer::new(segmented)?),
                )
            } else {
                let system_audio_input = if capture_system_audio {
                    Some(av_make_audio_writer_input(input_cls, &writer)?)
                } else {
                    None
                };
                let mic_audio_input = if include_audio {
                    Some(av_make_audio_writer_input(input_cls, &writer)?)
                } else {
                    None
                };
                (system_audio_input, mic_audio_input, None, None)
            };

            Ok(Self {
                inner: Arc::new(Mutex::new(CustomScreenCaptureWriterState {
                    writer,
                    video_input,
                    system_audio_input,
                    mic_audio_input,
                    mixed_audio_input,
                    segmented,
                    segment_sink,
                    segment_delegate,
                    session_start_time: None,
                    finished: false,
                    failed: None,
                })),
                mixer: mixer.map(|m| Arc::new(Mutex::new(m))),
                started: Arc::new(AtomicBool::new(false)),
                session_start_bits: Arc::new(AtomicU64::new(f64::NAN.to_bits())),
                appends_closed: Arc::new(AtomicBool::new(false)),
                dropped_samples: Arc::new(AtomicU64::new(0)),
                pause_offset_bits: Arc::new(AtomicU64::new(0.0_f64.to_bits())),
            })
        }
    }

    /// Whether the writer runs the segmented (zero-based, append-only) output
    /// used by live upload. Only that mode rebases sample timestamps, so it's
    /// the only mode where a fresh SCStream can be spliced onto the same file.
    pub(super) fn segmented(&self) -> bool {
        self.inner.lock().map(|g| g.segmented).unwrap_or(false)
    }

    /// Whether the writer session has begun (first video frame appended).
    pub(super) fn is_started(&self) -> bool {
        self.started.load(Ordering::SeqCst)
    }

    /// Accumulated pause offset in seconds. Every appended sample skips this
    /// much wall-clock time so a pause/resume leaves no gap in the file.
    pub(super) fn pause_offset(&self) -> f64 {
        f64::from_bits(self.pause_offset_bits.load(Ordering::SeqCst))
    }

    /// Set the accumulated pause offset (clamped to non-negative). Resume reads
    /// the prior value, applies `prior + paused_for` once the replacement stream
    /// is about to start, and restores the prior value if startup fails — so a
    /// failed-then-retried resume never double-counts the same pause.
    pub(super) fn set_pause_offset(&self, seconds: f64) {
        self.pause_offset_bits
            .store(seconds.max(0.0).to_bits(), Ordering::SeqCst);
    }

    /// Route one SCK sample buffer to the right writer input. Mixed-mode
    /// audio goes through [`Self::append_mixed_audio`] (no writer lock while
    /// decoding); everything else appends directly under the `inner` lock.
    /// The first video frame starts the writer session.
    fn append_sample(
        &self,
        sample: &screencapturekit::cm::CMSampleBuffer,
        of_type: SCStreamOutputType,
    ) {
        // Live-mixing mode: mic + system audio are combined into one track
        // before being written, instead of going to separate inputs. Handled
        // before taking the writer lock — the decode/resample/mix work happens
        // on the audio callbacks and must not delay video frame appends.
        if self.mixer.is_some()
            && matches!(
                of_type,
                SCStreamOutputType::Audio | SCStreamOutputType::Microphone
            )
        {
            self.append_mixed_audio(sample, of_type);
            return;
        }

        let Ok(mut guard) = self.inner.lock() else {
            return;
        };
        if guard.finished || guard.failed.is_some() {
            return;
        }
        let input = match of_type {
            SCStreamOutputType::Screen => Some(guard.video_input.clone()),
            SCStreamOutputType::Audio => guard.system_audio_input.clone(),
            SCStreamOutputType::Microphone => guard.mic_audio_input.clone(),
        };
        let Some(input) = input else {
            return;
        };
        let timing = match sample.sample_timing_info(0) {
            Ok(timing) if timing.presentation_time_stamp.is_valid() => timing,
            _ => return,
        };

        unsafe {
            if !self.ensure_session_started(&mut guard, timing.presentation_time_stamp) {
                return;
            }
            if guard.segmented {
                // Segmented mode runs a ZERO-based session timeline: append a
                // copy with PTS/DTS rebased against the session start.
                // Appending the raw buffer here would put host-clock times in
                // the track — the writer then buffers/starves (frozen video)
                // and browsers show wall-clock timestamps.
                let Some(base) = guard.session_start_time else {
                    return;
                };
                let pause_offset = self.pause_offset();
                match retimed_sample_copy(sample, &timing, base, pause_offset) {
                    Ok(copy) => {
                        self.append_sample_ptr(&mut guard, &input, copy.as_ptr());
                    }
                    Err(err) => {
                        drop(guard);
                        self.fail(format!("sample retime failed: {err}"));
                    }
                }
            } else {
                self.append_sample_ptr(&mut guard, &input, sample.as_ptr());
            }
        }
    }

    /// Pull PCM out of an audio sample, push it into the mixer, then append any
    /// mixed buffers the mixer is ready to emit. The session is started by the
    /// video track, so emitted audio is held until that happens.
    ///
    /// Locking: PCM decode + resample run with no lock held; timeline placement
    /// and draining run under the mixer lock, which stays held through the
    /// appends below so two concurrently-draining audio callbacks can't
    /// interleave out-of-PTS-order appends; the writer (`inner`) lock is taken
    /// last, only around the actual appends.
    fn append_mixed_audio(
        &self,
        sample: &screencapturekit::cm::CMSampleBuffer,
        of_type: SCStreamOutputType,
    ) {
        let (source, label) = match of_type {
            SCStreamOutputType::Audio => (MixSource::System, "system"),
            SCStreamOutputType::Microphone => (MixSource::Mic, "mic"),
            _ => return,
        };
        // Heavy part (decode + resample) — pure function of the sample.
        let Some((interleaved, pts_seconds)) = extract_interleaved_stereo(sample, label) else {
            return;
        };

        let Some(mixer) = self.mixer.as_ref() else {
            return;
        };
        let Ok(mut mixer_guard) = mixer.lock() else {
            return;
        };
        mixer_guard.set_pause_offset(self.pause_offset());
        mixer_guard.push(source, &interleaved, pts_seconds);
        if !self.started.load(Ordering::SeqCst) {
            return;
        }
        let start_secs = f64::from_bits(self.session_start_bits.load(Ordering::SeqCst));
        if !start_secs.is_nan() {
            mixer_guard.set_min_start(start_secs);
        }
        let emitted = match mixer_guard.drain_ready(false) {
            Ok(buffers) => buffers,
            Err(err) => {
                drop(mixer_guard);
                self.fail(err);
                return;
            }
        };
        if emitted.is_empty() {
            return;
        }

        let Ok(mut guard) = self.inner.lock() else {
            return;
        };
        if guard.finished || guard.failed.is_some() {
            return;
        }
        let Some(input) = guard.mixed_audio_input.clone() else {
            return;
        };
        for buffer in &emitted {
            unsafe {
                self.append_sample_ptr(&mut guard, &input, buffer.as_ptr());
            }
            if guard.failed.is_some() {
                break;
            }
        }
    }

    /// Close the writer to further samples and record the failure reason.
    fn fail(&self, err: String) {
        self.appends_closed.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = self.inner.lock() {
            if guard.failed.is_none() {
                guard.failed = Some(err);
            }
        }
    }

    /// Start the writer session at the first video frame's PTS (once). Also
    /// publishes the session start time to the lock-free atomics the audio
    /// path reads. Returns false (and records the failure) if AVFoundation
    /// refuses to start.
    unsafe fn ensure_session_started(
        &self,
        guard: &mut CustomScreenCaptureWriterState,
        pts: screencapturekit::cm::CMTime,
    ) -> bool {
        use objc2::msg_send;

        if self.started.load(Ordering::SeqCst) {
            return true;
        }
        // `startWriting` / `startSessionAtSourceTime:` can raise Objective-C
        // exceptions (e.g. invalid state). Catch them so they don't abort the
        // process from inside the realtime callback.
        let writer_ptr = &*guard.writer as *const objc2::runtime::AnyObject;
        let segmented = guard.segmented;
        // Segmented mode: the session runs on a ZERO-based timeline and every
        // appended sample is rebased (see `session_start_time`). Plain file
        // mode keeps the source clock — `startSessionAtSourceTime:` writes an
        // implicit edit so playback still starts at zero there.
        let start = if segmented {
            ObjcCMTime {
                value: 0,
                timescale: pts.timescale.max(1),
                flags: 1,
                epoch: 0,
            }
        } else {
            ObjcCMTime::from(pts)
        };
        let outcome = objc2::exception::catch(std::panic::AssertUnwindSafe(|| unsafe {
            // Segmented output requires the initial segment start time to be
            // set before writing starts; it must equal the session start.
            if segmented {
                let _: () = msg_send![&*writer_ptr, setInitialSegmentStartTime: start];
            }
            let ok: bool = msg_send![&*writer_ptr, startWriting];
            if !ok {
                return false;
            }
            let _: () = msg_send![&*writer_ptr, startSessionAtSourceTime: start];
            true
        }));
        match outcome {
            Ok(true) => {
                guard.session_start_time = Some((pts.value, pts.timescale.max(1)));
                // Publish the session start time before flipping `started` so
                // lock-free readers that observe `started == true` always see
                // a valid start time.
                if let Some(secs) = pts.as_seconds() {
                    self.session_start_bits
                        .store(secs.to_bits(), Ordering::SeqCst);
                }
                self.started.store(true, Ordering::SeqCst);
                true
            }
            Ok(false) => {
                self.appends_closed.store(true, Ordering::SeqCst);
                guard.failed = Some(format!(
                    "AVAssetWriter startWriting failed{}",
                    av_writer_error_suffix(&guard.writer)
                ));
                false
            }
            Err(exc) => {
                self.appends_closed.store(true, Ordering::SeqCst);
                let detail = describe_objc_exception(exc);
                eprintln!("[mixer] startWriting raised Objective-C exception: {detail}");
                guard.failed = Some(format!("AVAssetWriter startWriting raised: {detail}"));
                false
            }
        }
    }

    /// Append one CMSampleBuffer to a writer input, containing Objective-C
    /// exceptions and recording any failure into `guard.failed`. Skips (and
    /// counts) samples when the input reports not-ready — realtime capture
    /// must never block the SCK callback.
    unsafe fn append_sample_ptr(
        &self,
        guard: &mut CustomScreenCaptureWriterState,
        input: &objc2::rc::Retained<objc2::runtime::AnyObject>,
        sample_ptr: *mut std::ffi::c_void,
    ) {
        use objc2::msg_send;

        let ready: bool = msg_send![&**input, isReadyForMoreMediaData];
        if !ready {
            // Realtime mode: skip rather than block the capture callback, but
            // count and periodically log so sustained backpressure is visible.
            let dropped = self.dropped_samples.fetch_add(1, Ordering::Relaxed) + 1;
            if dropped == 1 || dropped % 100 == 0 {
                eprintln!("[mixer] writer input not ready; dropped {dropped} sample(s) so far");
            }
            return;
        }
        // `appendSampleBuffer:` throws Objective-C exceptions on bad input
        // (format/timestamp/state). Those can't be caught by `catch_unwind`
        // and would abort the app, so contain them here.
        let input_ptr = &**input as *const objc2::runtime::AnyObject;
        let outcome = objc2::exception::catch(std::panic::AssertUnwindSafe(|| unsafe {
            let appended: bool = msg_send![&*input_ptr, appendSampleBuffer: sample_ptr];
            appended
        }));
        match outcome {
            Ok(true) => {}
            Ok(false) => {
                self.appends_closed.store(true, Ordering::SeqCst);
                guard.failed = Some(format!(
                    "AVAssetWriter appendSampleBuffer failed{}",
                    av_writer_error_suffix(&guard.writer)
                ));
            }
            Err(exc) => {
                self.appends_closed.store(true, Ordering::SeqCst);
                let detail = describe_objc_exception(exc);
                eprintln!("[mixer] appendSampleBuffer raised Objective-C exception: {detail}");
                guard.failed = Some(format!("AVAssetWriter appendSampleBuffer raised: {detail}"));
            }
        }
    }

    /// Stop accepting samples, flush audio still held by the mixer, mark all
    /// inputs finished, and finalize the file. With `wait_for_finalize` the
    /// call blocks (bounded) until AVFoundation completes and verifies the
    /// writer status; without it, finalization completes in the background
    /// (the fragmented file is already playable up to the last fragment).
    pub(super) fn finish(&self, wait_for_finalize: bool) -> Result<(), String> {
        self.appends_closed.store(true, Ordering::SeqCst);
        let dropped = self.dropped_samples.load(Ordering::Relaxed);
        eprintln!(
            "[mixer] writer finish requested (wait={wait_for_finalize}, dropped_samples={dropped})"
        );

        // Flush any audio still held in the mixer (treating a missing source as
        // silence) before we tear the writer down. Lock order: mixer → inner.
        if let Some(mixer) = self.mixer.as_ref() {
            if self.started.load(Ordering::SeqCst) {
                let mut mixer_guard = mixer.lock().map_err(|e| e.to_string())?;
                let start_secs = f64::from_bits(self.session_start_bits.load(Ordering::SeqCst));
                if !start_secs.is_nan() {
                    mixer_guard.set_min_start(start_secs);
                }
                let emitted = mixer_guard.drain_ready(true);
                let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
                if !guard.finished && guard.failed.is_none() {
                    match emitted {
                        Ok(buffers) => {
                            if let Some(input) = guard.mixed_audio_input.clone() {
                                for buffer in &buffers {
                                    unsafe {
                                        self.append_sample_ptr(&mut guard, &input, buffer.as_ptr());
                                    }
                                    if guard.failed.is_some() {
                                        break;
                                    }
                                }
                            }
                        }
                        Err(err) => {
                            guard.failed = Some(err);
                        }
                    }
                }
            }
        }

        let (
            writer,
            video_input,
            system_audio_input,
            mic_audio_input,
            mixed_audio_input,
            segment_sink,
            started,
            failed,
        ) = {
            let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
            if guard.finished {
                return guard.failed.clone().map_or(Ok(()), Err);
            }
            guard.finished = true;
            (
                guard.writer.clone(),
                guard.video_input.clone(),
                guard.system_audio_input.clone(),
                guard.mic_audio_input.clone(),
                guard.mixed_audio_input.clone(),
                guard.segment_sink.clone(),
                self.started.load(Ordering::SeqCst),
                guard.failed.clone(),
            )
        };
        if let Some(err) = failed {
            return Err(err);
        }
        unsafe {
            use block2::RcBlock;
            use objc2::msg_send;
            use std::sync::mpsc;
            use std::time::Duration as StdDuration;

            if !started {
                let _: () = msg_send![&*writer, cancelWriting];
                return Err("AVAssetWriter received no samples".into());
            }
            let _: () = msg_send![&*video_input, markAsFinished];
            if let Some(input) = system_audio_input.as_ref() {
                let _: () = msg_send![&**input, markAsFinished];
            }
            if let Some(input) = mic_audio_input.as_ref() {
                let _: () = msg_send![&**input, markAsFinished];
            }
            if let Some(input) = mixed_audio_input.as_ref() {
                let _: () = msg_send![&**input, markAsFinished];
            }

            let (tx, rx) = mpsc::sync_channel::<()>(1);
            let block = RcBlock::new(move || {
                let _ = tx.send(());
            });
            let _: () = msg_send![&*writer, finishWritingWithCompletionHandler: &*block];
            if wait_for_finalize && rx.recv_timeout(StdDuration::from_secs(15)).is_err() {
                let _: () = msg_send![&*writer, cancelWriting];
                return Err("AVAssetWriter finalize timed out".into());
            }
            if wait_for_finalize {
                let status: i64 = msg_send![&*writer, status];
                if status != AV_WRITER_STATUS_COMPLETED {
                    return Err(format!(
                        "AVAssetWriter finalize failed (status={status}{})",
                        av_writer_error_suffix(&writer)
                    ));
                }
            }
        }
        // Segmented mode: the delegate delivers the final segment before the
        // completion handler fires, so by now the local file is complete —
        // unless a disk write failed along the way.
        if let Some(sink) = segment_sink.as_ref() {
            if let Some(err) = sink.failure() {
                return Err(err);
            }
        }
        eprintln!("[mixer] writer finish completed (wait={wait_for_finalize})");
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Live audio mixer
//
// Combines the two ScreenCaptureKit audio streams (system + mic) into a single
// interleaved-stereo track in real time, so the recorded file already has one
// mixed audio track and no post-recording ffmpeg mixing pass is needed.
//
// The hard part is that the two streams arrive on independent callbacks with
// their own timestamps and can start late (mic warmup) or stall. We place each
// stream on a shared sample timeline (anchored to the first audio sample),
// zero-filling gaps, and only emit output up to the point where we have data we
// trust from every still-active source.
// ---------------------------------------------------------------------------

/// Frames per emitted mixed buffer (~85ms at 48kHz).
const MIX_CHUNK_FRAMES: i64 = 4096;
/// A source with no data for this long stops bounding output (treated as
/// silent) so one stalled source can't freeze the mixed track.
const MIX_STALL_TIMEOUT: Duration = Duration::from_millis(250);
/// How long after mixer creation to keep waiting for a source that hasn't
/// produced its first buffer (mic warmup); afterwards it counts as absent.
const MIX_SOURCE_GRACE: Duration = Duration::from_millis(2000);
const AUDIO_FORMAT_LPCM: u32 = 0x6C70_636D; // 'lpcm'
const AUDIO_FORMAT_FLAGS_FLOAT_PACKED: u32 = 1 | 8; // float + packed, interleaved, little-endian

#[derive(Clone, Copy, PartialEq, Eq)]
/// Which capture stream a pushed PCM chunk came from.
enum MixSource {
    System,
    Mic,
}

/// One source's contiguous PCM ring on the shared output timeline. Gaps
/// between pushes are zero-filled; consumed frames are dropped from the
/// front as the mixer emits.
struct MixerTimeline {
    /// Absolute frame index (anchor = 0) of `samples[0]`.
    base_frame: i64,
    /// Interleaved stereo f32 samples from `base_frame` onward.
    samples: Vec<f32>,
    started: bool,
    last_push: Option<Instant>,
}

impl MixerTimeline {
    fn new() -> Self {
        Self {
            base_frame: 0,
            samples: Vec::new(),
            started: false,
            last_push: None,
        }
    }

    /// One past the last frame this source has data for (absolute index).
    fn end_frame(&self) -> i64 {
        self.base_frame + (self.samples.len() / 2) as i64
    }

    /// Stereo sample at an absolute frame index; silence outside the
    /// buffered range, so callers never need bounds checks.
    fn sample_at(&self, frame: i64) -> (f32, f32) {
        if frame < self.base_frame {
            return (0.0, 0.0);
        }
        let offset = ((frame - self.base_frame) as usize) * 2;
        if offset + 1 < self.samples.len() {
            (self.samples[offset], self.samples[offset + 1])
        } else {
            (0.0, 0.0)
        }
    }
}

enum SourceBound {
    /// Started and recently fed; bounds output to `end_frame`.
    Active(i64),
    /// Started but no recent data; treat beyond its data as silence.
    Stalled,
    /// Not started yet but still within the warmup grace window; hold output.
    Pending,
    /// Not started and past grace; treat as silent.
    Absent,
}

/// Realtime mic + system mixer. Places each source on a shared 48kHz
/// stereo timeline anchored at the first audio PTS, then emits summed
/// chunks up to the point every still-active source has data for. See the
/// section comment above for the full design rationale.
struct LiveAudioMixer {
    format_desc: screencapturekit::cm::CMFormatDescription,
    sample_rate: i32,
    /// Subtract the writer session start from emitted PTS (segmented mode,
    /// where the session timeline is zero-based). Plain file mode keeps
    /// absolute source time to match `startSessionAtSourceTime:`.
    rebase_output: bool,
    /// Session start in source seconds, recorded by `set_min_start`.
    session_start_seconds: Option<f64>,
    /// Accumulated pause time (seconds) subtracted from every incoming source
    /// PTS so a pause/resume leaves no gap on the audio timeline — mirrors the
    /// video path's `pause_offset`.
    pause_offset_seconds: f64,
    anchor_seconds: Option<f64>,
    out_pos: i64,
    system: MixerTimeline,
    mic: MixerTimeline,
    created_at: Instant,
}

impl LiveAudioMixer {
    fn new(rebase_output: bool) -> Result<Self, String> {
        let sample_rate = AUDIO_OUTPUT_SAMPLE_RATE as i32;
        let asbd = AudioStreamBasicDescription {
            sample_rate: AUDIO_OUTPUT_SAMPLE_RATE as f64,
            format_id: AUDIO_FORMAT_LPCM,
            format_flags: AUDIO_FORMAT_FLAGS_FLOAT_PACKED,
            bytes_per_packet: 8,
            frames_per_packet: 1,
            bytes_per_frame: 8,
            channels_per_frame: 2,
            bits_per_channel: 32,
            reserved: 0,
        };
        let mut desc: *mut std::ffi::c_void = std::ptr::null_mut();
        let status = unsafe {
            CMAudioFormatDescriptionCreate(
                std::ptr::null(),
                &asbd,
                0,
                std::ptr::null(),
                0,
                std::ptr::null(),
                std::ptr::null(),
                &mut desc,
            )
        };
        if status != 0 || desc.is_null() {
            return Err(format!(
                "CMAudioFormatDescriptionCreate failed (status={status})"
            ));
        }
        let format_desc = screencapturekit::cm::CMFormatDescription::from_raw(desc)
            .ok_or_else(|| "CMAudioFormatDescription wrap failed".to_string())?;
        Ok(Self {
            format_desc,
            sample_rate,
            rebase_output,
            session_start_seconds: None,
            pause_offset_seconds: 0.0,
            anchor_seconds: None,
            out_pos: 0,
            system: MixerTimeline::new(),
            mic: MixerTimeline::new(),
            created_at: Instant::now(),
        })
    }

    /// Place decoded PCM on the source's timeline at its PTS-derived frame
    /// position, zero-filling any gap since the previous push (capped so a
    /// glitched timestamp can't allocate gigabytes).
    fn push(&mut self, source: MixSource, interleaved: &[f32], pts_seconds: f64) {
        let frames = interleaved.len() / 2;
        if frames == 0 {
            return;
        }
        // Collapse the paused gap: pull post-resume audio back onto the
        // continuous timeline so its frame positions abut the pre-pause data
        // instead of leaving a silence hole (which `push` would otherwise cap
        // at `max_gap` and desync from the video track).
        let pts_seconds = pts_seconds - self.pause_offset_seconds;
        let anchor = *self.anchor_seconds.get_or_insert(pts_seconds);
        let frame_index =
            (((pts_seconds - anchor) * self.sample_rate as f64).round() as i64).max(0);
        let out_pos = self.out_pos;
        // Cap silence inserted for a timestamp gap. A glitched/discontinuous
        // PTS could otherwise compute a multi-billion-frame gap and try to
        // allocate gigabytes of zeros, aborting the process.
        let max_gap = self.sample_rate as i64 * 2;
        let timeline = match source {
            MixSource::System => &mut self.system,
            MixSource::Mic => &mut self.mic,
        };
        if !timeline.started {
            timeline.started = true;
            // Never start behind already-emitted output.
            timeline.base_frame = frame_index.max(out_pos);
        }
        let cur_end = timeline.end_frame();
        if frame_index > cur_end {
            let gap = (frame_index - cur_end).min(max_gap) as usize;
            timeline
                .samples
                .extend(std::iter::repeat(0.0_f32).take(gap * 2));
        }
        timeline.samples.extend_from_slice(interleaved);
        timeline.last_push = Some(Instant::now());
    }

    /// Update the accumulated pause offset (seconds) applied to incoming
    /// source PTS in `push`. Set from the writer's shared offset on resume.
    fn set_pause_offset(&mut self, seconds: f64) {
        self.pause_offset_seconds = seconds;
    }

    /// Advance the output cursor so we never emit audio earlier than the
    /// writer session start (the writer rejects samples before it).
    fn set_min_start(&mut self, start_seconds: f64) {
        self.session_start_seconds = Some(start_seconds);
        if let Some(anchor) = self.anchor_seconds {
            // ceil, not round: rounding down would place the first emitted
            // sample a fraction of a frame BEFORE the session start, which
            // AVAssetWriter can reject when it writes the fragment.
            let floor = (((start_seconds - anchor) * self.sample_rate as f64).ceil() as i64).max(0);
            if floor > self.out_pos {
                self.out_pos = floor;
                self.drain_consumed();
            }
        }
    }

    /// How a source currently bounds output: actively feeding (bound to its
    /// data end), stalled/absent (ignored), or still warming up (holds all
    /// output back).
    fn classify(&self, timeline: &MixerTimeline, now: Instant) -> SourceBound {
        if !timeline.started {
            if now.duration_since(self.created_at) < MIX_SOURCE_GRACE {
                SourceBound::Pending
            } else {
                SourceBound::Absent
            }
        } else if timeline
            .last_push
            .map_or(true, |t| now.duration_since(t) >= MIX_STALL_TIMEOUT)
        {
            SourceBound::Stalled
        } else {
            SourceBound::Active(timeline.end_frame())
        }
    }

    /// The frame up to which mixing is safe: the minimum data end across
    /// active sources (or everything buffered when flushing at stop).
    fn compute_safe_end(&self, flush: bool) -> i64 {
        if flush {
            return self.system.end_frame().max(self.mic.end_frame());
        }
        let now = Instant::now();
        let sys = self.classify(&self.system, now);
        let mic = self.classify(&self.mic, now);
        if matches!(sys, SourceBound::Pending) || matches!(mic, SourceBound::Pending) {
            // Still expecting a source to start; don't run ahead of it.
            return self.out_pos;
        }
        let mut bound = i64::MAX;
        let mut any_active = false;
        for b in [&sys, &mic] {
            if let SourceBound::Active(end) = b {
                bound = bound.min(*end);
                any_active = true;
            }
        }
        if any_active {
            bound
        } else {
            // Everything stalled/absent: drain whatever frozen data we have.
            self.system.end_frame().max(self.mic.end_frame())
        }
    }

    /// Emit mixed sample buffers covering `out_pos..safe_end` in
    /// `MIX_CHUNK_FRAMES` chunks: sum system + mic per frame, clamp, wrap as
    /// LPCM `CMSampleBuffer`s with contiguous PTS.
    fn drain_ready(
        &mut self,
        flush: bool,
    ) -> Result<Vec<screencapturekit::cm::CMSampleBuffer>, String> {
        if self.anchor_seconds.is_none() {
            return Ok(Vec::new());
        }
        let safe_end = self.compute_safe_end(flush);
        if safe_end <= self.out_pos {
            return Ok(Vec::new());
        }
        let mut emitted = Vec::new();
        let mut a = self.out_pos;
        while a < safe_end {
            let b = (a + MIX_CHUNK_FRAMES).min(safe_end);
            let n = (b - a) as usize;
            let mut interleaved = vec![0.0_f32; n * 2];
            for f in 0..n {
                let frame = a + f as i64;
                let (sl, sr) = self.system.sample_at(frame);
                let (ml, mr) = self.mic.sample_at(frame);
                interleaved[f * 2] = (sl + ml).clamp(-1.0, 1.0);
                interleaved[f * 2 + 1] = (sr + mr).clamp(-1.0, 1.0);
            }
            emitted.push(self.build_sample_buffer(&interleaved, a)?);
            a = b;
        }
        self.out_pos = safe_end;
        self.drain_consumed();
        Ok(emitted)
    }

    /// Free PCM below the output cursor from both timelines (already mixed
    /// and emitted; `sample_at` treats it as silence if ever re-read).
    fn drain_consumed(&mut self) {
        let out_pos = self.out_pos;
        for timeline in [&mut self.system, &mut self.mic] {
            if out_pos > timeline.base_frame {
                let drop_frames = (out_pos - timeline.base_frame) as usize;
                let drop_samples = (drop_frames * 2).min(timeline.samples.len());
                timeline.samples.drain(0..drop_samples);
                timeline.base_frame = out_pos;
            }
        }
    }

    /// Wrap raw interleaved f32 PCM as a ready-to-append LPCM
    /// `CMSampleBuffer` whose PTS continues the mixer's output timeline.
    fn build_sample_buffer(
        &self,
        interleaved: &[f32],
        start_frame: i64,
    ) -> Result<screencapturekit::cm::CMSampleBuffer, String> {
        let frames = interleaved.len() / 2;
        let bytes = unsafe {
            std::slice::from_raw_parts(
                interleaved.as_ptr() as *const u8,
                std::mem::size_of_val(interleaved),
            )
        };
        let block = screencapturekit::cm::CMBlockBuffer::create(bytes)
            .ok_or_else(|| "CMBlockBuffer create failed".to_string())?;
        let anchor = self.anchor_seconds.unwrap_or(0.0);
        // Zero-based session timeline: emit PTS relative to the session start
        // (set_min_start guarantees emitted frames are never earlier than it).
        let base = if self.rebase_output {
            self.session_start_seconds.unwrap_or(anchor)
        } else {
            0.0
        };
        let pts_value = ((anchor - base) * self.sample_rate as f64).round() as i64 + start_frame;
        let pts = ObjcCMTime {
            value: pts_value,
            timescale: self.sample_rate,
            flags: 1,
            epoch: 0,
        };
        let mut out: *mut std::ffi::c_void = std::ptr::null_mut();
        let status = unsafe {
            CMAudioSampleBufferCreateReadyWithPacketDescriptions(
                std::ptr::null(),
                block.as_ptr(),
                self.format_desc.as_ptr(),
                frames as isize,
                pts,
                std::ptr::null(),
                &mut out,
            )
        };
        if status != 0 || out.is_null() {
            return Err(format!(
                "CMAudioSampleBufferCreate failed (status={status})"
            ));
        }
        screencapturekit::cm::CMSampleBuffer::from_raw(out)
            .ok_or_else(|| "CMSampleBuffer wrap failed".to_string())
    }
}

/// Decode little-endian f32 samples from a CoreMedia byte buffer. Copies
/// instead of reinterpreting the pointer: CoreAudio makes no alignment
/// guarantee, and casting an unaligned `*const u8` to `&[f32]` is undefined
/// behavior.
fn bytes_to_f32_vec(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect()
}

// CoreAudio format flags (AudioFormatFlags).
const K_AUDIO_FLAG_IS_FLOAT: u32 = 1 << 0;
const K_AUDIO_FLAG_IS_SIGNED_INT: u32 = 1 << 2;

/// Render a caught Objective-C exception (name + reason) for logging.
fn describe_objc_exception(
    exc: Option<objc2::rc::Retained<objc2::exception::Exception>>,
) -> String {
    match exc {
        Some(e) => format!("{e:?}"),
        None => "unknown Objective-C exception".to_string(),
    }
}

/// Read the source stream's `AudioStreamBasicDescription` (rate, channels,
/// sample format) off a sample buffer; `None` when unavailable.
fn source_asbd(
    sample: &screencapturekit::cm::CMSampleBuffer,
) -> Option<AudioStreamBasicDescription> {
    let format = sample.format_description()?;
    let asbd = unsafe { CMAudioFormatDescriptionGetStreamBasicDescription(format.as_ptr()) };
    if asbd.is_null() {
        return None;
    }
    Some(unsafe { std::ptr::read(asbd) })
}

/// Decode one audio buffer's raw bytes into f32 samples according to the
/// stream's sample format (float32/float64 or signed int16/int32).
fn decode_samples_to_f32(bytes: &[u8], is_float: bool, bits: u32) -> Vec<f32> {
    match (is_float, bits) {
        (true, 32) => bytes_to_f32_vec(bytes),
        (true, 64) => bytes
            .chunks_exact(8)
            .map(|c| f64::from_le_bytes(c.try_into().unwrap()) as f32)
            .collect(),
        (false, 16) => bytes
            .chunks_exact(2)
            .map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0)
            .collect(),
        (false, 32) => bytes
            .chunks_exact(4)
            .map(|c| i32::from_le_bytes(c.try_into().unwrap()) as f32 / 2_147_483_648.0)
            .collect(),
        // Unknown: best-effort treat as float32.
        _ => bytes_to_f32_vec(bytes),
    }
}

/// Resample interleaved-stereo f32 from `src_rate` to `dst_rate` with linear
/// interpolation. ScreenCaptureKit delivers the microphone at its native rate
/// (often 44.1 kHz / mono-upmixed), which is not the 48 kHz the mixer assumes;
/// without this the mic plays back pitch-shifted and unintelligible.
fn resample_interleaved_stereo(input: &[f32], src_rate: f64, dst_rate: f64) -> Vec<f32> {
    let in_frames = input.len() / 2;
    if in_frames == 0 || src_rate <= 0.0 || dst_rate <= 0.0 || (src_rate - dst_rate).abs() < 1.0 {
        return input.to_vec();
    }
    let ratio = dst_rate / src_rate;
    let out_frames = ((in_frames as f64) * ratio).round() as usize;
    if out_frames == 0 {
        return Vec::new();
    }
    let mut out = vec![0.0_f32; out_frames * 2];
    let step = src_rate / dst_rate;
    for f in 0..out_frames {
        let pos = f as f64 * step;
        let i = pos.floor() as usize;
        let frac = (pos - i as f64) as f32;
        let i1 = (i + 1).min(in_frames - 1);
        for ch in 0..2 {
            let a = input[i * 2 + ch];
            let b = input[i1 * 2 + ch];
            out[f * 2 + ch] = a + (b - a) * frac;
        }
    }
    out
}

fn extract_interleaved_stereo(
    sample: &screencapturekit::cm::CMSampleBuffer,
    label: &str,
) -> Option<(Vec<f32>, f64)> {
    let frames = sample.num_samples();
    if frames == 0 {
        return None;
    }
    let timing = sample.sample_timing_info(0).ok()?;
    let pts_seconds = timing.presentation_time_stamp.as_seconds()?;
    let abl = sample.audio_buffer_list()?;
    let num_buffers = abl.num_buffers();
    if num_buffers == 0 {
        return None;
    }

    let asbd = source_asbd(sample);
    let (is_float, bits, src_rate) = match asbd {
        Some(a) => {
            // If neither float nor signed-int is flagged, assume float (SCK default).
            let is_float = a.format_flags & K_AUDIO_FLAG_IS_FLOAT != 0
                || a.format_flags & K_AUDIO_FLAG_IS_SIGNED_INT == 0;
            (is_float, a.bits_per_channel, a.sample_rate)
        }
        None => (true, 32, AUDIO_OUTPUT_SAMPLE_RATE as f64),
    };

    log_audio_format_once(label, &asbd, num_buffers, &abl, frames);

    let mut out = vec![0.0_f32; frames * 2];
    if num_buffers >= 2 {
        // Non-interleaved (planar): one channel per buffer.
        let left = decode_samples_to_f32(abl.get(0)?.data(), is_float, bits);
        let right = decode_samples_to_f32(abl.get(1)?.data(), is_float, bits);
        let n = frames.min(left.len()).min(right.len());
        for i in 0..n {
            out[i * 2] = left[i];
            out[i * 2 + 1] = right[i];
        }
    } else {
        let buf = abl.get(0)?;
        let channels = buf.number_channels.max(1) as usize;
        let decoded = decode_samples_to_f32(buf.data(), is_float, bits);
        if channels >= 2 {
            // Interleaved multi-channel: take the first two channels.
            let n = frames.min(decoded.len() / channels);
            for i in 0..n {
                out[i * 2] = decoded[i * channels];
                out[i * 2 + 1] = decoded[i * channels + 1];
            }
        } else {
            // Mono: duplicate into both channels.
            let n = frames.min(decoded.len());
            for i in 0..n {
                out[i * 2] = decoded[i];
                out[i * 2 + 1] = decoded[i];
            }
        }
    }

    // Normalize every source to the mixer's output rate so contiguous placement
    // on the timeline matches real time (otherwise the mic is pitch-shifted).
    out = resample_interleaved_stereo(&out, src_rate, AUDIO_OUTPUT_SAMPLE_RATE as f64);
    Some((out, pts_seconds))
}

/// Logs the decoded audio format the first time each source is seen, so format
/// mismatches (rate / channels / int-vs-float / interleaving) are diagnosable.
fn log_audio_format_once(
    label: &str,
    asbd: &Option<AudioStreamBasicDescription>,
    num_buffers: usize,
    abl: &screencapturekit::cm::AudioBufferList,
    frames: usize,
) {
    use std::sync::atomic::AtomicBool;
    static SYS_LOGGED: AtomicBool = AtomicBool::new(false);
    static MIC_LOGGED: AtomicBool = AtomicBool::new(false);
    let flag = if label == "mic" {
        &MIC_LOGGED
    } else {
        &SYS_LOGGED
    };
    if flag.swap(true, Ordering::SeqCst) {
        return;
    }
    let ch0 = abl.get(0).map(|b| (b.number_channels, b.data_byte_size()));
    let ch1 = abl.get(1).map(|b| (b.number_channels, b.data_byte_size()));
    eprintln!(
        "[mixer] {label} format: asbd={asbd:?} num_buffers={num_buffers} frames={frames} buf0={ch0:?} buf1={ch1:?}"
    );
}

/// Mirror of CoreAudio's `AudioStreamBasicDescription` (repr(C) so it can
/// cross the FFI boundary by value).
#[repr(C)]
#[derive(Copy, Clone, Debug)]
struct AudioStreamBasicDescription {
    sample_rate: f64,
    format_id: u32,
    format_flags: u32,
    bytes_per_packet: u32,
    frames_per_packet: u32,
    bytes_per_frame: u32,
    channels_per_frame: u32,
    bits_per_channel: u32,
    reserved: u32,
}

/// `CMSampleTimingInfo` mirror for the retiming FFI call.
#[repr(C)]
#[derive(Copy, Clone)]
struct ObjcCMSampleTimingInfo {
    duration: ObjcCMTime,
    presentation_time_stamp: ObjcCMTime,
    decode_time_stamp: ObjcCMTime,
}

/// Rebase a timestamp onto the zero-based session timeline (subtract the
/// first video frame's PTS). `pause_offset_seconds` is additionally subtracted
/// so time spent paused collapses to nothing — the file stays gapless across a
/// pause/resume. Invalid times pass through untouched.
fn rebased_time(
    t: screencapturekit::cm::CMTime,
    base: (i64, i32),
    pause_offset_seconds: f64,
) -> ObjcCMTime {
    const K_CMTIME_FLAG_VALID: u32 = 1;
    if t.flags & K_CMTIME_FLAG_VALID == 0 {
        return ObjcCMTime::from(t);
    }
    let (base_value, base_timescale) = base;
    let base_in_t = if t.timescale == base_timescale {
        base_value
    } else {
        // Convert the base into this timestamp's timescale before subtracting.
        (i128::from(base_value) * i128::from(t.timescale) / i128::from(base_timescale.max(1)))
            as i64
    };
    // Convert the accumulated pause time into this timestamp's timescale.
    let pause_in_t = (pause_offset_seconds * f64::from(t.timescale)).round() as i64;
    ObjcCMTime {
        value: t.value - base_in_t - pause_in_t,
        timescale: t.timescale,
        flags: t.flags,
        epoch: t.epoch,
    }
}

/// Copy a sample buffer with its PTS/DTS rebased onto the session timeline.
/// One timing entry applies to every sample in the buffer (SCK video buffers
/// hold one frame; audio buffers have uniform per-sample timing).
fn retimed_sample_copy(
    sample: &screencapturekit::cm::CMSampleBuffer,
    timing: &screencapturekit::cm::CMSampleTimingInfo,
    base: (i64, i32),
    pause_offset_seconds: f64,
) -> Result<screencapturekit::cm::CMSampleBuffer, String> {
    let new_timing = ObjcCMSampleTimingInfo {
        duration: ObjcCMTime::from(timing.duration),
        presentation_time_stamp: rebased_time(
            timing.presentation_time_stamp,
            base,
            pause_offset_seconds,
        ),
        decode_time_stamp: rebased_time(timing.decode_time_stamp, base, pause_offset_seconds),
    };
    let mut out: *mut std::ffi::c_void = std::ptr::null_mut();
    let status = unsafe {
        CMSampleBufferCreateCopyWithNewTiming(
            std::ptr::null(),
            sample.as_ptr(),
            1,
            &new_timing,
            &mut out,
        )
    };
    if status != 0 || out.is_null() {
        return Err(format!(
            "CMSampleBufferCreateCopyWithNewTiming failed (status={status})"
        ));
    }
    screencapturekit::cm::CMSampleBuffer::from_raw(out)
        .ok_or_else(|| "retimed CMSampleBuffer wrap failed".to_string())
}

// CoreMedia C API used to hand-build the mixer's LPCM output buffers —
// the screencapturekit crate has no constructors for these.
#[link(name = "CoreMedia", kind = "framework")]
extern "C" {
    fn CMAudioFormatDescriptionCreate(
        allocator: *const std::ffi::c_void,
        asbd: *const AudioStreamBasicDescription,
        layout_size: usize,
        layout: *const std::ffi::c_void,
        magic_cookie_size: usize,
        magic_cookie: *const std::ffi::c_void,
        extensions: *const std::ffi::c_void,
        format_description_out: *mut *mut std::ffi::c_void,
    ) -> i32;

    fn CMAudioSampleBufferCreateReadyWithPacketDescriptions(
        allocator: *const std::ffi::c_void,
        data_buffer: *mut std::ffi::c_void,
        format_description: *mut std::ffi::c_void,
        num_samples: isize,
        presentation_time_stamp: ObjcCMTime,
        packet_descriptions: *const std::ffi::c_void,
        sample_buffer_out: *mut *mut std::ffi::c_void,
    ) -> i32;

    fn CMAudioFormatDescriptionGetStreamBasicDescription(
        format_description: *mut std::ffi::c_void,
    ) -> *const AudioStreamBasicDescription;

    fn CMSampleBufferCreateCopyWithNewTiming(
        allocator: *const std::ffi::c_void,
        original: *mut std::ffi::c_void,
        num_timing_entries: isize,
        timing_array: *const ObjcCMSampleTimingInfo,
        sample_buffer_out: *mut *mut std::ffi::c_void,
    ) -> i32;
}

/// Mirror of CoreMedia's `CMTime`, with objc2 `Encode` impls so it can be
/// passed by value through `msg_send!` (e.g. `startSessionAtSourceTime:`,
/// `setPreferredOutputSegmentInterval:`).
#[repr(C)]
#[derive(Copy, Clone)]
struct ObjcCMTime {
    value: i64,
    timescale: i32,
    flags: u32,
    epoch: i64,
}

unsafe impl objc2::encode::RefEncode for ObjcCMTime {
    const ENCODING_REF: objc2::encode::Encoding =
        objc2::encode::Encoding::Pointer(&<Self as objc2::encode::Encode>::ENCODING);
}

unsafe impl objc2::encode::Encode for ObjcCMTime {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
        "CMTime",
        &[
            <i64 as objc2::encode::Encode>::ENCODING,
            <i32 as objc2::encode::Encode>::ENCODING,
            <u32 as objc2::encode::Encode>::ENCODING,
            <i64 as objc2::encode::Encode>::ENCODING,
        ],
    );
}

impl From<screencapturekit::cm::CMTime> for ObjcCMTime {
    fn from(value: screencapturekit::cm::CMTime) -> Self {
        Self {
            value: value.value,
            timescale: value.timescale,
            flags: value.flags,
            epoch: value.epoch,
        }
    }
}

/// Look up an Objective-C class by name at runtime.
unsafe fn av_class_named(name: &str) -> Option<&'static objc2::runtime::AnyClass> {
    let bytes = std::ffi::CString::new(name).ok()?;
    objc2::runtime::AnyClass::get(&bytes)
}

/// Build a retained `NSString` from a Rust string.
unsafe fn av_ns_string_from(s: &str) -> Option<objc2::rc::Retained<objc2::runtime::AnyObject>> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    let cstr = std::ffi::CString::new(s).ok()?;
    let allocated: *mut AnyObject = msg_send![class!(NSString), alloc];
    if allocated.is_null() {
        return None;
    }
    let inited: *mut AnyObject = msg_send![allocated, initWithUTF8String: cstr.as_ptr()];
    if inited.is_null() {
        let _ = objc2::rc::Retained::from_raw(allocated);
        None
    } else {
        objc2::rc::Retained::from_raw(inited)
    }
}

/// Build a retained `NSURL` file URL for the writer's output path.
unsafe fn av_file_url(path: &Path) -> Option<objc2::rc::Retained<objc2::runtime::AnyObject>> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    let path_str = path.to_str()?;
    let nsstr = av_ns_string_from(path_str)?;
    let url: *mut AnyObject = msg_send![class!(NSURL), fileURLWithPath: &*nsstr];
    if url.is_null() {
        None
    } else {
        objc2::rc::Retained::retain(url)
    }
}

/// Boxed `NSNumber` for integer settings-dictionary values.
unsafe fn av_number_i64(value: i64) -> Option<objc2::rc::Retained<objc2::runtime::AnyObject>> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    let raw: *mut AnyObject = msg_send![class!(NSNumber), numberWithLongLong: value];
    if raw.is_null() {
        None
    } else {
        objc2::rc::Retained::retain(raw)
    }
}

/// Boxed boolean `NSNumber` for settings-dictionary flags.
unsafe fn av_number_bool(value: bool) -> Option<objc2::rc::Retained<objc2::runtime::AnyObject>> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    let raw: *mut AnyObject = msg_send![class!(NSNumber), numberWithBool: value];
    if raw.is_null() {
        None
    } else {
        objc2::rc::Retained::retain(raw)
    }
}

/// Fresh `NSMutableDictionary` for AVFoundation output settings.
unsafe fn av_dict() -> Result<objc2::rc::Retained<objc2::runtime::AnyObject>, String> {
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    let raw: *mut AnyObject = msg_send![class!(NSMutableDictionary), dictionary];
    if raw.is_null() {
        Err("NSMutableDictionary allocation failed".into())
    } else {
        objc2::rc::Retained::retain(raw)
            .ok_or_else(|| "NSMutableDictionary retain failed".to_string())
    }
}

/// `dict[key] = value` on an `NSMutableDictionary`.
unsafe fn av_dict_set(
    dict: &objc2::runtime::AnyObject,
    key: *const objc2::runtime::AnyObject,
    value: &objc2::runtime::AnyObject,
) {
    use objc2::msg_send;

    let _: () = msg_send![dict, setObject: value, forKey: key];
}

/// H.264 output settings for the video writer input, sized to the capture
/// dimensions and with frame reordering (B-frames) disabled — required for
/// stable fragmented-MP4 writing (see the comment inside).
unsafe fn av_video_output_settings(
    width: u32,
    height: u32,
) -> Result<objc2::rc::Retained<objc2::runtime::AnyObject>, String> {
    use objc2::runtime::AnyObject;

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
        static AVVideoMaxKeyFrameIntervalKey: *const AnyObject;
    }

    let settings = av_dict()?;
    let width_value =
        av_number_i64(width as i64).ok_or_else(|| "NSNumber width failed".to_string())?;
    let height_value =
        av_number_i64(height as i64).ok_or_else(|| "NSNumber height failed".to_string())?;
    av_dict_set(&settings, AVVideoCodecKey, &*AVVideoCodecTypeH264);
    av_dict_set(&settings, AVVideoWidthKey, &width_value);
    av_dict_set(&settings, AVVideoHeightKey, &height_value);

    // Segmented output (preferredOutputSegmentInterval) needs monotonic video timing
    // inside each fragment. The encoder's default B-frames (frame reordering)
    // intermittently kill the writer with -11800 / OSStatus -16341 when a
    // reordered frame group straddles a fragment boundary, truncating the
    // recording at an exact fragment-boundary timestamp. Screen capture gains
    // almost nothing from B-frames; disable reordering.
    let compression = av_dict()?;
    let no_reordering =
        av_number_bool(false).ok_or_else(|| "NSNumber reordering flag failed".to_string())?;
    av_dict_set(&compression, AVVideoAllowFrameReorderingKey, &no_reordering);

    // Capture-time rate control (mirrors Cap's AVAssetWriter setup). Without
    // an explicit budget the encoder default runs several times larger and
    // every upload needs an ffmpeg transcode pass to shrink it.
    let average_bit_rate =
        (CAPTURE_VIDEO_BPP * f64::from(width) * f64::from(height) * f64::from(NATIVE_CAPTURE_FPS))
            as i64;
    let bit_rate =
        av_number_i64(average_bit_rate).ok_or_else(|| "NSNumber bit rate failed".to_string())?;
    av_dict_set(&compression, AVVideoAverageBitRateKey, &bit_rate);
    let expected_fps = av_number_i64(i64::from(NATIVE_CAPTURE_FPS))
        .ok_or_else(|| "NSNumber expected fps failed".to_string())?;
    av_dict_set(
        &compression,
        AVVideoExpectedSourceFrameRateKey,
        &expected_fps,
    );
    // ~0.75s keyframe cadence: guarantees at least one sync sample per movie
    // fragment (1s interval) so every fragment stays independently seekable.
    let keyframe_interval = av_number_i64((i64::from(NATIVE_CAPTURE_FPS) * 3 / 4).max(1))
        .ok_or_else(|| "NSNumber keyframe interval failed".to_string())?;
    av_dict_set(
        &compression,
        AVVideoMaxKeyFrameIntervalKey,
        &keyframe_interval,
    );

    av_dict_set(&settings, AVVideoCompressionPropertiesKey, &compression);
    Ok(settings)
}

/// AAC 48kHz stereo 128kbps output settings for the audio writer inputs
/// (both the mixed track and per-source tracks).
unsafe fn av_audio_output_settings(
) -> Result<objc2::rc::Retained<objc2::runtime::AnyObject>, String> {
    use objc2::runtime::AnyObject;

    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {
        static AVEncoderBitRateKey: *const AnyObject;
        static AVFormatIDKey: *const AnyObject;
        static AVNumberOfChannelsKey: *const AnyObject;
        static AVSampleRateKey: *const AnyObject;
    }

    let settings = av_dict()?;
    let format = av_number_i64(AUDIO_FORMAT_AAC)
        .ok_or_else(|| "NSNumber audio format failed".to_string())?;
    let sample_rate =
        av_number_i64(48_000).ok_or_else(|| "NSNumber sample rate failed".to_string())?;
    let channels = av_number_i64(2).ok_or_else(|| "NSNumber channels failed".to_string())?;
    let bitrate = av_number_i64(128_000).ok_or_else(|| "NSNumber bitrate failed".to_string())?;
    av_dict_set(&settings, AVFormatIDKey, &format);
    av_dict_set(&settings, AVSampleRateKey, &sample_rate);
    av_dict_set(&settings, AVNumberOfChannelsKey, &channels);
    av_dict_set(&settings, AVEncoderBitRateKey, &bitrate);
    Ok(settings)
}

/// Create an AAC `AVAssetWriterInput` (realtime mode), attach it to the
/// writer, and return it retained.
unsafe fn av_make_audio_writer_input(
    input_cls: &objc2::runtime::AnyClass,
    writer: &objc2::runtime::AnyObject,
) -> Result<objc2::rc::Retained<objc2::runtime::AnyObject>, String> {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {
        static AVMediaTypeAudio: *const AnyObject;
    }

    let settings = av_audio_output_settings()?;
    let raw: *mut AnyObject = msg_send![
        input_cls,
        assetWriterInputWithMediaType: AVMediaTypeAudio,
        outputSettings: &*settings
    ];
    if raw.is_null() {
        return Err("AVAssetWriterInput audio allocation failed".into());
    }
    let input = objc2::rc::Retained::retain(raw)
        .ok_or_else(|| "AVAssetWriterInput audio retain failed".to_string())?;
    let _: () = msg_send![&*input, setExpectsMediaDataInRealTime: true];
    let can_add: bool = msg_send![writer, canAddInput: &*input];
    if !can_add {
        return Err("AVAssetWriter cannot add audio input".into());
    }
    let _: () = msg_send![writer, addInput: &*input];
    Ok(input)
}

/// Render an `NSError` for logs: description, domain+code, failure reason,
/// and the underlying error's domain+code (where the raw OSStatus that
/// names the real cause usually hides).
unsafe fn av_error_suffix(err_obj: *mut objc2::runtime::AnyObject) -> String {
    if err_obj.is_null() {
        return String::new();
    }
    let desc_obj: *mut objc2::runtime::AnyObject = objc2::msg_send![err_obj, localizedDescription];
    let mut out = av_string_suffix(desc_obj);

    // Domain + code identify the error class; the localizedDescription alone
    // is usually a generic "The operation could not be completed".
    let domain_obj: *mut objc2::runtime::AnyObject = objc2::msg_send![err_obj, domain];
    let code: i64 = objc2::msg_send![err_obj, code];
    out.push_str(&format!(
        " [domain{} code={code}]",
        av_string_suffix(domain_obj)
    ));

    let reason_obj: *mut objc2::runtime::AnyObject =
        objc2::msg_send![err_obj, localizedFailureReason];
    if !reason_obj.is_null() {
        out.push_str(&format!(" reason{}", av_string_suffix(reason_obj)));
    }

    // The underlying error carries the raw OSStatus naming the real cause
    // (e.g. CoreMedia -12780); surface its domain + code too.
    if let Some(cls) = av_class_named("NSString") {
        let key_cstr = b"NSUnderlyingError\0".as_ptr() as *const i8;
        let key: *mut objc2::runtime::AnyObject =
            objc2::msg_send![cls, stringWithUTF8String: key_cstr];
        if !key.is_null() {
            let user_info: *mut objc2::runtime::AnyObject = objc2::msg_send![err_obj, userInfo];
            if !user_info.is_null() {
                let underlying: *mut objc2::runtime::AnyObject =
                    objc2::msg_send![user_info, objectForKey: key];
                if !underlying.is_null() {
                    let u_domain: *mut objc2::runtime::AnyObject =
                        objc2::msg_send![underlying, domain];
                    let u_code: i64 = objc2::msg_send![underlying, code];
                    out.push_str(&format!(
                        " underlying=[domain{} code={u_code}]",
                        av_string_suffix(u_domain)
                    ));
                }
            }
        }
    }
    out
}

/// Render the writer's current status + `error` property for logs.
unsafe fn av_writer_error_suffix(writer: &objc2::runtime::AnyObject) -> String {
    let status: i64 = objc2::msg_send![writer, status];
    let err_obj: *mut objc2::runtime::AnyObject = objc2::msg_send![writer, error];
    format!(" (writer status={status}){}", av_error_suffix(err_obj))
}

/// `": <string>"` from an `NSString` pointer, or empty when nil.
unsafe fn av_string_suffix(obj: *mut objc2::runtime::AnyObject) -> String {
    if obj.is_null() {
        return String::new();
    }
    let utf8: *const i8 = objc2::msg_send![obj, UTF8String];
    if utf8.is_null() {
        return String::new();
    }
    let cstr = std::ffi::CStr::from_ptr(utf8);
    format!(": {}", cstr.to_string_lossy())
}

/// Plain, `Send` capture parameters kept so the watchdog can rebuild the
/// SCStream from scratch after an interruption without holding on to any
/// non-`Send` ScreenCaptureKit handles. `width`/`height` are fixed to the
/// dimensions the writer was created with so a rebuilt stream keeps producing
/// frames the existing video input accepts.
#[derive(Clone)]
struct RestartParams {
    include_audio: bool,
    capture_system_audio: bool,
    mic_device_id: Option<String>,
    mic_device_label: Option<String>,
    target_display_id: Option<u32>,
    capture_region: Option<NativeCaptureRegion>,
    width: u32,
    height: u32,
}

/// Everything the pause/resume path needs to stop the capture source without
/// tearing down the writer, and to splice a fresh SCStream onto the same
/// (append-only) file on resume. Cheap to clone — all handles are `Arc`s or
/// plain data — so it lives alongside the backend and shares the watchdog's
/// stream/handler/watch.
pub(crate) struct CustomCaptureResume {
    stream: Arc<Mutex<SCStream>>,
    handler: CustomScreenCaptureOutputHandler,
    watch: Arc<CaptureWatch>,
    params: RestartParams,
}

impl CustomCaptureResume {
    /// Pause: stop only the capture source (SCStream). The writer, file, and
    /// live uploader stay alive; mic/screen go cold. The watchdog is told to
    /// hold so it never reads the silence as a stall and rebuilds.
    pub(crate) fn pause(&self) {
        self.watch.set_paused(true);
        if let Ok(guard) = self.stream.lock() {
            let _ = guard.stop_capture();
        }
        eprintln!("[mixer] capture paused; source stream stopped, writer/file kept open");
    }

    /// Resume: build a fresh SCStream wired to the SAME writer and start it,
    /// after advancing the writer's pause offset by `paused_for` so the new
    /// samples rebase past the pause gap. The result is one continuous
    /// append-only file — the live uploader is never interrupted, exactly like
    /// a watchdog stream rebuild.
    pub(crate) fn resume(&self, paused_for: Duration) -> Result<(), String> {
        let writer = &self.handler.writer;
        let prev_offset = writer.pause_offset();

        // Build the replacement stream FIRST: a build failure must not shift the
        // timeline. The session stays paused and can be retried — and a retry
        // re-measures `paused_for` from the same (uncleared) pause instant, so
        // advancing the offset here would compound on every failed attempt.
        let new_stream = build_custom_scstream(&self.params, &self.handler, &self.watch)?;

        // Apply the pause gap just before the stream starts delivering, so the
        // first rebased frame already skips it. Roll back if startup fails so
        // the failed attempt leaves the offset exactly as it was.
        writer.set_pause_offset(prev_offset + paused_for.as_secs_f64());
        if let Err(err) = new_stream.start_capture() {
            writer.set_pause_offset(prev_offset);
            return Err(format!("resume start_capture failed: {err:?}"));
        }

        // Stop any lingering paused stream, then swap the fresh one in under
        // the same lock the watchdog uses so the two never feed at once.
        if let Ok(guard) = self.stream.lock() {
            let _ = guard.stop_capture();
        }
        if let Ok(mut guard) = self.stream.lock() {
            *guard = new_stream;
        }
        // Discard the stop note our own pause/stop raised and reset the
        // activity clock so the watchdog doesn't immediately treat the just-
        // rebuilt stream as stalled, then hand supervision back.
        let _ = self.watch.take_stream_stopped();
        self.watch.note_activity();
        self.watch.set_paused(false);
        eprintln!(
            "[mixer] capture resumed; fresh stream spliced onto same writer (paused {}ms)",
            paused_for.as_millis()
        );
        Ok(())
    }
}

/// Stream lifecycle delegate for the custom pipeline. ScreenCaptureKit calls
/// this when it stops the stream (e.g. the captured display changed Spaces or a
/// full-screen app took over). Without it those stops are invisible and the
/// recording silently freezes. We only flag the watchdog here — rebuilding the
/// stream from an SCK callback thread is unsafe, so recovery happens off-thread.
struct CustomCaptureStreamDelegate {
    watch: Arc<CaptureWatch>,
}

impl SCStreamDelegateTrait for CustomCaptureStreamDelegate {
    fn did_stop_with_error(&self, error: SCError) {
        // The user stopping capture via macOS (menu-bar "Stop Sharing") is a
        // request, not a failure — rebuilding the stream would fight the
        // user. Everything else (SystemStoppedStream on lid close / display
        // sleep, connection failures, ...) goes to the rebuild path.
        if error.stream_error_code()
            == Some(screencapturekit::error::SCStreamErrorCode::UserStopped)
        {
            eprintln!("[mixer] capture stopped by the user via macOS; requesting recording stop");
            self.watch.note_user_stopped();
            return;
        }
        let reason = format!("ScreenCaptureKit stream stopped with error: {error}");
        eprintln!("[mixer] {reason}");
        self.watch.note_stream_stopped(reason);
    }

    fn stream_did_stop(&self, error: Option<String>) {
        let detail = error.unwrap_or_else(|| "no detail".to_string());
        let reason = format!("ScreenCaptureKit stream stopped: {detail}");
        eprintln!("[mixer] {reason}");
        self.watch.note_stream_stopped(reason);
    }
}

/// Build (but do not start) a fresh SCStream for the custom pipeline from plain
/// parameters. Shared by the initial start and every watchdog rebuild so the
/// filter/config/handler/delegate wiring can never drift between them.
fn build_custom_scstream(
    params: &RestartParams,
    handler: &CustomScreenCaptureOutputHandler,
    watch: &Arc<CaptureWatch>,
) -> Result<SCStream, String> {
    let content =
        SCShareableContent::get().map_err(|e| format!("shareable content lookup failed: {e:?}"))?;
    let displays = content.displays();
    let display = params
        .target_display_id
        .and_then(|id| displays.iter().find(|d| d.display_id() == id))
        .or_else(|| displays.first())
        .ok_or_else(|| "No displays available for ScreenCaptureKit recording.".to_string())?;

    let region_rect = region_source_rect(params.capture_region, display.width(), display.height())?;
    let filter_builder = SCContentFilter::create()
        .with_display(display)
        .with_excluding_windows(&[]);
    let filter = if let Some((rect, _, _)) = region_rect {
        filter_builder.with_content_rect(rect).build()
    } else {
        filter_builder.build()
    };

    let selected_mic = if params.include_audio {
        resolve_microphone_capture_device(
            params.mic_device_id.as_deref(),
            params.mic_device_label.as_deref(),
        )?
    } else {
        None
    };

    let mut config = SCStreamConfiguration::new()
        .with_width(params.width)
        .with_height(params.height)
        .with_fps(NATIVE_CAPTURE_FPS)
        .with_queue_depth(8)
        .with_shows_cursor(true)
        .with_captures_audio(params.capture_system_audio)
        .with_captures_microphone(params.include_audio)
        .with_excludes_current_process_audio(true)
        .with_sample_rate(48000)
        .with_channel_count(2);
    // Pin SDR NV12 (video-range 4:2:0) delivery, matching Cap. Two reasons:
    //  - Without a pin, ScreenCaptureKit switches the delivered pixel format
    //    to HDR/EDR variants (half-float / 10-bit) when the frontmost app
    //    renders EDR content; the SDR H.264 writer input then rejects every
    //    appended frame (-11800 / OSStatus -16122) and the writer dies —
    //    including on rebuilt streams while that app stays frontmost.
    //  - NV12 is VideoToolbox's native encoder input and half the memory
    //    bandwidth of BGRA.
    // NOTE: do not add `set_color_space_name` — the crate's ObjC shim for it
    // raises an uncatchable Objective-C exception and aborts the process;
    // the pixel-format pin alone keeps the encoder input format stable.
    config.set_pixel_format(screencapturekit::stream::configuration::PixelFormat::YCbCr_420v);
    if let Some((rect, _, _)) = region_rect {
        config.set_source_rect(rect);
    }
    if let Some(device) = selected_mic.as_ref() {
        config.set_microphone_capture_device_id(&device.id);
    }
    config.set_stream_name(Some("Clips custom full-screen recording"));

    let delegate = CustomCaptureStreamDelegate {
        watch: Arc::clone(watch),
    };
    let mut stream = SCStream::new_with_delegate(&filter, &config, delegate);
    stream.add_output_handler(handler.clone(), SCStreamOutputType::Screen);
    if params.capture_system_audio {
        stream.add_output_handler(handler.clone(), SCStreamOutputType::Audio);
    }
    if params.include_audio {
        stream.add_output_handler(handler.clone(), SCStreamOutputType::Microphone);
    }
    Ok(stream)
}

/// Supervise a running custom capture and rebuild the SCStream when it stops or
/// goes silent (the Spaces/full-screen interruption). Runs on its own thread;
/// exits when recording is torn down (`shutdown`) or the writer is closed.
fn spawn_capture_watchdog(
    app: AppHandle,
    stream: Arc<Mutex<SCStream>>,
    writer: CustomScreenCaptureWriter,
    handler: CustomScreenCaptureOutputHandler,
    watch: Arc<CaptureWatch>,
    recording_enabled: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    params: RestartParams,
) {
    std::thread::spawn(move || {
        let mut restart_streak: u32 = 0;
        // After a rebuild, hold off re-evaluating until the new stream has had a
        // fair chance to deliver its first frames.
        let mut cooldown_until: Option<Instant> = None;

        loop {
            std::thread::sleep(CAPTURE_WATCHDOG_POLL);
            if shutdown.load(Ordering::SeqCst) {
                return;
            }
            if writer.appends_closed.load(Ordering::SeqCst) {
                // Appends closed while we're still supervising. A clean stop
                // sets `watchdog_shutdown` BEFORE closing appends (SeqCst), so
                // re-check it: if it's still unset, appends were closed by an
                // unrecoverable capture failure (an Objective-C exception or
                // panic in the sample callback, an `appendSampleBuffer` error,
                // or a writer-session failure) with the SCStream still running
                // and the UI still showing "recording". Stop capture and fire
                // the normal stop so the partial — still a valid fragmented
                // file — is finalized/uploaded instead of silently truncating.
                if shutdown.load(Ordering::SeqCst) {
                    return;
                }
                eprintln!(
                    "[mixer] appends closed without a stop request; treating as fatal capture failure and finalizing partial recording"
                );
                if let Ok(guard) = stream.lock() {
                    let _ = guard.stop_capture();
                }
                let _ = app.emit("clips:recorder-stop", ());
                return;
            }
            // Nothing to supervise until output is enabled and the writer
            // session has actually begun; the handler keeps `last_activity`
            // fresh from the first delivered buffer, so there is no false stall
            // when we start evaluating.
            if !recording_enabled.load(Ordering::SeqCst) || !writer.started.load(Ordering::SeqCst) {
                continue;
            }

            // Paused: the capture source is intentionally stopped while the
            // writer/file/uploader stay alive. Don't read the silence as a
            // stall or rebuild — resume splices a fresh stream back in.
            if watch.is_paused() {
                restart_streak = 0;
                cooldown_until = None;
                continue;
            }

            // User stopped capture from the macOS UI: trigger the normal stop
            // flow (same event the toolbar Stop button emits, so the clip is
            // finalized and uploaded) and stop supervising. Never rebuild.
            if watch.user_stopped() {
                eprintln!("[mixer] user stopped capture via macOS; emitting recorder stop");
                let _ = app.emit("clips:recorder-stop", ());
                return;
            }

            if let Some(until) = cooldown_until {
                if Instant::now() < until {
                    continue;
                }
                cooldown_until = None;
                if watch.since_activity() < CAPTURE_STALL_TIMEOUT {
                    // Rebuild recovered — frames are flowing again.
                    restart_streak = 0;
                    continue;
                }
                // Still no frames after the rebuild; fall through and retry.
            }

            let reported_stop = watch.take_stream_stopped();
            let stalled = watch.since_activity() >= CAPTURE_STALL_TIMEOUT;
            if reported_stop.is_none() && !stalled {
                restart_streak = 0;
                continue;
            }

            let reason = reported_stop.unwrap_or_else(|| {
                format!(
                    "no capture frames for {:?} (display may have moved to another Space)",
                    watch.since_activity()
                )
            });
            restart_streak += 1;
            if restart_streak > CAPTURE_MAX_RESTARTS {
                eprintln!(
                    "[mixer] capture interrupted ({reason}) and did not recover after {CAPTURE_MAX_RESTARTS} restarts; finalizing partial recording"
                );
                // Close appends (but leave `failed` unset) so the stop path
                // still finalizes everything captured before the interruption
                // instead of discarding it.
                writer.appends_closed.store(true, Ordering::SeqCst);
                if let Ok(guard) = stream.lock() {
                    let _ = guard.stop_capture();
                }
                // Fire the normal stop so the partial clip is finalized/uploaded
                // and the UI leaves the recording state, rather than sitting on
                // a frozen recording after the watchdog gives up.
                let _ = app.emit("clips:recorder-stop", ());
                return;
            }

            eprintln!(
                "[mixer] capture interrupted ({reason}); rebuilding stream (attempt {restart_streak}/{CAPTURE_MAX_RESTARTS})"
            );

            // Stop the dead/wedged stream before starting a replacement so two
            // streams never feed the writer at once. Slow build/start work is
            // done without holding the stream lock.
            if let Ok(guard) = stream.lock() {
                let _ = guard.stop_capture();
            }
            if shutdown.load(Ordering::SeqCst) || writer.appends_closed.load(Ordering::SeqCst) {
                return;
            }

            match build_custom_scstream(&params, &handler, &watch).and_then(|s| {
                s.start_capture()
                    .map(|()| s)
                    .map_err(|e| format!("start_capture failed: {e:?}"))
            }) {
                Ok(new_stream) => {
                    if shutdown.load(Ordering::SeqCst)
                        || writer.appends_closed.load(Ordering::SeqCst)
                    {
                        let _ = new_stream.stop_capture();
                        return;
                    }
                    if let Ok(mut guard) = stream.lock() {
                        *guard = new_stream;
                    }
                    // Discard any stop note the deliberate teardown of the old
                    // stream raised; otherwise a later poll would consume it as
                    // a fresh failure and rebuild the healthy stream again.
                    let _ = watch.take_stream_stopped();
                    cooldown_until = Some(Instant::now() + CAPTURE_STALL_TIMEOUT);
                    eprintln!("[mixer] capture stream rebuilt; waiting for frames");
                }
                Err(err) => {
                    eprintln!("[mixer] capture rebuild failed: {err}");
                    // Short cooldown before the next attempt so a hard failure
                    // (e.g. display gone) doesn't spin the CPU.
                    cooldown_until = Some(Instant::now() + CAPTURE_WATCHDOG_POLL);
                }
            }
        }
    });
}

/// Start the custom capture backend: create the fragmented-MP4 writer,
/// build + start the SCStream from rebuildable params, and spawn the
/// capture watchdog that supervises it. Returns the backend handle plus
/// the output dimensions.
pub(super) fn start_custom_screencapturekit_backend_at(
    app: &AppHandle,
    output_path: &Path,
    include_audio: bool,
    capture_system_audio: bool,
    mic_device_id: Option<&str>,
    mic_device_label: Option<&str>,
    target_display_id: Option<u32>,
    capture_region: Option<NativeCaptureRegion>,
    defer_recording_output: bool,
) -> Result<(NativeFullscreenBackend, Option<u32>, Option<u32>), String> {
    eprintln!("[clips-tray] starting custom screen capture backend");
    let content =
        SCShareableContent::get().map_err(|e| format!("shareable content lookup failed: {e:?}"))?;
    let displays = content.displays();
    let display = target_display_id
        .and_then(|id| displays.iter().find(|d| d.display_id() == id))
        .or_else(|| displays.first())
        .ok_or_else(|| "No displays available for ScreenCaptureKit recording.".to_string())?;

    let source_width = display.width();
    let source_height = display.height();
    let region_rect = region_source_rect(capture_region, source_width, source_height)?;
    let (capture_width, capture_height) = region_rect
        .as_ref()
        .map(|(_, width, height)| (*width, *height))
        .unwrap_or((source_width, source_height));
    let (width, height) = native_capture_dimensions(capture_width, capture_height);
    // The display handle here is only used to size the output; the actual
    // (rebuildable) stream is constructed from plain params via
    // `build_custom_scstream` so the watchdog can recreate it later.

    let params = RestartParams {
        include_audio,
        capture_system_audio,
        mic_device_id: mic_device_id.map(str::to_string),
        mic_device_label: mic_device_label.map(str::to_string),
        target_display_id,
        capture_region,
        width,
        height,
    };

    // Live-mix only when both audio sources are present; a single source needs
    // no mixing and goes straight to its own track.
    let mix_live = include_audio && capture_system_audio;
    let writer = CustomScreenCaptureWriter::new(
        output_path,
        width,
        height,
        capture_system_audio,
        include_audio,
        mix_live,
    )?;
    let recording_enabled = Arc::new(AtomicBool::new(!defer_recording_output));
    let mic_ready = include_audio.then(|| Arc::new(AtomicBool::new(false)));
    let watch = Arc::new(CaptureWatch::new());
    let handler = CustomScreenCaptureOutputHandler {
        writer: writer.clone(),
        recording_enabled: Arc::clone(&recording_enabled),
        mic_ready: mic_ready.clone(),
        watch: Arc::clone(&watch),
    };

    let stream = build_custom_scstream(&params, &handler, &watch)?;
    if let Err(err) = stream.start_capture() {
        let _ = std::fs::remove_file(output_path);
        return Err(format!("custom capture start failed: {err:?}"));
    }
    eprintln!(
        "[clips-tray] custom ScreenCaptureKit recording started: {width}x{height} @ {NATIVE_CAPTURE_FPS}fps from {capture_width}x{capture_height} (display {source_width}x{source_height}), mic={include_audio} system_audio={capture_system_audio} deferred_output={defer_recording_output}"
    );

    let stream = Arc::new(Mutex::new(stream));
    let watchdog_shutdown = Arc::new(AtomicBool::new(false));
    // Snapshot the handles pause/resume needs before the watchdog consumes
    // `handler` and `params`; the fresh stream it builds on resume feeds the
    // same writer as the watchdog's own rebuilds.
    let resume = CustomCaptureResume {
        stream: Arc::clone(&stream),
        handler: handler.clone(),
        watch: Arc::clone(&watch),
        params: params.clone(),
    };
    spawn_capture_watchdog(
        app.clone(),
        Arc::clone(&stream),
        writer.clone(),
        handler,
        Arc::clone(&watch),
        Arc::clone(&recording_enabled),
        Arc::clone(&watchdog_shutdown),
        params,
    );

    Ok((
        NativeFullscreenBackend::CustomScreenCaptureKit {
            stream,
            writer,
            mic_ready,
            recording_enabled,
            watchdog_shutdown,
            resume,
        },
        Some(width),
        Some(height),
    ))
}
