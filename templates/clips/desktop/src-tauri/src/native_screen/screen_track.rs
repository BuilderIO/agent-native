//! The screen track of a rich recording: the captured display or region at its
//! native resolution, without the cursor (the input track has it), as fMP4
//! H.264 in `screen.mp4`. A second ScreenCaptureKit stream feeds it (see
//! `custom_capture::screen_writer`); this module holds what can be worked out
//! without one: the pixels it covers, where each frame goes on the recording's
//! clock, and what finalizing says about the file.
//!
//! The file's media time is recording time: a frame captured at host time `t`
//! sits at `t` less the flattened recording's first frame and the pipeline's
//! pause offset, the same retiming the flattened writer applies. Frames arrive
//! only when the screen changes, so the file has a variable frame rate.

use super::input_track::DisplayGeometry;
use super::rich_recording::{RectPt, TrackFinish};

pub(super) const SCREEN_TRACK_ID: &str = "screen";
pub(super) const SCREEN_TRACK_FILE: &str = "screen.mp4";
pub(super) const SCREEN_TRACK_CONTENT_TYPE: &str = "video/mp4";
pub(super) const SCREEN_TRACK_MAX_FPS: u32 = 60;
/// Media timescale of the file, so frame times keep sub-millisecond precision.
pub(super) const SCREEN_TRACK_TIMESCALE: i32 = 90_000;
/// A keyframe at least this often, so a reader can seek without decoding far.
pub(super) const SCREEN_TRACK_MAX_KEYFRAME_SECONDS: f64 = 6.0;

/// What the screen track records: a part of one display, at its pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct ScreenArea {
    /// The stream's source rect in display-local points; `None` for the whole
    /// display.
    pub(super) source_rect_pt: Option<RectPt>,
    pub(super) width_px: u32,
    pub(super) height_px: u32,
    pub(super) scale: f64,
}

fn even_px(value: f64) -> u32 {
    ((value.max(2.0).round() as u32) / 2) * 2
}

/// The screen track's area for a display, or for `area_pt` (global points,
/// whole points as the flattened recording's region uses) on it. Sizes are
/// even for the encoder; a trimmed pixel is taken off the source rect too, so
/// a point is always `scale` pixels on both axes and the input track's pixels
/// line up with the file's.
pub(super) fn screen_area(display: &DisplayGeometry, area_pt: Option<RectPt>) -> ScreenArea {
    let scale = display.scale();
    match area_pt {
        None => ScreenArea {
            source_rect_pt: None,
            width_px: even_px(f64::from(display.width_px)),
            height_px: even_px(f64::from(display.height_px)),
            scale,
        },
        Some(area) => {
            let width_px = even_px(area.width * scale);
            let height_px = even_px(area.height * scale);
            ScreenArea {
                source_rect_pt: Some(RectPt {
                    x: area.x - display.x_pt,
                    y: area.y - display.y_pt,
                    width: f64::from(width_px) / scale,
                    height: f64::from(height_px) / scale,
                }),
                width_px,
                height_px,
                scale,
            }
        }
    }
}

/// The encoder's average bit rate, sized by pixels the way the flattened
/// recording's is. AVFoundation takes a quality setting only for JPEG, HEIC
/// and ProRAW, not H.264. Frames come only on change, so a still screen costs
/// far less than this.
pub(super) fn screen_track_bit_rate(width_px: u32, height_px: u32) -> i64 {
    (super::custom_capture::CAPTURE_VIDEO_BPP
        * f64::from(width_px)
        * f64::from(height_px)
        * f64::from(super::NATIVE_CAPTURE_FPS)) as i64
}

/// Places frames on the file's timeline: at their recording time, never before
/// zero, and each at least one frame interval after the last so times always
/// advance.
#[derive(Debug)]
pub(super) struct FrameTimeline {
    spacing_secs: f64,
    first_secs: Option<f64>,
    last_secs: Option<f64>,
    frames: u64,
}

/// The screen track's, at up to `SCREEN_TRACK_MAX_FPS`.
impl Default for FrameTimeline {
    fn default() -> Self {
        Self::with_max_fps(SCREEN_TRACK_MAX_FPS)
    }
}

impl FrameTimeline {
    /// A timeline for frames coming at up to `max_fps` a second.
    pub(super) fn with_max_fps(max_fps: u32) -> Self {
        Self {
            spacing_secs: 1.0 / f64::from(max_fps.max(1)),
            first_secs: None,
            last_secs: None,
            frames: 0,
        }
    }

