//! Downloads of on-device model files, checked against a pinned size and
//! SHA-256 before they replace anything on disk.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use tauri::{AppHandle, Emitter};

/// One pinned model file and where its progress goes.
pub(crate) struct VerifiedDownload<'a> {
    pub url: &'a str,
    pub sha256: &'a str,
    pub size_bytes: u64,
    pub size_mb: u64,
    /// Receives `{ downloadedMb, totalMb }` every 16 MB.
    pub progress_event: &'a str,
    pub downloaded_bytes: &'a AtomicU64,
    /// Stops the download, and deletes the partial file, once it turns true.
    pub cancel: Option<&'a AtomicBool>,
    pub log_tag: &'a str,
}

pub(crate) const DOWNLOAD_CANCELLED: &str = "model-download-cancelled";

pub(crate) fn downloaded_mb(bytes: u64, size_bytes: u64, size_mb: u64) -> u64 {
    bytes.saturating_mul(size_mb) / size_bytes.max(1)
}

fn digest_string(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The SHA-256 of a file already on disk, as lowercase hexadecimal.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) fn file_sha256(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};

    let mut file =
        std::fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| format!("read {}: {e}", path.display()))?;
    Ok(digest_string(&hasher.finalize()))
}

pub(crate) fn partial_download_path(path: &Path) -> PathBuf {
    let mut partial = path.as_os_str().to_owned();
    partial.push(".tmp");
    PathBuf::from(partial)
}

/// Streams the file to `<path>.tmp` and renames it into place only once its
/// size and checksum match.
pub(crate) async fn download_verified(
    app: &AppHandle,
    path: &Path,
    download: &VerifiedDownload<'_>,
) -> Result<PathBuf, String> {
    let tag = download.log_tag;
    eprintln!(
        "[{tag}] downloading {} (~{} MB)",
        download.url, download.size_mb
    );
    let mut response = reqwest::get(download.url)
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
        if download
            .cancel
            .is_some_and(|cancel| cancel.load(Ordering::SeqCst))
        {
            drop(file);
            let _ = std::fs::remove_file(&tmp);
            eprintln!("[{tag}] download cancelled");
            return Err(DOWNLOAD_CANCELLED.to_owned());
        }
        hasher.update(&chunk);
        total += chunk.len() as u64;
        download.downloaded_bytes.store(total, Ordering::Relaxed);

        if let Err(e) = file.write_all(&chunk) {
            let _ = std::fs::remove_file(&tmp);
            return Err(format!("write tmp: {e}"));
        }

        if total - last_progress >= 16 * 1024 * 1024 {
            last_progress = total;
            let mb = downloaded_mb(total, download.size_bytes, download.size_mb);
            eprintln!("[{tag}] {mb} / {} MB", download.size_mb);
            let _ = app.emit(
                download.progress_event,
                serde_json::json!({ "downloadedMb": mb, "totalMb": download.size_mb }),
            );
        }
    }
    file.flush().map_err(|e| format!("flush tmp: {e}"))?;
    drop(file);

    if total != download.size_bytes {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!(
            "size mismatch: got {total} bytes, expected {}",
            download.size_bytes
        ));
    }
    let digest = digest_string(&hasher.finalize());
    if digest != download.sha256 {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!(
            "checksum mismatch: got {digest}, expected {}",
            download.sha256
        ));
    }

    std::fs::rename(&tmp, path).map_err(|e| format!("rename model: {e}"))?;
    eprintln!("[{tag}] saved → {}", path.display());
    Ok(path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn progress_is_reported_in_the_catalog_unit() {
        assert_eq!(downloaded_mb(0, 731_357_568, 731), 0);
        assert_eq!(downloaded_mb(365_678_784, 731_357_568, 731), 365);
        assert_eq!(downloaded_mb(731_357_568, 731_357_568, 731), 731);
    }
}
