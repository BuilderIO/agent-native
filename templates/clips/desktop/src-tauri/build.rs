use std::path::Path;
use std::process::Command;

fn main() {
    add_swift_runtime_rpaths();
    tauri_build::build()
}

fn add_swift_runtime_rpaths() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    // Native pause/resume concatenates MP4 segments via AVFoundation +
    // CoreMedia (see `concat_mp4_segments` in `native_screen.rs`). These
    // frameworks may already be pulled in transitively, but declaring them
    // explicitly guarantees the linker resolves the AVAssetExportSession /
    // CMTime symbols we touch via raw `msg_send!` / `extern "C"`.
    println!("cargo:rustc-link-lib=framework=AVFoundation");
    println!("cargo:rustc-link-lib=framework=CoreMedia");

    // The screencapturekit crate builds a Swift bridge. Its build script adds
    // these rpaths for its own crate, but Cargo does not propagate them to the
    // final Tauri binary, so the dev executable can fail to find
    // libswift_Concurrency.dylib at launch.
    emit_rpath("/usr/lib/swift");

    if let Some(developer_dir) = xcode_developer_dir() {
        emit_rpath(format!(
            "{developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift-5.5/macosx"
        ));
        emit_rpath(format!(
            "{developer_dir}/Toolchains/XcodeDefault.xctoolchain/usr/lib/swift/macosx"
        ));
    }
}

fn xcode_developer_dir() -> Option<String> {
    let output = Command::new("xcode-select").arg("-p").output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn emit_rpath(path: impl AsRef<str>) {
    let path = path.as_ref();
    if Path::new(path).exists() {
        println!("cargo:rustc-link-arg=-Wl,-rpath,{path}");
    }
}
