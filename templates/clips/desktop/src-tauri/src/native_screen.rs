use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
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
    output_type::SCStreamOutputType, sc_stream::SCStream,
};
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, Ordering};

const QUICKTIME_RECORDING_MIME_TYPE: &str = "video/quicktime";
const MP4_RECORDING_MIME_TYPE: &str = "video/mp4";
// Keep native chunks comfortably under serverless request/event limits.
const UPLOAD_CHUNK_BYTES: usize = 3 * 1024 * 1024;
// Master switch for native transcoding/compression.
const COMPRESSION_ENABLED: bool = true;
const TRANSCODE_THRESHOLD_BYTES: u64 = 24 * 1024 * 1024;
const TARGET_UPLOAD_BYTES: u64 = 18 * 1024 * 1024;
// Mirror of the shared `MAX_UPLOAD_BYTES` limit (see
// `templates/clips/shared/upload-limits.ts`). Same default (256 MB) and same
// env var (CLIPS_MAX_UPLOAD_BYTES) so desktop and web stay in lockstep.
const DEFAULT_MAX_UPLOAD_BYTES: u64 = 256 * 1024 * 1024;
const MIN_TRANSCODE_VIDEO_RATE_KBPS: u32 = 350;
const TRANSCODE_RATE_LIMIT_OVERHEAD_KBPS: f64 = 64.0;
const TRANSCODE_FRAME_RATE_LIMIT: u32 = 30;
const NORMALIZED_AUDIO_BITRATE_KBPS: u32 = 160;
const AUDIO_LOUDNESS_FILTER: &str = "loudnorm=I=-16:TP=-1.5:LRA=11";
const NATIVE_CAPTURE_MAX_LONG_EDGE: u32 = 1280;
const NATIVE_CAPTURE_FPS: u32 = 24;
const AVCONVERT_PATH: &str = "/usr/bin/avconvert";
const AVCONVERT_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const FFMPEG_TIMEOUT: Duration = Duration::from_secs(8 * 60);
const FFMPEG_CANDIDATE_PATHS: &[&str] = &[
    "ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/opt/local/bin/ffmpeg",
];
const PENDING_UPLOADS_DIR: &str = "pending-recording-uploads";
const THUMBNAIL_MIME_TYPE: &str = "image/jpeg";
const THUMBNAIL_MAX_BYTES: u64 = 2 * 1024 * 1024;
const THUMBNAIL_WIDTH: &str = "1280";
const SIPS_PATH: &str = "/usr/bin/sips";

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
}

#[derive(Clone)]
struct RestartInfo {
    safe_id: String,
    include_audio: bool,
    capture_system_audio: bool,
    mic_device_id: Option<String>,
    mic_device_label: Option<String>,
    /// Monotonic counter feeding the per-segment filename suffix.
    segment_counter: u32,
    /// CGDirectDisplayID of the display to record. None = first available.
    target_display_id: Option<u32>,
    /// Normalized display-relative capture rectangle for Region recordings.
    capture_region: Option<NativeCaptureRegion>,
}

enum NativeFullscreenBackend {
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
    },
}

