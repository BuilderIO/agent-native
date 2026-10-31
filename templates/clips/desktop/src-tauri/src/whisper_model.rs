use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::model_download::{
    download_verified, downloaded_mb, partial_download_path, VerifiedDownload,
};

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
    /// The whisper.cpp file earlier versions downloaded for this model. It is
    /// removed once the replacement has loaded, never before.
    #[serde(skip)]
    pub legacy_filename: &'static str,
}

const TINY_MODEL: WhisperModel = WhisperModel {
    id: "tiny",
    title: "Tiny",
    description: "Transcribes instantly and uses very little space. May miss some words or struggle with accents, but great if speed is all that matters.",
    url: "https://huggingface.co/handy-computer/whisper-tiny-gguf/resolve/1bd61cda36bbd22c88fc5a33842498a6e1d30f45/whisper-tiny-Q8_0.gguf",
    filename: "whisper-tiny-Q8_0.gguf",
    sha256: "325b9c7997cd1eff81ef709d55766565e71be696130cc3a3d444713798706834",
    size_bytes: 45_981_088,
    size_mb: 44,
    legacy_filename: "ggml-tiny.bin",
};

const BASE_MODEL: WhisperModel = WhisperModel {
    id: "base",
    title: "Base",
    description: "A great everyday choice. Transcribes quickly and gets most things right for dictation and meetings.",
    url: "https://huggingface.co/handy-computer/whisper-base-gguf/resolve/42fcd2077de47c36d779309e0e91b76ec620f56d/whisper-base-Q8_0.gguf",
    filename: "whisper-base-Q8_0.gguf",
    sha256: "81c069428bc8a24551a8169cf31cf09bcfd9d4cf50389ae281323c9aa9648c81",
    size_bytes: 84_962_880,
    size_mb: 81,
    legacy_filename: "ggml-base.bin",
};

const SMALL_MODEL: WhisperModel = WhisperModel {
    id: "small",
    title: "Small",
    description: "More accurate than Base, especially with accents or background noise. Takes a bit longer and uses more space.",
    url: "https://huggingface.co/handy-computer/whisper-small-gguf/resolve/4afdc7942ecf1997f359deae48a63506b062eac4/whisper-small-Q8_0.gguf",
    filename: "whisper-small-Q8_0.gguf",
    sha256: "9b9c8811bbcc82a7766f0fb0925614bdacb0923b2cc630daeac17108b655b860",
    size_bytes: 269_751_136,
    size_mb: 257,
    legacy_filename: "ggml-small.bin",
};

const LARGE_V3_TURBO_MODEL: WhisperModel = WhisperModel {
    id: "large-v3-turbo",
    title: "Large v3 Turbo",
    description: "The most accurate option. Catches subtle speech and complex vocabulary well. Best on newer Macs; requires a larger one-time download.",
    url: "https://huggingface.co/handy-computer/whisper-large-v3-turbo-gguf/resolve/18ada752005f5fddef499256f9a458d0b37a203a/whisper-large-v3-turbo-Q8_0.gguf",
    filename: "whisper-large-v3-turbo-Q8_0.gguf",
    sha256: "257aa7ec9121c22c167d5e2c49e3e76b4ba0e6e27ebc13074eba0a80f8190220",
    size_bytes: 886_381_728,
    size_mb: 845,
    legacy_filename: "ggml-large-v3-turbo.bin",
};

const SUPPORTED_MODELS: &[WhisperModel] =
    &[TINY_MODEL, BASE_MODEL, SMALL_MODEL, LARGE_V3_TURBO_MODEL];

static DOWNLOADING: AtomicBool = AtomicBool::new(false);
static DOWNLOADED_BYTES: AtomicU64 = AtomicU64::new(0);

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

pub(crate) fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app_data_dir: {e}"))?
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir models: {e}"))?;
    Ok(dir)
}

fn model_path(dir: &Path, model: &WhisperModel) -> PathBuf {
    dir.join(model.filename)
}

fn is_complete_on_disk(path: &Path, model: &WhisperModel) -> bool {
    std::fs::metadata(path)
        .map(|m| m.len() == model.size_bytes)
        .unwrap_or(false)
}

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

