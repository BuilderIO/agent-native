//! Persistent log file for production debugging.
//!
//! Release builds detach from a terminal, so every `println!` / `eprintln!`
//! / `dlog!` and Rust panic normally vanishes — there's nothing to send to
//! support when a user hits a bug. To capture all of it without touching the
//! hundreds of existing log call sites, we redirect the process stdout/stderr
//! file descriptors to a rotating file under the OS log dir
//! (`~/Library/Logs/<bundle-id>/clips-tray.log` on macOS). The frontend tees
//! its `console.*` output here too via the `frontend_log` command, so a single
//! file holds both Rust and webview logs.
//!
//! In debug builds we leave the streams alone so `tauri dev` keeps printing to
//! the terminal; only the log path + startup banner are set up.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::{AppHandle, Manager};

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// Rotate once the active log passes this size so the file can't grow without
/// bound across long-lived sessions.
const MAX_BYTES: u64 = 10 * 1024 * 1024;

/// Path of the active log file, once [`init`] has resolved it.
pub fn log_path() -> Option<PathBuf> {
    LOG_PATH.get().cloned()
}

/// Resolve the log file, rotate it if needed, and (release only) redirect
/// stdout/stderr into it. Safe to call once during app setup.
pub fn init(app: &AppHandle) {
    let dir = match app.path().app_log_dir() {
        Ok(dir) => dir,
        Err(err) => {
            eprintln!("[clips-tray] could not resolve log dir: {err}");
            return;
        }
    };
    if let Err(err) = fs::create_dir_all(&dir) {
        eprintln!("[clips-tray] could not create log dir {dir:?}: {err}");
        return;
    }

    let path = dir.join("clips-tray.log");
    rotate_if_needed(&path);
    let _ = LOG_PATH.set(path.clone());

    // In release, point fd 1 + 2 at the file so every existing println!,
    // eprintln!, dlog!, and panic message is captured with no call-site
    // changes. Done before the banner so the banner lands in the file too.
    #[cfg(not(debug_assertions))]
    redirect_std_streams(&path);

    // Always write a startup marker — guarantees the file exists (even in dev)
    // and stamps each run so support can tell session boundaries apart.
    let banner = format!(
        "[clips-tray] === log start {} v{} ===",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        env!("CARGO_PKG_VERSION"),
    );
    #[cfg(not(debug_assertions))]
    println!("{banner}");
    #[cfg(debug_assertions)]
    append_line(&path, &banner);
}

fn rotate_if_needed(path: &Path) {
    if let Ok(meta) = fs::metadata(path) {
        if meta.len() > MAX_BYTES {
            // Single previous generation is enough for debugging; the rename
            // replaces any earlier `.1`.
            let _ = fs::rename(path, path.with_extension("log.1"));
        }
    }
}

#[allow(dead_code)] // unused in release where stdout/stderr are redirected
fn append_line(path: &Path, line: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

#[cfg(all(not(debug_assertions), unix))]
fn redirect_std_streams(path: &Path) {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let Ok(cpath) = CString::new(path.as_os_str().as_bytes()) else {
        return;
    };
    unsafe {
        let fd = libc::open(
            cpath.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_APPEND,
            0o644,
        );
        if fd < 0 {
            return;
        }
        libc::dup2(fd, libc::STDOUT_FILENO);
        libc::dup2(fd, libc::STDERR_FILENO);
        if fd > 2 {
            libc::close(fd);
        }
    }
}

#[cfg(all(not(debug_assertions), windows))]
fn redirect_std_streams(path: &Path) {
    use std::os::windows::ffi::OsStrExt;

    // libc::open maps to the narrow CRT _open, which interprets the path in
    // the active ANSI code page — a profile path with non-ASCII characters
    // (e.g. C:\Users\Müller) then fails to open and silently disables logging.
    // Build a NUL-terminated UTF-16 path and use the wide wopen instead.
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let fd = libc::wopen(
            wide.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_APPEND,
            libc::S_IWRITE,
        );
        if fd < 0 {
            return;
        }
        // 1 = stdout, 2 = stderr (libc on Windows omits STD*_FILENO).
        libc::dup2(fd, 1);
        libc::dup2(fd, 2);
        if fd > 2 {
            libc::close(fd);
        }
    }
}

// Exotic release targets (neither unix nor windows) keep their default
// streams — there's no portable fd redirect to fall back on.
#[cfg(all(not(debug_assertions), not(unix), not(windows)))]
fn redirect_std_streams(_path: &Path) {}

/// Forward a webview `console.*` line into the same log file. Called from the
/// frontend console tee (see `src/main.tsx`).
#[tauri::command]
pub fn frontend_log(level: String, message: String) {
    // In release this println! is redirected into the log file; in dev it
    // simply echoes to the terminal.
    println!("[webview][{level}] {message}");
    // In dev there is no fd redirect, so also append directly to keep the file
    // useful when a developer opens it.
    #[cfg(debug_assertions)]
    if let Some(path) = log_path() {
        append_line(&path, &format!("[webview][{level}] {message}"));
    }
}

/// Reveal the log file in the system file manager so users/support can grab it.
#[tauri::command]
pub fn open_logs() -> Result<(), String> {
    let path = log_path().ok_or_else(|| "log file is not initialized yet".to_string())?;
    reveal_in_file_manager(&path)
}

#[cfg(target_os = "macos")]
fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
    let status = std::process::Command::new("open")
        .arg("-R")
        .arg(path)
        .status()
        .map_err(|e| format!("failed to reveal log file: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("open exited with {status}"))
    }
}

#[cfg(target_os = "windows")]
fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
    let status = std::process::Command::new("explorer")
        .arg("/select,")
        .arg(path)
        .status()
        .map_err(|e| format!("failed to reveal log file: {e}"))?;
    // explorer.exe returns a non-zero exit code even on success, so don't gate
    // on status here.
    let _ = status;
    Ok(())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
    let dir = path.parent().unwrap_or(path);
    let status = std::process::Command::new("xdg-open")
        .arg(dir)
        .status()
        .map_err(|e| format!("failed to open log folder: {e}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("xdg-open exited with {status}"))
    }
}
