use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    emit_sentry_env_reruns();
    embed_macos_dev_info_plist();
    compile_screen_memory_ocr_helper();
    add_swift_runtime_rpaths();
    tauri_build::build()
}

/// `tauri dev` runs the macOS executable directly instead of inside the app
/// bundle, so the bundle's `Info.plist` is not available to TCC. Embed an
/// equivalent plist in the dev binary or privacy-sensitive APIs can terminate
/// it before the tray icon becomes visible.
///
/// The identity and version keys are generated here from `tauri.conf.json`
/// and the crate version instead of living in `Info.plist`: the bundler
/// merges that file over the plist it generates, so hardcoded values there
/// override the release identifier, executable name, and version.
fn embed_macos_dev_info_plist() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    let info_plist = Path::new("Info.plist");
    let config_path = Path::new("tauri.conf.json");
    println!("cargo:rerun-if-changed={}", info_plist.display());
    println!("cargo:rerun-if-changed={}", config_path.display());

    let source = std::fs::read_to_string(info_plist)
        .expect("macOS Info.plist must exist for the desktop binary");
    let config: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(config_path).expect("tauri.conf.json must exist"),
    )
    .expect("tauri.conf.json must be valid JSON");
    let identifier = config["identifier"]
        .as_str()
        .expect("tauri.conf.json must set identifier");
    let product_name = config["productName"]
        .as_str()
        .expect("tauri.conf.json must set productName");
    let executable = config["mainBinaryName"].as_str().unwrap_or(product_name);
    let version = std::env::var("CARGO_PKG_VERSION").expect("Cargo sets CARGO_PKG_VERSION");
    for value in [identifier, product_name, executable, version.as_str()] {
        assert!(
            !value.contains(['<', '&']),
            "plist identity values must not need XML escaping: {value}"
        );
    }

    let identity = format!(
        "    <key>CFBundleIdentifier</key>\n    <string>{identifier}</string>\n\
         \x20   <key>CFBundleName</key>\n    <string>{product_name}</string>\n\
         \x20   <key>CFBundleDisplayName</key>\n    <string>{product_name}</string>\n\
         \x20   <key>CFBundleExecutable</key>\n    <string>{executable}</string>\n\
         \x20   <key>CFBundlePackageType</key>\n    <string>APPL</string>\n\
         \x20   <key>CFBundleShortVersionString</key>\n    <string>{version}</string>\n\
         \x20   <key>CFBundleVersion</key>\n    <string>{version}</string>\n"
    );
    let generated = source.replacen("<dict>\n", &format!("<dict>\n{identity}"), 1);
    assert!(
        generated != source,
        "Info.plist must contain a top-level <dict> to receive identity keys"
    );

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("Cargo sets OUT_DIR"));
    let dev_plist = out_dir.join("DevInfo.plist");
    std::fs::write(&dev_plist, generated).expect("write the dev Info.plist");
    println!(
        "cargo:rustc-link-arg-bins=-Wl,-sectcreate,__TEXT,__info_plist,{}",
        dev_plist.display()
    );
}

/// Build the tiny, macOS-only AVFoundation/Vision bridge used by local Screen
/// Memory OCR. Keeping this outside the Rust dependency graph avoids adding a
/// large Objective-C binding surface for a single, OS-provided capability.
fn compile_screen_memory_ocr_helper() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }

    let source = Path::new("native/screen_memory_ocr.swift");
    println!("cargo:rerun-if-changed={}", source.display());

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").expect("Cargo sets OUT_DIR"));
    let object = out_dir.join("screen_memory_ocr_helper.o");
    let archive = out_dir.join("libscreen_memory_ocr_helper.a");

    // `tauri build --target universal-apple-darwin` invokes Cargo once per
    // architecture. swiftc otherwise emits an object for the runner's host
    // architecture, which makes the x86_64 link fail on arm64 CI runners.
    let swift_arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        Ok("x86_64") => "x86_64",
        Ok(arch) => panic!("unsupported macOS OCR helper architecture: {arch}"),
        Err(error) => panic!("Cargo target architecture is required: {error}"),
    };
    let deployment_target =
        std::env::var("MACOSX_DEPLOYMENT_TARGET").unwrap_or_else(|_| "13.0".to_string());
    let swift_target = format!("{swift_arch}-apple-macosx{deployment_target}");

    let swift_status = Command::new("xcrun")
        .args([
            "swiftc",
            "-parse-as-library",
            "-emit-object",
            "-target",
            &swift_target,
            source.to_str().expect("UTF-8 source path"),
            "-o",
            object.to_str().expect("UTF-8 output path"),
        ])
        .status()
        .expect("Xcode's swiftc is required to build the macOS OCR helper");
    assert!(swift_status.success(), "failed to compile macOS OCR helper");

    let archive_status = Command::new("ar")
        .args([
            "crus",
            archive.to_str().expect("UTF-8 archive path"),
            object.to_str().expect("UTF-8 object path"),
        ])
        .status()
        .expect("ar is required to archive the macOS OCR helper");
    assert!(
        archive_status.success(),
        "failed to archive macOS OCR helper"
    );

    println!("cargo:rustc-link-search=native={}", out_dir.display());
    println!("cargo:rustc-link-lib=static=screen_memory_ocr_helper");
    // The helper is written in Swift, while the rest of the native desktop
    // stack already carries Swift runtime rpaths through ScreenCaptureKit.
    for library in ["swiftCore", "swiftFoundation", "swift_Concurrency"] {
        println!("cargo:rustc-link-lib=dylib={library}");
    }
}

fn emit_sentry_env_reruns() {
    for name in [
        "CLIPS_DESKTOP_SENTRY_DSN",
        "TAURI_SENTRY_DSN",
        "SENTRY_DESKTOP_DSN",
        "SENTRY_CLIENT_DSN",
        "VITE_SENTRY_CLIENT_DSN",
        "VITE_SENTRY_DSN",
        "SENTRY_DSN",
        "CLIPS_DESKTOP_SENTRY_CLIENT_KEY",
        "SENTRY_CLIENT_KEY",
        "VITE_SENTRY_CLIENT_KEY",
        "CLIPS_DESKTOP_SENTRY_PROJECT_ID",
        "SENTRY_PROJECT_ID",
        "VITE_SENTRY_PROJECT_ID",
        "CLIPS_DESKTOP_SENTRY_INGEST_HOST",
        "SENTRY_INGEST_HOST",
        "VITE_SENTRY_INGEST_HOST",
        "CLIPS_DESKTOP_SENTRY_ENVIRONMENT",
        "SENTRY_ENVIRONMENT",
        "NETLIFY_CONTEXT",
        "VERCEL_ENV",
        "NODE_ENV",
    ] {
        println!("cargo:rerun-if-env-changed={name}");
    }
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
    println!("cargo:rustc-link-lib=framework=Vision");
    println!("cargo:rustc-link-lib=framework=CoreGraphics");
    println!("cargo:rustc-link-lib=framework=IOKit");

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
