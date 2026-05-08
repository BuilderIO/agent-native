use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};

#[cfg(target_os = "macos")]
use screencapturekit::recording_output::{
    SCRecordingOutput, SCRecordingOutputCodec, SCRecordingOutputConfiguration,
    SCRecordingOutputFileType,
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
    backend: NativeFullscreenBackend,
    path: PathBuf,
    mime_type: &'static str,
    started_at: Instant,
    width: Option<u32>,
    height: Option<u32>,
}

enum NativeFullscreenBackend {
    Screencapture {
        child: Child,
    },
    #[cfg(target_os = "macos")]
    ScreenCaptureKit {
        stream: SCStream,
        recording: SCRecordingOutput,
    },
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
) -> Result<NativeFullscreenStartInfo, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, state, recording_id, include_audio);
        return Err("Native full-screen recording is currently macOS-only.".into());
    }

    #[cfg(target_os = "macos")]
    {
        let safe_id = sanitize_recording_id(&recording_id);
        let session = match start_screencapturekit_recording(&app, &safe_id, include_audio) {
            Ok(session) => session,
            Err(sck_err) => {
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
            let _ = stop_native_recording(&mut previous.backend);
            let _ = std::fs::remove_file(previous.path);
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
    let mut session = {
        let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
        guard.take()
    }
    .ok_or_else(|| "No native full-screen recording is active.".to_string())?;

    stop_native_recording(&mut session.backend)?;
    let duration_ms = session.started_at.elapsed().as_millis();
    let mut saved = saved_recording_from_session(
        &session,
        &server_url,
        &recording_id,
        duration_ms,
        has_audio,
        has_camera,
    )?;
    write_saved_recording_metadata(&app, &saved)?;

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
            eprintln!(
                "[clips-tray] native thumbnail upload failed for {recording_id}: {err}"
            );
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
        let _ = stop_native_recording(&mut session.backend);
        let _ = std::fs::remove_file(session.path);
    }
    Ok(())
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
        let bytes = std::fs::read(&upload_path)
            .map_err(|e| format!("thumbnail read failed: {e}"))?;
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
) -> Result<NativeFullscreenSession, String> {
    let path = pending_recording_path(app, safe_id, "mp4")?;
    let _ = std::fs::remove_file(&path);

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

    config.set_stream_name(Some("Clips full-screen recording"));

    let recording_config = SCRecordingOutputConfiguration::new()
        .with_output_url(&path)
        .with_video_codec(SCRecordingOutputCodec::H264)
        .with_output_file_type(SCRecordingOutputFileType::MP4);
    let recording = SCRecordingOutput::new(&recording_config).ok_or_else(|| {
        "ScreenCaptureKit recording output could not be created. macOS 15+ is required.".to_string()
    })?;
    let stream = SCStream::new(&filter, &config);
    stream
        .add_recording_output(&recording)
        .map_err(|e| format!("add recording output failed: {e:?}"))?;
    if let Err(err) = stream.start_capture() {
        let _ = stream.remove_recording_output(&recording);
        let _ = std::fs::remove_file(&path);
        return Err(format!("capture start failed: {err:?}"));
    }
    eprintln!(
        "[clips-tray] ScreenCaptureKit recording started: {width}x{height} @ 60fps, microphone={include_audio}"
    );

    let (fallback_width, fallback_height) = primary_monitor_size(app);
    Ok(NativeFullscreenSession {
        backend: NativeFullscreenBackend::ScreenCaptureKit { stream, recording },
        path,
        mime_type: MP4_RECORDING_MIME_TYPE,
        started_at: Instant::now(),
        width: Some(width).or(fallback_width),
        height: Some(height).or(fallback_height),
    })
}

#[cfg(target_os = "macos")]
fn start_screencapture_recording(
    app: &AppHandle,
    safe_id: &str,
    include_audio: bool,
) -> Result<NativeFullscreenSession, String> {
    if !std::path::Path::new("/usr/sbin/screencapture").exists() {
        return Err("macOS screencapture is unavailable on this machine.".into());
    }

    let path = pending_recording_path(app, safe_id, "mov")?;
    let _ = std::fs::remove_file(&path);

    let (width, height) = primary_monitor_size(app);

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
    command.arg(&path);

    let mut child = command
        .spawn()
        .map_err(|e| format!("screencapture spawn failed: {e}"))?;

    std::thread::sleep(Duration::from_millis(300));
    if let Some(status) = child
        .try_wait()
        .map_err(|e| format!("screencapture startup check failed: {e}"))?
    {
        let _ = std::fs::remove_file(&path);
        return Err(format!(
            "screencapture exited before recording started ({status}). Check Screen Recording and Microphone permissions for Clips."
        ));
    }
    eprintln!("[clips-tray] screencapture recording started");

    Ok(NativeFullscreenSession {
        backend: NativeFullscreenBackend::Screencapture { child },
        path,
        mime_type: QUICKTIME_RECORDING_MIME_TYPE,
        started_at: Instant::now(),
        width,
        height,
    })
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

fn stop_native_recording(backend: &mut NativeFullscreenBackend) -> Result<(), String> {
    match backend {
        NativeFullscreenBackend::Screencapture { child } => stop_screencapture(child),
        #[cfg(target_os = "macos")]
        NativeFullscreenBackend::ScreenCaptureKit { stream, recording } => {
            let stop_result = stream
                .stop_capture()
                .map_err(|e| format!("ScreenCaptureKit stop failed: {e:?}"));
            let remove_result = stream
                .remove_recording_output(recording)
                .map_err(|e| format!("ScreenCaptureKit recording finalize failed: {e:?}"));
            stop_result.and(remove_result)
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
