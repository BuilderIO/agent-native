//! Clips' rich recordings on the desktop, behind the Rich recordings lab:
//! separate track files kept beside the flattened recording. Each track writes
//! append-only into `<stem>.tracks/` next to the recording's local file, and
//! its uploader sends the file as it grows, but only while the recording's own
//! live upload has nothing waiting. After Stop, tracks send the rest one at a
//! time once the recording's own upload is finalized, then are finalized with
//! what Clips needs to line them up with the video. A track never delays or
//! fails the recording.
//!
//! The folder is deleted however the recording ends: finalized or not, the
//! tracks abandoned, the recording discarded, the app quit before the tracks
//! were sent. Nothing retries a track later (kept originals are for resending
//! the flattened file only), so a folder left behind would never be read
//! again; the screen file runs to gigabytes.
//!
//! The tracks are the input, the mic and the sound of the Mac when the
//! recording has them, the camera when the bubble shows it, and the screen.
//! Tracks are kept only for display and region recordings on the custom
//! capture pipeline with live upload. Track times are that pipeline's:
//! milliseconds from the flattened recording's first frame on the host clock
//! ScreenCaptureKit stamps frames with, with paused stretches taken out the
//! way the pipeline retimes frames.
//!
//! A new kind of track is a `TrackSource` started in `attach_rich_recording`:
//! it writes one file in the folder and calls `TrackUploadCtrl::close_source`
//! once that file is complete.

use super::*;

use std::collections::BTreeMap;
use std::sync::MutexGuard;

use super::audio_track::{audio_track_finish, AudioSource, AUDIO_TRACK_CONTENT_TYPE};
use super::camera_track::{
    camera_track_finish, CAMERA_TRACK_CONTENT_TYPE, CAMERA_TRACK_FILE, CAMERA_TRACK_ID,
};
use super::input_track::{
    event_host_nanos, input_capture_allowed, recording_ms, start_input_capture, DisplayGeometry,
    InputCapture, INPUT_TRACK_CONTENT_TYPE, INPUT_TRACK_FILE, INPUT_TRACK_ID, MOVE_INTERVAL_MS,
};
use super::screen_track::{
    screen_area, screen_track_finish, SCREEN_TRACK_CONTENT_TYPE, SCREEN_TRACK_FILE, SCREEN_TRACK_ID,
};
use super::track_upload::{
    post_tracks_finalize, spawn_track_uploader, TrackSendGate, TrackUpload, TrackUploadCtrl,
    TrackUploadOutcome, TrackUploadTarget,
};
use super::{
    start_audio_capture, start_camera_capture, AudioCapture, CameraCapture, RichAudioTaps,
    ScreenCapture,
};
use tauri::{EventId, Listener};

/// How long a track's upload may go without storing a byte before the end of
/// the recording gives up on it.
const TRACK_UPLOAD_STALL: Duration = Duration::from_secs(5 * 60);
const TRACK_UPLOAD_CHECK: Duration = Duration::from_secs(15);
/// How long deleting the folder waits for its sources to close their files.
const FOLDER_REMOVAL_WAIT: Duration = Duration::from_secs(30);
const MAX_RECORDING_MS: u64 = 24 * 60 * 60 * 1000;

#[repr(C)]
struct MachTimebaseInfo {
    numer: u32,
    denom: u32,
}

extern "C" {
    fn mach_absolute_time() -> u64;
    fn mach_timebase_info(info: *mut MachTimebaseInfo) -> i32;
}

pub(super) fn host_ticks() -> u64 {
    // SAFETY: takes no arguments and only reads the clock.
    unsafe { mach_absolute_time() }
}

pub(super) fn host_timebase() -> (u32, u32) {
    let mut info = MachTimebaseInfo { numer: 0, denom: 0 };
    // SAFETY: writes the two fields of the struct it is given.
    let status = unsafe { mach_timebase_info(&mut info) };
    if status != 0 || info.numer == 0 || info.denom == 0 {
        (1, 1)
    } else {
        (info.numer, info.denom)
    }
}

/// The recording's pauses on the host clock.
#[derive(Debug, Default)]
struct PauseLog {
    /// The pause under way.
    current: Option<CurrentPause>,
    /// Pauses that have ended, `[began, ended)` in host time.
    ended: Vec<(u64, u64)>,
}

#[derive(Clone, Copy, Debug)]
struct CurrentPause {
    began_nanos: u64,
    /// The recording position it holds.
    position_ms: f64,
    /// The pipeline's pause offset when it began; a resume grows it.
    offset_bits: u64,
}

/// Recording time, read from the capture pipeline's own clock state: the
/// first frame's host time and the pause offset it subtracts from frames.
#[derive(Clone)]
pub(super) struct RecordingClock {
    session_start_bits: Arc<AtomicU64>,
    pause_offset_bits: Arc<AtomicU64>,
    pauses: Arc<Mutex<PauseLog>>,
    /// The host time Stop was pressed at; nothing after it is kept.
    stop_host_nanos: Arc<AtomicU64>,
    timebase: (u32, u32),
}

impl RecordingClock {
    pub(super) fn new(
        session_start_bits: Arc<AtomicU64>,
        pause_offset_bits: Arc<AtomicU64>,
        timebase: (u32, u32),
    ) -> Self {
        Self {
            session_start_bits,
            pause_offset_bits,
            pauses: Arc::default(),
            stop_host_nanos: Arc::new(AtomicU64::new(u64::MAX)),
            timebase,
        }
    }

    /// Stop was pressed at `host_nanos`: an event or frame captured after it
    /// has no recording time, however late its callback runs.
    pub(super) fn stop_at(&self, host_nanos: u64) {
        self.stop_host_nanos.fetch_min(host_nanos, Ordering::SeqCst);
    }

    fn after_stop(&self, host_nanos: u64) -> bool {
        host_nanos > self.stop_host_nanos.load(Ordering::SeqCst)
    }

    fn pause_log(&self) -> MutexGuard<'_, PauseLog> {
        self.pauses
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The capture pipeline paused at `host_nanos`. Returns the recording
    /// position the pause holds; a second call keeps the first one's.
    pub(super) fn pause_at(&self, host_nanos: u64) -> f64 {
        let offset_bits = self.pause_offset_bits.load(Ordering::SeqCst);
        let position_ms = recording_ms(
            host_nanos,
            self.session_start_secs(),
            f64::from_bits(offset_bits),
        )
        .unwrap_or(0.0);
        self.pause_log()
            .current
            .get_or_insert(CurrentPause {
                began_nanos: host_nanos,
                position_ms,
                offset_bits,
            })
            .position_ms
    }

    /// The capture pipeline resumed at `host_nanos`. Returns the position the
    /// pause held, or `None` when it wasn't paused.
    pub(super) fn resume_at(&self, host_nanos: u64) -> Option<f64> {
        let mut log = self.pause_log();
        let pause = log.current.take()?;
        let ended = self
            .resumed_at_nanos(&pause)
            .unwrap_or(host_nanos)
            .min(host_nanos)
            .max(pause.began_nanos);
        log.ended.push((pause.began_nanos, ended));
        Some(pause.position_ms)
    }

    /// Where the resumed recording begins on the host clock: the host time
    /// the pipeline's grown offset puts at the position the pause holds.
    /// `None` until the pipeline has applied the resume's offset, which it
    /// does before its new stream starts and so before the session ends the
    /// pause here. It puts the offset back if the new stream fails to start.
    fn resumed_at_nanos(&self, pause: &CurrentPause) -> Option<u64> {
        let offset_bits = self.pause_offset_bits.load(Ordering::SeqCst);
        if offset_bits == pause.offset_bits {
            return None;
        }
        let secs =
            pause.position_ms / 1000.0 + self.session_start_secs() + f64::from_bits(offset_bits);
        secs.is_finite().then(|| (secs.max(0.0) * 1e9) as u64)
    }

    /// Whether something captured at `host_nanos` belongs to no recording
    /// time: anything from inside a pause, however late its callback runs.
    /// After the resume the pipeline's offset has grown, and would give it a
    /// time in the stretch after.
    fn in_pause(&self, host_nanos: u64, resume_from: ResumeFrom) -> bool {
        let log = self.pause_log();
        let in_current = log.current.is_some_and(|pause| {
            resume_from == ResumeFrom::Session
                || self
                    .resumed_at_nanos(&pause)
                    .is_none_or(|resumed| host_nanos < resumed)
        });
        in_current
            || log
                .ended
                .iter()
                .any(|&(began, ended)| (began..ended).contains(&host_nanos))
    }

    /// The position the pause under way holds; `None` while not paused.
    pub(super) fn paused_position_ms(&self) -> Option<f64> {
        self.pause_log().current.map(|pause| pause.position_ms)
    }

    fn session_start_secs(&self) -> f64 {
        f64::from_bits(self.session_start_bits.load(Ordering::SeqCst))
    }

    fn pause_offset_secs(&self) -> f64 {
        f64::from_bits(self.pause_offset_bits.load(Ordering::SeqCst))
    }

    /// Recording milliseconds of a host time; `None` before the first frame,
    /// while paused and for a time inside an earlier pause.
    pub(super) fn at_host_nanos(&self, nanos: u64) -> Option<f64> {
        if self.in_pause(nanos, ResumeFrom::Session) {
            return None;
        }
        recording_ms(nanos, self.session_start_secs(), self.pause_offset_secs())
    }

    /// Recording milliseconds of an event's `CGEventGetTimestamp`; `None` for
    /// one after Stop too.
    pub(super) fn at_event_stamp(&self, stamp: u64) -> Option<f64> {
        let (numer, denom) = self.timebase;
        let nanos = event_host_nanos(stamp, host_ticks(), numer, denom);
        if self.after_stop(nanos) {
            return None;
        }
        self.at_host_nanos(nanos)
    }

    pub(super) fn now_ms(&self) -> Option<f64> {
        self.at_host_nanos(self.host_now_nanos())
    }

    /// Where the recording is: now, or while paused the position the pause
    /// holds, which is where a track stopped while paused ends.
    pub(super) fn position_ms(&self) -> Option<f64> {
        self.paused_position_ms().or_else(|| self.now_ms())
    }

    pub(super) fn pause(&self) -> f64 {
        self.pause_at(self.host_now_nanos())
    }

    pub(super) fn resume(&self) -> Option<f64> {
        self.resume_at(self.host_now_nanos())
    }

