use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{ErrorKind, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(target_os = "macos")]
use core_graphics::display::{CGDisplay, CGPoint};
#[cfg(target_os = "macos")]
use screencapturekit::audio_devices::AudioInputDevice;
#[cfg(target_os = "macos")]
use screencapturekit::cg::CGRect;
#[cfg(target_os = "macos")]
use screencapturekit::recording_output::{
    SCRecordingOutput, SCRecordingOutputCodec, SCRecordingOutputConfiguration,
    SCRecordingOutputDelegate, SCRecordingOutputFileType,
};
#[cfg(target_os = "macos")]
use screencapturekit::shareable_content::SCShareableContent;
#[cfg(target_os = "macos")]
use screencapturekit::stream::{
    configuration::SCStreamConfiguration, content_filter::SCContentFilter,
    output_trait::SCStreamOutputTrait, output_type::SCStreamOutputType, sc_stream::SCStream,
};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

pub(crate) const QUICKTIME_RECORDING_MIME_TYPE: &str = "video/quicktime";
pub(crate) const MP4_RECORDING_MIME_TYPE: &str = "video/mp4";
/// Prefix tagging a capture-side finalize/write failure (segment-sink disk
/// write error, AVAssetWriter finalize failure/timeout) as opposed to a benign
/// `stop_capture` error. The upload path fails closed on this: the on-disk file
/// is incomplete even when its init-segment `moov` is present, so uploading
/// would silently publish a truncated clip.
const CAPTURE_FINALIZE_INCOMPLETE_PREFIX: &str = "capture finalize incomplete: ";
// Keep native chunks comfortably under serverless request/event limits.
const GCS_CHUNK_ALIGN_BYTES: usize = 256 * 1024;
const UPLOAD_CHUNK_BYTES: usize = 15 * GCS_CHUNK_ALIGN_BYTES; // 3.75 MiB
                                                              // Master switch for native transcoding/compression.
const COMPRESSION_ENABLED: bool = true;
const TRANSCODE_THRESHOLD_BYTES: u64 = 24 * 1024 * 1024;
const TARGET_UPLOAD_BYTES: u64 = 18 * 1024 * 1024;
// Mirror of the shared `MAX_UPLOAD_BYTES` limit (see
// `templates/clips/shared/upload-limits.ts`). Same default (2 GB) and same
// env var (CLIPS_MAX_UPLOAD_BYTES) so desktop and web stay in lockstep.
const DEFAULT_MAX_UPLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MIN_TRANSCODE_VIDEO_RATE_KBPS: u32 = 350;
const TRANSCODE_RATE_LIMIT_OVERHEAD_KBPS: f64 = 64.0;
const TRANSCODE_FRAME_RATE_LIMIT: u32 = 30;
const NORMALIZED_AUDIO_BITRATE_KBPS: u32 = 160;
const AUDIO_LOUDNESS_FILTER: &str = "loudnorm=I=-16:TP=-1.5:LRA=11";
const AUDIO_SIGNAL_MIN_MEAN_VOLUME_DB: f64 = -60.0;
const AUDIO_SIGNAL_MIN_MAX_VOLUME_DB: f64 = -30.0;
// When the mic is captured alongside system audio, ScreenCaptureKit lays the
// two sources out as the left/right channels of a single stereo track, which
// plays back stuck on one speaker. Force the input to stereo (mono sources
// duplicate), then sum both channels into each output so audio is centered.
// Runs before loudnorm so level is normalized on the corrected signal. Only
// applied when the mic was captured — a system-audio-only recording has real
// stereo content that must not be flattened.
const AUDIO_DOWNMIX_FILTER: &str =
    "aformat=channel_layouts=stereo,pan=stereo|FL=0.5*FL+0.5*FR|FR=0.5*FL+0.5*FR";
// Mild FFT denoise for native mic captures. Browser recordings already request
// WebRTC noise suppression; ScreenCaptureKit/screencapture mic capture does
// not, so reduce steady broadband room/mic hiss during the existing optimize
// step. Keep this conservative to avoid watery speech artifacts.
const AUDIO_DENOISE_FILTER: &str = "afftdn=nr=10:nf=-50:tn=1";
// loudnorm operates internally at 192 kHz and emits at 192 kHz; without an
// explicit output rate the AAC track ends up at 192 kHz and plays back slow.
const AUDIO_OUTPUT_SAMPLE_RATE: u32 = 48000;

// Pre-gain for mic-only native captures. ScreenCaptureKit records without
// WebRTC AGC (unlike Loom / the browser path), so speech often lands well
// below -16 LUFS. 12 dB before loudnorm matches Loom-ish perceptual loudness
// for MacBook mics; loudnorm still clamps true peaks at TP=-1.5.
const AUDIO_MIC_PREGAIN_FILTER: &str = "volume=12dB";
// After the mic+system centered downmix (0.5*L+0.5*R) each source is ~
// 6 dB quieter. Restore energy before loudnorm so dual-capture clips are not
// systematically quieter than mic-only. Dual still mixes two sources so peaks
// may compress more under loudnorm than mic-only — by design when both sides
// compete for the same LUFS budget.
const AUDIO_DOWNMIX_MAKEUP_FILTER: &str = "volume=6dB";

// Loudness normalization, optionally preceded by the centered-stereo downmix
// that repairs the mic+system L/R split and denoise for native mic captures.
// Pair with `-ar AUDIO_OUTPUT_SAMPLE_RATE` so loudnorm's 192 kHz output is
// resampled back.
fn audio_filter_chain(downmix: bool, denoise: bool, mic_pregain: bool) -> String {
    let mut filters = Vec::new();
    if downmix {
        filters.push(AUDIO_DOWNMIX_FILTER);
        // Undo pan attenuation; do not also apply mic-only pregain here —
        // system audio would get a double boost.
        filters.push(AUDIO_DOWNMIX_MAKEUP_FILTER);
    }
    if denoise {
        filters.push(AUDIO_DENOISE_FILTER);
    }
    if mic_pregain {
        filters.push(AUDIO_MIC_PREGAIN_FILTER);
    }
    filters.push(AUDIO_LOUDNESS_FILTER);
    filters.join(",")
}
const NATIVE_CAPTURE_MAX_LONG_EDGE: u32 = 1280;
const NATIVE_CAPTURE_FPS: u32 = 24;

// Custom ScreenCaptureKit capture engine: AVAssetWriter fragmented-MP4
// writer, live audio mixer, and the AVFoundation FFI glue live in a child
// module; this file keeps session orchestration, upload, and recovery.
#[cfg(target_os = "macos")]
mod custom_capture;
#[cfg(target_os = "macos")]
use custom_capture::{
    start_custom_screencapturekit_backend_at, CustomCaptureResume, CustomScreenCaptureWriter,
};
// Live chunk uploader: tails the fragmented MP4 and streams it during
// recording; attached/finalized/abandoned from the session logic here.
#[cfg(target_os = "macos")]
mod live_upload;
#[cfg(target_os = "macos")]
use live_upload::{attach_live_uploader_to_session, LiveUpload};
const AVCONVERT_PATH: &str = "/usr/bin/avconvert";
const AVCONVERT_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const FFMPEG_TIMEOUT: Duration = Duration::from_secs(8 * 60);
const FFMPEG_AUDIO_PROBE_TIMEOUT: Duration = Duration::from_secs(90);
const FFMPEG_CANDIDATE_PATHS: &[&str] = &[
    "ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/opt/local/bin/ffmpeg",
];
const PENDING_UPLOADS_DIR: &str = "pending-recording-uploads";
const CLIP_DRAFTS_DIR: &str = "Drafts";
const THUMBNAIL_MIME_TYPE: &str = "image/jpeg";
const THUMBNAIL_MAX_BYTES: u64 = 2 * 1024 * 1024;
const THUMBNAIL_WIDTH: &str = "1280";
const SIPS_PATH: &str = "/usr/bin/sips";
// Minimum free space required to start recording; below this we hard-block.
pub(crate) const DISK_SPACE_BLOCK_BYTES: u64 = 500 * 1024 * 1024;
// Free space below this at start time is logged as a warning but not blocked.
const DISK_SPACE_WARN_BYTES: u64 = 2 * 1024 * 1024 * 1024;
// Mid-recording warning threshold (emits clips:disk-space-warning).
const DISK_MONITOR_WARN_BYTES: u64 = 1024 * 1024 * 1024;
// Mid-recording critical threshold (emits clips:disk-space-critical).
const DISK_MONITOR_CRITICAL_BYTES: u64 = 250 * 1024 * 1024;
// How often the background monitor checks free space.
const DISK_MONITOR_INTERVAL_SECS: u64 = 30;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NativeUploadMode {
    Buffered,
    Streaming,
}

impl NativeUploadMode {
    fn from_option(value: Option<String>) -> Self {
        match value.as_deref() {
            Some("streaming") => Self::Streaming,
            _ => Self::Buffered,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Buffered => "buffered",
            Self::Streaming => "streaming",
        }
    }

    fn from_reset_response(body: &str) -> Self {
        let value = serde_json::from_str::<serde_json::Value>(body).ok();
        let upload_mode = value
            .as_ref()
            .and_then(|value| value.get("uploadMode"))
            .and_then(serde_json::Value::as_str)
            .map(str::to_string);
        Self::from_option(upload_mode)
    }
}

#[cfg(test)]
mod native_upload_mode_tests {
    use super::NativeUploadMode;

