//! Keeps the audio of a meeting the Mac records itself.
//!
//! A huddle, WhatsApp or phone call the desktop transcribes used to keep only
//! its transcript: the PCM went straight into the speech model and was gone,
//! so the meeting page played 0:00 and every line was "you" or "them". Now the
//! microphone and the system audio are also written to two files while the
//! meeting runs, one per source, and on stop they become one stereo m4a:
//! microphone on the left, system audio on the right. The server transcribes
//! that file with speakers and uses the left channel to tell the owner's own
//! lines from everyone else's.
//!
//! Both tracks are kept on the meeting's wall clock: a source that starts late,
//! pauses, or drops buffers gets silence for the time it missed, so the two
//! channels stay in step with each other and with the transcript.
//!
//! Nothing here may disturb the transcript. A write that fails stops that
//! track; an encode or upload that fails is logged and the files are deleted.

use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Both tracks are stored as 16 kHz mono 16-bit PCM: enough for speech and
/// for the transcription model, a third of the size of 48 kHz.
pub(crate) const TRACK_RATE: u32 = 16_000;
const BYTES_PER_SAMPLE: u64 = 2;
/// A gap shorter than this is buffer jitter, not missing audio.
const GAP_PAD_SAMPLES: u64 = TRACK_RATE as u64 / 2;
/// A meeting longer than this keeps its first six hours of audio.
const MAX_TRACK_SAMPLES: u64 = 6 * 60 * 60 * TRACK_RATE as u64;
/// Shorter than this is a start that never really ran: nothing to upload.
const MIN_UPLOAD_SAMPLES: u64 = 2 * TRACK_RATE as u64;
/// Folders of a meeting that never finished (the app was killed) older than
/// this are removed when the next meeting starts.
const STALE_AFTER: Duration = Duration::from_secs(6 * 60 * 60);
const MIC_FILE: &str = "mic.pcm";
const SYSTEM_FILE: &str = "system.pcm";
const STEREO_FILE: &str = "meeting-audio.wav";
const OUTPUT_FILE: &str = "meeting-audio.m4a";
pub(crate) const UPLOAD_MIME_TYPE: &str = "video/mp4";

/// Linear resampler to [`TRACK_RATE`] that carries its position across
/// buffers, so a stream cut into callbacks resamples as one signal.
#[derive(Debug, Default)]
struct Resampler {
    src_rate: f64,
    /// Where the next output sample falls, in input samples from the start of
    /// the next buffer. -1.0..0.0 means between `prev` and that buffer's first.
    pos: f64,
    prev: f32,
    primed: bool,
}

impl Resampler {
    fn process(&mut self, input: &[f32], src_rate: f64, out: &mut Vec<i16>) {
        if input.is_empty() || !src_rate.is_finite() || src_rate < 1.0 {
            return;
        }
        if !self.primed || (src_rate - self.src_rate).abs() > 0.5 {
            self.src_rate = src_rate;
            self.pos = 0.0;
            self.prev = input[0];
            self.primed = true;
        }
        let step = self.src_rate / f64::from(TRACK_RATE);
        let len = input.len();
        let sample = |index: isize, prev: f32| -> f32 {
            if index < 0 {
                prev
            } else {
                input[index as usize]
            }
        };
        while self.pos <= (len - 1) as f64 {
            let base = self.pos.floor();
            let index = base as isize;
            let frac = (self.pos - base) as f32;
            let a = sample(index, self.prev);
            let b = if frac == 0.0 {
                a
            } else {
                sample(index + 1, self.prev)
            };
            out.push(to_i16(a + (b - a) * frac));
            self.pos += step;
        }
        self.pos -= len as f64;
        self.prev = input[len - 1];
    }
}

fn to_i16(sample: f32) -> i16 {
    let clamped = if sample.is_finite() {
        sample.clamp(-1.0, 1.0)
    } else {
        0.0
    };
    (clamped * f32::from(i16::MAX)) as i16
}

