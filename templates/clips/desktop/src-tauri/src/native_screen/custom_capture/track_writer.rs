//! The AVAssetWriter every rich recording track file with media in it shares:
//! fMP4 in one-second fragments, handed to a `SegmentSink` on the track's
//! path as the flattened recording's live-upload writer does, with media time
//! starting at zero, the recording's first frame. The screen, camera, mic and
//! system sound writers each feed one, one thread at a time.

use super::{
    av_class_named, av_dict, av_dict_set, av_ns_string_from, av_number_bool, av_number_i64,
    av_writer_error_suffix, describe_objc_exception, CMSampleBufferCreateCopyWithNewTiming,
    ObjcCMSampleTimingInfo, ObjcCMTime, SegmentSink, SegmentWriterDelegate,
    AV_WRITER_STATUS_COMPLETED, OUTPUT_SEGMENT_INTERVAL_SECONDS,
};

use objc2::msg_send;
use objc2::rc::{Allocated, Retained};
use objc2::runtime::AnyObject;
use screencapturekit::cm::CMSampleBuffer;
use std::panic::AssertUnwindSafe;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

const FINISH_TIMEOUT: Duration = Duration::from_secs(15);

/// What a track file's one input holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum TrackMedia {
    /// Video, its media timescale set so frame times keep their precision.
    Video { timescale: i32 },
    /// Audio, whose media timescale is its sample rate.
    Audio { sample_rate: i32 },
}

impl TrackMedia {
    fn timescale(self) -> i32 {
        match self {
            Self::Video { timescale } => timescale,
            Self::Audio { sample_rate } => sample_rate,
        }
    }
}

pub(super) struct TrackWriter {
    writer: Retained<AnyObject>,
    input: Retained<AnyObject>,
    sink: Arc<SegmentSink>,
    _delegate: Retained<SegmentWriterDelegate>,
    media: TrackMedia,
}

/// A time on a track file's timeline, at its media timescale.
pub(super) fn track_time(secs: f64, timescale: i32) -> ObjcCMTime {
    ObjcCMTime {
        value: (secs * f64::from(timescale)).round() as i64,
        timescale,
        flags: 1,
        epoch: 0,
    }
}

pub(super) const INVALID_TIME: ObjcCMTime = ObjcCMTime {
    value: 0,
    timescale: 0,
    flags: 0,
    epoch: 0,
};

