//! The mic and system sound tracks of a rich recording: the microphone and the
//! sound of the Mac, each on its own as fMP4 AAC in `mic.mp4` and `system.mp4`.
//! Both are taken from the flattened recording's own ScreenCaptureKit stream
//! (see `custom_capture::audio_writer`), so they hold the same sound the
//! flattened recording mixes, at the same times; this module holds what can be
//! worked out without one.
//!
//! The file's media time is recording time: a buffer captured at host time `t`
//! sits at `t` less the flattened recording's first frame and the pipeline's
//! pause offset, the same retiming the flattened writer gives its own audio.
//! Sound from before the first frame, while paused or after Stop is left out,
//! so the sound after a pause follows straight on from the sound before it.

use super::rich_recording::TrackFinish;

pub(super) const MIC_TRACK_ID: &str = "mic";
pub(super) const MIC_TRACK_FILE: &str = "mic.mp4";
pub(super) const SYSTEM_TRACK_ID: &str = "system";
pub(super) const SYSTEM_TRACK_FILE: &str = "system.mp4";
pub(super) const AUDIO_TRACK_CONTENT_TYPE: &str = "audio/mp4";
/// AAC-LC at the flattened recording's own settings: the rate and channels
/// its stream is configured with.
pub(super) const AUDIO_TRACK_CODEC: &str = "mp4a.40.2";
pub(super) const AUDIO_TRACK_SAMPLE_RATE: u32 = 48_000;
pub(super) const AUDIO_TRACK_CHANNELS: u32 = 2;

/// Which of the stream's two sounds a track keeps.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum AudioSource {
    Mic,
    System,
}

impl AudioSource {
    pub(super) fn track_id(self) -> &'static str {
        match self {
            Self::Mic => MIC_TRACK_ID,
            Self::System => SYSTEM_TRACK_ID,
        }
    }

    pub(super) fn file(self) -> &'static str {
        match self {
            Self::Mic => MIC_TRACK_FILE,
            Self::System => SYSTEM_TRACK_FILE,
        }
    }
}

/// Places audio buffers on the file's timeline at their recording time. Like
/// the flattened writer, it takes a buffer only when it starts after the last
/// one did; one that starts before zero, captured before the first frame, is
/// left out.
#[derive(Debug, Default)]
pub(super) struct AudioTimeline {
    first_secs: Option<f64>,
    last_start_secs: Option<f64>,
    end_secs: Option<f64>,
    buffers: u64,
}

impl AudioTimeline {
    /// Whether a buffer starting at `recording_secs` goes in.
    pub(super) fn admits(&self, recording_secs: f64) -> bool {
        recording_secs >= 0.0
            && self
                .last_start_secs
                .is_none_or(|last| recording_secs > last)
    }

    /// The buffer starting at `secs` and lasting `duration_secs` was written.
    pub(super) fn commit(&mut self, secs: f64, duration_secs: f64) {
        self.first_secs.get_or_insert(secs);
        self.last_start_secs = Some(secs);
        let end = secs + duration_secs.max(0.0);
        self.end_secs = Some(self.end_secs.map_or(end, |last| last.max(end)));
        self.buffers += 1;
    }

    pub(super) fn buffers(&self) -> u64 {
        self.buffers
    }

    /// The first written buffer's recording milliseconds.
    pub(super) fn start_ms(&self) -> Option<u64> {
        self.first_secs
            .map(|secs| (secs * 1000.0).floor().max(0.0) as u64)
    }

    /// Where the file ends: the end of the sound in it.
    pub(super) fn end_secs(&self) -> Option<f64> {
        self.end_secs
    }
}

/// What an audio writer ended up with, read once it has closed.
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct AudioTrackReport {
    pub(super) init: Option<Vec<u8>>,
    pub(super) buffers: u64,
    pub(super) start_ms: Option<u64>,
    pub(super) end_ms: Option<u64>,
    /// Why the track stopped before the recording did, if it did.
    pub(super) stopped_early: Option<String>,
    pub(super) closed: bool,
}

/// An audio track's entry in the tracks finalize body.
pub(super) fn audio_track_finish(report: &AudioTrackReport, duration_ms: u64) -> TrackFinish {
    let start_ms = report.start_ms.unwrap_or(0).min(duration_ms);
    let end_ms = report
        .end_ms
        .unwrap_or(duration_ms)
        .clamp(start_ms, duration_ms);
    let mut meta = serde_json::json!({
        "sampleRate": AUDIO_TRACK_SAMPLE_RATE,
        "channels": AUDIO_TRACK_CHANNELS,
    });
    if let Some(init) = report.init.as_deref() {
        meta["initBytes"] = serde_json::json!(init.len());
        meta["codec"] = serde_json::json!(AUDIO_TRACK_CODEC);
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

    #[test]
    fn each_source_keeps_its_own_file() {
        assert_eq!(
            (AudioSource::Mic.track_id(), AudioSource::Mic.file()),
            ("mic", "mic.mp4")
        );
        assert_eq!(
            (AudioSource::System.track_id(), AudioSource::System.file()),
            ("system", "system.mp4")
        );
    }

    #[test]
    fn buffers_go_in_only_after_the_first_frame_and_always_advance() {
        let mut timeline = AudioTimeline::default();
        // Captured just before the first frame: left out.
        assert!(!timeline.admits(-0.004));
        assert!(timeline.admits(0.0));
        timeline.commit(0.012, 0.010_666);
        // One starting no later than the last one did is left out, as the
        // flattened writer drops a sample whose time doesn't advance.
        assert!(!timeline.admits(0.012));
        assert!(!timeline.admits(0.011));
        assert!(timeline.admits(0.0227));
        timeline.commit(0.0227, 0.010_666);
        assert_eq!(timeline.buffers(), 2);
        assert_eq!(timeline.start_ms(), Some(12));
        let end = timeline.end_secs().unwrap();
        assert!((end - 0.033_366).abs() < 1e-9, "{end}");
        assert_eq!(AudioTimeline::default().end_secs(), None);
    }

    #[test]
    fn the_audio_meta_names_the_codec_rate_and_channels() {
        let report = AudioTrackReport {
            init: Some(vec![0; 640]),
            buffers: 2_870,
            start_ms: Some(12),
            end_ms: Some(61_300),
            stopped_early: None,
            closed: true,
        };
        let finish = audio_track_finish(&report, 61_250);
        assert!(finish.complete);
        // Ends no later than the recording.
        assert_eq!((finish.start_ms, finish.end_ms), (12, 61_250));
        assert_eq!(
            finish.meta,
            serde_json::json!({
                "initBytes": 640,
                "codec": "mp4a.40.2",
                "sampleRate": 48_000,
                "channels": 2,
            })
        );

        // Stopped early: listed, but not complete, and ends when it stopped.
        let early = audio_track_finish(
            &AudioTrackReport {
                end_ms: Some(20_000),
                stopped_early: Some("the encoder fell behind".into()),
                ..report.clone()
            },
            61_250,
        );
        assert!(!early.complete);
        assert_eq!((early.start_ms, early.end_ms), (12, 20_000));

        // No init segment: nothing a reader can decode.
        let no_init = audio_track_finish(
            &AudioTrackReport {
                init: None,
                ..report
            },
            61_250,
        );
        assert!(!no_init.complete);
        assert_eq!(no_init.meta.get("codec"), None);
    }
}
