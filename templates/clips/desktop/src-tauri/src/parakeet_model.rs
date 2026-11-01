//! Parakeet, the on-device English dictation model: its pinned download, and
//! the load and warm-up that make it ready to transcribe while a key is held.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::AppHandle;
#[cfg(target_os = "macos")]
use tauri::Emitter;

#[cfg(target_os = "macos")]
use crate::model_download::{download_verified, VerifiedDownload, DOWNLOAD_CANCELLED};
use crate::model_download::{downloaded_mb, PinnedFile};

pub(crate) const PARAKEET_MODEL: PinnedFile = PinnedFile {
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
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);

/// What a dictation start gets back when Parakeet can't take it right now.
/// The frontend matches this exact string and dictates with Apple Speech.
pub(crate) const NOT_READY: &str = "parakeet-model-not-ready";

pub(crate) fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::whisper_model::models_dir(app)?.join(PARAKEET_MODEL.filename))
}

/// Whether the whole file is on disk. A missing file is `Ok(false)`; a file
/// whose metadata can't be read is an error, not a missing file.
fn is_complete_on_disk(path: &Path) -> Result<bool, String> {
    match std::fs::metadata(path) {
        Ok(metadata) => Ok(metadata.len() == PARAKEET_MODEL.size_bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "could not read the Parakeet model file at {}: {error}",
            path.display()
        )),
    }
}

/// Parakeet is ready once the shared slot holds it warmed up. Anything that
/// takes the slot from it (Whisper for Screen Memory or a meeting, or a
/// retired copy a stuck live pass still holds) makes it not ready again, so
/// Settings and dictation never trust a model that is gone.
pub(crate) fn is_ready(app: &AppHandle) -> bool {
    model_path(app).is_ok_and(|path| crate::transcribe_engine::LOCAL_MODEL.holds_warm(&path))
}

/// The Parakeet model for a meeting's one-shot runs, loading it into the
/// shared slot if something else is resident.
#[cfg(target_os = "macos")]
pub(crate) fn resident_model(app: &AppHandle) -> Result<transcribe_cpp::Model, String> {
    crate::transcribe_engine::LOCAL_MODEL
        .get_or_load(&model_path(app)?)
        .map(|(model, _)| model)
        .map_err(|e| format!("parakeet {e}"))
}

/// The warmed-up Parakeet model for one dictation's live stream, without
/// waiting or loading, so capture can start the moment this returns.
///
/// When it isn't there, the dictation gets [`NOT_READY`] before any audio is
/// recorded and runs on Apple Speech, and Parakeet reloads in the background
/// for the next one. Loading here instead would either hold up capture (the
/// first words are lost) or start capture on a load that might fail, with
/// nothing that could still transcribe the audio already spoken.
#[cfg(target_os = "macos")]
pub(crate) fn dictation_lease(
    app: &AppHandle,
) -> Result<crate::transcribe_engine::StreamLease, &'static str> {
    let path = model_path(app).map_err(|error| {
        eprintln!("[parakeet] {error}");
        NOT_READY
    })?;
    crate::transcribe_engine::LOCAL_MODEL
        .try_lease_warm(&path)
        .map_err(|refused| {
            eprintln!(
                "[parakeet] model {} at dictation start; dictating with Apple Speech and reloading",
                refused.as_str()
            );
            // The Settings hook downloads a missing file; starting a 731 MB
            // download from a key press is not this path's call. An
            // unreadable file goes through prepare so Settings shows why.
            if !matches!(is_complete_on_disk(&path), Ok(false)) {
                if let Err(error) = start_prepare(app.clone(), true) {
                    eprintln!("[parakeet] reload failed to start: {error}");
                }
            }
            NOT_READY
        })
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
    let on_disk = is_complete_on_disk(&model_path(&app)?)?;
    let state = status_state(
        is_ready(&app),
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
        start_prepare(app, false)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Parakeet dictation is only supported on macOS.".into())
    }
}

