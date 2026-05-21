use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

#[cfg(target_os = "macos")]
use screencapturekit::audio_devices::AudioInputDevice;
#[cfg(target_os = "macos")]
use screencapturekit::recording_output::{
    SCRecordingOutput, SCRecordingOutputCodec, SCRecordingOutputConfiguration,
    SCRecordingOutputDelegate, SCRecordingOutputFileType,
};
#[cfg(target_os = "macos")]
use screencapturekit::shareable_content::SCShareableContent;
#[cfg(target_os = "macos")]
use screencapturekit::stream::{
    configuration::SCStreamConfiguration, content_filter::SCContentFilter, sc_stream::SCStream,
};

const QUICKTIME_RECORDING_MIME_TYPE: &str = "video/quicktime";
const MP4_RECORDING_MIME_TYPE: &str = "video/mp4";
// Keep native chunks comfortably under serverless request/event limits. The
// route still accepts 6 MiB so browser MediaRecorder chunks are unaffected.
const UPLOAD_CHUNK_BYTES: usize = 3 * 1024 * 1024;
const TRANSCODE_THRESHOLD_BYTES: u64 = 80 * 1024 * 1024;
const TARGET_UPLOAD_BYTES: u64 = 95 * 1024 * 1024;
const AVCONVERT_PATH: &str = "/usr/bin/avconvert";
const AVCONVERT_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const PENDING_UPLOADS_DIR: &str = "pending-recording-uploads";
const THUMBNAIL_MIME_TYPE: &str = "image/jpeg";
const THUMBNAIL_MAX_BYTES: u64 = 2 * 1024 * 1024;
const THUMBNAIL_WIDTH: &str = "1280";
const SIPS_PATH: &str = "/usr/bin/sips";

#[derive(Default)]
pub struct NativeFullscreenRecordingState {
    inner: Mutex<Option<NativeFullscreenSession>>,
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
}

#[derive(Clone)]
struct RestartInfo {
    safe_id: String,
    include_audio: bool,
    mic_device_id: Option<String>,
    mic_device_label: Option<String>,
    /// Monotonic counter feeding the per-segment filename suffix.
    segment_counter: u32,
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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingNativeRecording {
    recording_id: String,
    server_url: String,
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

#[tauri::command]
pub async fn native_fullscreen_recording_start(
    app: AppHandle,
    state: State<'_, NativeFullscreenRecordingState>,
    recording_id: String,
    include_audio: bool,
    mic_device_id: Option<String>,
    mic_device_label: Option<String>,
) -> Result<NativeFullscreenStartInfo, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (
            app,
            state,
            recording_id,
            include_audio,
            mic_device_id,
            mic_device_label,
        );
        return Err("Native full-screen recording is currently macOS-only.".into());
    }

