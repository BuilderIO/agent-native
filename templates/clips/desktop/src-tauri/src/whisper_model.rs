//! Local Whisper model catalog, download, and integrity verification.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhisperModel {
    pub id: &'static str,
    pub title: &'static str,
    pub description: &'static str,
    pub url: &'static str,
    pub filename: &'static str,
    pub sha256: &'static str,
    pub size_bytes: u64,
    pub size_mb: u64,
}

const TINY_MODEL: WhisperModel = WhisperModel {
    id: "tiny",
    title: "Tiny",
    description: "Transcribes instantly and uses very little space. May miss some words or struggle with accents, but great if speed is all that matters.",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
    filename: "ggml-tiny.bin",
    sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21",
    size_bytes: 77_691_713,
    size_mb: 74,
};

const BASE_MODEL: WhisperModel = WhisperModel {
    id: "base",
    title: "Base",
    description: "A great everyday choice. Transcribes quickly and gets most things right for dictation and meetings.",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
    filename: "ggml-base.bin",
    sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
    size_bytes: 147_951_465,
    size_mb: 141,
};

const SMALL_MODEL: WhisperModel = WhisperModel {
    id: "small",
    title: "Small",
    description: "More accurate than Base, especially with accents or background noise. Takes a bit longer and uses more space.",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    filename: "ggml-small.bin",
    sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
    size_bytes: 487_601_967,
    size_mb: 488,
};

const LARGE_V3_TURBO_MODEL: WhisperModel = WhisperModel {
    id: "large-v3-turbo",
    title: "Large v3 Turbo",
    description: "The most accurate option. Catches subtle speech and complex vocabulary well. Best on newer Macs; requires a larger one-time download.",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
    filename: "ggml-large-v3-turbo.bin",
    sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
    size_bytes: 1_624_555_275,
    size_mb: 1549,
};

const SUPPORTED_MODELS: &[WhisperModel] =
    &[TINY_MODEL, BASE_MODEL, SMALL_MODEL, LARGE_V3_TURBO_MODEL];

static DOWNLOADING: AtomicBool = AtomicBool::new(false);
static DOWNLOADED_BYTES: AtomicU64 = AtomicU64::new(0);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

pub(crate) fn custom_model_override() -> bool {
    std::env::var("CLIPS_WHISPER_MODEL")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

pub(crate) fn is_supported_model_id(id: &str) -> bool {
    SUPPORTED_MODELS.iter().any(|m| m.id == id)
}

fn find_model(id: &str) -> Result<&'static WhisperModel, String> {
    SUPPORTED_MODELS
        .iter()
        .find(|m| m.id == id)
        .ok_or_else(|| format!("unsupported Whisper model: {id}"))
}

/// Returns the directory where model files are stored, creating it if needed.
fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app_data_dir: {e}"))?
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir models: {e}"))?;
    Ok(dir)
}

/// Resolve the full path for a catalog model on disk.
fn model_path(dir: &Path, model: &WhisperModel) -> PathBuf {
    dir.join(model.filename)
}

fn is_complete_on_disk(path: &Path, model: &WhisperModel) -> bool {
    std::fs::metadata(path)
        .map(|m| m.len() == model.size_bytes)
        .unwrap_or(false)
}

fn downloaded_mb(bytes: u64, model: &WhisperModel) -> u64 {
    bytes.saturating_mul(model.size_mb) / model.size_bytes
}

// ---------------------------------------------------------------------------
// Public: resolve model file path (honors CLIPS_WHISPER_MODEL env override)
// ---------------------------------------------------------------------------

