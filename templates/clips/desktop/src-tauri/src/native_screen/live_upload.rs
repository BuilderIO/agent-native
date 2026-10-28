
use super::*;


const LIVE_UPLOAD_POLL_MS: u64 = 250;
const LIVE_UPLOAD_CHUNK_ATTEMPTS: u32 = 5;
const LIVE_UPLOAD_RETRY_BASE_MS: u64 = 500;

pub(super) struct LiveUploadCtrl {
    pub(super) finalize: AtomicBool,
    pub(super) cancelled: AtomicBool,
    pub(super) duration_ms: AtomicU64,
    pub(super) uploaded_bytes: AtomicU64,
}

pub(super) struct LiveUpload {
    pub(super) ctrl: Arc<LiveUploadCtrl>,
    pub(super) result_rx: tokio::sync::oneshot::Receiver<Result<LiveUploadResult, String>>,
}

pub(super) struct LiveUploadResult {
    pub(super) bytes: u64,
    pub(super) verification_pending: bool,
}

struct LiveUploadParams {
    path: PathBuf,
    server_url: String,
    recording_id: String,
    auth_token: String,
    cookie: String,
    mime_type: String,
    width: Option<u32>,
    height: Option<u32>,
    has_audio: bool,
    has_camera: bool,
}

#[derive(Clone)]
pub(crate) struct ClipLiveUploadConfig {
    pub(crate) server_url: Option<String>,
    pub(crate) recording_id: Option<String>,
    pub(crate) auth_token: Option<String>,
    pub(crate) cookie: Option<String>,
}

impl ClipLiveUploadConfig {
    pub(crate) fn validated(self) -> Result<Option<(String, String, String, String)>, String> {
        let Some(server_url) = self.server_url.filter(|value| !value.trim().is_empty()) else {
            return Ok(None);
        };
        let recording_id = self
            .recording_id
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "Clip live upload requires a recording ID".to_string())?;
        let auth_token = self.auth_token.unwrap_or_default();
        let cookie = self.cookie.unwrap_or_default();
        if auth_token.trim().is_empty() && cookie.trim().is_empty() {
            return Err("Clip live upload requires auth token or cookie".into());
        }
        Ok(Some((server_url, recording_id, auth_token, cookie)))
    }
}

pub(super) fn start_clip_live_uploader(
    app: &AppHandle,
    path: PathBuf,
    mime_type: String,
    width: Option<u32>,
    height: Option<u32>,
    has_audio: bool,
    has_camera: bool,
    upload: ClipLiveUploadConfig,
) -> Result<Option<LiveUpload>, String> {
    let Some((server_url, recording_id, auth_token, cookie)) = upload.validated()? else {
        return Ok(None);
    };
    Ok(Some(spawn_live_uploader(
        app.clone(),
        LiveUploadParams {
            path,
            server_url,
            recording_id,
            auth_token,
            cookie,
            mime_type,
            width,
            height,
            has_audio,
            has_camera,
        },
    )))
}

pub(super) async fn finalize_clip_live_upload(
    live: LiveUpload,
    duration_ms: u64,
) -> Result<LiveUploadResult, String> {
    live.ctrl.duration_ms.store(duration_ms, Ordering::SeqCst);
    live.ctrl.finalize.store(true, Ordering::SeqCst);
    live.result_rx
        .await
        .map_err(|_| "Clip live uploader ended before returning a result".to_string())?
}

pub(super) fn cancel_clip_live_upload(live: &LiveUpload) {
    live.ctrl.cancelled.store(true, Ordering::SeqCst);
}

fn spawn_live_uploader(app: AppHandle, params: LiveUploadParams) -> LiveUpload {
    let ctrl = Arc::new(LiveUploadCtrl {
        finalize: AtomicBool::new(false),
        cancelled: AtomicBool::new(false),
        duration_ms: AtomicU64::new(0),
        uploaded_bytes: AtomicU64::new(0),
    });
    let (tx, rx) = tokio::sync::oneshot::channel();
    let ctrl_task = ctrl.clone();
    tauri::async_runtime::spawn(async move {
        let result = live_upload_loop(app, ctrl_task, params).await;
        let _ = tx.send(result);
    });
    LiveUpload {
        ctrl,
        result_rx: rx,
    }
}