/// A copy of `sample` presented at `pts`, lasting `duration` (each sample's
/// own, for audio; `INVALID_TIME` lets the writer work it out).
pub(super) fn retimed(
    sample: &CMSampleBuffer,
    pts: ObjcCMTime,
    duration: ObjcCMTime,
) -> Result<CMSampleBuffer, String> {
    let timing = ObjcCMSampleTimingInfo {
        duration,
        presentation_time_stamp: pts,
        decode_time_stamp: INVALID_TIME,
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

impl TrackWriter {
    /// A writer for `path` with one input of `media`, encoded with `settings`.
    /// AVAssetWriter makes the first frame of each fragment a keyframe.
    pub(super) unsafe fn create(
        path: &Path,
        media: TrackMedia,
        settings: &AnyObject,
    ) -> Result<Self, String> {
        #[link(name = "AVFoundation", kind = "framework")]
        extern "C" {
            static AVMediaTypeVideo: *const AnyObject;
            static AVMediaTypeAudio: *const AnyObject;
            static AVFileTypeProfileMPEG4AppleHLS: *const AnyObject;
            static AVFileTypeProfileMPEG4CMAFCompliant: *const AnyObject;
        }

        let media_type = match media {
            TrackMedia::Video { .. } => AVMediaTypeVideo,
            TrackMedia::Audio { .. } => AVMediaTypeAudio,
        };
        // The AAC encoder puts 44 ms of lead-in before the sound. The HLS
        // profile starts the file with it, so sound from the recording's first
        // 44 ms can't keep its time; the CMAF profile's edit list drops it.
        let profile = match media {
            TrackMedia::Video { .. } => AVFileTypeProfileMPEG4AppleHLS,
            TrackMedia::Audio { .. } => AVFileTypeProfileMPEG4CMAFCompliant,
        };
        let writer_cls =
            av_class_named("AVAssetWriter").ok_or_else(|| "AVAssetWriter missing".to_string())?;
        let input_cls = av_class_named("AVAssetWriterInput")
            .ok_or_else(|| "AVAssetWriterInput missing".to_string())?;
        let ident = av_ns_string_from("public.mpeg-4")
            .ok_or_else(|| "NSString for UTType failed".to_string())?;
        let ut_cls = av_class_named("UTType").ok_or_else(|| "UTType missing".to_string())?;
        let settings_ptr = settings as *const AnyObject;
        // `alloc` hands over an `Allocated` the `init` consumes, so an `init`
        // that returns nil, having released its receiver, never has it
        // released again.
        let created = objc2::exception::catch(AssertUnwindSafe(|| unsafe {
            let ut: Option<Retained<AnyObject>> = msg_send![ut_cls, typeWithIdentifier: &*ident];
            let ut = ut.ok_or_else(|| "UTType public.mpeg-4 unavailable".to_string())?;
            let allocated: Allocated<AnyObject> = msg_send![writer_cls, alloc];
            let writer: Option<Retained<AnyObject>> =
                msg_send![allocated, initWithContentType: &*ut];
            let writer =
                writer.ok_or_else(|| "AVAssetWriter initWithContentType failed".to_string())?;
            let input: Option<Retained<AnyObject>> = msg_send![
                input_cls,
                assetWriterInputWithMediaType: media_type,
                outputSettings: &*settings_ptr
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
        let timescale = media.timescale();
        let configured = objc2::exception::catch(AssertUnwindSafe(|| unsafe {
            let interval = ObjcCMTime {
                value: OUTPUT_SEGMENT_INTERVAL_SECONDS,
                timescale: 1,
                flags: 1,
                epoch: 0,
            };
            let _: () = msg_send![&*writer_ptr, setPreferredOutputSegmentInterval: interval];
            let _: () =
                msg_send![&*writer_ptr, setInitialSegmentStartTime: track_time(0.0, timescale)];
            let _: () = msg_send![&*writer_ptr, setOutputFileTypeProfile: profile];
            let _: () = msg_send![&*writer_ptr, setDelegate: &*delegate];
            let _: () = msg_send![&*input_ptr, setExpectsMediaDataInRealTime: true];
            // An audio input takes no media timescale; its sample rate is it.
            if let TrackMedia::Video { timescale } = media {
                let _: () = msg_send![&*input_ptr, setMediaTimeScale: timescale];
            }
            let can_add: bool = msg_send![&*writer_ptr, canAddInput: &*input_ptr];
            if can_add {
                let _: () = msg_send![&*writer_ptr, addInput: &*input_ptr];
            }
            can_add
        }));
        match configured {
            Ok(true) => Ok(Self {
                writer,
                input,
                sink,
                _delegate: delegate,
                media,
            }),
            Ok(false) => Err("AVAssetWriter cannot add the track's input".into()),
            Err(exception) => Err(format!(
                "writer setup raised: {}",
                describe_objc_exception(exception)
            )),
        }
    }

    /// `secs` of this file's timeline.
    pub(super) fn time(&self, secs: f64) -> ObjcCMTime {
        track_time(secs, self.media.timescale())
    }

    /// Starts writing with the session at zero: the recording's first frame,
    /// so media time is recording time.
    pub(super) unsafe fn start(&self) -> Result<(), String> {
        let writer_ptr = &*self.writer as *const AnyObject;
        let zero = self.time(0.0);
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
                av_writer_error_suffix(&self.writer)
            )),
            Err(exception) => Err(format!(
                "startWriting raised: {}",
                describe_objc_exception(exception)
            )),
        }
    }

    pub(super) unsafe fn is_ready(&self) -> bool {
        msg_send![&*self.input, isReadyForMoreMediaData]
    }

    /// Appends a sample already on this file's timeline.
    pub(super) unsafe fn append(&self, sample: &CMSampleBuffer) -> Result<(), String> {
        let input_ptr = &*self.input as *const AnyObject;
        let appended = objc2::exception::catch(AssertUnwindSafe(|| unsafe {
            let appended: bool = msg_send![&*input_ptr, appendSampleBuffer: sample.as_ptr()];
            appended
        }));
        match appended {
            Ok(true) => Ok(()),
            Ok(false) => Err(format!(
                "appendSampleBuffer failed{}",
                av_writer_error_suffix(&self.writer)
            )),
            Err(exception) => Err(format!(
                "appendSampleBuffer raised: {}",
                describe_objc_exception(exception)
            )),
        }
    }

    /// Ends the file at `end_secs` and waits for its last fragment.
    pub(super) unsafe fn finish(&self, end_secs: f64) -> Result<(), String> {
        use block2::RcBlock;

        let writer = &*self.writer as *const AnyObject;
        let input = &*self.input as *const AnyObject;
        let (tx, rx) = std::sync::mpsc::sync_channel::<()>(1);
        let block = RcBlock::new(move || {
            let _ = tx.send(());
        });
        let end = self.time(end_secs);
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

    /// Why the file could not be written, if it couldn't.
    pub(super) fn sink_failure(&self) -> Option<String> {
        self.sink.failure()
    }

    /// The file's init segment, once the writer has made it.
    pub(super) fn init_segment(&self) -> Option<Vec<u8>> {
        self.sink
            .state
            .lock()
            .ok()
            .and_then(|sink| sink.init_segment.clone())
    }
}

/// H.264 High at `width` x `height`, without frame reordering, at an average
/// `bit_rate` and a keyframe at least every `max_keyframe_secs`.
pub(super) unsafe fn h264_settings(
    width: u32,
    height: u32,
    bit_rate: i64,
    expected_fps: u32,
    max_keyframe_secs: f64,
) -> Result<Retained<AnyObject>, String> {
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
    av_dict_set(&compression, AVVideoAverageBitRateKey, &*number(bit_rate)?);
    av_dict_set(
        &compression,
        AVVideoExpectedSourceFrameRateKey,
        &*number(i64::from(expected_fps))?,
    );
    let keyframe_seconds: *mut AnyObject =
        msg_send![objc2::class!(NSNumber), numberWithDouble: max_keyframe_secs];
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
    use super::super::{av_audio_output_settings, LiveAudioMixer};
    use super::*;
    use std::time::Instant;

    const SAMPLE_RATE: i32 = 48_000;
    const BUFFER_FRAMES: usize = 480;
    /// The lead-in the AAC encoder puts before the sound: 44 ms.
    const LEAD_IN_FRAMES: u64 = 2112;
    const READY_TIMEOUT: Duration = Duration::from_secs(10);

    fn be_u32(bytes: &[u8]) -> u32 {
        u32::from_be_bytes(bytes[..4].try_into().unwrap())
    }

    fn be_u64(bytes: &[u8]) -> u64 {
        u64::from_be_bytes(bytes[..8].try_into().unwrap())
    }

    /// What the first box at `path` holds, or nothing without one.
    fn first_box<'a>(bytes: &'a [u8], path: &[&[u8; 4]]) -> Option<&'a [u8]> {
        let Some((kind, inner)) = path.split_first() else {
            return Some(bytes);
        };
        let mut rest = bytes;
        while rest.len() >= 8 {
            let size = be_u32(rest) as usize;
            assert!((8..=rest.len()).contains(&size), "box of {size} bytes");
            if &rest[4..8] == *kind {
                return first_box(&rest[8..size], inner);
            }
            rest = &rest[size..];
        }
        None
    }

    /// The decode time of the file's first fragment.
    fn first_decode_time(file: &[u8]) -> u64 {
        let tfdt = first_box(file, &[b"moof", b"traf", b"tfdt"]).expect("a first fragment");
        match tfdt[0] {
            0 => be_u32(&tfdt[4..]).into(),
            _ => be_u64(&tfdt[4..]),
        }
    }

    /// Where the file's one edit starts playing its media.
    fn edit_media_time(file: &[u8]) -> Option<u64> {
        let elst = first_box(file, &[b"moov", b"trak", b"edts", b"elst"])?;
        assert_eq!(be_u32(&elst[4..]), 1, "edits");
        Some(match elst[0] {
            0 => be_u32(&elst[12..]).into(),
            _ => be_u64(&elst[16..]),
        })
    }

    /// The bytes of a sound file whose first buffer starts `start_frame`
    /// frames into the recording.
    fn sound_file(start_frame: i64) -> Vec<u8> {
        let path = std::env::temp_dir().join(format!(
            "clips-track-writer-{}-{start_frame}.mp4",
            std::process::id()
        ));
        let mixer = LiveAudioMixer::new(false, true, true, false).unwrap();
        // SAFETY: this thread makes the writer and is the only one to use it.
        unsafe {
            let settings = av_audio_output_settings().unwrap();
            let media = TrackMedia::Audio {
                sample_rate: SAMPLE_RATE,
            };
            let writer = TrackWriter::create(&path, media, &settings).unwrap();
            writer.start().unwrap();
            let mut frame = start_frame;
            for _ in 0..200 {
                let deadline = Instant::now() + READY_TIMEOUT;
                while !writer.is_ready() {
                    assert!(
                        Instant::now() < deadline,
                        "writer not ready for more sound{}",
                        av_writer_error_suffix(&writer.writer)
                    );
                    std::thread::sleep(Duration::from_millis(1));
                }
                let buffer = mixer
                    .build_sample_buffer(&[0.0; BUFFER_FRAMES * 2], frame)
                    .unwrap();
                writer.append(&buffer).unwrap();
                frame += BUFFER_FRAMES as i64;
            }
            writer
                .finish(frame as f64 / f64::from(SAMPLE_RATE))
                .unwrap();
            assert_eq!(writer.sink_failure(), None);
        }
        let file = std::fs::read(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        file
    }

    #[test]
    fn sound_keeps_its_recording_time() {
        // 5 ms in, sooner than the encoder's lead-in lasts, and 500 ms in.
        for start_frame in [240, 24_000] {
            let file = sound_file(start_frame);
            // The first fragment is the lead-in, then the sound: it decodes at
            // the sound's own time because the edit starts past the lead-in.
            assert_eq!(first_decode_time(&file), start_frame as u64);
            assert_eq!(edit_media_time(&file), Some(LEAD_IN_FRAMES));
        }
    }
}