/// `SCRecordingOutput` finalizes the MP4 *asynchronously*: after
/// `stop_capture()` / `remove_recording_output()` it still has to flush its
/// last buffered sample fragment and write the `moov` atom, then it calls
/// `recording_did_finish` (or `recording_did_fail`). If we move the file
/// before that callback we lose the trailing fragment — a consistent
/// multi-second tail truncation with the head intact. This handle lets the
/// stop path block on that callback (bounded by a timeout) before the file
/// is moved.
#[cfg(target_os = "macos")]
struct RecordingFinish {
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

struct PreparedRecordingFile {
    path: PathBuf,
    mime_type: String,
    bytes: u64,
    temporary: bool,
}

fn format_mb(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / (1024.0 * 1024.0))
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedNativeRecording {
    recording_id: String,
    server_url: String,
    file_path: PathBuf,
    mime_type: String,
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
const MIC_WARM_TIMEOUT_MS: u64 = 1500;

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
            if include_audio && has_specific_mic {
                return Err(format!(
                    "ScreenCaptureKit recording failed before it could use the selected microphone ({sck_err}). Clips did not fall back to macOS screencapture because that would ignore your selected input."
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
        );
        return Err("Native full-screen recording is currently macOS-only.".into());
    }

    #[cfg(target_os = "macos")]
    {
        let is_warmed = {
            let guard = state.inner.lock().map_err(|e| e.to_string())?;
            guard
                .as_ref()
                .map(|s| s.pending_recording_output)
                .unwrap_or(false)
        };
        if !is_warmed {
            return start_native_session_locked(
                &app,
                &state,
                &recording_id,
                include_audio,
                capture_system_audio,
                mic_device_id,
                mic_device_label,
                capture_region,
                false,
            );
        }

        // Grab the mic-ready flag without holding the lock during the wait.
        let mic_ready = {
            let guard = state.inner.lock().map_err(|e| e.to_string())?;
            guard.as_ref().and_then(|s| match s.backend.as_ref() {
                Some(NativeFullscreenBackend::ScreenCaptureKit { mic_ready, .. }) => {
                    mic_ready.clone()
                }
                _ => None,
            })
        };
        if let Some(ready) = mic_ready {
            let deadline = Instant::now() + Duration::from_millis(MIC_WARM_TIMEOUT_MS);
            while !ready.load(Ordering::Relaxed) && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(15));
            }
        }

        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        let session = guard
            .as_mut()
            .ok_or_else(|| "No native full-screen recording is active.".to_string())?;
        let width = session.width;
        let height = session.height;
        if let Some(NativeFullscreenBackend::ScreenCaptureKit {
            stream, recording, ..
        }) = session.backend.as_ref()
        {
            stream
                .add_recording_output(recording)
                .map_err(|e| format!("add recording output failed: {e:?}"))?;
        }
        // Rebaseline the duration clock: the warm phase ran during the
        // countdown, so `started_at` (set at warm time) is several seconds
        // early. The clip's first written frame is now, so measure from now.
        session.started_at = Instant::now();
        session.pending_recording_output = false;

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
    has_audio: bool,
    has_camera: bool,
) -> Result<NativeFullscreenUploadResult, String> {
    emit_native_upload_progress(&app, "finalizing", "Optimizing clip", None, None);
    let StoppedSession {
        session,
        duration_ms,
        stop_outcome,
        consolidate_outcome,
        multi_segment,
    } = take_and_finalize_active_session(&state)?;

    // The camera bubble is the ONE overlay we deliberately leave
    // capture-included (see `show_bubble`), so it has to stay on-screen
    // until the SCStream stops. Now that capture is finalized, tear it
    // down immediately — otherwise the user's face keeps floating in the
    // corner through the (multi-second) finalize + upload phase, reading
    // as "still recording" while the bottom-left card says "processing".
    let _ = crate::clips::close_bubble(app.clone()).await;

    let mut saved = saved_recording_from_session(
        &session,
        &server_url,
        &recording_id,
        duration_ms,
        has_audio,
        has_camera,
    )?;
    if let Err(stop_err) = &stop_outcome {
        saved.last_error = Some(stop_err.clone());
        // Gate the corrupt flag on both the error string AND actual file
        // validation — a transient finalize error that still produces a valid
        // MP4 should remain retryable rather than forcing a re-record.
        if stop_err.contains("finalize failed")
            && !mp4_has_moov(&saved.file_path)
        {
            saved.corrupt = true;
            eprintln!(
                "[clips-tray] recording marked corrupt: finalize error + missing moov atom"
            );
        }
    } else if let Err(merge_err) = &consolidate_outcome {
        saved.last_error = Some(merge_err.clone());
    }
    write_saved_recording_metadata(&app, &saved)?;
    emit_native_upload_progress(&app, "preparing", "Optimizing clip", None, None);
    if let Err(stop_err) = stop_outcome {
        return Err(format!(
            "{stop_err}. The clip was saved locally and can be retried from the Clips menu."
        ));
    }
    if multi_segment {
        if let Err(merge_err) = consolidate_outcome {
            return Err(format!(
                "{merge_err}. The clip segments were saved locally and can be retried from the Clips menu."
            ));
        }
    }

    let result = upload_recording_file(
        &app,
        &session,
        server_url,
        recording_id,
        auth_token.unwrap_or_default(),
        cookie.unwrap_or_default(),
        duration_ms,
        has_audio,
        has_camera,
    )
    .await;

    match result {
        Ok(result) => {
            clear_saved_recording_after_success(&app, &saved);
            Ok(result)
        }
        Err(err) => {
            saved.last_attempt_at = Some(now_iso());
            saved.last_error = Some(err.clone());
            saved.retry_count = saved.retry_count.saturating_add(1);
            let _ = write_saved_recording_metadata(&app, &saved);
            emit_native_upload_progress(&app, "failed", "Upload paused", None, None);
            Err(format!(
                "{err}. The clip was saved locally and can be retried from the Clips menu."
            ))
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
        session,
        duration_ms,
        stop_outcome,
        consolidate_outcome,
        multi_segment,
    } = take_and_finalize_active_session(&state)?;
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
    // If the finalization callback reported an error AND the file is missing
    // a moov atom, the exported MP4 would be unplayable. Fail now rather than
    // handing the user a broken local file with no server-side backstop.
    if stop_outcome
        .as_ref()
        .err()
        .map(|e| e.contains("finalize failed"))
        .unwrap_or(false)
        && !mp4_has_moov(&session.path)
    {
        eprintln!(
            "[clips-tray] native local recording corrupt (finalize error + missing moov) — not exporting"
        );
        return Err(
            "Recorded file is corrupted — the video is incomplete and cannot be saved. \
             Please record again."
                .into(),
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
    if session.backend.is_none() {
        // No active backend means we're already paused (or never started).
        session.paused_at = Some(Instant::now());
        return Ok(());
    }
    finalize_active_backend(session, true)?;
    session.paused_at = Some(Instant::now());
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

    let restart = session.restart.clone();
    let next_counter = restart.segment_counter.saturating_add(1);
    let extension = native_extension_for_mime_type(session.mime_type);
    let segment_path = segment_path_for(&app, &restart.safe_id, extension, next_counter)?;
    let _ = std::fs::remove_file(&segment_path);

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
    session.paused_total = session
        .paused_total
        .checked_add(paused_at.elapsed())
        .unwrap_or(session.paused_total);
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
    /// True when more than one segment was captured (i.e. the user
    /// paused at least once). Used to decide whether a consolidation
    /// failure is fatal — single-segment consolidation is just a rename.
    multi_segment: bool,
}

/// Take the active session out of state, finalize its backend, and merge
/// any pause/resume segments into the canonical output path. Shared by
/// the upload and save-locally stop commands.
fn take_and_finalize_active_session(
    state: &State<'_, NativeFullscreenRecordingState>,
) -> Result<StoppedSession, String> {
    let mut session = {
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        guard.take()
    }
    .ok_or_else(|| "No native full-screen recording is active.".to_string())?;

    // Try to finalize capture, but don't early-return on failure: the
    // underlying MP4 file is already on disk after stop_capture(), and
    // ScreenCaptureKit's StreamError("invalid parameter") on
    // remove_recording_output occasionally fires even though the file is
    // playable. The caller persists recovery metadata so a finalize
    // failure doesn't orphan the file.
    let stop_outcome = finalize_active_backend(&mut session, true);
    println!(
        "[clips-tray] finalize backend done (ok={}); {}",
        stop_outcome.is_ok(),
        describe_recording_path(&session.path)
    );
    // With one segment this is a cheap rename. With multiple segments a
    // failure would silently lose everything after the first pause, so
    // callers check `multi_segment` and surface the merge error.
    let consolidate_outcome = consolidate_segments_into_path(&mut session);
    let multi_segment = session.segments.len() > 1;
    if let Err(err) = &consolidate_outcome {
        eprintln!("[clips-tray] segment consolidation failed: {err}");
    }
    println!(
        "[clips-tray] consolidate done (ok={}, segments={}, multi={multi_segment}); {}",
        consolidate_outcome.is_ok(),
        session.segments.len(),
        describe_recording_path(&session.path)
    );
    let duration_ms = session
        .started_at
        .elapsed()
        .saturating_sub(session.paused_total)
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

/// Best-effort cleanup of a session being discarded (cancel, or a stale
/// session displaced by a new start). Finalizes any active backend and
/// deletes every on-disk artifact — segment files and the final path.
fn discard_session(session: &mut NativeFullscreenSession) {
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
        // app / safe_id aren't needed on macOS — the segment path is
        // pre-computed by the caller and the segment backends don't take
        // them. Consume to silence unused-variable warnings.
        let _ = (app, safe_id);
        match start_screencapturekit_backend_at(
            segment_path,
            include_audio,
            capture_system_audio,
            mic_device_id,
            mic_device_label,
            target_display_id,
            capture_region,
            // Resume records immediately — the mic was already warmed by the
            // initial start, so there's no silent-head to avoid here.
            false,
        ) {
            Ok((backend, w, h)) => return Ok((backend, w, h)),
            Err(sck_err) => {
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
fn start_screencapturekit_backend_at(
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
    let selected_mic = if include_audio {
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
        // separate inputs; SCRecordingOutput muxes them into the file.
        .with_captures_audio(capture_system_audio)
        .with_captures_microphone(include_audio)
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
    let mic_ready = if include_audio {
        let flag = Arc::new(AtomicBool::new(false));
        let flag_cb = Arc::clone(&flag);
        stream.add_output_handler(
            move |_sample, of_type| {
                if matches!(of_type, SCStreamOutputType::Microphone) {
                    flag_cb.store(true, Ordering::Relaxed);
                }
            },
            SCStreamOutputType::Microphone,
        );
        Some(flag)
    } else {
        None
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
        "[clips-tray] ScreenCaptureKit recording started: {width}x{height} @ {NATIVE_CAPTURE_FPS}fps from {capture_width}x{capture_height} (display {source_width}x{source_height}), mic={include_audio} system_audio={capture_system_audio} deferred_output={defer_recording_output}"
    );
    Ok((
        NativeFullscreenBackend::ScreenCaptureKit {
            stream,
            recording,
            finish,
            mic_ready,
        },
        Some(width),
        Some(height),
    ))
}

/// Spawn the macOS `screencapture` fallback writing into `output_path`.
/// Shared by the initial start and the resume path.
#[cfg(target_os = "macos")]
fn start_screencapture_backend_at(
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
        if saved.file_path.exists() {
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

    reset_upload_chunks(
        &saved.server_url,
        &saved.recording_id,
        auth_token.as_deref().unwrap_or(""),
        cookie.as_deref().unwrap_or(""),
    )
    .await
    .map_err(|err| {
        persist_saved_recording_error(&app, &mut saved, &err);
        err
    })?;

    let result = upload_saved_recording_file(
        &app,
        &saved,
        saved.server_url.clone(),
        auth_token.unwrap_or_default(),
        cookie.unwrap_or_default(),
    )
    .await;

    match result {
        Ok(result) => {
            clear_saved_recording_after_success(&app, &saved);
            Ok(result)
        }
        Err(err) => {
            persist_saved_recording_error(&app, &mut saved, &err);
            emit_native_upload_progress(&app, "failed", "Retry paused", None, None);
            Err(format!(
                "{err}. The local copy is still saved, so you can retry again."
            ))
        }
    }
}

#[tauri::command]
pub async fn native_fullscreen_recording_discard_upload(
    app: AppHandle,
    recording_id: String,
) -> Result<(), String> {
    let saved = read_saved_recording_metadata(&app, &recording_id)?;
    clear_saved_recording(&app, &saved)
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
fn resolve_microphone_capture_device(
    device_id: Option<&str>,
    device_label: Option<&str>,
) -> Result<Option<AudioInputDevice>, String> {
    let device_id = device_id.map(str::trim).filter(|value| !value.is_empty());
    let device_label = device_label
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if device_id.is_none() && device_label.is_none() {
        eprintln!("[clips-tray] audio input devices not provided");
        return Ok(None);
    }

    let devices = AudioInputDevice::list();
    devices.iter().for_each(|device| {
        eprintln!(
            "[clips-tray] audio input device: id={} name={}",
            device.id, device.name
        );
    });

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
    let bytes = std::fs::metadata(&session.path)
        .map_err(|e| {
            let diag = describe_recording_path(&session.path);
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
            describe_recording_path(&session.path)
        );
        return Err("Native recording produced an empty file.".into());
    }

    Ok(SavedNativeRecording {
        recording_id: recording_id.to_string(),
        server_url: server_url.trim_end_matches('/').to_string(),
        file_path: session.path.clone(),
        mime_type: session.mime_type.to_string(),
        duration_ms,
        width: session.width,
        height: session.height,
        bytes,
        has_audio,
        has_camera,
        saved_at: now_iso(),
        last_attempt_at: None,
        last_error: None,
        retry_count: 0,
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
    let path = saved_recording_metadata_path(app, &saved.recording_id)?;
    remove_saved_file(&path, "pending recording metadata")
}

fn clear_saved_recording_after_success(app: &AppHandle, saved: &SavedNativeRecording) {
    if let Err(err) = clear_saved_recording(app, saved) {
        eprintln!(
            "[clips-tray] upload succeeded for {}, but local pending recording cleanup failed: {err}",
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
fn tray_display_id(app: &AppHandle) -> Option<u32> {
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
    eprintln!(
        "[clips-tray] starting ScreenCaptureKit recording -> {}",
        path.display()
    );
    let (backend, width, height) = start_screencapturekit_backend_at(
        &path,
        include_audio,
        capture_system_audio,
        mic_device_id,
        mic_device_label,
        target_display_id,
        capture_region,
        defer_recording_output,
    )?;
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
            mic_device_id: mic_device_id.map(str::to_string),
            mic_device_label: mic_device_label.map(str::to_string),
            segment_counter: 0,
            target_display_id,
            capture_region,
        },
    );
    session.pending_recording_output = defer_recording_output;
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
    let (backend, w, h) = start_screencapture_backend_at(
        app,
        &path,
        include_audio,
        target_display_id,
        capture_region,
    )?;
    let (fallback_width, fallback_height) = primary_monitor_size(app);
    Ok(new_fullscreen_session(
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
            mic_device_id: None,
            mic_device_label: None,
            segment_counter: 0,
            target_display_id,
            capture_region,
        },
    ))
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
    NativeFullscreenSession {
        backend: Some(backend),
        path: path.clone(),
        mime_type,
        started_at: Instant::now(),
        width,
        height,
        segments: vec![path],
        paused_total: Duration::ZERO,
        paused_at: None,
        restart,
        pending_recording_output: false,
    }
}

fn primary_monitor_size(app: &AppHandle) -> (Option<u32>, Option<u32>) {
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
fn stop_native_recording(
    backend: &mut NativeFullscreenBackend,
    wait_for_finalize: bool,
) -> Result<(), String> {
    match backend {
        NativeFullscreenBackend::Screencapture { child } => stop_screencapture(child),
        #[cfg(target_os = "macos")]
        NativeFullscreenBackend::ScreenCaptureKit {
            stream,
            recording,
            finish,
            ..
        } => {
            let stop_result = stream
                .stop_capture()
                .map_err(|e| format!("ScreenCaptureKit stop failed: {e:?}"));
            // remove_recording_output() occasionally fails with
            // StreamError("Failed due to an invalid parameter") when the audio
            // tap or stream state hasn't fully drained yet. We retry once after
            // a 200ms drain delay; the sleep is in the error branch only so
            // healthy clips pay no extra stop latency.
            let remove_result = stream
                .remove_recording_output(recording)
                .map_err(|e| format!("ScreenCaptureKit recording finalize failed: {e:?}"));
            let remove_result = match remove_result {
                Ok(v) => Ok(v),
                Err(first_err) => {
                    eprintln!("[clips-tray] waiting 200ms for SCK frame buffer to drain before remove_recording_output retry");
                    std::thread::sleep(Duration::from_millis(200));
                    stream.remove_recording_output(recording).map_err(|e| {
                        format!(
                            "ScreenCaptureKit recording finalize failed (retry): {e:?}; first attempt: {first_err}"
                        )
                    })
                }
            };
            // stop_capture()/remove_recording_output() only *trigger* the
            // async finalize; the MP4 isn't complete until the delegate's
            // recording_did_finish fires. Block on it before the caller moves
            // the file — without this we move it mid-flush and lose the last
            // buffered fragment (a consistent multi-second tail truncation).
            // Skip the wait only when both teardown calls hard-failed (the
            // delegate won't fire, so don't burn the timeout for nothing).
            let waited_for_finalize =
                wait_for_finalize && (stop_result.is_ok() || remove_result.is_ok());
            let finalize_outcome = if waited_for_finalize {
                let outcome = finish.wait(SCK_FINALIZE_TIMEOUT);
                if outcome.is_none() {
                    eprintln!(
                            "[clips-tray] SCRecordingOutput finalize callback did not fire within {}s; saving file as-is",
                            SCK_FINALIZE_TIMEOUT.as_secs()
                        );
                }
                outcome
            } else {
                None
            };

            if let Err(err) = stop_result {
                return Err(err);
            }

            if let Some(Err(err)) = &finalize_outcome {
                return Err(format!("ScreenCaptureKit recording finalize failed: {err}"));
            }

            match remove_result {
                Ok(()) => Ok(()),
                Err(remove_err) => {
                    if matches!(finalize_outcome.as_ref(), Some(Ok(())))
                        || (waited_for_finalize && finalize_outcome.is_none())
                    {
                        eprintln!(
                            "[clips-tray] ScreenCaptureKit recording output removal reported an error after finalize completed or timed out; continuing upload: {remove_err}"
                        );
                        Ok(())
                    } else {
                        Err(remove_err)
                    }
                }
            }
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
    )?;
    let upload_result = upload_prepared_recording_file(
        app,
        &prepared,
        server_url,
        recording_id,
        auth_token,
        cookie,
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

async fn upload_saved_recording_file(
    app: &AppHandle,
    saved: &SavedNativeRecording,
    server_url: String,
    auth_token: String,
    cookie: String,
) -> Result<NativeFullscreenUploadResult, String> {
    let prepared = prepare_recording_file(
        app,
        &saved.file_path,
        &saved.mime_type,
        saved.width,
        saved.height,
        Some(saved.duration_ms),
        saved.has_audio,
    )?;
    let upload_result = upload_prepared_recording_file(
        app,
        &prepared,
        server_url,
        saved.recording_id.clone(),
        auth_token,
        cookie,
        saved.duration_ms,
        saved.width,
        saved.height,
        saved.has_audio,
        saved.has_camera,
    )
    .await;
    if prepared.temporary {
        let _ = std::fs::remove_file(&prepared.path);
    }
    upload_result
}

async fn upload_prepared_recording_file(
    app: &AppHandle,
    prepared: &PreparedRecordingFile,
    server_url: String,
    recording_id: String,
    auth_token: String,
    cookie: String,
    duration_ms: u128,
    width: Option<u32>,
    height: Option<u32>,
    has_audio: bool,
    has_camera: bool,
) -> Result<NativeFullscreenUploadResult, String> {
    let total_bytes = prepared.bytes;
    let total_chunks = ((total_bytes as usize) + UPLOAD_CHUNK_BYTES - 1) / UPLOAD_CHUNK_BYTES;
    let total_posts = total_chunks + 1;
    emit_native_upload_progress(app, "uploading", "Uploading clip", None, Some(0.0));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("upload client failed: {e}"))?;
    let mut file =
        File::open(&prepared.path).map_err(|e| format!("native recording open failed: {e}"))?;

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
        Vec::new(),
    )
    .await?;

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
    auth_token: &str,
    cookie: &str,
) -> Result<(), String> {
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
        .body("{}");
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
    Ok(())
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
    body: Vec<u8>,
) -> Result<(), String> {
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
    )?;
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
    if !status.is_success() {
        return Err(format!(
            "native recording upload returned {status}: {}",
            body.chars().take(400).collect::<String>()
        ));
    }
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
    }
    Ok(url.to_string())
}

/// Walk the top-level ISO BMFF boxes of a file and return `true` when a
/// `moov` box is present. SCK finalization errors leave the file with an
/// `ftyp` box and audio/video data (`mdat`) but no `moov`, making it
/// permanently unplayable and unrecoverable by retrying the upload.
///
/// Returns `false` on any I/O error or if the box structure is malformed —
/// in both cases we treat the file as unplayable (safe-fail).
fn mp4_has_moov(path: &Path) -> bool {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else {
        eprintln!("[clips-tray] mp4_has_moov: could not open file for moov scan");
        return false;
    };
    let mut buf = [0u8; 8];
    loop {
        if f.read_exact(&mut buf).is_err() {
            // EOF or read error — moov was never found
            return false;
        }
        let box_size = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]) as u64;
        let box_type = &buf[4..8];
        if box_type == b"moov" {
            return true;
        }
        // box_size == 0 means "extends to EOF"; box_size == 1 is a 64-bit
        // extended-size box (rare in practice for these files). Both cases
        // mean we can't skip forward cheaply, so stop scanning.
        if box_size < 8 {
            return false;
        }
        // Skip to the next top-level box (box_size includes the 8-byte header).
        if f.seek(SeekFrom::Current(box_size as i64 - 8)).is_err() {
            return false;
        }
    }
}

fn prepare_recording_file(
    app: &AppHandle,
    path: &Path,
    mime_type: &str,
    width: Option<u32>,
    height: Option<u32>,
    duration_ms: Option<u128>,
    has_audio: bool,
) -> Result<PreparedRecordingFile, String> {
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
        if !mp4_has_moov(path) {
            eprintln!(
                "[clips-tray] native recording corrupt moov check failed — skipping upload"
            );
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
    };

    let mut smallest_attempt_bytes: Option<u64> = None;
    let ffmpeg_path = resolve_ffmpeg_path();

    if !COMPRESSION_ENABLED || source_bytes < TRANSCODE_THRESHOLD_BYTES {
        if has_audio {
            if let Some(ffmpeg_path) = ffmpeg_path.as_deref() {
                let normalized_path = normalized_recording_path(path);
                let _ = std::fs::remove_file(&normalized_path);
                match normalize_audio_with_ffmpeg(ffmpeg_path, path, &normalized_path) {
                    Ok(()) => {
                        let normalized_bytes = std::fs::metadata(&normalized_path)
                            .map_err(|e| format!("normalized recording file missing: {e}"))?
                            .len();
                        if normalized_bytes > 0 && normalized_bytes <= max_upload_bytes() {
                            eprintln!(
                                "[clips-tray] native recording audio normalized with ffmpeg: {} -> {} bytes",
                                source_bytes, normalized_bytes
                            );
                            return Ok(PreparedRecordingFile {
                                path: normalized_path,
                                mime_type: MP4_RECORDING_MIME_TYPE.to_string(),
                                bytes: normalized_bytes,
                                temporary: true,
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

    if let Some(ffmpeg_path) = ffmpeg_path {
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
                &ffmpeg_path,
                path,
                &compressed_path,
                preset,
                width,
                height,
                duration_ms,
                has_audio,
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
/// with the `CLIPS_MAX_UPLOAD_BYTES` env var; falls back to 256 MB.
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
        .arg("0:v:0")
        .arg("-map")
        .arg("0:a?")
        .arg("-c:v")
        .arg("copy")
        .arg("-c:a")
        .arg("aac")
        .arg("-b:a")
        .arg(audio_bitrate)
        .arg("-af")
        .arg(AUDIO_LOUDNESS_FILTER)
        .arg("-ac")
        .arg("2")
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

fn native_preset_label(preset: &str) -> &'static str {
    match preset {
        "Preset1280x720" | "PresetAppleM4V720pHD" => "720p",
        "Preset960x540" => "540p",
        "Preset640x480" | "PresetAppleM4V480pSD" => "480p",
        "PresetAppleM4VCellular" => "mobile quality",
        _ => "a smaller preset",
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
        .arg("0:v:0")
        .arg("-map")
        .arg("0:a?");

    if let Some((scaled_w, scaled_h)) =
        ffmpeg_scaled_dimensions(width, height, preset.max_long_edge, preset.max_short_edge)
    {
        command
            .arg("-vf")
            .arg(format!("scale={scaled_w}:{scaled_h}:flags=lanczos"));
    }

    if normalize_audio {
        command.arg("-af").arg(AUDIO_LOUDNESS_FILTER);
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
    mut child: Child,
    timeout: Duration,
    tool_name: &str,
) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("{tool_name} wait failed: {e}"))?
        {
            if status.success() {
                return Ok(());
            }
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
            return Err(format!("{tool_name} exited with {status}: {}", tail.trim()));
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("{tool_name} timed out while compressing recording"));
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
            // Skip segments that vanished or are empty (e.g. a pause
            // that fired before the segment captured a single sample).
            match std::fs::metadata(path) {
                Ok(meta) if meta.len() > 0 => {}
                _ => {
                    eprintln!(
                        "[clips-tray] concat: skipping empty/missing segment {}",
                        path.display()
                    );
                    continue;
                }
            }
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
                eprintln!(
                    "[clips-tray] concat: skipping segment with invalid duration: {}",
                    path.display()
                );
                continue;
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