    /// Where a frame at `recording_secs` would go. A frame from before the
    /// first one, held until the clock started, goes at zero.
    pub(super) fn place(&self, recording_secs: f64) -> f64 {
        let earliest = self.last_secs.map_or(0.0, |last| last + self.spacing_secs);
        recording_secs.max(earliest)
    }

    /// The frame placed at `secs` was written.
    pub(super) fn commit(&mut self, secs: f64) {
        self.first_secs.get_or_insert(secs);
        self.last_secs = Some(secs);
        self.frames += 1;
    }

    pub(super) fn frames(&self) -> u64 {
        self.frames
    }

    /// The first written frame's recording milliseconds.
    pub(super) fn start_ms(&self) -> Option<u64> {
        self.first_secs
            .map(|secs| (secs * 1000.0).floor().max(0.0) as u64)
    }

    /// Where the file ends: when the track stopped, but never before its last
    /// frame has been shown for a frame interval.
    pub(super) fn end_secs(&self, stopped_secs: Option<f64>) -> f64 {
        let after_last = self.last_secs.map_or(0.0, |last| last + self.spacing_secs);
        stopped_secs.unwrap_or(after_last).max(after_last)
    }
}

/// The RFC 6381 codec string of an H.264 init segment, from the profile,
/// constraint flags and level in its `avcC` box: `avc1.640033` for High 5.1.
pub(super) fn codec_from_init(init: &[u8]) -> Option<String> {
    let at = init.windows(4).position(|window| window == b"avcC")?;
    // The box's size precedes its type; its body starts with
    // configurationVersion (always 1), then profile, compatibility, level.
    let size_at = at.checked_sub(4)?;
    let size = u32::from_be_bytes(init[size_at..at].try_into().ok()?) as usize;
    let body = init.get(at + 4..size_at + size)?;
    match body {
        [1, profile, compatibility, level, ..] => {
            Some(format!("avc1.{profile:02x}{compatibility:02x}{level:02x}"))
        }
        _ => None,
    }
}

/// What the screen writer ended up with, read once it has closed.
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct ScreenTrackReport {
    pub(super) init: Option<Vec<u8>>,
    pub(super) frames: u64,
    pub(super) start_ms: Option<u64>,
    pub(super) end_ms: Option<u64>,
    /// Why the track stopped before the recording did, if it did.
    pub(super) stopped_early: Option<String>,
    pub(super) closed: bool,
}

