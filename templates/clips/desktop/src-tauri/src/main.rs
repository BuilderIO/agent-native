// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // ggml-metal registers a __cxa_atexit destructor that asserts every Metal
    // residency-set resource was freed first. The Whisper context lives in a
    // process-wide static that std::process::exit never drops, so that assert
    // aborts during exit() and macOS reports a false crash on every quit.
    // Opting out of residency sets keeps the destructor a no-op.
    #[cfg(target_os = "macos")]
    std::env::set_var("GGML_METAL_NO_RESIDENCY", "1");

    clips_tray_lib::run();
}
