
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::{AppHandle, Manager};

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

const MAX_BYTES: u64 = 10 * 1024 * 1024;

pub fn log_path() -> Option<PathBuf> {
    LOG_PATH.get().cloned()
}

fn timestamp() -> String {
    chrono::Local::now()
        .format("%Y-%m-%d %H:%M:%S%.3f")
        .to_string()
}

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

    install_panic_hook();

    #[cfg(not(debug_assertions))]
    redirect_std_streams(&path);

    let banner = format!(
        "[clips-tray] === log start v{} ===",
        env!("CARGO_PKG_VERSION"),
    );
    #[cfg(not(debug_assertions))]
    println!("{banner}");
    #[cfg(debug_assertions)]
    append_line(&path, &banner);
}

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
            let _ = fs::rename(path, path.with_extension("log.1"));
        }
    }
}

fn append_line(path: &Path, line: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let record = format!("{} {line}\n", timestamp());
        let _ = file.write_all(record.as_bytes());
    }
}

pub(crate) fn diagnostic(line: &str) {
    if let Some(path) = log_path() {
        append_line(&path, line);
    }
}

#[cfg(not(debug_assertions))]
fn spawn_log_pump(read_fd: libc::c_int, path: PathBuf) {
    std::thread::spawn(move || {
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
                if std::io::Error::last_os_error().raw_os_error() == Some(libc::EINTR) {
                    continue;
                }
                break;
            }
            if n == 0 {
                break; // all writers closed → real EOF
            }
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
    let mut fds = [0 as libc::c_int; 2];
    unsafe {
        if libc::pipe(fds.as_mut_ptr(), 65536, libc::O_BINARY) != 0 {
            return;
        }
        let (read_fd, write_fd) = (fds[0], fds[1]);
        libc::dup2(write_fd, 1);
        libc::dup2(write_fd, 2);
        if write_fd > 2 {
            libc::close(write_fd);
        }
        spawn_log_pump(read_fd, path.to_path_buf());
    }
}

#[cfg(all(not(debug_assertions), not(unix), not(windows)))]
fn redirect_std_streams(_path: &Path) {}

#[tauri::command]
pub fn frontend_log(level: String, message: String) {
    let line = format!("[webview][{level}] {message}");
    #[cfg(all(not(debug_assertions), not(windows)))]
    println!("{line}");
    #[cfg(all(not(debug_assertions), windows))]
    if let Some(path) = log_path() {
        append_line(&path, &line);
    }
    #[cfg(debug_assertions)]
    {
        println!("{} {line}", timestamp());
        if let Some(path) = log_path() {
            append_line(&path, &line);
        }
    }
}

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
