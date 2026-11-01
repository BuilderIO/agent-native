//! Downloads of on-device model files, checked against a pinned size and
//! SHA-256 before they replace anything on disk.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

/// A model file at a fixed revision, with the size and SHA-256 it must have.
// Only the macOS build downloads the files; elsewhere just their size is shown.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(crate) struct PinnedFile {
    pub url: &'static str,
    pub filename: &'static str,
    pub sha256: &'static str,
    pub size_bytes: u64,
    /// Decimal megabytes, the unit Finder and the download page use.
    pub size_mb: u64,
}

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

/// How long a download may go without progress before it counts as stalled.
/// Nothing bounds the whole transfer: 731 MB on a slow link can rightly take
/// many minutes, and only a transfer that stops moving is a failure.
struct Patience {
    connect: Duration,
    /// From the request going out to the response headers arriving.
    response: Duration,
    /// Between one chunk of the body and the next.
    idle: Duration,
}

const PATIENCE: Patience = Patience {
    connect: Duration::from_secs(15),
    response: Duration::from_secs(30),
    idle: Duration::from_secs(30),
};

/// How often a wait checks the cancel flag.
const CANCEL_POLL: Duration = Duration::from_millis(100);

/// Streams the file to `<path>.tmp` and renames it into place only once its
/// size and checksum match. Any failure, stall or cancel deletes the partial
/// file, so a retry starts clean.
pub(crate) async fn download_verified(
    app: &AppHandle,
    path: &Path,
    download: &VerifiedDownload<'_>,
) -> Result<PathBuf, String> {
    fetch_verified(path, download, &PATIENCE, |mb| {
        let _ = app.emit(
            download.progress_event,
            serde_json::json!({ "downloadedMb": mb, "totalMb": download.size_mb }),
        );
    })
    .await
}

async fn fetch_verified(
    path: &Path,
    download: &VerifiedDownload<'_>,
    patience: &Patience,
    on_progress: impl Fn(u64),
) -> Result<PathBuf, String> {
    let tag = download.log_tag;
    eprintln!(
        "[{tag}] downloading {} (~{} MB)",
        download.url, download.size_mb
    );
    let tmp = partial_download_path(path);
    let fetched = fetch_into(&tmp, download, patience, on_progress).await;
    let result = fetched
        .and_then(|()| std::fs::rename(&tmp, path).map_err(|e| format!("rename model: {e}")));
    match &result {
        Ok(()) => eprintln!("[{tag}] saved → {}", path.display()),
        Err(error) => {
            match std::fs::remove_file(&tmp) {
                Ok(()) => {}
                Err(remove) if remove.kind() == std::io::ErrorKind::NotFound => {}
                Err(remove) => eprintln!(
                    "[{tag}] could not delete the partial download {}: {remove}",
                    tmp.display()
                ),
            }
            if error == DOWNLOAD_CANCELLED {
                eprintln!("[{tag}] download cancelled");
            }
        }
    }
    result.map(|()| path.to_path_buf())
}

/// `work`, unless it takes longer than `limit` or the download is cancelled
/// first.
async fn within<T>(
    cancel: Option<&AtomicBool>,
    limit: Duration,
    waiting_for: &str,
    work: impl std::future::Future<Output = T>,
) -> Result<T, String> {
    let cancelled = async {
        while !cancel.is_some_and(|cancel| cancel.load(Ordering::SeqCst)) {
            tokio::time::sleep(CANCEL_POLL).await;
        }
    };
    tokio::select! {
        done = tokio::time::timeout(limit, work) => done.map_err(|_| {
            format!(
                "model download stalled: no {waiting_for} for {} s",
                limit.as_secs_f32()
            )
        }),
        () = cancelled => Err(DOWNLOAD_CANCELLED.to_owned()),
    }
}