    #[test]
    fn uses_streaming_mode_when_retry_session_was_recreated() {
        assert_eq!(
            NativeUploadMode::from_reset_response(r#"{"uploadMode":"streaming"}"#),
            NativeUploadMode::Streaming,
        );
        assert_eq!(
            NativeUploadMode::from_reset_response(r#"{"ok":true}"#),
            NativeUploadMode::Buffered,
        );
    }
}

#[derive(Default)]
pub struct NativeFullscreenRecordingState {
    inner: Mutex<Option<NativeFullscreenSession>>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
pub struct NativeCaptureRegion {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

struct NativeFullscreenSession {
    /// Active capture backend. `None` while paused — pause finalizes the
    /// current segment and tears the backend down so the OS stops capturing.
    backend: Option<NativeFullscreenBackend>,
    /// Path the caller expects the final (single-file) recording at. When
    /// only one segment was recorded, this points directly at it. When the
    /// session was paused / resumed at least once, the segments live next
    /// to it (`{stem}-segN.mp4`) and are concatenated into `path` on stop.
    path: PathBuf,
    mime_type: &'static str,
    started_at: Instant,
    width: Option<u32>,
    height: Option<u32>,
    /// All finalized segment file paths in capture order. The currently
    /// active backend writes into the LAST entry (it's added at start /
    /// resume time before the backend begins capturing).
    segments: Vec<PathBuf>,
    /// Total time spent paused so far. Subtracted from elapsed wall-clock
    /// time when reporting `duration_ms`, so the upload metadata matches
    /// the actual recorded content rather than wall-clock time.
    paused_total: Duration,
    /// Start time for the segment currently being captured. Used to subtract
    /// unrecoverable segment time when ScreenCaptureKit fails finalization
    /// but earlier segments are still playable.
    current_segment_started_at: Instant,
    /// Recorded time lost because a finalized segment was unusable and had to
    /// be skipped during recovery.
    lost_segment_duration: Duration,
    lost_segment_count: u32,
    /// When the current pause began, if paused. Folded into `paused_total`
    /// on resume.
    paused_at: Option<Instant>,
    /// Info needed to spin up a fresh SCStream / screencapture child on
    /// resume so the new segment captures the same source with the same
    /// audio configuration as the initial start.
    restart: RestartInfo,
    /// True between `warm` and `begin`: the SCStream is capturing (mic
    /// warming up) but the recording output hasn't been attached yet, so
    /// nothing is written to disk. `begin` attaches it and flips this false.
    pending_recording_output: bool,
    custom_pipeline: bool,
    /// Active live-upload task: streams the growing fragmented MP4 to the
    /// server in chunks during recording (custom pipeline only). `None` when
    /// live upload is disabled or for local-only recordings.
    #[cfg(target_os = "macos")]
    live_upload: Option<LiveUpload>,
    /// True if a live uploader was ever attached. If the uploader is later
    /// abandoned (e.g. pause makes the recording multi-segment), the stop path
    /// must reset already-uploaded chunks before re-uploading the whole file.
    had_live_upload: bool,
    /// Stop flag for the background disk-space monitor thread. Set to true
    /// when the session is finalized or discarded so the thread exits cleanly.
    disk_monitor_stop: Option<Arc<AtomicBool>>,
}

#[derive(Clone)]
struct RestartInfo {
    safe_id: String,
    include_audio: bool,
    capture_system_audio: bool,
    /// True only when the final media file itself contains microphone audio.
    /// ScreenCaptureKit microphone muxing is intentionally disabled on macOS
    /// 15 because SCRecordingOutput can hang finalization and leave no moov.
    mic_captured_in_file: bool,
    mic_device_id: Option<String>,
    mic_device_label: Option<String>,
    /// Monotonic counter feeding the per-segment filename suffix.
    segment_counter: u32,
    /// CGDirectDisplayID of the display to record. None = first available.
    target_display_id: Option<u32>,
    /// Normalized display-relative capture rectangle for Region recordings.
    capture_region: Option<NativeCaptureRegion>,
}

pub(crate) enum NativeFullscreenBackend {
    Screencapture {
        child: Child,
    },
    #[cfg(target_os = "macos")]
    ScreenCaptureKit {
        stream: SCStream,
        recording: SCRecordingOutput,
        finish: Arc<RecordingFinish>,
        /// Set true once the first microphone sample buffer is delivered.
        /// Used by the warm/begin split: the recording output is attached
        /// only after the mic is live so the clip doesn't start with a
        /// silent second while ScreenCaptureKit's mic pipeline spins up.
        /// `None` when the recording has no microphone input.
        mic_ready: Option<Arc<AtomicBool>>,
        /// Number of microphone sample buffers observed before/after attach.
        /// This is diagnostic only; it lets the tray log distinguish "SCK
        /// never saw mic samples" from "samples existed but encoded silent".
        mic_sample_count: Option<Arc<AtomicU64>>,
    },
    #[cfg(target_os = "macos")]
    CustomScreenCaptureKit {
        /// Behind `Arc<Mutex>` because the capture watchdog can swap in a
        /// rebuilt stream after an interruption while the stop path also needs
        /// to reach it. Lock is only held for brief `stop_capture`/swap calls.
        stream: Arc<Mutex<SCStream>>,
        writer: CustomScreenCaptureWriter,
        mic_ready: Option<Arc<AtomicBool>>,
        recording_enabled: Arc<AtomicBool>,
        /// Signals the watchdog thread to stop supervising (and never rebuild
        /// the stream again) as the session is being torn down.
        watchdog_shutdown: Arc<AtomicBool>,
        /// Handles for the soft pause/resume path: stop only the capture
        /// source on pause and splice a fresh SCStream onto the same writer on
        /// resume, keeping one continuous append-only file so live upload is
        /// never interrupted.
        resume: CustomCaptureResume,
    },
}

/// Safety net for the `screencapture` fallback: if a session carrying a live
/// `screencapture` child is ever dropped without going through
/// `stop_native_recording`/`stop_screencapture` (app quit, crash unwind, or an
/// error path that discards the session), make sure the child process doesn't
/// keep recording and writing to disk after we've lost track of it. This is a
/// best-effort hard kill (no SIGINT grace period) since a `Drop` impl is not
/// the place to block on graceful finalization.
impl Drop for NativeFullscreenBackend {
    fn drop(&mut self) {
        match self {
            NativeFullscreenBackend::Screencapture { child } => {
                if matches!(child.try_wait(), Ok(None)) {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
            // Guarantee the capture watchdog stops supervising even if a session
            // is dropped without going through the normal stop path (panic
            // unwind, stale-session displacement). Otherwise it would keep the
            // SCStream alive and rebuild it forever.
            #[cfg(target_os = "macos")]
            NativeFullscreenBackend::CustomScreenCaptureKit {
                watchdog_shutdown, ..
            } => {
                watchdog_shutdown.store(true, Ordering::SeqCst);
            }
            #[cfg(target_os = "macos")]
            NativeFullscreenBackend::ScreenCaptureKit { .. } => {}
        }
    }
}

/// `SCRecordingOutput` finalizes the MP4 *asynchronously*: after
/// `remove_recording_output()` / `stop_capture()` it still has to flush its
/// last buffered sample fragment and write the `moov` atom, then it calls
/// `recording_did_finish` (or `recording_did_fail`). If we move the file
/// before that callback we lose the trailing fragment — a consistent
/// multi-second tail truncation with the head intact. This handle lets the
/// stop path block on that callback (bounded by a timeout) before the file
/// is moved.
#[cfg(target_os = "macos")]
pub(crate) struct RecordingFinish {
    /// `None` while recording; `Some(Ok)` finished; `Some(Err)` failed.
    state: Mutex<Option<Result<(), String>>>,
    cv: Condvar,
}

#[cfg(target_os = "macos")]
impl RecordingFinish {
    fn new() -> Self {
        Self {
            state: Mutex::new(None),
            cv: Condvar::new(),
        }
    }

    fn signal(&self, outcome: Result<(), String>) {
        if let Ok(mut guard) = self.state.lock() {
            if guard.is_none() {
                *guard = Some(outcome);
                self.cv.notify_all();
            }
        }
    }

    /// Block until the recording output reports finished/failed, or `timeout`
    /// elapses. Returns the terminal outcome when one was observed.
    fn wait(&self, timeout: Duration) -> Option<Result<(), String>> {
        let Ok(guard) = self.state.lock() else {
            return None;
        };
        let (guard, result) = self
            .cv
            .wait_timeout_while(guard, timeout, |state| state.is_none())
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if result.timed_out() && guard.is_none() {
            return None;
        }
        (*guard).clone()
    }
}

/// Bridges `SCRecordingOutput`'s async finalize callbacks into a
/// [`RecordingFinish`] the stop path can wait on.
#[cfg(target_os = "macos")]
struct FinishDelegate {
    finish: Arc<RecordingFinish>,
}

#[cfg(target_os = "macos")]
impl SCRecordingOutputDelegate for FinishDelegate {
    fn recording_did_fail(&self, error: String) {
        self.finish.signal(Err(error));
    }

    fn recording_did_finish(&self) {
        self.finish.signal(Ok(()));
    }
}

#[derive(Clone)]
struct PreparedRecordingFile {
    path: PathBuf,
    mime_type: String,
    bytes: u64,
    temporary: bool,
    locally_transcoded: bool,
}

pub(crate) fn format_mb(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
}

/// Returns free bytes on the volume containing `path`, or `None` on error.
#[cfg(target_os = "macos")]
pub(crate) fn free_disk_bytes(path: &Path) -> Option<u64> {
    use std::ffi::CString;
    let c_path = CString::new(path.to_str()?).ok()?;
    let mut stat: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c_path.as_ptr(), &mut stat) } == 0 {
        Some(stat.f_bavail as u64 * stat.f_frsize as u64)
    } else {
        None
    }
}

/// Spawns a background thread that checks free disk space every
/// [`DISK_MONITOR_INTERVAL_SECS`] seconds and emits warning/critical events
/// to the frontend. Returns a stop flag the caller sets to shut the thread down.
#[cfg(target_os = "macos")]
fn spawn_disk_monitor(app: AppHandle, recording_path: PathBuf) -> Arc<AtomicBool> {
    // Use the parent directory for the statvfs call. The recording file itself
    // may not exist yet (warm/begin path defers writing until after countdown),
    // and statvfs returns ENOENT on non-existent paths. The parent dir is the
    // pending-uploads folder, which always exists.
    let check_path = recording_path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or(recording_path);
    let stop = Arc::new(AtomicBool::new(false));
    let stop_clone = Arc::clone(&stop);
    std::thread::spawn(move || {
        let tick_ms = 500u64;
        let ticks_per_check = (DISK_MONITOR_INTERVAL_SECS * 1000) / tick_ms;
        // Start at ticks_per_check so the first iteration runs an immediate check
        // rather than waiting the full 30s interval. Subsequent checks are every 30s.
        let mut ticks = ticks_per_check;
        // True once a warning/critical event has been emitted; used to gate the
        // recovery ok event so we only emit it on actual state transitions.
        let mut was_elevated = false;
        loop {
            std::thread::sleep(Duration::from_millis(tick_ms));
            if stop_clone.load(Ordering::Relaxed) {
                return;
            }
            ticks += 1;
            if ticks < ticks_per_check {
                continue;
            }
            ticks = 0;
            if let Some(free) = free_disk_bytes(&check_path) {
                let free_mb = free / (1024 * 1024);
                if free < DISK_MONITOR_CRITICAL_BYTES {
                    eprintln!(
                        "[clips-tray] disk space critical during recording: {} free",
                        format_mb(free)
                    );
                    let _ = app.emit(
                        "clips:disk-space-critical",
                        serde_json::json!({ "freeMb": free_mb }),
                    );
                    was_elevated = true;
                } else if free < DISK_MONITOR_WARN_BYTES {
                    eprintln!(
                        "[clips-tray] disk space low during recording: {} free",
                        format_mb(free)
                    );
                    let _ = app.emit(
                        "clips:disk-space-warning",
                        serde_json::json!({ "freeMb": free_mb }),
                    );
                    was_elevated = true;
                } else if was_elevated {
                    // Space recovered — notify the UI to clear its warning.
                    let _ = app.emit(
                        "clips:disk-space-ok",
                        serde_json::json!({ "freeMb": free_mb }),
                    );
                    was_elevated = false;
                }
            }
        }
    });
    stop
}

fn emit_native_upload_progress(
    app: &AppHandle,
    stage: &str,
    message: impl Into<String>,
    detail: Option<String>,
    progress: Option<f32>,
) {
    let _ = app.emit(
        "clips:native-upload-progress",
        serde_json::json!({
            "stage": stage,
            "message": message.into(),
            "detail": detail,
            "progress": progress,
        }),
    );
}

fn clear_recording_active(app: &AppHandle) {
    let mut changed = false;
    if let Some(state) = app.try_state::<crate::state::RecordingActive>() {
        if let Ok(mut active) = state.0.lock() {
            if *active {
                *active = false;
                changed = true;
            }
        }
    }
    if changed {
        crate::tray::rebuild_tray_menu(app);
    }
}

static LAST_NATIVE_UPLOAD_FINISHED: OnceLock<Mutex<Option<NativeUploadFinishedPayload>>> =
    OnceLock::new();
static CLAIMED_NATIVE_UPLOAD_OPEN: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn last_native_upload_finished() -> &'static Mutex<Option<NativeUploadFinishedPayload>> {
    LAST_NATIVE_UPLOAD_FINISHED.get_or_init(|| Mutex::new(None))
}

fn claimed_native_upload_open() -> &'static Mutex<Option<String>> {
    CLAIMED_NATIVE_UPLOAD_OPEN.get_or_init(|| Mutex::new(None))
}

fn reset_native_upload_completion_state() {
    if let Ok(mut last) = last_native_upload_finished().lock() {
        *last = None;
    }
    if let Ok(mut claimed) = claimed_native_upload_open().lock() {
        *claimed = None;
    }
}

#[tauri::command]
pub fn native_fullscreen_take_upload_finished() -> Option<NativeUploadFinishedPayload> {
    last_native_upload_finished()
        .lock()
        .ok()
        .and_then(|mut last| last.take())
}

#[tauri::command]
pub fn native_fullscreen_claim_upload_open(recording_id: String) -> bool {
    let Ok(mut claimed) = claimed_native_upload_open().lock() else {
        return true;
    };
    if claimed.as_deref() == Some(recording_id.as_str()) {
        return false;
    }
    *claimed = Some(recording_id);
    true
}

fn emit_native_upload_finished(
    app: &AppHandle,
    server_url: &str,
    recording_id: &str,
    ok: bool,
    error: Option<String>,
    local_file_path: Option<&Path>,
) {
    clear_recording_active(app);
    let base = server_url.trim_end_matches('/');
    let payload = NativeUploadFinishedPayload {
        recording_id: recording_id.to_string(),
        ok,
        view_url: format!("{base}/r/{recording_id}"),
        error,
        local_file_path: local_file_path.map(|path| path.to_string_lossy().to_string()),
    };
    if let Ok(mut last) = last_native_upload_finished().lock() {
        *last = Some(payload.clone());
    }
    let _ = app.emit("clips:native-upload-finished", payload);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedNativeRecording {
    recording_id: String,
    server_url: String,
    file_path: PathBuf,
    #[serde(default)]
    segment_paths: Vec<PathBuf>,
    mime_type: String,
    duration_ms: u128,
    width: Option<u32>,
    height: Option<u32>,
    bytes: u64,
    has_audio: bool,
    // Whether the mic was captured. Drives denoise + (with system audio) the
    // centered-stereo downmix repair for the mic+system L/R split. Defaults to
    // false for recordings queued before this field existed so their audio is
    // left untouched.
    #[serde(default)]
    mic_captured: bool,
    // Whether system audio was captured alongside the mic. Needed to decide
    // downmix vs mic-only pregain on retry uploads. Defaults to false for
    // older pending files (safe: skips downmix that would attenuate mic-only).
    #[serde(default)]
    system_audio_captured: bool,
    has_camera: bool,
    saved_at: String,
    last_attempt_at: Option<String>,
    last_error: Option<String>,
    retry_count: u32,
    #[serde(default)]
    custom_pipeline: bool,
    /// True when the SCK finalization callback reported an error, meaning the
    /// MP4 is missing its moov atom and cannot be recovered by retrying.
    #[serde(default)]
    corrupt: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingNativeRecording {
    recording_id: String,
    server_url: String,
    folder_path: String,
    duration_ms: u128,
    width: Option<u32>,
    height: Option<u32>,
    bytes: u64,
    has_audio: bool,
    has_camera: bool,
    saved_at: String,
    last_attempt_at: Option<String>,
    last_error: Option<String>,
    retry_count: u32,
    corrupt: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFullscreenStartInfo {
    recording_id: String,
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFullscreenUploadResult {
    recording_id: String,
    duration_ms: u128,
    width: Option<u32>,
    height: Option<u32>,
    bytes: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NativeUploadFinishedPayload {
    recording_id: String,
    ok: bool,
    view_url: String,
    error: Option<String>,
    local_file_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeLocalRecordingFile {
    role: String,
    path: String,
    file_name: String,
    mime_type: String,
    bytes: u64,
    duration_ms: u128,
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFullscreenSaveResult {
    recording_id: String,
    folder_path: String,
    file: NativeLocalRecordingFile,
}

impl From<&SavedNativeRecording> for PendingNativeRecording {
    fn from(saved: &SavedNativeRecording) -> Self {
        Self {
            recording_id: saved.recording_id.clone(),
            server_url: saved.server_url.clone(),
            folder_path: saved
                .file_path
                .parent()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_default(),
            duration_ms: saved.duration_ms,
            width: saved.width,
            height: saved.height,
            bytes: saved.bytes,
            has_audio: saved.has_audio,
            has_camera: saved.has_camera,
            saved_at: saved.saved_at.clone(),
            last_attempt_at: saved.last_attempt_at.clone(),
            last_error: saved.last_error.clone(),
            retry_count: saved.retry_count,
            corrupt: saved.corrupt,
        }
    }
}

#[tauri::command]
pub async fn native_fullscreen_recording_available() -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        Ok(std::path::Path::new("/usr/sbin/screencapture").exists())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(false)
    }
}

/// Longest the `begin` phase waits for the microphone's first sample before
/// attaching the recording output anyway. The mic has usually warmed during
/// the countdown by now; this is just a safety net so a slow/denied mic can't
/// stall the start.
#[cfg(target_os = "macos")]
const MIC_WARM_TIMEOUT_MS: u64 = 250;

/// Acquire a backend (ScreenCaptureKit, or the screencapture fallback) and
/// store it as the active session. Shared by the immediate-start command and
/// the no-warm branch of `begin`.
///
/// When `defer_recording_output` is true the SCStream is started without the
/// recording output attached (warm phase) — and on SCK failure the error is
/// returned rather than falling back to screencapture, because that child
/// records immediately and would capture the countdown.
#[cfg(target_os = "macos")]
fn start_native_session_locked(
    app: &AppHandle,
    state: &State<'_, NativeFullscreenRecordingState>,
    recording_id: &str,
    include_audio: bool,
    capture_system_audio: bool,
    mic_device_id: Option<String>,
    mic_device_label: Option<String>,
    capture_region: Option<NativeCaptureRegion>,
    defer_recording_output: bool,
) -> Result<NativeFullscreenStartInfo, String> {
    let safe_id = sanitize_recording_id(recording_id);
    reset_native_upload_completion_state();
    let has_specific_mic = mic_device_id
        .as_deref()
        .is_some_and(|v| !v.trim().is_empty())
        || mic_device_label
            .as_deref()
            .is_some_and(|v| !v.trim().is_empty());
    let session = match start_screencapturekit_recording(
        app,
        &safe_id,
        include_audio,
        capture_system_audio,
        mic_device_id.as_deref(),
        mic_device_label.as_deref(),
        capture_region,
        defer_recording_output,
    ) {
        Ok(session) => session,
        Err(sck_err) => {
            if defer_recording_output {
                return Err(sck_err);
            }
            if include_audio {
                let mic_description = if has_specific_mic {
                    "the selected microphone"
                } else {
                    "the resolved default microphone"
                };
                return Err(format!(
                    "ScreenCaptureKit recording failed before it could use {mic_description} ({sck_err}). Clips did not fall back to macOS screencapture because that would ignore the requested input."
                ));
            }
            eprintln!(
                "[clips-tray] ScreenCaptureKit recording unavailable; falling back to screencapture: {sck_err}"
            );
            start_screencapture_recording(
                app,
                &safe_id,
                include_audio,
                capture_system_audio,
                capture_region,
            )
            .map_err(|fallback_err| {
                format!(
                    "ScreenCaptureKit recording failed ({sck_err}); screencapture fallback failed ({fallback_err})"
                )
            })?
        }
    };
    let width = session.width;
    let height = session.height;

    let previous = {
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        guard.take()
    };
    if let Some(mut previous) = previous {
        discard_session(&mut previous);
    }

    {
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        *guard = Some(session);
    }

    Ok(NativeFullscreenStartInfo {
        recording_id: recording_id.to_string(),
        width,
        height,
    })
}

/// Phase 1 of the warm/begin start. Starts ScreenCaptureKit capture with the
/// recording output DEFERRED so the microphone pipeline warms up (its first
/// sample lands ~1s after capture begins) without that silent second being
/// written to the file. Meant to be called during the countdown.
///
/// Best-effort: warming is skipped or quietly abandoned (no mic, non-macOS, or
/// ScreenCaptureKit unavailable) and `begin` then performs a normal immediate
/// start — so failures here never block recording.
#[tauri::command]
pub async fn native_fullscreen_recording_warm(
    app: AppHandle,
    state: State<'_, NativeFullscreenRecordingState>,
    recording_id: String,
    include_audio: bool,
    capture_system_audio: bool,
    mic_device_id: Option<String>,
    mic_device_label: Option<String>,
    capture_region: Option<NativeCaptureRegion>,
) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (
            app,
            state,
            recording_id,
            include_audio,
            capture_system_audio,
            mic_device_id,
            mic_device_label,
            capture_region,
        );
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        // Only the mic introduces a warm-up gap; with mic off there's nothing
        // to pre-warm, so `begin` just starts normally. SCK failures are
        // swallowed too — `begin` detects the absent warm session and falls
        // back to an immediate start, so warming is always best-effort.
        if include_audio {
            if let Err(err) = start_native_session_locked(
                &app,
                &state,
                &recording_id,
                include_audio,
                capture_system_audio,
                mic_device_id,
                mic_device_label,
                capture_region,
                true,
            ) {
                eprintln!(
                    "[clips-tray] microphone pre-warm unavailable; will start normally at begin: {err}"
                );
            }
        }
        Ok(())
    }
}

/// Phase 2 of the warm/begin start. If a warmed (deferred) session exists,
/// waits for the microphone's first sample, attaches the recording output —
/// so the file starts with both video and mic live — and rebaselines the
/// duration clock to this moment. Otherwise performs a normal immediate start.
#[tauri::command]
pub async fn native_fullscreen_recording_begin(
    app: AppHandle,
    state: State<'_, NativeFullscreenRecordingState>,
    recording_id: String,
    include_audio: bool,
    capture_system_audio: bool,
    mic_device_id: Option<String>,
    mic_device_label: Option<String>,
    capture_region: Option<NativeCaptureRegion>,
    // Local-only recordings never upload, so their live-upload creds stay
    // unresolved regardless of what the shared session holds.
    local_only: Option<bool>,
    has_camera: Option<bool>,
) -> Result<NativeFullscreenStartInfo, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (
            app,
            state,
            recording_id,
            include_audio,
            capture_system_audio,
            mic_device_id,
            mic_device_label,
            capture_region,
            local_only,
            has_camera,
        );
        return Err("Native full-screen recording is currently macOS-only.".into());
    }

    #[cfg(target_os = "macos")]
    {
        // Live-upload credentials (server URL + cookie + auth token) live in the
        // shared session state the renderer keeps warm via
        // `meetings_watcher_set_session`. Read them from there instead of taking
        // them as command args. Local-only recordings never upload, so leave
        // their creds `None` regardless of what the session currently holds.
        let (server_url, auth_token, cookie) = if local_only.unwrap_or(false) {
            (None, None, None)
        } else {
            let snapshot = app
                .try_state::<crate::meetings_watcher::MeetingsWatcherState>()
                .map(|s| s.session_snapshot())
                .unwrap_or_default();
            (
                snapshot.server_url,
                snapshot.auth_token,
                snapshot.session_cookie,
            )
        };

        // Best-effort, non-blocking: keep the server-controlled feature flag
        // cache warm using the session creds this call already has. Never
        // delays recording start — a stale/default cache is used for THIS
        // recording if the fetch hasn't landed yet; the result applies to
        // the next one.
        crate::remote_flags::spawn_refresh(server_url.clone(), cookie.clone(), auth_token.clone());

        let is_warmed = {
            let guard = state.inner.lock().map_err(|e| e.to_string())?;
            guard
                .as_ref()
                .map(|s| s.pending_recording_output)
                .unwrap_or(false)
        };
        if !is_warmed {
            let info = start_native_session_locked(
                &app,
                &state,
                &recording_id,
                include_audio,
                capture_system_audio,
                mic_device_id,
                mic_device_label,
                capture_region,
                false,
            )?;
            {
                let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
                if let Some(session) = guard.as_mut() {
                    attach_live_uploader_to_session(
                        &app,
                        session,
                        &recording_id,
                        server_url.as_deref(),
                        auth_token.as_deref(),
                        cookie.as_deref(),
                        include_audio,
                        has_camera.unwrap_or(false),
                    );
                }
            }
            return Ok(info);
        }

        // Grab the mic-ready diagnostics without holding the lock during the wait.
        let mic_state = {
            let guard = state.inner.lock().map_err(|e| e.to_string())?;
            guard.as_ref().and_then(|s| match s.backend.as_ref() {
                Some(NativeFullscreenBackend::ScreenCaptureKit {
                    mic_ready,
                    mic_sample_count,
                    ..
                }) => mic_ready
                    .as_ref()
                    .map(|ready| (Arc::clone(ready), mic_sample_count.clone())),
                Some(NativeFullscreenBackend::CustomScreenCaptureKit { mic_ready, .. }) => {
                    mic_ready.as_ref().map(|ready| (Arc::clone(ready), None))
                }
                _ => None,
            })
        };
        let mut mic_ready_before_attach: Option<bool> = None;
        let mut mic_samples_before_attach: Option<u64> = None;
        let mut mic_warm_wait_ms: Option<u128> = None;
        if let Some((ready, sample_count)) = mic_state {
            let wait_started = Instant::now();
            let deadline = Instant::now() + Duration::from_millis(MIC_WARM_TIMEOUT_MS);
            while !ready.load(Ordering::Relaxed) && Instant::now() < deadline {
                tokio::time::sleep(Duration::from_millis(15)).await;
            }
            mic_ready_before_attach = Some(ready.load(Ordering::Relaxed));
            mic_samples_before_attach = sample_count
                .as_ref()
                .map(|samples| samples.load(Ordering::Relaxed));
            mic_warm_wait_ms = Some(wait_started.elapsed().as_millis());
        }

        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        let session = guard
            .as_mut()
            .ok_or_else(|| "No native full-screen recording is active.".to_string())?;
        let width = session.width;
        let height = session.height;
        match session.backend.as_ref() {
            Some(NativeFullscreenBackend::ScreenCaptureKit {
                stream, recording, ..
            }) => {
                stream
                    .add_recording_output(recording)
                    .map_err(|e| format!("add recording output failed: {e:?}"))?;
            }
            Some(NativeFullscreenBackend::CustomScreenCaptureKit {
                recording_enabled, ..
            }) => {
                recording_enabled.store(true, Ordering::SeqCst);
            }
            _ => {}
        }
        if mic_ready_before_attach.is_some() || mic_samples_before_attach.is_some() {
            eprintln!(
                "[clips-tray] ScreenCaptureKit recording output attached: mic_ready_before_attach={} mic_samples_before_attach={} mic_warm_wait_ms={}",
                mic_ready_before_attach
                    .map(|ready| ready.to_string())
                    .unwrap_or_else(|| "n/a".to_string()),
                mic_samples_before_attach
                    .map(|samples| samples.to_string())
                    .unwrap_or_else(|| "n/a".to_string()),
                mic_warm_wait_ms
                    .map(|ms| ms.to_string())
                    .unwrap_or_else(|| "n/a".to_string())
            );
        }
        // Rebaseline the duration clock: the warm phase ran during the
        // countdown, so `started_at` (set at warm time) is several seconds
        // early. The clip's first written frame is now, so measure from now.
        let now = Instant::now();
        session.started_at = now;
        session.current_segment_started_at = now;
        session.pending_recording_output = false;

        attach_live_uploader_to_session(
            &app,
            session,
            &recording_id,
            server_url.as_deref(),
            auth_token.as_deref(),
            cookie.as_deref(),
            include_audio,
            has_camera.unwrap_or(false),
        );

        Ok(NativeFullscreenStartInfo {
            recording_id,
            width,
            height,
        })
    }
}

#[tauri::command]
pub async fn native_fullscreen_recording_stop_and_upload(
    app: AppHandle,
    state: State<'_, NativeFullscreenRecordingState>,
    server_url: String,
    recording_id: String,
    auth_token: Option<String>,
    cookie: Option<String>,
    upload_mode: Option<String>,
    has_audio: bool,
    has_camera: bool,
) -> Result<NativeFullscreenUploadResult, String> {
    let upload_mode = NativeUploadMode::from_option(upload_mode);
    emit_native_upload_progress(&app, "finalizing", "Optimizing clip", None, None);
    // The recorder's ScreenCaptureKit stream is now fully stopped and its moov
    // atom is written (or has definitively failed). Signal the UI so it can tear
    // down the separate live-transcription SCStream (system_audio.rs) now,
    // without racing the recorder finalize: tearing that stream down while the
    // recorder is still writing its moov interrupts ScreenCaptureKit
    // (RPRecordingErrorDomain -5814) and corrupts the clip. We emit from inside
    // the finalize helper — after the moov write but BEFORE segment
    // consolidation — so a paused multi-segment recording stops transcription
    // promptly instead of letting it run through the merge window and push the
    // saved transcript past the clip's real end. See recorder.ts `handle.stop()`.
    let StoppedSession {
        mut session,
        duration_ms,
        stop_outcome,
        consolidate_outcome,
        multi_segment,
    } = take_and_finalize_active_session(&state, |_session| {
        let _ = app.emit("clips:native-recording-finalized", &recording_id);
    })?;

    // The camera bubble is the ONE overlay we deliberately leave
    // capture-included (see `show_bubble`), so it has to stay on-screen
    // until the SCStream stops. Now that capture is finalized, tear it
    // down immediately — otherwise the user's face keeps floating in the
    // corner through the (multi-second) finalize + upload phase, reading
    // as "still recording" while the bottom-left card says "processing".
    let _ = crate::clips::close_bubble(app.clone()).await;
    clear_recording_active(&app);

    if multi_segment {
        if let Err(merge_err) = &consolidate_outcome {
            let mut saved = saved_recording_from_segments(
                &session,
                &server_url,
                &recording_id,
                duration_ms,
                has_audio,
                has_camera,
            )?;
            saved.last_error = Some(match &stop_outcome {
                Err(stop_err) => {
                    format!("{stop_err}. Segment consolidation failed: {merge_err}")
                }
                Ok(()) => merge_err.clone(),
            });
            write_saved_recording_metadata(&app, &saved)?;
            emit_native_upload_progress(&app, "failed", "Upload paused", None, None);
            let error = format!(
                "{merge_err}. The raw clip segments were saved locally and can be retried from the Clips menu."
            );
            emit_native_upload_finished(
                &app,
                &server_url,
                &recording_id,
                false,
                Some(error.clone()),
                Some(&saved.file_path),
            );
            return Err(error);
        }
    }

    let mut saved = saved_recording_from_session(
        &session,
        &server_url,
        &recording_id,
        duration_ms,
        has_audio,
        has_camera,
    )?;
    let stop_error = stop_outcome.err();
    if let Some(stop_err) = &stop_error {
        // Capture-side finalize/write failure: the on-disk file is incomplete
        // even though its init-segment moov is present (segmented fMP4 always
        // carries one). Never upload — the live uploader already streamed a
        // prefix, and finishing here would report success on a truncated clip
        // and delete the local copy. Fail closed and keep the retry copy.
        if stop_err.starts_with(CAPTURE_FINALIZE_INCOMPLETE_PREFIX) {
            saved.last_error = Some(stop_err.clone());
            write_saved_recording_metadata(&app, &saved)?;
            emit_native_upload_progress(&app, "failed", "Upload paused", None, None);
            let error = format!(
                "{stop_err}. The clip was saved locally and can be retried from the Clips menu."
            );
            emit_native_upload_finished(
                &app,
                &server_url,
                &recording_id,
                false,
                Some(error.clone()),
                Some(&saved.file_path),
            );
            return Err(error);
        }
        saved.last_error = Some(stop_err.clone());
        // Only mark corrupt when the SCK delegate explicitly called recording_did_fail
        // (error contains "finalize failed"). Transient stop_capture /
        // remove_recording_output errors also return Err but don't prove the moov
        // was never written — they should remain retryable.
        // "finalization callback failed" is unique to the delegate path;
        // "recording finalize failed" also appears on remove_recording_output errors.
        let is_definitive = stop_err.contains("finalization callback failed");
        match mp4_has_moov(&saved.file_path) {
            Some(false) => {
                if is_definitive {
                    saved.corrupt = true;
                    eprintln!(
                        "[clips-tray] recording marked corrupt: definitive finalize error + missing moov atom"
                    );
                } else {
                    eprintln!(
                        "[clips-tray] native stop reported an error and MP4 is missing moov; saving for retry"
                    );
                }
                write_saved_recording_metadata(&app, &saved)?;
                emit_native_upload_progress(&app, "failed", "Upload paused", None, None);
                let suffix = if saved.corrupt {
                    "The local file is incomplete and cannot be recovered. Discard it from the Clips menu and record again."
                } else {
                    "The clip was saved locally and can be retried from the Clips menu."
                };
                let error = format!("{stop_err}. {suffix}");
                emit_native_upload_finished(
                    &app,
                    &server_url,
                    &recording_id,
                    false,
                    Some(error.clone()),
                    Some(&saved.file_path),
                );
                return Err(error);
            }
            Some(true) => {
                eprintln!(
                    "[clips-tray] native stop reported an error but MP4 metadata is present; continuing upload: {stop_err}"
                );
            }
            None => {
                eprintln!(
                    "[clips-tray] native stop reported an error and MP4 metadata could not be verified; continuing upload: {stop_err}"
                );
            }
        }
    } else if mp4_has_moov(&saved.file_path) == Some(false) {
        // stop_outcome was Ok but the finalize callback timed out — SCK may still be
        // flushing the moov atom. Persist metadata so the clip appears as retryable
        // in the UI, then bail out before upload_recording_file re-checks moov and
        // permanently marks it corrupt.
        saved.last_error = Some(
            "Recorded MP4 is missing playback metadata. Please retry the recording.".to_string(),
        );
        eprintln!("[clips-tray] recording missing moov after Ok stop outcome (likely finalize timeout) — saving as retryable, skipping upload");
        write_saved_recording_metadata(&app, &saved)?;
        emit_native_upload_progress(&app, "failed", "Upload paused", None, None);
        let error =
            "Recorded MP4 is missing playback metadata. Please retry the recording.".to_string();
        emit_native_upload_finished(
            &app,
            &server_url,
            &recording_id,
            false,
            Some(error.clone()),
            Some(&saved.file_path),
        );
        return Err(error);
    }
    write_saved_recording_metadata(&app, &saved)?;
    emit_native_upload_progress(&app, "preparing", "Optimizing clip", None, None);

    #[cfg(target_os = "macos")]
    eprintln!(
        "[live-upload] stop_and_upload for {recording_id}: live_upload_active={} had_live_upload={} custom_pipeline={}",
        session.live_upload.is_some(),
        session.had_live_upload,
        session.custom_pipeline
    );

    // Live-upload path: most of the file already streamed to the server
    // during recording. The writer produces delegate-fed segments that WE
    // append to the local file (AVFoundation never rewrites it — see the
    // "Segmented output" section in custom_capture.rs), so the streamed byte
    // ranges are stable and the uploader can safely drain the tail + send the
    // final post instead of re-uploading the whole file.
    #[cfg(target_os = "macos")]
    if let Some(live) = session.live_upload.take() {
        eprintln!(
            "[live-upload] stop: signalling finalize for {recording_id} (duration_ms={duration_ms})"
        );
        emit_native_upload_progress(&app, "uploading", "Uploading clip", None, None);
        live.ctrl
            .duration_ms
            .store(duration_ms as u64, Ordering::SeqCst);
        live.ctrl.finalize.store(true, Ordering::SeqCst);
        let result = match live.result_rx.await {
            Ok(inner) => inner,
            Err(_) => Err("live upload task ended unexpectedly".to_string()),
        };
        eprintln!(
            "[live-upload] stop: finalize result for {recording_id}: {}",
            match &result {
                Ok(bytes) => format!("ok ({bytes} bytes)"),
                Err(e) => format!("error: {e}"),
            }
        );
        return match result {
            Ok(bytes) => {
                clear_saved_recording_after_success(&app, &saved);
                emit_native_upload_finished(&app, &server_url, &recording_id, true, None, None);
                Ok(NativeFullscreenUploadResult {
                    recording_id,
                    duration_ms,
                    width: session.width,
                    height: session.height,
                    bytes,
                })
            }
            Err(err) => {
                saved.last_attempt_at = Some(now_iso());
                saved.last_error = Some(err.clone());
                saved.retry_count = saved.retry_count.saturating_add(1);
                let _ = write_saved_recording_metadata(&app, &saved);
                emit_native_upload_progress(&app, "failed", "Upload paused", None, None);
                let error = format!(
                    "{err}. The clip was saved locally and can be retried from the Clips menu."
                );
                emit_native_upload_finished(
                    &app,
                    &server_url,
                    &recording_id,
                    false,
                    Some(error.clone()),
                    Some(&saved.file_path),
                );
                Err(error)
            }
        };
    }

    // If a live upload was started but later abandoned (e.g. the recording was
    // paused and became multi-segment), the server holds partial/stale chunks.
    // Clear them before re-uploading the whole consolidated file. A failed
    // reset is fatal for this path: uploading from index 0 over leftover
    // higher-index chunks corrupts the server-side reassembly, so keep the
    // clip parked locally instead (manual retry resets again first).
    let auth_token = auth_token.unwrap_or_default();
    let cookie = cookie.unwrap_or_default();
    if session.had_live_upload {
        if let Err(err) = reset_upload_chunks(
            &server_url,
            &recording_id,
            session.mime_type,
            &auth_token,
            &cookie,
        )
        .await
        {
            eprintln!("[live-upload] stop: reset of stale chunks failed for {recording_id}: {err}");
            saved.last_attempt_at = Some(now_iso());
            saved.last_error = Some(err.clone());
            saved.retry_count = saved.retry_count.saturating_add(1);
            let _ = write_saved_recording_metadata(&app, &saved);
            emit_native_upload_progress(&app, "failed", "Upload paused", None, None);
            let error = format!(
                "{err}. The clip was saved locally and can be retried from the Clips menu."
            );
            emit_native_upload_finished(
                &app,
                &server_url,
                &recording_id,
                false,
                Some(error.clone()),
                Some(&saved.file_path),
            );
            return Err(error);
        }
    }

    let result = upload_recording_file(
        &app,
        &session,
        server_url.clone(),
        recording_id.clone(),
        auth_token,
        cookie,
        upload_mode,
        duration_ms,
        has_audio,
        has_camera,
    )
    .await;

    match result {
        Ok(result) => {
            clear_saved_recording_after_success(&app, &saved);
            emit_native_upload_finished(&app, &server_url, &recording_id, true, None, None);
            Ok(result)
        }
        Err(err) => {
            saved.last_attempt_at = Some(now_iso());
            saved.last_error = Some(err.clone());
            saved.retry_count = saved.retry_count.saturating_add(1);
            if is_moov_corrupt_error(&err) {
                saved.corrupt = true;
            }
            let _ = write_saved_recording_metadata(&app, &saved);
            emit_native_upload_progress(&app, "failed", "Upload paused", None, None);
            let error = format!(
                "{err}. The clip was saved locally and can be retried from the Clips menu."
            );
            emit_native_upload_finished(
                &app,
                &server_url,
                &recording_id,
                false,
                Some(error.clone()),
                Some(&saved.file_path),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn native_fullscreen_recording_stop_and_save(
    app: AppHandle,
    state: State<'_, NativeFullscreenRecordingState>,
    folder_name: String,
    file_role: String,
) -> Result<NativeFullscreenSaveResult, String> {
    let StoppedSession {
        mut session,
        duration_ms,
        stop_outcome,
        consolidate_outcome,
        multi_segment,
    } = take_and_finalize_active_session(&state, |_session| {})?;
    // Saving locally — stop any in-flight live upload to the server.
    #[cfg(target_os = "macos")]
    if let Some(live) = session.live_upload.take() {
        live.ctrl.cancelled.store(true, Ordering::SeqCst);
    }
    // Capture is finalized — drop the camera bubble now so the face
    // doesn't linger while the clip saves (mirrors the upload path).
    let _ = crate::clips::close_bubble(app.clone()).await;
    if let Err(err) = &stop_outcome {
        eprintln!(
            "[clips-tray] native local recording stop reported an error; attempting to save file anyway: {err}"
        );
    }
    if multi_segment {
        if let Err(merge_err) = consolidate_outcome {
            return Err(format!(
                "segment consolidation failed: {merge_err}. The raw segments remain in the pending recordings folder."
            ));
        }
    }
    // Only treat the file as permanently unrecoverable when the SCK delegate
    // explicitly called recording_did_fail (error contains "finalization callback failed",
    // the unique prefix used by the delegate path). Transient stop_capture /
    // remove_recording_output errors use "recording finalize failed" and should
    // remain retryable — deleting on those would risk silent data loss.
    let is_definitive_finalize_error = stop_outcome
        .as_ref()
        .err()
        .map(|e| e.contains("finalization callback failed"))
        .unwrap_or(false);
    if is_definitive_finalize_error {
        if mp4_has_moov(&session.path) == Some(false) {
            eprintln!(
                "[clips-tray] native local recording corrupt (finalize error + missing moov) — not exporting"
            );
            let _ = std::fs::remove_file(&session.path);
            return Err(
                "Recorded file is corrupted — the video is incomplete and cannot be saved. \
                 Please record again."
                    .into(),
            );
        }
    } else if mp4_has_moov(&session.path) == Some(false) {
        // Non-definitive case (transient error or finalize timeout): the moov may
        // still be flushing. Proceed with the export so the file lands in the
        // user-requested folder and is accessible — stranding it in an internal
        // pending folder with no metadata would leave it unrecoverable.
        eprintln!(
            "[clips-tray] native local recording has no moov after finalize; exporting anyway so user can access the file"
        );
    }

    save_native_recording_to_local_export(&app, &session, &folder_name, &file_role, duration_ms)
}

#[tauri::command]
pub async fn native_fullscreen_capture_thumbnail(
    app: AppHandle,
    server_url: String,
    recording_id: String,
    auth_token: Option<String>,
    cookie: Option<String>,
) -> Result<(), String> {
    let bytes = capture_thumbnail_bytes(&app, &recording_id)?;
    tauri::async_runtime::spawn(async move {
        if let Err(err) = upload_thumbnail_bytes(
            server_url,
            recording_id.clone(),
            auth_token.unwrap_or_default(),
            cookie.unwrap_or_default(),
            bytes,
        )
        .await
        {
            eprintln!("[clips-tray] native thumbnail upload failed for {recording_id}: {err}");
        }
    });
    Ok(())
}

/// Called from the app's exit path (tray Quit / Cmd+Q) so a live `screencapture`
/// fallback process doesn't survive the app quitting. `app.exit()` triggers
/// `std::process::exit` under the hood, which does not run Rust destructors,
/// so this must run explicitly before exit rather than relying solely on
/// `NativeFullscreenBackend`'s `Drop` impl. Synchronous and best-effort: no
/// finalize/upload, just make sure nothing keeps recording after we're gone.
pub(crate) fn kill_active_screencapture_child(state: &NativeFullscreenRecordingState) {
    let Ok(mut guard) = state.inner.lock() else {
        return;
    };
    if let Some(session) = guard.as_mut() {
        if let Some(NativeFullscreenBackend::Screencapture { child }) = session.backend.as_mut() {
            if matches!(child.try_wait(), Ok(None)) {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[tauri::command]
pub async fn native_fullscreen_recording_cancel(
    state: State<'_, NativeFullscreenRecordingState>,
) -> Result<(), String> {
    let session = {
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        guard.take()
    };
    if let Some(mut session) = session {
        discard_session(&mut session);
    }
    Ok(())
}

/// True OS-level pause for the native ScreenCaptureKit recording. SCStream
/// has no pause primitive — instead we stop the current stream entirely
/// (finalizing the current segment file) and remember enough state to spin
/// up a fresh stream on resume. The new stream writes to a numbered
/// sibling file; on stop all segments are concatenated together via
/// AVFoundation so the caller still sees a single output file.
#[tauri::command]
pub async fn native_fullscreen_recording_pause(
    state: State<'_, NativeFullscreenRecordingState>,
) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    let session = guard
        .as_mut()
        .ok_or_else(|| "No native full-screen recording is active.".to_string())?;
    if session.paused_at.is_some() {
        return Ok(());
    }
    eprintln!(
        "[clips-tray] pause requested for {}: segment #{} ran {}ms",
        session.restart.safe_id,
        session.restart.segment_counter,
        session.current_segment_started_at.elapsed().as_millis()
    );

    // Custom pipeline in live-upload (segmented) mode does a SOFT pause: stop
    // only the capture source and keep the writer, file, and live uploader
    // alive. Resume splices a fresh SCStream onto the same append-only file, so
    // there are no segments to concatenate and the upload is never interrupted.
    #[cfg(target_os = "macos")]
    {
        let soft_paused =
            if let Some(NativeFullscreenBackend::CustomScreenCaptureKit {
                resume, writer, ..
            }) = session.backend.as_ref()
            {
                if writer.segmented() && writer.is_started() {
                    resume.pause();
                    true
                } else {
                    false
                }
            } else {
                false
            };
        if soft_paused {
            session.paused_at = Some(Instant::now());
            eprintln!(
                "[clips-tray] soft-paused {} (writer/file/live upload kept alive)",
                session.restart.safe_id
            );
            return Ok(());
        }
    }

    // Fallback hard-pause path for pipelines the soft pause above does NOT
    // cover: the stock recorder, the custom pipeline with live upload off, and
    // a pause before the first frame. (When live upload is on, the soft pause
    // handles it and returns before reaching here, keeping the uploader alive.)
    //
    // Live upload assumes a single append-only file — the uploader tails one
    // growing file by byte offset. In these pipelines, pause finalizes that
    // file and resume starts a brand-new one (multi-segment), which stop later
    // stitches together into different bytes, so those offsets would be
    // meaningless. Abandon the in-flight uploader here; the stop path then
    // resets the partial chunks and re-uploads the consolidated file whole.
    #[cfg(target_os = "macos")]
    if let Some(live) = session.live_upload.take() {
        eprintln!(
            "[clips-tray] pause: abandoning live upload for {} (recording becomes multi-segment)",
            session.restart.safe_id
        );
        live.ctrl.cancelled.store(true, Ordering::SeqCst);
    }
    if session.backend.is_none() {
        // No active backend means we're already paused (or never started).
        eprintln!("[clips-tray] pause: no active backend; marking paused only");
        session.paused_at = Some(Instant::now());
        return Ok(());
    }
    let stop_outcome = finalize_active_backend(session, true);
    if let Err(err) = &stop_outcome {
        eprintln!("[clips-tray] pause finalize reported an error: {err}");
    }
    recover_from_unusable_current_segment(session, "pause", true);
    session.paused_at = Some(Instant::now());
    let current_segment_bytes = session
        .segments
        .last()
        .and_then(|path| std::fs::metadata(path).ok())
        .map(|meta| meta.len());
    eprintln!(
        "[clips-tray] paused {}: {} segment(s) on disk, finalized segment size={:?} bytes",
        session.restart.safe_id,
        session.segments.len(),
        current_segment_bytes
    );
    Ok(())
}

/// Resume after `native_fullscreen_recording_pause`. Starts a brand-new
/// SCStream / screencapture child writing to the next segment file and
/// appends its path to `session.segments`.
#[tauri::command]
pub async fn native_fullscreen_recording_resume(
    app: AppHandle,
    state: State<'_, NativeFullscreenRecordingState>,
) -> Result<(), String> {
    let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
    let session = guard
        .as_mut()
        .ok_or_else(|| "No native full-screen recording is active.".to_string())?;
    let Some(paused_at) = session.paused_at else {
        // Already running — nothing to do.
        return Ok(());
    };

    // Soft-resume counterpart to the custom-pipeline soft pause: the backend
    // was never torn down, so build a fresh SCStream onto the same writer and
    // rebase its timestamps past the pause gap instead of starting a new
    // segment file.
    #[cfg(target_os = "macos")]
    {
        let paused_for = paused_at.elapsed();
        let soft_resumed =
            if let Some(NativeFullscreenBackend::CustomScreenCaptureKit {
                resume, writer, ..
            }) = session.backend.as_ref()
            {
                if writer.segmented() && writer.is_started() {
                    resume.resume(paused_for)?;
                    true
                } else {
                    false
                }
            } else {
                false
            };
        if soft_resumed {
            session.paused_total = session
                .paused_total
                .checked_add(paused_for)
                .unwrap_or(session.paused_total);
            session.paused_at = None;
            eprintln!(
                "[clips-tray] soft-resumed {} after {}ms paused (single continuous file, paused_total={}ms)",
                session.restart.safe_id,
                paused_for.as_millis(),
                session.paused_total.as_millis()
            );
            return Ok(());
        }
    }

    let restart = session.restart.clone();
    let next_counter = restart.segment_counter.saturating_add(1);
    let extension = native_extension_for_mime_type(session.mime_type);
    let segment_path = segment_path_for(&app, &restart.safe_id, extension, next_counter)?;
    let _ = std::fs::remove_file(&segment_path);
    eprintln!(
        "[clips-tray] resume requested for {}: starting segment #{next_counter} -> {}",
        restart.safe_id,
        segment_path.display()
    );

    // Re-check disk space before starting the new segment. The mid-recording
    // monitor warns but does not block, so space can drop below the hard limit
    // between the initial start and a resume without being caught here.
    #[cfg(target_os = "macos")]
    if let Some(free) = free_disk_bytes(segment_path.parent().unwrap_or(&segment_path)) {
        if free < DISK_SPACE_BLOCK_BYTES {
            return Err(format!(
                "Not enough disk space to resume recording. Free up at least {} and try again (currently {} free).",
                format_mb(DISK_SPACE_BLOCK_BYTES),
                format_mb(free)
            ));
        }
    }

    // Start the new segment backend FIRST. Only clear paused state if it
    // succeeds — otherwise the session would be left with no backend but
    // appear running, which silently drops everything after the resume.
    let (backend, _w, _h) = start_segment_backend(
        &app,
        &restart.safe_id,
        restart.include_audio,
        restart.capture_system_audio,
        restart.mic_device_id.as_deref(),
        restart.mic_device_label.as_deref(),
        &segment_path,
        restart.target_display_id,
        restart.capture_region,
    )?;
    session.backend = Some(backend);
    session.segments.push(segment_path);
    session.restart.segment_counter = next_counter;
    session.current_segment_started_at = Instant::now();
    session.paused_total = session
        .paused_total
        .checked_add(paused_at.elapsed())
        .unwrap_or(session.paused_total);
    session.paused_at = None;
    eprintln!(
        "[clips-tray] resumed {}: segment #{next_counter} live after {}ms paused (segments={}, paused_total={}ms)",
        restart.safe_id,
        paused_at.elapsed().as_millis(),
        session.segments.len(),
        session.paused_total.as_millis()
    );
    Ok(())
}

/// Best-effort checkpoint for long ScreenCaptureKit recordings. It finalizes
/// the current segment and immediately starts a sibling segment, so a later
/// ReplayKit finalization failure can only lose the active segment instead of
/// the entire recording.
#[tauri::command]
pub async fn native_fullscreen_recording_rotate_segment(
    app: AppHandle,
    state: State<'_, NativeFullscreenRecordingState>,
) -> Result<(), String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, state);
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        let Some(session) = guard.as_mut() else {
            return Ok(());
        };
        if session.pending_recording_output || session.paused_at.is_some() {
            return Ok(());
        }
        if !matches!(
            session.backend.as_ref(),
            Some(NativeFullscreenBackend::ScreenCaptureKit { .. })
        ) {
            return Ok(());
        }

        rotate_screencapturekit_segment(&app, session)
    }
}

#[cfg(target_os = "macos")]
fn rotate_screencapturekit_segment(
    app: &AppHandle,
    session: &mut NativeFullscreenSession,
) -> Result<(), String> {
    let restart = session.restart.clone();
    let next_counter = restart.segment_counter.saturating_add(1);
    let extension = native_extension_for_mime_type(session.mime_type);
    let segment_path = segment_path_for(app, &restart.safe_id, extension, next_counter)?;
    let _ = std::fs::remove_file(&segment_path);

    if let Some(free) = free_disk_bytes(segment_path.parent().unwrap_or(&segment_path)) {
        if free < DISK_SPACE_BLOCK_BYTES {
            eprintln!(
                "[clips-tray] skipping segment rotation because disk space is low: {} free",
                format_mb(free)
            );
            return Ok(());
        }
    }

    eprintln!(
        "[clips-tray] rotating ScreenCaptureKit recording segment -> {}",
        segment_path.display()
    );
    let rotation_started = Instant::now();
    let stop_outcome = finalize_active_backend(session, true);
    if let Err(err) = &stop_outcome {
        eprintln!("[clips-tray] segment rotation finalize reported an error: {err}");
    }
    recover_from_unusable_current_segment(session, "segment rotation", true);

    let start_result = start_screencapturekit_backend_at(
        &segment_path,
        restart.include_audio,
        restart.capture_system_audio,
        restart.mic_device_id.as_deref(),
        restart.mic_device_label.as_deref(),
        restart.target_display_id,
        restart.capture_region,
        false,
    );

    let (backend, _, _) = match start_result {
        Ok(result) => result,
        Err(err) => {
            session.paused_at = Some(rotation_started);
            return Err(format!(
                "ScreenCaptureKit segment rotation paused recording after a finalized checkpoint, but the next segment could not start: {err}"
            ));
        }
    };

    session.paused_total = session
        .paused_total
        .checked_add(rotation_started.elapsed())
        .unwrap_or(session.paused_total);
    session.backend = Some(backend);
    session.segments.push(segment_path);
    session.restart.segment_counter = next_counter;
    session.current_segment_started_at = Instant::now();
    session.paused_at = None;
    Ok(())
}

/// Outcome of taking the active session out of state and finalizing
/// every backend / segment it owns. Both the upload and the save-locally
/// stop commands need exactly this prelude, so it lives in one place.
struct StoppedSession {
    session: NativeFullscreenSession,
    /// Wall-clock time minus accumulated pause time, in ms.
    duration_ms: u128,
    /// Result of tearing down the active capture backend.
    stop_outcome: Result<(), String>,
    /// Result of merging segment files into `session.path`.
    consolidate_outcome: Result<(), String>,
    /// True when more than one segment was captured (manual pause/resume or
    /// automatic long-recording checkpoints). Used to decide whether a
    /// consolidation failure is fatal — single-segment consolidation is just a
    /// rename.
    multi_segment: bool,
}

/// Take the active session out of state, finalize its backend, and merge
/// any pause/resume segments into the canonical output path. Shared by
/// the upload and save-locally stop commands.
///
/// `on_capture_finalized` runs in the narrow window after the capture
/// backend is fully stopped (moov atom written) but before segment
/// consolidation begins. The upload path uses it to tell the UI to stop
/// live transcription: doing it here keeps the saved transcript anchored
/// to the clip's real end instead of running through the (multi-segment)
/// merge, while still avoiding the -5814 corruption from tearing the
/// transcription SCStream down before the recorder's moov is written.
fn take_and_finalize_active_session(
    state: &State<'_, NativeFullscreenRecordingState>,
    on_capture_finalized: impl FnOnce(&NativeFullscreenSession),
) -> Result<StoppedSession, String> {
    let mut session = {
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        guard.take()
    }
    .ok_or_else(|| "No native full-screen recording is active.".to_string())?;

    // Signal the disk monitor to stop before tearing down the backend.
    if let Some(stop) = &session.disk_monitor_stop {
        stop.store(true, Ordering::Relaxed);
    }
    // Try to finalize capture, but don't early-return on failure: the
    // underlying MP4 file is already on disk after stop_capture(), and
    // ScreenCaptureKit's StreamError("invalid parameter") on
    // remove_recording_output occasionally fires even though the file is
    // playable. The caller persists recovery metadata so a finalize
    // failure doesn't orphan the file.
    let stop_outcome = finalize_active_backend(&mut session, true);
    recover_from_unusable_current_segment(&mut session, "final stop", false);
    println!(
        "[clips-tray] finalize backend done (ok={}); {}",
        stop_outcome.is_ok(),
        describe_recording_path(&session.path)
    );
    // The capture backend is fully stopped and its moov atom is written.
    // Signal callers now — before the (potentially slow) segment merge — so
    // live transcription can stop while the clip duration is still anchored
    // to the real Stop click. Tearing it down here is safe from the -5814
    // corruption because the recorder's SCStream is already finalized; the
    // remaining work is plain on-disk file merging.
    on_capture_finalized(&session);
    // With one segment this is a cheap rename. With multiple segments a
    // failure would silently lose everything after the first pause, so
    // callers check `multi_segment` and surface the merge error.
    let consolidate_outcome = consolidate_segments_into_path(&mut session);
    let multi_segment = session.segments.len() > 1;
    if let Err(err) = &consolidate_outcome {
        eprintln!("[clips-tray] segment consolidation failed: {err}");
    }
    eprintln!(
        "[clips-tray] consolidate done (ok={}, segments={}, multi={multi_segment}); {}",
        consolidate_outcome.is_ok(),
        session.segments.len(),
        describe_recording_path(&session.path)
    );
    if session.lost_segment_count > 0 {
        eprintln!(
            "[clips-tray] recovered recording by dropping {} unusable segment(s), approx {}s lost",
            session.lost_segment_count,
            session.lost_segment_duration.as_secs()
        );
    }

    if let Some(paused_at) = session.paused_at.take() {
        session.paused_total = session
            .paused_total
            .checked_add(paused_at.elapsed())
            .unwrap_or(session.paused_total);
    }
    let duration_ms = session
        .started_at
        .elapsed()
        .saturating_sub(session.paused_total)
        .saturating_sub(session.lost_segment_duration)
        .as_millis();
    Ok(StoppedSession {
        session,
        duration_ms,
        stop_outcome,
        consolidate_outcome,
        multi_segment,
    })
}

/// Tears down the active backend (if any) and forwards to the
/// existing `stop_native_recording` helper.
fn finalize_active_backend(
    session: &mut NativeFullscreenSession,
    wait_for_finalize: bool,
) -> Result<(), String> {
    let Some(mut backend) = session.backend.take() else {
        return Ok(());
    };
    stop_native_recording(&mut backend, wait_for_finalize)
}

fn playable_recording_file(path: &Path, mime_type: &str) -> bool {
    match std::fs::metadata(path) {
        Ok(metadata) if metadata.len() > 0 => {}
        _ => return false,
    }
    if mime_type == MP4_RECORDING_MIME_TYPE || mime_type == QUICKTIME_RECORDING_MIME_TYPE {
        return mp4_has_moov(path) != Some(false);
    }
    true
}

fn recover_from_unusable_current_segment(
    session: &mut NativeFullscreenSession,
    reason: &str,
    allow_empty: bool,
) -> bool {
    let Some(current) = session.segments.last().cloned() else {
        return false;
    };
    if playable_recording_file(&current, session.mime_type) {
        return false;
    }
    if !allow_empty && session.segments.len() <= 1 {
        eprintln!(
            "[clips-tray] current recording segment is unusable after {reason}, but no earlier segment exists to recover"
        );
        return false;
    }

    let dropped = session.segments.pop();
    if dropped.as_ref() == Some(&current) {
        let _ = std::fs::remove_file(&current);
        session.lost_segment_count = session.lost_segment_count.saturating_add(1);
        session.lost_segment_duration = session
            .lost_segment_duration
            .checked_add(session.current_segment_started_at.elapsed())
            .unwrap_or(session.lost_segment_duration);
        eprintln!(
            "[clips-tray] dropped unusable recording segment after {reason}; recovered {} earlier segment(s)",
            session.segments.len()
        );
        return true;
    }
    false
}

/// Best-effort cleanup of a session being discarded (cancel, or a stale
/// session displaced by a new start). Finalizes any active backend and
/// deletes every on-disk artifact — segment files and the final path.
fn discard_session(session: &mut NativeFullscreenSession) {
    #[cfg(target_os = "macos")]
    if let Some(live) = session.live_upload.take() {
        live.ctrl.cancelled.store(true, Ordering::SeqCst);
    }
    if let Some(stop) = &session.disk_monitor_stop {
        stop.store(true, Ordering::Relaxed);
    }
    let _ = finalize_active_backend(session, false);
    for segment in &session.segments {
        let _ = std::fs::remove_file(segment);
    }
    let _ = std::fs::remove_file(&session.path);
}

/// Sibling path next to the original pending recording, numbered with
/// the segment counter so multiple resume cycles don't clobber each
/// other. Example: `clips-fullscreen-<id>-<pid>-seg2.mp4`.
fn segment_path_for(
    app: &AppHandle,
    safe_id: &str,
    extension: &str,
    counter: u32,
) -> Result<PathBuf, String> {
    pending_recording_path(app, &format!("{safe_id}-seg{counter}"), extension)
}

/// Dispatches to the right backend starter for resume. Mirrors the
/// ScreenCaptureKit-first / screencapture-fallback logic from the start
/// command, but writes to a caller-provided segment path instead of the
/// default pending path.
fn start_segment_backend(
    app: &AppHandle,
    safe_id: &str,
    include_audio: bool,
    capture_system_audio: bool,
    mic_device_id: Option<&str>,
    mic_device_label: Option<&str>,
    segment_path: &Path,
    target_display_id: Option<u32>,
    capture_region: Option<NativeCaptureRegion>,
) -> Result<(NativeFullscreenBackend, Option<u32>, Option<u32>), String> {
    #[cfg(target_os = "macos")]
    {
        // safe_id isn't needed on macOS — the segment path is pre-computed by
        // the caller. Consume to silence the unused-variable warning.
        let _ = safe_id;
        let sck_result = if crate::remote_flags::current().use_custom_sck_pipeline {
            start_custom_screencapturekit_backend_at(
                app,
                segment_path,
                include_audio,
                capture_system_audio,
                mic_device_id,
                mic_device_label,
                target_display_id,
                capture_region,
                false,
            )
        } else {
            start_screencapturekit_backend_at(
                segment_path,
                include_audio,
                capture_system_audio,
                mic_device_id,
                mic_device_label,
                target_display_id,
                capture_region,
                false,
            )
        };
        match sck_result {
            Ok((backend, w, h)) => return Ok((backend, w, h)),
            Err(sck_err) => {
                if include_audio {
                    let mic_description = if mic_device_id
                        .is_some_and(|value| !value.trim().is_empty())
                        || mic_device_label.is_some_and(|value| !value.trim().is_empty())
                    {
                        "the selected microphone"
                    } else {
                        "the resolved default microphone"
                    };
                    return Err(format!(
                        "ScreenCaptureKit resume failed before it could use {mic_description} ({sck_err}). Clips did not fall back to macOS screencapture because that would ignore the requested input."
                    ));
                }
                eprintln!(
                    "[clips-tray] ScreenCaptureKit resume failed; falling back to screencapture: {sck_err}"
                );
            }
        }
        let (backend, w, h) = start_screencapture_backend_at(
            app,
            segment_path,
            include_audio,
            target_display_id,
            capture_region,
        )
        .map_err(|fallback_err| {
            format!(
                "ScreenCaptureKit resume failed; screencapture fallback failed ({fallback_err})"
            )
        })?;
        Ok((backend, w, h))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (
            app,
            safe_id,
            include_audio,
            capture_system_audio,
            mic_device_id,
            mic_device_label,
            segment_path,
            target_display_id,
            capture_region,
        );
        Err("Native full-screen recording is currently macOS-only.".into())
    }
}

/// Configure and start a fresh ScreenCaptureKit capture writing into
/// `output_path`. Shared by the initial start and the resume path.
#[cfg(target_os = "macos")]
pub(crate) fn start_screencapturekit_backend_at(
    output_path: &Path,
    include_audio: bool,
    capture_system_audio: bool,
    mic_device_id: Option<&str>,
    mic_device_label: Option<&str>,
    target_display_id: Option<u32>,
    capture_region: Option<NativeCaptureRegion>,
    // When true the SCStream is started WITHOUT attaching the recording
    // output — capture runs (warming the mic) but nothing is written until
    // `add_recording_output` is called later by `begin`. When false the
    // recording output is attached before capture starts (resume path +
    // the no-warm fallback), preserving the original record-immediately
    // behavior.
    defer_recording_output: bool,
) -> Result<(NativeFullscreenBackend, Option<u32>, Option<u32>), String> {
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
    let filter_builder = SCContentFilter::create()
        .with_display(display)
        .with_excluding_windows(&[]);
    let filter = if let Some((rect, _, _)) = region_rect {
        filter_builder.with_content_rect(rect).build()
    } else {
        filter_builder.build()
    };
    let capture_microphone_in_recording = include_audio;
    let selected_mic = if capture_microphone_in_recording {
        resolve_microphone_capture_device(mic_device_id, mic_device_label)?
    } else {
        None
    };

    let mut config = SCStreamConfiguration::new()
        .with_width(width)
        .with_height(height)
        .with_fps(NATIVE_CAPTURE_FPS)
        .with_queue_depth(8)
        .with_shows_cursor(true)
        // Mic and system audio are independent toggles. SCK delivers them as
        // separate inputs so recordings can include both the user's mic and
        // system audio.
        .with_captures_audio(capture_system_audio)
        .with_captures_microphone(capture_microphone_in_recording)
        .with_excludes_current_process_audio(true)
        .with_sample_rate(48000)
        .with_channel_count(2);
    if let Some((rect, _, _)) = region_rect {
        config.set_source_rect(rect);
    }
    if let Some(device) = selected_mic.as_ref() {
        config.set_microphone_capture_device_id(&device.id);
        eprintln!(
            "[clips-tray] ScreenCaptureKit microphone pinned to {} ({})",
            device.name, device.id
        );
    }
    config.set_stream_name(Some("Clips full-screen recording"));

    let recording_config = SCRecordingOutputConfiguration::new()
        .with_output_url(output_path)
        .with_video_codec(SCRecordingOutputCodec::H264)
        .with_output_file_type(SCRecordingOutputFileType::MP4);
    let finish = Arc::new(RecordingFinish::new());
    let recording = SCRecordingOutput::new_with_delegate(
        &recording_config,
        FinishDelegate {
            finish: Arc::clone(&finish),
        },
    )
    .ok_or_else(|| {
        "ScreenCaptureKit recording output could not be created. macOS 15+ is required.".to_string()
    })?;
    let mut stream = SCStream::new(&filter, &config);
    // Observe the microphone stream so `begin` can wait for the first sample
    // before attaching the recording output (avoids the silent-mic head).
    let (mic_ready, mic_sample_count) = if capture_microphone_in_recording {
        let flag = Arc::new(AtomicBool::new(false));
        let sample_count = Arc::new(AtomicU64::new(0));
        let flag_cb = Arc::clone(&flag);
        let sample_count_cb = Arc::clone(&sample_count);
        stream.add_output_handler(
            move |_sample, of_type| {
                if matches!(of_type, SCStreamOutputType::Microphone) {
                    sample_count_cb.fetch_add(1, Ordering::Relaxed);
                    flag_cb.store(true, Ordering::Relaxed);
                }
            },
            SCStreamOutputType::Microphone,
        );
        (Some(flag), Some(sample_count))
    } else {
        (None, None)
    };
    if !defer_recording_output {
        stream
            .add_recording_output(&recording)
            .map_err(|e| format!("add recording output failed: {e:?}"))?;
    }
    if let Err(err) = stream.start_capture() {
        let _ = stream.remove_recording_output(&recording);
        let _ = std::fs::remove_file(output_path);
        return Err(format!("capture start failed: {err:?}"));
    }
    eprintln!(
        "[clips-tray] ScreenCaptureKit recording started: {width}x{height} @ {NATIVE_CAPTURE_FPS}fps from {capture_width}x{capture_height} (display {source_width}x{source_height}), mic_requested={include_audio} mic_recorded={capture_microphone_in_recording} system_audio={capture_system_audio} deferred_output={defer_recording_output}"
    );
    Ok((
        NativeFullscreenBackend::ScreenCaptureKit {
            stream,
            recording,
            finish,
            mic_ready,
            mic_sample_count,
        },
        Some(width),
        Some(height),
    ))
}

/// Spawn the macOS `screencapture` fallback writing into `output_path`.
/// Shared by the initial start and the resume path.
#[cfg(target_os = "macos")]
pub(crate) fn start_screencapture_backend_at(
    app: &AppHandle,
    output_path: &Path,
    include_audio: bool,
    target_display_id: Option<u32>,
    capture_region: Option<NativeCaptureRegion>,
) -> Result<(NativeFullscreenBackend, Option<u32>, Option<u32>), String> {
    if !std::path::Path::new("/usr/sbin/screencapture").exists() {
        return Err("macOS screencapture is unavailable on this machine.".into());
    }
    // screencapture -D<N> uses 1-based position in CGGetActiveDisplayList.
    let display_flag = target_display_id
        .and_then(|id| {
            CGDisplay::active_displays().ok().and_then(|ids| {
                ids.iter()
                    .position(|&aid| aid == id)
                    .map(|p| format!("-D{}", p + 1))
            })
        })
        .unwrap_or_else(|| "-D1".to_string());
    let (region_arg, region_width, region_height) = if let Some(region) = capture_region {
        let (mx, my, mw, mh) = crate::util::tray_monitor_physical_rect(app);
        let (rect, width, height) = region_source_rect(Some(region), mw, mh)?
            .ok_or_else(|| "Recording region is unavailable.".to_string())?;
        (
            Some(format!(
                "{},{},{},{}",
                mx + rect.x.round() as i32,
                my + rect.y.round() as i32,
                rect.width.round() as u32,
                rect.height.round() as u32
            )),
            Some(width),
            Some(height),
        )
    } else {
        (None, None, None)
    };
    let mut command = Command::new("/usr/sbin/screencapture");
    command
        .arg("-v")
        .arg("-x")
        .arg("-C")
        .arg(display_flag)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if include_audio {
        command.arg("-g");
    }
    if let Some(region_arg) = region_arg {
        command.arg(format!("-R{region_arg}"));
    }
    command.arg(output_path);
    let mut child = command
        .spawn()
        .map_err(|e| format!("screencapture spawn failed: {e}"))?;
    std::thread::sleep(Duration::from_millis(300));
    if let Some(status) = child
        .try_wait()
        .map_err(|e| format!("screencapture startup check failed: {e}"))?
    {
        let _ = std::fs::remove_file(output_path);
        return Err(format!(
            "screencapture exited before recording started ({status}). Check Screen Recording and Microphone permissions for Clips."
        ));
    }
    eprintln!("[clips-tray] screencapture recording started");
    Ok((
        NativeFullscreenBackend::Screencapture { child },
        region_width,
        region_height,
    ))
}

/// After all segments are finalized, make sure `session.path` contains a
/// single playable file. With one segment we just rename it into place;
/// with multiple, we concatenate via AVFoundation (passthrough export so
/// there's no re-encoding cost).
fn consolidate_segments_into_path(session: &mut NativeFullscreenSession) -> Result<(), String> {
    if session.segments.is_empty() {
        return Err("No recorded segments to consolidate.".into());
    }
    if session.segments.len() == 1 {
        let only = &session.segments[0];
        if only == &session.path {
            return Ok(());
        }
        move_or_copy_file(only, &session.path)?;
        session.segments[0] = session.path.clone();
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        let segments = session.segments.clone();
        for (i, segment) in segments.iter().enumerate() {
            let size = std::fs::metadata(segment).map(|m| m.len()).unwrap_or(0);
            eprintln!(
                "[clips-tray] consolidate input segment {}/{}: {} ({size} bytes)",
                i + 1,
                segments.len(),
                segment.display()
            );
        }
        // Concatenate into a temp sibling first so a failure mid-export
        // doesn't leave a half-written file at the real output path.
        let target_stem = session
            .path
            .file_stem()
            .and_then(|v| v.to_str())
            .unwrap_or("recording");
        let combined_path = session
            .path
            .with_file_name(format!("{target_stem}-combined.mp4"));
        let _ = std::fs::remove_file(&combined_path);

        concat_mp4_segments(&segments, &combined_path)?;
        move_or_copy_file(&combined_path, &session.path)?;
        for segment in &segments {
            if segment != &session.path {
                let _ = std::fs::remove_file(segment);
            }
        }
        session.segments = vec![session.path.clone()];
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Segment concat is only available on macOS.".into())
    }
}

#[tauri::command]
pub async fn native_fullscreen_pending_uploads(
    app: AppHandle,
) -> Result<Vec<PendingNativeRecording>, String> {
    let dir = pending_uploads_dir(&app)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let entries =
        std::fs::read_dir(&dir).map_err(|e| format!("pending recordings lookup failed: {e}"))?;
    let mut pending = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(saved) = read_saved_recording_metadata_path(&path) else {
            continue;
        };
        if saved_recording_has_local_artifact(&saved) {
            pending.push(PendingNativeRecording::from(&saved));
        } else {
            let _ = std::fs::remove_file(path);
        }
    }
    pending.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
    Ok(pending)
}

#[tauri::command]
pub async fn native_fullscreen_recording_retry_upload(
    app: AppHandle,
    server_url: String,
    recording_id: String,
    auth_token: Option<String>,
    cookie: Option<String>,
) -> Result<NativeFullscreenUploadResult, String> {
    let mut saved = read_saved_recording_metadata(&app, &recording_id)?;
    saved.server_url = server_url.trim_end_matches('/').to_string();
    saved.last_attempt_at = Some(now_iso());
    saved.last_error = None;
    write_saved_recording_metadata(&app, &saved)?;

    // Preparation can normalize or transcode the saved recording. The
    // resumable session must be created with the MIME type we will actually
    // upload, not the source file's potentially stale MIME type.
    let result = async {
        let (prepared, retry_combined_path) = prepare_saved_recording_file(&app, &saved)?;
        let upload_mode = match reset_upload_chunks(
            &saved.server_url,
            &saved.recording_id,
            &prepared.mime_type,
            auth_token.as_deref().unwrap_or(""),
            cookie.as_deref().unwrap_or(""),
        )
        .await
        {
            Ok(upload_mode) => upload_mode,
            Err(err) => {
                cleanup_prepared_saved_recording_files(&prepared, retry_combined_path);
                return Err(err);
            }
        };

        let upload_result = upload_prepared_recording_file(
            &app,
            &prepared,
            saved.server_url.clone(),
            saved.recording_id.clone(),
            auth_token.unwrap_or_default(),
            cookie.unwrap_or_default(),
            upload_mode,
            saved.duration_ms,
            saved.width,
            saved.height,
            saved.has_audio,
            saved.has_camera,
        )
        .await;
        cleanup_prepared_saved_recording_files(&prepared, retry_combined_path);
        upload_result
    }
    .await;

    match result {
        Ok(result) => {
            clear_saved_recording_after_success(&app, &saved);
            Ok(result)
        }
        Err(err) => {
            if is_moov_corrupt_error(&err) {
                saved.corrupt = true;
            }
            persist_saved_recording_error(&app, &mut saved, &err);
            emit_native_upload_progress(&app, "failed", "Retry paused", None, None);
            let suffix = if saved.corrupt {
                "The file is corrupted and cannot be recovered."
            } else {
                "The local copy is still saved, so you can retry again."
            };
            Err(format!("{err}. {suffix}"))
        }
    }
}

#[tauri::command]
pub async fn native_fullscreen_recording_dismiss_upload(
    app: AppHandle,
    recording_id: String,
) -> Result<String, String> {
    let mut saved = read_saved_recording_metadata(&app, &recording_id)?;
    let draft_dir = clip_drafts_dir(&app)?.join(sanitize_recording_id(&recording_id));
    std::fs::create_dir_all(&draft_dir)
        .map_err(|e| format!("clip draft directory unavailable: {e}"))?;

    let mut sources = vec![saved.file_path.clone()];
    for segment_path in &saved.segment_paths {
        if !sources.contains(segment_path) {
            sources.push(segment_path.clone());
        }
    }

    let mut moved_any = false;
    for source in sources {
        if !source.exists() {
            continue;
        }
        if source.parent() == Some(draft_dir.as_path()) {
            moved_any = true;
            continue;
        }
        let destination = available_draft_path(&draft_dir, &source);
        move_or_copy_file(&source, &destination)?;
        moved_any = true;

        if saved.file_path == source {
            saved.file_path = destination.clone();
        }
        for segment_path in &mut saved.segment_paths {
            if *segment_path == source {
                *segment_path = destination.clone();
            }
        }
        // Keep metadata recoverable if a later segment move fails.
        write_saved_recording_metadata(&app, &saved)?;
    }

    if !moved_any {
        return Err("No saved clip file was available to move into Clip Drafts.".into());
    }

    let metadata_path = saved_recording_metadata_path(&app, &saved.recording_id)?;
    remove_saved_file(&metadata_path, "pending recording metadata")?;
    Ok(draft_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn native_fullscreen_open_drafts_folder(app: AppHandle) -> Result<(), String> {
    let dir = clip_drafts_dir(&app)?;
    crate::clips::open_local_recording_folder(dir.to_string_lossy().to_string())
}

fn sanitize_recording_id(value: &str) -> String {
    let safe: String = value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if safe.is_empty() {
        "recording".to_string()
    } else {
        safe
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn describe_recording_path(path: &Path) -> String {
    let exists = path.exists();
    let size = std::fs::metadata(path).map(|m| m.len()).ok();
    format!(
        "path={} exists={exists} size={}",
        path.display(),
        size.map(|b| b.to_string()).unwrap_or_else(|| "n/a".into()),
    )
}

fn saved_recording_has_local_artifact(saved: &SavedNativeRecording) -> bool {
    saved.file_path.exists() || saved.segment_paths.iter().any(|path| path.exists())
}

fn pending_uploads_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data directory unavailable: {e}"))?
        .join(PENDING_UPLOADS_DIR);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("pending recordings directory unavailable: {e}"))?;
    Ok(dir)
}

fn clip_drafts_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .video_dir()
        .map_err(|e| format!("videos directory unavailable: {e}"))?
        .join("Clips")
        .join(CLIP_DRAFTS_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("clip drafts directory unavailable: {e}"))?;
    Ok(dir)
}

fn available_draft_path(draft_dir: &Path, source: &Path) -> PathBuf {
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("clip");
    let preferred = draft_dir.join(file_name);
    if !preferred.exists() {
        return preferred;
    }

    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("clip");
    let extension = source.extension().and_then(|value| value.to_str());
    for suffix in 2.. {
        let candidate_name = match extension {
            Some(extension) => format!("{stem}-{suffix}.{extension}"),
            None => format!("{stem}-{suffix}"),
        };
        let candidate = draft_dir.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!()
}

#[cfg(test)]
mod clip_draft_tests {
    use super::available_draft_path;

    #[test]
    fn keeps_existing_drafts_when_file_names_collide() {
        let root = std::env::temp_dir().join(format!(
            "clips-draft-path-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let drafts = root.join("Drafts");
        std::fs::create_dir_all(&drafts).unwrap();
        std::fs::write(drafts.join("clip.mp4"), b"first").unwrap();
        std::fs::write(drafts.join("clip-2.mp4"), b"second").unwrap();

        let source = root.join("clip.mp4");
        assert_eq!(
            available_draft_path(&drafts, &source),
            drafts.join("clip-3.mp4")
        );

        let _ = std::fs::remove_dir_all(root);
    }
}

fn pending_recording_path(
    app: &AppHandle,
    safe_id: &str,
    extension: &str,
) -> Result<PathBuf, String> {
    Ok(pending_uploads_dir(app)?.join(format!(
        "clips-fullscreen-{safe_id}-{}.{}",
        std::process::id(),
        extension.trim_start_matches('.')
    )))
}

fn sanitize_path_component(value: &str, fallback: &str) -> String {
    let safe: String = value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if safe.is_empty() {
        fallback.to_string()
    } else {
        safe
    }
}

fn native_extension_for_mime_type(mime_type: &str) -> &'static str {
    if mime_type.eq_ignore_ascii_case(MP4_RECORDING_MIME_TYPE) {
        "mp4"
    } else {
        "mov"
    }
}

#[cfg(target_os = "macos")]
fn normalize_audio_device_name(value: &str) -> String {
    // Collapse to lowercase alphanumeric tokens so WebKit labels and CoreAudio
    // names compare equal despite punctuation/possessive differences
    // (e.g. "User's AirPods" vs "User AirPods", "Mic (Default)" vs "Mic").
    value
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(target_os = "macos")]
fn names_match(a: &str, b: &str) -> bool {
    let a = normalize_audio_device_name(a);
    let b = normalize_audio_device_name(b);
    if a.is_empty() || b.is_empty() {
        return false;
    }
    if a == b || a.contains(&b) || b.contains(&a) {
        return true;
    }
    // Token-subset fallback: every token of the shorter name must appear in the
    // longer one (covers reordering and dropped possessives that substring
    // matching misses, e.g. "User's AirPods" -> "User s airpods").
    let a_tokens: Vec<&str> = a.split(' ').collect();
    let b_tokens: Vec<&str> = b.split(' ').collect();
    let (short, long) = if a_tokens.len() <= b_tokens.len() {
        (&a_tokens, &b_tokens)
    } else {
        (&b_tokens, &a_tokens)
    };
    short.iter().all(|token| long.contains(token))
}

#[cfg(target_os = "macos")]
fn is_built_in_input_name(value: &str) -> bool {
    let value = normalize_audio_device_name(value);
    value.contains("macbook")
        || value.contains("built in")
        || value.contains("builtin")
        || value.contains("internal microphone")
}

#[cfg(target_os = "macos")]
fn is_phone_input_name(value: &str) -> bool {
    let value = normalize_audio_device_name(value);
    value.contains("iphone")
        || value.contains("ipad")
        || value.contains("continuity")
        || value.contains("phone microphone")
}

#[cfg(target_os = "macos")]
fn preferred_default_microphone_device(devices: &[AudioInputDevice]) -> Option<AudioInputDevice> {
    devices
        .iter()
        .find(|device| is_built_in_input_name(&device.name))
        .or_else(|| {
            devices
                .iter()
                .find(|device| !is_phone_input_name(&device.name))
        })
        .cloned()
}

#[cfg(target_os = "macos")]
pub(crate) fn resolve_microphone_capture_device(
    device_id: Option<&str>,
    device_label: Option<&str>,
) -> Result<Option<AudioInputDevice>, String> {
    let device_id = device_id.map(str::trim).filter(|value| !value.is_empty());
    let device_label = device_label
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let devices = AudioInputDevice::list();
    devices.iter().for_each(|device| {
        eprintln!(
            "[clips-tray] audio input device: id={} name={}",
            device.id, device.name
        );
    });

    if device_id.is_none() && device_label.is_none() {
        let resolved = preferred_default_microphone_device(&devices);
        eprintln!(
            "[clips-tray] mic resolve: no explicit input provided -> {}",
            match &resolved {
                Some(device) => format!("using {} ({})", device.name, device.id),
                None => "using macOS default input".to_string(),
            }
        );
        return Ok(resolved);
    }

    let resolved = device_id
        .and_then(|id| devices.iter().find(|device| device.id == id))
        .or_else(|| {
            device_label.and_then(|label| {
                devices
                    .iter()
                    .find(|device| names_match(&device.name, label))
            })
        })
        .cloned();

    eprintln!(
        "[clips-tray] mic resolve: requested id={device_id:?} label={device_label:?} -> {}",
        match &resolved {
            Some(device) => format!("matched {} ({})", device.name, device.id),
            None => "NO MATCH".to_string(),
        }
    );

    resolved.map(Some).ok_or_else(|| {
        let requested = device_label.or(device_id).unwrap_or("selected microphone");
        let available = devices
            .iter()
            .map(|device| device.name.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "Selected microphone '{requested}' is not available to ScreenCaptureKit. Available inputs: {available}"
        )
    })
}

fn local_role_file_stem(role: &str) -> &'static str {
    match role {
        "composed" => "clip",
        "desktop" => "desktop",
        _ => "desktop",
    }
}

fn move_or_copy_file(from: &Path, to: &Path) -> Result<(), String> {
    if let Err(rename_err) = std::fs::rename(from, to) {
        std::fs::copy(from, to).map_err(|copy_err| {
            format!("local recording copy failed: {copy_err}; rename failed: {rename_err}")
        })?;
        std::fs::remove_file(from)
            .map_err(|remove_err| format!("local recording cleanup failed: {remove_err}"))?;
    }
    Ok(())
}

fn save_native_recording_to_local_export(
    app: &AppHandle,
    session: &NativeFullscreenSession,
    folder_name: &str,
    file_role: &str,
    duration_ms: u128,
) -> Result<NativeFullscreenSaveResult, String> {
    let safe_folder_name = sanitize_path_component(folder_name, "clip");
    let safe_role = match file_role {
        "composed" | "desktop" => file_role,
        _ => "desktop",
    };
    let folder = app
        .path()
        .video_dir()
        .map_err(|e| format!("videos directory unavailable: {e}"))?
        .join("Clips")
        .join(&safe_folder_name);
    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("local recording folder unavailable: {e}"))?;

    let extension = native_extension_for_mime_type(session.mime_type);
    let file_name = format!("{}.{}", local_role_file_stem(safe_role), extension);
    let destination = folder.join(&file_name);
    let _ = std::fs::remove_file(&destination);
    move_or_copy_file(&session.path, &destination)?;

    let bytes = std::fs::metadata(&destination)
        .map_err(|e| format!("local recording metadata unavailable: {e}"))?
        .len();
    if bytes == 0 {
        let _ = std::fs::remove_file(&destination);
        return Err("Native recording produced an empty file.".into());
    }

    Ok(NativeFullscreenSaveResult {
        recording_id: safe_folder_name,
        folder_path: folder.to_string_lossy().to_string(),
        file: NativeLocalRecordingFile {
            role: safe_role.to_string(),
            path: destination.to_string_lossy().to_string(),
            file_name,
            mime_type: session.mime_type.to_string(),
            bytes,
            duration_ms,
            width: session.width,
            height: session.height,
        },
    })
}

fn saved_recording_metadata_path(app: &AppHandle, recording_id: &str) -> Result<PathBuf, String> {
    let safe_id = sanitize_recording_id(recording_id);
    Ok(pending_uploads_dir(app)?.join(format!("{safe_id}.json")))
}

fn thumbnail_path(app: &AppHandle, recording_id: &str) -> Result<PathBuf, String> {
    let safe_id = sanitize_recording_id(recording_id);
    pending_recording_path(app, &format!("{safe_id}-thumb"), "jpg")
}

fn resized_thumbnail_path(path: &Path) -> PathBuf {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("thumbnail");
    path.with_file_name(format!("{stem}-1280.jpg"))
}

fn thumbnail_file_for_upload(path: &Path) -> Result<PathBuf, String> {
    let original_bytes = std::fs::metadata(path)
        .map_err(|e| format!("thumbnail metadata unavailable: {e}"))?
        .len();
    if original_bytes <= THUMBNAIL_MAX_BYTES || !std::path::Path::new(SIPS_PATH).exists() {
        return Ok(path.to_path_buf());
    }

    let resized_path = resized_thumbnail_path(path);
    let _ = std::fs::remove_file(&resized_path);
    let status = Command::new(SIPS_PATH)
        .arg("--resampleWidth")
        .arg(THUMBNAIL_WIDTH)
        .arg("--setProperty")
        .arg("format")
        .arg("jpeg")
        .arg("--setProperty")
        .arg("formatOptions")
        .arg("85")
        .arg(path)
        .arg("--out")
        .arg(&resized_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("thumbnail resize failed: {e}"))?;

    if !status.success() {
        let _ = std::fs::remove_file(&resized_path);
        return Ok(path.to_path_buf());
    }

    let resized_bytes = std::fs::metadata(&resized_path)
        .map_err(|e| format!("resized thumbnail metadata unavailable: {e}"))?
        .len();
    if resized_bytes == 0 || resized_bytes > original_bytes {
        let _ = std::fs::remove_file(&resized_path);
        return Ok(path.to_path_buf());
    }

    Ok(resized_path)
}

fn capture_thumbnail_bytes(app: &AppHandle, recording_id: &str) -> Result<Vec<u8>, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, recording_id);
        Err("Native full-screen thumbnails are currently macOS-only.".into())
    }

    #[cfg(target_os = "macos")]
    {
        if !std::path::Path::new("/usr/sbin/screencapture").exists() {
            return Err("macOS screencapture is unavailable on this machine.".into());
        }

        let path = thumbnail_path(app, recording_id)?;
        let _ = std::fs::remove_file(&path);
        let thumb_display_flag = tray_display_id(app)
            .and_then(|id| {
                CGDisplay::active_displays().ok().and_then(|ids| {
                    ids.iter()
                        .position(|&aid| aid == id)
                        .map(|p| format!("-D{}", p + 1))
                })
            })
            .unwrap_or_else(|| "-D1".to_string());
        let status = Command::new("/usr/sbin/screencapture")
            .arg("-x")
            .arg("-t")
            .arg("jpg")
            .arg(thumb_display_flag)
            .arg(&path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| format!("thumbnail capture failed: {e}"))?;
        if !status.success() {
            let _ = std::fs::remove_file(&path);
            return Err(format!("thumbnail capture exited with {status}"));
        }

        let upload_path = thumbnail_file_for_upload(&path)?;
        let bytes =
            std::fs::read(&upload_path).map_err(|e| format!("thumbnail read failed: {e}"))?;
        if upload_path != path {
            let _ = std::fs::remove_file(&upload_path);
        }
        let _ = std::fs::remove_file(&path);
        if bytes.is_empty() {
            return Err("Thumbnail capture produced an empty file.".into());
        }
        Ok(bytes)
    }
}

fn saved_recording_from_session(
    session: &NativeFullscreenSession,
    server_url: &str,
    recording_id: &str,
    duration_ms: u128,
    has_audio: bool,
    has_camera: bool,
) -> Result<SavedNativeRecording, String> {
    saved_recording_from_path(
        session,
        &session.path,
        Vec::new(),
        server_url,
        recording_id,
        duration_ms,
        has_audio,
        has_camera,
    )
}

fn saved_recording_from_segments(
    session: &NativeFullscreenSession,
    server_url: &str,
    recording_id: &str,
    duration_ms: u128,
    has_audio: bool,
    has_camera: bool,
) -> Result<SavedNativeRecording, String> {
    let segment_paths: Vec<PathBuf> = session
        .segments
        .iter()
        .filter(|path| path.exists())
        .cloned()
        .collect();
    let fallback_path = segment_paths
        .iter()
        .find(|path| playable_recording_file(path, session.mime_type))
        .or_else(|| {
            segment_paths.iter().find(|path| {
                std::fs::metadata(path)
                    .map(|meta| meta.len() > 0)
                    .unwrap_or(false)
            })
        })
        .cloned()
        .ok_or_else(|| "No local recording segment survived consolidation failure.".to_string())?;

    saved_recording_from_path(
        session,
        &fallback_path,
        segment_paths,
        server_url,
        recording_id,
        duration_ms,
        has_audio,
        has_camera,
    )
}

fn saved_recording_from_path(
    session: &NativeFullscreenSession,
    file_path: &Path,
    segment_paths: Vec<PathBuf>,
    server_url: &str,
    recording_id: &str,
    duration_ms: u128,
    has_audio: bool,
    has_camera: bool,
) -> Result<SavedNativeRecording, String> {
    let bytes = std::fs::metadata(file_path)
        .map_err(|e| {
            let diag = describe_recording_path(file_path);
            eprintln!(
                "[clips-tray] native recording file missing at save: {e}; backend={}, segments={}, {diag}",
                session.mime_type,
                session.segments.len(),
            );
            format!("native recording file missing: {e}")
        })?
        .len();
    if bytes == 0 {
        eprintln!(
            "[clips-tray] native recording empty at save: {}",
            describe_recording_path(file_path)
        );
        return Err("Native recording produced an empty file.".into());
    }

    Ok(SavedNativeRecording {
        recording_id: recording_id.to_string(),
        server_url: server_url.trim_end_matches('/').to_string(),
        file_path: file_path.to_path_buf(),
        segment_paths,
        mime_type: session.mime_type.to_string(),
        duration_ms,
        width: session.width,
        height: session.height,
        bytes,
        has_audio,
        mic_captured: session.restart.mic_captured_in_file,
        system_audio_captured: session.restart.capture_system_audio,
        has_camera,
        saved_at: now_iso(),
        last_attempt_at: None,
        last_error: None,
        retry_count: 0,
        custom_pipeline: session.custom_pipeline,
        corrupt: false,
    })
}

fn write_saved_recording_metadata(
    app: &AppHandle,
    saved: &SavedNativeRecording,
) -> Result<(), String> {
    let path = saved_recording_metadata_path(app, &saved.recording_id)?;
    let data = serde_json::to_vec_pretty(saved)
        .map_err(|e| format!("pending recording metadata encode failed: {e}"))?;
    std::fs::write(path, data).map_err(|e| format!("pending recording metadata write failed: {e}"))
}

fn read_saved_recording_metadata_path(path: &Path) -> Result<SavedNativeRecording, String> {
    let data =
        std::fs::read(path).map_err(|e| format!("pending recording metadata read failed: {e}"))?;
    serde_json::from_slice(&data)
        .map_err(|e| format!("pending recording metadata decode failed: {e}"))
}

fn read_saved_recording_metadata(
    app: &AppHandle,
    recording_id: &str,
) -> Result<SavedNativeRecording, String> {
    let path = saved_recording_metadata_path(app, recording_id)?;
    read_saved_recording_metadata_path(&path)
}

fn remove_saved_file(path: &Path, label: &str) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!("{label} remove failed: {err}")),
    }
}

fn clear_saved_recording(app: &AppHandle, saved: &SavedNativeRecording) -> Result<(), String> {
    remove_saved_file(&saved.file_path, "pending recording file")?;
    for segment_path in &saved.segment_paths {
        if segment_path != &saved.file_path {
            remove_saved_file(segment_path, "pending recording segment")?;
        }
    }
    let path = saved_recording_metadata_path(app, &saved.recording_id)?;
    remove_saved_file(&path, "pending recording metadata")
}

fn clear_saved_recording_after_success(app: &AppHandle, saved: &SavedNativeRecording) {
    if let Err(err) = clear_saved_recording(app, saved) {
        eprintln!(
            "[clips-tray] upload succeeded for {}, but local pending recording cleanup failed: {err}",
            saved.recording_id
        );
    } else {
        eprintln!(
            "[clips-tray] upload succeeded for {}; removed local recording file",
            saved.recording_id
        );
    }
}

fn persist_saved_recording_error(app: &AppHandle, saved: &mut SavedNativeRecording, error: &str) {
    saved.last_attempt_at = Some(now_iso());
    saved.last_error = Some(error.to_string());
    saved.retry_count = saved.retry_count.saturating_add(1);
    let _ = write_saved_recording_metadata(app, saved);
}

#[cfg(target_os = "macos")]
/// Return the `CGDirectDisplayID` of the display containing the centre of
/// the last-clicked tray icon. Uses the Tauri monitor list to locate the
/// right monitor and converts from physical pixels to the logical-point
/// coordinate space that `CGDisplay::displays_with_point` requires.
/// Returns `None` when the tray anchor hasn't been set yet or any lookup
/// fails — callers fall back to the first available display.
#[cfg(target_os = "macos")]
pub(crate) fn tray_display_id(app: &AppHandle) -> Option<u32> {
    let tray_rect = app
        .try_state::<crate::state::TrayAnchor>()
        .and_then(|a| a.0.lock().ok().and_then(|g| *g))?;

    let icon_x = match tray_rect.position {
        tauri::Position::Physical(p) => p.x as f64,
        tauri::Position::Logical(p) => p.x,
    };
    let icon_y = match tray_rect.position {
        tauri::Position::Physical(p) => p.y as f64,
        tauri::Position::Logical(p) => p.y,
    };
    let icon_w = match tray_rect.size {
        tauri::Size::Physical(s) => s.width as f64,
        tauri::Size::Logical(s) => s.width,
    };
    let icon_h = match tray_rect.size {
        tauri::Size::Physical(s) => s.height as f64,
        tauri::Size::Logical(s) => s.height,
    };

    let cx_phys = icon_x + icon_w / 2.0;
    let cy_phys = icon_y + icon_h / 2.0;

    // CGDisplay uses logical (point) coordinates; Tauri gives physical pixels.
    // Divide by the monitor's scale factor to convert.
    let scale = app
        .get_webview_window("popover")
        .and_then(|w| w.available_monitors().ok())
        .and_then(|monitors| {
            monitors.into_iter().find(|m| {
                let mp = m.position();
                let ms = m.size();
                cx_phys as i32 >= mp.x
                    && (cx_phys as i32) < mp.x + ms.width as i32
                    && cy_phys as i32 >= mp.y
                    && (cy_phys as i32) < mp.y + ms.height as i32
            })
        })
        .map(|m| m.scale_factor())
        .unwrap_or(2.0);

    let point = CGPoint::new(cx_phys / scale, cy_phys / scale);
    let (ids, _) = CGDisplay::displays_with_point(point, 4).ok()?;
    ids.into_iter().next()
}

#[cfg(target_os = "macos")]
fn start_screencapturekit_recording(
    app: &AppHandle,
    safe_id: &str,
    include_audio: bool,
    capture_system_audio: bool,
    mic_device_id: Option<&str>,
    mic_device_label: Option<&str>,
    capture_region: Option<NativeCaptureRegion>,
    defer_recording_output: bool,
) -> Result<NativeFullscreenSession, String> {
    let target_display_id = tray_display_id(app);
    let path = pending_recording_path(app, safe_id, "mp4")?;
    let _ = std::fs::remove_file(&path);
    let use_custom_sck_pipeline = crate::remote_flags::current().use_custom_sck_pipeline;
    eprintln!(
        "[clips-tray] starting ScreenCaptureKit recording. use_custom_sck_pipeline = {}, path -> {}",
        use_custom_sck_pipeline,
        path.display()
    );
    let check_path = path.parent().unwrap_or(&path);
    if let Some(free) = free_disk_bytes(check_path) {
        if free < DISK_SPACE_BLOCK_BYTES {
            return Err(format!(
                "Not enough disk space to record. Free up at least {} and try again (currently {} free).",
                format_mb(DISK_SPACE_BLOCK_BYTES),
                format_mb(free)
            ));
        } else if free < DISK_SPACE_WARN_BYTES {
            eprintln!(
                "[clips-tray] low disk space at recording start: {} free — recording may fail if space runs out",
                format_mb(free)
            );
        }
    }
    let (backend, width, height) = if use_custom_sck_pipeline {
        start_custom_screencapturekit_backend_at(
            app,
            &path,
            include_audio,
            capture_system_audio,
            mic_device_id,
            mic_device_label,
            target_display_id,
            capture_region,
            defer_recording_output,
        )?
    } else {
        start_screencapturekit_backend_at(
            &path,
            include_audio,
            capture_system_audio,
            mic_device_id,
            mic_device_label,
            target_display_id,
            capture_region,
            defer_recording_output,
        )?
    };
    let (fallback_width, fallback_height) = primary_monitor_size(app);
    let mut session = new_fullscreen_session(
        backend,
        path,
        MP4_RECORDING_MIME_TYPE,
        width.or(fallback_width),
        height.or(fallback_height),
        RestartInfo {
            safe_id: safe_id.to_string(),
            include_audio,
            capture_system_audio,
            mic_captured_in_file: include_audio,
            mic_device_id: mic_device_id.map(str::to_string),
            mic_device_label: mic_device_label.map(str::to_string),
            segment_counter: 0,
            target_display_id,
            capture_region,
        },
    );
    session.pending_recording_output = defer_recording_output;
    session.disk_monitor_stop = Some(spawn_disk_monitor(app.clone(), session.path.clone()));
    Ok(session)
}

#[cfg(target_os = "macos")]
fn start_screencapture_recording(
    app: &AppHandle,
    safe_id: &str,
    include_audio: bool,
    capture_system_audio: bool,
    capture_region: Option<NativeCaptureRegion>,
) -> Result<NativeFullscreenSession, String> {
    let target_display_id = tray_display_id(app);
    let path = pending_recording_path(app, safe_id, "mov")?;
    let _ = std::fs::remove_file(&path);
    eprintln!(
        "[clips-tray] starting screencapture (fallback) recording -> {}",
        path.display()
    );
    if let Some(free) = free_disk_bytes(path.parent().unwrap_or(&path)) {
        if free < DISK_SPACE_BLOCK_BYTES {
            return Err(format!(
                "Not enough disk space to record. Free up at least {} and try again (currently {} free).",
                format_mb(DISK_SPACE_BLOCK_BYTES),
                format_mb(free)
            ));
        } else if free < DISK_SPACE_WARN_BYTES {
            eprintln!(
                "[clips-tray] low disk space at recording start: {} free — recording may fail if space runs out",
                format_mb(free)
            );
        }
    }
    let (backend, w, h) = start_screencapture_backend_at(
        app,
        &path,
        include_audio,
        target_display_id,
        capture_region,
    )?;
    let (fallback_width, fallback_height) = primary_monitor_size(app);
    let mut session = new_fullscreen_session(
        backend,
        path,
        QUICKTIME_RECORDING_MIME_TYPE,
        w.or(fallback_width),
        h.or(fallback_height),
        RestartInfo {
            safe_id: safe_id.to_string(),
            include_audio,
            // screencapture (fallback) can't capture system audio; tracked
            // for parity but only `-g` mic is honored by that backend.
            capture_system_audio,
            mic_captured_in_file: include_audio,
            mic_device_id: None,
            mic_device_label: None,
            segment_counter: 0,
            target_display_id,
            capture_region,
        },
    );
    session.disk_monitor_stop = Some(spawn_disk_monitor(app.clone(), session.path.clone()));
    Ok(session)
}

/// Build a fresh `NativeFullscreenSession` around a freshly-started
/// backend. Centralizes the bookkeeping so the two starters (and any
/// future ones) can't drift on default field values.
fn new_fullscreen_session(
    backend: NativeFullscreenBackend,
    path: PathBuf,
    mime_type: &'static str,
    width: Option<u32>,
    height: Option<u32>,
    restart: RestartInfo,
) -> NativeFullscreenSession {
    #[cfg(target_os = "macos")]
    let custom_pipeline = matches!(
        backend,
        NativeFullscreenBackend::CustomScreenCaptureKit { .. }
    );
    #[cfg(not(target_os = "macos"))]
    let custom_pipeline = false;
    let now = Instant::now();
    NativeFullscreenSession {
        backend: Some(backend),
        path: path.clone(),
        mime_type,
        started_at: now,
        width,
        height,
        segments: vec![path],
        paused_total: Duration::ZERO,
        current_segment_started_at: now,
        lost_segment_duration: Duration::ZERO,
        lost_segment_count: 0,
        paused_at: None,
        restart,
        pending_recording_output: false,
        custom_pipeline,
        #[cfg(target_os = "macos")]
        live_upload: None,
        had_live_upload: false,
        disk_monitor_stop: None,
    }
}

pub(crate) fn primary_monitor_size(app: &AppHandle) -> (Option<u32>, Option<u32>) {
    let monitor_size = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| *monitor.size());
    (
        monitor_size.map(|size| size.width),
        monitor_size.map(|size| size.height),
    )
}

