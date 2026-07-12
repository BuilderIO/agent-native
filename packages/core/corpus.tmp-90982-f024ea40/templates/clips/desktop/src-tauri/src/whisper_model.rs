//! Whisper model resolution + download for the local meeting transcription
//! engine (`whisper_speech.rs`).
//!
//! Resolves where the `ggml-base.bin` model lives, downloads it from
//! HuggingFace on first use, and verifies the download against a pinned
//! SHA-256 + byte size so a corrupted, truncated, or tampered file is rejected
//! rather than loaded

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
const MODEL_FILENAME: &str = "ggml-base.bin";
const MODEL_SHA256: &str = "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe";
const MODEL_SIZE: u64 = 147_951_465;
const MODEL_SIZE_MB: u64 = MODEL_SIZE / (1024 * 1024);

// Global download-in-flight state so the status command and concurrent callers
// can inspect without re-checking the filesystem.
static DOWNLOADING: AtomicBool = AtomicBool::new(false);
static DOWNLOADED_BYTES: AtomicU64 = AtomicU64::new(0);

/// Whether the model path is overridden via `CLIPS_WHISPER_MODEL`. A custom
/// model is exempt from checksum verification (it may legitimately be a
/// different model, e.g. multilingual).
pub(crate) fn custom_model_override() -> bool {
    std::env::var("CLIPS_WHISPER_MODEL")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

/// Resolve the model path. Honors `CLIPS_WHISPER_MODEL`, otherwise
/// `<app_data_dir>/models/ggml-base.bin` (creating the dir).
pub fn model_file(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("CLIPS_WHISPER_MODEL") {
        if !path.trim().is_empty() {
            return Ok(PathBuf::from(path));
        }
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app_data_dir: {e}"))?
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir models: {e}"))?;
    Ok(dir.join(MODEL_FILENAME))
}

/// Model status returned to the frontend settings UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    /// One of: "disabled" | "missing" | "downloading" | "ready"
    pub state: String,
    /// Absolute path where the model file lives (or will live).
    pub path: String,
    /// How many MB have been downloaded so far (only meaningful during "downloading").
    pub downloaded_mb: u64,
    /// Total model size in MB.
    pub total_mb: u64,
}

/// Return the current model state without triggering a download.
#[tauri::command]
pub async fn whisper_model_status(app: AppHandle) -> Result<ModelStatus, String> {
    let path = model_file(&app)?;
    let path_str = path.to_string_lossy().to_string();
    let config = crate::config::feature_config(&app);

    if !config.whisper_model_enabled {
        return Ok(ModelStatus {
            state: "disabled".into(),
            path: path_str,
            downloaded_mb: 0,
            total_mb: MODEL_SIZE_MB,
        });
    }
    if DOWNLOADING.load(Ordering::Relaxed) {
        let downloaded_mb = DOWNLOADED_BYTES.load(Ordering::Relaxed) / (1024 * 1024);
        return Ok(ModelStatus {
            state: "downloading".into(),
            path: path_str,
            downloaded_mb,
            total_mb: MODEL_SIZE_MB,
        });
    }
    let state = match std::fs::metadata(&path) {
        Ok(m) if m.len() == MODEL_SIZE || custom_model_override() => "ready",
        _ => "missing",
    };
    Ok(ModelStatus {
        state: state.into(),
        path: path_str,
        downloaded_mb: if state == "ready" { MODEL_SIZE_MB } else { 0 },
        total_mb: MODEL_SIZE_MB,
    })
}

/// Spawn a background download. Idempotent — no-ops if already downloading or
/// already present. Emits `whisper:model-progress`, `whisper:model-ready`, or
/// `whisper:model-error` as the download progresses.
#[tauri::command]
pub async fn whisper_model_download(app: AppHandle) -> Result<(), String> {
    if DOWNLOADING.load(Ordering::Acquire) {
        return Ok(());
    }
    // Quick check: if model is already present, just emit ready and return.
    if let Ok(path) = model_file(&app) {
        if let Ok(m) = std::fs::metadata(&path) {
            if m.len() == MODEL_SIZE || custom_model_override() {
                let _ = app.emit("whisper:model-ready", ());
                return Ok(());
            }
        }
    }
    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        match ensure_model(&app_clone).await {
            Ok(_) => {
                let _ = app_clone.emit("whisper:model-ready", ());
            }
            Err(e) => {
                let _ = app_clone.emit("whisper:model-error", serde_json::json!({ "error": e }));
            }
        }
    });
    Ok(())
}