pub(super) fn attach_live_uploader_to_session(
    app: &AppHandle,
    session: &mut NativeFullscreenSession,
    recording_id: &str,
    server_url: Option<&str>,
    auth_token: Option<&str>,
    cookie: Option<&str>,
    has_audio: bool,
    has_camera: bool,
) {
    let segmented_writer = matches!(
        session.backend.as_ref(),
        Some(NativeFullscreenBackend::CustomScreenCaptureKit { writer, .. })
            if writer.segmented()
    );
    if !segmented_writer {
        eprintln!(
            "[live-upload] writer not in append-only segmented mode (live upload off at writer creation, or not the custom pipeline); skipping for {recording_id}"
        );
        return;
    }
    if session.live_upload.is_some() {
        eprintln!("[live-upload] already attached; skipping for {recording_id}");
        return;
    }
    let server_url = match server_url {
        Some(s) if !s.trim().is_empty() => s.to_string(),
        _ => {
            eprintln!("[live-upload] no server URL (local-only?); skipping for {recording_id}");
            return;
        }
    };

    let has_auth = auth_token.is_some_and(|t| !t.trim().is_empty())
        || cookie.is_some_and(|c| !c.trim().is_empty());
    if !has_auth {
        eprintln!(
            "[live-upload] no auth credentials yet (session not fully propagated?); skipping live upload for {recording_id}, will upload at stop"
        );
        return;
    }
    eprintln!(
        "[live-upload] attaching uploader for {recording_id}: file={} server={server_url} has_audio={has_audio} has_camera={has_camera} size={:?}",
        session.path.display(),
        std::fs::metadata(&session.path).map(|m| m.len()).ok(),
    );
    let params = LiveUploadParams {
        path: session.path.clone(),
        server_url,
        recording_id: recording_id.to_string(),
        auth_token: auth_token.unwrap_or_default().to_string(),
        cookie: cookie.unwrap_or_default().to_string(),
        mime_type: session.mime_type.to_string(),
        width: session.width,
        height: session.height,
        has_audio,
        has_camera,
    };
    session.live_upload = Some(spawn_live_uploader(app.clone(), params));
    session.had_live_upload = true;
}

fn read_file_range(path: &Path, offset: u64, len: usize) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|e| format!("live upload open failed: {e}"))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("live upload seek failed: {e}"))?;
    let mut buf = vec![0_u8; len];
    file.read_exact(&mut buf)
        .map_err(|e| format!("live upload read failed: {e}"))?;
    Ok(buf)
}

async fn send_live_upload_post_with_retry(
    client: &reqwest::Client,
    ctrl: &LiveUploadCtrl,
    params: &LiveUploadParams,
    index: usize,
    total: usize,
    is_final: bool,
    duration_ms: Option<u128>,
    expected_source_bytes: Option<u64>,
    bytes: &[u8],
) -> Result<bool, String> {
    let rec = &params.recording_id;
    let mut attempt: u32 = 0;
    loop {
        if ctrl.cancelled.load(Ordering::SeqCst) {
            return Err("live upload cancelled".into());
        }
        attempt += 1;
        let result = send_upload_post(
            client,
            &params.server_url,
            &params.recording_id,
            &params.auth_token,
            &params.cookie,
            index,
            total,
            is_final,
            duration_ms,
            &params.mime_type,
            params.width,
            params.height,
            params.has_audio,
            params.has_camera,
            NativeUploadMode::Buffered,
            false,
            expected_source_bytes,
            bytes.to_vec(),
        )
        .await;
        let err = match result {
            Ok(verification_pending) => return Ok(verification_pending),
            Err(err) => err,
        };
        if attempt >= LIVE_UPLOAD_CHUNK_ATTEMPTS {
            return Err(err);
        }
        let backoff_ms = LIVE_UPLOAD_RETRY_BASE_MS << (attempt - 1);
        eprintln!(
            "[live-upload] {rec}: chunk #{index} attempt {attempt}/{LIVE_UPLOAD_CHUNK_ATTEMPTS} failed: {err}; retrying in {backoff_ms}ms"
        );
        tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
        if ctrl.cancelled.load(Ordering::SeqCst) {
            return Err("live upload cancelled".into());
        }
    }
}