#[cfg(target_os = "macos")]
fn even_dimension(value: u32) -> u32 {
    ((value.max(2)) / 2) * 2
}

#[cfg(target_os = "macos")]
fn native_capture_dimensions(width: u32, height: u32) -> (u32, u32) {
    let long_side = width.max(height).max(1);
    let scale = if long_side > NATIVE_CAPTURE_MAX_LONG_EDGE {
        NATIVE_CAPTURE_MAX_LONG_EDGE as f64 / long_side as f64
    } else {
        1.0
    };
    (
        even_dimension((width as f64 * scale).floor() as u32),
        even_dimension((height as f64 * scale).floor() as u32),
    )
}

#[cfg(target_os = "macos")]
fn region_source_rect(
    region: Option<NativeCaptureRegion>,
    source_width: u32,
    source_height: u32,
) -> Result<Option<(CGRect, u32, u32)>, String> {
    let Some(region) = region else {
        return Ok(None);
    };
    let clamp_unit = |value: f64| {
        if value.is_finite() {
            value.clamp(0.0, 1.0)
        } else {
            0.0
        }
    };
    let source_width = source_width.max(2);
    let source_height = source_height.max(2);
    let x = clamp_unit(region.x) * source_width as f64;
    let y = clamp_unit(region.y) * source_height as f64;
    let max_width = (source_width as f64 - x).max(1.0);
    let max_height = (source_height as f64 - y).max(1.0);
    let width = (clamp_unit(region.width) * source_width as f64)
        .clamp(1.0, max_width)
        .floor();
    let height = (clamp_unit(region.height) * source_height as f64)
        .clamp(1.0, max_height)
        .floor();

    let width_u32 = width as u32;
    let height_u32 = height as u32;
    if width_u32 < 2 || height_u32 < 2 {
        return Err("Recording region is too small.".into());
    }

    Ok(Some((
        CGRect::new(x.floor(), y.floor(), width, height),
        width_u32,
        height_u32,
    )))
}

