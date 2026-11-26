//! The camera track's own AVCaptureSession and fMP4 writer (see
//! `camera_track` for what the file holds). The session opens the camera the
//! bubble shows, beside the web view's own capture of it, and hands the camera
//! back the format and frame rate it had, so the bubble keeps its picture.
//! Frames reach the writer on a queue of the track's own, and the file takes
//! the size of the first one. The camera going away, or anything failing here,
//! ends only this track, which is then listed incomplete.
//!
//! The track never asks for the camera: it starts only when Clips already has
//! access, as it does while the bubble shows the camera.

use super::track_writer::{h264_settings, retimed, TrackMedia, TrackWriter, INVALID_TIME};
use super::{av_dict, av_dict_set, av_number_i64, describe_objc_exception, ObjcCMTime};
use crate::native_screen::camera_track::{
    pick_camera, CameraFormat, CameraTrackReport, CAMERA_TRACK_MAX_KEYFRAME_SECONDS,
    CAMERA_TRACK_TIMESCALE,
};
use crate::native_screen::rich_recording::{FrameTime, RecordingClock};
use crate::native_screen::screen_track::FrameTimeline;
use crate::native_screen::track_upload::TrackUploadCtrl;

use core_foundation::base::{CFRelease, CFRetain};
use dispatch2::{DispatchQueue, DispatchRetained};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, NSObjectProtocol, ProtocolObject};
use objc2::{class, define_class, msg_send, AllocAnyThread, DefinedClass};
use objc2_av_foundation::{
    AVAuthorizationStatus, AVCaptureConnection, AVCaptureDevice, AVCaptureDeviceFormat,
    AVCaptureDeviceInput, AVCaptureOutput, AVCaptureSession, AVCaptureVideoDataOutput,
    AVCaptureVideoDataOutputSampleBufferDelegate,
};
use objc2_core_media::{CMSampleBuffer as CaptureSampleBuffer, CMTime, CMTimeFlags};
use objc2_foundation::{NSArray, NSString};
use screencapturekit::cm::CMSampleBuffer;
use std::ffi::c_void;
use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, Weak};

/// Frames the encoder turned away in a row before the track gives up on it:
/// about two seconds of a camera at 60 fps.
const NOT_READY_LIMIT: u32 = 120;
/// A camera that sent nothing for this long before Stop went away (unplugged,
/// or taken by another app): its file ends at its last frame.
const CAMERA_SILENCE_SECS: f64 = 2.0;
/// `kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange`, which the encoder takes
/// as it comes.
const PIXEL_FORMAT_420V: i64 = 0x3432_3076;

#[link(name = "CoreMedia", kind = "framework")]
extern "C" {
    fn CMSampleBufferGetPresentationTimeStamp(sbuf: *mut c_void) -> ObjcCMTime;
    fn CMSampleBufferGetImageBuffer(sbuf: *mut c_void) -> *mut c_void;
    fn CMClockGetHostTimeClock() -> *const c_void;
    fn CMSyncConvertTime(time: ObjcCMTime, from: *const c_void, to: *const c_void) -> ObjcCMTime;
}

#[link(name = "CoreVideo", kind = "framework")]
extern "C" {
    static kCVPixelBufferPixelFormatTypeKey: *const AnyObject;
    fn CVPixelBufferGetWidth(pixel_buffer: *mut c_void) -> usize;
    fn CVPixelBufferGetHeight(pixel_buffer: *mut c_void) -> usize;
}

struct FrameIvars {
    shared: Weak<Shared>,
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements and the type has no
    // Drop impl. AVFoundation calls the delegate on the track's serial queue.
    #[unsafe(super(NSObject))]
    #[name = "ClipsCameraTrackFrameDelegate"]
    #[ivars = FrameIvars]
    struct FrameDelegate;

    unsafe impl NSObjectProtocol for FrameDelegate {}

