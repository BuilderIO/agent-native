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
    /// The whisper.cpp file earlier versions downloaded for this model. It is
    /// loaded until the replacement has downloaded, and removed once the
    /// replacement has loaded, never before.
    #[serde(skip)]
    pub legacy_filename: &'static str,
    #[serde(skip)]
    pub legacy_size_bytes: u64,
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
    legacy_size_bytes: 77_691_713,
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
    legacy_size_bytes: 147_951_465,
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
    legacy_size_bytes: 487_601_967,
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
    legacy_size_bytes: 1_624_555_275,
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

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
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

fn downloaded_mb(bytes: u64, model: &WhisperModel) -> u64 {
    bytes.saturating_mul(model.size_mb) / model.size_bytes
}

fn usable_legacy_file(dir: &Path, model: &WhisperModel) -> Option<PathBuf> {
    let path = dir.join(model.legacy_filename);
    std::fs::metadata(&path)
        .is_ok_and(|m| m.len() == model.legacy_size_bytes)
        .then_some(path)
}

/// The file to load for `model`: the GGUF once it is complete, otherwise a
/// whisper.cpp file an earlier version downloaded. transcribe.cpp reads both,
/// so an upgrade never leaves the user waiting on, or stranded by, the new
/// download.
fn usable_model_file(dir: &Path, model: &WhisperModel) -> Option<PathBuf> {
    let path = model_path(dir, model);
    if is_complete_on_disk(&path, model) {
        return Some(path);
    }
    usable_legacy_file(dir, model)
}

/// The file to load for the selected model. It may not exist yet; see
/// `ensure_model`.
pub fn model_file(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("CLIPS_WHISPER_MODEL") {
        if !path.trim().is_empty() {
            return Ok(PathBuf::from(path));
        }
    }
    let config = crate::config::feature_config(app);
    let model = find_model(&config.whisper_model_id)?;
    let dir = models_dir(app)?;
    Ok(usable_model_file(&dir, model).unwrap_or_else(|| model_path(&dir, model)))
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
    if let Err(e) = remove_legacy_files(&dir, model) {
        eprintln!("[whisper] {e}");
    }
}

fn remove_legacy_files(dir: &Path, model: &WhisperModel) -> Result<(), String> {
    let legacy = dir.join(model.legacy_filename);
    let mut result = Ok(());
    for path in [partial_download_path(&legacy), legacy] {
        match std::fs::remove_file(&path) {
            Ok(()) => eprintln!("[whisper] removed superseded {}", path.display()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => result = Err(format!("could not remove {}: {e}", path.display())),
        }
    }
    result
}

/// Removes every file that makes `model` count as downloaded.
fn remove_model_files(dir: &Path, model: &WhisperModel) -> Result<(), String> {
    let path = model_path(dir, model);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("delete model: {e}"))?;
    }
    remove_legacy_files(dir, model)
}

fn downloaded_model_ids(dir: &Path, models: &[WhisperModel]) -> Vec<String> {
    models
        .iter()
        .filter(|m| usable_model_file(dir, m).is_some())
        .map(|m| m.id.to_string())
        .collect()
}

fn partial_download_path(path: &Path) -> PathBuf {
    let mut partial = path.as_os_str().to_owned();
    partial.push(".tmp");
    PathBuf::from(partial)
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
    let usable = usable_model_file(&dir, model);
    let path_str = usable
        .clone()
        .unwrap_or_else(|| model_path(&dir, model))
        .to_string_lossy()
        .into_owned();

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
    let ready = usable.is_some();
    Ok(ModelStatus {
        state: if ready { "ready" } else { "missing" }.into(),
        path: path_str,
        downloaded_mb: if ready { model.size_mb } else { 0 },
        total_mb: model.size_mb,
    })
}

#[tauri::command]
pub async fn whisper_model_download(app: AppHandle) -> Result<(), String> {
    spawn_download(app);
    Ok(())
}