/// How long to wait for `SCRecordingOutput` to flush its trailing fragment
/// and write the `moov` after we ask it to stop. Normal finalize is well
/// under a second for these clips; this is only a safety ceiling for the
/// degraded case where the delegate never fires (we then save as-is rather
/// than hang the stop button forever).
#[cfg(target_os = "macos")]
const SCK_FINALIZE_TIMEOUT: Duration = Duration::from_secs(10);

/// Stop the active recording. When `wait_for_finalize` is set (save/upload
/// paths — the file is about to be moved) this blocks until ScreenCaptureKit
/// signals the recording finished, so the caller never moves a half-written
/// MP4. Cancel passes `false` (the file is discarded immediately, so there's
/// nothing to wait for and no reason to delay teardown).
pub(crate) fn stop_native_recording(
    backend: &mut NativeFullscreenBackend,
    wait_for_finalize: bool,
) -> Result<(), String> {
    match backend {
        NativeFullscreenBackend::Screencapture { child } => stop_screencapture(child),
        #[cfg(target_os = "macos")]
        NativeFullscreenBackend::CustomScreenCaptureKit {
            stream,
            writer,
            watchdog_shutdown,
            ..
        } => {
            eprintln!(
                "[clips-tray] stopping custom capture (wait_for_finalize={wait_for_finalize})"
            );
            // Stop the watchdog first so it can't rebuild the stream out from
            // under us mid-teardown.
            watchdog_shutdown.store(true, Ordering::SeqCst);
            let stop_result = stream
                .lock()
                .map_err(|e| format!("custom ScreenCaptureKit stop lock poisoned: {e}"))
                .and_then(|guard| {
                    guard
                        .stop_capture()
                        .map_err(|e| format!("custom ScreenCaptureKit stop failed: {e:?}"))
                });
            if let Err(err) = &stop_result {
                eprintln!("[clips-tray] custom capture stop_capture error: {err}");
            }
            let finish_result = writer.finish(wait_for_finalize);
            // The finalize/segment-write result reflects on-disk file integrity,
            // so it takes priority over a (possibly benign) stop_capture error
            // and is tagged so the upload path fails closed instead of
            // publishing a truncated clip.
            match finish_result {
                Ok(()) => stop_result,
                Err(err) => Err(format!("{CAPTURE_FINALIZE_INCOMPLETE_PREFIX}{err}")),
            }
        }
        #[cfg(target_os = "macos")]
        NativeFullscreenBackend::ScreenCaptureKit { stream, finish, .. } => {
            // `remove_recording_output()` looks like the clean stop path, but
            // on real machines it can block synchronously forever when the
            // underlying SCStream connection is interrupted. `stop_capture()`
            // returns control to us, then the delegate callback is bounded by
            // `SCK_FINALIZE_TIMEOUT`; the moov/audio guards below decide
            // whether the resulting file is uploadable or recoverable.
            let stop_result = stream
                .stop_capture()
                .map_err(|e| format!("ScreenCaptureKit stop failed: {e:?}"));
            let mut waited_for_finalize = false;
            let finalize_outcome = if wait_for_finalize {
                waited_for_finalize = true;
                let outcome = finish.wait(SCK_FINALIZE_TIMEOUT);
                if outcome.is_none() {
                    eprintln!(
                        "[clips-tray] SCRecordingOutput finalize callback did not fire within {}s after stop_capture; saving file as-is",
                        SCK_FINALIZE_TIMEOUT.as_secs()
                    );
                }
                outcome
            } else {
                None
            };

            // Check the delegate outcome BEFORE returning on stop_result. When
            // stop_capture() fails AND recording_did_fail fires, callers must see
            // the "finalization callback failed" prefix to correctly identify
            // permanent corruption — the stop_capture error string would mask it.
            if let Some(Err(err)) = &finalize_outcome {
                eprintln!("[clips-tray] SCK finalize failed: {err}");
                // Use a unique prefix so callers can distinguish the SCK delegate
                // reporting failure (recording_did_fail) from teardown API errors.
                return Err(format!(
                    "ScreenCaptureKit finalization callback failed: {err}"
                ));
            }

            if waited_for_finalize && finalize_outcome.is_none() {
                eprintln!(
                    "[clips-tray] SCK finalize timed out after {}s — moov atom may be missing",
                    SCK_FINALIZE_TIMEOUT.as_secs()
                );
            }

            if let Err(stop_err) = stop_result {
                if matches!(finalize_outcome.as_ref(), Some(Ok(()))) {
                    eprintln!(
                        "[clips-tray] ScreenCaptureKit stop_capture reported an error after finalize completed; continuing upload: {stop_err}"
                    );
                } else {
                    return Err(stop_err);
                }
            }

            Ok(())
        }
    }
}

