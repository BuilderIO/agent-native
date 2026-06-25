use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionGuideRect {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionGuidesConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub rects: Vec<RegionGuideRect>,
    #[serde(default)]
    pub always_visible: bool,
}

impl Default for RegionGuidesConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            rects: Vec::new(),
            always_visible: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureConfig {
    pub clips_enabled: bool,
    pub meetings_enabled: bool,
    pub voice_enabled: bool,
    #[serde(default = "default_launch_at_login_enabled")]
    pub launch_at_login_enabled: bool,
    #[serde(default)]
    pub auto_hide_popover_enabled: bool,
    #[serde(default = "default_meeting_transcription_mode")]
    pub meeting_transcription_mode: MeetingTranscriptionMode,
    #[serde(default)]
    pub local_recording_mode: LocalRecordingMode,
    #[serde(default = "default_show_meeting_widget_enabled")]
    pub show_meeting_widget_enabled: bool,
    // Debug / demo aid: when true, Clips's own overlay windows (popover,
    // toolbar, countdown, finalizing, recording pill, sign-in, voice flow
    // bar) drop NSWindowSharingNone so they DO appear in screenshots and
    // screen recordings. Off by default — the windows normally stay out of
    // captures so they don't leak into the user's recorded video.
    #[serde(default)]
    pub show_in_screen_capture: bool,
    #[serde(default)]
    pub region_guides: RegionGuidesConfig,
    pub onboarding_complete: bool,
    #[serde(default = "default_whisper_model_enabled")]
    pub whisper_model_enabled: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MeetingTranscriptionMode {
    Manual,
    Ask,
    Auto,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LocalRecordingMode {
    #[default]
    Off,
    Composed,
    Separate,
}

fn default_launch_at_login_enabled() -> bool {
    true
}

fn default_meeting_transcription_mode() -> MeetingTranscriptionMode {
    MeetingTranscriptionMode::Ask
}

fn default_show_meeting_widget_enabled() -> bool {
    true
}

fn default_whisper_model_enabled() -> bool {
    true
}

impl Default for FeatureConfig {
    fn default() -> Self {
        Self {
            clips_enabled: true,
            meetings_enabled: true,
            voice_enabled: true,
            launch_at_login_enabled: true,
            auto_hide_popover_enabled: false,
            meeting_transcription_mode: default_meeting_transcription_mode(),
            local_recording_mode: LocalRecordingMode::Off,
            show_meeting_widget_enabled: default_show_meeting_widget_enabled(),
            show_in_screen_capture: false,
            region_guides: RegionGuidesConfig::default(),
            onboarding_complete: false,
            whisper_model_enabled: default_whisper_model_enabled(),
        }
    }
}

/// Path to the JSON blob that stores the feature config on disk. Lives in the
/// Tauri app-data dir (platform-specific — `~/Library/Application
/// Support/<bundle-id>/` on macOS). Returns None if the app-data dir cannot be
/// resolved.
fn config_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    if let Err(err) = std::fs::create_dir_all(&dir) {
        eprintln!(
            "[clips-tray] config_path mkdir failed: {} ({})",
            err,
            dir.display()
        );
        return None;
    }
    Some(dir.join("feature-config.json"))
}

/// Load the feature config from disk. Returns the default config if the file
/// doesn't exist or can't be parsed.
fn load_config(app: &AppHandle) -> FeatureConfig {
    let Some(path) = config_path(app) else {
        return FeatureConfig::default();
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return FeatureConfig::default();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

/// Persist the feature config to disk (atomic write via temp + rename).
fn save_config(app: &AppHandle, config: &FeatureConfig) -> Result<(), String> {
    let Some(path) = config_path(app) else {
        return Err("no app_data_dir".to_string());
    };
    let body = serde_json::to_vec_pretty(config).map_err(|e| format!("serialize: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    if let Err(err) = std::fs::write(&tmp, &body) {
        eprintln!("[clips-tray] save_config write tmp failed: {err}");
        return Err(format!("write tmp: {err}"));
    }
    if let Err(err) = std::fs::rename(&tmp, &path) {
        eprintln!("[clips-tray] save_config rename failed: {err}");
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("rename: {err}"));
    }
    Ok(())
}

fn apply_launch_at_login(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    let current = manager
        .is_enabled()
        .map_err(|e| format!("read launch-at-login: {e}"))?;
    if enabled {
        // `is_enabled()` only means a LaunchAgent with this label exists. It
        // may still point at an old dev binary or be missing our `--autostart`
        // argument, so rewrite enabled entries instead of trusting the plist.
        if current {
            manager
                .disable()
                .map_err(|e| format!("refresh launch-at-login: disable stale entry: {e}"))?;
        }
        manager
            .enable()
            .map_err(|e| format!("enable launch-at-login: {e}"))
    } else if current {
        manager
            .disable()
            .map_err(|e| format!("disable launch-at-login: {e}"))
    } else {
        Ok(())
    }
}

pub fn sync_launch_at_login(app: &AppHandle) {
    let config = load_config(app);
    if let Err(err) = apply_launch_at_login(app, config.launch_at_login_enabled) {
        eprintln!("[clips-tray] launch-at-login sync failed: {err}");
    }
}

pub fn auto_hide_popover_enabled(app: &AppHandle) -> bool {
    load_config(app).auto_hide_popover_enabled
}

pub fn show_in_screen_capture(app: &AppHandle) -> bool {
    load_config(app).show_in_screen_capture
}

pub fn feature_config(app: &AppHandle) -> FeatureConfig {
    load_config(app)
}

/// Load feature config from disk and return it to the frontend.
#[tauri::command]
pub async fn get_feature_config(app: AppHandle) -> Result<FeatureConfig, String> {
    Ok(load_config(&app))
}

/// Save feature config to disk and emit a change event.
#[tauri::command]
pub async fn set_feature_config(app: AppHandle, config: FeatureConfig) -> Result<(), String> {
    let previous = load_config(&app);
    if previous.launch_at_login_enabled != config.launch_at_login_enabled {
        if let Err(err) = apply_launch_at_login(&app, config.launch_at_login_enabled) {
            eprintln!("[clips-tray] launch-at-login apply failed: {err}");
        }
    }
    let capture_changed = previous.show_in_screen_capture != config.show_in_screen_capture;
    save_config(&app, &config)?;
    if capture_changed {
        // Reapply NSWindow.sharingType to every live overlay window so the
        // toggle takes effect on anything already on screen (popover,
        // recording chrome, voice flow bar, etc.) without requiring a
        // recording-flow round trip.
        crate::util::reapply_capture_exclusion_to_overlays(&app);
    }
    // Apply the region-guides visibility decision (always-on toggle, preset
    // changes, master enable/disable) without requiring a recording-flow
    // round trip. Cheap — it just inspects current state.
    crate::clips::reconcile_region_guides(&app);
    if previous.whisper_model_enabled != config.whisper_model_enabled {
        let _ = app.emit(
            "whisper:model-enabled-changed",
            serde_json::json!({ "enabled": config.whisper_model_enabled }),
        );
    }
    let _ = app.emit("app:feature-config-changed", config);
    Ok(())
}
