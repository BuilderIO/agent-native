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
//!
//! Every line written to the file is prefixed with a local timestamp so support
//! and developers can correlate events. In release the redirected fds feed a
//! pipe whose reader thread stamps each line, which keeps the timestamping in
//! one place without touching the existing log call sites.

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

/// Local wall-clock timestamp prefixed to every log line, with millisecond
/// precision so closely-spaced events stay distinguishable.
fn timestamp() -> String {
    chrono::Local::now()
        .format("%Y-%m-%d %H:%M:%S%.3f")
        .to_string()
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

    // Write panic output straight to the file before the streams are redirected.
    // In release (panic = "abort") the process can die before the pump drains
    // the pipe, so the synchronous write guarantees the crash message survives.
    install_panic_hook();

    // In release, point fd 1 + 2 at the file so every existing println!,
    // eprintln!, dlog!, and panic message is captured with no call-site
    // changes. Done before the banner so the banner lands in the file too.
    #[cfg(not(debug_assertions))]
    redirect_std_streams(&path);

    // Always write a startup marker — guarantees the file exists (even in dev)
    // and marks each run so support can tell session boundaries apart. The
    // per-line timestamp prefix supplies the time, so the banner only carries
    // the version.
    let banner = format!(
        "[clips-tray] === log start v{} ===",
        env!("CARGO_PKG_VERSION"),
    );
    #[cfg(not(debug_assertions))]
    println!("{banner}");
    #[cfg(debug_assertions)]
    append_line(&path, &banner);
}

/// Persist panic info directly to the log file (bypassing the redirect pipe) so
/// an aborting release build can't drop the crash message while it's still
/// buffered in the pipe. Chains the previous hook so terminal/stderr output is
/// preserved.
fn install_panic_hook() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        if let Some(path) = log_path() {
            append_line(&path, &format!("[clips-tray] panic: {info}"));
        }
        prev(info);
        crate::sentry_report::flush(std::time::Duration::from_secs(2));
    }));
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

fn append_line(path: &Path, line: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{} {line}", timestamp());
    }
}

/// Drain the redirected stdout/stderr pipe, prefixing every line with a
/// timestamp before appending it to the log file. Runs for the life of the
/// process on its own thread (release only).
#[cfg(not(debug_assertions))]
fn spawn_log_pump(read_fd: libc::c_int, path: PathBuf) {
    std::thread::spawn(move || {
        // Keep draining the pipe even if the file can't be opened: stdout and
        // stderr are already redirected into it, so a pump that stops reading
        // would let the buffer fill and block every later println!. When there
        // is no file we simply discard the bytes.
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .ok();
        let mut buf = [0u8; 4096];
        let mut line: Vec<u8> = Vec::new();
        loop {
            let n = unsafe {
                libc::read(
                    read_fd,
                    buf.as_mut_ptr() as *mut libc::c_void,
                    buf.len() as _,
                )
            };
            if n < 0 {
                // A signal can interrupt a blocking read (EINTR); retry rather
                // than treating it as EOF, which would permanently stop draining
                // the pipe and eventually block writers once it fills.
                if std::io::Error::last_os_error().raw_os_error() == Some(libc::EINTR) {
                    continue;
                }
                break;
            }
            if n == 0 {
                break; // all writers closed → real EOF
            }
            // Discard the chunk when there's no destination, but keep looping so
            // the pipe never fills and blocks writers.
            let Some(file) = file.as_mut() else { continue };
            for &byte in &buf[..n as usize] {
                match byte {
                    b'\n' => {
                        write_stamped_line(file, &line);
                        line.clear();
                    }
                    b'\r' => {}
                    _ => line.push(byte),
                }
            }
        }
        if let Some(file) = file.as_mut() {
            if !line.is_empty() {
                write_stamped_line(file, &line);
            }
        }
    });
}

#[cfg(not(debug_assertions))]
fn write_stamped_line(file: &mut std::fs::File, line: &[u8]) {
    let text = String::from_utf8_lossy(line);
    let _ = writeln!(file, "{} {text}", timestamp());
}

#[cfg(all(not(debug_assertions), unix))]
fn redirect_std_streams(path: &Path) {
    // Point fd 1 + 2 at the write end of a pipe and let the pump thread read
    // the other end, so it can timestamp each line on its way to the file.
    let mut fds = [0 as libc::c_int; 2];
    unsafe {
        if libc::pipe(fds.as_mut_ptr()) != 0 {
            return;
        }
        let (read_fd, write_fd) = (fds[0], fds[1]);
        libc::dup2(write_fd, libc::STDOUT_FILENO);
        libc::dup2(write_fd, libc::STDERR_FILENO);
        if write_fd > 2 {
            libc::close(write_fd);
        }
        spawn_log_pump(read_fd, path.to_path_buf());
    }
}

#[cfg(all(not(debug_assertions), windows))]
fn redirect_std_streams(path: &Path) {
    // Point fd 1 + 2 at the write end of a pipe and let the pump thread read
    // the other end, so it can timestamp each line on its way to the file. The
    // pump opens the file through std, which handles non-ASCII profile paths
    // (e.g. C:\Users\Müller) correctly via UTF-16. O_BINARY keeps the CRT from
    // rewriting newlines on the pipe.
    let mut fds = [0 as libc::c_int; 2];
    unsafe {
        if libc::pipe(fds.as_mut_ptr(), 65536, libc::O_BINARY) != 0 {
            return;
        }
        let (read_fd, write_fd) = (fds[0], fds[1]);
        // 1 = stdout, 2 = stderr (libc on Windows omits STD*_FILENO).
        libc::dup2(write_fd, 1);
        libc::dup2(write_fd, 2);
        if write_fd > 2 {
            libc::close(write_fd);
        }
        spawn_log_pump(read_fd, path.to_path_buf());
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
    let line = format!("[webview][{level}] {message}");
    // Release on non-Windows: this println! is redirected into the pipe, where
    // the pump prepends the timestamp as it drains each line — emit it bare to
    // avoid stamping it twice.
    #[cfg(all(not(debug_assertions), not(windows)))]
    println!("{line}");
    // Release on Windows: windows_subsystem = "windows" means Rust stdio isn't
    // routed through the redirect pipe, so write straight to the file instead.
    #[cfg(all(not(debug_assertions), windows))]
    if let Some(path) = log_path() {
        append_line(&path, &line);
    }
    // In dev there is no fd redirect, so stamp the terminal echo and append the
    // same line to the file (append_line stamps it) to keep the file useful.
    #[cfg(debug_assertions)]
    {
        println!("{} {line}", timestamp());
        if let Some(path) = log_path() {
            append_line(&path, &line);
        }
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
