//! The camera track of a rich recording: the camera the bubble shows, at the
//! size the camera delivers, as fMP4 H.264 in `camera.mp4`. An AVCaptureSession
//! of its own on the same camera feeds it (see `custom_capture::camera_writer`),
//! leaving the camera's format alone so the bubble looks as it did; this module
//! holds what can be worked out without one.
//!
//! The file's media time is recording time, as the screen track's is: a frame
//! captured at host time `t` sits at `t` less the flattened recording's first
//! frame and the pipeline's pause offset. Frames from before the recording's
//! first frame, while paused or after Stop are left out.

use super::rich_recording::TrackFinish;
use super::screen_track::codec_from_init;

pub(super) const CAMERA_TRACK_ID: &str = "camera";
pub(super) const CAMERA_TRACK_FILE: &str = "camera.mp4";
pub(super) const CAMERA_TRACK_CONTENT_TYPE: &str = "video/mp4";
/// Media timescale of the file, so frame times keep sub-millisecond precision.
pub(super) const CAMERA_TRACK_TIMESCALE: i32 = 90_000;
/// A keyframe at least this often, so a reader can seek without decoding far.
pub(super) const CAMERA_TRACK_MAX_KEYFRAME_SECONDS: f64 = 2.0;
/// The frame rate to assume of a camera that doesn't say.
pub(super) const CAMERA_TRACK_DEFAULT_FPS: u32 = 30;
/// Bits per pixel per frame: a camera picture changes everywhere all the time,
/// unlike a screen, but is far softer.
const CAMERA_TRACK_BPP: f64 = 0.1;

/// What the camera delivers: the size of its first frame, and the rate its
/// format allows.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct CameraFormat {
    pub(super) width_px: u32,
    pub(super) height_px: u32,
    pub(super) max_fps: u32,
}

impl CameraFormat {
    /// The format of frames `width` x `height` from a camera whose shortest
    /// frame lasts `min_frame_secs`, with sizes even for the encoder.
    pub(super) fn new(width: i32, height: i32, min_frame_secs: Option<f64>) -> Option<Self> {
        let even = |value: i32| u32::try_from(value).ok().map(|value| value / 2 * 2);
        let (width_px, height_px) = (even(width)?, even(height)?);
        if width_px == 0 || height_px == 0 {
            return None;
        }
        let max_fps = min_frame_secs
            .filter(|secs| secs.is_finite() && *secs > 0.0)
            .map(|secs| (1.0 / secs).round().clamp(1.0, 240.0) as u32)
            .unwrap_or(CAMERA_TRACK_DEFAULT_FPS);
        Some(Self {
            width_px,
            height_px,
            max_fps,
        })
    }

    pub(super) fn bit_rate(&self) -> i64 {
        (f64::from(self.width_px)
            * f64::from(self.height_px)
            * f64::from(self.max_fps)
            * CAMERA_TRACK_BPP)
            .round() as i64
    }
}

/// The camera the bubble shows among `names`, the cameras AVFoundation lists:
/// the one named `label`, the web view's name for it; else the one camera
/// whose name is close to it; else the only camera there is. Two cameras of
/// that very name give none, since either could be the bubble's.
pub(super) fn pick_camera(names: &[String], label: Option<&str>) -> Option<usize> {
    let label = label.map(str::trim).filter(|label| !label.is_empty());
    if let Some(label) = label {
        let wanted = super::normalize_audio_device_name(label);
        let mut exact = names
            .iter()
            .enumerate()
            .filter(|(_, name)| super::normalize_audio_device_name(name) == wanted)
            .map(|(index, _)| index);
        match (exact.next(), exact.next()) {
            (Some(only), None) => return Some(only),
            (Some(_), Some(_)) => return None,
            _ => {}
        }
        let mut close = names
            .iter()
            .enumerate()
            .filter(|(_, name)| super::names_match(name, label))
            .map(|(index, _)| index);
        if let (Some(only), None) = (close.next(), close.next()) {
            return Some(only);
        }
    }
    (names.len() == 1).then_some(0)
}

/// What the camera writer ended up with, read once it has closed.
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct CameraTrackReport {
    /// What the file was made for, from its first frame.
    pub(super) format: Option<CameraFormat>,
    pub(super) init: Option<Vec<u8>>,
    pub(super) frames: u64,
    pub(super) start_ms: Option<u64>,
    pub(super) end_ms: Option<u64>,
    /// Why the track stopped before the recording did, if it did.
    pub(super) stopped_early: Option<String>,
    pub(super) closed: bool,
}