    /// Recording seconds of a frame stamped `pts_secs` on the host clock: the
    /// first frame's time and the pause offset taken off, as the flattened
    /// writer retimes its own frames. Negative for a frame captured before
    /// the first one.
    pub(super) fn frame_time(&self, pts_secs: f64) -> FrameTime {
        self.place_frame(pts_secs, ResumeFrom::Session)
    }

    /// `frame_time` for a buffer of the flattened recording's own stream,
    /// which counts from the resume as the flattened writer does: once the
    /// pipeline applies the resume's offset, since its new stream sends
    /// nothing unless it starts.
    pub(super) fn stream_frame_time(&self, pts_secs: f64) -> FrameTime {
        self.place_frame(pts_secs, ResumeFrom::Offset)
    }

    fn place_frame(&self, pts_secs: f64, resume_from: ResumeFrom) -> FrameTime {
        let host_nanos = (pts_secs.max(0.0) * 1e9) as u64;
        if self.after_stop(host_nanos) {
            return FrameTime::AfterStop;
        }
        if self.in_pause(host_nanos, resume_from) {
            return FrameTime::Paused;
        }
        let start = self.session_start_secs();
        if !start.is_finite() {
            return FrameTime::BeforeStart;
        }
        FrameTime::At(pts_secs - start - self.pause_offset_secs())
    }

    fn host_now_nanos(&self) -> u64 {
        let (numer, denom) = self.timebase;
        (u128::from(host_ticks()) * u128::from(numer) / u128::from(denom.max(1))) as u64
    }
}

/// From when something captured after a resume, but handled before the
/// session ends the pause, has a recording time.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ResumeFrom {
    /// Once the pipeline applies the resume's offset.
    Offset,
    /// Once the session ends the pause, so a capture that runs through the
    /// pause keeps nothing from a resume that fails.
    Session,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum FrameTime {
    /// The recording has no first frame yet.
    BeforeStart,
    Paused,
    AfterStop,
    At(f64),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct RectPt {
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) width: f64,
    pub(super) height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum CaptureKind {
    Display,
    Region,
    Window,
}

/// What the flattened recording shows, for the manifest and for placing input.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct CaptureInfo {
    pub(super) kind: CaptureKind,
    /// The captured display. `None` for a window recording.
    pub(super) display: Option<DisplayGeometry>,
    /// The recorded part of the display, in global points.
    pub(super) area_pt: Option<RectPt>,
}

/// A capture region (fractions of the display) in global points, cropped to
/// whole points exactly as the flattened recording's stream crops it.
pub(super) fn region_area_pt(
    display: &DisplayGeometry,
    region: &NativeCaptureRegion,
) -> Result<RectPt, String> {
    let (rect, width, height) = region_source_rect(
        Some(*region),
        display.width_pt.round() as u32,
        display.height_pt.round() as u32,
    )?
    .ok_or_else(|| "the region has no size".to_string())?;
    Ok(RectPt {
        x: display.x_pt + rect.x,
        y: display.y_pt + rect.y,
        width: f64::from(width),
        height: f64::from(height),
    })
}

fn capture_info(restart: &RestartInfo) -> Result<CaptureInfo, String> {
    if restart.target_window_id.is_some() {
        return Ok(CaptureInfo {
            kind: CaptureKind::Window,
            display: None,
            area_pt: None,
        });
    }
    let id = restart
        .target_display_id
        .ok_or_else(|| "the captured display is not known".to_string())?;
    let display = CGDisplay::new(id);
    let bounds = display.bounds();
    let (width_px, height_px) = display
        .display_mode()
        .map(|mode| (mode.pixel_width() as u32, mode.pixel_height() as u32))
        .ok_or_else(|| format!("display {id} has no display mode"))?;
    if bounds.size.width <= 0.0 || width_px == 0 {
        return Err(format!("display {id} reports no size"));
    }
    let geometry = DisplayGeometry {
        id,
        x_pt: bounds.origin.x,
        y_pt: bounds.origin.y,
        width_pt: bounds.size.width,
        height_pt: bounds.size.height,
        width_px,
        height_px,
    };
    let area_pt = restart
        .capture_region
        .map(|region| region_area_pt(&geometry, &region))
        .transpose()?;
    Ok(CaptureInfo {
        kind: if area_pt.is_some() {
            CaptureKind::Region
        } else {
            CaptureKind::Display
        },
        display: Some(geometry),
        area_pt,
    })
}

/// What finalizing lists for a track, read once its file is closed.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct TrackFinish {
    pub(super) complete: bool,
    /// Recording milliseconds the track covers.
    pub(super) start_ms: u64,
    pub(super) end_ms: u64,
    pub(super) meta: serde_json::Value,
}

/// Something writing one track file of a rich recording. Shared between the
/// session and the uploaders, which stop it when its upload ends for good.
pub(super) trait TrackSource: Send + Sync {
    /// Stops capturing. The source then closes its file on its own and tells
    /// its uploader with `TrackUploadCtrl::close_source`. Never blocks, and
    /// does nothing more the second time.
    fn stop(&self);
    /// The capture pipeline paused or resumed. Never blocks.
    fn pause(&self) {}
    fn resume(&self) {}
    /// Read after the uploader has sent the whole file.
    fn finish(&self, duration_ms: u64) -> TrackFinish;
}

impl TrackSource for InputCapture {
    fn stop(&self) {
        InputCapture::stop(self);
    }

    fn pause(&self) {
        self.mark_break();
    }

    fn resume(&self) {
        self.mark_break();
    }

    fn finish(&self, duration_ms: u64) -> TrackFinish {
        let report = self.report();
        TrackFinish {
            complete: report.closed && !report.gaps && !report.write_failed,
            start_ms: 0,
            end_ms: duration_ms,
            meta: serde_json::json!({
                "space": "screen-px",
                "moveIntervalMs": MOVE_INTERVAL_MS as u64,
                "covers": "global",
            }),
        }
    }
}

impl TrackSource for AudioCapture {
    fn stop(&self) {
        AudioCapture::stop(self);
    }

    fn finish(&self, duration_ms: u64) -> TrackFinish {
        audio_track_finish(&self.report(), duration_ms)
    }
}

/// The camera track, which also stops when the bubble lets go of the camera,
/// at Stop or when the bubble closes before it, so the camera never stays on
/// for the track alone. It then ends there, holding all the camera showed.
struct CameraTrack {
    capture: Arc<CameraCapture>,
    app: AppHandle,
    release_listener: EventId,
}

impl TrackSource for CameraTrack {
    fn stop(&self) {
        self.capture.stop();
    }

    fn finish(&self, duration_ms: u64) -> TrackFinish {
        camera_track_finish(&self.capture.report(), duration_ms)
    }
}

impl Drop for CameraTrack {
    fn drop(&mut self) {
        self.app.unlisten(self.release_listener);
    }
}

impl TrackSource for ScreenCapture {
    fn stop(&self) {
        ScreenCapture::stop(self);
    }

    fn pause(&self) {
        ScreenCapture::pause(self);
    }

    fn resume(&self) {
        ScreenCapture::resume(self);
    }

    fn finish(&self, duration_ms: u64) -> TrackFinish {
        screen_track_finish(&self.report(), &self.area(), duration_ms)
    }
}

