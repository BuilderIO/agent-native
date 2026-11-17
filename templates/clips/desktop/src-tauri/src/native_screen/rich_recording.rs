//! Clips' rich recordings on the desktop, behind the Rich recordings lab:
//! separate track files kept beside the flattened recording. Each track writes
//! append-only into `<stem>.tracks/` next to the recording's local file, and
//! its uploader sends the file as it grows. Once the recording's own upload is
//! finalized, the tracks are finalized with what Clips needs to line them up
//! with the video, and the folder is deleted; it stays when anything fails.
//! A track never delays or fails the recording.
//!
//! Tracks are kept only for recordings on the custom capture pipeline with live
//! upload. Track times are that pipeline's: milliseconds from the flattened
//! recording's first frame on the host clock ScreenCaptureKit stamps frames
//! with, with paused stretches taken out the way the pipeline retimes frames.
//!
//! A new kind of track is a `TrackSource` started in `attach_rich_recording`:
//! it writes one file in the folder and calls `TrackUploadCtrl::close_source`
//! once that file is complete.

use super::*;

use super::input_track::{
    event_host_nanos, input_capture_allowed, recording_ms, start_input_capture, DisplayGeometry,
    InputCapture, INPUT_TRACK_CONTENT_TYPE, INPUT_TRACK_FILE, INPUT_TRACK_ID, MOVE_INTERVAL_MS,
};
use super::track_upload::{
    post_tracks_finalize, spawn_track_uploader, TrackUpload, TrackUploadCtrl, TrackUploadOutcome,
    TrackUploadTarget,
};

/// How long the end of a recording waits for a track's last chunks.
const TRACK_UPLOAD_DEADLINE: Duration = Duration::from_secs(10 * 60);
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

fn host_ticks() -> u64 {
    // SAFETY: takes no arguments and only reads the clock.
    unsafe { mach_absolute_time() }
}

fn host_timebase() -> (u32, u32) {
    let mut info = MachTimebaseInfo { numer: 0, denom: 0 };
    // SAFETY: writes the two fields of the struct it is given.
    let status = unsafe { mach_timebase_info(&mut info) };
    if status != 0 || info.numer == 0 || info.denom == 0 {
        (1, 1)
    } else {
        (info.numer, info.denom)
    }
}

/// Recording time, read from the capture pipeline's own clock state: the
/// first frame's host time and the pause offset it subtracts from frames.
#[derive(Clone)]
pub(super) struct RecordingClock {
    session_start_bits: Arc<AtomicU64>,
    pause_offset_bits: Arc<AtomicU64>,
    paused: Arc<AtomicBool>,
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
            paused: Arc::new(AtomicBool::new(false)),
            timebase,
        }
    }

    fn session_start_secs(&self) -> f64 {
        f64::from_bits(self.session_start_bits.load(Ordering::SeqCst))
    }

    /// Recording milliseconds of a host time; `None` before the first frame
    /// and while paused.
    pub(super) fn at_host_nanos(&self, nanos: u64) -> Option<f64> {
        if self.paused.load(Ordering::SeqCst) {
            return None;
        }
        recording_ms(
            nanos,
            self.session_start_secs(),
            f64::from_bits(self.pause_offset_bits.load(Ordering::SeqCst)),
        )
    }

    /// Recording milliseconds of an event's `CGEventGetTimestamp`.
    pub(super) fn at_event_stamp(&self, stamp: u64) -> Option<f64> {
        let (numer, denom) = self.timebase;
        self.at_host_nanos(event_host_nanos(stamp, host_ticks(), numer, denom))
    }

    pub(super) fn now_ms(&self) -> Option<f64> {
        self.at_host_nanos(self.host_now_nanos())
    }

    fn host_now_nanos(&self) -> u64 {
        let (numer, denom) = self.timebase;
        (u128::from(host_ticks()) * u128::from(numer) / u128::from(denom.max(1))) as u64
    }
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

