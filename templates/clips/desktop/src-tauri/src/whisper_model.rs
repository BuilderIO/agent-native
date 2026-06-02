//! Whisper model resolution + download for the local meeting transcription
//! engine (`whisper_speech.rs`).
//!
//! Resolves where the `ggml-base.en.bin` model lives, downloads it from
//! HuggingFace on first use, and verifies the download against a pinned
//! SHA-256 + byte size so a corrupted, truncated, or tampered file is rejected
//! rather than loaded. Pure filesystem + HTTP — no `whisper-rs` dependency — so
//! it stays platform-agnostic and easy to test in isolation.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
const MODEL_FILENAME: &str = "ggml-base.bin";
const MODEL_SHA256: &str = "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe";
const MODEL_SIZE: u64 = 147_951_465;

/// Whether the model path is overridden via `CLIPS_WHISPER_MODEL`. A custom
/// model is exempt from checksum verification (it may legitimately be a
/// different model, e.g. multilingual).
pub(crate) fn custom_model_override() -> bool {
    std::env::var("CLIPS_WHISPER_MODEL")
        .map(|v| !v.trim().is_empty())
        .unwrap_or(false)
}

/// Resolve the model path. Honors `CLIPS_WHISPER_MODEL`, otherwise
/// `<app_data_dir>/models/ggml-base.en.bin` (creating the dir).
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

/// Ensure the model file exists, downloading it on first use. ~142 MB, so the
/// first meeting after install pays a one-time download cost.
///
/// The default `ggml-base.en.bin` download is verified against `MODEL_SHA256` /
/// `MODEL_SIZE`. A custom model supplied via `CLIPS_WHISPER_MODEL` is exempt
/// (it may legitimately be a different model) — we only require it to exist.
pub async fn ensure_model(app: &AppHandle) -> Result<PathBuf, String> {
    let path = model_file(app)?;
    let custom = custom_model_override();

    if path.exists() {
        if custom {
            eprintln!("[whisper] using custom model at {}", path.display());
            return Ok(path);
        }
        // Cheap size check catches a truncated/partial earlier download without
        // re-hashing 142 MB on every meeting start; full integrity is verified
        // at download time below.
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

    // Stream the body straight to a temp file, hashing as we go. Keeps memory
    // flat (no 142 MB heap spike) and lets us verify before the rename.
    use sha2::{Digest, Sha256};
    use std::io::Write as _;

    let tmp = path.with_extension("bin.tmp");
    let mut file = std::fs::File::create(&tmp).map_err(|e| format!("create model tmp: {e}"))?;
    let mut hasher = Sha256::new();
    let mut total: u64 = 0;
    let mut last_logged: u64 = 0;
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("model download body failed: {e}"))?
    {
        if !custom {
            hasher.update(&chunk);
        }
        total += chunk.len() as u64;
        if let Err(e) = file.write_all(&chunk) {
            let _ = std::fs::remove_file(&tmp);
            let msg = format!("write model tmp: {e}");
            eprintln!("[whisper] {msg}");
            return Err(msg);
        }
        // Coarse progress log every ~16 MB so the (one-time) download isn't
        // a silent multi-second stall in the logs.
        if total - last_logged >= 16 * 1024 * 1024 {
            last_logged = total;
            eprintln!("[whisper] downloading model… {} MB", total / (1024 * 1024));
        }
    }
    file.flush().map_err(|e| format!("flush model tmp: {e}"))?;
    drop(file);

    // Verify the default model before trusting it. Reject + clean up on
    // mismatch rather than leaving a bad file on disk.
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

    // Rename only after verification so a partial/bad download is never
    // mistaken for a complete model.
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename model: {e}"))?;
    eprintln!("[whisper] model saved → {}", path.display());
    Ok(path)
}