struct RunningTrack {
    id: &'static str,
    source: Arc<dyn TrackSource>,
    upload: TrackUpload,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Pause {
    pub(super) at_ms: u64,
    pub(super) wall_ms: u64,
}

pub(super) struct RichRecording {
    folder: PathBuf,
    target: Arc<TrackUploadTarget>,
    tracks_stopped: Arc<AtomicBool>,
    gate: Arc<TrackSendGate>,
    clock: RecordingClock,
    capture: CaptureInfo,
    camera_bubble: bool,
    app_version: String,
    pauses: Vec<Pause>,
    stopped_at: Option<(chrono::DateTime<Utc>, u64)>,
    tracks: Vec<RunningTrack>,
}

/// `<stem>.tracks/` beside the recording's local file.
pub(super) fn tracks_folder_for(recording_path: &Path) -> PathBuf {
    recording_path.with_extension("tracks")
}

/// Starts a rich recording's tracks for a recording that just began. Leaves
/// the session without one, and logs why, when tracks can't be kept.
pub(super) fn attach_rich_recording(
    app: &AppHandle,
    session: &mut NativeFullscreenSession,
    recording_id: &str,
    server_url: Option<&str>,
    auth_token: Option<&str>,
    cookie: Option<&str>,
    has_camera: bool,
    camera_label: Option<&str>,
) {
    let skip = |reason: &str| {
        eprintln!("[rich-tracks] {recording_id}: no tracks for this recording: {reason}");
    };
    if session.rich_recording.is_some() {
        return;
    }
    let (clock_bits, audio_taps) = match session.backend.as_ref() {
        Some(NativeFullscreenBackend::CustomScreenCaptureKit { writer, .. }) => {
            (writer.recording_clock_bits(), writer.rich_audio_taps())
        }
        _ => return skip("it is not on the custom capture pipeline"),
    };
    let Some(live_upload) = session.live_upload.as_ref() else {
        return skip("it has no live upload");
    };
    let (Some(server_url), auth_token, cookie) = (
        server_url.filter(|url| !url.trim().is_empty()),
        auth_token.unwrap_or_default(),
        cookie.unwrap_or_default(),
    ) else {
        return skip("there is no server to send them to");
    };
    let capture = match capture_info(&session.restart) {
        Ok(capture) => capture,
        Err(reason) => return skip(&reason),
    };
    // A window's filter brings the camera bubble and the window's own frame,
    // and the window can move between displays, so neither its pixels nor
    // input on it map simply onto one display yet.
    if capture.kind == CaptureKind::Window {
        return skip("window recordings keep no tracks yet");
    }

    let folder = tracks_folder_for(&session.path);
    if let Err(error) = std::fs::create_dir_all(&folder) {
        return skip(&format!("{} could not be made: {error}", folder.display()));
    }
    FOLDERS_IN_USE.add(&folder, recording_id);
    let target = Arc::new(TrackUploadTarget {
        server_url: server_url.to_string(),
        recording_id: recording_id.to_string(),
        auth_token: auth_token.to_string(),
        cookie: cookie.to_string(),
    });
    let tracks_stopped = Arc::new(AtomicBool::new(false));
    let live_ctrl = Arc::clone(&live_upload.ctrl);
    let video_path = session.path.clone();
    let gate = Arc::new(TrackSendGate::new(move || {
        let written = std::fs::metadata(&video_path).ok()?.len();
        Some(written.saturating_sub(live_ctrl.uploaded_bytes.load(Ordering::SeqCst)))
    }));
    let (session_start_bits, pause_offset_bits) = clock_bits;
    let clock = RecordingClock::new(session_start_bits, pause_offset_bits, host_timebase());

    // Tracks send their last chunks in this order, small first.
    let mut starts = vec![input_track_start(&clock, &capture)];
    if session.restart.include_audio {
        starts.push(audio_track_start(
            &clock,
            &audio_taps,
            AudioSource::Mic,
            recording_id,
        ));
    }
    if session.restart.capture_system_audio {
        starts.push(audio_track_start(
            &clock,
            &audio_taps,
            AudioSource::System,
            recording_id,
        ));
    }
    let camera_bubble = has_camera && session.restart.include_camera_overlay;
    if camera_bubble {
        starts.push(camera_track_start(app, &clock, camera_label, recording_id));
    }
    starts.push(screen_track_start(&clock, &capture, recording_id));
    let started = start_sources(recording_id, &folder, starts, || {
        Arc::new(TrackUploadCtrl::new(
            Arc::clone(&tracks_stopped),
            Arc::clone(&gate),
        ))
    });
    if started.is_empty() {
        return skip("no track could start");
    }
    eprintln!(
        "[rich-tracks] {recording_id}: keeping {} in {}",
        started
            .iter()
            .map(|track| track.id)
            .collect::<Vec<_>>()
            .join(", "),
        folder.display()
    );
    let tracks = spawn_uploaders(&target, &folder, started);
    session.rich_recording = Some(RichRecording {
        folder,
        target,
        tracks_stopped,
        gate,
        clock,
        capture,
        camera_bubble,
        app_version: app.package_info().version.to_string(),
        pauses: Vec::new(),
        stopped_at: None,
        tracks,
    });
}

type StartSource =
    Box<dyn FnOnce(&Path, Arc<TrackUploadCtrl>) -> Result<Arc<dyn TrackSource>, String>>;

/// How to start one track's source writing its file.
struct TrackStart {
    id: &'static str,
    file: &'static str,
    content_type: &'static str,
    start: StartSource,
}

struct StartedSource {
    id: &'static str,
    file: PathBuf,
    content_type: &'static str,
    source: Arc<dyn TrackSource>,
    ctrl: Arc<TrackUploadCtrl>,
}

fn input_track_start(clock: &RecordingClock, capture: &CaptureInfo) -> TrackStart {
    let clock = clock.clone();
    let capture = *capture;
    TrackStart {
        id: INPUT_TRACK_ID,
        file: INPUT_TRACK_FILE,
        content_type: INPUT_TRACK_CONTENT_TYPE,
        start: Box::new(move |path, ctrl| {
            let display = capture
                .display
                .ok_or_else(|| "the captured display is not known".to_string())?;
            if !input_capture_allowed() {
                return Err(
                    "Clips has neither Input Monitoring nor Accessibility access".to_string(),
                );
            }
            let space = display.pixel_space(capture.area_pt.map(|area| (area.x, area.y)));
            let source: Arc<dyn TrackSource> =
                Arc::new(start_input_capture(path, clock, space, ctrl)?);
            Ok(source)
        }),
    }
}

fn audio_track_start(
    clock: &RecordingClock,
    taps: &Arc<RichAudioTaps>,
    source: AudioSource,
    recording_id: &str,
) -> TrackStart {
    let clock = clock.clone();
    let taps = Arc::clone(taps);
    let recording_id = recording_id.to_string();
    TrackStart {
        id: source.track_id(),
        file: source.file(),
        content_type: AUDIO_TRACK_CONTENT_TYPE,
        start: Box::new(move |path, ctrl| {
            let track: Arc<dyn TrackSource> = Arc::new(start_audio_capture(
                path,
                source,
                &taps,
                clock,
                ctrl,
                &recording_id,
            )?);
            Ok(track)
        }),
    }
}

fn camera_track_start(
    app: &AppHandle,
    clock: &RecordingClock,
    camera_label: Option<&str>,
    recording_id: &str,
) -> TrackStart {
    let app = app.clone();
    let clock = clock.clone();
    let camera_label = camera_label.map(str::to_string);
    let recording_id = recording_id.to_string();
    TrackStart {
        id: CAMERA_TRACK_ID,
        file: CAMERA_TRACK_FILE,
        content_type: CAMERA_TRACK_CONTENT_TYPE,
        start: Box::new(move |path, ctrl| {
            let capture = Arc::new(start_camera_capture(
                path,
                camera_label.as_deref(),
                clock,
                ctrl,
                &recording_id,
            )?);
            let released = Arc::downgrade(&capture);
            let release_listener = app.listen(crate::clips::RELEASE_CAMERA_EVENT, move |_| {
                if let Some(capture) = released.upgrade() {
                    capture.stop();
                }
            });
            let track: Arc<dyn TrackSource> = Arc::new(CameraTrack {
                capture,
                app,
                release_listener,
            });
            Ok(track)
        }),
    }
}

fn screen_track_start(
    clock: &RecordingClock,
    capture: &CaptureInfo,
    recording_id: &str,
) -> TrackStart {
    let clock = clock.clone();
    let capture = *capture;
    let recording_id = recording_id.to_string();
    TrackStart {
        id: SCREEN_TRACK_ID,
        file: SCREEN_TRACK_FILE,
        content_type: SCREEN_TRACK_CONTENT_TYPE,
        start: Box::new(move |path, ctrl| {
            let display = capture
                .display
                .ok_or_else(|| "the captured display is not known".to_string())?;
            let area = screen_area(&display, capture.area_pt);
            let source: Arc<dyn TrackSource> = Arc::new(super::start_screen_capture(
                path,
                display.id,
                area,
                clock,
                ctrl,
                &recording_id,
            )?);
            Ok(source)
        }),
    }
}

/// Starts each track's source in `folder`, in order. A source that fails to
/// start leaves no file behind, and when none starts the folder goes too.
fn start_sources(
    recording_id: &str,
    folder: &Path,
    starts: Vec<TrackStart>,
    new_ctrl: impl Fn() -> Arc<TrackUploadCtrl>,
) -> Vec<StartedSource> {
    let mut started = Vec::new();
    for start in starts {
        let file = folder.join(start.file);
        let ctrl = new_ctrl();
        match (start.start)(&file, Arc::clone(&ctrl)) {
            Ok(source) => started.push(StartedSource {
                id: start.id,
                file,
                content_type: start.content_type,
                source,
                ctrl,
            }),
            Err(reason) => {
                eprintln!(
                    "[rich-tracks] {recording_id}: no {} track: {reason}",
                    start.id
                );
                remove_path(recording_id, &file);
            }
        }
    }
    if started.is_empty() {
        remove_path(recording_id, folder);
    }
    started
}

/// Starts each source's uploader. Every uploader can stop capture when its
/// upload ends for good, without the session.
fn spawn_uploaders(
    target: &Arc<TrackUploadTarget>,
    folder: &Path,
    started: Vec<StartedSource>,
) -> Vec<RunningTrack> {
    let teardown = Arc::new(TrackTeardown {
        recording_id: target.recording_id.clone(),
        folder: folder.to_path_buf(),
        tracks: started
            .iter()
            .map(|track| TeardownTrack {
                file: track.file.clone(),
                source: Arc::clone(&track.source),
                ctrl: Arc::clone(&track.ctrl),
            })
            .collect(),
    });
    started
        .into_iter()
        .enumerate()
        .map(|(index, track)| {
            let teardown = Arc::clone(&teardown);
            let upload = spawn_track_uploader(
                Arc::clone(target),
                track.id,
                track.content_type,
                track.file,
                track.ctrl,
                move |outcome| teardown.upload_ended(index, outcome),
            );
            RunningTrack {
                id: track.id,
                source: track.source,
                upload,
            }
        })
        .collect()
}

struct TeardownTrack {
    file: PathBuf,
    source: Arc<dyn TrackSource>,
    ctrl: Arc<TrackUploadCtrl>,
}

/// What an upload that ends for good needs to stop capture and clear the disk
/// while the recording goes on: nothing it sends will be read again.
struct TrackTeardown {
    recording_id: String,
    folder: PathBuf,
    tracks: Vec<TeardownTrack>,
}

impl TrackTeardown {
    /// Track `index`'s upload ended with `outcome`. Once the server stops the
    /// recording's tracks, every source stops and the folder goes; a track
    /// whose upload failed stops its own source and its file goes. Never
    /// blocks: files go once their sources have closed them.
    fn upload_ended(&self, index: usize, outcome: &TrackUploadOutcome) {
        match outcome {
            TrackUploadOutcome::Stopped(_) => {
                for track in &self.tracks {
                    track.source.stop();
                }
                let ctrls = self
                    .tracks
                    .iter()
                    .map(|track| Arc::clone(&track.ctrl))
                    .collect();
                remove_once_closed(&self.recording_id, self.folder.clone(), ctrls);
            }
            TrackUploadOutcome::Failed(_) => {
                let Some(track) = self.tracks.get(index) else {
                    return;
                };
                track.source.stop();
                remove_once_closed(
                    &self.recording_id,
                    track.file.clone(),
                    vec![Arc::clone(&track.ctrl)],
                );
            }
            TrackUploadOutcome::Sent { .. }
            | TrackUploadOutcome::Empty
            | TrackUploadOutcome::Cancelled => {}
        }
    }
}

impl RichRecording {
    /// The capture pipeline just paused: its frames stop until `resume`.
    pub(super) fn pause(&mut self) {
        if self.clock.paused_position_ms().is_some() {
            return;
        }
        self.clock.pause();
        for track in &self.tracks {
            track.source.pause();
        }
    }

    /// The capture pipeline resumed with `paused_for` added to its offset.
    pub(super) fn resume(&mut self, paused_for: Duration) {
        let Some(at_ms) = self.clock.resume() else {
            return;
        };
        self.pauses.push(Pause {
            at_ms: (at_ms.round().max(0.0) as u64).min(MAX_RECORDING_MS),
            wall_ms: paused_for.as_millis() as u64,
        });
        for track in &self.tracks {
            track.source.resume();
        }
    }

