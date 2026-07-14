//! Live chunk uploader for the custom capture pipeline.
//!
//! Tails the growing fragmented MP4 during recording and streams whole
//! chunks to the server by index, then drains the tail and closes the
//! sequence on finalize. Owns the uploader task lifecycle
//! (`LiveUploadCtrl` / `LiveUpload`); the parent `native_screen` module
//! decides when to attach, finalize, or abandon it.

use super::*;

// ---------------------------------------------------------------------------
// Live upload (custom pipeline)
//
// Streams the growing fragmented MP4 to the server in UPLOAD_CHUNK_BYTES slices
// while recording is still in progress, instead of waiting for stop+finalize.
// Safe because the custom writer produces an append-only file (movie
// fragments): byte ranges we upload never change. The server concatenates the
// uploaded chunks in index order to reproduce the exact file.
// ---------------------------------------------------------------------------

const LIVE_UPLOAD_POLL_MS: u64 = 250;
/// Attempts per chunk before the live upload gives up (the stop path then
/// saves the clip locally for manual retry).
const LIVE_UPLOAD_CHUNK_ATTEMPTS: u32 = 5;
/// First retry backoff; doubles per attempt (0.5s, 1s, 2s, 4s).
const LIVE_UPLOAD_RETRY_BASE_MS: u64 = 500;

pub(super) struct LiveUploadCtrl {
    /// Set once the writer is finalized: drain the tail and send the final post.
    pub(super) finalize: AtomicBool,
    /// Abort without finalizing (cancel / discard / error).
    pub(super) cancelled: AtomicBool,
    /// Recorded media duration in ms; set just before `finalize`.
    pub(super) duration_ms: AtomicU64,
}

pub(super) struct LiveUpload {
    pub(super) ctrl: Arc<LiveUploadCtrl>,
    /// Resolves with the total bytes uploaded, or an error string.
    pub(super) result_rx: tokio::sync::oneshot::Receiver<Result<u64, String>>,
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

/// Spawn the background uploader and return a handle the stop path uses to
/// finalize (or cancel) it.
fn spawn_live_uploader(app: AppHandle, params: LiveUploadParams) -> LiveUpload {
    let ctrl = Arc::new(LiveUploadCtrl {
        finalize: AtomicBool::new(false),
        cancelled: AtomicBool::new(false),
        duration_ms: AtomicU64::new(0),
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

/// Build and attach a live uploader to an already-recording session. No-op when
/// live upload is disabled, the session isn't the custom pipeline, an uploader
/// is already attached, or no server URL was provided (local-only recordings).
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

/// Read exactly `len` bytes at `offset` from a file that is still being written.
/// Safe here because the custom writer only appends, so bytes below the current
/// length are stable.
fn read_file_range(path: &Path, offset: u64, len: usize) -> Result<Vec<u8>, String> {
    let mut file = File::open(path).map_err(|e| format!("live upload open failed: {e}"))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("live upload seek failed: {e}"))?;
    let mut buf = vec![0_u8; len];
    file.read_exact(&mut buf)
        .map_err(|e| format!("live upload read failed: {e}"))?;
    Ok(buf)
}

/// Send one live-upload POST, retrying transient failures with exponential
/// backoff. Bails out between attempts if the upload is cancelled.
async fn send_live_upload_post_with_retry(
    client: &reqwest::Client,
    ctrl: &LiveUploadCtrl,
    params: &LiveUploadParams,
    index: usize,
    total: usize,
    is_final: bool,
    duration_ms: Option<u128>,
    bytes: &[u8],
) -> Result<(), String> {
    let rec = &params.recording_id;
    let mut attempt: u32 = 0;
    loop {
        // The uploader task can outlive an abandoned session (pause/discard
        // set `cancelled` and drop the handle), so bail before spending a
        // network attempt. An already in-flight POST still runs to completion
        // — narrow accepted race; the full re-upload path resets server
        // chunks first, and re-uploaded indexes overwrite stale ones.
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
            bytes.to_vec(),
        )
        .await;
        let err = match result {
            Ok(()) => return Ok(()),
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
) -> Result<u64, String> {
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

        // While recording, only upload whole chunks — the last partial chunk
        // may still be growing. On finalize, drain everything that remains.
        while file_len.saturating_sub(offset) >= chunk {
            wait_logged = false;
            let bytes = read_file_range(&params.path, offset, chunk as usize)?;
            eprintln!(
                "[live-upload] {rec}: sending chunk #{index} offset={offset} size={} (file now {file_len})",
                bytes.len()
            );
            if let Err(e) = send_live_upload_post_with_retry(
                &client, &ctrl, &params, index, 0, false, None, &bytes,
            )
            .await
            {
                eprintln!("[live-upload] {rec}: chunk #{index} failed: {e}");
                return Err(e);
            }
            offset += chunk;
            index += 1;
            emit_native_upload_progress(&app, "uploading", "Uploading clip", None, None);
        }

        if finalize {
            let final_len = std::fs::metadata(&params.path)
                .map(|m| m.len())
                .unwrap_or(offset);
            let duration_ms = ctrl.duration_ms.load(Ordering::SeqCst) as u128;
            eprintln!(
                "[live-upload] {rec}: finalizing — {index} chunk(s) sent, draining tail (offset={offset}, final_len={final_len})"
            );
            emit_native_upload_progress(&app, "processing", "Uploading clip", None, None);

            // The last tail chunk doubles as the final post (data + is_final).
            // The server's resumable-session path relays chunks to GCS, whose
            // protocol requires every NON-final chunk to be a multiple of
            // 256 KiB — only the final chunk may have arbitrary size. Sending
            // the arbitrary-sized tail as non-final followed by an empty final
            // sentinel makes GCS silently commit only the aligned prefix, and
            // the session close then fails forever with 308 (incomplete).
            let mut final_sent = false;
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
                if let Err(e) = send_live_upload_post_with_retry(
                    &client, &ctrl, &params, index, total, is_last, duration, &bytes,
                )
                .await
                {
                    eprintln!("[live-upload] {rec}: tail chunk #{index} failed: {e}");
                    return Err(e);
                }
                offset += take;
                index += 1;
                final_sent = final_sent || is_last;
            }

            // No tail bytes left: close with the empty final sentinel. All
            // streamed chunks were whole UPLOAD_CHUNK_BYTES (256 KiB aligned),
            // so the provider can close the session on the declared total.
            if !final_sent {
                eprintln!(
                    "[live-upload] {rec}: sending final post #{index} (total={}, duration_ms={duration_ms})",
                    index + 1
                );
                if let Err(e) = send_live_upload_post_with_retry(
                    &client,
                    &ctrl,
                    &params,
                    index,
                    index + 1,
                    true,
                    Some(duration_ms),
                    &[],
                )
                .await
                {
                    eprintln!("[live-upload] {rec}: final post failed: {e}");
                    return Err(e);
                }
            }
            emit_native_upload_progress(&app, "opening", "Uploading clip", None, Some(1.0));
            eprintln!("[live-upload] {rec}: done — {index} post(s), {final_len} bytes total");
            return Ok(final_len);
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