fn stop_screencapture(child: &mut Child) -> Result<(), String> {
    if child
        .try_wait()
        .map_err(|e| format!("screencapture status check failed: {e}"))?
        .is_some()
    {
        return Ok(());
    }

    let pid = child.id().to_string();
    let _ = Command::new("/bin/kill")
        .arg("-INT")
        .arg(&pid)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if child
            .try_wait()
            .map_err(|e| format!("screencapture wait failed: {e}"))?
            .is_some()
        {
            return Ok(());
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Timed out stopping native screen recorder.".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

async fn upload_recording_file(
    app: &AppHandle,
    session: &NativeFullscreenSession,
    server_url: String,
    recording_id: String,
    auth_token: String,
    cookie: String,
    upload_mode: NativeUploadMode,
    duration_ms: u128,
    has_audio: bool,
    has_camera: bool,
) -> Result<NativeFullscreenUploadResult, String> {
    let prepared = prepare_recording_file(
        app,
        &session.path,
        session.mime_type,
        session.width,
        session.height,
        Some(duration_ms),
        has_audio,
        session.restart.mic_captured_in_file,
        session.restart.capture_system_audio,
        session.custom_pipeline,
    )?;
    let upload_result = upload_prepared_recording_file(
        app,
        &prepared,
        server_url,
        recording_id,
        auth_token,
        cookie,
        upload_mode,
        duration_ms,
        session.width,
        session.height,
        has_audio,
        has_camera,
    )
    .await;
    if prepared.temporary {
        let _ = std::fs::remove_file(&prepared.path);
    }
    upload_result
}

fn cleanup_prepared_saved_recording_files(
    prepared: &PreparedRecordingFile,
    retry_combined_path: Option<PathBuf>,
) {
    if prepared.temporary {
        let _ = std::fs::remove_file(&prepared.path);
    }
    if let Some(path) = retry_combined_path {
        if path != prepared.path || !prepared.temporary {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn prepare_saved_recording_file(
    app: &AppHandle,
    saved: &SavedNativeRecording,
) -> Result<(PreparedRecordingFile, Option<PathBuf>), String> {
    let retry_combined_path = if saved.segment_paths.len() > 1 {
        let output = retry_combined_recording_path(saved);
        let _ = std::fs::remove_file(&output);
        concat_saved_recording_segments(&saved.segment_paths, &output)?;
        Some(output)
    } else {
        None
    };
    let source_path = retry_combined_path
        .as_ref()
        .unwrap_or(&saved.file_path)
        .to_path_buf();
    let prepared = prepare_recording_file(
        app,
        &source_path,
        &saved.mime_type,
        saved.width,
        saved.height,
        Some(saved.duration_ms),
        saved.has_audio,
        saved.mic_captured,
        saved.system_audio_captured,
        saved.custom_pipeline,
    )?;
    Ok((prepared, retry_combined_path))
}

fn retry_combined_recording_path(saved: &SavedNativeRecording) -> PathBuf {
    let stem = saved
        .file_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("recording");
    saved
        .file_path
        .with_file_name(format!("{stem}-retry-combined.mp4"))
}

#[cfg(target_os = "macos")]
fn concat_saved_recording_segments(segments: &[PathBuf], output: &Path) -> Result<(), String> {
    concat_mp4_segments(segments, output)
}

#[cfg(not(target_os = "macos"))]
fn concat_saved_recording_segments(_segments: &[PathBuf], _output: &Path) -> Result<(), String> {
    Err("Segment concat is only available on macOS.".into())
}

async fn upload_prepared_recording_file(
    app: &AppHandle,
    prepared: &PreparedRecordingFile,
    server_url: String,
    recording_id: String,
    auth_token: String,
    cookie: String,
    upload_mode: NativeUploadMode,
    duration_ms: u128,
    width: Option<u32>,
    height: Option<u32>,
    has_audio: bool,
    has_camera: bool,
) -> Result<NativeFullscreenUploadResult, String> {
    let total_bytes = prepared.bytes;
    let total_bytes_usize = usize::try_from(total_bytes)
        .map_err(|_| "Native recording is too large to upload on this system.".to_string())?;
    let total_chunks = (total_bytes_usize + UPLOAD_CHUNK_BYTES - 1) / UPLOAD_CHUNK_BYTES;
    let streaming_full_chunks = total_bytes_usize / UPLOAD_CHUNK_BYTES;
    let streaming_remainder = total_bytes_usize % UPLOAD_CHUNK_BYTES;
    let total_posts = if upload_mode == NativeUploadMode::Streaming {
        streaming_full_chunks + 1
    } else {
        total_chunks + 1
    };
    emit_native_upload_progress(app, "uploading", "Uploading clip", None, Some(0.0));
    eprintln!(
        "[clips-tray] native upload starting recording={recording_id} mode={} bytes={total_bytes} posts={total_posts}",
        upload_mode.label()
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("upload client failed: {e}"))?;
    let mut file =
        File::open(&prepared.path).map_err(|e| format!("native recording open failed: {e}"))?;

    if upload_mode == NativeUploadMode::Streaming {
        // Resumable providers require every non-final body to be aligned. The
        // final body may be the unaligned tail; if the file is exactly aligned,
        // an empty final request closes the session.
        for index in 0..streaming_full_chunks {
            let mut buffer = vec![0_u8; UPLOAD_CHUNK_BYTES];
            file.read_exact(&mut buffer)
                .map_err(|e| format!("native recording read failed: {e}"))?;
            send_upload_post(
                &client,
                &server_url,
                &recording_id,
                &auth_token,
                &cookie,
                index,
                total_posts,
                false,
                None,
                &prepared.mime_type,
                width,
                height,
                has_audio,
                has_camera,
                upload_mode,
                false,
                buffer,
            )
            .await?;
            emit_native_upload_progress(
                app,
                "uploading",
                "Uploading clip",
                None,
                Some((index + 1) as f32 / total_posts as f32),
            );
        }

        let mut final_body = vec![0_u8; streaming_remainder];
        if streaming_remainder > 0 {
            file.read_exact(&mut final_body)
                .map_err(|e| format!("native recording read failed: {e}"))?;
        }

        emit_native_upload_progress(
            app,
            "processing",
            "Uploading clip",
            None,
            Some(streaming_full_chunks as f32 / total_posts as f32),
        );
        send_upload_post(
            &client,
            &server_url,
            &recording_id,
            &auth_token,
            &cookie,
            streaming_full_chunks,
            total_posts,
            true,
            Some(duration_ms),
            &prepared.mime_type,
            width,
            height,
            has_audio,
            has_camera,
            upload_mode,
            prepared.locally_transcoded,
            final_body,
        )
        .await?;
    } else {
        for index in 0..total_chunks {
            let mut buffer = vec![0_u8; UPLOAD_CHUNK_BYTES];
            let read = file
                .read(&mut buffer)
                .map_err(|e| format!("native recording read failed: {e}"))?;
            if read == 0 {
                return Err("Native recording ended before all chunks were read.".into());
            }
            buffer.truncate(read);
            send_upload_post(
                &client,
                &server_url,
                &recording_id,
                &auth_token,
                &cookie,
                index,
                total_posts,
                false,
                None,
                &prepared.mime_type,
                width,
                height,
                has_audio,
                has_camera,
                upload_mode,
                false,
                buffer,
            )
            .await?;
            emit_native_upload_progress(
                app,
                "uploading",
                "Uploading clip",
                None,
                Some((index + 1) as f32 / total_posts as f32),
            );
        }

        emit_native_upload_progress(
            app,
            "processing",
            "Uploading clip",
            None,
            Some(total_chunks as f32 / total_posts as f32),
        );
        send_upload_post(
            &client,
            &server_url,
            &recording_id,
            &auth_token,
            &cookie,
            total_chunks,
            total_posts,
            true,
            Some(duration_ms),
            &prepared.mime_type,
            width,
            height,
            has_audio,
            has_camera,
            upload_mode,
            prepared.locally_transcoded,
            Vec::new(),
        )
        .await?;
    }

    emit_native_upload_progress(app, "opening", "Uploading clip", None, Some(1.0));
    Ok(NativeFullscreenUploadResult {
        recording_id,
        duration_ms,
        width,
        height,
        bytes: total_bytes,
    })
}

async fn reset_upload_chunks(
    server_url: &str,
    recording_id: &str,
    mime_type: &str,
    auth_token: &str,
    cookie: &str,
) -> Result<NativeUploadMode, String> {
    let base = server_url.trim_end_matches('/');
    let url = url::Url::parse(&format!("{base}/api/uploads/{recording_id}/reset-chunks"))
        .map_err(|e| format!("invalid reset URL: {e}"))?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("upload reset client failed: {e}"))?;
    let mut request = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("X-Request-Source", "clips-desktop")
        .json(&serde_json::json!({
            "requestStreaming": true,
            "mimeType": mime_type,
        }));
    let trimmed_token = auth_token.trim();
    if !trimmed_token.is_empty() {
        request = request.bearer_auth(trimmed_token);
    }
    let trimmed_cookie = cookie.trim();
    if !trimmed_cookie.is_empty() {
        request = request.header("Cookie", trimmed_cookie);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("native recording retry setup failed: {e}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "native recording retry setup returned {status}: {}",
            body.chars().take(400).collect::<String>()
        ));
    }
    Ok(NativeUploadMode::from_reset_response(&body))
}

async fn upload_thumbnail_bytes(
    server_url: String,
    recording_id: String,
    auth_token: String,
    cookie: String,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let url = thumbnail_upload_url(&server_url, &recording_id)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("thumbnail upload client failed: {e}"))?;
    let mut request = client
        .post(url)
        .header("Content-Type", THUMBNAIL_MIME_TYPE)
        .header("X-Request-Source", "clips-desktop")
        .body(bytes);
    let trimmed_token = auth_token.trim();
    if !trimmed_token.is_empty() {
        request = request.bearer_auth(trimmed_token);
    }
    let trimmed_cookie = cookie.trim();
    if !trimmed_cookie.is_empty() {
        request = request.header("Cookie", trimmed_cookie);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("native thumbnail upload failed: {e}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "native thumbnail upload returned {status}: {}",
            body.chars().take(400).collect::<String>()
        ));
    }
    Ok(())
}

fn thumbnail_upload_url(server_url: &str, recording_id: &str) -> Result<url::Url, String> {
    let base = server_url.trim_end_matches('/');
    url::Url::parse(&format!(
        "{base}/api/recordings/{recording_id}/thumbnail?replace=auto"
    ))
    .map_err(|e| format!("invalid thumbnail upload URL: {e}"))
}

async fn send_upload_post(
    client: &reqwest::Client,
    server_url: &str,
    recording_id: &str,
    auth_token: &str,
    cookie: &str,
    index: usize,
    total: usize,
    is_final: bool,
    duration_ms: Option<u128>,
    mime_type: &str,
    width: Option<u32>,
    height: Option<u32>,
    has_audio: bool,
    has_camera: bool,
    upload_mode: NativeUploadMode,
    locally_transcoded: bool,
    body: Vec<u8>,
) -> Result<(), String> {
    let body_len = body.len();
    let url = upload_url(
        server_url,
        recording_id,
        index,
        total,
        is_final,
        duration_ms,
        mime_type,
        width,
        height,
        has_audio,
        has_camera,
        locally_transcoded,
    )?;
    eprintln!(
        "[clips-tray] native upload post start recording={recording_id} mode={} index={index}/{total} final={is_final} bytes={body_len}",
        upload_mode.label()
    );
    let mut request = client
        .post(url)
        .header("Content-Type", mime_type)
        .header("X-Request-Source", "clips-desktop")
        .body(body);
    let trimmed_token = auth_token.trim();
    if !trimmed_token.is_empty() {
        request = request.bearer_auth(trimmed_token);
    }
    let trimmed_cookie = cookie.trim();
    if !trimmed_cookie.is_empty() {
        request = request.header("Cookie", trimmed_cookie);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("native recording upload failed: {e}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    eprintln!(
        "[live-upload] POST chunk #{index} (final={is_final}) -> {status} for {recording_id}"
    );
    if !status.is_success() {
        return Err(format!(
            "native recording upload returned {status}: {}",
            body.chars().take(400).collect::<String>()
        ));
    }
    eprintln!(
        "[clips-tray] native upload post ok recording={recording_id} mode={} index={index}/{total} final={is_final}",
        upload_mode.label()
    );
    Ok(())
}

fn upload_url(
    server_url: &str,
    recording_id: &str,
    index: usize,
    total: usize,
    is_final: bool,
    duration_ms: Option<u128>,
    mime_type: &str,
    width: Option<u32>,
    height: Option<u32>,
    has_audio: bool,
    has_camera: bool,
    locally_transcoded: bool,
) -> Result<String, String> {
    let base = server_url.trim_end_matches('/');
    let mut url = url::Url::parse(&format!("{base}/api/uploads/{recording_id}/chunk"))
        .map_err(|e| format!("invalid upload URL: {e}"))?;
    {
        let mut query = url.query_pairs_mut();
        query
            .append_pair("index", &index.to_string())
            .append_pair("total", &total.to_string())
            .append_pair("isFinal", if is_final { "1" } else { "0" })
            .append_pair("mimeType", mime_type)
            .append_pair("hasAudio", if has_audio { "1" } else { "0" })
            .append_pair("hasCamera", if has_camera { "1" } else { "0" });
        if let Some(duration_ms) = duration_ms {
            query.append_pair("durationMs", &duration_ms.to_string());
        }
        if let Some(width) = width {
            query.append_pair("width", &width.to_string());
        }
        if let Some(height) = height {
            query.append_pair("height", &height.to_string());
        }
        if is_final && locally_transcoded {
            query.append_pair("locallyTranscoded", "1");
        }
    }
    Ok(url.to_string())
}

/// Returns true when an upload error string indicates the file is permanently
/// corrupt (missing moov atom) and cannot be recovered by retrying.
fn is_moov_corrupt_error(err: &str) -> bool {
    // Matches both the native prepare_recording_file error and the server-side
    // finalize-recording.ts error so the corrupt flag is set regardless of
    // which layer first detected the missing moov atom.
    err.contains("video is missing required metadata") || err.contains("corrupted or incomplete")
}

/// Walk the top-level ISO BMFF boxes of a file and return `Some(true)` when a
/// `moov` box is present, `Some(false)` when the scan reached EOF without
/// finding one (file is unplayable), or `None` when the file could not be
/// read (transient I/O error — callers must not treat this as permanent
/// corruption).
pub(crate) fn mp4_has_moov(path: &Path) -> Option<bool> {
    use std::io::{ErrorKind, Read, Seek, SeekFrom};
    let mut f = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[clips-tray] mp4_has_moov: could not open file for moov scan: {e}");
            return None;
        }
    };
    let mut buf = [0u8; 8];
    loop {
        match f.read_exact(&mut buf) {
            Ok(()) => {}
            Err(e) if e.kind() == ErrorKind::UnexpectedEof => {
                // Clean EOF — moov was never found; file is missing the atom.
                return Some(false);
            }
            Err(_) => return None, // Transient read error; don't mark as corrupt.
        }
        let box_size_raw = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]);
        let box_type = &buf[4..8];
        if box_type == b"moov" {
            return Some(true);
        }
        let skip: u64 = match box_size_raw {
            0 => return Some(false), // box extends to EOF — moov not before it
            1 => {
                // 64-bit extended-size: next 8 bytes hold the real size.
                let mut ext = [0u8; 8];
                match f.read_exact(&mut ext) {
                    Ok(()) => {}
                    Err(e) if e.kind() == ErrorKind::UnexpectedEof => return Some(false),
                    Err(_) => return None,
                }
                let full = u64::from_be_bytes(ext);
                // full includes the 8-byte header + 8-byte ext field (16 total).
                full.saturating_sub(16)
            }
            // Sizes 2-7 are below the minimum valid box size (8 bytes).
            // saturating_sub would produce 0, causing skip=0 and an infinite
            // loop since the file position would never advance.
            n if n < 8 => return Some(false),
            n => (n as u64).saturating_sub(8),
        };
        if skip > 0 {
            // Use SeekFrom::Current with a checked i64 cast; a valid box
            // whose payload exceeds i64::MAX (~9 EiB) is treated as
            // malformed — return Some(false) so callers can surface the
            // error without wrapping or seeking backwards.
            let offset = match i64::try_from(skip) {
                Ok(v) => v,
                Err(_) => return Some(false),
            };
            if f.seek(SeekFrom::Current(offset)).is_err() {
                return None; // seek I/O error — don't assume corruption
            }
        }
    }
}

