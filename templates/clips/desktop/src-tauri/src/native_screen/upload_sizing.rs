//! How a finished desktop recording is sized for upload.
//!
//! One re-encode, sized by the picture: half the capture's bits per pixel, at
//! the size the native capture already records (a 1280-pixel long edge). Even
//! a square 1280x1280 region comes to about 222 MiB over 10 minutes, under free
//! hosted storage's 250 MiB per-clip cap, so no recording needs a smaller
//! picture to fit. The clip's length matters only for a recording too long to
//! fit under the upload limit at that rate (at the default 2 GiB, past about
//! 80 minutes of a square region or two hours of a 16:10 screen): it gets a
//! lower bitrate, never a smaller picture.
//!
//! This replaced a fixed 18 MB target (BuilderIO/agent-native#8360). It took
//! the bitrate from 18 MB divided by the duration, so every clip past about
//! 4½ minutes was squeezed to 350 kbit/s and stepped down to 540p, where
//! screen text can't be read.
//!
//! Plain std only, so the rules can be tested without the app's native stack.

/// Bits per pixel per frame the native capture writes at
/// (`custom_capture::CAPTURE_VIDEO_BPP`).
const CAPTURE_BITS_PER_PIXEL: f64 = 0.15;

/// The re-encode spends half of the capture's bits per pixel. Screen shares are
/// mostly still frames, so half still keeps small text sharp.
const TRANSCODE_BITS_PER_PIXEL: f64 = CAPTURE_BITS_PER_PIXEL / 2.0;

/// Frame rate the bitrate is worked out for (`NATIVE_CAPTURE_FPS`).
const TRANSCODE_RATE_FPS: f64 = 24.0;

/// The output's longest side, the same cap the native capture records at
/// (`NATIVE_CAPTURE_MAX_LONG_EDGE`). Native recordings keep their size; only
/// the full-resolution `screencapture` fallback is scaled down to it.
const TRANSCODE_MAX_LONG_EDGE: u32 = 1280;

/// The picture budgeted for when the source size is unknown: the largest the
/// long-edge cap allows, so whatever ffmpeg scales it to is never starved.
const UNKNOWN_SOURCE_DIMENSIONS: (u32, u32) = (TRANSCODE_MAX_LONG_EDGE, TRANSCODE_MAX_LONG_EDGE);

/// Share of the upload limit a long clip's encode is sized to, leaving room
/// for the MP4 container and the encoder overshooting its target.
const UPLOAD_LIMIT_HEADROOM: f64 = 0.9;

/// libx264 quality, used only when the ffmpeg build has libx264. The bundled
/// sidecar encodes with VideoToolbox, which takes the bitrate instead.
pub(super) const TRANSCODE_CRF: u8 = 22;
pub(super) const TRANSCODE_AUDIO_BITRATE_KBPS: u32 = 160;

/// Apple `avconvert` presets, used only when ffmpeg is missing or fails: a
/// development build without the bundled sidecar. The first is the closest to
/// the ffmpeg encode (it fits a 1280x720 box, so 16:10 comes out a little
/// smaller).
const AVCONVERT_PRESETS: [&str; 3] = ["Preset1280x720", "Preset960x540", "Preset640x480"];

fn even_dimension(value: u32) -> u32 {
    ((value.max(2)) / 2) * 2
}

/// The re-encode's output size: the source scaled down until its long edge
/// fits, never scaled up, with even sides for H.264. `None` when the source
/// size is unknown, and ffmpeg applies the same cap itself.
pub(super) fn transcode_dimensions(width: Option<u32>, height: Option<u32>) -> Option<(u32, u32)> {
    let (width, height) = (u64::from(width?.max(1)), u64::from(height?.max(1)));
    let long_side = width.max(height);
    let max_long = u64::from(TRANSCODE_MAX_LONG_EDGE);
    // Integer math, so a side that should land on 1280 doesn't come out 1278.
    let (num, den) = if long_side > max_long {
        (max_long, long_side)
    } else {
        (1, 1)
    };
    Some((
        even_dimension((width * num / den) as u32),
        even_dimension((height * num / den) as u32),
    ))
}

/// The ffmpeg scale filter for the re-encode. A known size is scaled to
/// exactly; for an unknown one, ffmpeg caps the long edge at 1280 and keeps the
/// aspect ratio, never scaling up.
pub(super) fn transcode_scale_filter(dimensions: Option<(u32, u32)>) -> String {
    match dimensions {
        Some((width, height)) => format!("scale={width}:{height}:flags=lanczos"),
        None => {
            let max = TRANSCODE_MAX_LONG_EDGE;
            format!(
                "scale='if(gte(iw,ih),trunc(min(iw,{max})/2)*2,-2)':\
                 'if(gte(iw,ih),-2,trunc(min(ih,{max})/2)*2)':flags=lanczos"
            )
        }
    }
}