/// Downloads the selected model's GGUF in the background, reporting through
/// the `whisper:model-*` events.
fn spawn_download(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        match download_selected_model(&app).await {
            Ok(_) => {
                let _ = app.emit("whisper:model-ready", ());
            }
            Err(e) => {
                eprintln!("[whisper] model download failed: {e}");
                let _ = app.emit("whisper:model-error", serde_json::json!({ "error": e }));
            }
        }
    });
}

#[tauri::command]
pub async fn whisper_downloaded_models(app: AppHandle) -> Vec<String> {
    let Ok(dir) = models_dir(&app) else {
        return vec![];
    };
    downloaded_model_ids(&dir, SUPPORTED_MODELS)
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
    remove_model_files(&models_dir(&app)?, model)?;
    let _ = app.emit(
        "whisper:model-deleted",
        serde_json::json!({ "modelId": model_id }),
    );
    Ok(())
}

/// The file to load for the selected model, downloading it first when nothing
/// usable is on disk. A legacy whisper.cpp file is returned at once while the
/// GGUF downloads in the background; the next load picks up the GGUF.
pub(crate) async fn ensure_model(app: &AppHandle) -> Result<PathBuf, String> {
    if custom_model_override() {
        let path = model_file(app)?;
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
    let dir = models_dir(app)?;
    let path = model_path(&dir, model);
    if !is_complete_on_disk(&path, model) {
        if let Some(legacy) = usable_legacy_file(&dir, model) {
            eprintln!(
                "[whisper] using {} until {} has downloaded",
                legacy.display(),
                model.filename
            );
            if !DOWNLOADING.load(Ordering::SeqCst) {
                spawn_download(app.clone());
            }
            return Ok(legacy);
        }
    }
    download_model(app, path, model).await
}

/// Makes sure the selected model's GGUF is on disk. Unlike `ensure_model`, it
/// never settles for the legacy file.
async fn download_selected_model(app: &AppHandle) -> Result<PathBuf, String> {
    if custom_model_override() {
        return ensure_model(app).await;
    }
    let config = crate::config::feature_config(app);
    let model = find_model(&config.whisper_model_id)?;
    download_model(app, model_path(&models_dir(app)?, model), model).await
}

async fn download_model(
    app: &AppHandle,
    path: PathBuf,
    model: &WhisperModel,
) -> Result<PathBuf, String> {
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
    eprintln!(
        "[whisper] downloading {} (~{} MB)",
        model.url, model.size_mb
    );
    let mut response = reqwest::get(model.url)
        .await
        .map_err(|e| format!("model download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("model download HTTP {}", response.status()));
    }

    use sha2::{Digest, Sha256};
    use std::io::Write as _;

    let tmp = partial_download_path(path);
    let mut file = std::fs::File::create(&tmp).map_err(|e| format!("create tmp: {e}"))?;
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    let mut last_progress = 0_u64;

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("download body: {e}"))?
    {
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
    let digest: String = hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
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
            assert!(model.filename.ends_with(".gguf"), "{}", model.id);
            assert!(model.url.ends_with(model.filename), "{}", model.id);
            assert!(model.legacy_filename.ends_with(".bin"), "{}", model.id);
            assert!(model.legacy_size_bytes > 0, "{}", model.id);
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
        let dir = empty_dir("remove-legacy");
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

        remove_legacy_files(&dir, &BASE_MODEL).unwrap();
        remove_legacy_files(&dir, &BASE_MODEL).unwrap();

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

    const FAKE_MODEL: WhisperModel = WhisperModel {
        id: "fake",
        filename: "fake.gguf",
        size_bytes: 4,
        legacy_filename: "ggml-fake.bin",
        legacy_size_bytes: 3,
        ..BASE_MODEL
    };

    fn empty_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("clips-whisper-model-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_legacy_download_is_used_until_its_replacement_is_complete() {
        let dir = empty_dir("legacy-fallback");
        let gguf = model_path(&dir, &FAKE_MODEL);
        let legacy = dir.join(FAKE_MODEL.legacy_filename);
        assert_eq!(usable_model_file(&dir, &FAKE_MODEL), None);

        std::fs::write(&legacy, b"bi").unwrap();
        assert_eq!(
            usable_model_file(&dir, &FAKE_MODEL),
            None,
            "truncated legacy file"
        );

        std::fs::write(&legacy, b"bin").unwrap();
        assert_eq!(usable_model_file(&dir, &FAKE_MODEL), Some(legacy.clone()));

        std::fs::write(partial_download_path(&gguf), b"gg").unwrap();
        std::fs::write(&gguf, b"ggu").unwrap();
        assert_eq!(usable_model_file(&dir, &FAKE_MODEL), Some(legacy.clone()));

        std::fs::write(&gguf, b"gguf").unwrap();
        assert_eq!(usable_model_file(&dir, &FAKE_MODEL), Some(gguf));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_model_counts_as_downloaded_while_either_file_is_usable() {
        const LEGACY_ONLY: WhisperModel = WhisperModel {
            id: "legacy-only",
            filename: "legacy-only.gguf",
            legacy_filename: "ggml-legacy-only.bin",
            ..FAKE_MODEL
        };
        const GGUF_ONLY: WhisperModel = WhisperModel {
            id: "gguf-only",
            filename: "gguf-only.gguf",
            legacy_filename: "ggml-gguf-only.bin",
            ..FAKE_MODEL
        };
        const PARTIAL_ONLY: WhisperModel = WhisperModel {
            id: "partial-only",
            filename: "partial-only.gguf",
            legacy_filename: "ggml-partial-only.bin",
            ..FAKE_MODEL
        };
        let models = [LEGACY_ONLY, GGUF_ONLY, PARTIAL_ONLY];
        let dir = empty_dir("downloaded-list");
        std::fs::write(dir.join(LEGACY_ONLY.legacy_filename), b"bin").unwrap();
        std::fs::write(model_path(&dir, &GGUF_ONLY), b"gguf").unwrap();
        std::fs::write(model_path(&dir, &PARTIAL_ONLY), b"gg").unwrap();
        std::fs::write(dir.join(PARTIAL_ONLY.legacy_filename), b"bi").unwrap();

        assert_eq!(
            downloaded_model_ids(&dir, &models),
            ["legacy-only", "gguf-only"]
        );

        remove_model_files(&dir, &LEGACY_ONLY).unwrap();
        remove_model_files(&dir, &GGUF_ONLY).unwrap();
        assert!(downloaded_model_ids(&dir, &models).is_empty());

        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn deleting_a_model_removes_both_of_its_files() {
        let dir = empty_dir("delete-both");
        let files = [
            model_path(&dir, &FAKE_MODEL),
            dir.join(FAKE_MODEL.legacy_filename),
            partial_download_path(&dir.join(FAKE_MODEL.legacy_filename)),
        ];
        std::fs::write(&files[0], b"gguf").unwrap();
        std::fs::write(&files[1], b"bin").unwrap();
        std::fs::write(&files[2], b"b").unwrap();

        remove_model_files(&dir, &FAKE_MODEL).unwrap();

        for path in &files {
            assert!(!path.exists(), "{} was kept", path.display());
        }
        assert!(downloaded_model_ids(&dir, &[FAKE_MODEL]).is_empty());
        std::fs::remove_dir(&dir).unwrap();
    }

    #[test]
    fn partial_downloads_sit_beside_the_finished_file() {
        assert_eq!(
            partial_download_path(Path::new("/models/whisper-base-Q8_0.gguf")),
            Path::new("/models/whisper-base-Q8_0.gguf.tmp")
        );
        assert_eq!(
            partial_download_path(Path::new("/models/ggml-base.bin")),
            Path::new("/models/ggml-base.bin.tmp")
        );
    }
}