    unsafe impl AVCaptureVideoDataOutputSampleBufferDelegate for FrameDelegate {
        #[unsafe(method(captureOutput:didOutputSampleBuffer:fromConnection:))]
        fn did_output_sample_buffer(
            &self,
            _output: &AVCaptureOutput,
            sample_buffer: &CaptureSampleBuffer,
            _connection: &AVCaptureConnection,
        ) {
            let Some(shared) = self.ivars().shared.upgrade() else {
                return;
            };
            let raw = sample_buffer as *const CaptureSampleBuffer as *mut c_void;
            // Nothing may unwind into AVFoundation.
            let outcome = std::panic::catch_unwind(AssertUnwindSafe(|| {
                objc2::exception::catch(AssertUnwindSafe(|| Shared::on_frame(&shared, raw)))
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
);

impl FrameDelegate {
    fn new(shared: Weak<Shared>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(FrameIvars { shared });
        unsafe { msg_send![super(this), init] }
    }
}

/// The running capture session and what it hands frames to.
struct CameraSession {
    session: Retained<AVCaptureSession>,
    output: Retained<AVCaptureVideoDataOutput>,
    _delegate: Retained<FrameDelegate>,
    queue: DispatchRetained<DispatchQueue>,
    /// The session's synchronization clock, retained here until the last
    /// frame that may read it is handled; null until the session runs.
    clock: *const c_void,
}

// SAFETY: the session, its output, the delegate and the clock are refcounted
// objects only moved through ownership; AVCaptureSession may be started and
// stopped from any thread.
unsafe impl Send for CameraSession {}

impl CameraSession {
    /// Stops the session and waits for frames already on their way.
    fn stop(self) {
        self.halt();
        self.queue.exec_sync(|| {});
    }

    fn halt(&self) {
        let _ = objc2::exception::catch(AssertUnwindSafe(|| unsafe {
            self.session.stopRunning();
        }));
        unsafe { self.output.setSampleBufferDelegate_queue(None, None) };
    }
}

/// Stops a session never handed to `stop`, such as one left in its slot when
/// the close thread could not start, and lets go of its clock.
impl Drop for CameraSession {
    fn drop(&mut self) {
        self.halt();
        if !self.clock.is_null() {
            // SAFETY: retained in `run_session`. A frame reads it only through
            // the track, which `stop` has waited out, or which is gone.
            unsafe { CFRelease(self.clock) };
        }
    }
}

/// The format and frame durations a camera had before the track's session
/// took it, which the bubble's own capture chose.
struct KeptFormat {
    format: Retained<AVCaptureDeviceFormat>,
    min_frame: CMTime,
    max_frame: CMTime,
}

impl KeptFormat {
    unsafe fn read(device: &AVCaptureDevice) -> Self {
        Self {
            format: device.activeFormat(),
            min_frame: device.activeVideoMinFrameDuration(),
            max_frame: device.activeVideoMaxFrameDuration(),
        }
    }

    /// Sets them back inside the session's configuration, as
    /// AVCaptureDevice.h shows, and hands back the camera's configuration
    /// lock, held until the session has started so its own preset can't pick
    /// another format as it starts. If that fails, the session keeps its
    /// choice and the track still records.
    unsafe fn restore<'a>(
        &self,
        device: &'a AVCaptureDevice,
        recording_id: &str,
    ) -> Option<ConfigLock<'a>> {
        if let Err(error) = device.lockForConfiguration() {
            eprintln!(
                "[rich-tracks] {recording_id}: camera format not kept: {}",
                error.localizedDescription()
            );
            return None;
        }
        let lock = ConfigLock(device);
        let restored = objc2::exception::catch(AssertUnwindSafe(|| {
            device.setActiveFormat(&self.format);
            if is_duration(self.min_frame) {
                device.setActiveVideoMinFrameDuration(self.min_frame);
            }
            if is_duration(self.max_frame) {
                device.setActiveVideoMaxFrameDuration(self.max_frame);
            }
        }));
        match restored {
            Ok(()) => Some(lock),
            Err(exception) => {
                eprintln!(
                    "[rich-tracks] {recording_id}: camera format not kept: {}",
                    describe_objc_exception(exception)
                );
                None
            }
        }
    }

    unsafe fn is_active(&self, device: &AVCaptureDevice) -> bool {
        let active = device.activeFormat();
        let active: &AnyObject = &active;
        self.format.isEqual(Some(active))
    }
}

/// A camera's configuration lock, released when dropped.
struct ConfigLock<'a>(&'a AVCaptureDevice);

impl Drop for ConfigLock<'_> {
    fn drop(&mut self) {
        unsafe { self.0.unlockForConfiguration() };
    }
}

fn is_duration(time: CMTime) -> bool {
    time.flags.contains(CMTimeFlags::Valid) && time.timescale > 0 && time.value > 0
}

enum Append {
    Done,
    NotReady,
    Failed(String),
}

struct CameraState {
    writer: Option<TrackWriter>,
    format: Option<CameraFormat>,
    started: bool,
    accepting: bool,
    timeline: FrameTimeline,
    not_ready: u32,
    stopped_early: Option<String>,
}

// SAFETY: the writer is only used under the state lock, one thread at a time;
// AVAssetWriter allows that from any thread.
unsafe impl Send for CameraState {}

struct Shared {
    recording_id: String,
    path: PathBuf,
    device_name: String,
    /// The rate the camera's format allows, if it says.
    min_frame_secs: Option<f64>,
    clock: RecordingClock,
    upload: Arc<TrackUploadCtrl>,
    /// The session's synchronization clock (a `CMClockRef` its frames are
    /// stamped on), while it runs; zero for the host clock.
    sync_clock: AtomicUsize,
    closing: AtomicBool,
    state: Mutex<CameraState>,
    session: Mutex<Option<CameraSession>>,
    report: Mutex<CameraTrackReport>,
}

/// The running camera track. Every method returns at once; the session
/// starts, stops and the file closes on threads of their own.
pub(in crate::native_screen) struct CameraCapture {
    shared: Arc<Shared>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Starts the camera track writing `path` from the camera the web view calls
/// `camera_label`. The session itself starts on its own thread; if it can't,
/// the track ends empty and is not listed.
pub(in crate::native_screen) fn start_camera_capture(
    path: &Path,
    camera_label: Option<&str>,
    clock: RecordingClock,
    upload: Arc<TrackUploadCtrl>,
    recording_id: &str,
) -> Result<CameraCapture, String> {
    let media_type = unsafe { objc2_av_foundation::AVMediaTypeVideo }
        .ok_or_else(|| "AVMediaTypeVideo is unavailable".to_string())?;
    let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };
    if status != AVAuthorizationStatus::Authorized {
        return Err(format!("Clips has no camera access (status {})", status.0));
    }
    // Every camera, virtual ones too, as the web view lists them.
    let devices: Retained<NSArray<AVCaptureDevice>> =
        unsafe { msg_send![class!(AVCaptureDevice), devicesWithMediaType: media_type] };
    let devices = devices.to_vec();
    let names: Vec<String> = devices
        .iter()
        .map(|device| unsafe { device.localizedName() }.to_string())
        .collect();
    let device = pick_camera(&names, camera_label)
        .and_then(|index| devices.get(index))
        .ok_or_else(|| {
            format!(
                "the bubble's camera ({}) is not among the {} camera(s) AVFoundation lists",
                camera_label.unwrap_or("no name given"),
                names.len()
            )
        })?;
    let device_name = unsafe { device.localizedName() }.to_string();
    let device_uid = unsafe { device.uniqueID() }.to_string();
    let min_frame = objc2::exception::catch(AssertUnwindSafe(|| unsafe {
        let duration: ObjcCMTime = msg_send![&**device, activeVideoMinFrameDuration];
        duration
    }))
    .ok()
    .filter(|duration| duration.flags & 1 != 0 && duration.timescale > 0 && duration.value > 0)
    .map(|duration| duration.value as f64 / f64::from(duration.timescale));

