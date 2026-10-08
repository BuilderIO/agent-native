#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "macos")]
    std::env::set_var("GGML_METAL_NO_RESIDENCY", "1");

    clips_tray_lib::run();
}