/// How much silence goes in front of a buffer that ends now, so the track
/// stays on the meeting clock. `written` and `now` are track samples.
pub(crate) fn silence_before(written: u64, now: u64, chunk: u64) -> u64 {
    let starts_at = now.saturating_sub(chunk);
    let gap = starts_at.saturating_sub(written);
    if gap >= GAP_PAD_SAMPLES {
        gap
    } else {
        0
    }
}

struct TrackState {
    out: Option<BufWriter<File>>,
    written: u64,
    resampler: Resampler,
}

/// One source's file. Written from that source's capture callback.
pub(crate) struct TrackWriter {
    source: &'static str,
    started: Instant,
    state: Mutex<TrackState>,
}

impl TrackWriter {
    fn create(source: &'static str, path: PathBuf, started: Instant) -> Result<Self, String> {
        let file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&path)
            .map_err(|e| format!("meeting audio {source} file could not be created: {e}"))?;
        Ok(Self {
            source,
            started,
            state: Mutex::new(TrackState {
                out: Some(BufWriter::with_capacity(256 * 1024, file)),
                written: 0,
                resampler: Resampler::default(),
            }),
        })
    }

    /// Adds a buffer of mono samples at `src_rate`.
    pub(crate) fn write(&self, frames: &[f32], src_rate: f64) {
        if frames.is_empty() {
            return;
        }
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        if state.out.is_none() {
            return;
        }
        let mut converted = Vec::with_capacity(
            (frames.len() as f64 * f64::from(TRACK_RATE) / src_rate.max(1.0)) as usize + 2,
        );
        state.resampler.process(frames, src_rate, &mut converted);
        if converted.is_empty() {
            return;
        }
        let now = (self.started.elapsed().as_secs_f64() * f64::from(TRACK_RATE)) as u64;
        let pad = silence_before(state.written, now, converted.len() as u64);
        let room = MAX_TRACK_SAMPLES.saturating_sub(state.written);
        let pad = pad.min(room);
        let keep = (converted.len() as u64).min(room - pad) as usize;
        let result = (|| -> std::io::Result<()> {
            let out = state.out.as_mut().expect("checked above");
            let zeros = [0_u8; 8192];
            let mut remaining = pad * BYTES_PER_SAMPLE;
            while remaining > 0 {
                let n = remaining.min(zeros.len() as u64) as usize;
                out.write_all(&zeros[..n])?;
                remaining -= n as u64;
            }
            let mut bytes = Vec::with_capacity(keep * 2);
            for sample in &converted[..keep] {
                bytes.extend_from_slice(&sample.to_le_bytes());
            }
            out.write_all(&bytes)
        })();
        match result {
            Ok(()) => {
                state.written += pad + keep as u64;
                if state.written >= MAX_TRACK_SAMPLES {
                    eprintln!(
                        "[meeting-audio] {} track reached its length limit; later audio is not kept",
                        self.source
                    );
                    close(&mut state);
                }
            }
            Err(error) => {
                eprintln!(
                    "[meeting-audio] {} track write failed, the meeting keeps its transcript only: {error}",
                    self.source
                );
                state.out = None;
            }
        }
    }

    /// Flushes and closes the file. Returns how many samples it holds.
    fn finish(&self) -> u64 {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        close(&mut state);
        state.written
    }
}

fn close(state: &mut TrackState) {
    if let Some(mut out) = state.out.take() {
        if let Err(error) = out.flush() {
            eprintln!("[meeting-audio] track flush failed: {error}");
        }
    }
}

struct Recorder {
    key: String,
    dir: PathBuf,
    mic: Arc<TrackWriter>,
    system: Arc<TrackWriter>,
}

fn recorder_slot() -> &'static Mutex<Option<Recorder>> {
    static SLOT: OnceLock<Mutex<Option<Recorder>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