    let shared = Arc::new(Shared {
        recording_id: recording_id.to_string(),
        path: path.to_path_buf(),
        device_name,
        min_frame_secs: min_frame,
        clock,
        upload,
        sync_clock: AtomicUsize::new(0),
        closing: AtomicBool::new(false),
        state: Mutex::new(CameraState {
            writer: None,
            format: None,
            started: false,
            accepting: true,
            timeline: FrameTimeline::default(),
            not_ready: 0,
            stopped_early: None,
        }),
        session: Mutex::new(None),
        report: Mutex::new(CameraTrackReport::default()),
    });
    let starting = Arc::clone(&shared);
    std::thread::Builder::new()
        .name("clips-camera-track-start".into())
        .spawn(move || {
            let started = std::panic::catch_unwind(AssertUnwindSafe(|| {
                Shared::run_session(&starting, &device_uid)
            }))
            .unwrap_or_else(|_| Err("its session panicked while starting".into()));
            if let Err(error) = started {
                let mut state = lock(&starting.state);
                Shared::end_early(&starting, &mut state, error);
            }
        })
        .map_err(|error| format!("its session could not start: {error}"))?;
    eprintln!(
        "[rich-tracks] {recording_id}: camera track from {}",
        shared.device_name
    );
    Ok(CameraCapture { shared })
}

impl CameraCapture {
    pub(in crate::native_screen) fn report(&self) -> CameraTrackReport {
        lock(&self.shared.report).clone()
    }

