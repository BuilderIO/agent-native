//! Whisper model resolution + download for the local transcription engine
//! (`whisper_speech.rs`): meetings, native-recording transcripts, and
//! whisper-mode dictation all share one loaded model.
//!
//! Supports a small set of pinned models the user picks from in desktop
//! settings (`FeatureConfig::whisper_model_choice`). Each download is
//! verified against a pinned SHA-256 + byte size so a corrupted, truncated,
//! or tampered file is rejected rather than loaded.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// A pinned, downloadable whisper.cpp model.
pub struct WhisperModelSpec {
    pub id: &'static str,
    pub filename: &'static str,
    pub url: &'static str,
    pub sha256: &'static str,
    pub size: u64,
    /// Whether to load the model into RAM at tray startup. Small models stay
    /// warm so dictation and meeting starts are instant; large models load on
    /// first use instead, trading a few seconds of first-use latency for not
    /// holding gigabytes of RAM permanently.
    pub prewarm: bool,
}

impl WhisperModelSpec {
    pub fn size_mb(&self) -> u64 {
        self.size / (1024 * 1024)
    }
}

/// Pinned metadata from https://huggingface.co/ggerganov/whisper.cpp.
pub const WHISPER_MODELS: &[WhisperModelSpec] = &[
    WhisperModelSpec {
        id: "base",
        filename: "ggml-base.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
        size: 147_951_465,
        prewarm: true,
    },
    WhisperModelSpec {
        id: "large-v3-turbo-q8_0",
        filename: "ggml-large-v3-turbo-q8_0.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin",
        sha256: "317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1",
        size: 874_188_075,
        prewarm: false,
    },
    WhisperModelSpec {
        id: "large-v3-turbo",
        filename: "ggml-large-v3-turbo.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
        sha256: "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69",
        size: 1_624_555_275,
        prewarm: false,
    },
];

pub const DEFAULT_WHISPER_MODEL_ID: &str = "base";

/// Resolve a spec by id, falling back to the default for unknown ids (e.g. a
/// config written by a newer build).
pub fn spec_by_id(id: &str) -> &'static WhisperModelSpec {
    WHISPER_MODELS
        .iter()
        .find(|m| m.id == id)
        .unwrap_or(&WHISPER_MODELS[0])
}

/// The user's chosen model per desktop settings.
pub fn current_spec(app: &AppHandle) -> &'static WhisperModelSpec {
    let choice = crate::config::feature_config(app).whisper_model_choice;
    spec_by_id(&choice)
}

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

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app_data_dir: {e}"))?
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir models: {e}"))?;
    Ok(dir)
}

/// Resolve the active model path. Honors `CLIPS_WHISPER_MODEL`, otherwise
/// `<app_data_dir>/models/<chosen model filename>` (creating the dir).
pub fn model_file(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("CLIPS_WHISPER_MODEL") {
        if !path.trim().is_empty() {
            return Ok(PathBuf::from(path));
        }
    }
    Ok(models_dir(app)?.join(current_spec(app).filename))
}

fn spec_downloaded(app: &AppHandle, spec: &WhisperModelSpec) -> bool {
    models_dir(app)
        .ok()
        .and_then(|dir| std::fs::metadata(dir.join(spec.filename)).ok())
        .map(|m| m.len() == spec.size)
        .unwrap_or(false)
}

/// Model status returned to the frontend settings UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    /// One of: "disabled" | "missing" | "downloading" | "ready"
    pub state: String,
    /// The chosen model's id ("base", "large-v3-turbo-q8_0", ...).
    pub model: String,
    /// Absolute path where the model file lives (or will live).
    pub path: String,
    /// How many MB have been downloaded so far (only meaningful during "downloading").
    pub downloaded_mb: u64,
    /// Total model size in MB.
    pub total_mb: u64,
}

/// One selectable model for the settings UI, with its on-disk state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelListEntry {
    pub id: String,
    pub size_mb: u64,
    /// Kept warm in RAM from tray startup (small models only).
    pub prewarm: bool,
    pub downloaded: bool,
    pub selected: bool,
}

/// List the selectable models with their download state.
#[tauri::command]
pub async fn whisper_model_list(app: AppHandle) -> Result<Vec<ModelListEntry>, String> {
    let selected = current_spec(&app).id;
    Ok(WHISPER_MODELS
        .iter()
        .map(|spec| ModelListEntry {
            id: spec.id.to_string(),
            size_mb: spec.size_mb(),
            prewarm: spec.prewarm,
            downloaded: spec_downloaded(&app, spec),
            selected: spec.id == selected,
        })
        .collect())
}

/// Delete a downloaded model file to free disk space. Refuses to delete the
/// currently selected model.
#[tauri::command]
pub async fn whisper_model_delete(app: AppHandle, id: String) -> Result<(), String> {
    let spec = spec_by_id(&id);
    if spec.id != id {
        return Err(format!("unknown whisper model: {id}"));
    }
    if spec.id == current_spec(&app).id {
        return Err("cannot delete the selected model — switch models first".into());
    }
    let path = models_dir(&app)?.join(spec.filename);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("delete model: {e}")),
    }
}

