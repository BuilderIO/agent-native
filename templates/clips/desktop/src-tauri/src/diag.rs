//! Local timing/diagnostic log for the tray — stderr is swallowed on macOS
//! app launches, so phase timings and whisper session events append as JSON
//! lines to `<app_data_dir>/tray-timings.log` instead. Best-effort: never
//! let diagnostics break a recording.

use std::io::Write as _;
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

/// Diag directory captured on first use so deep capture code (no AppHandle in
/// scope) can still log via `tray_diag_global`.
static DIAG_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn tray_diag(app: &AppHandle, entry: serde_json::Value) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
    let _ = DIAG_DIR.set(dir.clone());
    write_diag(&dir, entry);
}

/// Capture the diag dir at startup so `tray_diag_global` works from the
/// first recording of a session.
pub fn init(app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = DIAG_DIR.set(dir);
    }
}

/// Best-effort diag without an AppHandle — only writes once `init` (or any
/// `tray_diag(app, …)` call) has captured the app data dir.
pub fn tray_diag_global(entry: serde_json::Value) {
    if let Some(dir) = DIAG_DIR.get() {
        write_diag(dir, entry);
    }
}

fn write_diag(dir: &PathBuf, entry: serde_json::Value) {
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let line = format!("{{\"atMs\":{ms},{}\n", {
        let s = entry.to_string();
        // splice entry fields into the same object: {"atMs":N, <fields>}
        s[1..].to_string()
    });
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("tray-timings.log"))
        .and_then(|mut f| f.write_all(line.as_bytes()));
}
