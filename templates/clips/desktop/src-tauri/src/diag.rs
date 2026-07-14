//! Local timing/diagnostic log for the tray — stderr is swallowed on macOS
//! app launches, so phase timings and whisper session events append as JSON
//! lines to `<app_data_dir>/tray-timings.log` instead. Best-effort: never
//! let diagnostics break a recording.

use std::io::Write as _;
use tauri::{AppHandle, Manager};

pub fn tray_diag(app: &AppHandle, entry: serde_json::Value) {
    let Ok(dir) = app.path().app_data_dir() else {
        return;
    };
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
