use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;

const FEATURE_CONFIG_VERSION: u32 = 2;

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
pub struct ScreenMemoryConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub paused: bool,
    #[serde(default = "default_screen_memory_retention_hours")]
    pub retention_hours: u32,
    #[serde(default = "default_screen_memory_max_bytes")]
    pub max_bytes: u64,
    #[serde(default = "default_screen_memory_segment_seconds")]
    pub segment_seconds: u64,
    #[serde(default = "default_screen_memory_sample_interval_seconds")]
    pub sample_interval_seconds: u64,
    #[serde(default)]
    pub capture_mode: RewindCaptureMode,
    #[serde(default = "default_rewind_review_before_sending")]
    pub review_before_sending: bool,
    #[serde(default = "default_rewind_auto_preview_before_sending")]
    pub auto_preview_before_sending: bool,
    #[serde(default)]
    pub agent_clip_retention: RewindAgentClipRetention,
    #[serde(default = "default_screen_memory_excluded_bundle_ids")]
    pub excluded_bundle_ids: Vec<String>,
    #[serde(default = "default_screen_memory_exclude_private_windows")]
    pub exclude_private_windows: bool,
}

impl Default for ScreenMemoryConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            paused: false,
            retention_hours: default_screen_memory_retention_hours(),
            max_bytes: default_screen_memory_max_bytes(),
            segment_seconds: default_screen_memory_segment_seconds(),
            sample_interval_seconds: default_screen_memory_sample_interval_seconds(),
            capture_mode: RewindCaptureMode::default(),
            review_before_sending: default_rewind_review_before_sending(),
            auto_preview_before_sending: default_rewind_auto_preview_before_sending(),
            agent_clip_retention: RewindAgentClipRetention::default(),
            excluded_bundle_ids: default_screen_memory_excluded_bundle_ids(),
            exclude_private_windows: default_screen_memory_exclude_private_windows(),
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RewindCaptureMode {
    #[default]
    Visuals,
    VisualsAudio,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RewindAgentClipRetention {
    #[default]
    Forever,
    #[serde(rename = "24-hours")]
    Hours24,
    #[serde(rename = "7-days")]
    Days7,
    #[serde(rename = "30-days")]
    Days30,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureConfig {
    #[serde(default)]
    pub config_version: u32,
    pub clips_enabled: bool,
    pub meetings_enabled: bool,
    pub voice_enabled: bool,
    #[serde(default = "default_voice_cleanup_enabled")]
    pub voice_cleanup_enabled: bool,
    #[serde(default = "default_launch_at_login_enabled")]
    pub launch_at_login_enabled: bool,
    #[serde(default = "default_auto_hide_popover_enabled")]
    pub auto_hide_popover_enabled: bool,
    #[serde(default = "default_meeting_transcription_mode")]
    pub meeting_transcription_mode: MeetingTranscriptionMode,
    #[serde(default)]
    pub local_recording_mode: LocalRecordingMode,
    #[serde(default = "default_show_meeting_widget_enabled")]
    pub show_meeting_widget_enabled: bool,
    #[serde(default)]
    pub show_in_screen_capture: bool,
    #[serde(default)]
    pub region_guides: RegionGuidesConfig,
    #[serde(default)]
    pub screen_memory: ScreenMemoryConfig,
    #[serde(default = "default_whisper_model_enabled")]
    pub whisper_model_enabled: bool,
    #[serde(default = "default_whisper_model_id")]
    pub whisper_model_id: String,
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

fn default_auto_hide_popover_enabled() -> bool {
    true
}

fn default_voice_cleanup_enabled() -> bool {
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

fn default_whisper_model_id() -> String {
    "base".to_string()
}

fn default_screen_memory_retention_hours() -> u32 {
    8
}

fn default_screen_memory_excluded_bundle_ids() -> Vec<String> {
    [
        "com.1password.1password",
        "com.agilebits.onepassword7",
        "com.bitwarden.desktop",
        "com.dashlane.dashlane",
        "com.lastpass.lastpass",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}

fn default_screen_memory_exclude_private_windows() -> bool {
    false
}

fn default_screen_memory_max_bytes() -> u64 {
    5 * 1024 * 1024 * 1024
}

fn default_screen_memory_segment_seconds() -> u64 {
    5 * 60
}

fn default_screen_memory_sample_interval_seconds() -> u64 {
    10
}

fn default_rewind_review_before_sending() -> bool {
    true
}

fn default_rewind_auto_preview_before_sending() -> bool {
    true
}

impl Default for FeatureConfig {
    fn default() -> Self {
        Self {
            config_version: FEATURE_CONFIG_VERSION,
            clips_enabled: true,
            meetings_enabled: true,
            voice_enabled: true,
            voice_cleanup_enabled: default_voice_cleanup_enabled(),
            launch_at_login_enabled: true,
            auto_hide_popover_enabled: default_auto_hide_popover_enabled(),
            meeting_transcription_mode: default_meeting_transcription_mode(),
            local_recording_mode: LocalRecordingMode::Off,
            show_meeting_widget_enabled: default_show_meeting_widget_enabled(),
            show_in_screen_capture: false,
            region_guides: RegionGuidesConfig::default(),
            screen_memory: ScreenMemoryConfig::default(),
            whisper_model_enabled: default_whisper_model_enabled(),
            whisper_model_id: default_whisper_model_id(),
        }
    }
}

fn migrate_feature_config(mut config: FeatureConfig) -> FeatureConfig {
    if config.config_version < 1 {
        config.auto_hide_popover_enabled = true;
    }
    if config.config_version < 2 && config.screen_memory.max_bytes == 20 * 1024 * 1024 * 1024 {
        config.screen_memory.max_bytes = default_screen_memory_max_bytes();
    }
    if config.config_version < FEATURE_CONFIG_VERSION {
        config.config_version = FEATURE_CONFIG_VERSION;
    }
    config
}

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

fn load_config(app: &AppHandle) -> FeatureConfig {
    let Some(path) = config_path(app) else {
        return FeatureConfig::default();
    };
    let Ok(bytes) = std::fs::read(&path) else {
        return FeatureConfig::default();
    };
    let config: FeatureConfig = serde_json::from_slice(&bytes).unwrap_or_default();
    let needs_migration = config.config_version < FEATURE_CONFIG_VERSION;
    let config = migrate_feature_config(config);
    if needs_migration {
        if let Err(err) = save_config(app, &config) {
            eprintln!("[clips-tray] legacy feature config migration failed: {err}");
        }
    }
    config
}

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

#[tauri::command]
pub async fn get_feature_config(app: AppHandle) -> Result<FeatureConfig, String> {
    Ok(load_config(&app))
}

#[tauri::command]
pub async fn set_feature_config(
    app: AppHandle,
    mut config: FeatureConfig,
) -> Result<(), String> {
    config.config_version = FEATURE_CONFIG_VERSION;
    if !crate::whisper_model::is_supported_model_id(&config.whisper_model_id) {
        return Err(format!(
            "unsupported Whisper model: {}",
            config.whisper_model_id
        ));
    }
    let previous = load_config(&app);
    if (crate::rewind_clip::is_active(&app) || crate::util::is_recording_active(&app))
        && rewind_capture_contract_changed(&previous.screen_memory, &config.screen_memory)
    {
        return Err(
            "Rewind capture settings stay unchanged while a Clip is recording. Stop the Clip before turning Rewind on or off, pausing it, or changing what it remembers."
                .to_string(),
        );
    }
    if previous.launch_at_login_enabled != config.launch_at_login_enabled {
        if let Err(err) = apply_launch_at_login(&app, config.launch_at_login_enabled) {
            eprintln!("[clips-tray] launch-at-login apply failed: {err}");
        }
    }
    let capture_changed = previous.show_in_screen_capture != config.show_in_screen_capture;
    save_config(&app, &config)?;
    if capture_changed {
        crate::util::reapply_capture_exclusion_to_overlays(&app);
    }
    crate::clips::reconcile_region_guides(&app);
    if previous.whisper_model_enabled != config.whisper_model_enabled {
        let _ = app.emit(
            "whisper:model-enabled-changed",
            serde_json::json!({ "enabled": config.whisper_model_enabled }),
        );
    }
    if previous.whisper_model_id != config.whisper_model_id {
        let _ = app.emit(
            "whisper:model-selection-changed",
            serde_json::json!({ "modelId": config.whisper_model_id }),
        );
    }
    crate::screen_memory::sync_from_config(&app, &config);
    let _ = app.emit("app:feature-config-changed", config);
    Ok(())
}

fn rewind_capture_contract_changed(
    previous: &ScreenMemoryConfig,
    next: &ScreenMemoryConfig,
) -> bool {
    previous.enabled != next.enabled
        || previous.paused != next.paused
        || previous.capture_mode != next.capture_mode
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn screen_memory_config_defaults_agent_handoff_fields_when_loading_legacy_json() {
        let config: ScreenMemoryConfig = serde_json::from_value(serde_json::json!({
            "enabled": true,
            "retentionHours": 24
        }))
        .unwrap();

        assert_eq!(config.retention_hours, 24);
        assert_eq!(config.capture_mode, RewindCaptureMode::Visuals);
        assert!(config.review_before_sending);
        assert!(config.auto_preview_before_sending);
        assert_eq!(
            config.agent_clip_retention,
            RewindAgentClipRetention::Forever
        );
        assert!(!config.exclude_private_windows);
        assert!(config
            .excluded_bundle_ids
            .contains(&"com.1password.1password".to_string()));
    }

    #[test]
    fn feature_config_defaults_to_base_whisper_model_for_legacy_json() {
        let config: FeatureConfig = serde_json::from_value(serde_json::json!({
            "clipsEnabled": true,
            "meetingsEnabled": true,
            "voiceEnabled": true
        }))
        .unwrap();

        assert_eq!(config.whisper_model_id, "base");
        assert!(config.voice_cleanup_enabled);
        assert!(config.auto_hide_popover_enabled);

        let opt_out: FeatureConfig = serde_json::from_value(serde_json::json!({
            "clipsEnabled": true,
            "meetingsEnabled": true,
            "voiceEnabled": true,
            "autoHidePopoverEnabled": false
        }))
        .unwrap();
        assert!(!opt_out.auto_hide_popover_enabled);
    }

    #[test]
    fn migrates_the_previous_screen_memory_storage_default() {
        let mut config = FeatureConfig::default();
        config.config_version = 1;
        config.auto_hide_popover_enabled = false;
        config.screen_memory.max_bytes = 20 * 1024 * 1024 * 1024;

        let migrated = migrate_feature_config(config);

        assert_eq!(migrated.config_version, FEATURE_CONFIG_VERSION);
        assert_eq!(migrated.screen_memory.max_bytes, 5 * 1024 * 1024 * 1024);
        assert!(!migrated.auto_hide_popover_enabled);

        let mut custom = FeatureConfig::default();
        custom.config_version = 1;
        custom.screen_memory.max_bytes = 50 * 1024 * 1024 * 1024;
        assert_eq!(
            migrate_feature_config(custom).screen_memory.max_bytes,
            50 * 1024 * 1024 * 1024
        );
    }

    #[test]
    fn feature_config_migration_updates_legacy_default_but_preserves_current_opt_out() {
        let legacy: FeatureConfig = serde_json::from_value(serde_json::json!({
            "clipsEnabled": true,
            "meetingsEnabled": true,
            "voiceEnabled": true,
            "autoHidePopoverEnabled": false
        }))
        .unwrap();
        let migrated = migrate_feature_config(legacy);

        assert_eq!(migrated.config_version, FEATURE_CONFIG_VERSION);
        assert!(migrated.auto_hide_popover_enabled);

        let mut current = FeatureConfig::default();
        current.auto_hide_popover_enabled = false;
        let current = migrate_feature_config(current);

        assert_eq!(current.config_version, FEATURE_CONFIG_VERSION);
        assert!(!current.auto_hide_popover_enabled);
    }

    #[test]
    fn rewind_enums_use_stable_kebab_case_values() {
        assert_eq!(
            serde_json::to_string(&RewindCaptureMode::VisualsAudio).unwrap(),
            "\"visuals-audio\""
        );
        assert_eq!(
            serde_json::to_string(&RewindAgentClipRetention::Days7).unwrap(),
            "\"7-days\""
        );
    }

    #[test]
    fn active_clip_interlock_only_blocks_capture_contract_changes() {
        let previous = ScreenMemoryConfig {
            enabled: true,
            paused: false,
            capture_mode: RewindCaptureMode::VisualsAudio,
            ..ScreenMemoryConfig::default()
        };
        let mut retention_only = previous.clone();
        retention_only.retention_hours = 24;
        assert!(!rewind_capture_contract_changed(&previous, &retention_only));

        let mut paused = previous.clone();
        paused.paused = true;
        assert!(rewind_capture_contract_changed(&previous, &paused));

        let mut disabled = previous.clone();
        disabled.enabled = false;
        assert!(rewind_capture_contract_changed(&previous, &disabled));

        let mut mode_changed = previous.clone();
        mode_changed.capture_mode = RewindCaptureMode::Visuals;
        assert!(rewind_capture_contract_changed(&previous, &mode_changed));
    }
}