/// Return the current model state without triggering a download.
#[tauri::command]
pub async fn whisper_model_status(app: AppHandle) -> Result<ModelStatus, String> {
    let spec = current_spec(&app);
    let path = model_file(&app)?;
    let path_str = path.to_string_lossy().to_string();
    let config = crate::config::feature_config(&app);

    if !config.whisper_model_enabled {
        return Ok(ModelStatus {
            state: "disabled".into(),
            model: spec.id.into(),
            path: path_str,
            downloaded_mb: 0,
            total_mb: spec.size_mb(),
        });
    }
    if DOWNLOADING.load(Ordering::Relaxed) {
        let downloaded_mb = DOWNLOADED_BYTES.load(Ordering::Relaxed) / (1024 * 1024);
        return Ok(ModelStatus {
            state: "downloading".into(),
            model: spec.id.into(),
            path: path_str,
            downloaded_mb,
            total_mb: spec.size_mb(),
        });
    }
    let state = match std::fs::metadata(&path) {
        Ok(m) if m.len() == spec.size || custom_model_override() => "ready",
        _ => "missing",
    };
    Ok(ModelStatus {
        state: state.into(),
        model: spec.id.into(),
        path: path_str,
        downloaded_mb: if state == "ready" { spec.size_mb() } else { 0 },
        total_mb: spec.size_mb(),
    })
}

/// Spawn a background download of the currently selected model. Idempotent —
/// no-ops if already downloading or already present. Emits
/// `whisper:model-progress`, `whisper:model-ready`, or `whisper:model-error`
/// as the download progresses.
#[tauri::command]
pub async fn whisper_model_download(app: AppHandle) -> Result<(), String> {
    if DOWNLOADING.load(Ordering::Acquire) {
        return Ok(());
    }
    let spec = current_spec(&app);
    // Quick check: if model is already present, just emit ready and return.
    if let Ok(path) = model_file(&app) {
        if let Ok(m) = std::fs::metadata(&path) {
            if m.len() == spec.size || custom_model_override() {
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

/// Ensure the selected model file exists, downloading it on first use.
///
/// Downloads are verified against the spec's pinned SHA-256 / size. A custom
/// model supplied via `CLIPS_WHISPER_MODEL` is exempt (it may legitimately be
/// a different model) — we only require it to exist.
///
/// Emits `whisper:model-progress { downloadedMb, totalMb }` every ~16 MB.
pub async fn ensure_model(app: &AppHandle) -> Result<PathBuf, String> {
    let spec = current_spec(app);
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
            Ok(m) if m.len() == spec.size => {
                eprintln!("[whisper] model '{}' found at {}", spec.id, path.display());
                return Ok(path);
            }
            Ok(m) => {
                eprintln!(
                    "[whisper] cached model size {} != expected {} — re-downloading",
                    m.len(),
                    spec.size
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
                if m.len() == spec.size {
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

    let result = do_download(app, spec, &path, custom).await;
    DOWNLOADING.store(false, Ordering::SeqCst);
    result
}

async fn do_download(
    app: &AppHandle,
    spec: &WhisperModelSpec,
    path: &PathBuf,
    custom: bool,
) -> Result<PathBuf, String> {
    let total_mb = spec.size_mb();
    eprintln!(
        "[whisper] model not found at {} — downloading {} (~{} MB, one time)",
        path.display(),
        spec.url,
        total_mb
    );
    let mut resp = reqwest::get(spec.url).await.map_err(|e| {
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
    // (no full-model heap spike) and lets us verify before the rename.
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
            eprintln!("[whisper] downloading model… {downloaded_mb} / {total_mb} MB");
            let _ = app.emit(
                "whisper:model-progress",
                serde_json::json!({ "downloadedMb": downloaded_mb, "totalMb": total_mb }),
            );
        }
    }
    file.flush().map_err(|e| format!("flush model tmp: {e}"))?;
    drop(file);

    if !custom {
        if total != spec.size {
            let _ = std::fs::remove_file(&tmp);
            let msg = format!(
                "model size mismatch: got {total} bytes, expected {}",
                spec.size
            );
            eprintln!("[whisper] {msg}");
            return Err(msg);
        }
        let digest: String = hasher
            .finalize()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        if digest != spec.sha256 {
            let _ = std::fs::remove_file(&tmp);
            let msg = format!(
                "model checksum mismatch: got {digest}, expected {}",
                spec.sha256
            );
            eprintln!("[whisper] {msg}");
            return Err(msg);
        }
        eprintln!("[whisper] model checksum verified (sha256 {})", spec.sha256);
    }

    std::fs::rename(&tmp, path).map_err(|e| format!("rename model: {e}"))?;
    eprintln!("[whisper] model saved → {}", path.display());
    Ok(path.clone())
}