/// Video bitrate for the re-encode, in kbit/s: the picture's rate, lowered only
/// when the clip is too long to fit under `limit_bytes` at that rate.
pub(super) fn transcode_video_rate_kbps(
    dimensions: Option<(u32, u32)>,
    duration_ms: Option<u128>,
    limit_bytes: u64,
) -> u32 {
    let (width, height) = dimensions.unwrap_or(UNKNOWN_SOURCE_DIMENSIONS);
    let bits_per_second =
        TRANSCODE_BITS_PER_PIXEL * f64::from(width) * f64::from(height) * TRANSCODE_RATE_FPS;
    let picture_kbps = (bits_per_second / 1000.0).round();
    let fitting_kbps = duration_ms
        .filter(|&ms| ms > 0)
        .map(|ms| {
            let budget_bits = limit_bytes as f64 * UPLOAD_LIMIT_HEADROOM * 8.0;
            let total_kbps = budget_bits / (ms as f64 / 1000.0) / 1000.0;
            (total_kbps - f64::from(TRANSCODE_AUDIO_BITRATE_KBPS)).floor()
        })
        .unwrap_or(f64::INFINITY);
    picture_kbps.min(fitting_kbps).max(1.0) as u32
}

/// Whether a finished re-encode should be uploaded instead of the capture: it
/// has to be smaller and fit under the upload limit.
pub(super) fn encode_is_worth_uploading(
    encoded_bytes: u64,
    source_bytes: u64,
    limit_bytes: u64,
) -> bool {
    encoded_bytes < source_bytes && encoded_bytes <= limit_bytes
}

/// The `avconvert` presets to try in order. The smaller ones run only when the
/// original is itself over the upload limit, so a clip that couldn't be sent
/// any other way still uploads, and every other clip keeps the 1280 picture.
pub(super) fn avconvert_presets(source_bytes: u64, limit_bytes: u64) -> &'static [&'static str] {
    if source_bytes > limit_bytes {
        &AVCONVERT_PRESETS
    } else {
        &AVCONVERT_PRESETS[..1]
    }
}

/// How long an uploaded recording's original stays on the Mac, so a clip that
/// went wrong can still be found and sent again.
const KEEP_UPLOADED_ORIGINALS_FOR_SECS: u64 = 7 * 24 * 60 * 60;