/// Scan an MP4/QuickTime file for a `soun` (audio) handler nested under the
/// top-level `moov` box (i.e. `moov > trak > mdia > hdlr`). Used to verify
/// that ffmpeg/avconvert actually preserved an audio track rather than
/// silently dropping it — `-map 0:a?` and similar optional maps exit 0 and
/// produce a valid, smaller, video-only MP4 when the source audio stream
/// can't be mapped, so a successful exit status alone can't be trusted when
/// audio is expected. Returns `Some(true)`/`Some(false)` once `moov` has
/// been located and scanned, or `None` when the file could not be read or
/// `moov` could not be found/parsed (transient I/O error or unexpected
/// structure — callers must not treat this as a definite "no audio").
pub(crate) fn mp4_has_audio_track(path: &Path) -> Option<bool> {
    use std::io::{ErrorKind, Read, Seek, SeekFrom};
    let mut f = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[clips-tray] mp4_has_audio_track: could not open file for scan: {e}");
            return None;
        }
    };

    // Walk the top-level boxes (mirrors `mp4_has_moov`) until `moov` is
    // found, then read its entire body into memory. `moov` holds only
    // metadata (no sample data, which lives in `mdat`), so even for large
    // recordings it is at most a few hundred KB — safe to buffer fully.
    let moov = loop {
        let mut buf = [0u8; 8];
        match f.read_exact(&mut buf) {
            Ok(()) => {}
            Err(e) if e.kind() == ErrorKind::UnexpectedEof => return Some(false),
            Err(_) => return None,
        }
        let box_size_raw = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]);
        let box_type = &buf[4..8];
        let body_size: u64 = match box_size_raw {
            0 => return Some(false), // box extends to EOF — can't be moov and something after it
            1 => {
                let mut ext = [0u8; 8];
                match f.read_exact(&mut ext) {
                    Ok(()) => {}
                    Err(e) if e.kind() == ErrorKind::UnexpectedEof => return Some(false),
                    Err(_) => return None,
                }
                u64::from_be_bytes(ext).saturating_sub(16)
            }
            n if n < 8 => return Some(false),
            n => (n as u64).saturating_sub(8),
        };
        if box_type == b"moov" {
            if body_size > 64 * 1024 * 1024 {
                // Implausibly large metadata box — bail rather than buffer
                // tens of MB; treat as unparseable rather than "no audio".
                eprintln!("[clips-tray] mp4_has_audio_track: moov box implausibly large ({body_size} bytes)");
                return None;
            }
            let mut body = vec![0u8; body_size as usize];
            if f.read_exact(&mut body).is_err() {
                return None;
            }
            break body;
        }
        let offset = match i64::try_from(body_size) {
            Ok(v) => v,
            Err(_) => return Some(false),
        };
        if f.seek(SeekFrom::Current(offset)).is_err() {
            return None;
        }
    };

    // Linear scan for `hdlr` boxes within the buffered moov body. hdlr
    // layout: size(4) + type(4) + version(1) + flags(3) + pre_defined(4) +
    // handler_type(4) — so the 4-byte handler type sits 16 bytes after the
    // box header starts (8 bytes header + 8 bytes version/flags/pre_defined).
    let mut i = 0usize;
    while i + 8 <= moov.len() {
        let box_type = &moov[i + 4..i + 8];
        if box_type == b"hdlr" && i + 20 <= moov.len() {
            if &moov[i + 16..i + 20] == b"soun" {
                return Some(true);
            }
        }
        // Advance by one byte at a time rather than by parsed box size:
        // `hdlr`/`mdia`/`trak` box sizes aren't otherwise tracked here, and
        // scanning byte-by-byte for the 4-byte `hdlr` tag is simple, safe
        // (can't run past the buffer), and cheap given moov's small size.
        i += 1;
    }
    Some(false)
}

#[derive(Clone, Copy, Debug)]
struct AudioSignalProbe {
    mean_volume_db: Option<f64>,
    max_volume_db: Option<f64>,
}

impl AudioSignalProbe {
    fn has_audible_signal(self) -> bool {
        let peak_ok = self
            .max_volume_db
            .map(|value| value.is_finite() && value >= AUDIO_SIGNAL_MIN_MAX_VOLUME_DB)
            .unwrap_or(false);
        let mean_ok = self
            .mean_volume_db
            .map(|value| value.is_finite() && value >= AUDIO_SIGNAL_MIN_MEAN_VOLUME_DB)
            .unwrap_or(true);
        peak_ok && mean_ok
    }