pub fn model_file(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("CLIPS_WHISPER_MODEL") {
        if !path.trim().is_empty() {
            return Ok(PathBuf::from(path));
        }
    }
    let config = crate::config::feature_config(app);
    let model = find_model(&config.whisper_model_id)?;
    Ok(model_path(&models_dir(app)?, model))
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn whisper_models() -> Vec<WhisperModel> {
    SUPPORTED_MODELS.to_vec()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub state: String,
    pub path: String,
    pub downloaded_mb: u64,
    pub total_mb: u64,
}

#[tauri::command]
pub async fn whisper_model_status(app: AppHandle) -> Result<ModelStatus, String> {
    if custom_model_override() {
        let path = model_file(&app)?;
        let ready = path.exists();
        return Ok(ModelStatus {
            state: if ready { "ready" } else { "missing" }.into(),
            path: path.to_string_lossy().into(),
            downloaded_mb: 0,
            total_mb: 0,
        });
    }

    let config = crate::config::feature_config(&app);
    let model = find_model(&config.whisper_model_id)?;
    let dir = models_dir(&app)?;
    let path = model_path(&dir, model);
    let path_str = path.to_string_lossy().into_owned();

    if !config.whisper_model_enabled {
        return Ok(ModelStatus {
            state: "disabled".into(),
            path: path_str,
            downloaded_mb: 0,
            total_mb: model.size_mb,
        });
    }
    if DOWNLOADING.load(Ordering::Relaxed) {
        return Ok(ModelStatus {
            state: "downloading".into(),
            path: path_str,
            downloaded_mb: downloaded_mb(DOWNLOADED_BYTES.load(Ordering::Relaxed), model),
            total_mb: model.size_mb,
        });
    }
    let ready = is_complete_on_disk(&path, model);
    Ok(ModelStatus {
        state: if ready { "ready" } else { "missing" }.into(),
        path: path_str,
        downloaded_mb: if ready { model.size_mb } else { 0 },
        total_mb: model.size_mb,
    })
}

#[tauri::command]
pub async fn whisper_model_download(app: AppHandle) -> Result<(), String> {
    if DOWNLOADING.load(Ordering::Acquire) {
        return Ok(());
    }
    let path = model_file(&app)?;
    if let Ok(meta) = std::fs::metadata(&path) {
        let config = crate::config::feature_config(&app);
        if let Ok(model) = find_model(&config.whisper_model_id) {
            if meta.len() == model.size_bytes || custom_model_override() {
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

#[tauri::command]
pub async fn whisper_downloaded_models(app: AppHandle) -> Vec<String> {
    let Ok(dir) = models_dir(&app) else {
        return vec![];
    };
    SUPPORTED_MODELS
        .iter()
        .filter(|m| is_complete_on_disk(&model_path(&dir, m), m))
        .map(|m| m.id.to_string())
        .collect()
}

#[tauri::command]
pub async fn whisper_model_delete(app: AppHandle, model_id: String) -> Result<(), String> {
    if custom_model_override() {
        return Err("Cannot manage models while CLIPS_WHISPER_MODEL is set.".to_string());
    }
    if crate::config::feature_config(&app).whisper_model_id == model_id {
        return Err("Cannot delete the model that is currently selected.".to_string());
    }
    let model = find_model(&model_id)?;
    let path = model_path(&models_dir(&app)?, model);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("delete model: {e}"))?;
    }
    let _ = app.emit("whisper:model-deleted", serde_json::json!({ "modelId": model_id }));
    Ok(())
}

// ---------------------------------------------------------------------------
// Download logic (called by whisper_model_download and lib.rs startup prewarm)
// ---------------------------------------------------------------------------

pub(crate) async fn ensure_model(app: &AppHandle) -> Result<PathBuf, String> {
    let path = model_file(app)?;
    let custom = custom_model_override();

    if custom {
        if path.exists() {
            eprintln!("[whisper] using custom model at {}", path.display());
            return Ok(path);
        }
        return Err(format!(
            "CLIPS_WHISPER_MODEL points to '{}' but the file does not exist.",
            path.display()
        ));
    }

    let config = crate::config::feature_config(app);
    let model = find_model(&config.whisper_model_id)?;

    if is_complete_on_disk(&path, model) {
        eprintln!("[whisper] model found at {}", path.display());
        return Ok(path);
    }
    if path.exists() {
        eprintln!(
            "[whisper] cached model has wrong size — re-downloading {}",
            path.display()
        );
    }

    if DOWNLOADING.load(Ordering::SeqCst) {
        eprintln!("[whisper] waiting for in-progress download…");
        while DOWNLOADING.load(Ordering::SeqCst) {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        if is_complete_on_disk(&path, model) {
            return Ok(path);
        }
    }

    if DOWNLOADING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("Download already in progress — please wait.".to_string());
    }
    DOWNLOADED_BYTES.store(0, Ordering::Relaxed);

    let result = do_download(app, &path, model).await;
    DOWNLOADING.store(false, Ordering::SeqCst);
    result
}

async fn do_download(app: &AppHandle, path: &Path, model: &WhisperModel) -> Result<PathBuf, String> {
    eprintln!(
        "[whisper] downloading {} (~{} MB)",
        model.url, model.size_mb
    );
    let mut response = reqwest::get(model.url).await.map_err(|e| {
        format!("model download failed: {e}")
    })?;
    if !response.status().is_success() {
        return Err(format!("model download HTTP {}", response.status()));
    }

    use sha2::{Digest, Sha256};
    use std::io::Write as _;

    let tmp = path.with_extension("bin.tmp");
    let mut file =
        std::fs::File::create(&tmp).map_err(|e| format!("create tmp: {e}"))?;
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    let mut last_progress = 0_u64;

    while let Some(chunk) = response.chunk().await.map_err(|e| format!("download body: {e}"))? {
        hasher.update(&chunk);
        total += chunk.len() as u64;
        DOWNLOADED_BYTES.store(total, Ordering::Relaxed);

        if let Err(e) = file.write_all(&chunk) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("write tmp: {e}"));
        }

        if total - last_progress >= 16 * 1024 * 1024 {
            last_progress = total;
            let mb = downloaded_mb(total, model);
            eprintln!("[whisper] {mb} / {} MB", model.size_mb);
            let _ = app.emit(
                "whisper:model-progress",
                serde_json::json!({ "downloadedMb": mb, "totalMb": model.size_mb }),
            );
        }
    }
    file.flush().map_err(|e| format!("flush tmp: {e}"))?;
    drop(file);

    if total != model.size_bytes {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!(
            "size mismatch: got {total} bytes, expected {}",
            model.size_bytes
        ));
    }
    let digest: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
    if digest != model.sha256 {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!(
            "checksum mismatch: got {digest}, expected {}",
            model.sha256
        ));
    }

    std::fs::rename(&tmp, path).map_err(|e| format!("rename model: {e}"))?;
    eprintln!("[whisper] saved → {}", path.display());
    Ok(path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supported_models_have_unique_ids_and_filenames() {
        for (i, model) in SUPPORTED_MODELS.iter().enumerate() {
            assert!(model.size_bytes > 0);
            assert_eq!(model.sha256.len(), 64, "bad sha256 for {}", model.id);
            assert!(!model.title.is_empty());
            assert!(!model.description.is_empty());
            for other in SUPPORTED_MODELS.iter().skip(i + 1) {
                assert_ne!(model.id, other.id);
                assert_ne!(model.filename, other.filename);
            }
        }
    }

    #[test]
    fn base_model_is_default() {
        assert!(is_supported_model_id("base"));
    }

    #[test]
    fn unknown_model_id_is_rejected() {
        assert!(find_model("does-not-exist").is_err());
    }
}