    /// Stopped while paused, the file ends where the pause began, as the
    /// recording does.
    pub(in crate::native_screen) fn stop(&self) {
        let stopped_secs = self.shared.clock.position_ms().map(|ms| ms / 1000.0);
        Shared::close(&self.shared, stopped_secs);
    }
}

impl Drop for CameraCapture {
    fn drop(&mut self) {
        Shared::close(&self.shared, None);
    }
}

/// A frame's pixel size.
unsafe fn frame_size(sample: *mut c_void) -> Option<(i32, i32)> {
    let image = CMSampleBufferGetImageBuffer(sample);
    if image.is_null() {
        return None;
    }
    let width = i32::try_from(CVPixelBufferGetWidth(image)).ok()?;
    let height = i32::try_from(CVPixelBufferGetHeight(image)).ok()?;
    Some((width, height))
}

/// The capture's sample buffer as the writer takes it, retained for it.
unsafe fn writer_sample(raw: *mut c_void) -> Option<CMSampleBuffer> {
    CFRetain(raw as *const c_void);
    let sample = CMSampleBuffer::from_raw(raw);
    if sample.is_none() {
        CFRelease(raw as *const c_void);
    }
    sample
}

/// An H.264 writer for frames of `format`.
unsafe fn create_writer(path: &Path, format: &CameraFormat) -> Result<TrackWriter, String> {
    let settings = h264_settings(
        format.width_px,
        format.height_px,
        format.bit_rate(),
        format.max_fps,
        CAMERA_TRACK_MAX_KEYFRAME_SECONDS,
    )?;
    TrackWriter::create(
        path,
        TrackMedia::Video {
            timescale: CAMERA_TRACK_TIMESCALE,
        },
        &settings,
    )
}

impl Shared {
    fn run_session(this: &Arc<Self>, device_uid: &str) -> Result<(), String> {
        let uid = NSString::from_str(device_uid);
        let device = unsafe { AVCaptureDevice::deviceWithUniqueID(&uid) }
            .ok_or_else(|| format!("{} is no longer available", this.device_name))?;
        let input = unsafe { AVCaptureDeviceInput::deviceInputWithDevice_error(&device) }.map_err(
            |error| {
                format!(
                    "{} could not be opened: {}",
                    this.device_name,
                    error.localizedDescription()
                )
            },
        )?;
        let session = unsafe { AVCaptureSession::new() };
        let output = unsafe { AVCaptureVideoDataOutput::new() };
        let settings = unsafe {
            let settings = av_dict()?;
            let pixel_format = av_number_i64(PIXEL_FORMAT_420V)
                .ok_or_else(|| "NSNumber pixel format failed".to_string())?;
            av_dict_set(&settings, kCVPixelBufferPixelFormatTypeKey, &pixel_format);
            settings
        };
        // macOS has no preset that leaves a camera's format alone (iOS's
        // AVCaptureSessionPresetInputPriority raises here), so the session
        // hands the camera back what the bubble's capture chose.
        let kept = match objc2::exception::catch(AssertUnwindSafe(|| unsafe {
            KeptFormat::read(&device)
        })) {
            Ok(kept) => Some(kept),
            Err(exception) => {
                eprintln!(
                    "[rich-tracks] {}: camera format not kept: {}",
                    this.recording_id,
                    describe_objc_exception(exception)
                );
                None
            }
        };
        let mut held = None;
        let configured = objc2::exception::catch(AssertUnwindSafe(|| unsafe {
            session.beginConfiguration();
            let _: () = msg_send![&*output, setVideoSettings: &*settings];
            let added = session.canAddInput(&input) && {
                session.addInput(&input);
                session.canAddOutput(&output)
            };
            if added {
                session.addOutput(&output);
                if let Some(kept) = &kept {
                    held = kept.restore(&device, &this.recording_id);
                }
            }
            session.commitConfiguration();
            added
        }));
        match configured {
            Ok(true) => {}
            Ok(false) => return Err(format!("{} cannot be captured", this.device_name)),
            Err(exception) => {
                return Err(format!(
                    "its session setup raised: {}",
                    describe_objc_exception(exception)
                ))
            }
        }

        // Below the flattened recording's own capture, which keeps the default.
        let queue = DispatchQueue::new("com.clips.rich-recording.camera-track", None);
        let delegate = FrameDelegate::new(Arc::downgrade(this));
        unsafe {
            output.setSampleBufferDelegate_queue(
                Some(ProtocolObject::from_ref(&*delegate)),
                Some(&queue),
            );
        }
        let running = objc2::exception::catch(AssertUnwindSafe(|| unsafe {
            session.startRunning();
            session.isRunning()
        }));
        // Started, the session keeps its format; the bubble's capture may
        // configure the camera again.
        drop(held);
        let mut camera = CameraSession {
            session,
            output,
            _delegate: delegate,
            queue,
            clock: std::ptr::null(),
        };
        match running {
            Ok(true) => {
                if kept.is_some_and(|kept| !unsafe { kept.is_active(&device) }) {
                    eprintln!(
                        "[rich-tracks] {}: {}'s format changed as the camera track started",
                        this.recording_id, this.device_name
                    );
                }
            }
            Ok(false) => {
                camera.stop();
                return Err(format!("{} did not start capturing", this.device_name));
            }
            Err(exception) => {
                camera.stop();
                return Err(format!(
                    "its session raised while starting: {}",
                    describe_objc_exception(exception)
                ));
            }
        }
        if let Some(clock) = unsafe { camera.session.synchronizationClock() }.as_deref() {
            let clock = clock as *const _ as *const c_void;
            // SAFETY: a live clock, released when `camera` drops.
            unsafe { CFRetain(clock) };
            camera.clock = clock;
        }
        this.sync_clock
            .store(camera.clock as usize, Ordering::SeqCst);
        // Kept only if nothing closed the track while it started; checked
        // under the slot's lock, which `close` takes after setting `closing`,
        // so a session is either in the slot when it empties it or never kept.
        let mut slot = lock(&this.session);
        if this.closing.load(Ordering::SeqCst) {
            drop(slot);
            camera.stop();
            this.sync_clock.store(0, Ordering::SeqCst);
        } else {
            *slot = Some(camera);
        }
        Ok(())
    }

