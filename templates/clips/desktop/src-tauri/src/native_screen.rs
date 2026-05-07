use serde::Serialize;
use std::fs::File;
use std::io::Read;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};

const RECORDING_MIME_TYPE: &str = "video/quicktime";
const UPLOAD_CHUNK_BYTES: usize = 5 * 1024 * 1024;

#[derive(Default)]
pub struct NativeFullscreenRecordingState {
    inner: Mutex<Option<NativeFullscreenSession>>,
}

struct NativeFullscreenSession {
    child: Child,
    path: PathBuf,
    started_at: Instant,
    width: Option<u32>,
    height: Option<u32>,
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
        if !std::path::Path::new("/usr/sbin/screencapture").exists() {
            return Err("macOS screencapture is unavailable on this machine.".into());
        }

        let safe_id = sanitize_recording_id(&recording_id);
        let path = std::env::temp_dir().join(format!(
            "clips-fullscreen-{safe_id}-{}.mov",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);

        let monitor_size = app
            .primary_monitor()
            .ok()
            .flatten()
            .map(|monitor| *monitor.size());
        let width = monitor_size.map(|size| size.width);
        let height = monitor_size.map(|size| size.height);

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

        let previous = {
            let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
            guard.take()
        };
        if let Some(mut previous) = previous {
            let _ = stop_screencapture(&mut previous.child);
            let _ = std::fs::remove_file(previous.path);
        }

        {
            let mut guard = state.inner.lock().map_err(|e| e.to_string())?;
            *guard = Some(NativeFullscreenSession {
                child,
                path,
                started_at: Instant::now(),
                width,
                height,
            });
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

    stop_screencapture(&mut session.child)?;
    let duration_ms = session.started_at.elapsed().as_millis();
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
    let _ = std::fs::remove_file(&session.path);
    result
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
        let _ = stop_screencapture(&mut session.child);
        let _ = std::fs::remove_file(session.path);
    }
    Ok(())
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
    let metadata = std::fs::metadata(&session.path)
        .map_err(|e| format!("native recording file missing: {e}"))?;
    let total_bytes = metadata.len();
    if total_bytes == 0 {
        return Err("Native recording produced an empty file.".into());
    }

    let total_chunks = ((total_bytes as usize) + UPLOAD_CHUNK_BYTES - 1) / UPLOAD_CHUNK_BYTES;
    let total_posts = total_chunks + 1;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("upload client failed: {e}"))?;
    let mut file =
        File::open(&session.path).map_err(|e| format!("native recording open failed: {e}"))?;

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
            session.width,
            session.height,
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
        session.width,
        session.height,
        has_audio,
        has_camera,
        Vec::new(),
    )
    .await?;

    Ok(NativeFullscreenUploadResult {
        recording_id,
        duration_ms,
        width: session.width,
        height: session.height,
        bytes: total_bytes,
    })
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
        width,
        height,
        has_audio,
        has_camera,
    )?;
    let mut request = client
        .post(url)
        .header("Content-Type", RECORDING_MIME_TYPE)
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
            .append_pair("mimeType", RECORDING_MIME_TYPE)
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