async fn live_upload_loop(
    app: AppHandle,
    ctrl: Arc<LiveUploadCtrl>,
    params: LiveUploadParams,
) -> Result<LiveUploadResult, String> {
    let rec = params.recording_id.clone();
    eprintln!(
        "[live-upload] loop started for {rec}: file={} chunk={} bytes",
        params.path.display(),
        UPLOAD_CHUNK_BYTES
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| {
            let msg = format!("live upload client failed: {e}");
            eprintln!("[live-upload] {rec}: {msg}");
            msg
        })?;

    let mut offset: u64 = 0;
    let mut index: usize = 0;
    let chunk = UPLOAD_CHUNK_BYTES as u64;
    let mut wait_logged = false;

    loop {
        if ctrl.cancelled.load(Ordering::SeqCst) {
            eprintln!("[live-upload] {rec}: cancelled after {index} chunk(s), {offset} bytes sent");
            return Err("live upload cancelled".into());
        }
        let finalize = ctrl.finalize.load(Ordering::SeqCst);
        let file_len = std::fs::metadata(&params.path)
            .map(|m| m.len())
            .unwrap_or(offset);

        while file_len.saturating_sub(offset) >= chunk {
            wait_logged = false;
            let bytes = read_file_range(&params.path, offset, chunk as usize)?;
            eprintln!(
                "[live-upload] {rec}: sending chunk #{index} offset={offset} size={} (file now {file_len})",
                bytes.len()
            );
            if let Err(e) = send_live_upload_post_with_retry(
                &client, &ctrl, &params, index, 0, false, None, None, &bytes,
            )
            .await
            {
                eprintln!("[live-upload] {rec}: chunk #{index} failed: {e}");
                return Err(e);
            }
            offset += chunk;
            ctrl.uploaded_bytes.store(offset, Ordering::SeqCst);
            crate::logfile::diagnostic(&format!(
                "[live-upload] {rec}: acknowledged {offset} bytes before finalize={finalize}"
            ));
            index += 1;
            emit_native_upload_progress(&app, &rec, "uploading", "Uploading clip", None, None);
        }

        if finalize {
            let final_len = std::fs::metadata(&params.path)
                .map(|m| m.len())
                .unwrap_or(offset);
            let duration_ms = ctrl.duration_ms.load(Ordering::SeqCst) as u128;
            eprintln!(
                "[live-upload] {rec}: finalizing — {index} chunk(s) sent, draining tail (offset={offset}, final_len={final_len})"
            );
            emit_native_upload_progress(&app, &rec, "processing", "Uploading clip", None, None);

            let mut final_sent = false;
            let mut verification_pending = false;
            while final_len > offset {
                let take = chunk.min(final_len - offset);
                let is_last = offset + take >= final_len;
                let bytes = read_file_range(&params.path, offset, take as usize)?;
                let (total, duration) = if is_last {
                    (index + 1, Some(duration_ms))
                } else {
                    (0, None)
                };
                eprintln!(
                    "[live-upload] {rec}: sending tail chunk #{index} offset={offset} size={take} final={is_last}"
                );
                let receipt = send_live_upload_post_with_retry(
                    &client,
                    &ctrl,
                    &params,
                    index,
                    total,
                    is_last,
                    duration,
                    is_last.then_some(final_len),
                    &bytes,
                )
                .await;
                let pending = match receipt {
                    Ok(pending) => pending,
                    Err(e) => {
                        eprintln!("[live-upload] {rec}: tail chunk #{index} failed: {e}");
                        return Err(e);
                    }
                };
                if is_last {
                    verification_pending = pending;
                }
                offset += take;
                ctrl.uploaded_bytes.store(offset, Ordering::SeqCst);
                index += 1;
                final_sent = final_sent || is_last;
            }

            if !final_sent {
                eprintln!(
                    "[live-upload] {rec}: sending final post #{index} (total={}, duration_ms={duration_ms})",
                    index + 1
                );
                verification_pending = match send_live_upload_post_with_retry(
                    &client,
                    &ctrl,
                    &params,
                    index,
                    index + 1,
                    true,
                    Some(duration_ms),
                    Some(final_len),
                    &[],
                )
                .await
                {
                    Ok(pending) => pending,
                    Err(e) => {
                        eprintln!("[live-upload] {rec}: final post failed: {e}");
                        return Err(e);
                    }
                };
            }
            emit_native_upload_progress(&app, &rec, "opening", "Uploading clip", None, Some(1.0));
            eprintln!("[live-upload] {rec}: done — {index} post(s), {final_len} bytes total");
            crate::logfile::diagnostic(&format!(
                "[live-upload] {rec}: complete with {final_len} acknowledged bytes"
            ));
            return Ok(LiveUploadResult {
                bytes: final_len,
                verification_pending,
            });
        }

        if !wait_logged {
            eprintln!(
                "[live-upload] {rec}: waiting for data (file={file_len}, sent={offset}, need {chunk}/chunk)"
            );
            wait_logged = true;
        }
        tokio::time::sleep(Duration::from_millis(LIVE_UPLOAD_POLL_MS)).await;
    }
}

#[cfg(test)]
mod clip_upload_config_tests {
    use super::*;

    #[test]
    fn local_only_clip_upload_is_explicitly_allowed() {
        assert!(ClipLiveUploadConfig {
            server_url: None,
            recording_id: None,
            auth_token: None,
            cookie: None,
        }
        .validated()
        .unwrap()
        .is_none());
    }

    #[test]
    fn remote_clip_upload_rejects_partial_authority() {
        assert!(ClipLiveUploadConfig {
            server_url: Some("https://clips.example".into()),
            recording_id: None,
            auth_token: Some("token".into()),
            cookie: None,
        }
        .validated()
        .is_err());
        assert!(ClipLiveUploadConfig {
            server_url: Some("https://clips.example".into()),
            recording_id: Some("recording".into()),
            auth_token: None,
            cookie: None,
        }
        .validated()
        .is_err());
    }
}