    #[cfg(test)]
    pub(super) fn is_paused(&self) -> bool {
        self.clock.paused_position_ms().is_some()
    }

    /// The recording stopped: stop capturing input and the screen right away,
    /// and hold every track's upload until the recording's own is finalized.
    pub(super) fn stop_capture(&mut self) {
        let (_, stopped_host_nanos) = *self
            .stopped_at
            .get_or_insert_with(|| (Utc::now(), self.clock.host_now_nanos()));
        self.clock.stop_at(stopped_host_nanos);
        self.gate.stop_recording();
        for track in &self.tracks {
            track.source.stop();
        }
    }

    /// Stops every track and deletes the folder once their files are closed.
    fn halt(&mut self) {
        self.stop_capture();
        let tracks = std::mem::take(&mut self.tracks);
        for track in &tracks {
            track.upload.ctrl.cancel();
        }
        let ctrls = tracks
            .iter()
            .map(|track| Arc::clone(&track.upload.ctrl))
            .collect();
        remove_once_closed(&self.target.recording_id, self.folder.clone(), ctrls);
    }

    /// The app is quitting, and nothing gets to run long enough for the
    /// sources to close their files: stop everything and delete the folder
    /// now. A file still open goes with it once it closes.
    pub(super) fn quit(mut self) {
        self.stop_capture();
        for track in std::mem::take(&mut self.tracks) {
            track.upload.ctrl.cancel();
        }
        remove_path(&self.target.recording_id, &self.folder);
    }

    /// The recording carries on without tracks.
    pub(super) fn abandon(mut self, reason: &str) {
        eprintln!(
            "[rich-tracks] {}: tracks stopped ({reason})",
            self.target.recording_id
        );
        self.halt();
    }

    /// The recording is being thrown away, so its tracks are too.
    pub(super) fn discard(mut self) {
        self.halt();
    }

    /// The recording's own upload is finalized: send the rest of each track,
    /// then finalize the tracks. Runs in the background and only logs.
    pub(super) fn finish(mut self, duration_ms: u64) {
        self.stop_capture();
        let tracks = std::mem::take(&mut self.tracks);
        let session_start = self.clock.session_start_secs();
        let started_at = self
            .stopped_at
            .and_then(|(wall, host_nanos)| started_at_from(wall, host_nanos, session_start));
        let finish = FinishContext {
            folder: self.folder.clone(),
            target: Arc::clone(&self.target),
            tracks_stopped: Arc::clone(&self.tracks_stopped),
            started_at,
            fields: ManifestFields {
                started_at: String::new(),
                duration_ms: duration_ms.min(MAX_RECORDING_MS),
                app_version: self.app_version.clone(),
                os: crate::system_audio::system_audio_version_status().os_version,
                pauses: std::mem::take(&mut self.pauses),
                capture: self.capture,
                camera_bubble: self.camera_bubble,
            },
        };
        tauri::async_runtime::spawn(finish_tracks(finish, tracks, |target, body| async move {
            post_tracks_finalize(&target, &body).await
        }));
    }
}

impl Drop for RichRecording {
    /// Dropped without `finish`, `abandon` or `discard`: the tracks will never
    /// be finalized.
    fn drop(&mut self) {
        if !self.tracks.is_empty() {
            eprintln!(
                "[rich-tracks] {}: tracks dropped without finishing",
                self.target.recording_id
            );
            self.halt();
        }
    }
}

/// Deletes `path`, a tracks folder or one track's file, once every source
/// writing in it has closed its file, so nothing writes there afterwards, or
/// after `FOLDER_REMOVAL_WAIT` regardless. Right away when they already have.
fn remove_once_closed(recording_id: &str, path: PathBuf, sources: Vec<Arc<TrackUploadCtrl>>) {
    if sources.iter().all(|ctrl| ctrl.source_closed()) {
        return remove_path(recording_id, &path);
    }
    let id = recording_id.to_string();
    let in_thread = path.clone();
    let spawned = std::thread::Builder::new()
        .name("clips-rich-tracks-cleanup".into())
        .spawn(move || {
            let deadline = Instant::now() + FOLDER_REMOVAL_WAIT;
            while Instant::now() < deadline && sources.iter().any(|ctrl| !ctrl.source_closed()) {
                std::thread::sleep(Duration::from_millis(100));
            }
            remove_path(&id, &in_thread);
        });
    if let Err(error) = spawned {
        eprintln!(
            "[rich-tracks] {recording_id}: removing {} now ({error})",
            path.display()
        );
        remove_path(recording_id, &path);
    }
}

fn remove_path(recording_id: &str, path: &Path) {
    let removed = match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() => std::fs::remove_dir_all(path),
        Ok(_) => std::fs::remove_file(path),
        Err(error) => Err(error),
    };
    match removed {
        Ok(()) => eprintln!("[rich-tracks] {recording_id}: removed {}", path.display()),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => {
            eprintln!(
                "[rich-tracks] {recording_id}: {} could not be removed: {error}",
                path.display()
            );
            return;
        }
    }
    FOLDERS_IN_USE.forget(path);
}

/// The tracks folders this run has made and not yet removed, by recording id.
/// After Stop a recording's tracks leave the session, and once the video is
/// finalized they send on in the background, so a quit meanwhile reaches
/// their folder only through here.
struct FoldersInUse(Mutex<BTreeMap<PathBuf, String>>);

static FOLDERS_IN_USE: FoldersInUse = FoldersInUse::new();

impl FoldersInUse {
    const fn new() -> Self {
        Self(Mutex::new(BTreeMap::new()))
    }

    fn folders(&self) -> MutexGuard<'_, BTreeMap<PathBuf, String>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn add(&self, folder: &Path, recording_id: &str) {
        self.folders()
            .insert(folder.to_path_buf(), recording_id.to_string());
    }

    fn forget(&self, path: &Path) {
        self.folders().remove(path);
    }

    #[cfg(test)]
    fn contains(&self, folder: &Path) -> bool {
        self.folders().contains_key(folder)
    }

    /// Deletes every folder now, whatever is still writing or sending there.
    fn remove_all(&self) {
        let folders = std::mem::take(&mut *self.folders());
        for (folder, recording_id) in folders {
            remove_path(&recording_id, &folder);
        }
    }
}

/// The app is quitting: deletes every tracks folder this run still has,
/// without waiting for anything writing or sending there.
pub(super) fn remove_tracks_folders_in_use() {
    FOLDERS_IN_USE.remove_all();
}

/// Whether `name` is a tracks folder this app made for a recording of another
/// run: `<pending recording stem>.tracks`, the stem as
/// `pending_recording_file_stem` names it, `clips-pending-recording-<id>-<pid>`.
fn is_leftover_tracks_folder_name(name: &str, current_pid: u32) -> bool {
    let Some(stem) = name.strip_suffix(".tracks") else {
        return false;
    };
    let Some(id_and_pid) = stem.strip_prefix("clips-pending-recording-") else {
        return false;
    };
    let Some((id, pid)) = id_and_pid.rsplit_once('-') else {
        return false;
    };
    let id_is_safe = !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    let pid_is_other = !pid.is_empty()
        && pid.bytes().all(|byte| byte.is_ascii_digit())
        && pid.parse::<u32>().is_ok_and(|pid| pid != current_pid);
    id_is_safe && pid_is_other
}

/// Deletes the tracks folders an earlier run left in `recordings_dir`: a quit
/// that skipped cleanup, or a crash. Nothing sends a track after its run ends.
/// Returns how many it deleted.
pub(super) fn remove_leftover_tracks_folders(recordings_dir: &Path, current_pid: u32) -> usize {
    let entries = match std::fs::read_dir(recordings_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == ErrorKind::NotFound => return 0,
        Err(error) => {
            eprintln!(
                "[rich-tracks] leftover tracks folders could not be listed in {}: {error}",
                recordings_dir.display()
            );
            return 0;
        }
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        // Never a symlink: only a folder this app made.
        let is_dir = entry.file_type().is_ok_and(|kind| kind.is_dir());
        if !is_dir || !is_leftover_tracks_folder_name(name, current_pid) {
            continue;
        }
        match std::fs::remove_dir_all(entry.path()) {
            Ok(()) => removed += 1,
            Err(error) => eprintln!(
                "[rich-tracks] leftover {} could not be removed: {error}",
                entry.path().display()
            ),
        }
    }
    if removed > 0 {
        eprintln!("[rich-tracks] removed {removed} leftover tracks folder(s)");
    }
    removed
}