/// The writers a meeting transcription that starts now should feed, if the
/// meeting keeps its audio.
pub(crate) fn active_tracks() -> Option<(Arc<TrackWriter>, Arc<TrackWriter>)> {
    recorder_slot()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
        .map(|recorder| (recorder.mic.clone(), recorder.system.clone()))
}

/// Only letters, digits and dashes, so a key can name a folder.
fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 80 && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn audio_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|dir| dir.join("meeting-audio"))
        .map_err(|e| format!("no cache folder for meeting audio: {e}"))
}

/// Folders whose removal failed. The next meeting start removes them again
/// whatever their age; after an app restart the age rule picks them up.
static FAILED_CLEANUPS: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// Removes a meeting-audio folder. Returns false when it is still on disk,
/// so a command can report that the audio was not cleaned up.
fn remove_dir_logged(dir: &Path) -> bool {
    let removed = match fs::remove_dir_all(dir) {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(error) => {
            eprintln!(
                "[meeting-audio] could not remove {}: {error}",
                dir.display()
            );
            false
        }
    };
    let mut failed = FAILED_CLEANUPS.lock().unwrap_or_else(PoisonError::into_inner);
    failed.retain(|path| path != dir);
    if !removed {
        failed.push(dir.to_path_buf());
    }
    removed
}

fn cleanup_failed_before(dir: &Path) -> bool {
    FAILED_CLEANUPS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .iter()
        .any(|path| path == dir)
}

fn remove_stale_dirs(root: &Path, keep: &str) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy() == keep {
            continue;
        }
        let stale = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .ok()
            .and_then(|modified| SystemTime::now().duration_since(modified).ok())
            .is_some_and(|age| age >= STALE_AFTER);
        if stale || cleanup_failed_before(&entry.path()) {
            remove_dir_logged(&entry.path());
        }
    }
}

fn discard_recorder(recorder: Recorder) {
    recorder.mic.finish();
    recorder.system.finish();
    remove_dir_logged(&recorder.dir);
}

/// Starts keeping a meeting's audio, or carries on with the same meeting after
/// a pause. Returns false when the user turned keeping meeting audio off.
#[tauri::command]
pub fn meeting_audio_begin(app: AppHandle, meeting_key: String) -> Result<bool, String> {
    if !valid_key(&meeting_key) {
        return Err("invalid meeting audio key".into());
    }
    let mut slot = recorder_slot()
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    if !crate::config::feature_config(&app).keep_meeting_audio {
        if let Some(previous) = slot.take() {
            discard_recorder(previous);
        }
        return Ok(false);
    }
    if slot
        .as_ref()
        .is_some_and(|current| current.key == meeting_key)
    {
        return Ok(true);
    }
    if let Some(previous) = slot.take() {
        discard_recorder(previous);
    }
    let root = audio_root(&app)?;
    remove_stale_dirs(&root, &meeting_key);
    let dir = root.join(&meeting_key);
    fs::create_dir_all(&dir).map_err(|e| format!("meeting audio folder: {e}"))?;
    let started = Instant::now();
    let created = TrackWriter::create("mic", dir.join(MIC_FILE), started).and_then(|mic| {
        TrackWriter::create("system", dir.join(SYSTEM_FILE), started).map(|system| (mic, system))
    });
    let (mic, system) = match created {
        Ok(tracks) => tracks,
        Err(error) => {
            remove_dir_logged(&dir);
            return Err(error);
        }
    };
    *slot = Some(Recorder {
        key: meeting_key,
        dir,
        mic: Arc::new(mic),
        system: Arc::new(system),
    });
    eprintln!("[meeting-audio] keeping this meeting's audio");
    Ok(true)
}

