//! Parakeet, the on-device English dictation model: its pinned download, and
//! the load and warm-up that make it ready to transcribe while a key is held.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::AppHandle;
#[cfg(target_os = "macos")]
use tauri::Emitter;

use crate::model_download::downloaded_mb;
#[cfg(target_os = "macos")]
use crate::model_download::{download_verified, VerifiedDownload, DOWNLOAD_CANCELLED};

// Only the macOS build downloads the file; elsewhere just its size is shown.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) struct ParakeetFile {
    pub url: &'static str,
    pub filename: &'static str,
    pub sha256: &'static str,
    pub size_bytes: u64,
    /// Decimal megabytes, the unit Finder and the download page use.
    pub size_mb: u64,
}

pub(crate) const PARAKEET_MODEL: ParakeetFile = ParakeetFile {
    url: "https://huggingface.co/handy-computer/parakeet-unified-en-0.6b-gguf/resolve/843b1b175ace04f5a89d379c79e2518c0d065b25/parakeet-unified-en-0.6b-Q8_0.gguf",
    filename: "parakeet-unified-en-0.6b-Q8_0.gguf",
    sha256: "4b50b6dd862bf6e346929aaf4f5eaacec003bfa3f56462d6c874b41ef2f38795",
    size_bytes: 731_357_568,
    size_mb: 731,
};

static DOWNLOADING: AtomicBool = AtomicBool::new(false);
static DOWNLOADED_BYTES: AtomicU64 = AtomicU64::new(0);
static CANCEL_DOWNLOAD: AtomicBool = AtomicBool::new(false);
static PREPARING: AtomicBool = AtomicBool::new(false);
/// Set once the file has loaded and warmed up in this launch. Dictation only
/// picks Parakeet after that, so a missing or broken file falls back to Apple
/// Speech instead of failing a dictation.
static READY: AtomicBool = AtomicBool::new(false);
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);

pub(crate) fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::whisper_model::models_dir(app)?.join(PARAKEET_MODEL.filename))
}

fn is_complete_on_disk(path: &Path) -> bool {
    std::fs::metadata(path)
        .map(|m| m.len() == PARAKEET_MODEL.size_bytes)
        .unwrap_or(false)
}

pub(crate) fn is_ready() -> bool {
    READY.load(Ordering::SeqCst)
}

/// The Parakeet model, loading it into the shared slot if something else is
/// resident. The flag is true when this call did the loading, so the caller
/// knows the model has not warmed up.
#[cfg(target_os = "macos")]
pub(crate) fn resident_model(app: &AppHandle) -> Result<(transcribe_cpp::Model, bool), String> {
    crate::transcribe_engine::LOCAL_MODEL
        .get_or_load(&model_path(app)?)
        .map_err(|e| format!("parakeet {e}"))
}

#[cfg(target_os = "macos")]
fn set_last_error(error: Option<String>) {
    if let Ok(mut last) = LAST_ERROR.lock() {
        *last = error;
    }
}

fn last_error() -> Option<String> {
    LAST_ERROR.lock().ok().and_then(|last| last.clone())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParakeetStatus {
    /// `missing`, `downloading`, `downloaded` (on disk, not loaded),
    /// `loading`, `ready` or `unsupported`.
    pub state: &'static str,
    pub downloaded_mb: u64,
    pub total_mb: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn status_state(ready: bool, downloading: bool, preparing: bool, on_disk: bool) -> &'static str {
    if ready {
        "ready"
    } else if downloading {
        "downloading"
    } else if on_disk && preparing {
        "loading"
    } else if on_disk {
        "downloaded"
    } else {
        "missing"
    }
}

#[tauri::command]
pub async fn parakeet_model_status(app: AppHandle) -> Result<ParakeetStatus, String> {
    if !cfg!(target_os = "macos") {
        return Ok(ParakeetStatus {
            state: "unsupported",
            downloaded_mb: 0,
            total_mb: PARAKEET_MODEL.size_mb,
            error: None,
        });
    }
    let downloading = DOWNLOADING.load(Ordering::SeqCst);
    let on_disk = is_complete_on_disk(&model_path(&app)?);
    let state = status_state(
        is_ready(),
        downloading,
        PREPARING.load(Ordering::SeqCst),
        on_disk,
    );
    Ok(ParakeetStatus {
        state,
        downloaded_mb: match state {
            "downloading" => downloaded_mb(
                DOWNLOADED_BYTES.load(Ordering::Relaxed),
                PARAKEET_MODEL.size_bytes,
                PARAKEET_MODEL.size_mb,
            ),
            _ if on_disk => PARAKEET_MODEL.size_mb,
            _ => 0,
        },
        total_mb: PARAKEET_MODEL.size_mb,
        error: if state == "ready" { None } else { last_error() },
    })
}

/// Downloads Parakeet if needed, loads it and warms it up, in the background.
/// Progress arrives as `parakeet:model-progress`, the end as
/// `parakeet:model-ready` or `parakeet:model-error`.
#[tauri::command]
pub async fn parakeet_model_prepare(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        start_prepare(app)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Parakeet dictation is only supported on macOS.".into())
    }
}

