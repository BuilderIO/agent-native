use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

static PENDING_CAPTURE_STOP_WORKERS: AtomicUsize = AtomicUsize::new(0);

pub(crate) fn pending_capture_stop_workers() -> usize {
    PENDING_CAPTURE_STOP_WORKERS.load(Ordering::SeqCst)
}

pub(crate) fn run_bounded_capture_stop<F>(stop: F, timeout: Duration) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String> + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    PENDING_CAPTURE_STOP_WORKERS.fetch_add(1, Ordering::SeqCst);
    std::thread::spawn(move || {
        let result = stop();
        PENDING_CAPTURE_STOP_WORKERS.fetch_sub(1, Ordering::SeqCst);
        let _ = tx.send(result);
    });
    match rx.recv_timeout(timeout) {
        Ok(result) => result,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Err(format!(
            "custom ScreenCaptureKit stop timed out after {}s; continuing finalization",
            timeout.as_secs()
        )),
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            Err("custom ScreenCaptureKit stop worker disconnected".into())
        }
    }
}