/// Drops a meeting's audio without uploading it: the meeting failed to
/// start, or the app is quitting. No key drops whatever is kept.
#[tauri::command]
pub fn meeting_audio_discard(meeting_key: Option<String>) {
    let mut slot = recorder_slot()
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let matches = slot.as_ref().is_some_and(|current| {
        meeting_key
            .as_deref()
            .map_or(true, |key| key == current.key)
    });
    if matches {
        if let Some(recorder) = slot.take() {
            discard_recorder(recorder);
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MeetingAudioUploadResult {
    pub uploaded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<String>,
    pub duration_ms: u64,
    pub bytes: u64,
    /// True when the local audio files could not be deleted afterwards.
    /// The next meeting's start retries the removal.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub cleanup_failed: bool,
}

impl MeetingAudioUploadResult {
    fn skipped(reason: &str) -> Self {
        Self {
            uploaded: false,
            skipped: Some(reason.to_owned()),
            duration_ms: 0,
            bytes: 0,
            cleanup_failed: false,
        }
    }

    fn with_cleanup(mut self, removed: bool) -> Self {
        self.cleanup_failed = !removed;
        self
    }
}

/// Whether a meeting's tracks are worth uploading, and how long the file is.
pub(crate) fn upload_length(mic_samples: u64, system_samples: u64) -> Option<u64> {
    let longest = mic_samples.max(system_samples);
    (longest >= MIN_UPLOAD_SAMPLES).then_some(longest)
}

fn samples_to_ms(samples: u64) -> u64 {
    samples * 1000 / u64::from(TRACK_RATE)
}

/// The 44-byte header of a 16-bit PCM WAV file at [`TRACK_RATE`].
pub(crate) fn wav_header(channels: u16, frames: u64) -> Result<[u8; 44], String> {
    let block_align = u32::from(channels) * BYTES_PER_SAMPLE as u32;
    let data_bytes = u32::try_from(frames * u64::from(block_align))
        .map_err(|_| "meeting audio is too long for one WAV file".to_owned())?;
    let mut header = [0_u8; 44];
    header[0..4].copy_from_slice(b"RIFF");
    header[4..8].copy_from_slice(&(36 + data_bytes).to_le_bytes());
    header[8..12].copy_from_slice(b"WAVE");
    header[12..16].copy_from_slice(b"fmt ");
    header[16..20].copy_from_slice(&16_u32.to_le_bytes());
    header[20..22].copy_from_slice(&1_u16.to_le_bytes());
    header[22..24].copy_from_slice(&channels.to_le_bytes());
    header[24..28].copy_from_slice(&TRACK_RATE.to_le_bytes());
    header[28..32].copy_from_slice(&(TRACK_RATE * block_align).to_le_bytes());
    header[32..34].copy_from_slice(&(block_align as u16).to_le_bytes());
    header[34..36].copy_from_slice(&16_u16.to_le_bytes());
    header[36..40].copy_from_slice(b"data");
    header[40..44].copy_from_slice(&data_bytes.to_le_bytes());
    Ok(header)
}

/// Writes the two mono tracks as one stereo WAV, microphone left and system
/// audio right, `frames` long: the shorter track ends in silence. Done here
/// because the bundled ffmpeg is a minimal build without raw PCM input or a
/// channel-merging filter.
fn interleave_tracks(mic: &Path, system: &Path, output: &Path, frames: u64) -> Result<(), String> {
    use std::io::{BufReader, Read};
    let open = |path: &Path| -> Result<Option<BufReader<File>>, String> {
        match File::open(path) {
            Ok(file) => Ok(Some(BufReader::with_capacity(256 * 1024, file))),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(format!("meeting audio track could not be read: {error}")),
        }
    };
    let mut left = open(mic)?;
    let mut right = open(system)?;
    let file = File::create(output).map_err(|e| format!("meeting audio WAV: {e}"))?;
    let mut out = BufWriter::with_capacity(256 * 1024, file);
    let write_err = |e: std::io::Error| format!("meeting audio WAV write failed: {e}");
    out.write_all(&wav_header(2, frames)?).map_err(write_err)?;

    // Fills `buf` from the track, then silence once the track has ended.
    fn fill(track: &mut Option<BufReader<File>>, buf: &mut [u8]) -> Result<(), String> {
        let mut filled = 0;
        if let Some(reader) = track.as_mut() {
            while filled < buf.len() {
                let n = reader
                    .read(&mut buf[filled..])
                    .map_err(|e| format!("meeting audio track read failed: {e}"))?;
                if n == 0 {
                    break;
                }
                filled += n;
            }
        }
        buf[filled..].fill(0);
        Ok(())
    }

    const BLOCK_FRAMES: u64 = 16_384;
    let mut l = vec![0_u8; (BLOCK_FRAMES * BYTES_PER_SAMPLE) as usize];
    let mut r = vec![0_u8; (BLOCK_FRAMES * BYTES_PER_SAMPLE) as usize];
    let mut stereo = Vec::with_capacity(l.len() * 2);
    let mut remaining = frames;
    while remaining > 0 {
        let n = remaining.min(BLOCK_FRAMES) as usize;
        let bytes = n * BYTES_PER_SAMPLE as usize;
        fill(&mut left, &mut l[..bytes])?;
        fill(&mut right, &mut r[..bytes])?;
        stereo.clear();
        for (a, b) in l[..bytes].chunks_exact(2).zip(r[..bytes].chunks_exact(2)) {
            stereo.extend_from_slice(a);
            stereo.extend_from_slice(b);
        }
        out.write_all(&stereo).map_err(write_err)?;
        remaining -= n as u64;
    }
    out.flush().map_err(write_err)
}

/// The ffmpeg arguments that turn the stereo WAV into the uploaded m4a.
pub(crate) fn encode_args(input: &Path, output: &Path) -> Vec<String> {
    let mut args: Vec<String> = ["-nostdin", "-hide_banner", "-v", "error", "-y", "-i"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    args.push(input.to_string_lossy().into_owned());
    args.extend(
        [
            "-vn",
            "-c:a",
            "aac",
            "-b:a",
            "64k",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
        ]
        .iter()
        .map(|s| s.to_string()),
    );
    args.push(output.to_string_lossy().into_owned());
    args
}

fn encode(dir: &Path, samples: u64) -> Result<PathBuf, String> {
    let mic = dir.join(MIC_FILE);
    let system = dir.join(SYSTEM_FILE);
    let stereo = dir.join(STEREO_FILE);
    interleave_tracks(&mic, &system, &stereo, samples)?;
    // The mono tracks are no longer needed once the stereo file exists.
    let _ = fs::remove_file(&mic);
    let _ = fs::remove_file(&system);
    let output = dir.join(OUTPUT_FILE);
    let ffmpeg = crate::native_screen::resolve_ffmpeg_path()
        .ok_or_else(|| "ffmpeg is not available to encode meeting audio".to_owned())?;
    let result = std::process::Command::new(ffmpeg)
        .args(encode_args(&stereo, &output))
        .output()
        .map_err(|e| format!("ffmpeg could not start: {e}"))?;
    let _ = fs::remove_file(&stereo);
    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!(
            "ffmpeg could not encode meeting audio: {}",
            stderr.chars().take(400).collect::<String>()
        ));
    }
    Ok(output)
}

/// Ends a meeting's audio: encodes it and uploads it to the meeting's
/// recording through the regular chunked upload. The files are deleted
/// whatever happens. An error leaves the transcript as it is.
#[tauri::command]
pub async fn meeting_audio_upload(
    meeting_key: String,
    server_url: String,
    recording_id: String,
    auth_token: Option<String>,
) -> Result<MeetingAudioUploadResult, String> {
    let recorder = {
        let mut slot = recorder_slot()
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if slot
            .as_ref()
            .is_some_and(|current| current.key == meeting_key)
        {
            slot.take()
        } else {
            None
        }
    };
    let Some(recorder) = recorder else {
        return Ok(MeetingAudioUploadResult::skipped("no-audio-kept"));
    };
    let mic_samples = recorder.mic.finish();
    let system_samples = recorder.system.finish();
    let dir = recorder.dir.clone();
    let Some(samples) = upload_length(mic_samples, system_samples) else {
        let removed = remove_dir_logged(&dir);
        return Ok(MeetingAudioUploadResult::skipped("too-short").with_cleanup(removed));
    };
    let duration_ms = samples_to_ms(samples);
    let result = async {
        let encode_dir = dir.clone();
        let output = tauri::async_runtime::spawn_blocking(move || encode(&encode_dir, samples))
            .await
            .map_err(|e| format!("meeting audio encode task failed: {e}"))??;
        let bytes = fs::metadata(&output)
            .map(|meta| meta.len())
            .map_err(|e| format!("encoded meeting audio is missing: {e}"))?;
        crate::native_screen::upload_media_file_buffered(
            &server_url,
            &recording_id,
            auth_token.as_deref().unwrap_or(""),
            &output,
            UPLOAD_MIME_TYPE,
            u128::from(duration_ms),
        )
        .await?;
        Ok::<u64, String>(bytes)
    }
    .await;
    let removed = remove_dir_logged(&dir);
    match result {
        Ok(bytes) => {
            eprintln!(
                "[meeting-audio] uploaded {duration_ms} ms of meeting audio ({bytes} bytes) to {recording_id}"
            );
            Ok(MeetingAudioUploadResult {
                uploaded: true,
                skipped: None,
                duration_ms,
                bytes,
                cleanup_failed: !removed,
            })
        }
        Err(error) => {
            eprintln!("[meeting-audio] upload for {recording_id} failed: {error}");
            if removed {
                Err(error)
            } else {
                Err(format!("{error} (the local meeting audio could not be deleted)"))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_rate_passes_samples_through() {
        let mut resampler = Resampler::default();
        let mut out = Vec::new();
        resampler.process(&[0.0, 0.5, -0.5, 1.0], 16_000.0, &mut out);
        resampler.process(&[0.25], 16_000.0, &mut out);
        assert_eq!(
            out,
            vec![0, i16::MAX / 2, -(i16::MAX / 2), i16::MAX, i16::MAX / 4]
        );
    }

    #[test]
    fn downsampling_keeps_the_rate_across_buffers() {
        let mut resampler = Resampler::default();
        let mut out = Vec::new();
        // One second of 48 kHz in uneven buffers is one second of 16 kHz.
        let second = vec![0.1_f32; 48_000];
        for chunk in second.chunks(441) {
            resampler.process(chunk, 48_000.0, &mut out);
        }
        assert!((out.len() as i64 - 16_000).abs() <= 1, "{}", out.len());
        assert!(out.iter().all(|&s| s == to_i16(0.1)));
    }

    #[test]
    fn upsampling_interpolates_between_buffers() {
        let mut resampler = Resampler::default();
        let mut out = Vec::new();
        resampler.process(&[0.0], 8_000.0, &mut out);
        resampler.process(&[1.0], 8_000.0, &mut out);
        // 0.0, halfway, 1.0
        assert_eq!(out, vec![0, to_i16(0.5), i16::MAX]);
    }

    #[test]
    fn clamps_and_zeroes_bad_samples() {
        assert_eq!(to_i16(2.0), i16::MAX);
        assert_eq!(to_i16(-2.0), -i16::MAX);
        assert_eq!(to_i16(f32::NAN), 0);
    }

    #[test]
    fn pads_only_real_gaps() {
        // On time, and jitter under half a second, adds nothing.
        assert_eq!(silence_before(16_000, 17_000, 1_000), 0);
        assert_eq!(silence_before(16_000, 20_000, 1_000), 0);
        // A source that starts two seconds late gets two seconds of silence.
        assert_eq!(silence_before(0, 33_000, 1_000), 32_000);
        // A pause of a minute is a minute of silence.
        assert_eq!(silence_before(16_000, 16_000 * 61 + 500, 500), 16_000 * 60);
        // A track ahead of the clock is never cut.
        assert_eq!(silence_before(50_000, 20_000, 1_000), 0);
    }

    #[test]
    fn upload_needs_two_seconds_of_audio() {
        assert_eq!(upload_length(0, 0), None);
        assert_eq!(upload_length(31_999, 0), None);
        assert_eq!(upload_length(32_000, 10), Some(32_000));
        assert_eq!(upload_length(100, 48_000), Some(48_000));
        assert_eq!(samples_to_ms(48_000), 3_000);
    }

    #[test]
    fn meeting_keys_name_a_folder() {
        assert!(valid_key("3f2a9c4e-1b2d-4c5e-8f90-123456789abc"));
        assert!(!valid_key(""));
        assert!(!valid_key("../escape"));
        assert!(!valid_key("a/b"));
        assert!(!valid_key(&"a".repeat(81)));
    }

    #[test]
    fn encodes_the_stereo_wav_to_m4a() {
        let args = encode_args(Path::new("/tmp/m/in.wav"), Path::new("/tmp/m/out.m4a"));
        let input = args.iter().position(|a| a == "-i").unwrap();
        assert_eq!(args[input + 1], "/tmp/m/in.wav");
        assert!(args.windows(2).any(|w| w[0] == "-c:a" && w[1] == "aac"));
        assert_eq!(args.last().unwrap(), "/tmp/m/out.m4a");
    }

    #[test]
    fn wav_header_describes_the_data() {
        let header = wav_header(2, 16_000).unwrap();
        assert_eq!(&header[0..4], b"RIFF");
        assert_eq!(u16::from_le_bytes([header[22], header[23]]), 2);
        assert_eq!(
            u32::from_le_bytes(header[24..28].try_into().unwrap()),
            16_000
        );
        assert_eq!(
            u32::from_le_bytes(header[40..44].try_into().unwrap()),
            64_000
        );
        assert!(wav_header(2, u64::from(u32::MAX)).is_err());
    }

    #[test]
    fn writer_keeps_tracks_on_the_meeting_clock() {
        let dir =
            std::env::temp_dir().join(format!("clips-meeting-audio-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let started = Instant::now() - Duration::from_secs(3);
        let writer = TrackWriter::create("mic", dir.join("mic.pcm"), started).unwrap();
        // The first buffer arrives three seconds in: silence fills the start.
        writer.write(&vec![0.5; 1_600], 16_000.0);
        let samples = writer.finish();
        assert!(samples >= 3 * 16_000 - 100, "{samples}");
        let bytes = fs::metadata(dir.join("mic.pcm")).unwrap().len();
        assert_eq!(bytes, samples * BYTES_PER_SAMPLE);
        // Writes after finishing are ignored.
        writer.write(&[0.5; 10], 16_000.0);
        assert_eq!(writer.finish(), samples);

        // The system track is shorter (missing here): it ends in silence,
        // and the microphone is the left channel.
        let wav = dir.join("out.wav");
        interleave_tracks(&dir.join("mic.pcm"), &dir.join("system.pcm"), &wav, samples).unwrap();
        let bytes = fs::read(&wav).unwrap();
        assert_eq!(bytes.len() as u64, 44 + samples * 4);
        let last = &bytes[bytes.len() - 4..];
        assert_eq!(i16::from_le_bytes([last[0], last[1]]), to_i16(0.5));
        assert_eq!(i16::from_le_bytes([last[2], last[3]]), 0);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_folder_whose_removal_failed_is_retried_on_the_next_start_whatever_its_age() {
        let root = std::env::temp_dir().join(format!("meeting-audio-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let old = root.join("previous-meeting");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("mic.pcm"), [0u8; 4]).unwrap();
        FAILED_CLEANUPS
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(old.clone());

        remove_stale_dirs(&root, "current-meeting");

        assert!(!old.exists());
        assert!(!cleanup_failed_before(&old));
        let _ = fs::remove_dir_all(&root);
    }
}