    /// A frame's host time in seconds: its time on the session's clock, on
    /// the host clock ScreenCaptureKit stamps frames with.
    fn host_secs(&self, pts: ObjcCMTime) -> Option<f64> {
        let sync_clock = self.sync_clock.load(Ordering::SeqCst) as *const c_void;
        let host = if sync_clock.is_null() {
            pts
        } else {
            // SAFETY: the camera session keeps the clock retained until its
            // last frame has been handled.
            unsafe { CMSyncConvertTime(pts, sync_clock, CMClockGetHostTimeClock()) }
        };
        (host.flags & 1 != 0 && host.timescale > 0)
            .then(|| host.value as f64 / f64::from(host.timescale))
    }

    fn on_frame(this: &Arc<Self>, raw: *mut c_void) {
        // Once the track closes, frames still on their way are not kept, as
        // the bubble may have let the camera go.
        if this.closing.load(Ordering::SeqCst) {
            return;
        }
        // SAFETY: `raw` is the live sample buffer AVFoundation handed over.
        let pts = unsafe { CMSampleBufferGetPresentationTimeStamp(raw) };
        let Some(host_secs) = this.host_secs(pts) else {
            return;
        };
        let mut state = lock(&this.state);
        if !state.accepting {
            return;
        }
        // Before the recording's first frame, while paused or after Stop: no
        // recording time. One from just before the first frame is left out
        // rather than stacked at zero.
        let at = match this.clock.frame_time(host_secs) {
            FrameTime::At(secs) if secs >= 0.0 => secs,
            _ => return,
        };
        if state.format.is_none() {
            // SAFETY: as above.
            let Some((width, height)) = (unsafe { frame_size(raw) }) else {
                return;
            };
            let Some(format) = CameraFormat::new(width, height, this.min_frame_secs) else {
                return Self::end_early(this, &mut state, "its frames have no picture".into());
            };
            // SAFETY: builds and configures a writer that nothing else holds yet.
            match unsafe { create_writer(&this.path, &format) } {
                Ok(writer) => {
                    eprintln!(
                        "[rich-tracks] {}: camera track {}x{} px up to {} fps",
                        this.recording_id, format.width_px, format.height_px, format.max_fps
                    );
                    state.writer = Some(writer);
                    state.format = Some(format);
                    // Spaced at half the camera's interval, so a frame that
                    // came a little early doesn't push back every one after.
                    state.timeline = FrameTimeline::with_max_fps(format.max_fps * 2);
                }
                Err(error) => return Self::end_early(this, &mut state, error),
            }
        }
        // SAFETY: as above.
        let Some(sample) = (unsafe { writer_sample(raw) }) else {
            return;
        };
        match Self::append(&mut state, &sample, at) {
            Append::Done => state.not_ready = 0,
            // A camera sends a new picture every frame, so this one is dropped.
            Append::NotReady => {
                state.not_ready += 1;
                if state.not_ready >= NOT_READY_LIMIT {
                    Self::end_early(this, &mut state, "the encoder fell behind".into());
                }
            }
            Append::Failed(error) => Self::end_early(this, &mut state, error),
        }
    }