async fn fetch_into(
    tmp: &Path,
    download: &VerifiedDownload<'_>,
    patience: &Patience,
    on_progress: impl Fn(u64),
) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    use std::io::Write as _;

    let client = reqwest::Client::builder()
        .connect_timeout(patience.connect)
        .build()
        .map_err(|e| format!("model download client: {e}"))?;
    let mut response = within(
        download.cancel,
        patience.response,
        "response",
        client.get(download.url).send(),
    )
    .await?
    .map_err(|e| format!("model download failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("model download HTTP {}", response.status()));
    }

    let mut file = std::fs::File::create(tmp).map_err(|e| format!("create tmp: {e}"))?;
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    let mut last_progress = 0_u64;

    while let Some(chunk) = within(download.cancel, patience.idle, "data", response.chunk())
        .await?
        .map_err(|e| format!("download body: {e}"))?
    {
        hasher.update(&chunk);
        total += chunk.len() as u64;
        download.downloaded_bytes.store(total, Ordering::Relaxed);
        file.write_all(&chunk)
            .map_err(|e| format!("write tmp: {e}"))?;

        if total - last_progress >= 16 * 1024 * 1024 {
            last_progress = total;
            let mb = downloaded_mb(total, download.size_bytes, download.size_mb);
            eprintln!("[{}] {mb} / {} MB", download.log_tag, download.size_mb);
            on_progress(mb);
        }
    }
    file.flush().map_err(|e| format!("flush tmp: {e}"))?;
    drop(file);

    if total != download.size_bytes {
        return Err(format!(
            "size mismatch: got {total} bytes, expected {}",
            download.size_bytes
        ));
    }
    let digest = digest_string(&hasher.finalize());
    if digest != download.sha256 {
        return Err(format!(
            "checksum mismatch: got {digest}, expected {}",
            download.sha256
        ));
    }
    Ok(())
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

    /// A one-connection HTTP server on a free local port. `reply` gets the
    /// accepted socket once the request has been read.
    fn serve_once(
        reply: impl FnOnce(std::net::TcpStream) + Send + 'static,
    ) -> (String, std::thread::JoinHandle<()>) {
        use std::io::Read as _;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/model.gguf", listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = [0_u8; 4096];
            let _ = socket.read(&mut request);
            reply(socket);
        });
        (url, server)
    }

    fn headers(len: usize) -> String {
        format!("HTTP/1.1 200 OK\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n")
    }

    // SHA-256 of "abc".
    const ABC: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    const SHORT: Patience = Patience {
        connect: Duration::from_secs(2),
        response: Duration::from_millis(300),
        idle: Duration::from_millis(300),
    };

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "clips-model-download-{name}-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("model.gguf")
    }

    fn abc_download<'a>(
        url: &'a str,
        downloaded: &'a AtomicU64,
        cancel: Option<&'a AtomicBool>,
    ) -> VerifiedDownload<'a> {
        VerifiedDownload {
            url,
            sha256: ABC,
            size_bytes: 3,
            size_mb: 1,
            progress_event: "test:progress",
            downloaded_bytes: downloaded,
            cancel,
            log_tag: "test",
        }
    }

    #[tokio::test]
    async fn a_server_that_never_answers_is_a_stall_not_a_hang() {
        let path = scratch("no-headers");
        let (url, server) = serve_once(|socket| {
            std::thread::sleep(Duration::from_millis(1_000));
            drop(socket);
        });
        let downloaded = AtomicU64::new(0);
        let started = std::time::Instant::now();
        let error = fetch_verified(
            &path,
            &abc_download(&url, &downloaded, None),
            &SHORT,
            |_| {},
        )
        .await
        .unwrap_err();
        assert!(error.contains("stalled: no response"), "{error}");
        assert!(started.elapsed() < Duration::from_millis(900));
        assert!(!partial_download_path(&path).exists());
        server.join().unwrap();
    }

    /// A body that stops halfway fails on its own, deletes what it got, and
    /// the next attempt downloads the whole file.
    #[tokio::test]
    async fn a_body_that_stops_moving_fails_and_the_retry_starts_clean() {
        use std::io::Write as _;
        let path = scratch("stalled-body");
        let (url, server) = serve_once(|mut socket| {
            socket.write_all(headers(3).as_bytes()).unwrap();
            socket.write_all(b"a").unwrap();
            socket.flush().unwrap();
            std::thread::sleep(Duration::from_millis(1_000));
        });
        let downloaded = AtomicU64::new(0);
        let error = fetch_verified(
            &path,
            &abc_download(&url, &downloaded, None),
            &SHORT,
            |_| {},
        )
        .await
        .unwrap_err();
        assert!(error.contains("stalled: no data"), "{error}");
        assert_eq!(downloaded.load(Ordering::SeqCst), 1);
        assert!(!partial_download_path(&path).exists());
        assert!(!path.exists());
        server.join().unwrap();

        let (url, server) = serve_once(|mut socket| {
            socket.write_all(headers(3).as_bytes()).unwrap();
            socket.write_all(b"abc").unwrap();
        });
        let saved = fetch_verified(
            &path,
            &abc_download(&url, &downloaded, None),
            &SHORT,
            |_| {},
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(&saved).unwrap(), b"abc");
        assert!(!partial_download_path(&path).exists());
        server.join().unwrap();
        std::fs::remove_file(&saved).unwrap();
    }

    /// Cancelling a stalled download ends it at once, not when the stall is
    /// noticed, and deletes the partial file.
    #[tokio::test]
    async fn cancelling_a_stalled_download_ends_it_at_once() {
        use std::io::Write as _;
        let path = scratch("cancel");
        let (url, server) = serve_once(|mut socket| {
            socket.write_all(headers(3).as_bytes()).unwrap();
            socket.write_all(b"a").unwrap();
            socket.flush().unwrap();
            std::thread::sleep(Duration::from_millis(1_500));
        });
        let cancel: &'static AtomicBool = Box::leak(Box::new(AtomicBool::new(false)));
        let downloaded = AtomicU64::new(0);
        let patient = Patience {
            idle: Duration::from_secs(10),
            ..SHORT
        };
        let canceller = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(200));
            cancel.store(true, Ordering::SeqCst);
        });
        let started = std::time::Instant::now();
        let error = fetch_verified(
            &path,
            &abc_download(&url, &downloaded, Some(cancel)),
            &patient,
            |_| {},
        )
        .await
        .unwrap_err();
        assert_eq!(error, DOWNLOAD_CANCELLED);
        assert!(started.elapsed() < Duration::from_millis(800));
        assert!(!partial_download_path(&path).exists());
        canceller.join().unwrap();
        server.join().unwrap();
    }

    #[tokio::test]
    async fn a_file_that_fails_its_checksum_is_not_kept() {
        use std::io::Write as _;
        let path = scratch("checksum");
        let (url, server) = serve_once(|mut socket| {
            socket.write_all(headers(3).as_bytes()).unwrap();
            socket.write_all(b"abd").unwrap();
        });
        let downloaded = AtomicU64::new(0);
        let error = fetch_verified(
            &path,
            &abc_download(&url, &downloaded, None),
            &SHORT,
            |_| {},
        )
        .await
        .unwrap_err();
        assert!(error.contains("checksum mismatch"), "{error}");
        assert!(!partial_download_path(&path).exists());
        assert!(!path.exists());
        server.join().unwrap();
    }
}