/// The screen track's entry in the tracks finalize body.
pub(super) fn screen_track_finish(
    report: &ScreenTrackReport,
    area: &ScreenArea,
    duration_ms: u64,
) -> TrackFinish {
    let start_ms = report.start_ms.unwrap_or(0).min(duration_ms);
    let end_ms = report
        .end_ms
        .unwrap_or(duration_ms)
        .clamp(start_ms, duration_ms);
    let mut meta = serde_json::json!({
        "widthPx": area.width_px,
        "heightPx": area.height_px,
        "scale": area.scale,
        "maxFps": SCREEN_TRACK_MAX_FPS,
        "cursor": "hidden",
    });
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
    fn the_screen_track_and_the_input_track_share_pixels() {
        let display = display();
        // The whole display: the display's own pixels, from its top-left.
        let whole = screen_area(&display, None);
        assert_eq!(
            (whole.width_px, whole.height_px, whole.source_rect_pt),
            (3024, 1964, None)
        );
        let space = display.pixel_space(None);
        assert_eq!(space.to_px(-1512.0, 0.0), (0.0, 0.0));
        assert_eq!(space.to_px(0.0, 982.0), (3024.0, 1964.0));

        // A region, in whole points as the flattened recording crops it.
        let area = RectPt {
            x: -1134.0,
            y: 491.0,
            width: 756.0,
            height: 245.0,
        };
        let region = screen_area(&display, Some(area));
        assert_eq!((region.width_px, region.height_px), (1512, 490));
        assert_eq!(
            region.source_rect_pt,
            Some(RectPt {
                x: 378.0,
                y: 491.0,
                width: 756.0,
                height: 245.0
            })
        );
        let space = display.pixel_space(Some((area.x, area.y)));
        assert_eq!(space.to_px(area.x, area.y), (0.0, 0.0));
        assert_eq!(
            space.to_px(area.x + area.width, area.y + area.height),
            (f64::from(region.width_px), f64::from(region.height_px))
        );

        // At 1x an odd width loses its last pixel, and the source rect with it.
        let one_x = DisplayGeometry {
            width_px: 1512,
            height_px: 982,
            ..display
        };
        let odd = screen_area(
            &one_x,
            Some(RectPt {
                width: 757.0,
                ..area
            }),
        );
        assert_eq!((odd.width_px, odd.height_px), (756, 244));
        let rect = odd.source_rect_pt.unwrap();
        assert_eq!((rect.width, rect.height), (756.0, 244.0));
        assert_eq!(odd.scale, 1.0);
    }

    #[test]
    fn frames_go_at_their_recording_time_and_always_advance() {
        let mut timeline = FrameTimeline::default();
        assert_eq!(timeline.start_ms(), None);
        // A frame held from before the clock started goes at zero.
        assert_eq!(timeline.place(-0.25), 0.0);
        timeline.commit(0.0);
        // Then each frame at its own time.
        assert_eq!(timeline.place(1.2345), 1.2345);
        timeline.commit(1.2345);
        // One too close to the last is pushed a frame interval after it.
        let pushed = timeline.place(1.2350);
        assert!((pushed - (1.2345 + 1.0 / 60.0)).abs() < 1e-9, "{pushed}");
        timeline.commit(pushed);
        assert_eq!(timeline.frames(), 3);
        assert_eq!(timeline.start_ms(), Some(0));
        // It ends when it stopped, or a frame after its last.
        assert_eq!(timeline.end_secs(Some(9.5)), 9.5);
        assert!((timeline.end_secs(None) - (pushed + 1.0 / 60.0)).abs() < 1e-9);
    }

    #[test]
    fn the_codec_string_comes_from_the_avcc_profile_and_level() {
        // ... avc1 sample entry ... [size]avcC [1, profile, compat, level, ...]
        let mut init = b"\0\0\0\x10ftypiso5\0\0\0\0junkavc1".to_vec();
        init.extend_from_slice(&[0, 0, 0, 0x11]);
        init.extend_from_slice(b"avcC");
        init.extend_from_slice(&[1, 0x64, 0x00, 0x33, 0xff, 0xe1, 0, 0, 0]);
        assert_eq!(codec_from_init(&init).as_deref(), Some("avc1.640033"));

        // Main 4.0 with constraint flags.
        let mut main = vec![0, 0, 0, 0x0f];
        main.extend_from_slice(b"avcC");
        main.extend_from_slice(&[1, 0x4d, 0x40, 0x28, 0xff, 0xe1, 0]);
        assert_eq!(codec_from_init(&main).as_deref(), Some("avc1.4d4028"));

        // No avcC, a truncated one, or an unknown version: no codec.
        assert_eq!(codec_from_init(b"ftypmoov"), None);
        assert_eq!(codec_from_init(b"\0\0\0\x11avcC\x01\x64"), None);
        let mut v2 = vec![0, 0, 0, 0x0c];
        v2.extend_from_slice(b"avcC");
        v2.extend_from_slice(&[2, 0x64, 0, 0x33]);
        assert_eq!(codec_from_init(&v2), None);
    }

    #[test]
    fn the_screen_meta_names_the_file_pixels_codec_and_hidden_cursor() {
        let mut init = vec![0, 0, 0, 0x0c];
        init.extend_from_slice(b"avcC");
        init.extend_from_slice(&[1, 0x64, 0x00, 0x33]);
        let area = screen_area(&display(), None);
        let report = ScreenTrackReport {
            init: Some(init),
            frames: 812,
            start_ms: Some(140),
            end_ms: Some(61_400),
            stopped_early: None,
            closed: true,
        };
        let finish = screen_track_finish(&report, &area, 61_250);
        assert!(finish.complete);
        // Ends no later than the recording.
        assert_eq!((finish.start_ms, finish.end_ms), (140, 61_250));
        assert_eq!(
            finish.meta,
            serde_json::json!({
                "initBytes": 12,
                "codec": "avc1.640033",
                "widthPx": 3024,
                "heightPx": 1964,
                "scale": 2.0,
                "maxFps": 60,
                "cursor": "hidden",
            })
        );

        // Stopped early: listed, but not complete, and ends when it stopped.
        let early = screen_track_finish(
            &ScreenTrackReport {
                end_ms: Some(20_000),
                stopped_early: Some("the encoder fell behind".into()),
                ..report.clone()
            },
            &area,
            61_250,
        );
        assert!(!early.complete);
        assert_eq!((early.start_ms, early.end_ms), (140, 20_000));
    }
}