    fn append(state: &mut CameraState, sample: &CMSampleBuffer, at: f64) -> Append {
        let Some(writer) = state.writer.as_ref() else {
            return Append::Failed("the writer is closed".into());
        };
        // SAFETY: the writer is live and used only under the state lock;
        // exceptions are caught.
        unsafe {
            if !state.started {
                if let Err(error) = writer.start() {
                    return Append::Failed(error);
                }
                state.started = true;
            }
            if !writer.is_ready() {
                return Append::NotReady;
            }
            let place = state.timeline.place(at);
            let copy = match retimed(sample, writer.time(place), INVALID_TIME) {
                Ok(copy) => copy,
                Err(error) => return Append::Failed(error),
            };
            match writer.append(&copy) {
                Ok(()) => {
                    state.timeline.commit(place);
                    Append::Done
                }
                Err(error) => Append::Failed(error),
            }
        }
    }

    /// The track stops before the recording does; the rest of the recording
    /// goes on without it.
    fn end_early(this: &Arc<Self>, state: &mut CameraState, reason: String) {
        if state.stopped_early.is_none() {
            eprintln!(
                "[rich-tracks] {}: camera track stopped early: {reason}",
                this.recording_id
            );
            state.stopped_early = Some(reason);
        }
        state.accepting = false;
        let stopped_secs = this.clock.position_ms().map(|ms| ms / 1000.0);
        Self::close(this, stopped_secs);
    }

    /// Stops the session and closes the file on a thread of its own, once.
    fn close(this: &Arc<Self>, stopped_secs: Option<f64>) {
        if this.closing.swap(true, Ordering::SeqCst) {
            return;
        }
        let shared = Arc::clone(this);
        let spawned = std::thread::Builder::new()
            .name("clips-camera-track-close".into())
            .spawn(move || {
                let session = lock(&shared.session).take();
                if let Some(session) = session {
                    session.stop();
                }
                shared.sync_clock.store(0, Ordering::SeqCst);
                shared.finish(stopped_secs);
            });
        if let Err(error) = spawned {
            eprintln!(
                "[rich-tracks] {}: camera track could not close its file: {error}",
                this.recording_id
            );
            // The camera goes off now all the same; the session lets go of its
            // clock once the track is gone.
            if let Some(session) = lock(&this.session).as_ref() {
                session.halt();
            }
            this.upload
                .fail_source(format!("its file could not be closed: {error}"));
            this.upload.close_source();
        }
    }