/// Deletes the whisper.cpp download that `loaded_path` replaces. Call it only
/// after `loaded_path` has loaded, so a failed download or an unreadable
/// replacement never leaves the user without a model they already had.
#[cfg(target_os = "macos")]
pub(crate) fn remove_superseded_legacy_model(app: &AppHandle, loaded_path: &Path) {
    if custom_model_override() {
        return;
    }
    let dir = match models_dir(app) {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("[whisper] cannot check for an old model file: {e}");
            return;
        }
    };
    let Some(model) = SUPPORTED_MODELS
        .iter()
        .find(|m| model_path(&dir, m) == loaded_path)
    else {
        return;
    };
    remove_legacy_files(&dir, model);
}

fn remove_legacy_files(dir: &Path, model: &WhisperModel) {
    let legacy = dir.join(model.legacy_filename);
    for path in [partial_download_path(&legacy), legacy] {
        match std::fs::remove_file(&path) {
            Ok(()) => eprintln!("[whisper] removed superseded {}", path.display()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => eprintln!("[whisper] could not remove {}: {e}", path.display()),
        }
    }
}

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
            downloaded_mb: downloaded_mb(
                DOWNLOADED_BYTES.load(Ordering::Relaxed),
                model.size_bytes,
                model.size_mb,
            ),
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
    let dir = models_dir(&app)?;
    let path = model_path(&dir, model);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("delete model: {e}"))?;
    }
    remove_legacy_files(&dir, model);
    let _ = app.emit(
        "whisper:model-deleted",
        serde_json::json!({ "modelId": model_id }),
    );
    Ok(())
}

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

    loop {
        if DOWNLOADING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            break;
        }

        eprintln!("[whisper] waiting for in-progress download…");
        while DOWNLOADING.load(Ordering::SeqCst) {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
        if is_complete_on_disk(&path, model) {
            return Ok(path);
        }
    }
    DOWNLOADED_BYTES.store(0, Ordering::Relaxed);

    let result = do_download(app, &path, model).await;
    DOWNLOADING.store(false, Ordering::SeqCst);
    result
}

async fn do_download(
    app: &AppHandle,
    path: &Path,
    model: &WhisperModel,
) -> Result<PathBuf, String> {
    download_verified(
        app,
        path,
        &VerifiedDownload {
            url: model.url,
            sha256: model.sha256,
            size_bytes: model.size_bytes,
            size_mb: model.size_mb,
            progress_event: "whisper:model-progress",
            downloaded_bytes: &DOWNLOADED_BYTES,
            cancel: None,
            log_tag: "whisper",
        },
    )
    .await
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
            assert!(model.filename.ends_with(".gguf"), "{}", model.id);
            assert!(model.url.ends_with(model.filename), "{}", model.id);
            assert!(model.legacy_filename.ends_with(".bin"), "{}", model.id);
            for other in SUPPORTED_MODELS.iter().skip(i + 1) {
                assert_ne!(model.id, other.id);
                assert_ne!(model.filename, other.filename);
                assert_ne!(model.legacy_filename, other.legacy_filename);
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

    #[test]
    fn removing_legacy_files_leaves_the_replacement_and_other_models() {
        let dir = std::env::temp_dir().join(format!("clips-whisper-model-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let keep = [
            model_path(&dir, &BASE_MODEL),
            dir.join(SMALL_MODEL.legacy_filename),
        ];
        let remove = [
            dir.join(BASE_MODEL.legacy_filename),
            partial_download_path(&dir.join(BASE_MODEL.legacy_filename)),
        ];
        for path in keep.iter().chain(&remove) {
            std::fs::write(path, b"model").unwrap();
        }

        remove_legacy_files(&dir, &BASE_MODEL);
        remove_legacy_files(&dir, &BASE_MODEL);

        for path in &keep {
            assert!(path.exists(), "{} was removed", path.display());
        }
        for path in &remove {
            assert!(!path.exists(), "{} was kept", path.display());
        }
        for path in &keep {
            std::fs::remove_file(path).unwrap();
        }
        std::fs::remove_dir(&dir).unwrap();
    }
}