    #[cfg(target_os = "macos")]
    {
        let safe_id = sanitize_recording_id(&recording_id);
        let has_specific_mic = mic_device_id
            .as_deref()
            .is_some_and(|v| !v.trim().is_empty())
            || mic_device_label
                .as_deref()
                .is_some_and(|v| !v.trim().is_empty());
        let session = match start_screencapturekit_recording(
            &app,
            &safe_id,
            include_audio,
            mic_device_id.as_deref(),
            mic_device_label.as_deref(),
        ) {
            Ok(session) => session,
            Err(sck_err) => {
                if include_audio && has_specific_mic {
                    return Err(format!(
                        "ScreenCaptureKit recording failed before it could use the selected microphone ({sck_err}). Clips did not fall back to macOS screencapture because that would ignore your selected input."
                    ));
                }
                eprintln!(
                    "[clips-tray] ScreenCaptureKit recording unavailable; falling back to screencapture: {sck_err}"
                );
                start_screencapture_recording(&app, &safe_id, include_audio).map_err(|fallback_err| {
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
    let StoppedSession {
        session,
        duration_ms,
        stop_outcome,
        consolidate_outcome,
        multi_segment,
    } = take_and_finalize_active_session(&state)?;

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
    } else if let Err(merge_err) = &consolidate_outcome {
        saved.last_error = Some(merge_err.clone());
    }
    write_saved_recording_metadata(&app, &saved)?;
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
            clear_saved_recording(&app, &saved);
            Ok(result)
        }
        Err(err) => {
            saved.last_attempt_at = Some(now_iso());
            saved.last_error = Some(err.clone());
            saved.retry_count = saved.retry_count.saturating_add(1);
            let _ = write_saved_recording_metadata(&app, &saved);
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
        restart.mic_device_id.as_deref(),
        restart.mic_device_label.as_deref(),
        &segment_path,
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
    // With one segment this is a cheap rename. With multiple segments a
    // failure would silently lose everything after the first pause, so
    // callers check `multi_segment` and surface the merge error.
    let consolidate_outcome = consolidate_segments_into_path(&mut session);
    let multi_segment = session.segments.len() > 1;
    if let Err(err) = &consolidate_outcome {
        eprintln!("[clips-tray] segment consolidation failed: {err}");
    }
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
    mic_device_id: Option<&str>,
    mic_device_label: Option<&str>,
    segment_path: &Path,
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
            mic_device_id,
            mic_device_label,
        ) {
            Ok((backend, w, h)) => return Ok((backend, w, h)),
            Err(sck_err) => {
                eprintln!(
                    "[clips-tray] ScreenCaptureKit resume failed; falling back to screencapture: {sck_err}"
                );
            }
        }
        let (backend, w, h) =
            start_screencapture_backend_at(segment_path, include_audio).map_err(|fallback_err| {
                format!("ScreenCaptureKit resume failed; screencapture fallback failed ({fallback_err})")
            })?;
        Ok((backend, w, h))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (
            app,
            safe_id,
            include_audio,
            mic_device_id,
            mic_device_label,
            segment_path,
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
    mic_device_id: Option<&str>,
    mic_device_label: Option<&str>,
) -> Result<(NativeFullscreenBackend, Option<u32>, Option<u32>), String> {
    let content =
        SCShareableContent::get().map_err(|e| format!("shareable content lookup failed: {e:?}"))?;
    let displays = content.displays();
    let display = displays
        .first()
        .ok_or_else(|| "No displays available for ScreenCaptureKit recording.".to_string())?;

    let width = display.width();
    let height = display.height();
    let filter = SCContentFilter::create()
        .with_display(display)
        .with_excluding_windows(&[])
        .build();
    let selected_mic = if include_audio {
        resolve_microphone_capture_device(mic_device_id, mic_device_label)?
    } else {
        None
    };

    let mut config = SCStreamConfiguration::new()
        .with_width(width)
        .with_height(height)
        .with_fps(60)
        .with_queue_depth(8)
        .with_shows_cursor(true)
        .with_captures_audio(false)
        .with_captures_microphone(include_audio)
        .with_excludes_current_process_audio(true)
        .with_sample_rate(48000)
        .with_channel_count(2);
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
    let stream = SCStream::new(&filter, &config);
    stream
        .add_recording_output(&recording)
        .map_err(|e| format!("add recording output failed: {e:?}"))?;
    if let Err(err) = stream.start_capture() {
        let _ = stream.remove_recording_output(&recording);
        let _ = std::fs::remove_file(output_path);
        return Err(format!("capture start failed: {err:?}"));
    }
    eprintln!(
        "[clips-tray] ScreenCaptureKit recording started: {width}x{height} @ 60fps, microphone={include_audio}"
    );
    Ok((
        NativeFullscreenBackend::ScreenCaptureKit {
            stream,
            recording,
            finish,
        },
        Some(width),
        Some(height),
    ))
}

/// Spawn the macOS `screencapture` fallback writing into `output_path`.
/// Shared by the initial start and the resume path.
#[cfg(target_os = "macos")]
fn start_screencapture_backend_at(
    output_path: &Path,
    include_audio: bool,
) -> Result<(NativeFullscreenBackend, Option<u32>, Option<u32>), String> {
    if !std::path::Path::new("/usr/sbin/screencapture").exists() {
        return Err("macOS screencapture is unavailable on this machine.".into());
    }
    let mut command = Command::new("/usr/sbin/screencapture");
    command
        .arg("-v")
        .arg("-x")
        .arg("-C")
        .arg("-D1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if include_audio {
        command.arg("-g");
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
        None,
        None,
    ))
}

/// After all segments are finalized, make sure `session.path` contains a
/// single playable file. With one segment we just rename it into place;
/// with multiple, we concatenate via AVFoundation (passthrough export so
/// there's no re-encoding cost).
fn consolidate_segments_into_path(
    session: &mut NativeFullscreenSession,
) -> Result<(), String> {
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
        &saved,
        saved.server_url.clone(),
        auth_token.unwrap_or_default(),
        cookie.unwrap_or_default(),
    )
    .await;

    match result {
        Ok(result) => {
            clear_saved_recording(&app, &saved);
            Ok(result)
        }
        Err(err) => {
            persist_saved_recording_error(&app, &mut saved, &err);
            Err(format!(
                "{err}. The local copy is still saved, so you can retry again."
            ))
        }
    }
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
    value
        .to_lowercase()
        .replace("(default)", "")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(target_os = "macos")]
fn names_match(a: &str, b: &str) -> bool {
    let a = normalize_audio_device_name(a);
    let b = normalize_audio_device_name(b);
    !a.is_empty() && !b.is_empty() && (a == b || a.contains(&b) || b.contains(&a))
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
        return Ok(None);
    }

    let devices = AudioInputDevice::list();
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
        let status = Command::new("/usr/sbin/screencapture")
            .arg("-x")
            .arg("-t")
            .arg("jpg")
            .arg("-D1")
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
        .map_err(|e| format!("native recording file missing: {e}"))?
        .len();
    if bytes == 0 {
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

fn clear_saved_recording(app: &AppHandle, saved: &SavedNativeRecording) {
    let _ = std::fs::remove_file(&saved.file_path);
    if let Ok(path) = saved_recording_metadata_path(app, &saved.recording_id) {
        let _ = std::fs::remove_file(path);
    }
}

fn persist_saved_recording_error(app: &AppHandle, saved: &mut SavedNativeRecording, error: &str) {
    saved.last_attempt_at = Some(now_iso());
    saved.last_error = Some(error.to_string());
    saved.retry_count = saved.retry_count.saturating_add(1);
    let _ = write_saved_recording_metadata(app, saved);
}

#[cfg(target_os = "macos")]
fn start_screencapturekit_recording(
    app: &AppHandle,
    safe_id: &str,
    include_audio: bool,
    mic_device_id: Option<&str>,
    mic_device_label: Option<&str>,
) -> Result<NativeFullscreenSession, String> {
    let path = pending_recording_path(app, safe_id, "mp4")?;
    let _ = std::fs::remove_file(&path);
    let (backend, width, height) = start_screencapturekit_backend_at(
        &path,
        include_audio,
        mic_device_id,
        mic_device_label,
    )?;
    let (fallback_width, fallback_height) = primary_monitor_size(app);
    Ok(new_fullscreen_session(
        backend,
        path,
        MP4_RECORDING_MIME_TYPE,
        width.or(fallback_width),
        height.or(fallback_height),
        RestartInfo {
            safe_id: safe_id.to_string(),
            include_audio,
            mic_device_id: mic_device_id.map(str::to_string),
            mic_device_label: mic_device_label.map(str::to_string),
            segment_counter: 0,
        },
    ))
}

#[cfg(target_os = "macos")]
fn start_screencapture_recording(
    app: &AppHandle,
    safe_id: &str,
    include_audio: bool,
) -> Result<NativeFullscreenSession, String> {
    let path = pending_recording_path(app, safe_id, "mov")?;
    let _ = std::fs::remove_file(&path);
    let (backend, _w, _h) = start_screencapture_backend_at(&path, include_audio)?;
    let (width, height) = primary_monitor_size(app);
    Ok(new_fullscreen_session(
        backend,
        path,
        QUICKTIME_RECORDING_MIME_TYPE,
        width,
        height,
        RestartInfo {
            safe_id: safe_id.to_string(),
            include_audio,
            mic_device_id: None,
            mic_device_label: None,
            segment_counter: 0,
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
        } => {
            let stop_result = stream
                .stop_capture()
                .map_err(|e| format!("ScreenCaptureKit stop failed: {e:?}"));
            // remove_recording_output() occasionally fails with
            // StreamError("Failed due to an invalid parameter") when the audio
            // tap or stream state hasn't fully drained yet. Retry once after a
            // short pause before giving up — the underlying MP4 file is
            // already on disk by this point, so the recovery path can still
            // pick it up via write_saved_recording_metadata().
            let remove_result = stream
                .remove_recording_output(recording)
                .map_err(|e| format!("ScreenCaptureKit recording finalize failed: {e:?}"));
            let remove_result = match remove_result {
                Ok(v) => Ok(v),
                Err(first_err) => {
                    std::thread::sleep(Duration::from_millis(150));
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
        &session.path,
        session.mime_type,
        session.width,
        session.height,
    )?;
    let upload_result = upload_prepared_recording_file(
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
    saved: &SavedNativeRecording,
    server_url: String,
    auth_token: String,
    cookie: String,
) -> Result<NativeFullscreenUploadResult, String> {
    let prepared = prepare_recording_file(
        &saved.file_path,
        &saved.mime_type,
        saved.width,
        saved.height,
    )?;
    let upload_result = upload_prepared_recording_file(
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
    }

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

fn prepare_recording_file(
    path: &Path,
    mime_type: &str,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<PreparedRecordingFile, String> {
    let metadata =
        std::fs::metadata(path).map_err(|e| format!("native recording file missing: {e}"))?;
    let source_bytes = metadata.len();
    if source_bytes == 0 {
        return Err("Native recording produced an empty file.".into());
    }

    let original = PreparedRecordingFile {
        path: path.to_path_buf(),
        mime_type: mime_type.to_string(),
        bytes: source_bytes,
        temporary: false,
    };

    if source_bytes < TRANSCODE_THRESHOLD_BYTES {
        return Ok(original);
    }
    if !std::path::Path::new(AVCONVERT_PATH).exists() {
        eprintln!("[clips-tray] avconvert unavailable; uploading native MOV without transcode");
        return Ok(original);
    }

    let presets = native_transcode_presets(width, height, source_bytes);
    for (index, preset) in presets.iter().enumerate() {
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
                if compressed_bytes >= source_bytes {
                    let _ = std::fs::remove_file(&compressed_path);
                    eprintln!(
                        "[clips-tray] avconvert {} did not reduce size ({} >= {})",
                        preset, compressed_bytes, source_bytes
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

fn native_transcode_presets(
    width: Option<u32>,
    height: Option<u32>,
    source_bytes: u64,
) -> [&'static str; 3] {
    let long_side = width.unwrap_or(0).max(height.unwrap_or(0));
    if source_bytes >= 160 * 1024 * 1024 || long_side > 1920 {
        ["Preset1280x720", "Preset960x540", "PresetAppleM4V480pSD"]
    } else {
        ["Preset1920x1080", "Preset1280x720", "Preset960x540"]
    }
}

fn transcode_with_avconvert(source: &Path, output: &Path, preset: &str) -> Result<(), String> {
    let mut child = Command::new(AVCONVERT_PATH)
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

    let deadline = Instant::now() + AVCONVERT_TIMEOUT;
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("avconvert wait failed: {e}"))?
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
            return Err(format!("avconvert exited with {status}: {}", tail.trim()));
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err("avconvert timed out while compressing recording".into());
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
        const ENCODING: Encoding = Encoding::Struct(
            "CMTimeRange",
            &[CMTime::ENCODING, CMTime::ENCODING],
        );
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
        let inited: *mut AnyObject =
            msg_send![allocated, initWithUTF8String: cstr.as_ptr()];
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

    unsafe fn first_track(asset: &AnyObject, media_type: *const AnyObject) -> Option<*mut AnyObject> {
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
        let composition_cls =
            class_named("AVMutableComposition").ok_or_else(|| "AVMutableComposition missing".to_string())?;
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
        let asset_cls = class_named("AVURLAsset").ok_or_else(|| "AVURLAsset missing".to_string())?;
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
            let asset: *mut AnyObject =
                msg_send![asset_cls, URLAssetWithURL: &*url, options: std::ptr::null::<AnyObject>()];
            if asset.is_null() {
                return Err(format!("AVURLAsset URLAssetWithURL returned nil for {}", path.display()));
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