    fn summary(self) -> String {
        fn fmt(value: Option<f64>) -> String {
            match value {
                Some(value) if value.is_finite() => format!("{value:.1} dB"),
                Some(value) if value.is_infinite() && value.is_sign_negative() => "-inf dB".into(),
                Some(_) => "non-finite".into(),
                None => "unknown".into(),
            }
        }
        format!(
            "mean_volume={} max_volume={} mean_floor={:.1} dB peak_floor={:.1} dB",
            fmt(self.mean_volume_db),
            fmt(self.max_volume_db),
            AUDIO_SIGNAL_MIN_MEAN_VOLUME_DB,
            AUDIO_SIGNAL_MIN_MAX_VOLUME_DB
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum PreparedAudioSignalDecision {
    AcceptCandidate,
    UseOriginal,
}

fn decide_prepared_audio_signal(
    candidate: AudioSignalProbe,
    source: Option<AudioSignalProbe>,
) -> PreparedAudioSignalDecision {
    if !candidate.has_audible_signal()
        && source
            .map(AudioSignalProbe::has_audible_signal)
            .unwrap_or(false)
    {
        PreparedAudioSignalDecision::UseOriginal
    } else {
        PreparedAudioSignalDecision::AcceptCandidate
    }
}

fn parse_ffmpeg_volume_db(stderr: &str, label: &str) -> Option<f64> {
    stderr.lines().rev().find_map(|line| {
        let (_, value) = line.split_once(label)?;
        let value = value.trim().strip_suffix(" dB").unwrap_or(value.trim());
        if value == "-inf" {
            Some(f64::NEG_INFINITY)
        } else {
            value.parse::<f64>().ok()
        }
    })
}

fn audio_signal_probe_with_ffmpeg(
    ffmpeg_path: &str,
    source: &Path,
) -> Result<AudioSignalProbe, String> {
    let child = Command::new(ffmpeg_path)
        .arg("-hide_banner")
        .arg("-nostdin")
        .arg("-i")
        .arg(source)
        .arg("-map")
        .arg("0:a:0")
        .arg("-af")
        .arg("volumedetect")
        .arg("-f")
        .arg("null")
        .arg("-")
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg audio probe spawn failed: {e}"))?;
    let stderr = wait_for_child_collect_stderr(
        child,
        FFMPEG_AUDIO_PROBE_TIMEOUT,
        "ffmpeg",
        "checking recording audio",
    )?;
    Ok(AudioSignalProbe {
        mean_volume_db: parse_ffmpeg_volume_db(&stderr, "mean_volume:"),
        max_volume_db: parse_ffmpeg_volume_db(&stderr, "max_volume:"),
    })
}

fn describe_audio_signal_probe(probe: Result<AudioSignalProbe, String>) -> String {
    match probe {
        Ok(probe) => probe.summary(),
        Err(err) => format!("probe failed: {err}"),
    }
}

fn verify_prepared_audio_signal(
    ffmpeg_path: &str,
    candidate: &Path,
    original: &PreparedRecordingFile,
    source_path: &Path,
    label: &str,
) -> Result<Option<PreparedRecordingFile>, String> {
    let candidate_probe = match audio_signal_probe_with_ffmpeg(ffmpeg_path, candidate) {
        Ok(probe) => probe,
        Err(err) => {
            eprintln!(
                "[clips-tray] audio signal probe failed for {label}; accepting candidate: {err}"
            );
            return Ok(None);
        }
    };
    if candidate_probe.has_audible_signal() {
        eprintln!(
            "[clips-tray] audio signal probe ok for {label}: {}",
            candidate_probe.summary()
        );
        return Ok(None);
    }

    let source_probe = audio_signal_probe_with_ffmpeg(ffmpeg_path, source_path);
    let source_signal = source_probe.as_ref().ok().copied();
    let source_summary = describe_audio_signal_probe(source_probe);
    if decide_prepared_audio_signal(candidate_probe, source_signal)
        == PreparedAudioSignalDecision::UseOriginal
    {
        eprintln!(
            "[clips-tray] AUDIO QUIET AFTER PREPARE: {label} is effectively silent ({}) but original has signal ({source_summary}) — uploading original instead",
            candidate_probe.summary()
        );
        return Ok(Some(original.clone()));
    }

    eprintln!(
        "[clips-tray] AUDIO CAPTURE QUIET: prepared {label} has an audio track but no usable signal ({}) and original was not usable either ({source_summary}) — publishing the playable candidate",
        candidate_probe.summary()
    );
    // Silence in both files is a capture outcome, not a processing regression.
    // Rejecting it strands the recording in `uploading`, and every retry fails
    // deterministically after re-running the same probes. Only fall back when
    // preparation removed signal that was present in the source.
    Ok(None)
}

fn prepare_recording_file(
    app: &AppHandle,
    path: &Path,
    mime_type: &str,
    width: Option<u32>,
    height: Option<u32>,
    duration_ms: Option<u128>,
    has_audio: bool,
    mic_captured_audio: bool,
    system_audio_captured: bool,
    // The file already contains a single (live-mixed or single-source) audio
    // track written by the custom pipeline; the L/R downmix repair assumes
    // mic and system on separate stereo channels and must not run on it.
    audio_premixed: bool,
) -> Result<PreparedRecordingFile, String> {
    // Downmix only repairs mic+system L/R split. Applying it to mic-only
    // capture halves speech energy (~6 dB) when SCK puts the mic on one channel.
    let downmix_audio = mic_captured_audio && system_audio_captured && !audio_premixed;
    let denoise_audio = mic_captured_audio;
    // Pregain only for mic-only (no system audio compete) — SCK has no AGC.
    let mic_pregain = mic_captured_audio && !system_audio_captured;
    let metadata = std::fs::metadata(path).map_err(|e| {
        let diag = describe_recording_path(path);
        eprintln!("[clips-tray] native recording file missing at prepare: {e}; {diag}");
        format!("native recording file missing: {e}")
    })?;
    let source_bytes = metadata.len();
    if source_bytes == 0 {
        eprintln!(
            "[clips-tray] native recording empty at prepare: {}",
            describe_recording_path(path)
        );
        return Err("Native recording produced an empty file.".into());
    }
    // For MP4/QuickTime files check that a top-level moov atom exists. SCK
    // finalization errors (-5814) produce a file with ftyp + mdat but no
    // moov, making it permanently unplayable. Catching this here avoids a
    // full chunked upload that the server will reject anyway.
    if mime_type == "video/mp4" || mime_type == "video/quicktime" {
        if mp4_has_moov(path) == Some(false) {
            eprintln!("[clips-tray] native recording corrupt moov check failed — skipping upload");
            return Err(
                "Recorded file is corrupted or incomplete — the video is missing required \
                 metadata. Please record again."
                    .into(),
            );
        }
    }
    emit_native_upload_progress(app, "preparing", "Optimizing clip", None, None);

    let original = PreparedRecordingFile {
        path: path.to_path_buf(),
        mime_type: mime_type.to_string(),
        bytes: source_bytes,
        temporary: false,
        locally_transcoded: false,
    };

    let mut smallest_attempt_bytes: Option<u64> = None;
    let ffmpeg_path = resolve_ffmpeg_path();
    if has_audio {
        if let Some(ffmpeg_path) = ffmpeg_path.as_deref() {
            let raw_summary =
                describe_audio_signal_probe(audio_signal_probe_with_ffmpeg(ffmpeg_path, path));
            eprintln!("[clips-tray] raw recording audio signal before prepare: {raw_summary}");
        }
    }
    if !COMPRESSION_ENABLED || source_bytes < TRANSCODE_THRESHOLD_BYTES {
        if has_audio {
            if let Some(ffmpeg_path) = ffmpeg_path.as_deref() {
                let normalized_path = normalized_recording_path(path);
                let _ = std::fs::remove_file(&normalized_path);
                match normalize_audio_with_ffmpeg(
                    ffmpeg_path,
                    path,
                    &normalized_path,
                    downmix_audio,
                    denoise_audio,
                    mic_pregain,
                ) {
                    Ok(()) => {
                        let normalized_bytes = std::fs::metadata(&normalized_path)
                            .map_err(|e| format!("normalized recording file missing: {e}"))?
                            .len();
                        if normalized_bytes > 0 && normalized_bytes <= max_upload_bytes() {
                            if mp4_has_audio_track(&normalized_path) == Some(false) {
                                let _ = std::fs::remove_file(&normalized_path);
                                eprintln!(
                                    "[clips-tray] AUDIO LOST: ffmpeg audio normalization dropped the audio track \
                                     (source had audio, normalized output did not) — uploading original instead of \
                                     a silent smaller file"
                                );
                                return Ok(original);
                            }
                            match verify_prepared_audio_signal(
                                ffmpeg_path,
                                &normalized_path,
                                &original,
                                path,
                                "audio-normalized recording",
                            ) {
                                Ok(Some(fallback)) => {
                                    let _ = std::fs::remove_file(&normalized_path);
                                    return Ok(fallback);
                                }
                                Ok(None) => {}
                                Err(err) => {
                                    let _ = std::fs::remove_file(&normalized_path);
                                    return Err(err);
                                }
                            }
                            eprintln!(
                                "[clips-tray] native recording audio optimized with ffmpeg: {} -> {} bytes",
                                source_bytes, normalized_bytes
                            );
                            return Ok(PreparedRecordingFile {
                                path: normalized_path,
                                mime_type: MP4_RECORDING_MIME_TYPE.to_string(),
                                bytes: normalized_bytes,
                                temporary: true,
                                locally_transcoded: false,
                            });
                        }
                        let _ = std::fs::remove_file(&normalized_path);
                        eprintln!(
                            "[clips-tray] audio normalization produced unusable output ({} bytes); uploading original",
                            normalized_bytes
                        );
                    }
                    Err(err) => {
                        let _ = std::fs::remove_file(&normalized_path);
                        eprintln!(
                            "[clips-tray] audio normalization failed; uploading original: {err}"
                        );
                    }
                }
            } else {
                eprintln!("[clips-tray] ffmpeg unavailable; uploading original without audio normalization");
            }
        }
        return Ok(original);
    }

    if let Some(ffmpeg_path) = ffmpeg_path.as_deref() {
        let presets = ffmpeg_transcode_presets(width, height, source_bytes, duration_ms);
        for (index, preset) in presets.iter().enumerate() {
            emit_native_upload_progress(
                app,
                "compressing",
                "Optimizing clip",
                None,
                Some(index as f32 / presets.len() as f32),
            );
            let compressed_path = compressed_recording_path(path);
            let _ = std::fs::remove_file(&compressed_path);
            match transcode_with_ffmpeg(
                ffmpeg_path,
                path,
                &compressed_path,
                preset,
                width,
                height,
                duration_ms,
                has_audio,
                downmix_audio,
                denoise_audio,
                mic_pregain,
            ) {
                Ok(()) => {
                    let compressed_bytes = std::fs::metadata(&compressed_path)
                        .map_err(|e| format!("compressed recording file missing: {e}"))?
                        .len();
                    if compressed_bytes == 0 {
                        let _ = std::fs::remove_file(&compressed_path);
                        eprintln!(
                            "[clips-tray] ffmpeg produced an empty file with {}",
                            preset.label
                        );
                        continue;
                    }
                    if has_audio && mp4_has_audio_track(&compressed_path) == Some(false) {
                        let _ = std::fs::remove_file(&compressed_path);
                        eprintln!(
                            "[clips-tray] AUDIO LOST: ffmpeg {} dropped the audio track (source had \
                             audio, compressed output did not) — rejecting this preset rather than \
                             uploading a silent smaller file",
                            preset.label
                        );
                        continue;
                    }
                    if has_audio {
                        match verify_prepared_audio_signal(
                            ffmpeg_path,
                            &compressed_path,
                            &original,
                            path,
                            preset.label,
                        ) {
                            Ok(Some(fallback)) => {
                                let _ = std::fs::remove_file(&compressed_path);
                                if fallback.bytes <= max_upload_bytes() {
                                    return Ok(fallback);
                                }
                                eprintln!(
                                    "[clips-tray] original recording has usable audio but is too large to upload without compression ({}); rejecting silent compressed preset {}",
                                    format_mb(fallback.bytes),
                                    preset.label
                                );
                                continue;
                            }
                            Ok(None) => {}
                            Err(err) => {
                                let _ = std::fs::remove_file(&compressed_path);
                                return Err(err);
                            }
                        }
                    }
                    smallest_attempt_bytes = Some(
                        smallest_attempt_bytes
                            .map(|smallest| smallest.min(compressed_bytes))
                            .unwrap_or(compressed_bytes),
                    );
                    if compressed_bytes >= source_bytes {
                        let _ = std::fs::remove_file(&compressed_path);
                        eprintln!(
                            "[clips-tray] ffmpeg {} did not reduce size ({} >= {})",
                            preset.label, compressed_bytes, source_bytes
                        );
                        continue;
                    }
                    if compressed_bytes > max_upload_bytes() {
                        let _ = std::fs::remove_file(&compressed_path);
                        eprintln!(
                            "[clips-tray] ffmpeg {} still above server staging limit ({} bytes)",
                            preset.label, compressed_bytes
                        );
                        continue;
                    }
                    if compressed_bytes > TARGET_UPLOAD_BYTES && index + 1 < presets.len() {
                        let _ = std::fs::remove_file(&compressed_path);
                        eprintln!(
                            "[clips-tray] ffmpeg {} still above target ({} bytes); trying smaller preset",
                            preset.label, compressed_bytes
                        );
                        continue;
                    }
                    emit_native_upload_progress(
                        app,
                        "compressing",
                        "Optimizing clip",
                        None,
                        Some(1.0),
                    );
                    eprintln!(
                        "[clips-tray] native recording transcoded with ffmpeg {}: {} -> {} bytes",
                        preset.label, source_bytes, compressed_bytes
                    );
                    return Ok(PreparedRecordingFile {
                        path: compressed_path,
                        mime_type: MP4_RECORDING_MIME_TYPE.to_string(),
                        bytes: compressed_bytes,
                        temporary: true,
                        locally_transcoded: true,
                    });
                }
                Err(err) => {
                    let _ = std::fs::remove_file(&compressed_path);
                    eprintln!(
                        "[clips-tray] ffmpeg transcode failed with {}: {err}",
                        preset.label
                    );
                }
            }
        }
    } else {
        eprintln!("[clips-tray] ffmpeg unavailable; falling back to avconvert");
    }

    if std::path::Path::new(AVCONVERT_PATH).exists() {
        let presets = native_transcode_presets(width, height, source_bytes);
        for (index, preset) in presets.iter().enumerate() {
            emit_native_upload_progress(
                app,
                "compressing",
                "Optimizing clip",
                None,
                Some(index as f32 / presets.len() as f32),
            );
            let compressed_path = compressed_recording_path(path);
            let _ = std::fs::remove_file(&compressed_path);
            match transcode_with_avconvert(path, &compressed_path, preset) {
                Ok(()) => {
                    let compressed_bytes = std::fs::metadata(&compressed_path)
                        .map_err(|e| format!("compressed recording file missing: {e}"))?
                        .len();
                    if compressed_bytes == 0 {
                        let _ = std::fs::remove_file(&compressed_path);
                        eprintln!("[clips-tray] avconvert produced an empty file with {preset}");
                        continue;
                    }
                    if has_audio && mp4_has_audio_track(&compressed_path) == Some(false) {
                        let _ = std::fs::remove_file(&compressed_path);
                        eprintln!(
                            "[clips-tray] AUDIO LOST: avconvert {preset} dropped the audio track \
                             (source had audio, compressed output did not) — rejecting this preset \
                             rather than uploading a silent smaller file"
                        );
                        continue;
                    }
                    if has_audio {
                        if let Some(ffmpeg_probe_path) = ffmpeg_path.as_deref() {
                            match verify_prepared_audio_signal(
                                ffmpeg_probe_path,
                                &compressed_path,
                                &original,
                                path,
                                preset,
                            ) {
                                Ok(Some(fallback)) => {
                                    let _ = std::fs::remove_file(&compressed_path);
                                    if fallback.bytes <= max_upload_bytes() {
                                        return Ok(fallback);
                                    }
                                    eprintln!(
                                        "[clips-tray] original recording has usable audio but is too large to upload without compression ({}); rejecting silent avconvert preset {}",
                                        format_mb(fallback.bytes),
                                        preset
                                    );
                                    continue;
                                }
                                Ok(None) => {}
                                Err(err) => {
                                    let _ = std::fs::remove_file(&compressed_path);
                                    return Err(err);
                                }
                            }
                        }
                    }
                    smallest_attempt_bytes = Some(
                        smallest_attempt_bytes
                            .map(|smallest| smallest.min(compressed_bytes))
                            .unwrap_or(compressed_bytes),
                    );
                    if compressed_bytes >= source_bytes {
                        let _ = std::fs::remove_file(&compressed_path);
                        eprintln!(
                            "[clips-tray] avconvert {} did not reduce size ({} >= {})",
                            preset, compressed_bytes, source_bytes
                        );
                        continue;
                    }
                    if compressed_bytes > max_upload_bytes() {
                        let _ = std::fs::remove_file(&compressed_path);
                        eprintln!(
                            "[clips-tray] avconvert {} still above server staging limit ({} bytes)",
                            preset, compressed_bytes
                        );
                        continue;
                    }
                    if compressed_bytes > TARGET_UPLOAD_BYTES && index + 1 < presets.len() {
                        let _ = std::fs::remove_file(&compressed_path);
                        eprintln!(
                            "[clips-tray] avconvert {} still above target ({} bytes); trying smaller preset",
                            preset, compressed_bytes
                        );
                        continue;
                    }
                    emit_native_upload_progress(
                        app,
                        "compressing",
                        "Optimizing clip",
                        None,
                        Some(1.0),
                    );
                    eprintln!(
                        "[clips-tray] native recording transcoded with {}: {} -> {} bytes",
                        preset, source_bytes, compressed_bytes
                    );
                    return Ok(PreparedRecordingFile {
                        path: compressed_path,
                        mime_type: MP4_RECORDING_MIME_TYPE.to_string(),
                        bytes: compressed_bytes,
                        temporary: true,
                        locally_transcoded: true,
                    });
                }
                Err(err) => {
                    let _ = std::fs::remove_file(&compressed_path);
                    eprintln!("[clips-tray] avconvert transcode failed with {preset}: {err}");
                }
            }
        }
    } else {
        eprintln!("[clips-tray] avconvert unavailable");
    }
    if source_bytes > max_upload_bytes() {
        let attempt_detail = smallest_attempt_bytes
            .map(|bytes| format!(", smallest compressed result was {}", format_mb(bytes)))
            .unwrap_or_default();
        return Err(format!(
            "Native recording is too large to upload after automatic compression (source {}, limit is {}{}). Try a shorter recording.",
            format_mb(source_bytes),
            format_mb(max_upload_bytes()),
            attempt_detail
        ));
    }
    eprintln!("[clips-tray] avconvert could not reduce recording; uploading original MOV");
    Ok(original)
}

fn compressed_recording_path(path: &Path) -> PathBuf {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("recording");
    path.with_file_name(format!("{stem}-compressed.mp4"))
}

fn normalized_recording_path(path: &Path) -> PathBuf {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("recording");
    path.with_file_name(format!("{stem}-normalized.mp4"))
}

#[derive(Clone, Copy)]
struct FfmpegTranscodePreset {
    label: &'static str,
    max_long_edge: u32,
    max_short_edge: u32,
    crf: u8,
    encoder_preset: &'static str,
    audio_bitrate_kbps: u32,
    max_video_rate_kbps: u32,
}

/// Maximum total bytes a recording upload may be. Overridable per-deployment
/// with the `CLIPS_MAX_UPLOAD_BYTES` env var; falls back to `DEFAULT_MAX_UPLOAD_BYTES` (2 GB).
fn max_upload_bytes() -> u64 {
    std::env::var("CLIPS_MAX_UPLOAD_BYTES")
        .ok()
        .and_then(|raw| raw.trim().parse::<u64>().ok())
        .filter(|&bytes| bytes > 0)
        .unwrap_or(DEFAULT_MAX_UPLOAD_BYTES)
}

fn resolve_ffmpeg_path() -> Option<String> {
    if let Ok(path) = std::env::var("CLIPS_FFMPEG_PATH") {
        let trimmed = path.trim();
        if !trimmed.is_empty() && command_available(trimmed) {
            return Some(trimmed.to_string());
        }
    }
    FFMPEG_CANDIDATE_PATHS
        .iter()
        .copied()
        .find(|candidate| command_available(candidate))
        .map(str::to_string)
}

fn command_available(command: &str) -> bool {
    Command::new(command)
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn duration_video_rate_limit_kbps(
    duration_ms: Option<u128>,
    audio_bitrate_kbps: u32,
) -> Option<f64> {
    let seconds = duration_ms? as f64 / 1000.0;
    if seconds < 1.0 {
        return None;
    }
    let total_kbps = (TARGET_UPLOAD_BYTES as f64 * 8.0 / 1000.0) / seconds;
    let video_kbps = total_kbps - audio_bitrate_kbps as f64 - TRANSCODE_RATE_LIMIT_OVERHEAD_KBPS;
    if !video_kbps.is_finite() {
        return None;
    }
    Some(video_kbps)
}

fn ffmpeg_transcode_presets(
    _width: Option<u32>,
    _height: Option<u32>,
    _source_bytes: u64,
    _duration_ms: Option<u128>,
) -> Vec<FfmpegTranscodePreset> {
    vec![
        FfmpegTranscodePreset {
            label: "HandBrake Fast 1080p30",
            max_long_edge: 1920,
            max_short_edge: 1080,
            crf: 22,
            encoder_preset: "fast",
            audio_bitrate_kbps: 160,
            max_video_rate_kbps: 6_000,
        },
        FfmpegTranscodePreset {
            label: "1080p compact",
            max_long_edge: 1920,
            max_short_edge: 1080,
            crf: 24,
            encoder_preset: "fast",
            audio_bitrate_kbps: 128,
            max_video_rate_kbps: 4_000,
        },
        FfmpegTranscodePreset {
            label: "720p compact",
            max_long_edge: 1280,
            max_short_edge: 720,
            crf: 26,
            encoder_preset: "fast",
            audio_bitrate_kbps: 96,
            max_video_rate_kbps: 2_200,
        },
        FfmpegTranscodePreset {
            label: "540p small",
            max_long_edge: 960,
            max_short_edge: 540,
            crf: 28,
            encoder_preset: "fast",
            audio_bitrate_kbps: 80,
            max_video_rate_kbps: 1_200,
        },
    ]
}

fn even_ffmpeg_dimension(value: u32) -> u32 {
    ((value.max(2)) / 2) * 2
}

fn ffmpeg_scaled_dimensions(
    width: Option<u32>,
    height: Option<u32>,
    max_long_edge: u32,
    max_short_edge: u32,
) -> Option<(u32, u32)> {
    let width = width?;
    let height = height?;
    let long_side = width.max(height).max(1);
    let short_side = width.min(height).max(1);
    let scale = (max_long_edge as f64 / long_side as f64)
        .min(max_short_edge as f64 / short_side as f64)
        .min(1.0);
    Some((
        even_ffmpeg_dimension((width as f64 * scale).floor() as u32),
        even_ffmpeg_dimension((height as f64 * scale).floor() as u32),
    ))
}

fn normalize_audio_with_ffmpeg(
    ffmpeg_path: &str,
    source: &Path,
    output: &Path,
    downmix_audio: bool,
    denoise_audio: bool,
    mic_pregain: bool,
) -> Result<(), String> {
    let audio_bitrate = format!("{NORMALIZED_AUDIO_BITRATE_KBPS}k");
    let mut command = Command::new(ffmpeg_path);
    command
        .arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("warning")
        .arg("-i")
        .arg(source)
        .arg("-map")
        .arg("0:v:0");

    command.arg("-map").arg("0:a?");

    command
        .arg("-c:v")
        .arg("copy")
        .arg("-c:a")
        .arg("aac")
        .arg("-b:a")
        .arg(audio_bitrate)
        .arg("-af")
        .arg(audio_filter_chain(
            downmix_audio,
            denoise_audio,
            mic_pregain,
        ))
        .arg("-ac")
        .arg("2")
        .arg("-ar")
        .arg(AUDIO_OUTPUT_SAMPLE_RATE.to_string())
        .arg("-movflags")
        .arg("+faststart")
        .arg("-f")
        .arg("mp4")
        .arg(output)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let child = command
        .spawn()
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;
    wait_for_transcode_child(child, FFMPEG_TIMEOUT, "ffmpeg")
}

fn native_transcode_presets(
    width: Option<u32>,
    height: Option<u32>,
    source_bytes: u64,
) -> Vec<&'static str> {
    let long_side = width.unwrap_or(0).max(height.unwrap_or(0));
    if source_bytes >= 96 * 1024 * 1024 || long_side > 1920 {
        vec![
            "Preset1280x720",
            "Preset960x540",
            "Preset640x480",
            "PresetAppleM4V480pSD",
            "PresetAppleM4VCellular",
        ]
    } else {
        vec![
            "Preset1280x720",
            "Preset960x540",
            "Preset640x480",
            "PresetAppleM4V480pSD",
            "PresetAppleM4VCellular",
        ]
    }
}

fn transcode_with_ffmpeg(
    ffmpeg_path: &str,
    source: &Path,
    output: &Path,
    preset: &FfmpegTranscodePreset,
    width: Option<u32>,
    height: Option<u32>,
    duration_ms: Option<u128>,
    normalize_audio: bool,
    downmix_audio: bool,
    denoise_audio: bool,
    mic_pregain: bool,
) -> Result<(), String> {
    let mut command = Command::new(ffmpeg_path);
    command
        .arg("-y")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("warning")
        .arg("-i")
        .arg(source)
        .arg("-map")
        .arg("0:v:0");

    command.arg("-map").arg("0:a?");

    if let Some((scaled_w, scaled_h)) =
        ffmpeg_scaled_dimensions(width, height, preset.max_long_edge, preset.max_short_edge)
    {
        command
            .arg("-vf")
            .arg(format!("scale={scaled_w}:{scaled_h}:flags=lanczos"));
    }

    if normalize_audio {
        command.arg("-af").arg(audio_filter_chain(
            downmix_audio,
            denoise_audio,
            mic_pregain,
        ));
    }

    let duration_rate_limit =
        duration_video_rate_limit_kbps(duration_ms, preset.audio_bitrate_kbps)
            .unwrap_or(preset.max_video_rate_kbps as f64);
    let video_rate_limit_kbps = duration_rate_limit.round().clamp(
        MIN_TRANSCODE_VIDEO_RATE_KBPS as f64,
        preset.max_video_rate_kbps as f64,
    ) as u32;
    let maxrate = format!("{video_rate_limit_kbps}k");
    let bufsize = format!("{}k", video_rate_limit_kbps * 2);
    let audio_bitrate = format!("{}k", preset.audio_bitrate_kbps);

    command
        .arg("-fpsmax")
        .arg(TRANSCODE_FRAME_RATE_LIMIT.to_string())
        .arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg(preset.encoder_preset)
        .arg("-profile:v")
        .arg("main")
        .arg("-level:v")
        .arg("4.0")
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-crf")
        .arg(preset.crf.to_string())
        .arg("-maxrate")
        .arg(maxrate)
        .arg("-bufsize")
        .arg(bufsize)
        .arg("-c:a")
        .arg("aac")
        .arg("-b:a")
        .arg(audio_bitrate)
        .arg("-ac")
        .arg("2")
        .arg("-ar")
        .arg(AUDIO_OUTPUT_SAMPLE_RATE.to_string())
        .arg("-movflags")
        .arg("+faststart")
        .arg("-f")
        .arg("mp4")
        .arg(output)
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    let child = command
        .spawn()
        .map_err(|e| format!("ffmpeg spawn failed: {e}"))?;
    wait_for_transcode_child(child, FFMPEG_TIMEOUT, "ffmpeg")
}

fn transcode_with_avconvert(source: &Path, output: &Path, preset: &str) -> Result<(), String> {
    let child = Command::new(AVCONVERT_PATH)
        .arg("--source")
        .arg(source)
        .arg("--preset")
        .arg(preset)
        .arg("--output")
        .arg(output)
        .arg("--replace")
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("avconvert spawn failed: {e}"))?;

    wait_for_transcode_child(child, AVCONVERT_TIMEOUT, "avconvert")
}

fn wait_for_transcode_child(
    child: Child,
    timeout: Duration,
    tool_name: &str,
) -> Result<(), String> {
    wait_for_child_collect_stderr(child, timeout, tool_name, "compressing recording").map(|_| ())
}

fn wait_for_child_collect_stderr(
    mut child: Child,
    timeout: Duration,
    tool_name: &str,
    action: &str,
) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("{tool_name} wait failed: {e}"))?
        {
            let mut stderr = String::new();
            if let Some(mut pipe) = child.stderr.take() {
                let _ = pipe.read_to_string(&mut stderr);
            }
            let tail = stderr
                .lines()
                .rev()
                .take(8)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect::<Vec<_>>()
                .join("\n");
            return if status.success() {
                Ok(stderr)
            } else {
                Err(format!("{tool_name} exited with {status}: {}", tail.trim()))
            };
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("{tool_name} timed out while {action}"));
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

/// Concatenate finalized MP4 segments into a single output file using
/// AVFoundation. We build an `AVMutableComposition` with the video and
/// audio tracks of each segment appended sequentially, then export it
/// via `AVAssetExportSession` with the passthrough preset — no
/// re-encoding, so concat is roughly disk-IO bound. Called from
/// `consolidate_segments_into_path` after every segment has been
/// finalized by `stop_native_recording(_, wait_for_finalize=true)`.
fn validate_recording_segment_file(path: &Path) -> Result<(), String> {
    match std::fs::metadata(path) {
        Ok(meta) if meta.len() > 0 => {}
        Ok(_) => return Err(format!("recording segment is empty: {}", path.display())),
        Err(err) => {
            return Err(format!(
                "recording segment is missing or unreadable: {} ({err})",
                path.display()
            ));
        }
    }
    if mp4_has_moov(path) == Some(false) {
        return Err(format!(
            "recording segment is missing playback metadata: {}",
            path.display()
        ));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn concat_mp4_segments(segments: &[PathBuf], output: &Path) -> Result<(), String> {
    use std::ffi::CString;
    use std::sync::mpsc;
    use std::time::Duration as StdDuration;

    use block2::RcBlock;
    use objc2::encode::{Encode, Encoding, RefEncode};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2::{class, msg_send};

    /// CoreMedia `CMTime`. 24-byte repr-C struct, ABI-stable across
    /// macOS versions.
    #[repr(C)]
    #[derive(Copy, Clone)]
    struct CMTime {
        value: i64,
        timescale: i32,
        flags: u32,
        epoch: i64,
    }

    unsafe impl RefEncode for CMTime {
        const ENCODING_REF: Encoding = Encoding::Pointer(&Self::ENCODING);
    }
    unsafe impl Encode for CMTime {
        const ENCODING: Encoding = Encoding::Struct(
            "CMTime",
            &[i64::ENCODING, i32::ENCODING, u32::ENCODING, i64::ENCODING],
        );
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    struct CMTimeRange {
        start: CMTime,
        duration: CMTime,
    }

    unsafe impl RefEncode for CMTimeRange {
        const ENCODING_REF: Encoding = Encoding::Pointer(&Self::ENCODING);
    }
    unsafe impl Encode for CMTimeRange {
        const ENCODING: Encoding =
            Encoding::Struct("CMTimeRange", &[CMTime::ENCODING, CMTime::ENCODING]);
    }

    // `CMTimeFlags::Valid` == 1. kCMTimeZero is value=0, timescale=1, flags=Valid.
    const CM_TIME_ZERO: CMTime = CMTime {
        value: 0,
        timescale: 1,
        flags: 1,
        epoch: 0,
    };
    /// `kCMPersistentTrackID_Invalid` per CoreMedia headers.
    const KCM_PERSISTENT_TRACK_ID_INVALID: i32 = 0;

    fn class_named(name: &str) -> Option<&'static AnyClass> {
        let bytes = CString::new(name).ok()?;
        AnyClass::get(&bytes)
    }

    // String constants exported by AVFoundation. We read them via dlsym
    // through `extern "C"` so we don't depend on a particular binding
    // crate's surface.
    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {
        static AVMediaTypeVideo: *const AnyObject;
        static AVMediaTypeAudio: *const AnyObject;
        static AVFileTypeMPEG4: *const AnyObject;
        static AVAssetExportPresetPassthrough: *const AnyObject;
    }

    unsafe fn ns_string_from(s: &str) -> Option<Retained<AnyObject>> {
        let cls = class!(NSString);
        let cstr = CString::new(s).ok()?;
        let allocated: *mut AnyObject = msg_send![cls, alloc];
        if allocated.is_null() {
            return None;
        }
        let inited: *mut AnyObject = msg_send![allocated, initWithUTF8String: cstr.as_ptr()];
        if inited.is_null() {
            return None;
        }
        Retained::from_raw(inited)
    }

    unsafe fn file_url(path: &Path) -> Option<Retained<AnyObject>> {
        let path_str = path.to_str()?;
        let nsstr = ns_string_from(path_str)?;
        let cls = class!(NSURL);
        let url: *mut AnyObject = msg_send![cls, fileURLWithPath: &*nsstr];
        if url.is_null() {
            return None;
        }
        Retained::from_raw(url)
    }

    unsafe fn first_track(
        asset: &AnyObject,
        media_type: *const AnyObject,
    ) -> Option<*mut AnyObject> {
        let tracks: *mut AnyObject = msg_send![asset, tracksWithMediaType: media_type];
        if tracks.is_null() {
            return None;
        }
        let count: usize = msg_send![tracks, count];
        if count == 0 {
            return None;
        }
        let track: *mut AnyObject = msg_send![tracks, objectAtIndex: 0usize];
        if track.is_null() {
            None
        } else {
            Some(track)
        }
    }

    unsafe fn cmtime_add(a: CMTime, b: CMTime) -> CMTime {
        #[link(name = "CoreMedia", kind = "framework")]
        extern "C" {
            fn CMTimeAdd(a: CMTime, b: CMTime) -> CMTime;
        }
        CMTimeAdd(a, b)
    }

    if segments.is_empty() {
        return Err("concat called with no segments".into());
    }

    unsafe {
        let composition_cls = class_named("AVMutableComposition")
            .ok_or_else(|| "AVMutableComposition missing".to_string())?;
        let composition: *mut AnyObject = msg_send![composition_cls, composition];
        if composition.is_null() {
            return Err("AVMutableComposition allocation failed".into());
        }
        let composition = Retained::<AnyObject>::from_raw(composition)
            .ok_or_else(|| "AVMutableComposition retain failed".to_string())?;

        let video_track: *mut AnyObject = msg_send![
            &*composition,
            addMutableTrackWithMediaType: AVMediaTypeVideo,
            preferredTrackID: KCM_PERSISTENT_TRACK_ID_INVALID
        ];
        let audio_track: *mut AnyObject = msg_send![
            &*composition,
            addMutableTrackWithMediaType: AVMediaTypeAudio,
            preferredTrackID: KCM_PERSISTENT_TRACK_ID_INVALID
        ];
        if video_track.is_null() && audio_track.is_null() {
            return Err("composition has no tracks to write into".into());
        }

        let mut cursor = CM_TIME_ZERO;
        let asset_cls =
            class_named("AVURLAsset").ok_or_else(|| "AVURLAsset missing".to_string())?;
        let mut appended_any = false;

        for path in segments {
            validate_recording_segment_file(path)?;
            let url = file_url(path)
                .ok_or_else(|| format!("could not build NSURL for {}", path.display()))?;
            let asset: *mut AnyObject = msg_send![asset_cls, URLAssetWithURL: &*url, options: std::ptr::null::<AnyObject>()];
            if asset.is_null() {
                return Err(format!(
                    "AVURLAsset URLAssetWithURL returned nil for {}",
                    path.display()
                ));
            }
            let duration: CMTime = msg_send![asset, duration];
            if duration.flags & 1 == 0 || duration.timescale == 0 || duration.value <= 0 {
                return Err(format!(
                    "recording segment has invalid duration: {}",
                    path.display()
                ));
            }
            let range = CMTimeRange {
                start: CM_TIME_ZERO,
                duration,
            };

            if !video_track.is_null() {
                if let Some(seg_video) = first_track(&*asset, AVMediaTypeVideo) {
                    let mut err_ptr: *mut AnyObject = std::ptr::null_mut();
                    let ok: bool = msg_send![
                        video_track,
                        insertTimeRange: range,
                        ofTrack: seg_video,
                        atTime: cursor,
                        error: &mut err_ptr
                    ];
                    if !ok {
                        return Err(format!(
                            "AVMutableCompositionTrack insertTimeRange (video) failed for {}",
                            path.display()
                        ));
                    }
                }
            }
            if !audio_track.is_null() {
                if let Some(seg_audio) = first_track(&*asset, AVMediaTypeAudio) {
                    let mut err_ptr: *mut AnyObject = std::ptr::null_mut();
                    let ok: bool = msg_send![
                        audio_track,
                        insertTimeRange: range,
                        ofTrack: seg_audio,
                        atTime: cursor,
                        error: &mut err_ptr
                    ];
                    if !ok {
                        return Err(format!(
                            "AVMutableCompositionTrack insertTimeRange (audio) failed for {}",
                            path.display()
                        ));
                    }
                }
            }
            cursor = cmtime_add(cursor, duration);
            appended_any = true;
        }

        if !appended_any {
            return Err("no usable segments to concatenate".into());
        }

        let export_cls = class_named("AVAssetExportSession")
            .ok_or_else(|| "AVAssetExportSession missing".to_string())?;
        let allocated: *mut AnyObject = msg_send![export_cls, alloc];
        let export_raw: *mut AnyObject = msg_send![
            allocated,
            initWithAsset: &*composition,
            presetName: AVAssetExportPresetPassthrough
        ];
        if export_raw.is_null() {
            return Err("AVAssetExportSession init failed (passthrough preset)".into());
        }
        let export = Retained::<AnyObject>::from_raw(export_raw)
            .ok_or_else(|| "AVAssetExportSession retain failed".to_string())?;

        let out_url = file_url(output)
            .ok_or_else(|| format!("could not build NSURL for output {}", output.display()))?;
        let _: () = msg_send![&*export, setOutputURL: &*out_url];
        let _: () = msg_send![&*export, setOutputFileType: AVFileTypeMPEG4];
        let _: () = msg_send![&*export, setShouldOptimizeForNetworkUse: true];

        let (tx, rx) = mpsc::sync_channel::<()>(1);
        let block = RcBlock::new(move || {
            let _ = tx.send(());
        });
        let _: () = msg_send![&*export, exportAsynchronouslyWithCompletionHandler: &*block];

        // Cap the wait so a stuck export can't hang the stop button forever.
        // A typical multi-segment passthrough export of a ~30 minute clip
        // finishes in well under a minute, so 10 minutes is plenty.
        if rx.recv_timeout(StdDuration::from_secs(600)).is_err() {
            return Err("AVAssetExportSession concat timed out".into());
        }

        let status: i64 = msg_send![&*export, status];
        // AVAssetExportSessionStatusCompleted == 3
        if status != 3 {
            let err_obj: *mut AnyObject = msg_send![&*export, error];
            let mut detail = format!("status={status}");
            if !err_obj.is_null() {
                let desc_obj: *mut AnyObject = msg_send![err_obj, localizedDescription];
                if !desc_obj.is_null() {
                    let utf8: *const i8 = msg_send![desc_obj, UTF8String];
                    if !utf8.is_null() {
                        let cstr = std::ffi::CStr::from_ptr(utf8);
                        detail = format!("{detail}: {}", cstr.to_string_lossy());
                    }
                }
            }
            return Err(format!("AVAssetExportSession concat failed ({detail})"));
        }
    }

    Ok(())
}

#[cfg(test)]
mod audio_track_probe_tests {
    use super::{
        audio_filter_chain, decide_prepared_audio_signal, mp4_has_audio_track,
        parse_ffmpeg_volume_db, AudioSignalProbe, PreparedAudioSignalDecision,
        AUDIO_DENOISE_FILTER, AUDIO_DOWNMIX_FILTER, AUDIO_DOWNMIX_MAKEUP_FILTER,
        AUDIO_LOUDNESS_FILTER, AUDIO_MIC_PREGAIN_FILTER,
    };
    use std::io::Write;

    /// Append an ISO BMFF box: 4-byte big-endian size (header + body) then
    /// the 4-byte type tag, then the raw body bytes.
    fn push_box(buf: &mut Vec<u8>, box_type: &[u8; 4], body: &[u8]) {
        let size = (8 + body.len()) as u32;
        buf.extend_from_slice(&size.to_be_bytes());
        buf.extend_from_slice(box_type);
        buf.extend_from_slice(body);
    }

    /// Build a minimal `hdlr` box body for the given handler type (e.g.
    /// `soun` or `vide`): version(1) + flags(3) + pre_defined(4) +
    /// handler_type(4), zero-padded further like a real hdlr's trailing
    /// name/reserved fields.
    fn hdlr_body(handler_type: &[u8; 4]) -> Vec<u8> {
        let mut body = vec![0u8; 8]; // version+flags+pre_defined
        body.extend_from_slice(handler_type);
        body.extend_from_slice(&[0u8; 4]); // trailing reserved/name padding
        body
    }

    fn write_temp_mp4(bytes: &[u8]) -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "clips-audio-probe-test-{}-{}.mp4",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(bytes).unwrap();
        path
    }

    #[test]
    fn builds_native_audio_filter_chain_for_mic_noise_reduction() {
        assert_eq!(
            audio_filter_chain(false, false, false),
            AUDIO_LOUDNESS_FILTER
        );
        assert_eq!(
            audio_filter_chain(false, true, false),
            format!("{AUDIO_DENOISE_FILTER},{AUDIO_LOUDNESS_FILTER}")
        );
        assert_eq!(
            audio_filter_chain(false, true, true),
            format!("{AUDIO_DENOISE_FILTER},{AUDIO_MIC_PREGAIN_FILTER},{AUDIO_LOUDNESS_FILTER}")
        );
        assert_eq!(
            audio_filter_chain(true, true, false),
            format!(
                "{AUDIO_DOWNMIX_FILTER},{AUDIO_DOWNMIX_MAKEUP_FILTER},{AUDIO_DENOISE_FILTER},{AUDIO_LOUDNESS_FILTER}"
            )
        );
    }

    #[test]
    fn detects_audio_track_present() {
        let mut moov_body = Vec::new();
        // moov > trak > mdia > hdlr(soun)
        let mut mdia_body = Vec::new();
        push_box(&mut mdia_body, b"hdlr", &hdlr_body(b"soun"));
        let mut trak_body = Vec::new();
        push_box(&mut trak_body, b"mdia", &mdia_body);
        push_box(&mut moov_body, b"trak", &trak_body);

        let mut file = Vec::new();
        push_box(&mut file, b"ftyp", b"isommp42");
        push_box(&mut file, b"moov", &moov_body);
        file.extend_from_slice(b"mdatSOMEFAKEVIDEODATA");

        let path = write_temp_mp4(&file);
        assert_eq!(mp4_has_audio_track(&path), Some(true));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn detects_video_only_output_as_missing_audio() {
        // Simulates exactly the bug: ffmpeg with `-map 0:a?` succeeds but
        // only writes a video (`vide`) handler track, no `soun` track.
        let mut moov_body = Vec::new();
        let mut mdia_body = Vec::new();
        push_box(&mut mdia_body, b"hdlr", &hdlr_body(b"vide"));
        let mut trak_body = Vec::new();
        push_box(&mut trak_body, b"mdia", &mdia_body);
        push_box(&mut moov_body, b"trak", &trak_body);

        let mut file = Vec::new();
        push_box(&mut file, b"ftyp", b"isommp42");
        push_box(&mut file, b"moov", &moov_body);
        file.extend_from_slice(b"mdatSOMEFAKEVIDEODATA");

        let path = write_temp_mp4(&file);
        assert_eq!(mp4_has_audio_track(&path), Some(false));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn detects_audio_track_among_multiple_tracks() {
        // video trak first, then audio trak — order shouldn't matter.
        let mut video_mdia = Vec::new();
        push_box(&mut video_mdia, b"hdlr", &hdlr_body(b"vide"));
        let mut video_trak = Vec::new();
        push_box(&mut video_trak, b"mdia", &video_mdia);

        let mut audio_mdia = Vec::new();
        push_box(&mut audio_mdia, b"hdlr", &hdlr_body(b"soun"));
        let mut audio_trak = Vec::new();
        push_box(&mut audio_trak, b"mdia", &audio_mdia);

        let mut moov_body = Vec::new();
        push_box(&mut moov_body, b"trak", &video_trak);
        push_box(&mut moov_body, b"trak", &audio_trak);

        let mut file = Vec::new();
        push_box(&mut file, b"ftyp", b"isommp42");
        push_box(&mut file, b"moov", &moov_body);
        file.extend_from_slice(b"mdatSOMEFAKEVIDEODATA");

        let path = write_temp_mp4(&file);
        assert_eq!(mp4_has_audio_track(&path), Some(true));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn missing_file_returns_none() {
        let path = std::env::temp_dir().join("clips-audio-probe-test-does-not-exist.mp4");
        assert_eq!(mp4_has_audio_track(&path), None);
    }

    #[test]
    fn no_moov_box_returns_false() {
        let mut file = Vec::new();
        push_box(&mut file, b"ftyp", b"isommp42");
        file.extend_from_slice(b"mdatSOMEFAKEVIDEODATA");

        let path = write_temp_mp4(&file);
        assert_eq!(mp4_has_audio_track(&path), Some(false));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn parses_ffmpeg_volumedetect_output() {
        let stderr = "\
[Parsed_volumedetect_0 @ 0x123] mean_volume: -74.0 dB
[Parsed_volumedetect_0 @ 0x123] max_volume: -57.6 dB
";
        assert_eq!(parse_ffmpeg_volume_db(stderr, "mean_volume:"), Some(-74.0));
        assert_eq!(parse_ffmpeg_volume_db(stderr, "max_volume:"), Some(-57.6));
    }

    #[test]
    fn rejects_effectively_silent_prepared_audio() {
        let silent = AudioSignalProbe {
            mean_volume_db: Some(-74.0),
            max_volume_db: Some(-57.6),
        };
        let quiet_noise_peak = AudioSignalProbe {
            mean_volume_db: Some(-71.1),
            max_volume_db: Some(-47.4),
        };
        let audible = AudioSignalProbe {
            mean_volume_db: Some(-21.5),
            max_volume_db: Some(-1.4),
        };
        assert!(!silent.has_audible_signal());
        assert!(!quiet_noise_peak.has_audible_signal());
        assert!(audible.has_audible_signal());
    }

    #[test]
    fn publishes_quiet_recordings_but_preserves_audible_source_audio() {
        let silent = AudioSignalProbe {
            mean_volume_db: Some(f64::NEG_INFINITY),
            max_volume_db: Some(f64::NEG_INFINITY),
        };
        let audible = AudioSignalProbe {
            mean_volume_db: Some(-21.5),
            max_volume_db: Some(-1.4),
        };

        assert_eq!(
            decide_prepared_audio_signal(silent, Some(silent)),
            PreparedAudioSignalDecision::AcceptCandidate,
        );
        assert_eq!(
            decide_prepared_audio_signal(silent, Some(audible)),
            PreparedAudioSignalDecision::UseOriginal,
        );
    }
}

#[cfg(test)]
mod segment_recovery_tests {
    use super::{
        recover_from_unusable_current_segment, validate_recording_segment_file,
        NativeFullscreenSession, RestartInfo, MP4_RECORDING_MIME_TYPE,
    };
    use std::io::Write;
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    fn push_box(buf: &mut Vec<u8>, box_type: &[u8; 4], body: &[u8]) {
        let size = (8 + body.len()) as u32;
        buf.extend_from_slice(&size.to_be_bytes());
        buf.extend_from_slice(box_type);
        buf.extend_from_slice(body);
    }

    fn temp_path(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "clips-segment-recovery-{name}-{}-{}.mp4",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        path
    }

    fn write_mp4(path: &PathBuf, has_moov: bool) {
        let mut file = Vec::new();
        push_box(&mut file, b"ftyp", b"isommp42");
        if has_moov {
            push_box(&mut file, b"moov", &[]);
        }
        file.extend_from_slice(b"mdatSOMEFAKEVIDEODATA");
        let mut f = std::fs::File::create(path).unwrap();
        f.write_all(&file).unwrap();
    }

    fn test_session(segments: Vec<PathBuf>) -> NativeFullscreenSession {
        let now = Instant::now();
        NativeFullscreenSession {
            backend: None,
            path: segments
                .first()
                .cloned()
                .unwrap_or_else(|| temp_path("final")),
            mime_type: MP4_RECORDING_MIME_TYPE,
            started_at: now,
            width: Some(1280),
            height: Some(720),
            segments,
            paused_total: Duration::ZERO,
            current_segment_started_at: now.checked_sub(Duration::from_millis(250)).unwrap_or(now),
            lost_segment_duration: Duration::ZERO,
            lost_segment_count: 0,
            paused_at: None,
            restart: RestartInfo {
                safe_id: "test".to_string(),
                include_audio: true,
                capture_system_audio: false,
                mic_captured_in_file: false,
                mic_device_id: None,
                mic_device_label: None,
                segment_counter: 0,
                target_display_id: None,
                capture_region: None,
            },
            pending_recording_output: false,
            custom_pipeline: false,
            #[cfg(target_os = "macos")]
            live_upload: None,
            had_live_upload: false,
            disk_monitor_stop: None,
        }
    }

    #[test]
    fn drops_unusable_last_segment_when_empty_recovery_allowed() {
        let good = temp_path("good");
        let bad = temp_path("bad");
        write_mp4(&good, true);
        write_mp4(&bad, false);

        let mut session = test_session(vec![good.clone(), bad.clone()]);
        assert!(recover_from_unusable_current_segment(
            &mut session,
            "test pause",
            true,
        ));
        assert_eq!(session.segments, vec![good.clone()]);
        assert_eq!(session.lost_segment_count, 1);
        assert!(session.lost_segment_duration > Duration::ZERO);
        assert!(!bad.exists());

        let _ = std::fs::remove_file(good);
    }

    #[test]
    fn keeps_only_bad_segment_when_empty_recovery_disallowed() {
        let bad = temp_path("only-bad");
        write_mp4(&bad, false);

        let mut session = test_session(vec![bad.clone()]);
        assert!(!recover_from_unusable_current_segment(
            &mut session,
            "final stop",
            false,
        ));
        assert_eq!(session.segments, vec![bad.clone()]);
        assert_eq!(session.lost_segment_count, 0);
        assert!(bad.exists());

        let _ = std::fs::remove_file(bad);
    }

    #[test]
    fn keeps_playable_last_segment() {
        let first = temp_path("first");
        let second = temp_path("second");
        write_mp4(&first, true);
        write_mp4(&second, true);

        let mut session = test_session(vec![first.clone(), second.clone()]);
        assert!(!recover_from_unusable_current_segment(
            &mut session,
            "test pause",
            true,
        ));
        assert_eq!(session.segments, vec![first.clone(), second.clone()]);
        assert_eq!(session.lost_segment_count, 0);

        let _ = std::fs::remove_file(first);
        let _ = std::fs::remove_file(second);
    }

    #[test]
    fn concat_validation_rejects_bad_middle_segment() {
        let first = temp_path("middle-first");
        let bad = temp_path("middle-bad");
        let last = temp_path("middle-last");
        write_mp4(&first, true);
        write_mp4(&bad, false);
        write_mp4(&last, true);

        let mut error = None;
        for path in [&first, &bad, &last] {
            if let Err(err) = validate_recording_segment_file(path) {
                error = Some(err);
                break;
            }
        }

        let err = error.expect("bad middle segment should fail concat validation");
        assert!(err.contains("missing playback metadata"));
        assert!(err.contains(bad.to_string_lossy().as_ref()));

        let _ = std::fs::remove_file(first);
        let _ = std::fs::remove_file(bad);
        let _ = std::fs::remove_file(last);
    }
}