/// A capture region (fractions of the display) in global points.
pub(super) fn region_area_pt(display: &DisplayGeometry, region: &NativeCaptureRegion) -> RectPt {
    RectPt {
        x: display.x_pt + region.x * display.width_pt,
        y: display.y_pt + region.y * display.height_pt,
        width: region.width * display.width_pt,
        height: region.height * display.height_pt,
    }
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
        .map(|region| region_area_pt(&geometry, &region));
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
pub(super) struct TrackFinish {
    pub(super) complete: bool,
    pub(super) meta: serde_json::Value,
}

/// Something writing one track file of a rich recording.
pub(super) trait TrackSource: Send {
    /// Stops capturing. The source then closes its file on its own and tells
    /// its uploader with `TrackUploadCtrl::close_source`. Never blocks.
    fn stop(&mut self);
    /// Read after the uploader has sent the whole file.
    fn finish(&self) -> TrackFinish;
}

impl TrackSource for InputCapture {
    fn stop(&mut self) {
        InputCapture::stop(self);
    }

    fn finish(&self) -> TrackFinish {
        let report = self.report();
        TrackFinish {
            complete: report.closed && !report.gaps && !report.write_failed,
            meta: serde_json::json!({
                "space": "screen-px",
                "moveIntervalMs": MOVE_INTERVAL_MS as u64,
                "covers": "global",
            }),
        }
    }
}

struct RunningTrack {
    id: &'static str,
    source: Box<dyn TrackSource>,
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
    clock: RecordingClock,
    capture: CaptureInfo,
    camera_bubble: bool,
    app_version: String,
    pauses: Vec<Pause>,
    paused_at_ms: Option<f64>,
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
) {
    let skip = |reason: &str| {
        eprintln!("[rich-tracks] {recording_id}: no tracks for this recording: {reason}");
    };
    if session.rich_recording.is_some() {
        return;
    }
    let clock_bits = match session.backend.as_ref() {
        Some(NativeFullscreenBackend::CustomScreenCaptureKit { writer, .. }) => {
            writer.recording_clock_bits()
        }
        _ => return skip("it is not on the custom capture pipeline"),
    };
    if session.live_upload.is_none() {
        return skip("it has no live upload");
    }
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

    let folder = tracks_folder_for(&session.path);
    if let Err(error) = std::fs::create_dir_all(&folder) {
        return skip(&format!("{} could not be made: {error}", folder.display()));
    }
    let target = Arc::new(TrackUploadTarget {
        server_url: server_url.to_string(),
        recording_id: recording_id.to_string(),
        auth_token: auth_token.to_string(),
        cookie: cookie.to_string(),
    });
    let tracks_stopped = Arc::new(AtomicBool::new(false));
    let (session_start_bits, pause_offset_bits) = clock_bits;
    let clock = RecordingClock::new(session_start_bits, pause_offset_bits, host_timebase());

    let mut tracks = Vec::new();
    if let Some(track) = start_input_track(&folder, &clock, &capture, &target, &tracks_stopped) {
        tracks.push(track);
    }
    if tracks.is_empty() {
        let _ = std::fs::remove_dir(&folder);
        return skip("no track could start");
    }
    eprintln!(
        "[rich-tracks] {recording_id}: keeping {} in {}",
        tracks
            .iter()
            .map(|track| track.id)
            .collect::<Vec<_>>()
            .join(", "),
        folder.display()
    );
    session.rich_recording = Some(RichRecording {
        folder,
        target,
        tracks_stopped,
        clock,
        capture,
        camera_bubble: has_camera && session.restart.include_camera_overlay,
        app_version: app.package_info().version.to_string(),
        pauses: Vec::new(),
        paused_at_ms: None,
        stopped_at: None,
        tracks,
    });
}

fn start_input_track(
    folder: &Path,
    clock: &RecordingClock,
    capture: &CaptureInfo,
    target: &Arc<TrackUploadTarget>,
    tracks_stopped: &Arc<AtomicBool>,
) -> Option<RunningTrack> {
    let id = &target.recording_id;
    let Some(display) = capture.display else {
        eprintln!("[rich-tracks] {id}: no input track: a window recording has no captured display to place input on");
        return None;
    };
    if !input_capture_allowed() {
        eprintln!("[rich-tracks] {id}: no input track: Clips has neither Input Monitoring nor Accessibility access");
        return None;
    }
    let ctrl = Arc::new(TrackUploadCtrl::new(Arc::clone(tracks_stopped)));
    let source = match start_input_capture(folder, clock.clone(), display, Arc::clone(&ctrl)) {
        Ok(source) => source,
        Err(error) => {
            eprintln!("[rich-tracks] {id}: no input track: {error}");
            return None;
        }
    };
    let upload = spawn_track_uploader(
        Arc::clone(target),
        INPUT_TRACK_ID,
        INPUT_TRACK_CONTENT_TYPE,
        folder.join(INPUT_TRACK_FILE),
        ctrl,
    );
    Some(RunningTrack {
        id: INPUT_TRACK_ID,
        source: Box::new(source),
        upload,
    })
}

impl RichRecording {
    /// The capture pipeline just paused: its frames stop until `resume`.
    pub(super) fn pause(&mut self) {
        if self.paused_at_ms.is_some() {
            return;
        }
        self.paused_at_ms = Some(self.clock.now_ms().unwrap_or(0.0));
        self.clock.paused.store(true, Ordering::SeqCst);
    }

    /// The capture pipeline resumed with `paused_for` added to its offset.
    pub(super) fn resume(&mut self, paused_for: Duration) {
        let Some(at_ms) = self.paused_at_ms.take() else {
            return;
        };
        self.pauses.push(Pause {
            at_ms: (at_ms.round().max(0.0) as u64).min(MAX_RECORDING_MS),
            wall_ms: paused_for.as_millis() as u64,
        });
        self.clock.paused.store(false, Ordering::SeqCst);
    }

    /// The recording stopped: stop capturing input and the like right away.
    pub(super) fn stop_capture(&mut self) {
        if self.stopped_at.is_none() {
            self.stopped_at = Some((Utc::now(), self.clock.host_now_nanos()));
        }
        for track in &mut self.tracks {
            track.source.stop();
        }
    }

    fn halt(&mut self) {
        self.stop_capture();
        for track in &self.tracks {
            track.upload.ctrl.cancel();
        }
    }

    /// The recording carries on without tracks; what was written stays on disk.
    pub(super) fn abandon(mut self, reason: &str) {
        eprintln!(
            "[rich-tracks] {}: tracks stopped ({reason}); keeping {}",
            self.target.recording_id,
            self.folder.display()
        );
        self.halt();
    }

    /// The recording is being thrown away, so its tracks are too.
    pub(super) fn discard(mut self) {
        self.halt();
        self.tracks.clear();
        // The writer may still be closing its file; whatever is left after
        // this is removed with the folder by the next discard of it.
        let _ = std::fs::remove_dir_all(&self.folder);
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
        tauri::async_runtime::spawn(finish_tracks(finish, tracks));
    }
}

impl Drop for RichRecording {
    fn drop(&mut self) {
        if !self.tracks.is_empty() {
            self.halt();
        }
    }
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
    pub(super) complete: bool,
    pub(super) meta: serde_json::Value,
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
                    "startMs": 0,
                    "endMs": fields.duration_ms,
                    "complete": track.complete,
                    "meta": track.meta,
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

async fn finish_tracks(mut finish: FinishContext, tracks: Vec<RunningTrack>) {
    let id = finish.target.recording_id.clone();
    let mut finished = Vec::new();
    let mut all_sent = true;
    for RunningTrack {
        id: track,
        source,
        upload: TrackUpload { ctrl, result_rx },
    } in tracks
    {
        let outcome = match tokio::time::timeout(TRACK_UPLOAD_DEADLINE, result_rx).await {
            Ok(Ok(outcome)) => outcome,
            Ok(Err(_)) => TrackUploadOutcome::Failed("the uploader ended without an answer".into()),
            Err(_) => {
                ctrl.cancel();
                TrackUploadOutcome::Failed("its last chunks took too long".into())
            }
        };
        match outcome {
            TrackUploadOutcome::Sent { .. } => {
                let TrackFinish { complete, meta } = source.finish();
                finished.push(FinishedTrack {
                    id: track,
                    complete,
                    meta,
                });
            }
            TrackUploadOutcome::Empty => {
                eprintln!("[rich-tracks] {id}: the {track} track is empty; not listed");
            }
            other => {
                all_sent = false;
                eprintln!("[rich-tracks] {id}: the {track} track was not sent: {other:?}");
            }
        }
    }
    if finish.tracks_stopped.load(Ordering::SeqCst) {
        eprintln!(
            "[rich-tracks] {id}: the server stopped this recording's tracks; not finalizing them, keeping {}",
            finish.folder.display()
        );
        return;
    }
    if finished.is_empty() {
        eprintln!("[rich-tracks] {id}: no track to finalize");
        if all_sent {
            let _ = std::fs::remove_dir_all(&finish.folder);
        }
        return;
    }
    let Some(started_at) = finish.started_at.take() else {
        eprintln!(
            "[rich-tracks] {id}: the recording never started its clock; not finalizing tracks, keeping {}",
            finish.folder.display()
        );
        return;
    };
    finish.fields.started_at = started_at;
    let body = tracks_finalize_body(&finish.fields, &finished);
    match post_tracks_finalize(&finish.target, &body).await {
        Ok(()) if all_sent => {
            eprintln!(
                "[rich-tracks] {id}: tracks finalized; removing {}",
                finish.folder.display()
            );
            let _ = std::fs::remove_dir_all(&finish.folder);
        }
        Ok(()) => eprintln!(
            "[rich-tracks] {id}: tracks finalized without every track; keeping {}",
            finish.folder.display()
        ),
        Err(error) => eprintln!(
            "[rich-tracks] {id}: tracks finalize failed ({error}); keeping {}",
            finish.folder.display()
        ),
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
        clock.paused.store(true, Ordering::SeqCst);
        assert_eq!(clock.at_host_nanos(secs(103.0)), None);
        // Resumed after 5 seconds: the pipeline's offset grows by them.
        offset.store(5.0_f64.to_bits(), Ordering::SeqCst);
        clock.paused.store(false, Ordering::SeqCst);
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
        assert_eq!(
            region_area_pt(&display(), &region),
            RectPt {
                x: -1134.0,
                y: 491.0,
                width: 756.0,
                height: 245.5
            }
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
                    height: 245.5,
                }),
            },
            camera_bubble: false,
        };
        let body = tracks_finalize_body(
            &fields,
            &[FinishedTrack {
                id: INPUT_TRACK_ID,
                complete: true,
                meta: serde_json::json!({
                    "space": "screen-px",
                    "moveIntervalMs": 10,
                    "covers": "global",
                }),
            }],
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
                    "areaPt": { "x": -1134.0, "y": 491.0, "width": 756.0, "height": 245.5 },
                },
                "compat": { "offsetMs": 0, "cursor": "in-pixels", "camera": "none" },
                "privacy": { "keys": "shortcuts", "pageInputs": "masked" },
                "tracks": [{
                    "id": "input",
                    "startMs": 0,
                    "endMs": 61_250,
                    "complete": true,
                    "meta": { "space": "screen-px", "moveIntervalMs": 10, "covers": "global" },
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
}