/// The wall time of the first frame: the wall time at stop, less the host
/// time that passed since the first frame (pauses included).
fn started_at_from(
    wall_at_stop: chrono::DateTime<Utc>,
    host_nanos_at_stop: u64,
    session_start_secs: f64,
) -> Option<String> {
    if !session_start_secs.is_finite() {
        return None;
    }
    let since_start_ms = (host_nanos_at_stop as f64 / 1e6 - session_start_secs * 1000.0).max(0.0);
    let started = wall_at_stop - chrono::Duration::milliseconds(since_start_ms.round() as i64);
    Some(started.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

pub(super) struct ManifestFields {
    pub(super) started_at: String,
    pub(super) duration_ms: u64,
    pub(super) app_version: String,
    pub(super) os: String,
    pub(super) pauses: Vec<Pause>,
    pub(super) capture: CaptureInfo,
    pub(super) camera_bubble: bool,
}

pub(super) struct FinishedTrack {
    pub(super) id: &'static str,
    pub(super) finish: TrackFinish,
}

/// The body of `POST /api/uploads/:id/tracks/finalize`.
pub(super) fn tracks_finalize_body(
    fields: &ManifestFields,
    tracks: &[FinishedTrack],
) -> serde_json::Value {
    let rect = |rect: RectPt| {
        serde_json::json!({
            "x": rect.x,
            "y": rect.y,
            "width": rect.width,
            "height": rect.height,
        })
    };
    let displays: Vec<serde_json::Value> = fields
        .capture
        .display
        .iter()
        .map(|display| {
            serde_json::json!({
                "id": display.id.to_string(),
                "widthPx": display.width_px,
                "heightPx": display.height_px,
                "scale": display.scale(),
                "boundsPt": rect(RectPt {
                    x: display.x_pt,
                    y: display.y_pt,
                    width: display.width_pt,
                    height: display.height_pt,
                }),
            })
        })
        .collect();
    let mut capture = serde_json::json!({
        "kind": match fields.capture.kind {
            CaptureKind::Display => "display",
            CaptureKind::Region => "region",
            CaptureKind::Window => "window",
        },
        "displays": displays,
    });
    if let Some(area) = fields.capture.area_pt {
        capture["areaPt"] = rect(area);
    }
    serde_json::json!({
        "status": "complete",
        "startedAt": fields.started_at,
        "durationMs": fields.duration_ms,
        "writer": {
            "surface": "desktop-macos",
            "app": "Clips",
            "version": fields.app_version,
            "os": fields.os,
        },
        "clock": {
            "host": "mach-host-time",
            "pauses": fields
                .pauses
                .iter()
                .map(|pause| serde_json::json!({ "atMs": pause.at_ms, "wallMs": pause.wall_ms }))
                .collect::<Vec<_>>(),
        },
        "capture": capture,
        "compat": {
            "offsetMs": 0,
            "cursor": "in-pixels",
            "camera": if fields.camera_bubble { "bubble" } else { "none" },
        },
        "privacy": {
            "keys": "shortcuts",
            "pageInputs": "masked",
        },
        "tracks": tracks
            .iter()
            .map(|track| {
                serde_json::json!({
                    "id": track.id,
                    "startMs": track.finish.start_ms,
                    "endMs": track.finish.end_ms,
                    "complete": track.finish.complete,
                    "meta": track.finish.meta,
                })
            })
            .collect::<Vec<_>>(),
    })
}

struct FinishContext {
    folder: PathBuf,
    target: Arc<TrackUploadTarget>,
    tracks_stopped: Arc<AtomicBool>,
    started_at: Option<String>,
    fields: ManifestFields,
}

/// Sends the rest of each track, one at a time and in order, finalizes the
/// ones that made it, then deletes the folder whatever happened.
async fn finish_tracks<Post, Posted>(
    mut finish: FinishContext,
    tracks: Vec<RunningTrack>,
    post: Post,
) where
    Post: FnOnce(Arc<TrackUploadTarget>, serde_json::Value) -> Posted,
    Posted: std::future::Future<Output = Result<(), String>>,
{
    let ctrls = tracks
        .iter()
        .map(|track| Arc::clone(&track.upload.ctrl))
        .collect();
    finalize_tracks(&mut finish, tracks, post).await;
    remove_once_closed(&finish.target.recording_id, finish.folder.clone(), ctrls);
}

async fn finalize_tracks<Post, Posted>(
    finish: &mut FinishContext,
    tracks: Vec<RunningTrack>,
    post: Post,
) where
    Post: FnOnce(Arc<TrackUploadTarget>, serde_json::Value) -> Posted,
    Posted: std::future::Future<Output = Result<(), String>>,
{
    let id = finish.target.recording_id.clone();
    let mut finished = Vec::new();
    for RunningTrack {
        id: track,
        source,
        upload: TrackUpload { ctrl, result_rx },
    } in tracks
    {
        ctrl.release();
        match await_track_upload(&ctrl, result_rx).await {
            TrackUploadOutcome::Sent { .. } => finished.push(FinishedTrack {
                id: track,
                finish: source.finish(finish.fields.duration_ms),
            }),
            TrackUploadOutcome::Empty => {
                eprintln!("[rich-tracks] {id}: the {track} track is empty; not listed");
            }
            other => eprintln!("[rich-tracks] {id}: the {track} track was not sent: {other:?}"),
        }
    }
    if finish.tracks_stopped.load(Ordering::SeqCst) {
        eprintln!(
            "[rich-tracks] {id}: the server stopped this recording's tracks; not finalizing them"
        );
        return;
    }
    if finished.is_empty() {
        eprintln!("[rich-tracks] {id}: no track to finalize");
        return;
    }
    let Some(started_at) = finish.started_at.take() else {
        eprintln!(
            "[rich-tracks] {id}: the recording never started its clock; not finalizing tracks"
        );
        return;
    };
    finish.fields.started_at = started_at;
    let body = tracks_finalize_body(&finish.fields, &finished);
    match post(Arc::clone(&finish.target), body).await {
        Ok(()) => eprintln!("[rich-tracks] {id}: tracks finalized"),
        Err(error) => eprintln!("[rich-tracks] {id}: tracks finalize failed: {error}"),
    }
}

/// A released track's upload outcome. Gives up on one that stores nothing for
/// `TRACK_UPLOAD_STALL`, however long a large one takes while it moves.
async fn await_track_upload(
    ctrl: &TrackUploadCtrl,
    mut result_rx: tokio::sync::oneshot::Receiver<TrackUploadOutcome>,
) -> TrackUploadOutcome {
    let mut sent = ctrl.sent_bytes();
    let mut moved_at = Instant::now();
    loop {
        match tokio::time::timeout(TRACK_UPLOAD_CHECK, &mut result_rx).await {
            Ok(Ok(outcome)) => return outcome,
            Ok(Err(_)) => {
                return TrackUploadOutcome::Failed("the uploader ended without an answer".into())
            }
            Err(_) if ctrl.sent_bytes() != sent => {
                sent = ctrl.sent_bytes();
                moved_at = Instant::now();
            }
            Err(_) if moved_at.elapsed() >= TRACK_UPLOAD_STALL => {
                ctrl.cancel();
                return TrackUploadOutcome::Failed("its upload stalled".into());
            }
            Err(_) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display() -> DisplayGeometry {
        DisplayGeometry {
            id: 69_733_382,
            x_pt: -1512.0,
            y_pt: 0.0,
            width_pt: 1512.0,
            height_pt: 982.0,
            width_px: 3024,
            height_px: 1964,
        }
    }

    #[test]
    fn the_clock_follows_the_pipeline_start_offset_and_pause() {
        let start = Arc::new(AtomicU64::new(f64::NAN.to_bits()));
        let offset = Arc::new(AtomicU64::new(0.0_f64.to_bits()));
        let clock = RecordingClock::new(Arc::clone(&start), Arc::clone(&offset), (125, 3));
        let secs = |s: f64| (s * 1e9) as u64;
        // No first frame yet.
        assert_eq!(clock.at_host_nanos(secs(100.0)), None);
        start.store(100.0_f64.to_bits(), Ordering::SeqCst);
        assert_eq!(clock.at_host_nanos(secs(101.5)), Some(1500.0));
        // Paused: nothing has a recording time.
        clock.pause_at(secs(102.0));
        assert_eq!(clock.at_host_nanos(secs(103.0)), None);
        // Resumed after 5 seconds: the pipeline's offset grows by them.
        offset.store(5.0_f64.to_bits(), Ordering::SeqCst);
        clock.resume_at(secs(107.0));
        let ms = clock.at_host_nanos(secs(108.0)).unwrap();
        assert!((ms - 3000.0).abs() < 1e-6, "{ms}");
    }

    #[test]
    fn regions_and_start_times_are_placed_on_the_global_clock_and_space() {
        let region = NativeCaptureRegion {
            x: 0.25,
            y: 0.5,
            width: 0.5,
            height: 0.25,
        };
        // Cropped to whole points as the flattened recording's stream is.
        assert_eq!(
            region_area_pt(&display(), &region),
            Ok(RectPt {
                x: -1134.0,
                y: 491.0,
                width: 756.0,
                height: 245.0
            })
        );
        let stop = chrono::DateTime::parse_from_rfc3339("2026-11-16T10:00:10.000Z")
            .unwrap()
            .with_timezone(&Utc);
        // Stopped 9.5 s of host time after the first frame.
        assert_eq!(
            started_at_from(stop, 109_500_000_000, 100.0).as_deref(),
            Some("2026-11-16T10:00:00.500Z")
        );
        assert_eq!(started_at_from(stop, 1, f64::NAN), None);
        assert_eq!(
            tracks_folder_for(Path::new("/clips/rec-123.mp4")),
            PathBuf::from("/clips/rec-123.tracks")
        );
    }

    #[test]
    fn the_finalize_body_carries_the_manifest_fields_and_tracks() {
        let fields = ManifestFields {
            started_at: "2026-11-16T10:00:00.500Z".into(),
            duration_ms: 61_250,
            app_version: "1.4.0".into(),
            os: "macOS 26.1.0".into(),
            pauses: vec![Pause {
                at_ms: 20_000,
                wall_ms: 4_200,
            }],
            capture: CaptureInfo {
                kind: CaptureKind::Region,
                display: Some(display()),
                area_pt: Some(RectPt {
                    x: -1134.0,
                    y: 491.0,
                    width: 756.0,
                    height: 245.0,
                }),
            },
            camera_bubble: false,
        };
        let body = tracks_finalize_body(
            &fields,
            &[
                FinishedTrack {
                    id: INPUT_TRACK_ID,
                    finish: TrackFinish {
                        complete: true,
                        start_ms: 0,
                        end_ms: 61_250,
                        meta: serde_json::json!({
                            "space": "screen-px",
                            "moveIntervalMs": 10,
                            "covers": "global",
                        }),
                    },
                },
                FinishedTrack {
                    id: SCREEN_TRACK_ID,
                    finish: TrackFinish {
                        complete: false,
                        start_ms: 140,
                        end_ms: 20_000,
                        meta: serde_json::json!({ "cursor": "hidden" }),
                    },
                },
            ],
        );
        assert_eq!(
            body,
            serde_json::json!({
                "status": "complete",
                "startedAt": "2026-11-16T10:00:00.500Z",
                "durationMs": 61_250,
                "writer": {
                    "surface": "desktop-macos",
                    "app": "Clips",
                    "version": "1.4.0",
                    "os": "macOS 26.1.0",
                },
                "clock": {
                    "host": "mach-host-time",
                    "pauses": [{ "atMs": 20_000, "wallMs": 4_200 }],
                },
                "capture": {
                    "kind": "region",
                    "displays": [{
                        "id": "69733382",
                        "widthPx": 3024,
                        "heightPx": 1964,
                        "scale": 2.0,
                        "boundsPt": { "x": -1512.0, "y": 0.0, "width": 1512.0, "height": 982.0 },
                    }],
                    "areaPt": { "x": -1134.0, "y": 491.0, "width": 756.0, "height": 245.0 },
                },
                "compat": { "offsetMs": 0, "cursor": "in-pixels", "camera": "none" },
                "privacy": { "keys": "shortcuts", "pageInputs": "masked" },
                "tracks": [{
                    "id": "input",
                    "startMs": 0,
                    "endMs": 61_250,
                    "complete": true,
                    "meta": { "space": "screen-px", "moveIntervalMs": 10, "covers": "global" },
                }, {
                    "id": "screen",
                    "startMs": 140,
                    "endMs": 20_000,
                    "complete": false,
                    "meta": { "cursor": "hidden" },
                }],
            })
        );
        // A window recording names no display and no area.
        let window = tracks_finalize_body(
            &ManifestFields {
                capture: CaptureInfo {
                    kind: CaptureKind::Window,
                    display: None,
                    area_pt: None,
                },
                camera_bubble: true,
                ..fields
            },
            &[],
        );
        assert_eq!(
            window["capture"],
            serde_json::json!({ "kind": "window", "displays": [] })
        );
        assert_eq!(window["compat"]["camera"], "bubble");
    }

    #[test]
    fn frames_get_the_recording_time_the_pipeline_gives_its_own() {
        let start = Arc::new(AtomicU64::new(f64::NAN.to_bits()));
        let offset = Arc::new(AtomicU64::new(0.0_f64.to_bits()));
        let clock = RecordingClock::new(Arc::clone(&start), Arc::clone(&offset), (1, 1));
        let secs = |s: f64| (s * 1e9) as u64;
        assert_eq!(clock.frame_time(99.0), FrameTime::BeforeStart);
        start.store(100.0_f64.to_bits(), Ordering::SeqCst);
        // Captured just before the first frame: before zero.
        assert_eq!(clock.frame_time(99.75), FrameTime::At(-0.25));
        assert_eq!(clock.frame_time(102.5), FrameTime::At(2.5));
        clock.pause_at(secs(103.0));
        assert_eq!(clock.frame_time(104.0), FrameTime::Paused);
        // Paused at 3 s for 6 s.
        offset.store(6.0_f64.to_bits(), Ordering::SeqCst);
        clock.resume_at(secs(109.0));
        assert_eq!(clock.frame_time(110.0), FrameTime::At(4.0));
    }

    /// A source that records what it is told and, unless `holds_file`,
    /// closes its file as soon as it is stopped.
    struct TestSource {
        ctrl: Arc<TrackUploadCtrl>,
        finish: TrackFinish,
        holds_file: bool,
        calls: Arc<Mutex<Vec<&'static str>>>,
    }

    impl TestSource {
        fn new(ctrl: &Arc<TrackUploadCtrl>) -> Self {
            Self {
                ctrl: Arc::clone(ctrl),
                finish: TrackFinish {
                    complete: true,
                    start_ms: 140,
                    end_ms: 9_000,
                    meta: serde_json::json!({ "cursor": "hidden" }),
                },
                holds_file: false,
                calls: Arc::default(),
            }
        }

        fn calls(&self) -> Arc<Mutex<Vec<&'static str>>> {
            Arc::clone(&self.calls)
        }
    }

    impl TrackSource for TestSource {
        fn stop(&self) {
            self.calls.lock().unwrap().push("stop");
            if !self.holds_file {
                self.ctrl.close_source();
            }
        }

        fn pause(&self) {
            self.calls.lock().unwrap().push("pause");
        }

        fn resume(&self) {
            self.calls.lock().unwrap().push("resume");
        }

        fn finish(&self, _duration_ms: u64) -> TrackFinish {
            self.finish.clone()
        }
    }

    struct Fixture {
        folder: PathBuf,
        target: Arc<TrackUploadTarget>,
        tracks_stopped: Arc<AtomicBool>,
        gate: Arc<TrackSendGate>,
        clock: RecordingClock,
    }

    impl Fixture {
        fn new(name: &str) -> Self {
            let folder = std::env::temp_dir().join(format!(
                "clips-rich-tracks-test-{}-{name}.tracks",
                std::process::id()
            ));
            let _ = std::fs::remove_dir_all(&folder);
            std::fs::create_dir_all(&folder).unwrap();
            std::fs::write(folder.join(SCREEN_TRACK_FILE), b"fragments").unwrap();
            Self {
                folder,
                target: Arc::new(TrackUploadTarget {
                    server_url: "http://127.0.0.1:9".into(),
                    recording_id: format!("rec-{name}"),
                    auth_token: String::new(),
                    cookie: String::new(),
                }),
                tracks_stopped: Arc::new(AtomicBool::new(false)),
                gate: Arc::new(TrackSendGate::new(|| Some(0))),
                clock: RecordingClock::new(
                    Arc::new(AtomicU64::new(100.0_f64.to_bits())),
                    Arc::new(AtomicU64::new(0.0_f64.to_bits())),
                    (1, 1),
                ),
            }
        }

        fn ctrl(&self) -> Arc<TrackUploadCtrl> {
            Arc::new(TrackUploadCtrl::new(
                Arc::clone(&self.tracks_stopped),
                Arc::clone(&self.gate),
            ))
        }

        /// A track whose upload ends with `outcome` once it is asked.
        fn track(&self, id: &'static str, outcome: TrackUploadOutcome) -> RunningTrack {
            self.track_with(id, outcome, TestSource::new(&self.ctrl()))
        }

        fn track_with(
            &self,
            id: &'static str,
            outcome: TrackUploadOutcome,
            source: TestSource,
        ) -> RunningTrack {
            let ctrl = Arc::clone(&source.ctrl);
            let (tx, result_rx) = tokio::sync::oneshot::channel();
            tx.send(outcome).unwrap();
            RunningTrack {
                id,
                source: Arc::new(source),
                upload: TrackUpload { ctrl, result_rx },
            }
        }

        fn recording(&self) -> RichRecording {
            RichRecording {
                folder: self.folder.clone(),
                target: Arc::clone(&self.target),
                tracks_stopped: Arc::clone(&self.tracks_stopped),
                gate: Arc::clone(&self.gate),
                clock: self.clock.clone(),
                capture: CaptureInfo {
                    kind: CaptureKind::Display,
                    display: Some(display()),
                    area_pt: None,
                },
                camera_bubble: false,
                app_version: "1.4.0".into(),
                pauses: Vec::new(),
                stopped_at: None,
                tracks: vec![self.track(SCREEN_TRACK_ID, TrackUploadOutcome::Cancelled)],
            }
        }

        fn finish_context(&self) -> FinishContext {
            FinishContext {
                folder: self.folder.clone(),
                target: Arc::clone(&self.target),
                tracks_stopped: Arc::clone(&self.tracks_stopped),
                started_at: Some("2026-11-16T10:00:00.500Z".into()),
                fields: ManifestFields {
                    started_at: String::new(),
                    duration_ms: 9_500,
                    app_version: "1.4.0".into(),
                    os: "macOS 26.1.0".into(),
                    pauses: Vec::new(),
                    capture: CaptureInfo {
                        kind: CaptureKind::Display,
                        display: Some(display()),
                        area_pt: None,
                    },
                    camera_bubble: false,
                },
            }
        }

        /// Runs the end of a recording, its finalize answering `answer`, and
        /// returns the body it was sent, if any.
        fn finish(
            &self,
            tracks: Vec<RunningTrack>,
            answer: Result<(), String>,
        ) -> Option<serde_json::Value> {
            let sent = Arc::new(Mutex::new(None));
            let seen = Arc::clone(&sent);
            for track in &tracks {
                track.upload.ctrl.close_source();
            }
            tokio::runtime::Builder::new_current_thread()
                .enable_time()
                .build()
                .unwrap()
                .block_on(finish_tracks(
                    self.finish_context(),
                    tracks,
                    move |_, body| async move {
                        *seen.lock().unwrap() = Some(body);
                        answer
                    },
                ));
            let body = sent.lock().unwrap().take();
            body
        }
    }

    #[test]
    fn tracks_that_will_not_be_finalized_leave_no_folder() {
        let abandoned = Fixture::new("abandon");
        abandoned.recording().abandon("the recording restarted");
        assert!(!abandoned.folder.exists());

        let discarded = Fixture::new("discard");
        discarded.recording().discard();
        assert!(!discarded.folder.exists());

        // Dropped without `finish`.
        let dropped = Fixture::new("drop");
        let recording = dropped.recording();
        let ctrl = Arc::clone(&recording.tracks[0].upload.ctrl);
        drop(recording);
        assert!(!dropped.folder.exists());
        assert!(ctrl.source_closed());

        // The server said to stop sending tracks: nothing is finalized.
        let stopped = Fixture::new("stopped");
        stopped.tracks_stopped.store(true, Ordering::SeqCst);
        let track = stopped.track(
            SCREEN_TRACK_ID,
            TrackUploadOutcome::Stopped("tracksStopped".into()),
        );
        assert_eq!(stopped.finish(vec![track], Ok(())), None);
        assert!(!stopped.folder.exists());
    }

    #[test]
    fn the_folder_goes_once_finalize_is_done_or_has_failed_for_good() {
        let failed = Fixture::new("finalize-failed");
        let tracks = vec![
            failed.track(INPUT_TRACK_ID, TrackUploadOutcome::Empty),
            failed.track(
                SCREEN_TRACK_ID,
                TrackUploadOutcome::Sent {
                    bytes: 9,
                    chunks: 1,
                },
            ),
        ];
        let body = failed.finish(tracks, Err("finalize failed after 6 attempts".into()));
        assert!(!failed.folder.exists());
        // The empty input track isn't listed; the screen track is, with its own
        // start and end.
        assert_eq!(
            body.unwrap()["tracks"],
            serde_json::json!([{
                "id": "screen",
                "startMs": 140,
                "endMs": 9_000,
                "complete": true,
                "meta": { "cursor": "hidden" },
            }])
        );

        let done = Fixture::new("finalized");
        let track = done.track(
            SCREEN_TRACK_ID,
            TrackUploadOutcome::Sent {
                bytes: 9,
                chunks: 1,
            },
        );
        assert!(done.finish(vec![track], Ok(())).is_some());
        assert!(!done.folder.exists());

        // A track that failed to send isn't listed, and the folder still goes.
        let unsent = Fixture::new("unsent");
        let track = unsent.track(
            SCREEN_TRACK_ID,
            TrackUploadOutcome::Failed("offline".into()),
        );
        assert_eq!(unsent.finish(vec![track], Ok(())), None);
        assert!(!unsent.folder.exists());
    }

    #[test]
    fn nothing_captured_after_stop_has_a_recording_time() {
        let start = Arc::new(AtomicU64::new(100.0_f64.to_bits()));
        let offset = Arc::new(AtomicU64::new(0.0_f64.to_bits()));
        let clock = RecordingClock::new(start, offset, (1, 1));
        let secs = |s: f64| (s * 1e9) as u64;
        clock.stop_at(secs(105.0));
        // An event from before Stop whose callback runs late is still kept.
        assert_eq!(clock.at_event_stamp(secs(104.5)), Some(4500.0));
        assert_eq!(clock.at_event_stamp(secs(105.0) + 1), None);
        assert_eq!(clock.frame_time(104.0), FrameTime::At(4.0));
        assert_eq!(clock.frame_time(105.25), FrameTime::AfterStop);
        // The boundary only ever moves earlier.
        clock.stop_at(secs(110.0));
        assert_eq!(clock.at_event_stamp(secs(106.0)), None);

        // `stop_capture` freezes it at the moment it records for the stop.
        let fixture = Fixture::new("stop-boundary");
        let mut recording = fixture.recording();
        recording.clock = RecordingClock::new(
            Arc::new(AtomicU64::new(0.0_f64.to_bits())),
            Arc::new(AtomicU64::new(0.0_f64.to_bits())),
            (1, 1),
        );
        recording.stop_capture();
        let (_, stopped) = recording.stopped_at.unwrap();
        assert!(recording
            .clock
            .at_event_stamp(stopped - 1_000_000)
            .is_some());
        assert_eq!(recording.clock.at_event_stamp(stopped + 1), None);
        recording.discard();
    }

    #[test]
    fn nothing_captured_inside_a_pause_has_a_recording_time_however_late_it_arrives() {
        let start = Arc::new(AtomicU64::new(100.0_f64.to_bits()));
        let offset = Arc::new(AtomicU64::new(0.0_f64.to_bits()));
        let clock = RecordingClock::new(start, Arc::clone(&offset), (1, 1));
        let secs = |s: f64| (s * 1e9) as u64;
        // Paused 3 s in for 5 s; the pipeline's offset grows by them.
        assert_eq!(clock.pause_at(secs(103.0)), 3000.0);
        offset.store(5.0_f64.to_bits(), Ordering::SeqCst);
        assert_eq!(clock.resume_at(secs(108.0)), Some(3000.0));
        // An event and a frame captured during the pause whose callbacks run
        // only after the resume, when the new offset would place them at 0 s
        // and 2.9 s.
        assert_eq!(clock.at_event_stamp(secs(105.0)), None);
        assert_eq!(clock.frame_time(107.9), FrameTime::Paused);
        // What came after the resume follows on from 3 s.
        assert_eq!(clock.at_event_stamp(secs(108.5)), Some(3500.0));
        assert_eq!(clock.frame_time(109.0), FrameTime::At(4.0));
        // A second pause keeps the first one's stretch too.
        assert_eq!(clock.pause_at(secs(110.0)), 5000.0);
        offset.store(7.0_f64.to_bits(), Ordering::SeqCst);
        clock.resume_at(secs(112.0));
        assert_eq!(clock.at_event_stamp(secs(106.0)), None);
        assert_eq!(clock.at_event_stamp(secs(111.0)), None);
        assert_eq!(clock.at_event_stamp(secs(113.0)), Some(6000.0));
    }

    #[test]
    fn what_the_resumed_stream_sends_before_the_pause_ends_here_keeps_its_time() {
        let start = Arc::new(AtomicU64::new(100.0_f64.to_bits()));
        let offset = Arc::new(AtomicU64::new(0.0_f64.to_bits()));
        let clock = RecordingClock::new(start, Arc::clone(&offset), (1, 1));
        let secs = |s: f64| (s * 1e9) as u64;
        assert_eq!(clock.pause_at(secs(103.0)), 3000.0);
        assert_eq!(clock.stream_frame_time(105.0), FrameTime::Paused);
        // The pipeline applies the resume's 5 s and starts its new stream
        // before the session ends the pause here at 108.5 s.
        offset.store(5.0_f64.to_bits(), Ordering::SeqCst);
        assert_eq!(clock.stream_frame_time(107.5), FrameTime::Paused);
        assert_eq!(clock.stream_frame_time(108.25), FrameTime::At(3.25));
        // The camera and input run through the pause, so they wait for the
        // session, in case the new stream fails to start.
        assert_eq!(clock.frame_time(108.25), FrameTime::Paused);
        assert_eq!(clock.at_host_nanos(secs(108.25)), None);
        assert_eq!(clock.paused_position_ms(), Some(3000.0));
        assert_eq!(clock.resume_at(secs(108.5)), Some(3000.0));
        // However late their callbacks run, the new stream's first buffers
        // keep their times, and what came from inside the pause has none.
        assert_eq!(clock.stream_frame_time(108.25), FrameTime::At(3.25));
        assert_eq!(clock.frame_time(108.25), FrameTime::At(3.25));
        assert_eq!(clock.at_host_nanos(secs(108.25)), Some(3250.0));
        assert_eq!(clock.at_host_nanos(secs(107.5)), None);
    }

    #[test]
    fn a_resume_whose_stream_fails_to_start_leaves_the_recording_paused() {
        let start = Arc::new(AtomicU64::new(100.0_f64.to_bits()));
        let offset = Arc::new(AtomicU64::new(0.0_f64.to_bits()));
        let clock = RecordingClock::new(start, Arc::clone(&offset), (1, 1));
        let secs = |s: f64| (s * 1e9) as u64;
        assert_eq!(clock.pause_at(secs(103.0)), 3000.0);
        // The pipeline applies 5 s, its new stream fails to start, and it puts
        // the offset back while the camera and input go on.
        offset.store(5.0_f64.to_bits(), Ordering::SeqCst);
        assert_eq!(clock.frame_time(108.25), FrameTime::Paused);
        assert_eq!(clock.at_host_nanos(secs(108.25)), None);
        offset.store(0.0_f64.to_bits(), Ordering::SeqCst);
        assert_eq!(clock.stream_frame_time(108.25), FrameTime::Paused);
        assert_eq!(clock.frame_time(108.25), FrameTime::Paused);
        // A later resume that works goes on from where the pause began.
        offset.store(10.0_f64.to_bits(), Ordering::SeqCst);
        assert_eq!(clock.resume_at(secs(113.5)), Some(3000.0));
        assert_eq!(clock.frame_time(108.25), FrameTime::Paused);
        assert_eq!(clock.frame_time(113.25), FrameTime::At(3.25));
        assert_eq!(clock.at_host_nanos(secs(113.25)), Some(3250.0));
    }

    #[test]
    fn stopped_while_paused_the_recording_is_where_the_pause_began() {
        let start = Arc::new(AtomicU64::new(100.0_f64.to_bits()));
        let offset = Arc::new(AtomicU64::new(0.0_f64.to_bits()));
        let clock = RecordingClock::new(start, Arc::clone(&offset), (1, 1));
        let secs = |s: f64| (s * 1e9) as u64;
        // Paused 20 s in: no time is now, but the recording is at 20 s for
        // as long as the pause lasts, and a second pause call keeps it there.
        assert_eq!(clock.pause_at(secs(120.0)), 20_000.0);
        assert_eq!(clock.pause_at(secs(125.0)), 20_000.0);
        assert_eq!(clock.now_ms(), None);
        assert_eq!(clock.position_ms(), Some(20_000.0));
        offset.store(10.0_f64.to_bits(), Ordering::SeqCst);
        assert_eq!(clock.resume_at(secs(130.0)), Some(20_000.0));
        assert_eq!(clock.paused_position_ms(), None);
        assert_eq!(clock.resume_at(secs(131.0)), None);

        // The session's pause and resume go through the clock the tracks
        // read, and the manifest's pause comes from the position it held.
        let fixture = Fixture::new("paused-position");
        let mut recording = fixture.recording();
        recording.pause();
        let held = recording.clock.paused_position_ms().unwrap();
        assert_eq!(recording.clock.position_ms(), Some(held));
        recording.resume(Duration::from_millis(4_200));
        assert_eq!(
            recording.pauses,
            [Pause {
                at_ms: (held.round() as u64).min(MAX_RECORDING_MS),
                wall_ms: 4_200,
            }]
        );
        recording.discard();
    }

    #[test]
    fn a_soft_pause_pauses_the_tracks_even_when_the_rest_of_it_fails() {
        let mut session = super::super::detached_discard_tests::hardware_free_session(
            PathBuf::from("paused.mp4"),
            Vec::new(),
        );
        let fixture = Fixture::new("pause-fails");
        let ctrl = fixture.ctrl();
        let source = TestSource::new(&ctrl);
        let calls = source.calls();
        let mut recording = fixture.recording();
        recording.tracks =
            vec![fixture.track_with(SCREEN_TRACK_ID, TrackUploadOutcome::Cancelled, source)];
        session.rich_recording = Some(recording);
        let result = super::super::finish_soft_pause(&mut session, || {
            Err("the camera bubble could not be hidden".into())
        });
        assert!(result.is_err());
        assert!(session.pause_failure.is_some());
        assert!(session.rich_recording.as_ref().unwrap().is_paused());
        assert_eq!(*calls.lock().unwrap(), ["pause"]);

        let mut session = super::super::detached_discard_tests::hardware_free_session(
            PathBuf::from("paused.mp4"),
            Vec::new(),
        );
        session.rich_recording = Some(Fixture::new("pause-ok").recording());
        assert!(super::super::finish_soft_pause(&mut session, || Ok(())).is_ok());
        assert!(session.paused_at.is_some());
        assert!(session.rich_recording.as_ref().unwrap().is_paused());
    }

    /// Two running sources, input then screen, each with its file written.
    fn two_track_teardown(
        fixture: &Fixture,
    ) -> (TrackTeardown, [Arc<Mutex<Vec<&'static str>>>; 2]) {
        std::fs::write(fixture.folder.join(INPUT_TRACK_FILE), b"lines").unwrap();
        let input = TestSource::new(&fixture.ctrl());
        let screen = TestSource::new(&fixture.ctrl());
        let calls = [input.calls(), screen.calls()];
        let track = |file: &str, source: TestSource| TeardownTrack {
            file: fixture.folder.join(file),
            ctrl: Arc::clone(&source.ctrl),
            source: Arc::new(source),
        };
        let teardown = TrackTeardown {
            recording_id: fixture.target.recording_id.clone(),
            folder: fixture.folder.clone(),
            tracks: vec![
                track(INPUT_TRACK_FILE, input),
                track(SCREEN_TRACK_FILE, screen),
            ],
        };
        (teardown, calls)
    }

    #[test]
    fn an_upload_that_ends_for_good_stops_capture_and_clears_its_files() {
        // The server stops the recording's tracks: both sources stop and the
        // folder goes while the recording carries on.
        let stopped = Fixture::new("teardown-stopped");
        let (teardown, [input, screen]) = two_track_teardown(&stopped);
        teardown.upload_ended(1, &TrackUploadOutcome::Stopped("413".into()));
        assert_eq!(*input.lock().unwrap(), ["stop"]);
        assert_eq!(*screen.lock().unwrap(), ["stop"]);
        assert!(!stopped.folder.exists());

        // One upload fails for good: its source stops and its file goes; the
        // other track keeps capturing into the folder.
        let failed = Fixture::new("teardown-failed");
        let (teardown, [input, screen]) = two_track_teardown(&failed);
        teardown.upload_ended(1, &TrackUploadOutcome::Failed("offline".into()));
        assert!(input.lock().unwrap().is_empty());
        assert_eq!(*screen.lock().unwrap(), ["stop"]);
        assert!(!failed.folder.join(SCREEN_TRACK_FILE).exists());
        assert!(failed.folder.join(INPUT_TRACK_FILE).exists());

        // Outcomes that leave nothing to clear touch nothing.
        for outcome in [
            TrackUploadOutcome::Sent {
                bytes: 9,
                chunks: 1,
            },
            TrackUploadOutcome::Empty,
            TrackUploadOutcome::Cancelled,
        ] {
            teardown.upload_ended(0, &outcome);
        }
        assert!(input.lock().unwrap().is_empty());
        assert!(failed.folder.join(INPUT_TRACK_FILE).exists());
        let _ = std::fs::remove_dir_all(&failed.folder);
    }

    #[test]
    fn quitting_deletes_the_folder_without_waiting_for_files_to_close() {
        let fixture = Fixture::new("quit");
        let mut source = TestSource::new(&fixture.ctrl());
        source.holds_file = true;
        let calls = source.calls();
        let ctrl = Arc::clone(&source.ctrl);
        let mut recording = fixture.recording();
        recording.tracks =
            vec![fixture.track_with(SCREEN_TRACK_ID, TrackUploadOutcome::Cancelled, source)];
        recording.quit();
        assert!(!fixture.folder.exists());
        assert_eq!(*calls.lock().unwrap(), ["stop"]);
        assert!(!ctrl.source_closed());
    }

    #[test]
    fn a_tracks_folder_is_listed_until_it_goes_and_quitting_deletes_the_rest() {
        // Removing a folder by any path takes it off the list.
        let discarded = Fixture::new("in-use-discard");
        FOLDERS_IN_USE.add(&discarded.folder, &discarded.target.recording_id);
        assert!(FOLDERS_IN_USE.contains(&discarded.folder));
        discarded.recording().discard();
        assert!(!discarded.folder.exists());
        assert!(!FOLDERS_IN_USE.contains(&discarded.folder));

        // Finished in the background after Stop: listed until finalizing is
        // over and the folder has gone.
        let finished = Fixture::new("in-use-finished");
        FOLDERS_IN_USE.add(&finished.folder, &finished.target.recording_id);
        let track = finished.track(
            SCREEN_TRACK_ID,
            TrackUploadOutcome::Sent {
                bytes: 9,
                chunks: 1,
            },
        );
        assert!(finished.finish(vec![track], Ok(())).is_some());
        assert!(!finished.folder.exists());
        assert!(!FOLDERS_IN_USE.contains(&finished.folder));

        // Quitting while stopped recordings' tracks still wait or send:
        // every listed folder goes at once, files still open or not.
        let in_use = FoldersInUse::new();
        let sending = Fixture::new("in-use-sending");
        let waiting = Fixture::new("in-use-waiting");
        in_use.add(&sending.folder, &sending.target.recording_id);
        in_use.add(&waiting.folder, &waiting.target.recording_id);
        in_use.remove_all();
        assert!(!sending.folder.exists());
        assert!(!waiting.folder.exists());
        assert!(!in_use.contains(&sending.folder));
        assert!(!in_use.contains(&waiting.folder));
    }

    #[test]
    fn a_track_whose_file_cannot_be_written_ends_alone_and_its_file_goes() {
        let fixture = Fixture::new("write-failed");
        std::fs::write(fixture.folder.join(INPUT_TRACK_FILE), b"lines").unwrap();
        // Chunks are held back, so nothing here reaches the network.
        fixture.gate.stop_recording();
        let (input_ctrl, screen_ctrl) = (fixture.ctrl(), fixture.ctrl());
        let input = TestSource::new(&input_ctrl);
        let screen = TestSource::new(&screen_ctrl);
        let calls = [input.calls(), screen.calls()];
        let started = |id, file: &str, source: TestSource| StartedSource {
            id,
            file: fixture.folder.join(file),
            content_type: "application/octet-stream",
            ctrl: Arc::clone(&source.ctrl),
            source: Arc::new(source),
        };
        let mut tracks = spawn_uploaders(
            &fixture.target,
            &fixture.folder,
            vec![
                started(INPUT_TRACK_ID, INPUT_TRACK_FILE, input),
                started(SCREEN_TRACK_ID, SCREEN_TRACK_FILE, screen),
            ],
        );
        // The input writer fails to write, says so, and closes its file.
        input_ctrl.fail_source("its file could not be written".into());
        input_ctrl.close_source();
        let result_rx = tracks.remove(0).upload.result_rx;
        let outcome = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(async { tokio::time::timeout(Duration::from_secs(10), result_rx).await });
        assert!(
            matches!(outcome, Ok(Ok(TrackUploadOutcome::Failed(_)))),
            "{outcome:?}"
        );
        // Its source is stopped and its file gone; the screen track goes on.
        assert_eq!(*calls[0].lock().unwrap(), ["stop"]);
        assert!(!fixture.folder.join(INPUT_TRACK_FILE).exists());
        assert!(calls[1].lock().unwrap().is_empty());
        assert!(fixture.folder.join(SCREEN_TRACK_FILE).exists());
        screen_ctrl.cancel();
        let _ = std::fs::remove_dir_all(&fixture.folder);
    }

    #[test]
    fn startup_deletes_only_tracks_folders_earlier_runs_of_the_app_made() {
        let dir = std::env::temp_dir().join(format!(
            "clips-rich-tracks-sweep-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let outside = dir.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("keep"), b"x").unwrap();
        let this_run = 4242;

        // What a recording of another run made, with its files inside.
        let recording = dir.join(format!(
            "{}.mp4",
            pending_recording_file_stem("rec_1-a", 77)
        ));
        let leftover = tracks_folder_for(&recording);
        std::fs::create_dir_all(&leftover).unwrap();
        std::fs::write(leftover.join(SCREEN_TRACK_FILE), b"fragments").unwrap();
        std::fs::write(&recording, b"video").unwrap();

        let kept_dirs = [
            // This run's own recording.
            format!("{}.tracks", pending_recording_file_stem("rec", this_run)),
            "clips-pending-recording--77.tracks".to_string(),
            "clips-pending-recording-rec-7x.tracks".to_string(),
            "clips-pending-recording-rec-77-seg2.tracks".to_string(),
            "clips-pending-recording-rec.77.tracks".to_string(),
            "other-recording-77.tracks".to_string(),
            "clips-pending-recording-rec-77.track".to_string(),
        ];
        for name in &kept_dirs {
            std::fs::create_dir_all(dir.join(name)).unwrap();
        }
        // A file with the name, and a symlink to a folder elsewhere.
        std::fs::write(dir.join("clips-pending-recording-rec-78.tracks"), b"x").unwrap();
        std::os::unix::fs::symlink(&outside, dir.join("clips-pending-recording-rec-79.tracks"))
            .unwrap();

        assert_eq!(remove_leftover_tracks_folders(&dir, this_run), 1);
        assert!(!leftover.exists());
        assert!(recording.exists());
        for name in &kept_dirs {
            assert!(dir.join(name).is_dir(), "{name}");
        }
        assert!(dir.join("clips-pending-recording-rec-78.tracks").is_file());
        assert!(outside.join("keep").exists());
        // A folder that isn't there yet is nothing to do.
        assert_eq!(
            remove_leftover_tracks_folders(&dir.join("missing"), this_run),
            0
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_source_that_fails_to_start_leaves_no_file_and_no_tracks_leave_no_folder() {
        let starter = |id: &'static str, file: &'static str, fails: bool| TrackStart {
            id,
            file,
            content_type: "application/octet-stream",
            start: Box::new(move |path, ctrl| {
                // Each writes its file before it can fail, as the screen
                // writer does.
                std::fs::write(path, b"partial").map_err(|err| err.to_string())?;
                if fails {
                    return Err("its setup failed".to_string());
                }
                let source: Arc<dyn TrackSource> = Arc::new(TestSource::new(&ctrl));
                Ok(source)
            }),
        };

        let one_fails = Fixture::new("setup-one-fails");
        let started = start_sources(
            "rec-setup",
            &one_fails.folder,
            vec![
                starter(INPUT_TRACK_ID, INPUT_TRACK_FILE, false),
                starter(SCREEN_TRACK_ID, SCREEN_TRACK_FILE, true),
            ],
            || one_fails.ctrl(),
        );
        assert_eq!(
            started.iter().map(|track| track.id).collect::<Vec<_>>(),
            [INPUT_TRACK_ID]
        );
        assert!(one_fails.folder.join(INPUT_TRACK_FILE).exists());
        assert!(!one_fails.folder.join(SCREEN_TRACK_FILE).exists());
        let _ = std::fs::remove_dir_all(&one_fails.folder);

        let none_start = Fixture::new("setup-none-start");
        let started = start_sources(
            "rec-setup",
            &none_start.folder,
            vec![
                starter(INPUT_TRACK_ID, INPUT_TRACK_FILE, true),
                starter(SCREEN_TRACK_ID, SCREEN_TRACK_FILE, true),
            ],
            || none_start.ctrl(),
        );
        assert!(started.is_empty());
        assert!(!none_start.folder.exists());
    }
}