#[cfg(target_os = "macos")]
fn start_prepare(app: AppHandle) -> Result<(), String> {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);
    if PREPARING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    if is_ready() && crate::transcribe_engine::LOCAL_MODEL.holds(&model_path(&app)?) {
        PREPARING.store(false, Ordering::SeqCst);
        let _ = app.emit("parakeet:model-ready", ());
        return Ok(());
    }
    set_last_error(None);
    tauri::async_runtime::spawn(async move {
        let result = prepare(&app).await;
        PREPARING.store(false, Ordering::SeqCst);
        match result {
            Ok(()) => {
                let _ = app.emit("parakeet:model-ready", ());
            }
            Err(error) if error == DOWNLOAD_CANCELLED => {
                let _ = app.emit("parakeet:model-cancelled", ());
            }
            Err(error) => {
                eprintln!("[parakeet] prepare failed: {error}");
                set_last_error(Some(error.clone()));
                let _ = app.emit(
                    "parakeet:model-error",
                    serde_json::json!({ "error": error }),
                );
            }
        }
    });
    Ok(())
}

/// Stops a download in progress and unloads Parakeet, for when the user picks
/// another engine. The file stays on disk.
#[tauri::command]
pub async fn parakeet_model_release(app: AppHandle) -> Result<(), String> {
    CANCEL_DOWNLOAD.store(true, Ordering::SeqCst);
    READY.store(false, Ordering::SeqCst);
    // The slot stays locked while a model loads, which can take a second.
    #[cfg(target_os = "macos")]
    {
        let path = model_path(&app)?;
        let unloaded = tauri::async_runtime::spawn_blocking(move || {
            crate::transcribe_engine::LOCAL_MODEL.release(&path)
        })
        .await
        .map_err(|e| format!("parakeet release task failed: {e}"))??;
        if unloaded {
            eprintln!("[parakeet] unloaded");
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

#[cfg(target_os = "macos")]
async fn prepare(app: &AppHandle) -> Result<(), String> {
    let path = ensure_downloaded(app).await?;
    let started = std::time::Instant::now();
    let loaded = tauri::async_runtime::spawn_blocking(move || {
        let (model, _) = crate::transcribe_engine::LOCAL_MODEL
            .get_or_load(&path)
            .map_err(|e| format!("parakeet {e}"))?;
        crate::transcribe_engine::warm_up_parakeet(&model)
    })
    .await
    .map_err(|e| format!("parakeet load task failed: {e}"))?;
    loaded?;
    if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
        crate::transcribe_engine::LOCAL_MODEL.release(&model_path(app)?)?;
        return Err(DOWNLOAD_CANCELLED.to_owned());
    }
    READY.store(true, Ordering::SeqCst);
    eprintln!(
        "[parakeet] loaded and warmed up in {} ms",
        started.elapsed().as_millis()
    );
    Ok(())
}

#[cfg(target_os = "macos")]
async fn ensure_downloaded(app: &AppHandle) -> Result<PathBuf, String> {
    let path = model_path(app)?;
    if is_complete_on_disk(&path) {
        return Ok(path);
    }
    if DOWNLOADING.swap(true, Ordering::SeqCst) {
        return Err("a Parakeet download is already running".into());
    }
    DOWNLOADED_BYTES.store(0, Ordering::Relaxed);
    let result = download_verified(
        app,
        &path,
        &VerifiedDownload {
            url: PARAKEET_MODEL.url,
            sha256: PARAKEET_MODEL.sha256,
            size_bytes: PARAKEET_MODEL.size_bytes,
            size_mb: PARAKEET_MODEL.size_mb,
            progress_event: "parakeet:model-progress",
            downloaded_bytes: &DOWNLOADED_BYTES,
            cancel: Some(&CANCEL_DOWNLOAD),
            log_tag: "parakeet",
        },
    )
    .await;
    DOWNLOADING.store(false, Ordering::SeqCst);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pinned_file_is_a_gguf_at_a_fixed_revision() {
        assert_eq!(PARAKEET_MODEL.sha256.len(), 64);
        assert!(PARAKEET_MODEL.filename.ends_with(".gguf"));
        assert!(PARAKEET_MODEL.url.ends_with(PARAKEET_MODEL.filename));
        assert!(PARAKEET_MODEL
            .url
            .contains("/resolve/843b1b175ace04f5a89d379c79e2518c0d065b25/"));
        assert_eq!(
            PARAKEET_MODEL.size_mb,
            PARAKEET_MODEL.size_bytes / 1_000_000
        );
    }

    #[test]
    fn status_tells_a_loaded_model_from_a_file_on_disk() {
        assert_eq!(status_state(true, false, false, true), "ready");
        assert_eq!(status_state(false, true, true, false), "downloading");
        assert_eq!(status_state(false, false, true, true), "loading");
        assert_eq!(status_state(false, false, true, false), "missing");
        assert_eq!(status_state(false, false, false, true), "downloaded");
        assert_eq!(status_state(false, false, false, false), "missing");
    }
}