/// `reclaim` is for a dictation that found the resident copy held by an
/// earlier live pass: prepare then waits for that pass to hand it back, or
/// retires it and loads a fresh copy, even though the slot still counts as
/// ready.
#[cfg(target_os = "macos")]
fn start_prepare(app: AppHandle, reclaim: bool) -> Result<(), String> {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);
    if PREPARING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    if !reclaim && is_ready(&app) {
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
    // Release waits for a load in progress, which can take a second.
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
    let load_path = path.clone();
    let loaded = tauri::async_runtime::spawn_blocking(move || load_and_warm_up(&load_path))
        .await
        .map_err(|e| format!("parakeet load task failed: {e}"))?;
    if let Err(error) = loaded {
        // A copy that loaded but failed its warm-up must not stay resident.
        crate::transcribe_engine::LOCAL_MODEL.release(&path)?;
        return Err(discard_if_damaged(path, error).await);
    }
    if CANCEL_DOWNLOAD.load(Ordering::SeqCst) {
        crate::transcribe_engine::LOCAL_MODEL.release(&path)?;
        return Err(DOWNLOAD_CANCELLED.to_owned());
    }
    eprintln!("[parakeet] ready in {} ms", started.elapsed().as_millis());
    Ok(())
}

/// Loads Parakeet into the shared slot if it isn't there and warms up a copy
/// that hasn't been, holding the copy as a live stream would so no dictation
/// starts on it halfway through.
#[cfg(target_os = "macos")]
fn load_and_warm_up(path: &Path) -> Result<(), String> {
    let lease = crate::transcribe_engine::LOCAL_MODEL
        .lease_for_stream(path)
        .map_err(|e| format!("parakeet {e}"))?;
    if !lease.is_warm() {
        crate::transcribe_engine::warm_up_parakeet(lease.model())?;
        lease.mark_warm();
    }
    Ok(())
}

/// A file of the right size that won't load or warm up may be damaged, and
/// only a fresh download fixes that, so a file that fails its checksum is
/// deleted and Retry downloads it again. One that passes is kept: the fault
/// is elsewhere, and deleting it would cost a 731 MB download for nothing.
#[cfg(target_os = "macos")]
async fn discard_if_damaged(path: PathBuf, error: String) -> String {
    let checked = tauri::async_runtime::spawn_blocking(move || {
        remove_if_damaged(&path, PARAKEET_MODEL.sha256)
    })
    .await
    .map_err(|e| format!("checksum task failed: {e}"))
    .and_then(|checked| checked);
    match checked {
        Ok(true) => error,
        Ok(false) => {
            eprintln!("[parakeet] the model file failed its checksum and was deleted");
            format!("{error}; the model file was damaged and has been deleted, so Retry downloads it again")
        }
        Err(check_error) => format!("{error}; checking the model file failed: {check_error}"),
    }
}

/// Whether the file at `path` matches `sha256`; one that doesn't is deleted.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn remove_if_damaged(path: &Path, sha256: &str) -> Result<bool, String> {
    let intact = crate::model_download::file_sha256(path)? == sha256;
    if !intact {
        std::fs::remove_file(path)
            .map_err(|e| format!("could not delete the damaged file: {e}"))?;
    }
    Ok(intact)
}

#[cfg(target_os = "macos")]
async fn ensure_downloaded(app: &AppHandle) -> Result<PathBuf, String> {
    let path = model_path(app)?;
    if is_complete_on_disk(&path)? {
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

    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "clips-parakeet-model-{name}-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_missing_file_is_not_an_unreadable_one() {
        let dir = scratch_dir("on-disk");
        assert_eq!(is_complete_on_disk(&dir.join("absent.gguf")), Ok(false));

        let short = dir.join("short.gguf");
        std::fs::write(&short, b"GGUF").unwrap();
        assert_eq!(is_complete_on_disk(&short), Ok(false));

        // A path through a file can't be read, which is not the same as the
        // model being absent.
        let error = is_complete_on_disk(&short.join("model.gguf")).unwrap_err();
        assert!(error.contains("could not read"), "{error}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_file_that_fails_its_checksum_is_deleted_and_a_good_one_kept() {
        let dir = scratch_dir("checksum");
        let file = dir.join("model.gguf");
        // SHA-256 of "abc".
        let abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

        std::fs::write(&file, b"abc").unwrap();
        assert_eq!(remove_if_damaged(&file, abc), Ok(true));
        assert!(file.exists());

        std::fs::write(&file, b"abd").unwrap();
        assert_eq!(remove_if_damaged(&file, abc), Ok(false));
        assert!(!file.exists());

        assert!(remove_if_damaged(&file, abc).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
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