/// Ensure the model file exists, downloading it on first use. ~142 MB, so the
/// first meeting after install pays a one-time download cost.
///
/// The default `ggml-base.bin` download is verified against `MODEL_SHA256` /
/// `MODEL_SIZE`. A custom model supplied via `CLIPS_WHISPER_MODEL` is exempt
/// (it may legitimately be a different model) — we only require it to exist.
///
/// Emits `whisper:model-progress { downloadedMb, totalMb }` every ~16 MB.
pub async fn ensure_model(app: &AppHandle) -> Result<PathBuf, String> {
    let path = model_file(app)?;
    let custom = custom_model_override();

    if custom && !path.exists() {
        return Err(format!(
            "CLIPS_WHISPER_MODEL is set to '{}' but the file does not exist.",
            path.display()
        ));
    }

    if path.exists() {
        if custom {
            eprintln!("[whisper] using custom model at {}", path.display());
            return Ok(path);
        }
        match std::fs::metadata(&path) {
            Ok(m) if m.len() == MODEL_SIZE => {
                eprintln!("[whisper] model found at {}", path.display());
                return Ok(path);
            }
            Ok(m) => {
                eprintln!(
                    "[whisper] cached model size {} != expected {} — re-downloading",
                    m.len(),
                    MODEL_SIZE
                );
            }
            Err(e) => return Err(format!("stat model: {e}")),
        }
    }

    // If a download is already in progress, wait for it rather than failing —
    // the caller (meeting start) should succeed once the model lands.
    if DOWNLOADING.load(Ordering::SeqCst) {
        eprintln!("[whisper] waiting for in-progress model download…");
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            if !DOWNLOADING.load(Ordering::SeqCst) {
                break;
            }
        }
        // Re-check: the download that just finished may have placed the model.
        if path.exists() {
            if custom {
                return Ok(path);
            }
            if let Ok(m) = std::fs::metadata(&path) {
                if m.len() == MODEL_SIZE {
                    return Ok(path);
                }
            }
        }
    }
    // Guard against concurrent downloads.
    if DOWNLOADING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Whisper model download already in progress — please wait.".to_string());
    }
    DOWNLOADED_BYTES.store(0, Ordering::Relaxed);

    let result = do_download(app, &path, custom).await;
    DOWNLOADING.store(false, Ordering::SeqCst);
    result
}

async fn do_download(app: &AppHandle, path: &PathBuf, custom: bool) -> Result<PathBuf, String> {
    eprintln!(
        "[whisper] model not found at {} — downloading {} (~142 MB, one time)",
        path.display(),
        MODEL_URL
    );
    let mut resp = reqwest::get(MODEL_URL).await.map_err(|e| {
        let msg = format!("model download request failed: {e}");
        eprintln!("[whisper] {msg}");
        msg
    })?;
    if !resp.status().is_success() {
        let msg = format!("model download HTTP {}", resp.status());
        eprintln!("[whisper] {msg}");
        return Err(msg);
    }

    // Stream body to a temp file, hashing as we go. Keeps memory flat
    // (no 142 MB heap spike) and lets us verify before the rename.
    use sha2::{Digest, Sha256};
    use std::io::Write as _;

    let tmp = path.with_extension("bin.tmp");
    let mut file = std::fs::File::create(&tmp).map_err(|e| format!("create model tmp: {e}"))?;
    let mut hasher = Sha256::new();
    let mut total: u64 = 0;
    let mut last_progress: u64 = 0;

    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("model download body failed: {e}"))?
    {
        if !custom {
            hasher.update(&chunk);
        }
        total += chunk.len() as u64;
        DOWNLOADED_BYTES.store(total, Ordering::Relaxed);

        if let Err(e) = file.write_all(&chunk) {
            let _ = std::fs::remove_file(&tmp);
            let msg = format!("write model tmp: {e}");
            eprintln!("[whisper] {msg}");
            return Err(msg);
        }

        // Emit progress + log every ~16 MB.
        if total - last_progress >= 16 * 1024 * 1024 {
            last_progress = total;
            let downloaded_mb = total / (1024 * 1024);
            eprintln!("[whisper] downloading model… {downloaded_mb} / {MODEL_SIZE_MB} MB");
            let _ = app.emit(
                "whisper:model-progress",
                serde_json::json!({ "downloadedMb": downloaded_mb, "totalMb": MODEL_SIZE_MB }),
            );
        }
    }
    file.flush().map_err(|e| format!("flush model tmp: {e}"))?;
    drop(file);

    if !custom {
        if total != MODEL_SIZE {
            let _ = std::fs::remove_file(&tmp);
            let msg = format!("model size mismatch: got {total} bytes, expected {MODEL_SIZE}");
            eprintln!("[whisper] {msg}");
            return Err(msg);
        }
        let digest: String = hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        if digest != MODEL_SHA256 {
            let _ = std::fs::remove_file(&tmp);
            let msg = format!("model checksum mismatch: got {digest}, expected {MODEL_SHA256}");
            eprintln!("[whisper] {msg}");
            return Err(msg);
        }
        eprintln!("[whisper] model checksum verified (sha256 {MODEL_SHA256})");
    }

    std::fs::rename(&tmp, path).map_err(|e| format!("rename model: {e}"))?;
    eprintln!("[whisper] model saved → {}", path.display());
    Ok(path.clone())
}