/// Whether a kept original last touched `age_secs` ago is due for removal.
pub(super) fn kept_original_expired(age_secs: u64) -> bool {
    age_secs > KEEP_UPLOADED_ORIGINALS_FOR_SECS
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIB: u64 = 1024 * 1024;

    #[test]
    fn bitrate_depends_on_the_picture_not_the_clip_length() {
        // Half of 0.15 bits per pixel at 24 fps. A 13-minute 720p screen share
        // gets the same 1.66 Mbit/s as a 30-second one, where the old 18 MB
        // target gave it 350 kbit/s.
        let rate = |dimensions: Option<(u32, u32)>, duration_ms: Option<u128>| {
            transcode_video_rate_kbps(dimensions, duration_ms, 2048 * MIB)
        };
        assert_eq!(rate(Some((1280, 720)), Some(30_000)), 1659);
        assert_eq!(rate(Some((1280, 720)), Some(13 * 60_000)), 1659);
        assert_eq!(rate(Some((1280, 832)), Some(13 * 60_000)), 1917);
        assert_eq!(rate(Some((1280, 832)), None), 1917);
    }

    #[test]
    fn a_clip_too_long_for_the_limit_keeps_its_picture_at_a_lower_bitrate() {
        // Own storage has no duration cap. Three hours of a 16:10 screen at
        // the picture's rate would be about 2.6 GiB, over the default 2 GiB
        // limit, so the bitrate comes down until it fits.
        let limit = 2048 * MIB;
        let three_hours_ms: u128 = 3 * 60 * 60_000;
        let kbps = transcode_video_rate_kbps(Some((1280, 832)), Some(three_hours_ms), limit);
        assert!(kbps < 1917, "{kbps}");
        let seconds = (three_hours_ms / 1000) as u64;
        let bytes = u64::from(kbps + TRANSCODE_AUDIO_BITRATE_KBPS) * 1000 / 8 * seconds;
        assert!(bytes <= limit * 9 / 10, "{bytes}");
        // Two hours still fits at the picture's rate.
        let two_hours_ms: u128 = 2 * 60 * 60_000;
        assert_eq!(
            transcode_video_rate_kbps(Some((1280, 832)), Some(two_hours_ms), limit),
            1917
        );
    }

    #[test]
    fn an_unknown_size_is_capped_by_ffmpeg_and_budgeted_for_the_largest_picture() {
        assert_eq!(
            transcode_scale_filter(Some((1280, 830))),
            "scale=1280:830:flags=lanczos"
        );
        assert_eq!(
            transcode_scale_filter(None),
            "scale='if(gte(iw,ih),trunc(min(iw,1280)/2)*2,-2)':\
             'if(gte(iw,ih),-2,trunc(min(ih,1280)/2)*2)':flags=lanczos"
        );
        // Budgeted as a 1280x1280 square, so no shape ffmpeg picks is starved.
        assert_eq!(transcode_video_rate_kbps(None, None, 2048 * MIB), 2949);
    }

    #[test]
    fn ten_minutes_fits_free_hosted_storage_at_any_shape() {
        // A square region is the most pixels a 1280 long edge allows.
        let dimensions = transcode_dimensions(Some(1280), Some(1280));
        // Sized against the hosted cap, 10 minutes still gets the full rate.
        let video_kbps = transcode_video_rate_kbps(dimensions, Some(600_000), 250 * MIB);
        assert_eq!(video_kbps, 2949);
        let kbps = u64::from(video_kbps + TRANSCODE_AUDIO_BITRATE_KBPS);
        let ten_minute_bytes = kbps * 1000 / 8 * 600;
        assert!(ten_minute_bytes < 225 * MIB, "{ten_minute_bytes}");
        assert!(ten_minute_bytes < 250 * MIB);
    }

    #[test]
    fn native_sizes_are_kept_and_the_fallback_comes_down() {
        let size = |width, height| transcode_dimensions(Some(width), Some(height));
        assert_eq!(size(1280, 720), Some((1280, 720)));
        // A 16:10 MacBook screen keeps its full height.
        assert_eq!(size(1280, 832), Some((1280, 832)));
        assert_eq!(size(1000, 600), Some((1000, 600)));
        // The full-resolution screencapture fallback comes down to the cap.
        assert_eq!(size(3024, 1964), Some((1280, 830)));
        assert_eq!(size(3840, 2160), Some((1280, 720)));
        // Portrait captures cap the long edge too.
        assert_eq!(size(1080, 1920), Some((720, 1280)));
        assert_eq!(size(1281, 721), Some((1280, 720)));
        assert_eq!(transcode_dimensions(None, Some(720)), None);
    }

    #[test]
    fn an_encode_that_fits_is_uploaded_even_far_above_the_old_target() {
        // 13 minutes at the new rate is about 170 MiB: well past the old 18 MB
        // target, and under a 250 MiB or 2 GiB limit.
        assert!(encode_is_worth_uploading(170 * MIB, 330 * MIB, 250 * MIB));
        assert!(encode_is_worth_uploading(170 * MIB, 330 * MIB, 2048 * MIB));
    }

    #[test]
    fn an_encode_that_saves_nothing_or_is_over_the_limit_is_not_used() {
        assert!(!encode_is_worth_uploading(40 * MIB, 30 * MIB, 250 * MIB));
        assert!(!encode_is_worth_uploading(30 * MIB, 30 * MIB, 250 * MIB));
        assert!(!encode_is_worth_uploading(300 * MIB, 400 * MIB, 250 * MIB));
    }

    #[test]
    fn avconvert_steps_down_only_when_the_original_cannot_upload() {
        assert_eq!(avconvert_presets(300 * MIB, 2048 * MIB), ["Preset1280x720"]);
        assert_eq!(
            avconvert_presets(2048 * MIB, 2048 * MIB),
            ["Preset1280x720"]
        );
        assert_eq!(
            avconvert_presets(3000 * MIB, 2048 * MIB),
            ["Preset1280x720", "Preset960x540", "Preset640x480"]
        );
    }

    #[test]
    fn originals_are_kept_for_seven_days() {
        let day = 24 * 60 * 60;
        assert!(!kept_original_expired(6 * day));
        assert!(!kept_original_expired(7 * day));
        assert!(kept_original_expired(7 * day + 1));
    }
}