/// The camera track's entry in the tracks finalize body.
pub(super) fn camera_track_finish(report: &CameraTrackReport, duration_ms: u64) -> TrackFinish {
    let start_ms = report.start_ms.unwrap_or(0).min(duration_ms);
    let end_ms = report
        .end_ms
        .unwrap_or(duration_ms)
        .clamp(start_ms, duration_ms);
    let mut meta = serde_json::json!({});
    if let Some(format) = report.format {
        meta["widthPx"] = serde_json::json!(format.width_px);
        meta["heightPx"] = serde_json::json!(format.height_px);
        meta["maxFps"] = serde_json::json!(format.max_fps);
    }
    if let Some(init) = report.init.as_deref() {
        meta["initBytes"] = serde_json::json!(init.len());
        if let Some(codec) = codec_from_init(init) {
            meta["codec"] = serde_json::json!(codec);
        }
    }
    TrackFinish {
        complete: report.closed && report.stopped_early.is_none() && report.init.is_some(),
        start_ms,
        end_ms,
        meta,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    #[test]
    fn the_bubble_camera_is_found_by_its_web_view_name() {
        let cameras = names(&[
            "FaceTime HD Camera",
            "Alice’s iPhone Camera",
            "OBS Virtual Camera",
        ]);
        assert_eq!(pick_camera(&cameras, Some("OBS Virtual Camera")), Some(2));
        // WebKit can add the model's USB id or other words to the name.
        assert_eq!(
            pick_camera(&cameras, Some("FaceTime HD Camera (05ac:8514)")),
            Some(0)
        );
        // No match among several: not a guess.
        assert_eq!(pick_camera(&cameras, Some("Elgato Facecam")), None);
        // The camera named exactly wins over one whose name contains it, and
        // a name close to two cameras picks neither.
        let usb = names(&["USB Camera", "USB Camera Pro"]);
        assert_eq!(pick_camera(&usb, Some("USB Camera Pro")), Some(1));
        assert_eq!(pick_camera(&usb, Some("usb camera")), Some(0));
        assert_eq!(pick_camera(&usb, Some("USB Camera Pro (046d:0893)")), None);
        // Two of the same model share a name, and either could be the bubble's.
        let twins = names(&["USB Camera", "FaceTime HD Camera", "USB Camera"]);
        assert_eq!(pick_camera(&twins, Some("USB Camera")), None);
        assert_eq!(pick_camera(&twins, Some("FaceTime HD Camera")), Some(1));
        assert_eq!(pick_camera(&cameras, None), None);
        // The only camera there is must be the bubble's.
        let one = names(&["FaceTime HD Camera"]);
        assert_eq!(pick_camera(&one, Some("  ")), Some(0));
        assert_eq!(pick_camera(&one, Some("Elgato Facecam")), Some(0));
        assert_eq!(pick_camera(&[], Some("FaceTime HD Camera")), None);
    }

    #[test]
    fn the_format_is_even_sized_and_its_rate_comes_from_the_shortest_frame() {
        assert_eq!(
            CameraFormat::new(1920, 1080, Some(1.0 / 30.0)),
            Some(CameraFormat {
                width_px: 1920,
                height_px: 1080,
                max_fps: 30,
            })
        );
        // An odd size loses a pixel; a 29.97 fps camera counts as 30.
        assert_eq!(
            CameraFormat::new(1279, 721, Some(1001.0 / 30_000.0)),
            Some(CameraFormat {
                width_px: 1278,
                height_px: 720,
                max_fps: 30,
            })
        );
        // A camera that doesn't say how fast it goes.
        assert_eq!(
            CameraFormat::new(640, 480, None).map(|format| format.max_fps),
            Some(CAMERA_TRACK_DEFAULT_FPS)
        );
        assert_eq!(
            CameraFormat::new(640, 480, Some(0.0)).map(|format| format.max_fps),
            Some(CAMERA_TRACK_DEFAULT_FPS)
        );
        // No picture.
        assert_eq!(CameraFormat::new(0, 720, None), None);
        assert_eq!(CameraFormat::new(1, 1, None), None);
        assert_eq!(CameraFormat::new(-1920, 1080, None), None);
        // 1080p30 at a tenth of a bit per pixel: about 6.2 Mbit/s.
        let format = CameraFormat::new(1920, 1080, Some(1.0 / 30.0)).unwrap();
        assert_eq!(format.bit_rate(), 6_220_800);
    }

    #[test]
    fn the_camera_meta_names_the_file_pixels_codec_and_rate() {
        let mut init = vec![0, 0, 0, 0x0c];
        init.extend_from_slice(b"avcC");
        init.extend_from_slice(&[1, 0x64, 0x00, 0x28]);
        let report = CameraTrackReport {
            format: CameraFormat::new(1920, 1080, Some(1.0 / 30.0)),
            init: Some(init),
            frames: 1_830,
            start_ms: Some(33),
            end_ms: Some(61_400),
            stopped_early: None,
            closed: true,
        };
        let finish = camera_track_finish(&report, 61_250);
        assert!(finish.complete);
        assert_eq!((finish.start_ms, finish.end_ms), (33, 61_250));
        assert_eq!(
            finish.meta,
            serde_json::json!({
                "initBytes": 12,
                "codec": "avc1.640028",
                "widthPx": 1920,
                "heightPx": 1080,
                "maxFps": 30,
            })
        );

        // The camera went away mid-recording: listed, but not complete.
        let early = camera_track_finish(
            &CameraTrackReport {
                end_ms: Some(20_000),
                stopped_early: Some("the camera was disconnected".into()),
                ..report.clone()
            },
            61_250,
        );
        assert!(!early.complete);
        assert_eq!((early.start_ms, early.end_ms), (33, 20_000));

        // No frame ever came: nothing to say about the file.
        let empty = camera_track_finish(&CameraTrackReport::default(), 61_250);
        assert!(!empty.complete);
        assert_eq!(empty.meta, serde_json::json!({}));
    }
}