    fn finish(&self, stopped_secs: Option<f64>) {
        let mut state = lock(&self.state);
        state.accepting = false;
        let writer = state.writer.take();
        let started = state.started;
        let after_last = state.timeline.end_secs(None);
        let mut end_secs = state.timeline.end_secs(stopped_secs);
        if started && stopped_secs.is_some_and(|stopped| stopped - after_last > CAMERA_SILENCE_SECS)
        {
            state
                .stopped_early
                .get_or_insert_with(|| "the camera stopped sending frames".into());
            end_secs = after_last;
        }
        let mut error = None;
        if let (Some(writer), true) = (writer.as_ref(), started) {
            // SAFETY: the writer is no longer reachable from the frame path.
            if let Err(finish_error) = unsafe { writer.finish(end_secs) } {
                error = Some(finish_error);
            }
        }
        if let Some(sink_error) = writer.as_ref().and_then(TrackWriter::sink_failure) {
            error.get_or_insert(sink_error);
        }
        if let Some(error) = error {
            eprintln!(
                "[rich-tracks] {}: camera track file did not close cleanly: {error}",
                self.recording_id
            );
            state.stopped_early.get_or_insert(error);
        }
        let report = CameraTrackReport {
            format: state.format,
            init: writer.as_ref().and_then(TrackWriter::init_segment),
            frames: state.timeline.frames(),
            start_ms: state.timeline.start_ms(),
            end_ms: started.then(|| (end_secs * 1000.0).round().max(0.0) as u64),
            stopped_early: state.stopped_early.clone(),
            closed: true,
        };
        drop(state);
        eprintln!(
            "[rich-tracks] {}: camera track closed after {} frame(s){}",
            self.recording_id,
            report.frames,
            report
                .stopped_early
                .as_deref()
                .map(|reason| format!(" (stopped early: {reason})"))
                .unwrap_or_default()
        );
        *lock(&self.report) = report;
        if let Some(error) = writer.as_ref().and_then(TrackWriter::sink_failure) {
            self.upload
                .fail_source(format!("its file could not be written: {error}"));
        }
        self.upload.close_source();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_screen::track_upload::TrackSendGate;
    use std::sync::atomic::AtomicU64;
    use std::time::{Duration, Instant};

    /// A camera track with no session and no AVFoundation writer: enough for
    /// closing and the end of the file.
    fn idle_track(clock: RecordingClock) -> Arc<Shared> {
        Arc::new(Shared {
            recording_id: "rec-idle".into(),
            path: PathBuf::from("/nonexistent/camera.mp4"),
            device_name: "FaceTime HD Camera".into(),
            min_frame_secs: Some(1.0 / 30.0),
            clock,
            upload: Arc::new(TrackUploadCtrl::new(
                Arc::new(AtomicBool::new(false)),
                Arc::new(TrackSendGate::new(|| Some(0))),
            )),
            sync_clock: AtomicUsize::new(0),
            closing: AtomicBool::new(false),
            state: Mutex::new(CameraState {
                writer: None,
                format: None,
                started: false,
                accepting: true,
                timeline: FrameTimeline::default(),
                not_ready: 0,
                stopped_early: None,
            }),
            session: Mutex::new(None),
            report: Mutex::new(CameraTrackReport::default()),
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

    fn with_frames(track: &Shared, frames: &[f64]) {
        let mut state = lock(&track.state);
        state.started = true;
        for &secs in frames {
            state.timeline.commit(secs);
        }
    }

    #[test]
    fn a_camera_stopped_while_paused_ends_where_the_pause_began() {
        let clock = clock_at(100.0);
        let track = idle_track(clock.clone());
        with_frames(&track, &[18.5, 19.9]);
        // Paused 20 s in and stopped while still paused.
        clock.pause_at(120_000_000_000);
        let capture = CameraCapture {
            shared: Arc::clone(&track),
        };
        capture.stop();
        wait_until_closed(&track);
        let report = capture.report();
        assert_eq!(report.end_ms, Some(20_000));
        assert_eq!(report.stopped_early, None);
    }

    #[test]
    fn a_camera_that_went_quiet_ends_at_its_last_frame() {
        let track = idle_track(clock_at(100.0));
        with_frames(&track, &[0.0, 7.0]);
        // Stopped at 30 s; nothing came after 7 s.
        Shared::close(&track, Some(30.0));
        wait_until_closed(&track);
        let report = lock(&track.report).clone();
        assert_eq!(
            report.stopped_early.as_deref(),
            Some("the camera stopped sending frames")
        );
        assert_eq!(report.end_ms, Some(7_017));
        // Closing again does nothing more.
        Shared::close(&track, Some(31.0));
        assert_eq!(lock(&track.report).end_ms, Some(7_017));
    }

    #[test]
    fn a_camera_that_never_sent_a_frame_has_nothing_to_list() {
        let track = idle_track(clock_at(100.0));
        Shared::close(&track, Some(12.0));
        wait_until_closed(&track);
        let report = lock(&track.report).clone();
        assert!(report.closed);
        assert_eq!(
            (report.frames, report.end_ms, report.format),
            (0, None, None)
        );
    }
}
